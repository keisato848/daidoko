/**
 * 一括生成ジョブの保存先（R34・`docs/買い物リスト・在庫設計.md` §10.12.3）。
 *
 * `quota-store.ts` と同じ作り（better-sqlite3 + drizzle・Railway のボリューム `/data`）。
 * **メモリではなくファイルに置く**のは、再デプロイで走行中のジョブが黙って消えるのを避けるため —
 * 行が残っていれば、起動時に 1 回だけ再実行できる（`menu-job-runner.ts` の回収）。
 *
 * 保持の上限を**行ごとの `expires_at`** で持つ（プライバシーポリシー §3.2 の「最長 24 時間」の根拠）:
 * - 受理〜実行中: 作成から 30 分（走り切れなかった行を残さない）
 * - 完了・失敗: 完了から 24 時間（寝ている間に終わっても朝に受け取れる）。受け取り（DELETE）で即削除
 * - 入力（在庫名・嗜好メモ）は完了時に NULL、push トークンは送信後に NULL
 */
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** ジョブ全体の締め切り。Gemini 1 呼び出しの最悪が約 4.2 分（60 秒 × 4 回＋バックオフ）なので余裕を見る */
export const MENU_JOB_DEADLINE_MS = 8 * 60 * 1000;
/** 受理〜実行中の行の寿命 */
export const MENU_JOB_PENDING_TTL_MS = 30 * 60 * 1000;
/** 完了・失敗した行の寿命（受け取りに来なかったときの上限） */
export const MENU_JOB_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
/** sweep が「走りっぱなし」と見なすまでの猶予（締め切り＋ 5 分） */
const STUCK_RUNNING_MS = MENU_JOB_DEADLINE_MS + 5 * 60 * 1000;

export type MenuJobStatus = 'queued' | 'running' | 'done' | 'failed';

export const menuJobs = sqliteTable('menu_jobs', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull(),
  status: text('status').$type<MenuJobStatus>().notNull(),
  inputJson: text('input_json'),
  resultJson: text('result_json'),
  errorCode: text('error_code'),
  errorRetryable: integer('error_retryable', { mode: 'boolean' }),
  expoPushToken: text('expo_push_token'),
  locale: text('locale'),
  bypassQuota: integer('bypass_quota', { mode: 'boolean' }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  expiresAt: text('expires_at').notNull(),
});

export type MenuJobRow = typeof menuJobs.$inferSelect;

const DDL = `
CREATE TABLE IF NOT EXISTS menu_jobs (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_retryable INTEGER,
  expo_push_token TEXT,
  locale TEXT,
  bypass_quota INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_jobs_device ON menu_jobs(device_id, status);
`;

function resolveDbPath(): string {
  const fromEnv = process.env['INFER_JOBS_DB_PATH'];
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  if (fs.existsSync('/data')) return '/data/jobs.db';
  return path.join('.data', 'jobs.db');
}

let handle: { sqlite: Database.Database; db: BetterSQLite3Database } | null = null;

export function getMenuJobDb(): BetterSQLite3Database {
  if (handle) return handle.db;
  const dbPath = resolveDbPath();
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  handle = { sqlite, db: drizzle(sqlite) };
  return handle.db;
}

/** テスト用: 接続を閉じて作り直す（`:memory:` は接続ごとに空になる） */
export function resetMenuJobStoreForTesting(): void {
  handle?.sqlite.close();
  handle = null;
}

/** 失敗として閉じるときの共通の更新値。入力とトークンはここで必ず落とす */
export function failedJobPatch(
  code: string,
  retryable: boolean,
  now: number,
): Partial<typeof menuJobs.$inferInsert> {
  return {
    status: 'failed',
    resultJson: null,
    errorCode: code,
    errorRetryable: retryable,
    inputJson: null,
    expoPushToken: null,
    finishedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MENU_JOB_RESULT_TTL_MS).toISOString(),
  };
}

/**
 * 期限切れを消し、走りっぱなしの行を TIMEOUT で閉じる。
 * 起動時・10 分ごと・受理時に呼ぶ（`setInterval` は runner 側。ここは副作用を時計に縛らない）。
 */
export function sweepMenuJobs(now = Date.now()): void {
  const db = getMenuJobDb();
  db.delete(menuJobs)
    .where(lt(menuJobs.expiresAt, new Date(now).toISOString()))
    .run();
  db.update(menuJobs)
    .set(failedJobPatch('TIMEOUT', true, now))
    .where(
      and(
        eq(menuJobs.status, 'running'),
        lt(menuJobs.startedAt, new Date(now - STUCK_RUNNING_MS).toISOString()),
      ),
    )
    .run();
}

/** 同じ端末の、まだ終わっていないジョブ（二重投入の判定用） */
export function findActiveJobForDevice(deviceId: string): MenuJobRow | undefined {
  return getMenuJobDb()
    .select()
    .from(menuJobs)
    .where(and(eq(menuJobs.deviceId, deviceId), inArray(menuJobs.status, ['queued', 'running'])))
    .orderBy(asc(menuJobs.createdAt))
    .get();
}

/** 次に走らせる行（古い順） */
export function nextQueuedJob(): MenuJobRow | undefined {
  return getMenuJobDb()
    .select()
    .from(menuJobs)
    .where(eq(menuJobs.status, 'queued'))
    .orderBy(asc(menuJobs.createdAt))
    .get();
}
