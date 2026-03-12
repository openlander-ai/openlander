import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../src/db/index.js';

type LegacySqlite = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown; all: () => unknown };
  close: () => void;
};

function createLegacySqlite(dbPath: string, readonly = false): LegacySqlite {
  const require = createRequire(import.meta.url);
  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

  if (isBunRuntime) {
    const BunSqlite = require('bun:sqlite') as {
      Database: new (path: string, options?: { readonly?: boolean }) => LegacySqlite;
    };
    return new BunSqlite.Database(dbPath, readonly ? { readonly: true } : undefined);
  }

  const BetterSqlite3 = require('better-sqlite3') as new (
    path: string,
    options?: { readonly?: boolean },
  ) => LegacySqlite;
  return new BetterSqlite3(dbPath, readonly ? { readonly: true } : undefined);
}

describe('Database environments', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-environments-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-creates a production environment when creating a project', () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

    const environments = db.getEnvironmentsByProject('p1');
    expect(environments).toHaveLength(1);
    expect(environments[0]!.project_id).toBe('p1');
    expect(environments[0]!.type).toBe('production');
    expect(environments[0]!.branch).toBe('main');
    expect(environments[0]!.status).toBe('idle');
  });

  it('supports environment CRUD operations', () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

    const created = db.createEnvironment({
      id: 'env-staging',
      projectId: 'p1',
      type: 'staging',
      branch: 'release',
      status: 'building',
      containerId: 'container-1',
      assignedPort: 32100,
      imageTag: 'image:v1',
      previousImageTag: 'image:v0',
      publicUrl: 'https://staging.example.com',
    });

    expect(created.id).toBe('env-staging');
    expect(created.type).toBe('staging');

    const fetched = db.getEnvironment('env-staging');
    expect(fetched).toBeDefined();
    expect(fetched!.branch).toBe('release');
    expect(fetched!.assigned_port).toBe(32100);

    const development = db.createEnvironment({
      id: 'env-development',
      projectId: 'p1',
      type: 'development',
      branch: 'dev',
    });
    expect(development.type).toBe('development');
    expect(development.status).toBe('idle');

    db.updateEnvironment('env-staging', {
      status: 'running',
      branch: 'release-hotfix',
      containerId: 'container-2',
      assignedPort: 32101,
      imageTag: 'image:v2',
      previousImageTag: 'image:v1',
      publicUrl: 'https://staging2.example.com',
    });

    const updated = db.getEnvironment('env-staging');
    expect(updated!.status).toBe('running');
    expect(updated!.branch).toBe('release-hotfix');
    expect(updated!.container_id).toBe('container-2');
    expect(updated!.assigned_port).toBe(32101);
    expect(updated!.image_tag).toBe('image:v2');
    expect(updated!.previous_image_tag).toBe('image:v1');
    expect(updated!.public_url).toBe('https://staging2.example.com');

    db.deleteEnvironment('env-staging');
    expect(db.getEnvironment('env-staging')).toBeUndefined();
  });

  it('enforces unique (project_id, type) in environments', () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

    expect(() =>
      db.createEnvironment({
        id: 'env-prod-2',
        projectId: 'p1',
        type: 'production',
        branch: 'main',
      }),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('migrates legacy project runtime fields into production environment rows', () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'openlander-legacy-environments-test-'));
    const legacyDbPath = join(legacyDir, 'legacy.db');

    const legacy = createLegacySqlite(legacyDbPath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        repo_url TEXT,
        branch TEXT DEFAULT 'main',
        status TEXT DEFAULT 'stopped',
        visibility TEXT DEFAULT 'internal',
        assigned_port INTEGER UNIQUE,
        container_id TEXT,
        image_tag TEXT,
        previous_image_tag TEXT,
        public_url TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE env_vars (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, key)
      );
    `);

    legacy
      .prepare(
        'INSERT INTO projects (id, name, repo_url, branch, status, assigned_port, container_id, image_tag, previous_image_tag, public_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'legacy-p1',
        'legacy-app',
        'https://github.com/test/legacy',
        'release',
        'running',
        31000,
        'legacy-container',
        'legacy:v2',
        'legacy:v1',
        'https://legacy.example.com',
      );

    legacy
      .prepare('INSERT INTO env_vars (id, project_id, key, value) VALUES (?, ?, ?, ?)')
      .run('env1', 'legacy-p1', 'LEGACY_KEY', 'legacy-value');

    legacy.close();

    const migratedDb = new Database(legacyDbPath);

    const envs = migratedDb.getEnvironmentsByProject('legacy-p1');
    expect(envs).toHaveLength(1);
    expect(envs[0]!.type).toBe('production');
    expect(envs[0]!.branch).toBe('release');
    expect(envs[0]!.status).toBe('running');
    expect(envs[0]!.assigned_port).toBe(31000);
    expect(envs[0]!.container_id).toBe('legacy-container');
    expect(envs[0]!.image_tag).toBe('legacy:v2');
    expect(envs[0]!.previous_image_tag).toBe('legacy:v1');
    expect(envs[0]!.public_url).toBe('https://legacy.example.com');

    const inspector = createLegacySqlite(legacyDbPath, true);
    const envVarColumns = (
      inspector.prepare("PRAGMA table_info('env_vars')").all() as Array<{ name: string }>
    ).map((column) => column.name);
    inspector.close();
    expect(envVarColumns).toContain('environment_id');

    expect(migratedDb.getEnvVars('legacy-p1')).toEqual({ LEGACY_KEY: 'legacy-value' });

    migratedDb.close();
    rmSync(legacyDir, { recursive: true, force: true });
  });
});
