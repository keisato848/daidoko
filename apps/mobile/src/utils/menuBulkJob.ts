/**
 * 一括生成の非同期ジョブ（R34）と、枠つきの一括生成（Track C PR-5b）の**判断**。
 *
 * サービス層（`menu-bulk-job.service.ts`）は動的 import で DB を触るので jest で実行できない
 * （`docs/品質基準.md` §2.3）。だから「どの part を頼むか」「届いた結果をどう扱うか」
 * 「どの枠へ入れるか」はここに置き、サービスは読み書きだけにする。
 *
 * 流れ: 投入 → `app_meta.menu_bulk_job` に控える → 画面を閉じてよい → 通知タップ／献立画面の
 * フォーカス／アプリ復帰のどれからでも同じ `checkPending` に合流 → 結果を
 * `app_meta.menu_bulk_result` へ移してサーバーへ受け取り済みを返す → 提案シート。
 */
import type { MenuMealTime, MenuPlanSlotRow } from './menuPlanStorage';

/** サーバーへ頼む 1 回ぶん。`key` は結果を突き合わせる鍵で、枠の種類（`main` / `side` …）と同じ文字列 */
export interface MenuBulkJobPart<TRequest> {
  key: string;
  request: TRequest;
}

/** 1 ジョブの part の上限（サーバー `MAX_MENU_JOB_PARTS` と同じ）。主菜＋枠の種類 3 つまで */
export const MENU_BULK_MAX_PARTS = 4;
/** 1 part で頼める品数の上限（サーバー `MAX_MENU_RECIPES_DAYS` と同じ） */
export const MENU_BULK_MAX_PER_PART = 7;
/** 控えの寿命。サーバーの結果の寿命（完了から 24 時間）＋受理〜実行中の 30 分 */
export const MENU_BULK_PENDING_TTL_MS = 24.5 * 60 * 60 * 1000;

const MAIN_KIND = 'main';

/** 枠の定義のうち、ここで要る分だけ（`WeekSlotSetting` が構造的に合う） */
export interface BulkSlotDef {
  slotId: string;
  slotKind: string;
  autoFill?: boolean;
}

function fillableDefs(slotDefs: readonly BulkSlotDef[]): BulkSlotDef[] {
  return slotDefs.filter(
    (d) => d.slotId !== MAIN_KIND && d.slotKind !== MAIN_KIND && d.autoFill !== false,
  );
}

/**
 * 種類ごとの「空いている (day, 枠)」の数。**自動で埋める枠だけ**数える（手入力専用の枠は頼まない）。
 * `totalDays` は献立の日数（不足ぶんを足した後＝要求日数）。
 */
