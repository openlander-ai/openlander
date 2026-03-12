import { createRequire } from 'node:module';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from './schema.drizzle.js';

export type DrizzleClient = BaseSQLiteDatabase<
  'sync',
  unknown,
  Record<string, never>,
  Record<string, never>
>;

type SqliteStatement = {
  all: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => unknown;
};

export interface SqliteDatabase {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  transaction: <T>(fn: () => T) => () => T;
  close: () => void;
}

export interface DrizzleDatabase {
  sqlite: SqliteDatabase;
  db: DrizzleClient;
}

export function createDrizzleDatabase(dbPath: string): DrizzleDatabase {
  const require = createRequire(import.meta.url);
  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

  const sqlite = isBunRuntime
    ? new (require('bun:sqlite') as { Database: new (path: string) => SqliteDatabase }).Database(
        dbPath,
      )
    : new (require('better-sqlite3') as new (path: string) => SqliteDatabase)(dbPath);

  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  const db = isBunRuntime
    ? (
        require('drizzle-orm/bun-sqlite') as {
          drizzle: (client: SqliteDatabase, config: { schema: typeof schema }) => DrizzleClient;
        }
      ).drizzle(sqlite, { schema })
    : (
        require('drizzle-orm/better-sqlite3') as {
          drizzle: (client: SqliteDatabase, config: { schema: typeof schema }) => DrizzleClient;
        }
      ).drizzle(sqlite, { schema });

  return { sqlite, db };
}
