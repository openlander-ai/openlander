import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { ProjectOpsOverrideRepo } from '../../../src/db/repos/project-ops-override.repo.js';
import { ProjectRepo } from '../../../src/db/repos/project.repo.js';
import type { ProjectOpsOverride } from '../../../src/monitor/ops-types.js';

describe('ProjectOpsOverrideRepo', () => {
  let repo: ProjectOpsOverrideRepo;
  let projectRepo: ProjectRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];
  let db: ReturnType<typeof createDrizzleDatabase>['db'];

  beforeEach(() => {
    const dbInstance = createDrizzleDatabase(':memory:');
    sqlite = dbInstance.sqlite;
    db = dbInstance.db;
    repo = new ProjectOpsOverrideRepo(db, sqlite);
    projectRepo = new ProjectRepo(db, sqlite);
    // 0009 drops parent tables; mirror src/db/index.ts:435-443 production path.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }

    projectRepo.createProject({
      id: 'proj-1',
      name: 'test-project-1',
      repoUrl: 'https://github.com/test/repo1',
      branch: 'main',
    });
    projectRepo.createProject({
      id: 'proj-2',
      name: 'test-project-2',
      repoUrl: 'https://github.com/test/repo2',
      branch: 'main',
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('save and load', () => {
    it('round-trip: save then load returns same data', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {
        automation: {
          rollback: 'auto',
        },
      };

      repo.save(projectId, overrides);
      const loaded = repo.load(projectId);

      expect(loaded).toEqual(overrides);
    });

    it('save with empty overrides', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {};

      repo.save(projectId, overrides);
      const loaded = repo.load(projectId);

      expect(loaded).toEqual({});
    });

    it('save with partial automation overrides', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {
        automation: {
          rollback: 'confirm',
        },
      };

      repo.save(projectId, overrides);
      const loaded = repo.load(projectId);

      expect(loaded?.automation?.rollback).toBe('confirm');
    });
  });

  describe('upsert behavior', () => {
    it('save twice: second save overwrites first (upsert)', () => {
      const projectId = 'proj-1';
      const overrides1: ProjectOpsOverride = {
        automation: {
          rollback: 'auto',
        },
      };
      const overrides2: ProjectOpsOverride = {
        automation: {
          rollback: 'confirm',
        },
      };

      repo.save(projectId, overrides1);
      repo.save(projectId, overrides2);

      const loaded = repo.load(projectId);
      expect(loaded?.automation?.rollback).toBe('confirm');
    });

    it('multiple projects have independent overrides', () => {
      const overrides1: ProjectOpsOverride = {
        automation: { rollback: 'auto' },
      };
      const overrides2: ProjectOpsOverride = {
        automation: { rollback: 'confirm' },
      };

      repo.save('proj-1', overrides1);
      repo.save('proj-2', overrides2);

      expect(repo.load('proj-1')?.automation?.rollback).toBe('auto');
      expect(repo.load('proj-2')?.automation?.rollback).toBe('confirm');
    });
  });

  describe('load non-existent', () => {
    it('load non-existent project returns undefined', () => {
      const loaded = repo.load('non-existent');
      expect(loaded).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('delete then load returns undefined', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {
        automation: { rollback: 'auto' },
      };

      repo.save(projectId, overrides);
      expect(repo.load(projectId)).toBeDefined();

      repo.delete(projectId);
      expect(repo.load(projectId)).toBeUndefined();
    });

    it('delete non-existent project does not error', () => {
      expect(() => {
        repo.delete('non-existent');
      }).not.toThrow();
    });
  });

  describe('JSON serialization', () => {
    it('preserves complex nested structures', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {
        automation: {
          rollback: 'auto',
        },
      };

      repo.save(projectId, overrides);
      const loaded = repo.load(projectId);

      expect(JSON.stringify(loaded)).toBe(JSON.stringify(overrides));
    });

    it('handles partial overrides correctly', () => {
      const projectId = 'proj-1';
      const overrides: ProjectOpsOverride = {
        automation: {
          rollback: 'confirm',
        },
      };

      repo.save(projectId, overrides);
      const loaded = repo.load(projectId);

      expect(loaded?.automation).toBeDefined();
      expect(loaded?.automation?.rollback).toBe('confirm');
    });
  });
});
