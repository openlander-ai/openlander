/**
 * Test helper that mirrors production's migration apply path
 * (src/db/index.ts:435-443): wrap migrate() with PRAGMA foreign_keys
 * OFF/ON so destructive migrations (e.g. 0009 split) succeed without
 * tripping FK violations on rename/drop.
 *
 * In production the Database constructor sets foreign_keys=OFF before
 * migrate() and ON after, then runs foreign_key_check to gate startup.
 * Test fixtures that create an in-memory DB and call migrate() directly
 * must do the same — otherwise a migration that drops a parent table
 * with child references fails inside drizzle's transaction (you cannot
 * toggle PRAGMA foreign_keys inside a transaction in SQLite).
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { DrizzleClient, SqliteDatabase } from '../../src/db/drizzle.js';

export interface MigrateWithFkOffOpts {
  migrationsFolder: string;
}

export function migrateWithFkOff(
  drizzle: DrizzleClient,
  sqlite: SqliteDatabase,
  opts: MigrateWithFkOffOpts,
): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: opts.migrationsFolder });
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}
