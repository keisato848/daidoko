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
  /**
   * 枠ごとの献立（v20・`menu_plan_slots`）。**読んだままを持ち回って書き戻すための控え**。
   *
   * `days` は主菜（`main` 枠）の射影で、既存の呼び出し側はそちらだけを見る。
   * 保存のたびに `days` から作り直すと、**主菜以外の枠が毎回消える**ので、
   * 読みで拾った枠をここに載せ、書きで `applyDaysToSlots` に渡して残す。
   */
  slots?: MenuPlanSlotRow[];
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
 *
 * `slotRows` を渡すと `days` は**主菜枠の射影**になり、渡した行は `slots` にそのまま残る
 * （書き戻しで主菜以外の枠を消さないため）。空配列・省略なら従来どおり `dayRows` から作る。
 */
export function menuPlanRowToStored(
  row: MenuPlanRow,
  dayRows: readonly MenuPlanDayRow[],
  slotRows: readonly MenuPlanSlotRow[] = [],
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
  // 枠がある（v20 以降）なら主菜枠が正。無ければ旧 `menu_plan_days` から読む
  const dayList = slotRows.length > 0 ? mainSlotsToDays(slotRows) : dayRows;
  return {
    version: 1,
    mealTime: sanitizeMenuMealTime(row.mealTime),
    generatedAt: row.generatedAt,
    source: row.source === 'ai' ? 'ai' : 'coverage',
    pantrySignature: row.pantrySignature,
    days: [...dayList]
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        day: d.day,
        recipeId: d.recipeId,
        title: d.title,
        reason: d.reason,
        doneAt: d.doneAt,
      })),
    ...(slotRows.length > 0 ? { slots: [...slotRows] } : {}),
    ...(row.aiNote !== null && row.aiNote !== '' ? { aiNote: row.aiNote } : {}),
    ...(row.anchorDate !== null && row.anchorDate !== '' ? { anchorDate: row.anchorDate } : {}),
    ...(requestedDays !== undefined ? { requestedDays } : {}),
    ...(autoAddedItemIds !== undefined ? { autoAddedItemIds } : {}),
  };
}

/**
 * メモリ形 → テーブルの行。`menuPlanRowToStored` と往復する（テストで固定）。
 *
 * `slots` は `days`（主菜）を読み込み済みの枠へ写した結果（`applyDaysToSlots`）。
 * **主菜以外の枠はここを通っても消えない。**
 */
export function storedMenuPlanToRows(
  plan: StoredMenuPlan,
  id: string,
): { row: MenuPlanRow; days: MenuPlanDayRow[]; slots: MenuPlanSlotRow[] } {
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
    slots: applyDaysToSlots(plan.days, plan.slots ?? []),
  };
}

/** `menu_plan_slots` の 1 行（`planId` を除く、v20） */
export interface MenuPlanSlotRow {
  day: number;
  slotId: string;
  recipeId: string;
  title: string;
  reason: string;
  doneAt: string | null;
}

/** 主菜の枠 ID。v19 までの献立は「1 日 1 品」＝すべてこの枠に入る */
export const MAIN_SLOT_ID = 'main';

/**
 * 旧 `menu_plan_days` の行配列を `menu_plan_slots` の行配列（全行 `slotId: 'main'`）へ変換する純関数。
 * v20 のレイジー移行（`services/menu-plan.service.ts`）から呼ばれる。
 */
export function legacyPlanDaysToSlots(days: readonly MenuPlanDayRow[]): MenuPlanSlotRow[] {
  return days.map((d) => ({
    day: d.day,
    slotId: MAIN_SLOT_ID,
    recipeId: d.recipeId,
    title: d.title,
    reason: d.reason,
    doneAt: d.doneAt,
  }));
}

/** 枠の行から主菜だけを取り出して「1 日 1 品」の形に戻す（`days` の作り元） */
export function mainSlotsToDays(slots: readonly MenuPlanSlotRow[]): MenuPlanDayRow[] {
  return slots
    .filter((s) => s.slotId === MAIN_SLOT_ID)
    .map((s) => ({
      day: s.day,
      recipeId: s.recipeId,
      title: s.title,
      reason: s.reason,
      doneAt: s.doneAt,
    }));
}

