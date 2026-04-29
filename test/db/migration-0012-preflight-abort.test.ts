/**
 * Migration 0012: pre-flight NULL-orphan assertions abort the migration.
 *
 * Codex reproduced: a deploy_logs row with service_id = NULL had count
 * 1 → 0 after 0012 with no error. This test pins that fix — the Phase A
 * NULL-orphan triggers must ABORT the migration when any affected table
 * contains a row with a NULL FK that would otherwise be silently dropped.
 *
 * Per-table coverage (8 assertions):
 *   Phase B: environments, deploy_configs, deploy_logs, domain_mappings,
 *            runtime_incidents, service_ops_overrides
 *   Phase D: service_connections (NULL service_id_app or service_id_db)
 *   Phase E: project_dependencies (NULL source_service_id)
 *
 * Test strategy: for each table, seed the pre-0012 schema to the state
 * just before 0012 runs (migrations 0000-0011), insert one NULL-FK row,
 * then run 0012 and assert the migrator throws. The row count must still
 * equal 1 after the abort (no data lost, no partial apply).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from '../../src/db/drizzle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, '..', '..', 'drizzle');

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

/** Build a temp migrations folder with only 0000-0011 (pre-0012 state). */
function buildPre0012MigrationsFolder(): string {
  const tmp = mkdtempSync(path.join(tmpdir(), 'drizzle-preflight-'));
  const metaDir = path.join(tmp, 'meta');
  mkdirSync(metaDir, { recursive: true });

  for (const tag of PRE_0012_TAGS) {
    copyFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), path.join(tmp, `${tag}.sql`));
  }

  const fullJournal = JSON.parse(
    readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as {
    version: string;
    dialect: string;
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };

  const pre0012Journal = {
    version: fullJournal.version,
    dialect: fullJournal.dialect,
    entries: fullJournal.entries.filter((e) => e.idx <= 11),
  };
  writeFileSync(path.join(metaDir, '_journal.json'), JSON.stringify(pre0012Journal, null, 2));

  return tmp;
}

/** Build a single-migration folder containing only 0012. */
function build0012OnlyMigrationsFolder(pre0012Folder: string): string {
  const tmp = mkdtempSync(path.join(tmpdir(), 'drizzle-0012only-'));
  const metaDir = path.join(tmp, 'meta');
  mkdirSync(metaDir, { recursive: true });

  const tag = '0012_complete_schema_split';
  copyFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), path.join(tmp, `${tag}.sql`));

  // Journal contains only 0012 so Drizzle applies only that migration.
  const fullJournal = JSON.parse(
    readFileSync(path.join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as {
    version: string;
    dialect: string;
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };

  const journal = {
    version: fullJournal.version,
    dialect: fullJournal.dialect,
    entries: fullJournal.entries.filter((e) => e.idx === 12),
  };
  writeFileSync(path.join(metaDir, '_journal.json'), JSON.stringify(journal, null, 2));

  // Copy pre0012 journal's meta hash file (snapshot) if it exists
  const snapshotSrc = path.join(pre0012Folder, 'meta', '_journal.json');
  void snapshotSrc; // not needed; Drizzle only reads the folder we give it

  return tmp;
}

/**
 * Seed the DB to pre-0012 state, run the seeder callback to insert a NULL row,
 * then attempt to run 0012 — assert the migration throws (ABORT fires).
 * Returns: [sqlite handle after attempted 0012, row count in the table].
 */
function runPreflightAbortScenario(
  seeder: (sqlite: SqliteDatabase, drizzle: DrizzleClient) => void,
  rowCountQuery: (sqlite: SqliteDatabase) => number,
): { threw: boolean; rowCountAfter: number } {
  const pre0012Folder = buildPre0012MigrationsFolder();
  const { sqlite, db: drizzle } = createDrizzleDatabase(':memory:');

  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    // Apply 0000-0011 first
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: pre0012Folder });

    // Seed the NULL-FK row
    seeder(sqlite, drizzle);

    // Now attempt 0012 — expect it to throw
    const folder0012 = build0012OnlyMigrationsFolder(pre0012Folder);
    let threw = false;
    try {
      migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: folder0012 });
    } catch (_err) {
      threw = true;
    }

    const rowCountAfter = rowCountQuery(sqlite);
    return { threw, rowCountAfter };
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.close();
  }
}

