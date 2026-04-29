/**
 * Migration 0012: assert UNIQUE-shape per repointed table per ADR.
 *
 * Plan §UNIQUE-shape ADR table:
 *   - environments         UNIQUE(service_id, type)
 *   - deploy_configs       UNIQUE(service_id)
 *   - service_ops_overrides UNIQUE(service_id)
 *   - service_connections  UNIQUE(service_id_consumer, service_id_provider)
 *   - domain_mappings      UNIQUE(domain) [unchanged constraint, INDEX repointed]
 *
 * Implementation: query sqlite_master / PRAGMA index_list to confirm each
 * UNIQUE / INDEX exists at the new shape.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDrizzleDatabase,
  type DrizzleClient,
  type SqliteDatabase,
} from '../../src/db/drizzle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

interface IndexListRow {
  name: string;
  unique: 0 | 1;
}

interface IndexInfoRow {
  name: string;
}

function indexColumns(sqlite: SqliteDatabase, indexName: string): string[] {
  return (sqlite.prepare(`PRAGMA index_info('${indexName}')`).all() as IndexInfoRow[]).map(
    (r) => r.name,
  );
}

function indexes(sqlite: SqliteDatabase, table: string): IndexListRow[] {
  return sqlite.prepare(`PRAGMA index_list('${table}')`).all() as IndexListRow[];
}

describe('Migration 0012: UNIQUE shape per ADR table', () => {
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

  it('environments: UNIQUE(service_id, type)', () => {
    const idxs = indexes(sqlite, 'environments').filter((i) => i.unique === 1);
    const target = idxs.find((i) => i.name === 'environments_service_type_unique');
    expect(target).toBeDefined();
    if (target) {
      expect(indexColumns(sqlite, target.name)).toEqual(['service_id', 'type']);
    }
  });

  it('deploy_configs: UNIQUE(service_id)', () => {
    const idxs = indexes(sqlite, 'deploy_configs').filter((i) => i.unique === 1);
    const hasServiceUnique = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.length === 1 && cols[0] === 'service_id';
    });
    expect(hasServiceUnique).toBe(true);
  });

  it('service_ops_overrides: UNIQUE(service_id)', () => {
    const idxs = indexes(sqlite, 'service_ops_overrides').filter((i) => i.unique === 1);
    const hasServiceUnique = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.length === 1 && cols[0] === 'service_id';
    });
    expect(hasServiceUnique).toBe(true);
  });

  it('service_connections: UNIQUE(service_id_consumer, service_id_provider)', () => {
    const idxs = indexes(sqlite, 'service_connections').filter((i) => i.unique === 1);
    const target = idxs.find((i) => i.name === 'service_connections_consumer_provider_idx');
    expect(target).toBeDefined();
    if (target) {
      expect(indexColumns(sqlite, target.name)).toEqual([
        'service_id_consumer',
        'service_id_provider',
      ]);
    }
  });

  it('domain_mappings: UNIQUE(domain) preserved', () => {
    const idxs = indexes(sqlite, 'domain_mappings').filter((i) => i.unique === 1);
    const hasDomainUnique = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.length === 1 && cols[0] === 'domain';
    });
    expect(hasDomainUnique).toBe(true);
  });

  it('deploy_logs INDEX moved from project_id to service_id', () => {
    const idxs = indexes(sqlite, 'deploy_logs');
    const hasServiceIdx = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.includes('service_id');
    });
    const hasProjectIdx = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.length === 1 && cols[0] === 'project_id';
    });
    expect(hasServiceIdx).toBe(true);
    expect(hasProjectIdx).toBe(false);
  });

  it('runtime_incidents INDEX moved from project_id to service_id', () => {
    const idxs = indexes(sqlite, 'runtime_incidents');
    const hasServiceIdx = idxs.some((i) => {
      const cols = indexColumns(sqlite, i.name);
      return cols.includes('service_id');
    });
    expect(hasServiceIdx).toBe(true);
  });
});
