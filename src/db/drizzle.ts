import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.drizzle.js';

export type DrizzleClient = BetterSQLite3Database<typeof schema>;

export interface DrizzleDatabase {
  sqlite: Database.Database;
  db: DrizzleClient;
}

export function createDrizzleDatabase(dbPath: string): DrizzleDatabase {
  const sqlite = new Database(dbPath);

  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  return { sqlite, db };
}
