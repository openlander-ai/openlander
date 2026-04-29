/**
 * Migration 0009 — per-table FK re-point assertions.
 *
 * Plan §6.1 matrix. Each of the 11 FK tables gets a fixture row inserted
 * pre-migration (against the legacy schema) and the post-migration target
 * is asserted by reading the new column shape.
 *
 * Contestation tests cover the four ambiguous tables:
 *   - webhook_configs_stays_group: webhooks fire per repo branch (group event).
 *   - secret_files_stays_group:    files shared across compose children
 *                                  (verified at src/pipeline/compose.ts:668).
 *   - env_vars_compose_inheritance: env_vars stay group-level by default
 *                                   (compose.ts:525-554 .env generation).
 *   - compose_unwind_3_children:    parent + 3 children -> 1 group + 1 compose
 *                                   service + 3 compose-child services.
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

/**
 * Apply migrations 0000..0008 inline (mirroring applyAndRecordAllMigrations
 * in src/db/index.ts). Records hashes in __drizzle_migrations so the next
 * `migrate()` call applies only 0009. This lets tests insert legacy-schema
 * fixtures BEFORE 0009 runs, then run 0009 and assert the target shape.
 */
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

describe('migration 0009 — per-table FK mapping', () => {
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

  function insertProject(id: string, name: string, parentId?: string): void {
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, parent_project_id, source)
         VALUES (?, ?, 'https://x/y', 'main', ?, 'git')`,
      )
      .run(id, name, parentId ?? null);
  }

  it('environments: project_id -> service_id (id || __svc)', () => {
    insertProject('p-env-1', 'envtest');
    sqlite
      .prepare(
        `INSERT INTO environments (id, project_id, type, branch, status)
         VALUES ('p-env-1-prod', 'p-env-1', 'production', 'main', 'idle')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT service_id FROM environments WHERE id = ?')
      .get('p-env-1-prod') as { service_id: string };
    expect(row.service_id).toBe('p-env-1__svc');
  });

  it('deploy_logs: project_id -> service_id', () => {
    insertProject('p-dl-1', 'dltest');
    sqlite
      .prepare(
        `INSERT INTO deploy_logs (id, project_id, status, trigger_source)
         VALUES ('dl-1', 'p-dl-1', 'success', 'api')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT service_id FROM deploy_logs WHERE id = ?')
      .get('dl-1') as { service_id: string };
    expect(row.service_id).toBe('p-dl-1__svc');
  });

  it('domain_mappings: project_id -> service_id', () => {
    insertProject('p-dm-1', 'dmtest');
    sqlite
      .prepare(
        `INSERT INTO domain_mappings (id, project_id, domain)
         VALUES ('dm-1', 'p-dm-1', 'foo.example.com')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT service_id FROM domain_mappings WHERE id = ?')
      .get('dm-1') as { service_id: string };
    expect(row.service_id).toBe('p-dm-1__svc');
  });

  it('runtime_incidents: project_id -> service_id', () => {
    insertProject('p-ri-1', 'ritest');
    sqlite
      .prepare(
        `INSERT INTO runtime_incidents (id, project_id, category, created_at)
         VALUES ('ri-1', 'p-ri-1', 'crash', '2026-04-28T00:00:00Z')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT service_id FROM runtime_incidents WHERE id = ?')
      .get('ri-1') as { service_id: string };
    expect(row.service_id).toBe('p-ri-1__svc');
  });

  it('deploy_configs: project_id -> service_id', () => {
    insertProject('p-dc-1', 'dctest');
    sqlite
      .prepare(
        `INSERT INTO deploy_configs (id, project_id, config_json, config_version)
         VALUES ('dc-1', 'p-dc-1', '{}', 1)`,
      )
      .run();

    run0009(drizzle, sqlite);

    const row = sqlite
      .prepare('SELECT service_id FROM deploy_configs WHERE id = ?')
      .get('dc-1') as { service_id: string };
    expect(row.service_id).toBe('p-dc-1__svc');
  });

  it('project_ops_overrides -> service_ops_overrides (table rename + service_id)', () => {
    insertProject('p-ops-1', 'opstest');
    sqlite
      .prepare(
        `INSERT INTO project_ops_overrides (id, project_id, overrides_json)
         VALUES ('ops-1', 'p-ops-1', '{}')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%ops_overrides%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('service_ops_overrides');
    expect(tables.map((t) => t.name)).not.toContain('project_ops_overrides');

    const row = sqlite
      .prepare('SELECT service_id FROM service_ops_overrides WHERE id = ?')
      .get('ops-1') as { service_id: string };
    expect(row.service_id).toBe('p-ops-1__svc');
  });

  it('service_connections: post-0012 Phase D uses service_id_consumer/provider', () => {
    insertProject('p-sc-1', 'sctest');
    // Insert a managed service in the legacy services table
    sqlite
      .prepare(
        `INSERT INTO services (id, name, type, image, container_name, port, status)
         VALUES ('sv-1', 'mydb', 'postgres', 'postgres:16', 'mydb-c', 5432, 'running')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO service_connections (id, project_id, service_id, created_at)
         VALUES ('sc-1', 'p-sc-1', 'sv-1', '2026-04-28T00:00:00Z')`,
      )
      .run();

    run0009(drizzle, sqlite);

    // Post-0012 Phase D: service_id_app/db renamed to service_id_consumer/provider;
    // legacy project_id/service_id columns dropped.
    const row = sqlite
      .prepare(
        'SELECT service_id_consumer, service_id_provider FROM service_connections WHERE id = ?',
      )
      .get('sc-1') as {
      service_id_consumer: string;
      service_id_provider: string;
    };
    expect(row.service_id_consumer).toBe('p-sc-1__svc');
    expect(row.service_id_provider).toBe('sv-1');
  });

  it('project_dependencies: post-0012 Phase E uses source_service_id/target_service_id', () => {
    insertProject('p-pd-1', 'pdtest');
    insertProject('p-pd-2', 'pdtest2');
    sqlite
      .prepare(
        `INSERT INTO project_dependencies (id, source_project_id, target_project_id, target_service_id,
                                            dependency_type, source, created_at)
         VALUES ('pd-1', 'p-pd-1', 'p-pd-2', NULL, 'api', 'manual', '2026-04-28T00:00:00Z')`,
      )
      .run();

    run0009(drizzle, sqlite);

    // Post-0012 Phase E: source_service_id and target_service_id are the canonical
    // columns (target_managed_service_id renamed → target_service_id).
    // Legacy source_project_id/target_project_id/target_managed_service_id dropped.
    const row = sqlite
      .prepare(
        `SELECT source_service_id, target_service_id
         FROM project_dependencies WHERE id = ?`,
      )
      .get('pd-1') as {
      source_service_id: string;
      target_service_id: string | null;
    };
    expect(row.source_service_id).toBe('p-pd-1__svc');
    // target was NULL (project-to-project dep with no managed target) — stays NULL
    expect(row.target_service_id).toBeNull();
  });

  describe('contestation tests (the 4 ambiguous tables)', () => {
    it('webhook_configs_stays_group: webhook fixture FK still points at projects.id (no service_id added)', () => {
      insertProject('p-wh-1', 'whtest');
      sqlite
        .prepare(
          `INSERT INTO webhook_configs (id, project_id, source, secret, branch_filter)
           VALUES ('wh-1', 'p-wh-1', 'github', 'shh', 'main')`,
        )
        .run();

      run0009(drizzle, sqlite);

      const cols = (
        sqlite.prepare(`PRAGMA table_info('webhook_configs')`).all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(cols).not.toContain('service_id');

      const row = sqlite
        .prepare('SELECT project_id FROM webhook_configs WHERE id = ?')
        .get('wh-1') as { project_id: string };
      expect(row.project_id).toBe('p-wh-1');
    });

    it('secret_files_stays_group: secret_files FK stays at projects.id (group-shared)', () => {
      insertProject('p-sf-1', 'sftest');
      sqlite
        .prepare(
          `INSERT INTO secret_files (id, project_id, filename, encrypted_content, iv)
           VALUES ('sf-1', 'p-sf-1', 'cert.pem', 'enc', 'iv')`,
        )
        .run();

      run0009(drizzle, sqlite);

      const cols = (
        sqlite.prepare(`PRAGMA table_info('secret_files')`).all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(cols).not.toContain('service_id');

      const row = sqlite
        .prepare('SELECT project_id FROM secret_files WHERE id = ?')
        .get('sf-1') as { project_id: string };
      expect(row.project_id).toBe('p-sf-1');
    });

    it('env_vars_compose_inheritance: env_vars retains group-level project_id with NULL service_id', () => {
      insertProject('p-ev-parent', 'parent');
      insertProject('p-ev-child', 'child', 'p-ev-parent');
      sqlite
        .prepare(
          `INSERT INTO env_vars (id, project_id, environment_id, key, value)
           VALUES ('ev-1', 'p-ev-parent', NULL, 'DB_HOST', 'db.local')`,
        )
        .run();

      run0009(drizzle, sqlite);

      const row = sqlite
        .prepare('SELECT project_id, service_id FROM env_vars WHERE id = ?')
        .get('ev-1') as { project_id: string; service_id: string | null };
      expect(row.project_id).toBe('p-ev-parent'); // group-shared
      expect(row.service_id).toBeNull(); // NULL = applies to whole group
    });

    it('compose_unwind_3_children: parent + 3 children -> 1 group + 1 compose service + 3 compose-child services', () => {
      insertProject('p-cu-parent', 'compose-parent');
      insertProject('p-cu-c1', 'web', 'p-cu-parent');
      insertProject('p-cu-c2', 'api', 'p-cu-parent');
      insertProject('p-cu-c3', 'worker', 'p-cu-parent');
      // Mark parent as compose
      sqlite
        .prepare(`UPDATE projects SET build_method = 'compose' WHERE id = 'p-cu-parent'`)
        .run();

      run0009(drizzle, sqlite);

      // 4 group rows preserved (P1 additive), but only the compose parent
      // expects a kind='compose' service. Children expect kind='compose-child'
      // with parent_service_id pointing at p-cu-parent__svc.
      const services = sqlite
        .prepare(`SELECT id, project_id, kind, parent_service_id FROM services WHERE id LIKE 'p-cu-%'`)
        .all() as Array<{ id: string; project_id: string; kind: string; parent_service_id: string | null }>;

      const byId = new Map(services.map((s) => [s.id, s]));
      expect(byId.get('p-cu-parent__svc')?.kind).toBe('compose');
      expect(byId.get('p-cu-parent__svc')?.parent_service_id).toBeNull();

      for (const childId of ['p-cu-c1', 'p-cu-c2', 'p-cu-c3']) {
        const svc = byId.get(`${childId}__svc`);
        expect(svc?.kind).toBe('compose-child');
        expect(svc?.parent_service_id).toBe('p-cu-parent__svc');
        // Children share parent's group via project_id
        expect(svc?.project_id).toBe('p-cu-parent');
      }
    });
  });

  it('foreign_key_check passes after migration with realistic fixture data', () => {
    insertProject('p-fk-1', 'fktest');
    insertProject('p-fk-2', 'fktest2', 'p-fk-1');
    sqlite
      .prepare(
        `INSERT INTO env_vars (id, project_id, environment_id, key, value)
         VALUES ('ev-1', 'p-fk-1', NULL, 'KEY', 'val')`,
      )
      .run();

    run0009(drizzle, sqlite);

    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });

  it('Phase E normalizes legacy services.type to canonical kind enum (post-0012: only kind survives)', () => {
    // Production data found 'postgresql' / 'pgvector' / 'flaresolverr' on
    // managed services — none match the new kind CHECK enum verbatim. Phase E
    // must normalize via CASE so the migration doesn't trip the constraint.
    const legacyTypes: Array<{ id: string; name: string; type: string; expected: string }> = [
      { id: 'sv-pgsql', name: 'pgsql-1', type: 'postgresql', expected: 'postgres' },
      { id: 'sv-pgvec', name: 'pgvec-1', type: 'pgvector', expected: 'postgres' },
      { id: 'sv-pg', name: 'pg-1', type: 'postgres', expected: 'postgres' },
      { id: 'sv-mariadb', name: 'maria-1', type: 'mariadb', expected: 'mysql' },
      { id: 'sv-mysql', name: 'mysql-1', type: 'mysql', expected: 'mysql' },
      { id: 'sv-redis', name: 'redis-1', type: 'redis', expected: 'redis' },
      { id: 'sv-keydb', name: 'keydb-1', type: 'keydb', expected: 'redis' },
      { id: 'sv-mongodb', name: 'mongo-1', type: 'mongodb', expected: 'mongo' },
      { id: 'sv-mongo', name: 'mongo-2', type: 'mongo', expected: 'mongo' },
      { id: 'sv-minio', name: 'minio-1', type: 'minio', expected: 'minio' },
      { id: 'sv-flare', name: 'flare-1', type: 'flaresolverr', expected: 'image' },
      { id: 'sv-custom', name: 'custom-1', type: 'something-else', expected: 'image' },
    ];

    // Managed services often share container-internal ports (multiple
    // postgres instances on 5432). Phase E does NOT copy legacy `port`
    // into the post-migration `assigned_port` column (which is UNIQUE for
    // deployable host-port allocation); managed rows get assigned_port
    // NULL. Post-0012 Phase C drops `type` and `port` from services entirely.
    // This fixture deliberately collides ports to assert assigned_port stays NULL.
    for (const fix of legacyTypes) {
      sqlite
        .prepare(
          `INSERT INTO services (id, name, type, image, container_name, port, status)
           VALUES (?, ?, ?, 'img:latest', ?, 5432, 'running')`,
        )
        .run(fix.id, fix.name, fix.type, `${fix.id}-c`);
    }

    run0009(drizzle, sqlite);

    for (const fix of legacyTypes) {
      // Post-0012: type and port columns no longer exist; only kind and assigned_port.
      const row = sqlite
        .prepare('SELECT kind, assigned_port FROM services WHERE id = ?')
        .get(fix.id) as {
        kind: string;
        assigned_port: number | null;
      };
      expect(row.kind, `kind for legacy type=${fix.type}`).toBe(fix.expected);
      // assigned_port stays NULL on managed rows (UNIQUE collision avoidance).
      expect(row.assigned_port, `assigned_port NULL for managed ${fix.id}`).toBeNull();
    }
  });
});
