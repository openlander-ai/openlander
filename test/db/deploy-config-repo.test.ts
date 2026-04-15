import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { Database } from '../../src/db/index.js';
import {
  createDrizzleDatabase,
  type DrizzleClient,
  type SqliteDatabase,
} from '../../src/db/drizzle.js';
import { DeployConfigRepo } from '../../src/db/repos/deploy-config.repo.js';
import { ProjectRepo } from '../../src/db/repos/project.repo.js';

describe('DeployConfigRepo', () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-config-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/my-app' });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save -> load round-trip', () => {
    const configJson = '{"service":"web","port":3000}';

    db.saveDeployConfig('p1', configJson, 1);

    const loaded = db.loadDeployConfig('p1');
    expect(loaded).toBeDefined();
    expect(loaded!.project_id).toBe('p1');
    expect(loaded!.config_json).toBe(configJson);
    expect(loaded!.config_version).toBe(1);
  });

  it('save twice upserts and keeps latest values', () => {
    db.saveDeployConfig('p1', '{"v":1}', 1);
    db.saveDeployConfig('p1', '{"v":2,"flag":true}', 2);

    const loaded = db.loadDeployConfig('p1');
    expect(loaded).toBeDefined();
    expect(loaded!.config_json).toBe('{"v":2,"flag":true}');
    expect(loaded!.config_version).toBe(2);
  });

  it('delete removes stored config', () => {
    db.saveDeployConfig('p1', '{"v":1}', 1);

    db.deleteDeployConfig('p1');

    expect(db.loadDeployConfig('p1')).toBeUndefined();
  });

  it('load returns undefined for non-existent project config', () => {
    expect(db.loadDeployConfig('does-not-exist')).toBeUndefined();
  });

  it('project delete cascades to deploy config', () => {
    db.saveDeployConfig('p1', '{"v":1}', 1);

    db.deleteProject('p1');

    expect(db.loadDeployConfig('p1')).toBeUndefined();
  });
});

describe('DeployConfigRepo.exists', () => {
  let tmpDir: string;
  let sqlite: SqliteDatabase;
  let drizzle: DrizzleClient;
  let projectRepo: ProjectRepo;
  let deployConfigRepo: DeployConfigRepo;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-config-exists-test-'));
    const dbPath = join(tmpDir, 'test.db');
    const dbBundle = createDrizzleDatabase(dbPath);
    sqlite = dbBundle.sqlite;
    drizzle = dbBundle.db;
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });

    projectRepo = new ProjectRepo(drizzle, sqlite);
    deployConfigRepo = new DeployConfigRepo(drizzle, sqlite);

    projectRepo.createProject({
      id: 'p1',
      name: 'exists-app',
      repoUrl: 'https://github.com/test/exists-app',
    });
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false before save and true after save', () => {
    expect(deployConfigRepo.exists('p1')).toBe(false);

    deployConfigRepo.save('p1', '{"enabled":true}', 1);

    expect(deployConfigRepo.exists('p1')).toBe(true);
  });
});
