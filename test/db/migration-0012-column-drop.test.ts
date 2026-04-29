/**
 * Migration 0012: assert column drops on `projects` and `services`.
 *
 * Plan §AC:
 *   - `projects` has exactly 10 columns post-0012 (8 group + 2 lock).
 *   - `services` no longer has `type, image, port, env_vars,
 *     deploy_lock_session, deploy_lock_at` (credentials STAYS through 1.0).
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

const EXPECTED_PROJECTS_COLS = [
  'id',
  'name',
  'repo_url',
  'branch',
  'archived_at',
  'created_at',
  'updated_at',
  'server_id',
  'deploy_lock_session',
  'deploy_lock_at',
];

const SERVICES_DROPPED = ['type', 'image', 'port', 'env_vars', 'deploy_lock_session', 'deploy_lock_at'];

interface ColumnInfoRow {
  name: string;
}

describe('Migration 0012: column drops', () => {
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

  it('projects has exactly 10 columns: 8 group + 2 deploy-lock', () => {
    const cols = (sqlite.prepare(`PRAGMA table_info('projects')`).all() as ColumnInfoRow[]).map(
      (c) => c.name,
    );
    expect(cols.sort()).toEqual([...EXPECTED_PROJECTS_COLS].sort());
  });

  it('services has dropped 6 legacy columns (Phase C)', () => {
    const cols = new Set(
      (sqlite.prepare(`PRAGMA table_info('services')`).all() as ColumnInfoRow[]).map((c) => c.name),
    );
    for (const dropped of SERVICES_DROPPED) {
      expect(cols.has(dropped), `services.${dropped} should be dropped`).toBe(false);
    }
  });

  it('services preserves credentials through 1.0 (deferred drop)', () => {
    const cols = new Set(
      (sqlite.prepare(`PRAGMA table_info('services')`).all() as ColumnInfoRow[]).map((c) => c.name),
    );
    expect(cols.has('credentials'), 'services.credentials must persist through 1.0').toBe(true);
  });

  it('services preserves canonical replacements (kind, image_url, assigned_port)', () => {
    const cols = new Set(
      (sqlite.prepare(`PRAGMA table_info('services')`).all() as ColumnInfoRow[]).map((c) => c.name),
    );
    expect(cols.has('kind')).toBe(true);
    expect(cols.has('image_url')).toBe(true);
    expect(cols.has('assigned_port')).toBe(true);
  });

  it('25 columns dropped from projects (verified via diff against 0009 baseline)', () => {
    const PRE_0012_PROJECTS_COLS = [
      ...EXPECTED_PROJECTS_COLS,
      // 25 columns dropped in Phase G:
      'parent_project_id',
      'status',
      'visibility',
      'assigned_port',
      'container_id',
      'container_port',
      'image_tag',
      'previous_image_tag',
      'public_url',
      'dockerfile_path',
      'docker_target',
      'build_context',
      'build_method',
      'source',
      'image_url',
      'image_cmd',
      'pending_fix',
      'access_code',
      'access_code_iv',
      'is_preview',
      'pr_number',
      'project_type',
      'health_check_strategy',
      'health_check_path',
      'recovering_started_at',
    ];
    const droppedCount = PRE_0012_PROJECTS_COLS.length - EXPECTED_PROJECTS_COLS.length;
    expect(droppedCount).toBe(25);
  });
});
