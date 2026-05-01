/**
 * Migration 0010 — cleanup of compose-child rows wrongly inserted as
 * top-level groups by 0009 Phase D.
 *
 * The bug: Phase D used `WHERE id != '__orphan_managed'` instead of
 * `WHERE parent_project_id IS NULL`, so every legacy compose-child row
 * landed as a separate group in `projects`. 0010 removes them and
 * re-points group-scoped FKs (env_vars / webhook_configs / secret_files
 * + audit-tier project_id columns) at the parent group.
 *
 * Test strategy:
 *   1. Apply 0000..0009 inline (mirrors src/db/index.ts:applyAndRecordAll).
 *   2. Insert legacy fixtures (compose parent + 2 children + group-scoped
 *      env_var rows on each).
 *   3. Run migrate() so 0009 then 0010 fire.
 *   4. Assert: child group rows gone; parent group survives; env_vars
 *      re-pointed; services rows preserved.
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

const PRE_0010_TAGS = [
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
];

function applyPre0010(sqlite: SqliteDatabase): void {
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       hash TEXT NOT NULL,
       created_at NUMERIC
     )`,
  );
  const insertHash = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  );
  for (const tag of PRE_0010_TAGS) {
    if (tag === '0009_split_projects_services') {
      // Stop short of 0009; the test inserts legacy fixtures BEFORE
      // 0009 runs (so children show up as separate projects post-Phase D).
      break;
    }
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    sqlite.exec(sql);
    insertHash.run(createHash('sha256').update(sql).digest('hex'), Date.now());
  }
  sqlite.pragma('foreign_keys = ON');
}

describe('Migration 0010: cleanup compose-child group fan-out', () => {
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
    applyPre0010(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  function insertLegacyProject(
    id: string,
    name: string,
    parentProjectId: string | null,
    buildMethod: string | null = 'dockerfile',
  ): void {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, parent_project_id, build_method, source, status)
         VALUES (?, ?, ?, ?, 'git', 'stopped')`,
      )
      .run(id, name, parentProjectId, buildMethod);
  }

  it('compose-child group rows survive through 0011 (0012 removes parent_project_id col)', () => {
    // Legacy compose stack: 1 parent + 2 children
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);
    // Plus a standalone deployable so we verify it's untouched
    insertLegacyProject('standalone-1', 'standalone', null, 'dockerfile');

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    // Post-0012 Phase G: parent_project_id is dropped from projects.
    // Post-0012 Phase F: compose-child rows are deleted from projects
    // (per-deployable FKs moved to services.id so child project rows no
    // longer needed). Only the parent group + standalone survive.
    const groups = sqlite
      .prepare(
        `SELECT id FROM projects WHERE id != ? ORDER BY id`,
      )
      .all('__orphan_managed') as Array<{ id: string }>;

    const ids = groups.map((g) => g.id).sort();
    // After 0012 Phase F, compose-child project rows are deleted; parent + standalone remain.
    expect(ids).toContain('cmp-parent');
    expect(ids).toContain('standalone-1');
    // Child rows deleted by 0012 Phase F (compose-child projects no longer needed).
    expect(ids).not.toContain('cmp-child-a');
    expect(ids).not.toContain('cmp-child-b');
  });

  it('keeps services rows for compose children intact', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const services = sqlite
      .prepare('SELECT id, kind, project_id, parent_service_id FROM services ORDER BY id')
      .all() as Array<{
      id: string;
      kind: string;
      project_id: string;
      parent_service_id: string | null;
    }>;

    // Three services: 1 compose parent + 2 compose-child, all under cmp-parent group.
    const parentSvc = services.find((s) => s.id === 'cmp-parent__svc');
    expect(parentSvc).toBeDefined();
    expect(parentSvc?.kind).toBe('compose');
    expect(parentSvc?.project_id).toBe('cmp-parent');
    expect(parentSvc?.parent_service_id).toBeNull();

    for (const childId of ['cmp-child-a__svc', 'cmp-child-b__svc']) {
      const child = services.find((s) => s.id === childId);
      expect(child).toBeDefined();
      expect(child?.kind).toBe('compose-child');
      expect(child?.project_id).toBe('cmp-parent');
      expect(child?.parent_service_id).toBe('cmp-parent__svc');
    }
  });

  it('re-points env_vars from child group to parent group', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);

    // Pre-0009 env_vars at child level (legacy schema)
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, environment_id, key, value)
         VALUES ('ev-1', 'cmp-child-a', NULL, 'API_KEY', 'child-val')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, environment_id, key, value)
         VALUES ('ev-2', 'cmp-parent', NULL, 'PARENT_KEY', 'parent-val')`,
      )
      .run();

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const evs = sqlite
      .prepare('SELECT id, project_id, key FROM env_vars ORDER BY id')
      .all() as Array<{ id: string; project_id: string; key: string }>;

    const childEv = evs.find((e) => e.id === 'ev-1');
    expect(childEv?.project_id, 'child env_var moved to parent group').toBe('cmp-parent');

    const parentEv = evs.find((e) => e.id === 'ev-2');
    expect(parentEv?.project_id).toBe('cmp-parent');
  });

  it('drops conflicting child env_vars when parent has same key', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);

    // Both parent + child have KEY 'SAME' — parent wins
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, environment_id, key, value)
         VALUES ('parent-ev', 'cmp-parent', NULL, 'SAME', 'parent-val')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, environment_id, key, value)
         VALUES ('child-ev', 'cmp-child-a', NULL, 'SAME', 'child-val')`,
      )
      .run();

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const remaining = sqlite
      .prepare(`SELECT id, value FROM env_vars WHERE project_id = 'cmp-parent' AND key = 'SAME'`)
      .all() as Array<{ id: string; value: string }>;

    expect(remaining.length, 'unique constraint kept only parent value').toBe(1);
    expect(remaining[0]?.id).toBe('parent-ev');
    expect(remaining[0]?.value).toBe('parent-val');
  });

  it('audit row written for each removed child group', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const audit = sqlite
      .prepare(`SELECT source_id, target_id FROM migration_0009_audit WHERE phase = '0010'`)
      .all() as Array<{ source_id: string; target_id: string }>;

    expect(audit.length).toBe(2);
    const ids = audit.map((a) => a.source_id).sort();
    expect(ids).toEqual(['cmp-child-a', 'cmp-child-b'].sort());
    for (const a of audit) {
      expect(a.target_id).toBe('cmp-parent');
    }
  });

  it('foreign_key_check passes after 0010', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });

  it('idempotent: re-running 0010 against clean state is a no-op', () => {
    // No compose children; only standalone projects
    insertLegacyProject('standalone-1', 's1', null, 'dockerfile');

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const before = sqlite.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;

    // Drop the migration record so we can re-run 0010 (in production this
    // would never happen, but verifies idempotency at the SQL level).
    sqlite
      .prepare(`DELETE FROM __drizzle_migrations WHERE hash = ?`)
      .run(
        createHash('sha256')
          .update(readFileSync(path.join(MIGRATIONS_FOLDER, '0010_cleanup_compose_child_groups.sql'), 'utf8'))
          .digest('hex'),
      );

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const after = sqlite.prepare('SELECT id FROM projects').all() as Array<{ id: string }>;
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });
});
