import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

import * as schema from './schema.drizzle.js';

export type DrizzleClient = BunSQLiteDatabase<typeof schema>;

export interface DrizzleDatabase {
  sqlite: Database;
  db: DrizzleClient;
}

export function createDrizzleDatabase(dbPath: string): DrizzleDatabase {
  const sqlite = new Database(dbPath, { create: true });

  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}
