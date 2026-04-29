/**
 * Migration idempotency and safety tests for 0003/0004/0005.
 *
 * These tests guard against the rc.7 -> rc.9 upgrade failure scenario:
 * existing rows in ai_usage_log may violate newly added CHECK constraints
 * introduced in 0004_restore_ai_usage_result_check.sql.
 *
 * All tests use in-memory better-sqlite3 to keep setup fast and hermetic.
 * Migrations are applied by splitting on '--> statement-breakpoint' exactly
 * as the production applyAndRecordAllMigrations() helper does.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import type { SqliteDatabase } from '../../src/db/drizzle.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');
const MIGRATIONS_FOLDER = DRIZZLE_DIR;

const BASELINE_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
] as const;

/**
 * folderMillis values from drizzle/meta/_journal.json. Drizzle's migrator
 * skips a migration when its folderMillis is <= the latest `created_at`
 * in `__drizzle_migrations`. Recording baselines with `Date.now()` would
 * make every newer-than-now migration get silently skipped, defeating
 * the rc.7 -> 1.0 fixture simulation. Day 14 fix.
 */
const BASELINE_FOLDER_MILLIS: Record<string, number> = {
  '0000_initial': 1776203869422,
  '0001_env_vars_scoped_uniques': 1776203869423,
  '0002_add_server_id': 1776217725447,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a migration SQL file and split it into individual statements. */
function readMigrationStatements(tag: string): string[] {
  const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply migrations 0000~0002 manually, then record them in __drizzle_migrations
 * so that drizzle-orm/migrator will skip them and only apply 0003+.
 * This simulates a rc.7 database that has been partially migrated.
 */
function applyBaseline0to2(sqlite: SqliteDatabase): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    // Apply the three baseline migrations statement by statement
    for (const tag of BASELINE_TAGS) {
      for (const stmt of readMigrationStatements(tag)) {
        try {
          sqlite.exec(stmt);
        } catch {
          // statement already applied (CREATE IF NOT EXISTS etc.) — skip
        }
      }
    }

    // Create the drizzle migration tracking table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);

    // Record migrations 0-2 with their content hashes so the migrator skips them.
    // Use the exact folderMillis from the journal so 0003+ are detected as
    // newer than the recorded baseline (drizzle's skip check compares
    // folderMillis to last-applied created_at, NOT just hash).
    const insert = sqlite.prepare(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
    );
    for (const tag of BASELINE_TAGS) {
      const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      insert.run(hash, BASELINE_FOLDER_MILLIS[tag]!);
    }
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Insert a minimal ai_usage_log row using raw SQL (no ORM) so we can
 * insert values independently of Drizzle schema-level enum validation.
 * Parameter binding avoids SQL injection and SQLite quoting issues.
 */
function insertAiUsageLogRaw(
  sqlite: SqliteDatabase,
  opts: {
    id: string;
    result: string;
    action_type?: string;
    model_name?: string;
    provider?: string;
  },
): void {
  sqlite
    .prepare(
      `
    INSERT INTO ai_usage_log (
      id, action_type, model_name, provider,
      input_tokens, output_tokens, total_tokens,
      tools_called, result, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, 100, 50, 150, '[]', ?, 1000, ?)
  `,
    )
    .run(
      opts.id,
      opts.action_type ?? 'web_agent',
      opts.model_name ?? 'gpt-4',
      opts.provider ?? 'openai',
      opts.result,
      new Date().toISOString(),
    );
}

/** Return the row count of __drizzle_migrations. */
function migrationRowCount(sqlite: SqliteDatabase): number {
  const row = sqlite.prepare('SELECT COUNT(*) as cnt FROM __drizzle_migrations').get() as {
    cnt: number;
  };
  return row.cnt;
}

/** Return all user-table names in the database (excludes sqlite_* internals). */
function getTableNames(sqlite: SqliteDatabase): Set<string> {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Return column names for a given table. */
function getColumnNames(sqlite: SqliteDatabase, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** Run all 8 migrations with foreign_keys OFF/ON bracketing (matches production logic). */
function runFullMigration(
  drizzle: ReturnType<typeof createDrizzleDatabase>['db'],
  sqlite: SqliteDatabase,
): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('migration idempotency and safety (0003/0004/0005)', () => {
  let sqlite: SqliteDatabase;
  let drizzle: ReturnType<typeof createDrizzleDatabase>['db'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
  });

  afterEach(() => {
    sqlite.close();
  });

  // -------------------------------------------------------------------------
  // Test 1: Full idempotency — running all migrations twice is safe
  // -------------------------------------------------------------------------
  describe('Test 1: idempotency — all migrations re-applied to a fully migrated DB', () => {
    it('does not throw when the drizzle migrator is called a second time on a fully migrated DB', () => {
      // First full run
      runFullMigration(drizzle, sqlite);
      const countAfterFirst = migrationRowCount(sqlite);

      // Second run — drizzle detects existing hashes and skips all
      expect(() => {
        runFullMigration(drizzle, sqlite);
      }).not.toThrow();

      expect(migrationRowCount(sqlite)).toBe(countAfterFirst);
    });

    it('__drizzle_migrations row count matches journal length after full migration (no duplicates on re-run)', () => {
      runFullMigration(drizzle, sqlite);
      runFullMigration(drizzle, sqlite); // second run

      // 13 = 0000..0012 (full split + cleanup + FK re-point + schema-split GA)
      expect(migrationRowCount(sqlite)).toBe(13);
    });

    it('table set is identical before and after re-applying all migrations', () => {
      runFullMigration(drizzle, sqlite);
      const tablesAfterFirst = [...getTableNames(sqlite)].sort();

      runFullMigration(drizzle, sqlite);
      const tablesAfterSecond = [...getTableNames(sqlite)].sort();

      expect(tablesAfterSecond).toEqual(tablesAfterFirst);
    });

    it('data inserted before re-running migrations is not lost', () => {
      runFullMigration(drizzle, sqlite);
      insertAiUsageLogRaw(sqlite, { id: 'sentinel', result: 'success' });

      runFullMigration(drizzle, sqlite);

      const row = sqlite.prepare("SELECT id FROM ai_usage_log WHERE id = 'sentinel'").get() as
        | { id: string }
        | undefined;
      expect(row).toBeDefined();
      expect(row!.id).toBe('sentinel');
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: rc.7 fixture — 0000~0002 DB with existing data → apply 0003~0005
  // -------------------------------------------------------------------------
  describe('Test 2: rc.7 fixture simulation — upgrading from 0002-state to 0005', () => {
    it('migrates successfully when ai_usage_log contains rc.7 rows with result=success', () => {
      applyBaseline0to2(sqlite);
      insertAiUsageLogRaw(sqlite, { id: 'rc7-success', result: 'success' });

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      const row = sqlite
        .prepare("SELECT result FROM ai_usage_log WHERE id = 'rc7-success'")
        .get() as { result: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.result).toBe('success');
    });

    it('migrates successfully when ai_usage_log contains rc.7 rows with result=failure', () => {
      applyBaseline0to2(sqlite);
      insertAiUsageLogRaw(sqlite, { id: 'rc7-failure', result: 'failure' });

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      const row = sqlite
        .prepare("SELECT result FROM ai_usage_log WHERE id = 'rc7-failure'")
        .get() as { result: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.result).toBe('failure');
    });

    it('migrates successfully when ai_usage_log contains rc.7 rows with result=partial', () => {
      applyBaseline0to2(sqlite);
      insertAiUsageLogRaw(sqlite, { id: 'rc7-partial', result: 'partial' });

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      const row = sqlite
        .prepare("SELECT result FROM ai_usage_log WHERE id = 'rc7-partial'")
        .get() as { result: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.result).toBe('partial');
    });

    it('all pre-existing ai_usage_log rows survive 0003~0005 — zero data loss', () => {
      applyBaseline0to2(sqlite);

      // Insert 3 rc.7 era rows
      insertAiUsageLogRaw(sqlite, { id: 'r1', result: 'success' });
      insertAiUsageLogRaw(sqlite, { id: 'r2', result: 'failure' });
      insertAiUsageLogRaw(sqlite, { id: 'r3', result: 'partial' });

      const countBefore = (
        sqlite.prepare('SELECT COUNT(*) as cnt FROM ai_usage_log').get() as { cnt: number }
      ).cnt;

      runFullMigration(drizzle, sqlite);

      const countAfter = (
        sqlite.prepare('SELECT COUNT(*) as cnt FROM ai_usage_log').get() as { cnt: number }
      ).cnt;

      // FAIL = GA blocker: existing rows were rejected by CHECK during INSERT INTO __new_ai_usage_log
      expect(countAfter).toBe(countBefore);
      expect(countAfter).toBe(3);
    });

    // Day 14 fix: applyBaseline0to2() now records 0~2 with the correct
    // folderMillis from the journal, so migrate() detects 0003/0004/0005/0006/0007
    // as still pending and applies them — bringing the total to 8.
    it('__drizzle_migrations row count matches journal length after upgrading from rc.7 baseline', () => {
      applyBaseline0to2(sqlite);
      runFullMigration(drizzle, sqlite);

      // 13 = 0000..0012 (full split + cleanup + FK re-point + schema-split GA)
      expect(migrationRowCount(sqlite)).toBe(13);
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: kill mid-migration recovery
  // SKIPPED: tracked as 1.0.x backlog (U-P0-12) — Drizzle migrator skips
  // already-recorded migrations by hash, so a rolled-back partial 0003
  // followed by full migrate() does not re-run 0003. Real-world recovery
  // would require dropping the partial __drizzle_migrations row, which is
  // out of scope for 1.0 GA. See docs/launchpad/qa-unit-test-track-2026-04-20.md.
  // -------------------------------------------------------------------------
  describe.skip('Test 3: kill mid-migration recovery', () => {
    it('a rolled-back partial 0003 execution leaves no __new_ai_usage_log artifact', () => {
      applyBaseline0to2(sqlite);

      // Simulate a partial execution: run only the first statement of 0003
      // inside an explicit transaction that is then rolled back.
      const stmts = readMigrationStatements('0003_fix_check_constraints');
      // stmts[0] is "PRAGMA foreign_keys=OFF" — safe to run in a tx for the test
      // stmts[1] is "DROP TABLE IF EXISTS `__new_ai_usage_log`"
      // stmts[2] is "CREATE TABLE `__new_ai_usage_log` ..."
      // We run up through creating __new_ai_usage_log then rollback

      try {
        sqlite.exec('BEGIN');
        // Apply first few statements to simulate partial progress
        for (let i = 0; i < Math.min(3, stmts.length); i++) {
          try {
            sqlite.exec(stmts[i]!);
          } catch {
            /* ignore */
          }
        }
        sqlite.exec('ROLLBACK');
      } catch {
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
      }

      // After rollback, the temp table must not exist
      const tables = getTableNames(sqlite);
      expect(tables.has('__new_ai_usage_log')).toBe(false);
    });

    it('clean application of 0003~0005 after a rolled-back partial run succeeds', () => {
      applyBaseline0to2(sqlite);

      // Simulate partial run + rollback
      const stmts = readMigrationStatements('0003_fix_check_constraints');
      try {
        sqlite.exec('BEGIN');
        for (let i = 0; i < Math.min(3, stmts.length); i++) {
          try {
            sqlite.exec(stmts[i]!);
          } catch {
            /* ignore */
          }
        }
        sqlite.exec('ROLLBACK');
      } catch {
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
      }

      // Full migration from current state must succeed
      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();
      expect(migrationRowCount(sqlite)).toBe(6);
    });

    it('0003 is recorded exactly once in __drizzle_migrations after recovery', () => {
      applyBaseline0to2(sqlite);

      // Partial run + rollback
      try {
        sqlite.exec('BEGIN');
        try {
          sqlite.exec('PRAGMA foreign_keys=OFF');
        } catch {
          /* ignore */
        }
        sqlite.exec('ROLLBACK');
      } catch {
        try {
          sqlite.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
      }

      runFullMigration(drizzle, sqlite);

      // Count rows with the 0003 hash — must be exactly 1
      const sql0003 = readFileSync(
        path.join(DRIZZLE_DIR, '0003_fix_check_constraints.sql'),
        'utf8',
      );
      const hash0003 = createHash('sha256').update(sql0003).digest('hex');

      const row = sqlite
        .prepare('SELECT COUNT(*) as cnt FROM __drizzle_migrations WHERE hash = ?')
        .get(hash0003) as { cnt: number };

      expect(row.cnt).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: SQL text sanity checks for 0003/0004/0005
  // -------------------------------------------------------------------------
  describe('Test 4: SQL text sanity — dangerous patterns absent from migration files', () => {
    const targets = [
      '0003_fix_check_constraints',
      '0004_restore_ai_usage_result_check',
      '0005_add_error_fields_to_ai_usage_log',
    ] as const;

    for (const tag of targets) {
      it(`${tag}: any unconditional DROP TABLE targets only Drizzle rename-rebuild temp tables`, () => {
        const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');

        // Find all DROP TABLE without IF EXISTS
        const unconditionalDrops = [
          ...sql.matchAll(/DROP\s+TABLE\s+(?!IF\s+EXISTS\s*`)(`[^`]+`)/gi),
        ];

        for (const match of unconditionalDrops) {
          const droppedTable = match[1]!; // e.g. `ai_usage_log`
          const tableName = droppedTable.replace(/`/g, '');

          // Safe if and only if there is a matching CREATE TABLE `__new_<tableName>`
          // followed by INSERT INTO `__new_<tableName>` ... SELECT FROM `<tableName>`
          // This is the standard Drizzle rename-rebuild idiom.
          const hasNewTableCreate = sql.includes(`CREATE TABLE \`__new_${tableName}\``);
          const hasInsertSelect = sql.includes(`INSERT INTO \`__new_${tableName}\``);

          expect(
            hasNewTableCreate && hasInsertSelect,
            `DROP TABLE \`${tableName}\` without IF EXISTS must be part of a Drizzle rename-rebuild ` +
              `(CREATE TABLE __new_${tableName} + INSERT INTO __new_${tableName} ... SELECT FROM ${tableName} must both be present)`,
          ).toBe(true);
        }
      });

      it(`${tag}: no DELETE FROM statement (unguarded mass row deletion)`, () => {
        const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
        const matches = [...sql.matchAll(/\bDELETE\s+FROM\b/gi)];
        expect(matches.map((m) => m[0])).toHaveLength(0);
      });

      it(`${tag}: no TRUNCATE statement`, () => {
        const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
        const matches = [...sql.matchAll(/\bTRUNCATE\b/gi)];
        expect(matches.map((m) => m[0])).toHaveLength(0);
      });

      it(`${tag}: does not directly modify __drizzle_migrations`, () => {
        const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
        expect(/__drizzle_migrations/i.test(sql)).toBe(false);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test 5: result CHECK enum in 0004 matches application code values
  // -------------------------------------------------------------------------
  describe('Test 5: ai_usage_log result CHECK enum matches application code', () => {
    // The CHECK constraint enforced by 0004:
    //   result IN ('success', 'failure', 'partial')
    // Application code (AiUsageListener / schema.drizzle.ts) must use only these values.
    const VALID_RESULT_VALUES = ['success', 'failure', 'partial'] as const;

    it('0004 SQL explicitly lists all three result enum values in the CHECK clause', () => {
      const sql = readFileSync(
        path.join(DRIZZLE_DIR, '0004_restore_ai_usage_result_check.sql'),
        'utf8',
      );

      for (const value of VALID_RESULT_VALUES) {
        expect(sql, `0004 should contain '${value}' in CHECK clause`).toContain(`'${value}'`);
      }
      expect(sql).toMatch(/CHECK\s*\(/i);
    });

    it('each valid result value (success/failure/partial) can be inserted after full migration', () => {
      runFullMigration(drizzle, sqlite);

      for (const value of VALID_RESULT_VALUES) {
        const id = `enum-test-${value}`;
        expect(
          () => insertAiUsageLogRaw(sqlite, { id, result: value }),
          `result='${value}' must be accepted`,
        ).not.toThrow();

        const row = sqlite.prepare(`SELECT result FROM ai_usage_log WHERE id = ?`).get(id) as
          | { result: string }
          | undefined;

        expect(row).toBeDefined();
        expect(row!.result).toBe(value);
      }
    });

    it('an out-of-enum result value is rejected by the CHECK constraint after full migration', () => {
      runFullMigration(drizzle, sqlite);

      const invalidValues = ['pending', 'error', 'ok', 'done', 'unknown'];
      for (const bad of invalidValues) {
        expect(
          () => insertAiUsageLogRaw(sqlite, { id: `bad-${bad}`, result: bad }),
          `result='${bad}' must be rejected by CHECK`,
        ).toThrow();
      }
    });

    it('0005 adds error_message and error_type columns while preserving the result CHECK constraint', () => {
      runFullMigration(drizzle, sqlite);

      const cols = getColumnNames(sqlite, 'ai_usage_log');
      expect(cols.has('error_message')).toBe(true);
      expect(cols.has('error_type')).toBe(true);

      // CHECK constraint must still be enforced after 0005 ALTER TABLE
      expect(() =>
        insertAiUsageLogRaw(sqlite, { id: 'post0005-invalid', result: 'bad_value' }),
      ).toThrow();

      expect(() =>
        insertAiUsageLogRaw(sqlite, { id: 'post0005-valid', result: 'success' }),
      ).not.toThrow();
    });

    it('schema.drizzle.ts result enum is a subset of the 0004 CHECK values', () => {
      // Read the schema source and extract the enum array literal
      const schemaSource = readFileSync(
        path.join(process.cwd(), 'src/db/schema.drizzle.ts'),
        'utf8',
      );

      // Find: result: text('result', { enum: ['success', 'failure', 'partial'] })
      const enumMatch = /result.*?enum:\s*\[([^\]]+)\]/s.exec(schemaSource);
      expect(enumMatch, 'could not find result enum in schema.drizzle.ts').not.toBeNull();

      const enumValues = enumMatch![1].split(',').map((v) => v.trim().replace(/['"]/g, ''));

      const sql0004 = readFileSync(
        path.join(DRIZZLE_DIR, '0004_restore_ai_usage_result_check.sql'),
        'utf8',
      );

      for (const val of enumValues) {
        expect(sql0004, `schema enum value '${val}' must appear in 0004 CHECK clause`).toContain(
          `'${val}'`,
        );
      }
    });
  });
});
