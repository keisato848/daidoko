/**
 * Database initialization hook
 * Runs migrations and seeds on app startup (native)
 * On web, skips DB init and uses mock data
 */
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
          const { ensureLocalIdentity, runMigrations, seedDatabase } =
            await import('../db/migrate');

          runMigrations(getExpoDb());
          await ensureLocalIdentity(getDb());
          await seedDatabase(getDb());
        }
        // Web: no DB, screens use mock data
        setIsReady(true);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown database error';
        setError(message);
        console.error('Database init failed:', message);
      }
    }
    void init();
  }, []);

  return { isReady, error, isNativePlatform };
}
