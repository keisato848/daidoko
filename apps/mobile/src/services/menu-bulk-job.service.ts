/**
 * 一括生成の非同期ジョブ（R34・`docs/買い物リスト・在庫設計.md` §10.12.3）の読み書き。
 *
 * **判断はここに置かない**（`utils/menuBulkJob.ts` の純関数側。このファイルは jest で
 * 実行できない経路を含む — `docs/品質基準.md` §2.3）。ここがやるのは
 * 「控えを app_meta に置く・サーバーに聞く・結果を移す・受け取り済みを返す」だけ。
 *
 * 入口は 3 つあって、全部 `checkPendingMenuBulkJob()` に合流する:
 * 通知タップ（献立画面が開く → フォーカス）／献立画面のフォーカス／アプリ復帰（`_layout.tsx`）。
 * 通知が届かない環境（許可なし・iOS の APNs 未設定）でも、献立画面を開けば同じ結果が出る。
 */
import { getAppMeta, setAppMeta } from './app-meta.service';
import {
  ackMenuRecipesJob,
  fetchMenuRecipesJob,
  submitMenuRecipesJob,
  validateMenuRecipeDrafts,
  type MenuJobRequest,
  type MenuRecipeDraft,
} from './menu-recipes.provider';
import { ensureMenuChannel, getExpoPushTokenWithin } from './notification.service';
import { recordCloudInference } from './usage.service';
import {
  decideJobTransition,
  parsePendingMenuBulkJob,
  parsePendingMenuBulkResult,
  type MenuBulkJobPart,
  type PendingMenuBulkJob,
  type PendingMenuBulkResult,
} from '../utils/menuBulkJob';
import type { MenuMealTime } from '../utils/menuPlanStorage';

/** push トークンの取得を待つ上限。通知は「あれば嬉しい」側なので短く切る */
const PUSH_TOKEN_TIMEOUT_MS = 4000;

const PENDING_KEY = 'menu_bulk_job';
const RESULT_KEY = 'menu_bulk_result';

export type MenuBulkResult = PendingMenuBulkResult<MenuRecipeDraft>;

/** 同時に走らせない。フォーカスと復帰がほぼ同時に来るので、受け取りと消費が二重にならないように */
let checking: Promise<MenuBulkCheck> | null = null;

export type MenuBulkCheck =
  | { state: 'none' }
  | { state: 'pending'; job: PendingMenuBulkJob }
  | { state: 'ready'; result: MenuBulkResult }
  | { state: 'failed'; retryable: boolean }
  | { state: 'expired' };

export type SubmitMenuBulkResult =
  | { outcome: 'queued'; job: PendingMenuBulkJob }
  /** サーバーがジョブ経路を持たない。呼び出し側は従来の同期経路（主菜のみ）へ倒す */
  | { outcome: 'unsupported' };

/**
 * 投入して控える。**通知の許可はここで求める** — 利用者が「作って」と頼んだ直後なので、
 * 何のための通知かが伝わる（同期の push は許可を求めない方針のまま）。
 * 断られても投入はする（`hasPushToken: false` → 画面側が「戻ってきたら確認」を出す）。
 */
export async function submitMenuBulkJob(
  parts: readonly MenuBulkJobPart<MenuJobRequest>[],
  mealTime: MenuMealTime,
): Promise<SubmitMenuBulkResult> {
  await ensureMenuChannel();
  // **トークンの取得で投入を止めない。** FCM が応答しない端末では取得が返ってこない
  // （2026-09-19 エミュレータで検出 — ボタンのスピナーが回り続け、サーバーに何も届かなかった）。
  // 許可ダイアログは待つが、その後の取得は数秒で打ち切り、トークン無しで投入する
  const token = await getExpoPushTokenWithin(PUSH_TOKEN_TIMEOUT_MS).catch(() => null);
  const submitted = await submitMenuRecipesJob(parts, token);
  if (submitted.kind === 'unsupported') return { outcome: 'unsupported' };
  const job: PendingMenuBulkJob = {
    jobId: submitted.jobId,
    mealTime,
    submittedAt: new Date().toISOString(),
    hasPushToken: token !== null,
  };
  await setAppMeta(PENDING_KEY, JSON.stringify(job));
  return { outcome: 'queued', job };
}

/** いまの控え（あれば）。画面が「生成中」を出すかの判定に使う */
export async function getPendingMenuBulkJob(): Promise<PendingMenuBulkJob | null> {
  return parsePendingMenuBulkJob(await getAppMeta(PENDING_KEY), Date.now());
}

async function readResult(existingTitles: readonly string[]): Promise<MenuBulkResult | null> {
  const parsed = parsePendingMenuBulkResult(await getAppMeta(RESULT_KEY));
  if (!parsed) return null;
  // **受け取った時点の手持ち**で検証し直す。結果は何時間も後に届きうるので、その間に
  // 手で足したレシピと同名になっていることがある（半端な下書きもここで落ちる）
  const seen = [...existingTitles];
  const parts = parsed.parts.flatMap((part) => {
    const drafts = validateMenuRecipeDrafts({ recipes: part.drafts }, seen, part.drafts.length);
    seen.push(...drafts.map((d) => d.title)); // 種類をまたいだ同名も落とす
    return drafts.length > 0 ? [{ key: part.key, drafts }] : [];
  });
  if (parts.length === 0) return null;
  return { mealTime: parsed.mealTime, parts, failedKinds: parsed.failedKinds };
}

async function doCheck(existingTitles: readonly string[]): Promise<MenuBulkCheck> {
  // 先に「受け取り済みでまだ見ていない結果」を見る（シートを閉じる前にアプリが落ちたとき）
  const stored = await readResult(existingTitles);
  if (stored) return { state: 'ready', result: stored };

  const job = await getPendingMenuBulkJob();
  if (!job) return { state: 'none' };

  const transition = decideJobTransition(await fetchMenuRecipesJob(job.jobId));
  switch (transition.action) {
    case 'keep':
      return { state: 'pending', job };
    case 'expire':
      await setAppMeta(PENDING_KEY, '');
      return { state: 'expired' };
    case 'fail':
      await setAppMeta(PENDING_KEY, '');
      await ackMenuRecipesJob(job.jobId);
      return { state: 'failed', retryable: transition.retryable };
    case 'store': {
      // **端末に書いてから**受け取り済みを返す。逆順だと、書く前に落ちたとき結果を失う
      await setAppMeta(
        RESULT_KEY,
        JSON.stringify({ mealTime: job.mealTime, ...transition.result }),
      );
      await setAppMeta(PENDING_KEY, '');
      // 無料枠の消費は結果を受け取れたときに 1 回（サーバーの「成功時のみ」と同じ側に倒す）
      await recordCloudInference().catch(() => undefined);
      await ackMenuRecipesJob(job.jobId);
      const result = await readResult(existingTitles);
      return result ? { state: 'ready', result } : { state: 'failed', retryable: true };
    }
  }
}

/** 控えがあればサーバーに聞き、届いていれば結果を返す。どこから何度呼んでもよい */
export function checkPendingMenuBulkJob(
  existingTitles: readonly string[] = [],
): Promise<MenuBulkCheck> {
  checking ??= doCheck(existingTitles).finally(() => {
    checking = null;
  });
  return checking;
}

/** 提案シートを確定した・閉じた。持っていた結果を捨てる */
export async function discardMenuBulkResult(): Promise<void> {
  await setAppMeta(RESULT_KEY, '');
}
