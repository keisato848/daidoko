/**
 * 週ビュー（S20・Track C PR-3）の組み立て。**判断はここへ集約する。**
 *
 * `menu-plan.service.ts` は drizzle を動的 import するので **jest で実行できない**
 * （`docs/品質基準.md` §2.3）。日付の割り当て・枠の並べ方・「今日」の判定といった
 * 間違えると画面が嘘をつく判断を、全部この純関数へ寄せてテストで固定する。
 *
 * 設計は `docs/reviews/menu-track-design-2026-09-16.md` §4。
 * 実装時に確定させた未決 3 件（受付票が Phase 2 の実装判断へ委ねたもの）:
 * - 日数チップ（2/3/5/7）は**残す**（受付票 #9）
 * - **今週ぶんだけ出す**（来週は献立が組まれていないことが大半で、スクロールが増えるだけ）
 * - **7 日が 1 画面に収まらないのは許容し、縦スクロールさせる**。1 画面に押し込むと
 *   1 行が薄くなって副菜が読めない（ペルソナのりこ=老眼の観点で可読性を優先）
 */
import { menuDateKey } from './menuPlan';

/** `menu_plan_slots` の 1 行（`planId` を除く）。`menuPlanStorage.MenuPlanSlotRow` と同じ形 */
export interface WeekSlotRow {
  day: number;
  slotId: string;
  recipeId: string;
  title: string;
  reason: string;
  doneAt: string | null;
}

/** `menu_slot_settings` の 1 行。設定が無い時間帯は「main が 1 枠だけ」扱い */
export interface WeekSlotSetting {
  slotId: string;
  slotKind: string;
  label: string;
  position: number;
  /**
   * 自動で埋めるか（PR-5a）。**false = 手入力専用**（M1「組む」と日次ローリングが飛ばす。M3 は枠を見ない）。
   * 省略は true（v20 の行・既定枠）。列は PR-1 からあったが読む側が無かった
   */
  autoFill?: boolean;
}

/**
 * 枠が未設定のときに使う既定の枠の ID。**献立は必ず主菜から始まる**。
 * 既定枠の**文言は呼び出し側が渡す** — ここは純関数で `t()` を持たない（i18n 設計 §9）。
 */
export const DEFAULT_SLOT_ID = 'main';

export interface WeekSlotCell {
  slotId: string;
  slotKind: string;
  label: string;
  /** その枠に入っている献立。まだ決まっていなければ null */
  entry: { recipeId: string; title: string; reason: string; doneAt: string | null } | null;
}

export interface WeekDayRow {
  /** 1 始まりの日番号（保存形のキー） */
  day: number;
  /** 暦日 `YYYY-MM-DD`。`anchorDate` が無い手動プランでは null */
  dateKey: string | null;
  /** 今日か。`anchorDate` が無いプランでは**常に false**（日付が無いので判定できない） */
  isToday: boolean;
  /** 枠の並び（`position` 昇順）。空の枠も**行として出す**（「まだ決めていない」が見えるように） */
  slots: WeekSlotCell[];
}

/**
 * 枠の定義を並べる。未設定なら主菜 1 枠だけにする（文言は `defaultLabel` で受け取る）。
 *
 * **同じ `slotId` が重複していたら後ろを捨てる** — 同期で両端末が別々に足すと
 * 起こりうる。重複したまま描くと同じ枠が 2 行出て、どちらに入れたのか分からなくなる。
 */
export function orderedSlots(
  settings: readonly WeekSlotSetting[],
  defaultLabel: string,
): WeekSlotSetting[] {
  if (settings.length === 0) {
    return [{ slotId: DEFAULT_SLOT_ID, slotKind: 'main', label: defaultLabel, position: 0 }];
  }
  const seen = new Set<string>();
  return [...settings]
    .sort((a, b) => a.position - b.position)
    .filter((s) => {
      if (seen.has(s.slotId)) return false;
      seen.add(s.slotId);
      return true;
    });
}

/**
 * 日番号 → 暦日。`anchorDate`（自動モードの起点）がある献立だけ日付を持つ。
 *
 * 手動プランは日付を持たない仕様（§10.6）なので null を返す。**null を「今日」に
 * 倒さないこと** — 日付が無いのに「今日」を光らせると、実際には違う日の献立を
 * 今日として見せることになる。
 */
