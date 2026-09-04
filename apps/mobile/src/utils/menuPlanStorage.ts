/**
 * 献立の保存形（v19・`menu_plans` / `menu_plan_days`）と旧 JSON の互換読み。
 *
 * **ここは純関数だけ**（`utils/menuPlan.ts` と同じ作法）。DB の読み書きは
 * `services/menu-plan.service.ts` が持つが、あちらは drizzle を動的 import する
 * ため **jest では実行できない**（`docs/品質基準.md` §2.3）。互換の判断
 * （旧データに無いフィールド・壊れた値・未知の時間帯）を全部こちらへ寄せて、
 * jest で固定できるようにする。
 *
 * 旧設計（v18 まで）は `app_meta` の `menu_plan` キーに JSON 1 本だった。
 * 旧 JSON は**時間帯の情報を持たない = 夕**として取り込む（§10.6）。
 */

/** 献立の時間帯。テーブルの `meal_time` 列と 1:1。 */
export const MENU_MEAL_TIMES = ['breakfast', 'lunch', 'dinner'] as const;
export type MenuMealTime = (typeof MENU_MEAL_TIMES)[number];

/** 未知の値・欠損は**夕として読む**（旧データ互換の背骨。§10.6） */
export function sanitizeMenuMealTime(value: unknown): MenuMealTime {
  return value === 'breakfast' || value === 'lunch' ? value : 'dinner';
}

export interface StoredMenuDay {
  day: number;
  recipeId: string;
  /** 表示用。レシピが消えたときに「無くなりました」を出せるよう写す */
  title: string;
  reason: string;
  /** 作り終わった日（調理記録から埋める）。null = まだ */
  doneAt: string | null;
}

/**
 * メモリ上の献立 1 本（1 時間帯 1 プラン）。v18 までの JSON 形に `mealTime` を
 * 足した形で、**サービス層の公開 API はこの形のまま**（呼び出し側の変更を最小化）。
 * `version` はテーブルには保存しない（テーブルの形そのものが版）が、
 * 既存コードとの互換のため残す。
 */
export interface StoredMenuPlan {
  version: 1;
  /** どの時間帯のプランか。旧 JSON 由来は常に 'dinner' */
  mealTime: MenuMealTime;
  generatedAt: string;
  /** どちらの経路で出たか。M2 の AI が効いたかを後から確かめられる */
  source: 'coverage' | 'ai';
  days: StoredMenuDay[];
  /** 在庫の件数 + 最終更新時刻。変わっていたら「作り直す」を静かに出す */
  pantrySignature: string;
  /** M2 の AI が返した献立全体への一言（無ければ省略） */
  aiNote?: string;
  /**
   * 毎日の自動献立モード（§10.11・**夕のみ**）の起点日（`YYYY-MM-DD`）。
   * 手動プランには付かない——ローリング（`rollMenuPlan`）が
   * 「anchorDate が無ければ触らない」で手動プランを一切いじらずに済む。
   */
  anchorDate?: string;
  /**
   * 「組む」で要求した日数（§10.7-a）。旧データには無い — 無ければ無いまま返し、
   * 不足の表示を出さない。壊れた値（0 以下・非整数・数でない）も落として読む。
   */
  requestedDays?: number;
  /**
   * 直近の自動追加で買い物リストへ入れた `shopping_items.id`（§10.11.2）。
   * 次にまた自動追加が走るとこのバッチは丸ごと置き換わる（積み上げない）。
   */
  autoAddedItemIds?: string[];
}

/** `menu_plans` の 1 行（drizzle の select 結果と同じ形） */
export interface MenuPlanRow {
  id: string;
  mealTime: string;
  generatedAt: string;
  source: string;
  pantrySignature: string;
  anchorDate: string | null;
  requestedDays: number | null;
  aiNote: string | null;
  /** `shopping_items.id` の JSON 配列文字列。null = 無し */
  autoAddedItemIds: string | null;
}

/** `menu_plan_days` の 1 行（`planId` を除く） */
export interface MenuPlanDayRow {
  day: number;
  recipeId: string;
  title: string;
  reason: string;
  doneAt: string | null;
}

