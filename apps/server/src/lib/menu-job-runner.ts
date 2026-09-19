/**
 * 一括生成ジョブの実行（R34）。プロセス内の FIFO・同時 2 ジョブ・ジョブ内の part は並列。
 *
 * **Redis 等のキュー製品は使わない**（同期設計 §8 のコスト上限・月 $5 を崩す）。Railway は
 * 単一の永続プロセスなので、「SQLite に行を書く → プロセス内で拾う」で足りる。
 * 複数インスタンスには対応しない（rate-limit / quota-store / share-store と同じ既存の制約）。
 *
 * `startMenuJobRunner()` は **`index.ts` からだけ**呼ぶ。`app.ts` は副作用ゼロのまま —
 * テストと Lambda でタイマーを起こさない。ジョブの投入（`kickRunner`）はタイマーを持たないので
 * どこから呼んでもよい。
 */
import { eq, inArray } from 'drizzle-orm';

import { runMenuRecipesAgent } from '../agents/menu-recipes.agent.js';
import { sendExpoPush, type ExpoPushMessage } from './expo-push.js';
import { QUOTA_CATEGORY, resolveMenuRecipesProvider } from './infer-guards.js';
import {
  MENU_JOB_DEADLINE_MS,
  MENU_JOB_RESULT_TTL_MS,
  failedJobPatch,
  getMenuJobDb,
  menuJobs,
  nextQueuedJob,
  sweepMenuJobs,
  type MenuJobRow,
} from './menu-job-store.js';
import type { MenuRecipeDraft, MenuRecipesInput } from './menu-recipes.js';
import { recordMonthlyUse } from './quota-store.js';

const MAX_CONCURRENT_JOBS = 2;
/** 再起動をまたいだ実行回数の上限。2 回目も落ちたら諦める（Gemini 費用は最大 2 倍・稀） */
const MAX_ATTEMPTS = 2;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export interface MenuJobPartInput {
  key: string;
  request: MenuRecipesInput;
}

export type MenuJobPartResult =
  | { key: string; ok: true; recipes: MenuRecipeDraft[] }
  | { key: string; ok: false; error: { code: string; message: string; retryable: boolean } };

let active = 0;
let sweepTimer: NodeJS.Timeout | null = null;
const inflight = new Set<Promise<void>>();

/**
 * 完了・失敗の通知。**内容（料理名など）を載せない** — 通知一覧に残るので、同期の push と同じ規律。
 * 題名は固定。一部の part だけ失敗したときも done の文言（画面側で「副菜は作れませんでした」を出す）。
 */
export function buildMenuJobPush(
  to: string,
  locale: string | null,
  jobId: string,
  status: 'done' | 'failed',
): ExpoPushMessage {
  const en = locale === 'en';
  const body =
    status === 'done'
      ? en
        ? 'Your menu recipes are ready. Open to review.'
        : '献立のレシピができました。開いて確認してください'
      : en
        ? "We couldn't create your menu recipes. Open to try again."
        : '献立のレシピを作れませんでした。開いてもう一度お試しください';
  return {
    to,
    title: en ? 'DAIDOKO' : 'だいどこ',
    body,
    // `type: 'menu'` は毎朝の献立通知と同じ。タップ先が同じ献立画面なので、アプリ側の
    // 既存の受け口（addMenuTapListener / consumeMenuLaunchTap）がそのまま効く
    data: { type: 'menu', jobId, status },
    channelId: 'menu',
    priority: 'high',
  };
}

async function notify(job: MenuJobRow, status: 'done' | 'failed'): Promise<void> {
  if (!job.expoPushToken) return;
  // push の失敗はジョブの失敗にしない。結果は献立画面を開けば取れる（設計 §5）
  await sendExpoPush([buildMenuJobPush(job.expoPushToken, job.locale, job.id, status)]).catch(
    () => undefined,
  );
}

function parseParts(inputJson: string | null): MenuJobPartInput[] {
  if (!inputJson) return [];
  const raw: unknown = JSON.parse(inputJson);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is MenuJobPartInput =>
      typeof p === 'object' &&
      p !== null &&
      typeof (p as { key?: unknown }).key === 'string' &&
      typeof (p as { request?: unknown }).request === 'object',
  );
}

