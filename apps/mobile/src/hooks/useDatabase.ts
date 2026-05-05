/**
 * Database initialization hook
 * Runs migrations and seeds on app startup
 */
import { useEffect, useState } from 'react';

import { db, expoDb } from '../db/client';
import { runMigrations, seedDatabase } from '../db/migrate';

export function useDatabase() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        runMigrations(expoDb);
        await seedDatabase(db);
        setIsReady(true);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown database error';
        setError(message);
        console.error('Database init failed:', message);
      }
    }
    void init();
  }, []);

  return { isReady, error };
}