function sanitizeRequestedDays(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 日の並びを正規化する。壊れた行は捨てる（半端な日を描くより出さない方がよい） */
function sanitizeDays(value: unknown): StoredMenuDay[] {
  if (!Array.isArray(value)) return [];
  const days: StoredMenuDay[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const day = item as Record<string, unknown>;
    if (typeof day.day !== 'number' || !Number.isInteger(day.day)) continue;
    if (typeof day.recipeId !== 'string' || typeof day.title !== 'string') continue;
    days.push({
      day: day.day,
      recipeId: day.recipeId,
      title: day.title,
      reason: typeof day.reason === 'string' ? day.reason : '',
      doneAt: typeof day.doneAt === 'string' ? day.doneAt : null,
    });
  }
  return days;
}

/**
 * 旧 `app_meta` の `menu_plan` JSON を読む（v19 のレイジー移行用）。
 * 壊れていたら null（作り直せば直る）。**旧 JSON は時間帯を持たない = 夕。**
 * `requestedDays` の互換（旧データに無い・壊れた値は落とす）は従来
 * `readStoredMenuPlan` にあった判断そのもの — テストもここで固定する。
 */
export function parseLegacyMenuPlanJson(raw: string): StoredMenuPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const plan = value as Record<string, unknown>;
  if (!Array.isArray(plan.days)) return null;

  const requestedDays = sanitizeRequestedDays(plan.requestedDays);
  const autoAddedItemIds = Array.isArray(plan.autoAddedItemIds)
    ? plan.autoAddedItemIds.filter((id): id is string => typeof id === 'string')
    : undefined;
  return {
    version: 1,
    mealTime: 'dinner',
    generatedAt: typeof plan.generatedAt === 'string' ? plan.generatedAt : '',
    source: plan.source === 'ai' ? 'ai' : 'coverage',
    pantrySignature: typeof plan.pantrySignature === 'string' ? plan.pantrySignature : '',
    days: sanitizeDays(plan.days),
    ...(typeof plan.aiNote === 'string' && plan.aiNote ? { aiNote: plan.aiNote } : {}),
    ...(typeof plan.anchorDate === 'string' && plan.anchorDate
      ? { anchorDate: plan.anchorDate }
      : {}),
    ...(requestedDays !== undefined ? { requestedDays } : {}),
    ...(autoAddedItemIds !== undefined ? { autoAddedItemIds } : {}),
  };
}

/**
 * テーブルの行 → メモリ形。未知の `meal_time`・壊れた `requested_days`・
 * 壊れた `auto_added_item_ids` JSON は**夕/無しへ倒して読む**（§10.6 の互換規約）。
 */
export function menuPlanRowToStored(
  row: MenuPlanRow,
  dayRows: readonly MenuPlanDayRow[],
): StoredMenuPlan {
  let autoAddedItemIds: string[] | undefined;
  if (row.autoAddedItemIds !== null) {
    try {
      const parsed: unknown = JSON.parse(row.autoAddedItemIds);
      if (Array.isArray(parsed)) {
        autoAddedItemIds = parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // 壊れた JSON は「無し」として読む（取り消しバーが出ないだけ）
    }
  }
  const requestedDays = sanitizeRequestedDays(row.requestedDays);
  return {
    version: 1,
    mealTime: sanitizeMenuMealTime(row.mealTime),
    generatedAt: row.generatedAt,
    source: row.source === 'ai' ? 'ai' : 'coverage',
    pantrySignature: row.pantrySignature,
    days: [...dayRows]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        day: d.day,
        recipeId: d.recipeId,
        title: d.title,
        reason: d.reason,
        doneAt: d.doneAt,
      })),
    ...(row.aiNote !== null && row.aiNote !== '' ? { aiNote: row.aiNote } : {}),
    ...(row.anchorDate !== null && row.anchorDate !== '' ? { anchorDate: row.anchorDate } : {}),
    ...(requestedDays !== undefined ? { requestedDays } : {}),
    ...(autoAddedItemIds !== undefined ? { autoAddedItemIds } : {}),
  };
}

/** メモリ形 → テーブルの行。`menuPlanRowToStored` と往復する（テストで固定） */
export function storedMenuPlanToRows(
  plan: StoredMenuPlan,
  id: string,
): { row: MenuPlanRow; days: MenuPlanDayRow[] } {
  return {
    row: {
      id,
      mealTime: plan.mealTime,
      generatedAt: plan.generatedAt,
      source: plan.source,
      pantrySignature: plan.pantrySignature,
      anchorDate: plan.anchorDate ?? null,
      requestedDays: plan.requestedDays ?? null,
      aiNote: plan.aiNote ?? null,
      autoAddedItemIds:
        plan.autoAddedItemIds !== undefined ? JSON.stringify(plan.autoAddedItemIds) : null,
    },
    days: plan.days.map((d) => ({
      day: d.day,
      recipeId: d.recipeId,
      title: d.title,
      reason: d.reason,
      doneAt: d.doneAt,
    })),
  };
}