/** 1 part を走らせる。**投げない** — 失敗も結果として返す（他の part を巻き込まない） */
async function runPart(part: MenuJobPartInput, deadlineAt: number): Promise<MenuJobPartResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<'TIMEOUT'>((resolve) => {
      timer = setTimeout(() => resolve('TIMEOUT'), Math.max(0, deadlineAt - Date.now()));
    });
    const result = await Promise.race([
      runMenuRecipesAgent(part.request, resolveMenuRecipesProvider()),
      timeout,
    ]);
    if (result === 'TIMEOUT') {
      return {
        key: part.key,
        ok: false,
        error: { code: 'TIMEOUT', message: '時間内に終わりませんでした', retryable: true },
      };
    }
    if (!result.ok) {
      return {
        key: part.key,
        ok: false,
        error: {
          code: result.error?.code ?? 'UNKNOWN',
          message: result.error?.message ?? 'UNKNOWN',
          retryable: result.error?.retryable === true,
        },
      };
    }
    return { key: part.key, ok: true, recipes: result.data?.recipes ?? [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'UNKNOWN';
    return { key: part.key, ok: false, error: { code: 'UNKNOWN', message, retryable: true } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function processJob(job: MenuJobRow): Promise<void> {
  const db = getMenuJobDb();
  const startedAt = Date.now();
  let parts: MenuJobPartResult[] = [];
  try {
    const inputs = parseParts(job.inputJson);
    parts = await Promise.all(inputs.map((p) => runPart(p, startedAt + MENU_JOB_DEADLINE_MS)));
  } catch {
    parts = []; // 入力が壊れていた。全滅として閉じる
  }

  const now = Date.now();
  const anyOk = parts.some((p) => p.ok);
  const firstError = parts.find(
    (p): p is Extract<MenuJobPartResult, { ok: false }> => !p.ok,
  )?.error;

  if (anyOk) {
    db.update(menuJobs)
      .set({
        status: 'done',
        resultJson: JSON.stringify({ parts }),
        inputJson: null, // 在庫名・嗜好メモは結果が出たら要らない
        finishedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + MENU_JOB_RESULT_TTL_MS).toISOString(),
      })
      .where(eq(menuJobs.id, job.id))
      .run();
    // **消費は成功時だけ・1 ジョブ 1 回**（part の数で掛けない。「一括 = 無料枠 1 回分」§10.12）
    if (!job.bypassQuota) recordMonthlyUse(job.deviceId, QUOTA_CATEGORY);
  } else {
    db.update(menuJobs)
      .set(failedJobPatch(firstError?.code ?? 'UNKNOWN', firstError?.retryable ?? true, now))
      .where(eq(menuJobs.id, job.id))
      .run();
  }

  await notify(job, anyOk ? 'done' : 'failed');
  db.update(menuJobs).set({ expoPushToken: null }).where(eq(menuJobs.id, job.id)).run();

  // 内容は出さない（同期設計 §0-2）。id・状態・件数・時間だけ
  process.stdout.write(
    `[menu-jobs] id=${job.id} status=${anyOk ? 'done' : 'failed'} parts=${parts.length} ms=${now - startedAt}\n`,
  );
}

/** 空きがあれば queued を拾って走らせる。どこから何度呼んでもよい */
export function kickRunner(): void {
  while (active < MAX_CONCURRENT_JOBS) {
    const job = nextQueuedJob();
    if (!job) return;
    getMenuJobDb()
      .update(menuJobs)
      .set({
        status: 'running',
        attempts: job.attempts + 1,
        startedAt: new Date().toISOString(),
      })
      .where(eq(menuJobs.id, job.id))
      .run();
    active += 1;
    const run = processJob(job)
      .catch(() => undefined)
      .finally(() => {
        active -= 1;
        inflight.delete(run);
        kickRunner();
      });
    inflight.add(run);
  }
}

/**
 * 起動時の回収。前のプロセスが残した queued / running を拾い直す。
 * **実行回数（attempts）が上限未満なら 1 回だけ再実行**、それ以外は RESTARTED で閉じて知らせる。
 * attempts は `kickRunner` が走らせるときに増やすので、ここでは増やさない（二重に数えない）。
 */
export async function recoverMenuJobs(): Promise<void> {
  const db = getMenuJobDb();
  const stale = db
    .select()
    .from(menuJobs)
    .where(inArray(menuJobs.status, ['queued', 'running']))
    .all();
  for (const job of stale) {
    if (job.attempts < MAX_ATTEMPTS) {
      db.update(menuJobs)
        .set({ status: 'queued', startedAt: null })
        .where(eq(menuJobs.id, job.id))
        .run();
      continue;
    }
    db.update(menuJobs)
      .set(failedJobPatch('RESTARTED', true, Date.now()))
      .where(eq(menuJobs.id, job.id))
      .run();
    await notify(job, 'failed');
  }
}

/** プロセス起動時に 1 回。`index.ts` からだけ呼ぶ */
export function startMenuJobRunner(): void {
  sweepMenuJobs();
  void recoverMenuJobs().then(kickRunner);
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = setInterval(() => {
    try {
      sweepMenuJobs();
    } catch {
      // 次の周期でやり直す。sweep の失敗でプロセスを落とさない
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

/** テスト用: 走っているジョブが全部終わるまで待つ */
export async function drainForTesting(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight]);
}