export function dateKeyForDay(anchorDate: string | null, day: number): string | null {
  if (!anchorDate) return null;
  const anchor = new Date(`${anchorDate}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) return null;
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + (day - 1));
  return menuDateKey(d);
}

/**
 * 献立の行にあるのに枠の定義が無い `slotId` を、末尾の枠として足す。
 *
 * **定義に無い枠を黙って落とすと、画面が嘘をつく。** 同期は献立（`menu_plan`）と
 * 枠の定義（`menu_slot`）を別の実体として送るので、**副菜の行だけ先に届く**ことがある。
 * 落とすとその副菜は表示されないうえ、`isDayDone` の数にも入らないので
 * 「副菜が残っているのに済み」になる。ラベルは引ける名前が無いので `slotId` を出す —
 * 見慣れない名前が出る方が、作る物が消えるよりましである。
 */
function withUnknownSlots(
  defs: readonly WeekSlotSetting[],
  rows: readonly WeekSlotRow[],
): { defs: WeekSlotSetting[]; unknownIds: ReadonlySet<string> } {
  const known = new Set(defs.map((d) => d.slotId));
  const unknownIds = new Set<string>();
  const extra: WeekSlotSetting[] = [];
  for (const row of rows) {
    if (known.has(row.slotId)) continue;
    known.add(row.slotId);
    unknownIds.add(row.slotId);
    extra.push({
      slotId: row.slotId,
      slotKind: 'side',
      label: row.slotId,
      position: Number.MAX_SAFE_INTEGER,
    });
  }
  return { defs: [...defs, ...extra], unknownIds };
}

/** 週ビューに出す日数の上限。7 日を超える献立も、今週ぶんだけ出す */
export const WEEK_MAX_DAYS = 7;

/**
 * 週ビューの行を組み立てる。
 *
 * - 日番号の昇順。**`requestedDays` ではなく実際にある行から組む**（不足していても
 *   ある日だけ出す。空の週を出すより、途中まででも見えた方がよい）
 * - 枠は `orderedSlots` の順。その日にその枠の行が無ければ `entry: null`
 * - **同じ (day, slotId) が重複していたら先勝ち**（同期の LWW で理論上ありうる）
 */
export function buildWeekRows(args: {
  slots: readonly WeekSlotRow[];
  settings: readonly WeekSlotSetting[];
  anchorDate: string | null;
  today: Date;
  /** 枠が未設定のときに使う既定枠の文言（`t('menu.slot.main')`） */
  defaultSlotLabel: string;
}): WeekDayRow[] {
  const { defs: slotDefs, unknownIds } = withUnknownSlots(
    orderedSlots(args.settings, args.defaultSlotLabel),
    args.slots,
  );
  const todayKey = menuDateKey(args.today);

  const byDay = new Map<number, Map<string, WeekSlotRow>>();
  for (const row of args.slots) {
    if (!Number.isInteger(row.day) || row.day < 1) continue;
    let forDay = byDay.get(row.day);
    if (!forDay) {
      forDay = new Map();
      byDay.set(row.day, forDay);
    }
    if (!forDay.has(row.slotId)) forDay.set(row.slotId, row);
  }

  return [...byDay.keys()]
    .sort((a, b) => a - b)
    .slice(0, WEEK_MAX_DAYS)
    .map((day) => {
      const forDay = byDay.get(day);
      const dateKey = dateKeyForDay(args.anchorDate, day);
      return {
        day,
        dateKey,
        isToday: dateKey !== null && dateKey === todayKey,
        slots: slotDefs.flatMap((def) => {
          const row = forDay?.get(def.slotId);
          // **定義に無い枠は、料理が入っている日にだけ出す。** 定義が無い＝設定から
          // 消された枠なので、空の行を全日に並べても入れる先が無く、雑音にしかならない
          // （消した副菜の空行が 7 日ぶん並ぶ）。入っている料理は消さずに出し続ける
          if (row === undefined && unknownIds.has(def.slotId)) return [];
          return {
            slotId: def.slotId,
            slotKind: def.slotKind,
            label: def.label,
            entry: row
              ? {
                  recipeId: row.recipeId,
                  title: row.title,
                  reason: row.reason,
                  doneAt: row.doneAt,
                }
              : null,
          };
        }),
      };
    });
}

/**
 * その日が「作り終わった」か。**枠が 1 つでも残っていれば未完了**。
 *
 * 主菜だけ作って副菜を作っていない日を「済み」にすると、家族には作り終わったように
 * 見えて残りが伝わらない。空の枠（そもそも決めていない）は数に入れない。
 */
export function isDayDone(row: WeekDayRow): boolean {
  const filled = row.slots.filter((s) => s.entry !== null);
  if (filled.length === 0) return false;
  return filled.every((s) => s.entry?.doneAt != null);
}

/** 週ぜんたいの進み具合（済んだ日 / 献立がある日）。見出しの「3/7 日」に使う */
export function weekProgress(rows: readonly WeekDayRow[]): { done: number; total: number } {
  const withEntries = rows.filter((r) => r.slots.some((s) => s.entry !== null));
  return { done: withEntries.filter(isDayDone).length, total: withEntries.length };
}