/**
 * `days`（主菜）の変更を枠の行へ写す。**主菜以外の枠はそのまま残す。**
 *
 * 保存経路（`writeStoredMenuPlan`）は毎回プラン行を作り直すので、ここで枠を組み直さないと
 * 「作った！」の記録や 1 日の差し替えのたびに**副菜が黙って消える**。
 * `days` に無くなった日の主菜は消すが、その日の副菜は消さない
 * （主菜だけ外して副菜を残す操作が PR-4 で入るため、ここで先に潰さない）。
 */
export function applyDaysToSlots(
  days: readonly MenuPlanDayRow[],
  slots: readonly MenuPlanSlotRow[],
): MenuPlanSlotRow[] {
  const others = slots.filter((s) => s.slotId !== MAIN_SLOT_ID);
  return [...legacyPlanDaysToSlots(days), ...others];
}

/**
 * 1 枠に料理を入れる／差し替える（v20・PR-4）。同じ `(day, slotId)` があれば置き換える。
 *
 * **`doneAt` は引き継がない。** 別の料理に変えたのに「済み」が残ると、作っていない物が
 * 作ったことになる。`reason` は手で選んだので空（`reasonText` は空文字を出さない）。
 */
export function upsertSlotEntry(
  slots: readonly MenuPlanSlotRow[],
  entry: { day: number; slotId: string; recipeId: string; title: string },
): MenuPlanSlotRow[] {
  const next: MenuPlanSlotRow = { ...entry, reason: '', doneAt: null };
  const without = slots.filter((s) => !(s.day === entry.day && s.slotId === entry.slotId));
  return [...without, next];
}

/**
 * 手で入れた枠か（PR-5a）。**`reason === ''` かつ主菜以外**。
 * 自動で入れた行は `coverage:` / `expiry:` / `ai-new:` 等の理由を持ち、手入力（`upsertSlotEntry`）
 * だけが空文字を持つ — 既にある印を区別に使う。主菜は `days` が正なのでここでは扱わない
 */
export function isManualSlotEntry(row: Pick<MenuPlanSlotRow, 'slotId' | 'reason'>): boolean {
  return row.slotId !== MAIN_SLOT_ID && row.reason === '';
}

/**
 * 「組む」「作り直す」で**手入力の枠を引き継ぐ**（PR-5a・§10.15）。
 *
 * 新しいプランを組むと `slots` は空から始まり、手で入れた副菜が黙って消えていた。
 * 手入力＝利用者の意思、自動＝こちらの提案、の非対称なので確認ダイアログは挟まず、
 * 手入力だけを残して自動の行は作り直す。`doneAt` は引き継いだ行のものを保つ。
 * 要求日数より後ろの日の手入力も**消さない**（週ビューは行のある日を出すので見える。消すのは利用者）
 */
export function carryManualSlotEntries(prev: readonly MenuPlanSlotRow[]): MenuPlanSlotRow[] {
  return prev.filter(isManualSlotEntry);
}

/** 1 枠を空にする（料理を外す）。その日の他の枠は触らない */
export function removeSlotEntry(
  slots: readonly MenuPlanSlotRow[],
  day: number,
  slotId: string,
): MenuPlanSlotRow[] {
  return slots.filter((s) => !(s.day === day && s.slotId === slotId));
}

/**
 * 自動モードのローリングで、主菜以外の枠も同じだけ日番号を詰める（v20）。
 *
 * `rollMenuPlan` は生存日を 1 から振り直すが、詰めるのは `days`（主菜）だけ。
 * 枠をそのまま持ち回ると、**副菜だけ旧い日番号に残って別の日の主菜と並ぶ**
 * （1 日経つごとにずれ、落ちた日の副菜は day 1 に孤児として残る）。
 *
 * 落ちた日（`day <= droppedDays`）の枠は捨て、残りを `day - droppedDays` へ移す。
 * 主菜は `applyDaysToSlots` が `days` から作り直すので、ここでは触らなくてよい。
 */
export function rollMenuPlanSlots(
  slots: readonly MenuPlanSlotRow[],
  droppedDays: number,
): MenuPlanSlotRow[] {
  if (droppedDays <= 0) return [...slots];
  return slots.filter((s) => s.day > droppedDays).map((s) => ({ ...s, day: s.day - droppedDays }));
}
