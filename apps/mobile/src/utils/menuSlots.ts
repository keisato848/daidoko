/**
 * 枠（主菜・副菜・汁物…）の編集（S21・Track C PR-4）。**判断はここへ集約する。**
 *
 * `menu-plan.service.ts` は drizzle を動的 import するので jest で実行できない
 * （`docs/品質基準.md` §2.3）。「主菜を消せないこと」「同じ種類を 2 つ足したときの
 * ID の振り方」「並び順の詰め直し」といった、間違えると**同期先の端末で枠が重なる**
 * 判断を全部この純関数へ寄せる。
 *
 * 設計は `docs/買い物リスト・在庫設計.md` §10.14。
 */
import { MAIN_SLOT_ID } from './menuPlanStorage';
import type { WeekSlotSetting } from './menuWeek';

/** 枠の種類。`menu_slot_settings.slot_kind` と 1:1 */
export const SLOT_KINDS = ['main', 'side', 'soup', 'salad', 'dessert'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** 献立に必ずある枠。**消せない**（主菜の無い献立は献立ではない） */
export const REQUIRED_SLOT_KIND: SlotKind = 'main';

/**
 * 同じ種類を 2 つ目以降足したときの ID。`side` → `side-2` → `side-3`。
 *
 * **ID は同期の突合キー**（`menu_slot` の entityId は `<mealTime>:<slotId>`）なので、
 * 表示名ではなくここで決まる形を使う。
 *
 * **空き番号は使い回す**（`side-2` を消して足し直すとまた `side-2`）。手元の状態からは
 * 「昔 `side-2` があった」ことを知りようがないので、詰めない実装はできない。
 * 代わりに次を受け入れる: 2 台がオフラインで同じ枠を消し、片方だけ足し直すと、
 * **同じ ID に墓標と upsert が同時に飛ぶ**。収束は LWW（`incomingChangeWins`）任せで、
 * どちらか一方に落ち着く。枠の定義は数行の設定なので、取り違えても作り直せる
 * （献立の料理は `menu_plan_slots` 側にあり、枠の定義を失っても消えない）。
 */
export function nextSlotId(slots: readonly WeekSlotSetting[], kind: SlotKind): string {
  const used = new Set(slots.map((s) => s.slotId));
  if (!used.has(kind)) return kind;
  for (let n = 2; ; n += 1) {
    const candidate = `${kind}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** `position` を 0 から振り直す。並べ替え・削除のあとに必ず通す */
export function renumberSlots(slots: readonly WeekSlotSetting[]): WeekSlotSetting[] {
  return slots.map((s, index) => ({ ...s, position: index }));
}

/**
 * 枠を足す。**主菜は常に先頭**に置き、それ以外は末尾へ。
 * 文言は呼び出し側が渡す（純関数は `t()` を持たない・i18n 設計 §9）。
 */
export function addSlot(
  slots: readonly WeekSlotSetting[],
  kind: SlotKind,
  label: string,
): WeekSlotSetting[] {
  const next: WeekSlotSetting = {
    slotId: nextSlotId(slots, kind),
    slotKind: kind,
    label,
    position: 0,
  };
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  return renumberSlots(kind === REQUIRED_SLOT_KIND ? [next, ...ordered] : [...ordered, next]);
}

/**
 * 枠を消す。**主菜は消せない**（渡されても無視する）。
 *
 * 消しても `menu_plan_slots` の行は消さない — 献立に入っている料理が、枠の設定を
 * 変えただけで黙って消えるのは事故に見える。定義を失った行は週ビューが
 * `withUnknownSlots` で末尾に出し続ける。
 */
export function removeSlot(slots: readonly WeekSlotSetting[], slotId: string): WeekSlotSetting[] {
  if (slotId === MAIN_SLOT_ID)
    return renumberSlots([...slots].sort((a, b) => a.position - b.position));
  return renumberSlots(
    [...slots].sort((a, b) => a.position - b.position).filter((s) => s.slotId !== slotId),
  );
}

/**
 * 保存前の正規化。**主菜が無ければ先頭に足す**（同期で主菜だけ消えた状態を受け取っても、
 * 次に設定を開いた時点で直る）。重複した `slotId` は先勝ちで落とす。
 */
export function normalizeSlots(
  slots: readonly WeekSlotSetting[],
  mainLabel: string,
): WeekSlotSetting[] {
  const seen = new Set<string>();
  const unique = [...slots]
    .sort((a, b) => a.position - b.position)
    .filter((s) => {
      if (seen.has(s.slotId)) return false;
      seen.add(s.slotId);
      return true;
    });
  const hasMain = unique.some((s) => s.slotId === MAIN_SLOT_ID);
  const withMain = hasMain
    ? unique
    : [
        { slotId: MAIN_SLOT_ID, slotKind: REQUIRED_SLOT_KIND, label: mainLabel, position: 0 },
        ...unique,
      ];
  // 主菜は常に先頭（position をいじられていても描画順を安定させる）
  const main = withMain.filter((s) => s.slotId === MAIN_SLOT_ID);
  const rest = withMain.filter((s) => s.slotId !== MAIN_SLOT_ID);
  return renumberSlots([...main, ...rest]);
}

/**
 * どの枠を消せるか。UI がボタンを出すかどうかの判断もここで持つ
 * （画面側に `!== 'main'` を散らすと、足す側と消す側で規則がずれる）。
 */
export function canRemoveSlot(slotId: string): boolean {
  return slotId !== MAIN_SLOT_ID;
}
