/**
 * AI 推論の月次無料枠 — 端末単位・全体枠。docs/買い物リスト・在庫設計.md §10.10.1、
 * §10.10.7-1（2026-08-28 決定: 全体枠・N=5・env は INFER_MONTHLY_FREE_LIMIT /
 * INFER_QUOTA_DB_PATH）。`category` は 'infer' 一本
 * （§10.10.1 が想定していた 'menu' 専用カウンタは過渡案なので使わない）。
 *
 * `share-store.ts` の写し（better-sqlite3・Railway ボリューム）。in-memory にしない
 * 理由も同じ — 月次窓は Railway 再デプロイをまたぐ必要がある。
 *
 * - `x-device-id` は乱数のインストール UUID（個人情報ではない）。**認証が無い以上
 *   ソフトな上限**（自己申告・再インストールでリセット）——現行フリーミアム
 *   （端末ローカル app_meta カウント）と同じ信頼水準であり後退ではない
 * - 消費は provider 成功時のみ（`recordMonthlyUse`）。失敗で 1 回溶かすのが
 *   一番たちが悪い（N が小さいため）
 * - month は UTC の 'YYYY-MM'（日本では月末 9 時間前にリセットされる）
 */
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const deviceMonthlyUsage = sqliteTable(
  'device_monthly_usage',
  {
    deviceId: text('device_id').notNull(),
    // 将来の infer 全体改修でも 'infer' 一本のまま使う想定
    category: text('category').notNull(),
    month: text('month').notNull(), // 'YYYY-MM'（UTC）
    count: integer('count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.deviceId, table.category, table.month] }),
  }),
);

const DDL = `
CREATE TABLE IF NOT EXISTS device_monthly_usage (
  device_id TEXT NOT NULL,
  category  TEXT NOT NULL,
  month     TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, category, month)
);
`;

function resolveDbPath(): string {
  const fromEnv = process.env['INFER_QUOTA_DB_PATH'];
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  // Railway ではボリュームを /data にマウントする。無ければローカル開発
  if (fs.existsSync('/data')) return '/data/quota.db';
  return path.join('.data', 'quota.db');
}

let dbSingleton: BetterSQLite3Database | null = null;

export function getQuotaDb(): BetterSQLite3Database {
  if (dbSingleton) return dbSingleton;
  const dbPath = resolveDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  dbSingleton = drizzle(sqlite);
  return dbSingleton;
}

/** テスト用: シングルトンを破棄（INFER_QUOTA_DB_PATH=':memory:' と組で使う） */
export function resetQuotaStoreForTesting(): void {
  dbSingleton = null;
}

function currentMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7); // 'YYYY-MM'（UTC）
}

/**
 * 消費せずに「まだ枠が残っているか」だけを見る（無料のローカル読み）。
 * `limit` が 0 以下なら枠管理そのものが無効 — 常に true。
 */
export function peekMonthlyQuota(deviceId: string, category: string, limit: number): boolean {
  if (limit <= 0) return true;
  const db = getQuotaDb();
  const rows = db
    .select()
    .from(deviceMonthlyUsage)
    .where(
      and(
        eq(deviceMonthlyUsage.deviceId, deviceId),
        eq(deviceMonthlyUsage.category, category),
        eq(deviceMonthlyUsage.month, currentMonth()),
      ),
    )
    .all();
  const used = rows[0]?.count ?? 0;
  return used < limit;
}

/** provider 成功時にだけ呼ぶ。無ければ 1 件作り、あれば +1 する（UPSERT）。 */
export function recordMonthlyUse(deviceId: string, category: string): void {
  const db = getQuotaDb();
  const month = currentMonth();
  db.insert(deviceMonthlyUsage)
    .values({ deviceId, category, month, count: 1 })
    .onConflictDoUpdate({
      target: [deviceMonthlyUsage.deviceId, deviceMonthlyUsage.category, deviceMonthlyUsage.month],
      set: { count: sql`${deviceMonthlyUsage.count} + 1` },
    })
    .run();
}
