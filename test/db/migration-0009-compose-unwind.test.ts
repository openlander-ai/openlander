/**
 * Migration 0009 — compose-unwind dedicated tests.
 *
 * Plan §6.3 lines 475-479 (compose mapping rules):
 *   - standalone (parent_project_id IS NULL, kind=git/image): group + service
 *   - compose parent (build_method='compose'): group + service kind='compose'
 *   - compose child (parent_project_id NOT NULL): NO new group; service
 *     kind='compose-child' with parent_service_id = parent's __svc
 *   - managed service: NO new group; service under __orphan_managed
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

describe('migration 0009 — compose unwind rules (plan §6.3)', () => {
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

  it('standalone git project -> 1 group + 1 service kind=git', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source)
         VALUES ('s1', 'standalone', 'https://x/y', 'main', 'git')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const svc = sqlite.prepare("SELECT * FROM services WHERE id = 's1__svc'").get() as
      | { kind: string; project_id: string; parent_service_id: string | null }
      | undefined;
    expect(svc?.kind).toBe('git');
    expect(svc?.project_id).toBe('s1');
    expect(svc?.parent_service_id).toBeNull();
  });

  it('standalone image project -> service kind=image', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source, image_url)
         VALUES ('s2', 'image-app', NULL, 'main', 'image', 'docker.io/myimg')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const svc = sqlite.prepare("SELECT kind FROM services WHERE id = 's2__svc'").get() as {
      kind: string;
    };
    expect(svc.kind).toBe('image');
  });

  it('compose parent + 2 children: 2 group rows + 1 compose service + 2 compose-child services', () => {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source, build_method)
         VALUES ('cp', 'parent', 'https://x/y', 'main', 'git', 'compose')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source, parent_project_id)
         VALUES ('cc1', 'web', 'https://x/y', 'main', 'git', 'cp')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, source, parent_project_id)
         VALUES ('cc2', 'api', 'https://x/y', 'main', 'git', 'cp')`,
      )
      .run();

    run0009(drizzle, sqlite);

    // P1 retains all original projects rows as group rows (back-compat).
    // Children's project_id was preserved as their original id during P1
    // (see migration §Phase D group-row INSERT). Test the service shape.
    const parentSvc = sqlite.prepare("SELECT * FROM services WHERE id = 'cp__svc'").get() as
      | { kind: string; parent_service_id: string | null }
      | undefined;
    expect(parentSvc?.kind).toBe('compose');
    expect(parentSvc?.parent_service_id).toBeNull();

    const child1 = sqlite.prepare("SELECT * FROM services WHERE id = 'cc1__svc'").get() as
      | { kind: string; parent_service_id: string | null; project_id: string }
      | undefined;
    expect(child1?.kind).toBe('compose-child');
    expect(child1?.parent_service_id).toBe('cp__svc');
    expect(child1?.project_id).toBe('cp'); // share parent's group

    const child2 = sqlite.prepare("SELECT * FROM services WHERE id = 'cc2__svc'").get() as
      | { kind: string; parent_service_id: string | null; project_id: string }
      | undefined;
    expect(child2?.kind).toBe('compose-child');
    expect(child2?.parent_service_id).toBe('cp__svc');
    expect(child2?.project_id).toBe('cp');
  });

  it('managed service -> service under __orphan_managed group', () => {
    sqlite
      .prepare(
        `INSERT INTO services (id, name, type, image, container_name, port, status)
         VALUES ('m1', 'mydb', 'postgres', 'postgres:16', 'mydb-c', 5432, 'running')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite.prepare("SELECT * FROM services WHERE id = 'm1'").get() as
      | { kind: string; project_id: string }
      | undefined;
    expect(row?.kind).toBe('postgres');
    expect(row?.project_id).toBe('__orphan_managed');

    const orphanGroup = sqlite
      .prepare("SELECT id FROM projects WHERE id = '__orphan_managed'")
      .get() as { id: string } | undefined;
    expect(orphanGroup?.id).toBe('__orphan_managed');
  });
});
