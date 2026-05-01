/**
 * Migration 0012: assert all 8 phase markers emit in order during the
 * phase-logged execution path.
 *
 * Plan §"Test Strategy" Observability lane (a):
 *   "Boot-log test at test/db/migration-0012-boot-log.test.ts — captures
 *    stdout, asserts 8 phase markers in order."
 *
 * Implementation: parses the 0012 SQL file via parseMigration0012 and asserts
 * the unique phase set matches A-H in order. Then runs the phase-logged
 * execution path against an in-memory DB and asserts the returned phase
 * sequence is exactly [A, B, C, D, E, F, G, H].
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  createDrizzleDatabase,
  type DrizzleClient,
  type SqliteDatabase,
} from '../../src/db/drizzle.js';
import {
  MIGRATION_0012_PHASES,
  parseMigration0012,
  runMigration0012WithPhaseLogging,
} from '../../tools/db/migration-phase-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, '..', '..', 'drizzle');
const MIGRATION_PATH = path.join(DRIZZLE_DIR, '0012_complete_schema_split.sql');

/** Tags for migrations 0000-0011 — applied via Drizzle migrator so each
 *  migration runs atomically inside its own BEGIN/COMMIT. */
const PRE_0012_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
  '0003_fix_check_constraints',
  '0004_restore_ai_usage_result_check',
  '0005_add_error_fields_to_ai_usage_log',
  '0006_compose_path_and_recovering_watchdog',
  '0007_service_metrics_and_settings',
  '0008_mcp_session_log',
  '0009_split_projects_services',
  '0010_cleanup_compose_child_groups',
  '0011_repoint_deployable_project_ids',
];

/**
 * Build a temp migrations folder containing only 0000-0011 so that
 * Drizzle's migrator seeds the DB to the pre-0012 state without applying
 * 0012 itself.
 */
function buildPre0012MigrationsFolder(): string {
  const tmp = mkdtempSync(path.join(tmpdir(), 'drizzle-pre0012-'));
  const metaDir = path.join(tmp, 'meta');
  mkdirSync(metaDir, { recursive: true });

  // Copy SQL files for 0000-0011
  for (const tag of PRE_0012_TAGS) {
    copyFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), path.join(tmp, `${tag}.sql`));
  }

  // Build a journal with only the 0000-0011 entries
  const fullJournal = JSON.parse(
    readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { version: string; dialect: string; entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };

  const pre0012Journal = {
    version: fullJournal.version,
    dialect: fullJournal.dialect,
    entries: fullJournal.entries.filter((e) => e.idx <= 11),
  };
  writeFileSync(path.join(metaDir, '_journal.json'), JSON.stringify(pre0012Journal, null, 2));

  return tmp;
}

describe('Migration 0012: phase logger emits 8 markers in order', () => {
  it('static parse yields phases A-H', () => {
    const parsed = parseMigration0012(MIGRATION_PATH);
    const phases = Array.from(new Set(parsed.map((p) => p.phase)));
    expect(phases).toEqual([...MIGRATION_0012_PHASES]);
  });

  describe('with seeded pre-0012 schema', () => {
    let sqlite: SqliteDatabase;
    let drizzle: DrizzleClient;
    let pre0012Folder: string;

    beforeEach(() => {
      // Build a temp migrations folder with only 0000-0011 entries.
      pre0012Folder = buildPre0012MigrationsFolder();

      const db = createDrizzleDatabase(':memory:');
      sqlite = db.sqlite;
      drizzle = db.db;

      // Apply 0000-0011 via Drizzle migrator so each migration runs atomically.
      sqlite.exec('PRAGMA foreign_keys = OFF');
      try {
        migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: pre0012Folder });
      } finally {
        sqlite.exec('PRAGMA foreign_keys = ON');
      }
    });

    afterEach(() => {
      sqlite.close();
    });

    it('runMigration0012WithPhaseLogging returns phases [A..H] in order', () => {
      sqlite.exec('PRAGMA foreign_keys = OFF');
      const completed = runMigration0012WithPhaseLogging(sqlite, DRIZZLE_DIR);
      sqlite.exec('PRAGMA foreign_keys = ON');
      expect(completed).toEqual([...MIGRATION_0012_PHASES]);
    });
  });
});