export function emptySlotCountsByKind(args: {
  totalDays: number;
  slotDefs: readonly BulkSlotDef[];
  existingSlots: readonly Pick<MenuPlanSlotRow, 'day' | 'slotId'>[];
}): Record<string, number> {
  const filled = new Set(args.existingSlots.map((s) => `${s.day}:${s.slotId}`));
  const counts: Record<string, number> = {};
  for (const def of fillableDefs(args.slotDefs)) {
    for (let day = 1; day <= args.totalDays; day += 1) {
      if (filled.has(`${day}:${def.slotId}`)) continue;
      counts[def.slotKind] = (counts[def.slotKind] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * 頼む part を組む。主菜（不足日数ぶん）＋ 空きのある種類ごとに 1 part。
 *
 * - 同じ種類の枠が 2 つあっても part は種類ごとに 1 つ（品数を足す）
 * - 1 part は 7 品まで・全体で 4 part まで。**超えた種類は定義順で後ろを落とす**
 *   （落ちた枠は空のまま。次の「まとめて作る」で埋まる）
 * - 主菜以外には `slotKind` と「合わせる主菜」を付ける。主菜には付けない —
 *   旧サーバーと同じ要求の形を保つ
 */
export function bulkJobParts<TBase extends object>(args: {
  shortfallDays: number;
  emptyCountsByKind: Readonly<Record<string, number>>;
  slotDefs: readonly BulkSlotDef[];
  baseRequest: TBase;
  mainTitles: readonly string[];
}): MenuBulkJobPart<TBase & { days: number; slotKind?: string; mainTitles?: string[] }>[] {
  const parts: MenuBulkJobPart<
    TBase & { days: number; slotKind?: string; mainTitles?: string[] }
  >[] = [];
  if (args.shortfallDays > 0) {
    parts.push({
      key: MAIN_KIND,
      request: {
        ...args.baseRequest,
        days: Math.min(args.shortfallDays, MENU_BULK_MAX_PER_PART),
      },
    });
  }
  const seen = new Set<string>();
  const mainTitles = args.mainTitles.slice(0, MENU_BULK_MAX_PER_PART);
  for (const def of fillableDefs(args.slotDefs)) {
    if (parts.length >= MENU_BULK_MAX_PARTS) break;
    if (seen.has(def.slotKind)) continue;
    seen.add(def.slotKind);
    const count = args.emptyCountsByKind[def.slotKind] ?? 0;
    if (count <= 0) continue;
    parts.push({
      key: def.slotKind,
      request: {
        ...args.baseRequest,
        days: Math.min(count, MENU_BULK_MAX_PER_PART),
        slotKind: def.slotKind,
        ...(mainTitles.length > 0 ? { mainTitles } : {}),
      },
    });
  }
  return parts;
}

/**
 * 保存した新レシピを、空いている枠へ**日番号順に 1 品ずつ**入れる。
 *
 * - 既に料理が入っている枠は触らない（手入力・蔵書庫からの自動を上書きしない）
 * - 手入力専用（autoFill:false）の枠には入れない
 * - `reason` は `ai-new:`（主菜の `fillMenuPlanShortfall` と同じ印）。**空文字にしない** —
 *   空文字は手入力の印（`isManualSlotEntry`）で、次の「組む」で引き継がれてしまう
 * - 余ったレシピは蔵書庫に残るだけ（捨てない）
 */
export function assignGeneratedToSlots(args: {
  totalDays: number;
  slotDefs: readonly BulkSlotDef[];
  existingSlots: readonly Pick<MenuPlanSlotRow, 'day' | 'slotId'>[];
  createdByKind: Readonly<Record<string, readonly { recipeId: string; title: string }[]>>;
}): MenuPlanSlotRow[] {
  const filled = new Set(args.existingSlots.map((s) => `${s.day}:${s.slotId}`));
  const queues = new Map(
    Object.entries(args.createdByKind).map(([kind, list]) => [kind, [...list]]),
  );
  const out: MenuPlanSlotRow[] = [];
  for (let day = 1; day <= args.totalDays; day += 1) {
    for (const def of fillableDefs(args.slotDefs)) {
      const key = `${day}:${def.slotId}`;
      if (filled.has(key)) continue;
      const pick = queues.get(def.slotKind)?.shift();
      if (!pick) continue;
      filled.add(key);
      out.push({
        day,
        slotId: def.slotId,
        recipeId: pick.recipeId,
        title: pick.title,
        reason: 'ai-new:',
        doneAt: null,
      });
    }
  }
  return out;
}

// ─── 端末側の控え（app_meta）────────────────────────────────────────────────

/** 投入したジョブの控え（`app_meta.menu_bulk_job`） */
export interface PendingMenuBulkJob {
  jobId: string;
  mealTime: MenuMealTime;
  submittedAt: string;
  /** 通知を頼めたか。偽なら「戻ってきたらここで確認してください」を出す */
  hasPushToken: boolean;
}

const MEAL_TIMES: readonly string[] = ['breakfast', 'lunch', 'dinner'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 壊れた値・古すぎる控えは null（＝「生成中」を出し続けない） */
export function parsePendingMenuBulkJob(
  raw: string | null,
  now: number,
): PendingMenuBulkJob | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { jobId, mealTime, submittedAt, hasPushToken } = value;
  if (typeof jobId !== 'string' || jobId === '') return null;
  if (typeof mealTime !== 'string' || !MEAL_TIMES.includes(mealTime)) return null;
  if (typeof submittedAt !== 'string') return null;
  const at = Date.parse(submittedAt);
  if (Number.isNaN(at) || now - at > MENU_BULK_PENDING_TTL_MS) return null;
  return {
    jobId,
    mealTime: mealTime as MenuMealTime,
    submittedAt,
    hasPushToken: hasPushToken === true,
  };
}

/** 受け取った結果（`app_meta.menu_bulk_result`）。提案シートを閉じるまで持つ */
export interface PendingMenuBulkResult<TDraft> {
  mealTime: MenuMealTime;
  /** 成功した part だけ。`key` は枠の種類 */
  parts: { key: string; drafts: TDraft[] }[];
  /** 作れなかった種類（「副菜は作れませんでした」を出す） */
  failedKinds: string[];
}

/** `drafts` の中身の検証は呼び出し側（`validateMenuRecipeDrafts`）。ここは入れ物の形だけ見る */
export function parsePendingMenuBulkResult(
  raw: string | null,
): PendingMenuBulkResult<unknown> | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { mealTime, parts, failedKinds } = value;
  if (typeof mealTime !== 'string' || !MEAL_TIMES.includes(mealTime)) return null;
  if (!Array.isArray(parts)) return null;
  const okParts = parts.flatMap((p) =>
    isRecord(p) && typeof p['key'] === 'string' && Array.isArray(p['drafts'])
      ? [{ key: p['key'], drafts: p['drafts'] as unknown[] }]
      : [],
  );
  return {
    mealTime: mealTime as MenuMealTime,
    parts: okParts,
    failedKinds: Array.isArray(failedKinds)
      ? failedKinds.filter((k): k is string => typeof k === 'string')
      : [],
  };
}

// ─── サーバーの返事をどう扱うか ─────────────────────────────────────────────

/** `fetchMenuRecipesJob` の結果（provider が HTTP をこの形へ畳む） */
export type MenuJobFetchResult<TDraft> =
  | { kind: 'pending' }
  | {
      kind: 'done';
      parts: ({ key: string; ok: true; recipes: TDraft[] } | { key: string; ok: false })[];
    }
  | { kind: 'failed'; retryable: boolean }
  /** 404。期限切れ・受け取り済み・別の端末の jobId */
  | { kind: 'gone' }
  /** 通信できなかった。控えは消さない（次の機会にもう一度聞く） */
  | { kind: 'unreachable' };

export type MenuJobTransition<TDraft> =
  | { action: 'keep' }
  | { action: 'store'; result: Omit<PendingMenuBulkResult<TDraft>, 'mealTime'> }
  | { action: 'fail'; retryable: boolean }
  | { action: 'expire' };

/**
 * 返事 → 次の一手。
 * - done でも**成功した part が 1 つも無ければ失敗**（サーバーは 1 つでも成功なら done にするが、
 *   防御として見る。空の提案シートを開かない）
 * - 通信できないときは控えを残す。404 は消す（消さないと「生成中」が永久に出る）
 */
export function decideJobTransition<TDraft>(
  response: MenuJobFetchResult<TDraft>,
): MenuJobTransition<TDraft> {
  switch (response.kind) {
    case 'pending':
    case 'unreachable':
      return { action: 'keep' };
    case 'gone':
      return { action: 'expire' };
    case 'failed':
      return { action: 'fail', retryable: response.retryable };
    case 'done': {
      const parts = response.parts.flatMap((p) =>
        p.ok && p.recipes.length > 0 ? [{ key: p.key, drafts: p.recipes }] : [],
      );
      if (parts.length === 0) return { action: 'fail', retryable: true };
      const okKeys = new Set(parts.map((p) => p.key));
      const failedKinds = response.parts.map((p) => p.key).filter((k) => !okKeys.has(k));
      return { action: 'store', result: { parts, failedKinds } };
    }
  }
}
