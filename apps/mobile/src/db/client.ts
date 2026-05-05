/**
 * Database client initialization for expo-sqlite + Drizzle ORM
 */
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

const DB_NAME = 'daidoko.db';

const expoDb = openDatabaseSync(DB_NAME);

// Set recommended pragmas
expoDb.execSync('PRAGMA journal_mode = WAL');
expoDb.execSync('PRAGMA foreign_keys = ON');
expoDb.execSync('PRAGMA cache_size = -8000');
expoDb.execSync('PRAGMA temp_store = MEMORY');

export const db = drizzle(expoDb, { schema });

export { expoDb };
