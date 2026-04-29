/**
 * Migration 0009 smoke test — applies the migration on an in-memory SQLite
 * (empty DB) and asserts the post-migration shape.
 *
 * Plan reference: .omc/plans/ralplan-data-model-full-migration.md §6.3.
 *
 * This is the minimal "does it apply at all" gate. The richer FK-mapping,
 * compose-unwind, audit-log, and roundtrip tests live in their own files.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDrizzleDatabase,
  type SqliteDatabase,
  type DrizzleClient,
} from '../../src/db/drizzle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

function getColumnNames(sqlite: SqliteDatabase, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>)
    .map((r) => r.name)
    .sort();
}

function getTableNames(sqlite: SqliteDatabase): Set<string> {
  return new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name),
  );
}

describe('migration 0009 smoke (empty DB)', () => {
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  });

  afterEach(() => {
    sqlite.close();
  });

  it('drops legacy tables', () => {
    const tables = getTableNames(sqlite);
    expect(tables.has('projects_legacy')).toBe(false);
    expect(tables.has('services_legacy')).toBe(false);
  });

  it('renames project_ops_overrides -> service_ops_overrides', () => {
    const tables = getTableNames(sqlite);
    expect(tables.has('service_ops_overrides')).toBe(true);
    expect(tables.has('project_ops_overrides')).toBe(false);
  });

  it('creates migration_0009_audit table with the synthesized __orphan_managed row', () => {
    const tables = getTableNames(sqlite);
    expect(tables.has('migration_0009_audit')).toBe(true);

    const orphanGroup = sqlite
      .prepare("SELECT id FROM projects WHERE id = '__orphan_managed'")
      .get() as { id: string } | undefined;
    expect(orphanGroup?.id).toBe('__orphan_managed');

    const phaseC = sqlite
      .prepare("SELECT COUNT(*) as cnt FROM migration_0009_audit WHERE phase = 'C'")
      .get() as { cnt: number };
    expect(phaseC.cnt).toBeGreaterThanOrEqual(1);
  });

  it('new projects table has group columns (post-0012: deployable cols moved to services)', () => {
    const cols = new Set(getColumnNames(sqlite, 'projects'));
    // Plan §6.2 group-only columns — these survive through 0012
    for (const c of ['id', 'name', 'repo_url', 'branch', 'archived_at', 'created_at',
                     'updated_at', 'server_id']) {
      expect(cols.has(c)).toBe(true);
    }
    // Post-0012 (Phase G): all 25 deployable/legacy cols dropped from projects.
    // These were P1 back-compat in 0009 but are gone after 0012.
    for (const c of ['status', 'assigned_port', 'parent_project_id', 'build_method']) {
      expect(cols.has(c)).toBe(false);
    }
  });

  it('new services table has the unified deployable+managed shape (post-0012)', () => {
    const cols = new Set(getColumnNames(sqlite, 'services'));
    // Required core
    for (const c of ['id', 'project_id', 'name', 'kind', 'parent_service_id']) {
      expect(cols.has(c)).toBe(true);
    }
    // Deployable-specific columns — survive 0012
    for (const c of [
      'status',
      'assigned_port',
      'container_id',
      'container_name',
      'container_port',
      'image_tag',
      'public_url',
      'dockerfile_path',
      'build_method',
      'source',
      'is_preview',
      'project_type',
    ]) {
      expect(cols.has(c)).toBe(true);
    }
    // credentials survives through 1.0 per ADR.
    expect(cols.has('credentials')).toBe(true);
    // Post-0012 (Phase C): legacy managed-only cols dropped from services.
    for (const c of ['type', 'image', 'port', 'env_vars']) {
      expect(cols.has(c)).toBe(false);
    }
  });

  it('FK Phase F+0012: per-deployable tables use service_id; connections/deps fully rebuilt', () => {
    expect(getColumnNames(sqlite, 'environments')).toContain('service_id');
    expect(getColumnNames(sqlite, 'env_vars')).toContain('service_id');
    expect(getColumnNames(sqlite, 'deploy_logs')).toContain('service_id');
    expect(getColumnNames(sqlite, 'domain_mappings')).toContain('service_id');
    expect(getColumnNames(sqlite, 'runtime_incidents')).toContain('service_id');
    expect(getColumnNames(sqlite, 'deploy_configs')).toContain('service_id');
    expect(getColumnNames(sqlite, 'service_ops_overrides')).toContain('service_id');
    // service_connections: post-0012 Phase D renamed service_id_app/db →
    // service_id_consumer/provider; legacy project_id/service_id/service_id_app/
    // service_id_db all dropped.
    const scCols = new Set(getColumnNames(sqlite, 'service_connections'));
    expect(scCols.has('service_id_consumer')).toBe(true);
    expect(scCols.has('service_id_provider')).toBe(true);
    expect(scCols.has('service_id_app')).toBe(false);
    expect(scCols.has('service_id_db')).toBe(false);
    expect(scCols.has('project_id')).toBe(false);
    expect(scCols.has('service_id')).toBe(false);
    // project_dependencies: post-0012 Phase E promoted source_service_id,
    // renamed target_managed_service_id → target_service_id; legacy
    // source_project_id/target_project_id/target_managed_service_id all dropped.
    const pdCols = new Set(getColumnNames(sqlite, 'project_dependencies'));
    expect(pdCols.has('source_service_id')).toBe(true);
    expect(pdCols.has('target_service_id')).toBe(true);
    expect(pdCols.has('target_managed_service_id')).toBe(false);
    expect(pdCols.has('source_project_id')).toBe(false);
    expect(pdCols.has('target_project_id')).toBe(false);
  });

  it('foreign_key_check returns no violations on the migrated empty DB', () => {
    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });

  it('webhook_configs and secret_files keep group-level project_id (no service_id added)', () => {
    expect(getColumnNames(sqlite, 'webhook_configs')).not.toContain('service_id');
    expect(getColumnNames(sqlite, 'secret_files')).not.toContain('service_id');
  });

  it('services indexes exist', () => {
    const indexes = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'services'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(indexes).toContain('idx_services_project');
    expect(indexes).toContain('idx_services_kind');
    expect(indexes).toContain('idx_services_parent');
  });
});
