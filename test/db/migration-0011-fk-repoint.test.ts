/**
 * Migration 0011 — reconstruct compose-child group rows that 0010
 * deleted, so per-deployable FK tables (environments, deploy_logs,
 * deploy_configs, etc.) keep their legacy project_id pointing at a
 * row that exists.
 *
 * The user-visible "3 projects shown when it should be 1" cleanup
 * happens at the UI/API filtering layer (post-1.0 patch), not by
 * deleting the projects rows.
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
];

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

function applyPre0009(sqlite: SqliteDatabase): void {
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
  for (const tag of PRE_0009_TAGS) {
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    sqlite.exec(sql);
    insertHash.run(createHash('sha256').update(sql).digest('hex'), PRE_0009_FOLDER_MILLIS[tag]!);
  }
  sqlite.pragma('foreign_keys = ON');
}

describe('Migration 0011: reconstruct compose-child group rows', () => {
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
    applyPre0009(sqlite);
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

  it('post-0012: only compose parent group row survives (child rows deleted by Phase F)', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    // 0011 reconstructs child project rows so legacy FK tables keep valid references.
    // 0012 Phase F then deletes compose-child rows from projects (per-deployable FKs
    // moved to services.id in Phase B, so child project rows are no longer needed).
    // Post-0012: only the parent group row remains; parent_project_id col is also gone.
    const groups = sqlite
      .prepare(`SELECT id FROM projects WHERE id LIKE 'cmp-%' ORDER BY id`)
      .all() as Array<{ id: string }>;

    const ids = groups.map((g) => g.id);
    expect(ids).toContain('cmp-parent');
    expect(ids).not.toContain('cmp-child-a');
    expect(ids).not.toContain('cmp-child-b');

    // Services rows (kind='compose'/'compose-child') still exist for compose children.
    const services = sqlite
      .prepare(`SELECT id, kind FROM services WHERE id LIKE 'cmp-%' ORDER BY id`)
      .all() as Array<{ id: string; kind: string }>;
    const svcIds = services.map((s) => s.id);
    expect(svcIds).toContain('cmp-parent__svc');
    expect(svcIds).toContain('cmp-child-a__svc');
    expect(svcIds).toContain('cmp-child-b__svc');
  });

  it('foreign_key_check passes after 0011 with per-deployable FK rows', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);

    sqlite
      .prepare(
        `INSERT INTO environments (id, project_id, type, branch)
         VALUES ('env-a', 'cmp-child-a', 'production', 'main')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO environments (id, project_id, type, branch)
         VALUES ('env-b', 'cmp-child-b', 'production', 'main')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO deploy_configs (id, project_id, config_json)
         VALUES ('dc-a', 'cmp-child-a', '{}')`,
      )
      .run();

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    // No FK violations: child group rows exist again.
    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });

  it('audit log records each reconstruction', () => {
    insertLegacyProject('cmp-parent', 'mystack', null, 'compose');
    insertLegacyProject('cmp-child-a', 'mystack/api', 'cmp-parent', null);
    insertLegacyProject('cmp-child-b', 'mystack/web', 'cmp-parent', null);

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const audit = sqlite
      .prepare(`SELECT target_id FROM migration_0009_audit WHERE phase = '0011' ORDER BY target_id`)
      .all() as Array<{ target_id: string }>;
    expect(audit.map((r) => r.target_id).sort()).toEqual(['cmp-child-a', 'cmp-child-b'].sort());
  });

  it('idempotent on a clean DB without compose children', () => {
    insertLegacyProject('standalone-1', 's1', null, 'dockerfile');

    sqlite.pragma('foreign_keys = OFF');
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.pragma('foreign_keys = ON');

    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });
});
