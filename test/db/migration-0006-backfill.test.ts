import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import type { SqliteDatabase } from '../../src/db/drizzle.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

const BASELINE_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
  '0003_fix_check_constraints',
  '0004_restore_ai_usage_result_check',
  '0005_add_error_fields_to_ai_usage_log',
] as const;

// folderMillis from drizzle/meta/_journal.json. Required so migrate() does
// not skip 0006 when re-applied — drizzle compares folderMillis to the
// recorded created_at.
const BASELINE_FOLDER_MILLIS: Record<string, number> = {
  '0000_initial': 1776203869422,
  '0001_env_vars_scoped_uniques': 1776203869423,
  '0002_add_server_id': 1776217725447,
  '0003_fix_check_constraints': 1776332000000,
  '0004_restore_ai_usage_result_check': 1776350000000,
  '0005_add_error_fields_to_ai_usage_log': 1776380000000,
};

function readMigrationStatements(tag: string): string[] {
  const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply 0000~0005 manually + record their hashes so migrate() applies only 0006. */
function applyBaselineThrough0005(sqlite: SqliteDatabase): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const tag of BASELINE_TAGS) {
      for (const stmt of readMigrationStatements(tag)) {
        try {
          sqlite.exec(stmt);
        } catch {
          // CREATE IF NOT EXISTS / idempotent — skip
        }
      }
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);
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

function runFullMigration(
  drizzle: ReturnType<typeof createDrizzleDatabase>['db'],
  sqlite: SqliteDatabase,
): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: DRIZZLE_DIR });
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

describe('Migration 0006 — recovering_started_at backfill (Major 1)', () => {
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

  it('backfills recovering_started_at for projects already stuck in recovering when 0006 lands', () => {
    applyBaselineThrough0005(sqlite);

    // Insert a stuck-recovering row at 0005 schema (no recovering_started_at column yet)
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, status, dockerfile_path, source)
         VALUES ('stuck-1', 'hotdeal-tracker', 'https://example.com/r.git', 'main', 'recovering', 'Dockerfile', 'git')`,
      )
      .run();

    // Apply 0006
    runFullMigration(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT recovering_started_at FROM projects WHERE id = ?')
      .get('stuck-1') as { recovering_started_at: string | null };

    expect(row.recovering_started_at).not.toBeNull();
    // ISO-8601 format from strftime — sanity check shape
    expect(row.recovering_started_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('does NOT overwrite recovering_started_at when it is already set', () => {
    // Apply all migrations first so the column exists
    runFullMigration(drizzle, sqlite);

    const explicitTimestamp = '2026-04-20T10:00:00.000Z';
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, status, dockerfile_path, source, recovering_started_at)
         VALUES ('explicit-1', 'explicit-recovering', 'https://example.com/r.git', 'main', 'recovering', 'Dockerfile', 'git', ?)`,
      )
      .run(explicitTimestamp);

    // Re-run the backfill statement directly (idempotent against migrate())
    sqlite
      .prepare(
        `UPDATE projects SET recovering_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE status = 'recovering' AND recovering_started_at IS NULL`,
      )
      .run();

    const row = sqlite
      .prepare('SELECT recovering_started_at FROM projects WHERE id = ?')
      .get('explicit-1') as { recovering_started_at: string };

    expect(row.recovering_started_at).toBe(explicitTimestamp);
  });

  it('does NOT touch projects that are not in recovering state', () => {
    applyBaselineThrough0005(sqlite);

    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, status, dockerfile_path, source)
         VALUES ('running-1', 'healthy-app', 'https://example.com/r.git', 'main', 'running', 'Dockerfile', 'git')`,
      )
      .run();

    runFullMigration(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT recovering_started_at FROM projects WHERE id = ?')
      .get('running-1') as { recovering_started_at: string | null };

    expect(row.recovering_started_at).toBeNull();
  });

  it('handles multiple stuck rows in one pass', () => {
    applyBaselineThrough0005(sqlite);

    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, status, dockerfile_path, source)
         VALUES
           ('stuck-a', 'app-a', 'https://example.com/a.git', 'main', 'recovering', 'Dockerfile', 'git'),
           ('stuck-b', 'app-b', 'https://example.com/b.git', 'main', 'recovering', 'Dockerfile', 'git'),
           ('healthy', 'app-c', 'https://example.com/c.git', 'main', 'running', 'Dockerfile', 'git')`,
      )
      .run();

    runFullMigration(drizzle, sqlite);

    const rows = sqlite
      .prepare('SELECT id, recovering_started_at FROM projects ORDER BY id')
      .all() as { id: string; recovering_started_at: string | null }[];

    const stuckA = rows.find((r) => r.id === 'stuck-a');
    const stuckB = rows.find((r) => r.id === 'stuck-b');
    const healthy = rows.find((r) => r.id === 'healthy');

    expect(stuckA?.recovering_started_at).not.toBeNull();
    expect(stuckB?.recovering_started_at).not.toBeNull();
    expect(healthy?.recovering_started_at).toBeNull();
  });
});
