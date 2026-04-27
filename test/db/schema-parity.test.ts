/**
 * Schema parity test (ralplan-monitoring-logs Phase 1 step 4).
 *
 * Catches schema drift: if a table is renamed/added in Drizzle without a
 * matching migration (or vice versa), this test fails with a column-set
 * diff instead of a runtime "no such column" error in production.
 *
 * Strategy (fixture-free):
 *   1. Open in-memory better-sqlite3 via createDrizzleDatabase(':memory:').
 *   2. Run every migration in drizzle/ via drizzle's migrate().
 *   3. For each Drizzle-declared table, query PRAGMA table_info(<name>) and
 *      compare the resulting column set to the Drizzle schema's column
 *      configuration.
 *
 * The assertion is a column-name set parity check. Type-detail mismatches
 * (text vs integer) are out of scope here — drizzle's own migrator catches
 * those at migrate() time.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDrizzleDatabase,
  type SqliteDatabase,
  type DrizzleClient,
} from '../../src/db/drizzle.js';
import { drizzleSchema } from '../../src/db/schema.drizzle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

interface ColumnInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: 0 | 1;
}

function pragmaColumns(sqlite: SqliteDatabase, table: string): ColumnInfoRow[] {
  return sqlite.prepare(`PRAGMA table_info('${table}')`).all() as ColumnInfoRow[];
}

describe('schema parity (drizzle vs migrated DB)', () => {
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('migrated_db_matches_drizzle_schema_all_tables', () => {
    const mismatches: string[] = [];

    for (const [exportName, table] of Object.entries(drizzleSchema)) {
      const config = getTableConfig(table);
      const declaredColumns = config.columns.map((c) => c.name).sort();

      const migratedRows = pragmaColumns(sqlite, config.name);
      if (migratedRows.length === 0) {
        mismatches.push(`Table '${config.name}' (export ${exportName}) declared in Drizzle but missing from migrated DB`);
        continue;
      }
      const migratedColumns = migratedRows.map((r) => r.name).sort();

      const onlyInDrizzle = declaredColumns.filter((c) => !migratedColumns.includes(c));
      const onlyInMigrated = migratedColumns.filter((c) => !declaredColumns.includes(c));

      if (onlyInDrizzle.length > 0 || onlyInMigrated.length > 0) {
        mismatches.push(
          `Table '${config.name}' (export ${exportName}): drizzle-only=[${onlyInDrizzle.join(',')}] migrated-only=[${onlyInMigrated.join(',')}]`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });
});
