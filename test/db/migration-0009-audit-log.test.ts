/**
 * Migration 0009 — audit log assertions.
 *
 * Plan §6.3 / §6.5: migration_0009_audit records every source-row -> target-row
 * remap, plus per-phase synthetic rows. The acceptance gate references the
 * per-phase row counts after a representative seed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  createDrizzleDatabase,
  type SqliteDatabase,
  type DrizzleClient,
} from '../../src/db/drizzle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

const PRE_0009_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
  '0003_fix_check_constraints',
  '0004_restore_ai_usage_result_check',
  '0005_add_error_fields_to_ai_usage_log',
  '0006_compose_path_and_recovering_watchdog',
  '0007_service_metrics_and_settings',
  '0008_mcp_session_log',
] as const;

const PRE_0009_FOLDER_MILLIS: Record<string, number> = {
  '0000_initial': 1776203869422,
  '0001_env_vars_scoped_uniques': 1776203869423,
  '0002_add_server_id': 1776217725447,
  '0003_fix_check_constraints': 1776332000000,
  '0004_restore_ai_usage_result_check': 1776350000000,
  '0005_add_error_fields_to_ai_usage_log': 1776380000000,
  '0006_compose_path_and_recovering_watchdog': 1776480000000,
  '0007_service_metrics_and_settings': 1776560000000,
  '0008_mcp_session_log': 1777000000000,
};

function readMigrationStatements(tag: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function applyPre0009Baseline(sqlite: SqliteDatabase): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const tag of PRE_0009_TAGS) {
      for (const stmt of readMigrationStatements(tag)) {
        try {
          sqlite.exec(stmt);
        } catch {
          /* idempotent */
        }
      }
    }
    sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )`);
    const insert = sqlite.prepare(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
    );
    for (const tag of PRE_0009_TAGS) {
      const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      insert.run(hash, PRE_0009_FOLDER_MILLIS[tag]!);
    }
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

function run0009(drizzle: DrizzleClient, sqlite: SqliteDatabase): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

describe('migration 0009 — audit log per-phase row counts', () => {
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
    applyPre0009Baseline(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  function countByPhase(): Record<string, number> {
    const rows = sqlite
      .prepare("SELECT phase, COUNT(*) as cnt FROM migration_0009_audit GROUP BY phase")
      .all() as Array<{ phase: string; cnt: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.phase] = r.cnt;
    return out;
  }

  it('empty DB: phase C (orphan_managed group) is the only audit row', () => {
    run0009(drizzle, sqlite);
    const counts = countByPhase();
    expect(counts.C).toBe(1);
    expect(counts.D ?? 0).toBe(0);
    expect(counts.E ?? 0).toBe(0);
  });

  it('representative seed: 2 standalone projects + 1 managed service produces expected per-phase counts', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source) VALUES
         ('p1', 'app1', 'https://x/y', 'main', 'git'),
         ('p2', 'app2', 'https://x/z', 'main', 'git')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO services (id, name, type, image, container_name, port, status)
         VALUES ('m1', 'mydb', 'postgres', 'postgres:16', 'mydb-c', 5432, 'running')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const counts = countByPhase();
    expect(counts.C).toBe(1); // synthesized __orphan_managed
    expect(counts.D).toBe(4); // 2 projects -> 2 service mappings + 2 group mappings
    expect(counts.E).toBe(1); // 1 managed service mapping
  });

  it('compose parent + 2 children: phase D records 6 rows (3 service mappings + 3 group mappings)', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source, build_method) VALUES
         ('cp', 'parent', 'https://x/y', 'main', 'git', 'compose'),
         ('cc1', 'web', 'https://x/y', 'main', 'git', NULL),
         ('cc2', 'api', 'https://x/y', 'main', 'git', NULL)`,
      )
      .run();
    sqlite
      .prepare(`UPDATE projects SET parent_project_id = 'cp' WHERE id IN ('cc1', 'cc2')`)
      .run();

    run0009(drizzle, sqlite);

    const counts = countByPhase();
    expect(counts.D).toBe(6);
  });

  it('FK-repoint: phase F audit rows match per-table fixture row counts', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source) VALUES
         ('p1', 'app1', 'https://x/y', 'main', 'git')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, key, value)
         VALUES ('ev1', 'p1', 'KEY', 'val'), ('ev2', 'p1', 'KEY2', 'val2')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const phaseF = sqlite
      .prepare(
        "SELECT source_table, COUNT(*) as cnt FROM migration_0009_audit WHERE phase = 'F' GROUP BY source_table",
      )
      .all() as Array<{ source_table: string; cnt: number }>;
    const map = new Map(phaseF.map((r) => [r.source_table, r.cnt]));
    expect(map.get('env_vars')).toBe(2);
  });
});