describe('Migration 0012: Phase A NULL-orphan pre-flight assertions ABORT', () => {
  it('environments: NULL service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO environments (id, project_id, service_id, type, branch, status, created_at, updated_at, server_id)
           VALUES ('env-null-test', 'test-proj', NULL, 'production', 'main', 'idle', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'local')`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM environments WHERE id = 'env-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in environments').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row should still exist after abort (not silently deleted)').toBe(1);
  });

  it('deploy_configs: NULL service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO deploy_configs (id, project_id, service_id, config_json, config_version, created_at, updated_at)
           VALUES ('dc-null-test', 'test-proj', NULL, '{}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM deploy_configs WHERE id = 'dc-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in deploy_configs').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row should still exist after abort').toBe(1);
  });

  it('deploy_logs: NULL service_id → ABORT, row preserved (Codex repro)', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO deploy_logs (id, project_id, service_id, status, created_at, server_id)
           VALUES ('dl-null-test', 'test-proj', NULL, 'success', CURRENT_TIMESTAMP, 'local')`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM deploy_logs WHERE id = 'dl-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in deploy_logs').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row count must remain 1 — Codex silent-delete repro fixed').toBe(1);
  });

  it('domain_mappings: NULL service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO domain_mappings (id, project_id, service_id, domain, status, created_at)
           VALUES ('dm-null-test', 'test-proj', NULL, 'null-orphan.example.com', 'active', CURRENT_TIMESTAMP)`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM domain_mappings WHERE id = 'dm-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in domain_mappings').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row should still exist after abort').toBe(1);
  });

  it('runtime_incidents: NULL service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO runtime_incidents (id, project_id, service_id, category, resolved, created_at, server_id)
           VALUES ('ri-null-test', 'test-proj', NULL, 'crash', 0, CURRENT_TIMESTAMP, 'local')`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM runtime_incidents WHERE id = 'ri-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in runtime_incidents').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row should still exist after abort').toBe(1);
  });

  it('service_ops_overrides: NULL service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO service_ops_overrides (id, project_id, service_id, overrides_json, created_at, updated_at)
           VALUES ('soo-null-test', 'test-proj', NULL, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM service_ops_overrides WHERE id = 'soo-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id in service_ops_overrides').toBe(true);
    expect(rowCountAfter, 'NULL-service_id row should still exist after abort').toBe(1);
  });

  it('service_connections: NULL service_id_app → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO service_connections (id, project_id, service_id, service_id_app, service_id_db, created_at, server_id)
           VALUES ('sc-null-app', 'test-proj', 'some-legacy-svc', NULL, 'some-db-svc', CURRENT_TIMESTAMP, 'local')`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM service_connections WHERE id = 'sc-null-app'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL service_id_app in service_connections').toBe(true);
    expect(rowCountAfter, 'NULL-FK row should still exist after abort').toBe(1);
  });

  it('project_dependencies: NULL source_service_id → ABORT, row preserved', () => {
    const { threw, rowCountAfter } = runPreflightAbortScenario(
      (sqlite) => {
        sqlite.exec(`INSERT OR IGNORE INTO projects (id, name, server_id) VALUES ('test-proj', 'test-proj', 'local')`);
        sqlite.exec(
          `INSERT INTO project_dependencies (id, source_project_id, source_service_id, dependency_type, source, created_at)
           VALUES ('pd-null-test', 'test-proj', NULL, 'custom', 'manual', CURRENT_TIMESTAMP)`,
        );
      },
      (sqlite) => {
        const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM project_dependencies WHERE id = 'pd-null-test'").get() as { cnt: number };
        return row.cnt;
      },
    );
    expect(threw, 'Migration should have thrown on NULL source_service_id in project_dependencies').toBe(true);
    expect(rowCountAfter, 'NULL-source_service_id row should still exist after abort').toBe(1);
  });
});
