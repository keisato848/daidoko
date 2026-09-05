/**
 * Database initialization hook
 * Runs migrations and seeds on app startup (native)
 * On web, skips DB init and uses mock data
 */
import { t } from '../i18n';
import { useEffect, useState } from 'react';

import { initDatabase, isNativePlatform } from '../db/client';

export function useDatabase() {
  // On web, DB init is skipped, so start as ready to avoid a flash on navigation
  const [isReady, setIsReady] = useState(!isNativePlatform);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        if (isNativePlatform) {
          await initDatabase();

          const { getDb, getExpoDb } = await import('../db/client');
          const { ensureLocalIdentity, normalizePhotoPaths, runMigrations, seedDatabase } =
            await import('../db/migrate');

          runMigrations(getExpoDb());
          await ensureLocalIdentity(getDb());
          await seedDatabase(getDb());
          // 旧データの絶対パスを相対へ揃える（冪等・photo-path.ts）
          await normalizePhotoPaths(getDb());
          // v16: 在庫数量のベースライン化（未移行の行だけ）と自己修復の再実体化（設計 §5-3-1）
          const { ensureQuantityBaseline, rematerializeAll } =
            await import('../services/pantry-quantity-db');
          await ensureQuantityBaseline();
          await rematerializeAll();
        }
        // Web: no DB, screens use mock data
        setIsReady(true);
      } catch (e) {
        // 画面には翻訳済みの一般文言だけを出す（英語の生スタックを出さない —
        // 水平展開規約②）。切り分け用の詳細は console に残す
        setError(t('error.dbInit'));
        console.error('Database init failed:', e);
      }
    }
    void init();
  }, []);

  return { isReady, error, isNativePlatform };
}
