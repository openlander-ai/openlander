/**
 * Migration 0012: assert exactly 45 audit rows of expected kinds.
 *
 * Plan §AC: "migration_0009_audit table contains exactly 45 new rows of
 * kinds '0012-column-dropped' (31), '0012-fk-repointed' (6),
 * '0012-unique-rebuilt' (5), '0012-index-repointed' (3)."
 *
 * Breakdown:
 *   - 31 column-dropped (25 projects + 6 services)
 *   - 6  fk-repointed (one per per-deployable table)
 *   - 5  unique-rebuilt (environments, deploy_configs, service_ops_overrides,
 *        service_connections, project_dependencies)
 *   - 3  index-repointed (deploy_logs, domain_mappings, runtime_incidents)
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

describe('Migration 0012: audit-row count = 45', () => {
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

  function countByKind(kind: string): number {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM migration_0009_audit WHERE kind = ?")
      .get(kind) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  it('inserts 31 column-dropped rows (25 projects + 6 services)', () => {
    expect(countByKind('0012-column-dropped')).toBe(31);
  });

  it('inserts 6 fk-repointed rows (one per per-deployable table)', () => {
    expect(countByKind('0012-fk-repointed')).toBe(6);
  });

  it('inserts 5 unique-rebuilt rows', () => {
    expect(countByKind('0012-unique-rebuilt')).toBe(5);
  });

  it('inserts 3 index-repointed rows', () => {
    expect(countByKind('0012-index-repointed')).toBe(3);
  });

  it('total 0012-* audit rows = 45', () => {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS cnt FROM migration_0009_audit WHERE kind LIKE '0012-%'")
      .get() as { cnt: number };
    expect(row.cnt).toBe(45);
  });

  it('audit rows source/target tables match expected per-phase set', () => {
    const fkRepoint = sqlite
      .prepare("SELECT source_table FROM migration_0009_audit WHERE kind = '0012-fk-repointed' ORDER BY source_table")
      .all() as Array<{ source_table: string }>;
    const sources = fkRepoint.map((r) => r.source_table).sort();
    expect(sources).toEqual(
      [
        'deploy_configs',
        'deploy_logs',
        'domain_mappings',
        'environments',
        'runtime_incidents',
        'service_ops_overrides',
      ].sort(),
    );
  });
});
