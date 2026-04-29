/**
 * Migration 0012: assert that the 6 per-deployable FK tables target
 * services(id) post-migration. Replaces the pre-0012 project_id FK with
 * service_id NOT NULL REFERENCES services(id) ON DELETE CASCADE.
 *
 * Plan §AC: "No FK from any of {environments, deploy_configs, deploy_logs,
 * domain_mappings, runtime_incidents, service_ops_overrides} targets
 * projects(id). Each carries `service_id NOT NULL REFERENCES services(id)
 * ON DELETE CASCADE`."
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

const FK_REPOINT_TABLES = [
  'environments',
  'deploy_configs',
  'deploy_logs',
  'domain_mappings',
  'runtime_incidents',
  'service_ops_overrides',
] as const;

interface FkListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

describe('Migration 0012: per-deployable FK repoint to services(id)', () => {
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

  for (const tbl of FK_REPOINT_TABLES) {
    it(`${tbl} has FK to services(id) and no FK to projects(id)`, () => {
      const fks = sqlite.prepare(`PRAGMA foreign_key_list('${tbl}')`).all() as FkListRow[];
      const projectsFk = fks.find((f) => f.table === 'projects');
      const servicesFk = fks.find((f) => f.table === 'services');

      expect(projectsFk, `${tbl} should NOT have FK to projects`).toBeUndefined();
      expect(servicesFk, `${tbl} should have FK to services`).toBeDefined();
      expect(servicesFk?.from, `${tbl} FK column should be service_id`).toBe('service_id');
      expect(servicesFk?.on_delete, `${tbl} ON DELETE should be CASCADE`).toBe('CASCADE');
    });
  }

  it('PRAGMA foreign_key_check returns 0 violations', () => {
    const violations = sqlite.pragma('foreign_key_check');
    expect(violations).toEqual([]);
  });
});
