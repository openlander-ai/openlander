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

  it('new projects table has group columns plus retained legacy columns (P1 back-compat)', () => {
    const cols = new Set(getColumnNames(sqlite, 'projects'));
    // Plan §6.2 group-only columns
    for (const c of ['id', 'name', 'repo_url', 'branch', 'archived_at', 'created_at',
                     'updated_at', 'server_id']) {
      expect(cols.has(c)).toBe(true);
    }
    // P1 back-compat retained from legacy projects shape (deprecated; trimmed
    // post-P3). Plan §6.5 backward-compat helper note.
    for (const c of ['status', 'assigned_port', 'parent_project_id', 'build_method']) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it('new services table has the unified deployable+managed shape', () => {
    const cols = new Set(getColumnNames(sqlite, 'services'));
    // Required core
    for (const c of ['id', 'project_id', 'name', 'kind', 'parent_service_id']) {
      expect(cols.has(c)).toBe(true);
    }
    // Deployable-specific
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
    // Legacy managed-only columns retained for P1 back-compat
    for (const c of ['type', 'image', 'port', 'env_vars', 'credentials']) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it('FK Phase F: 11 tables receive their column changes (additive)', () => {
    expect(getColumnNames(sqlite, 'environments')).toContain('service_id');
    expect(getColumnNames(sqlite, 'env_vars')).toContain('service_id');
    expect(getColumnNames(sqlite, 'deploy_logs')).toContain('service_id');
    expect(getColumnNames(sqlite, 'domain_mappings')).toContain('service_id');
    expect(getColumnNames(sqlite, 'runtime_incidents')).toContain('service_id');
    expect(getColumnNames(sqlite, 'deploy_configs')).toContain('service_id');
    expect(getColumnNames(sqlite, 'service_ops_overrides')).toContain('service_id');
    // service_connections: ADD service_id_app/service_id_db alongside
    // legacy project_id/service_id (P1 back-compat).
    const scCols = new Set(getColumnNames(sqlite, 'service_connections'));
    expect(scCols.has('service_id_app')).toBe(true);
    expect(scCols.has('service_id_db')).toBe(true);
    expect(scCols.has('project_id')).toBe(true);
    expect(scCols.has('service_id')).toBe(true);
    // project_dependencies: ADD source_service_id/target_managed_service_id
    // alongside legacy source_project_id/target_project_id/target_service_id.
    const pdCols = new Set(getColumnNames(sqlite, 'project_dependencies'));
    expect(pdCols.has('source_service_id')).toBe(true);
    expect(pdCols.has('target_managed_service_id')).toBe(true);
    expect(pdCols.has('source_project_id')).toBe(true);
    expect(pdCols.has('target_project_id')).toBe(true);
    expect(pdCols.has('target_service_id')).toBe(true);
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
