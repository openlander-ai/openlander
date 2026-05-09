import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { ProjectDependencyRepo } from '../../../src/db/repos/project-dependency.repo.js';

describe('ProjectDependencyRepo', () => {
  let repo: ProjectDependencyRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ProjectDependencyRepo(db.db, db.sqlite);
    // 0009 drops parent tables; mirror src/db/index.ts:435-443 production path.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('create', () => {
    it('returns a new dependency row', () => {
      const row = repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
        dependency_type: 'api',
        source: 'manual',
      });

      expect(row).toBeDefined();
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.source_project_id).toBe('proj-1');
      expect(row.target_project_id).toBe('proj-2');
      expect(row.dependency_type).toBe('api');
      expect(row.source).toBe('manual');
      expect(row.created_at).toBeTruthy();
    });

    it('applies default dependency_type and source when omitted', () => {
      const row = repo.create({
        source_project_id: 'proj-1',
      });

      expect(row.dependency_type).toBe('custom');
      expect(row.source).toBe('manual');
      expect(row.target_project_id).toBeNull();
      expect(row.target_service_id).toBeNull();
    });

    it('creates a service dependency', () => {
      const row = repo.create({
        source_project_id: 'proj-1',
        target_service_id: 'svc-redis',
        dependency_type: 'cache',
      });

      expect(row.target_service_id).toBe('svc-redis');
      expect(row.target_project_id).toBeNull();
      expect(row.dependency_type).toBe('cache');
    });
  });

  describe('findByProject', () => {
    it('returns deps for a given project', () => {
      repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
        dependency_type: 'api',
      });
      repo.create({
        source_project_id: 'proj-1',
        target_service_id: 'svc-pg',
        dependency_type: 'database',
      });
      repo.create({
        source_project_id: 'proj-other',
        target_project_id: 'proj-1',
      });

      const deps = repo.findByProject('proj-1');

      expect(deps).toHaveLength(2);
      expect(deps.every((d) => d.source_project_id === 'proj-1')).toBe(true);
    });

    it('returns empty array for unknown project', () => {
      const deps = repo.findByProject('non-existent');
      expect(deps).toHaveLength(0);
    });
  });

  describe('findDependents', () => {
    it('returns projects depending on a target project', () => {
      repo.create({
        source_project_id: 'proj-a',
        target_project_id: 'proj-b',
        dependency_type: 'api',
      });
      repo.create({
        source_project_id: 'proj-c',
        target_project_id: 'proj-b',
        dependency_type: 'api',
      });
      repo.create({
        source_project_id: 'proj-d',
        target_project_id: 'proj-z',
      });

      const dependents = repo.findDependents('proj-b');

      expect(dependents).toHaveLength(2);
      expect(dependents.map((d) => d.source_project_id).sort()).toEqual(['proj-a', 'proj-c']);
    });

    it('returns projects depending on a target service', () => {
      repo.create({
        source_project_id: 'proj-1',
        target_service_id: 'svc-redis',
        dependency_type: 'cache',
      });
      repo.create({
        source_project_id: 'proj-2',
        target_service_id: 'svc-redis',
        dependency_type: 'cache',
      });

      const dependents = repo.findDependents(undefined, 'svc-redis');

      expect(dependents).toHaveLength(2);
    });

    it('returns empty array when no arguments provided', () => {
      repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
      });

      const dependents = repo.findDependents();
      expect(dependents).toHaveLength(0);
    });
  });

  describe('findAll', () => {
    it('returns all dependencies', () => {
      repo.create({ source_project_id: 'proj-1', target_project_id: 'proj-2' });
      repo.create({ source_project_id: 'proj-2', target_service_id: 'svc-pg' });
      repo.create({ source_project_id: 'proj-3', target_project_id: 'proj-1' });

      const all = repo.findAll();
      expect(all).toHaveLength(3);
    });

    it('returns empty array when no dependencies exist', () => {
      const all = repo.findAll();
      expect(all).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('removes the dependency', () => {
      const row = repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
      });

      repo.delete(row.id);

      const all = repo.findAll();
      expect(all).toHaveLength(0);
    });

    it('does nothing for non-existent id', () => {
      repo.create({ source_project_id: 'proj-1', target_project_id: 'proj-2' });

      repo.delete('non-existent-id');

      const all = repo.findAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('deleteByProject', () => {
    it('removes all deps for a project (source and target)', () => {
      repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
      });
      repo.create({
        source_project_id: 'proj-3',
        target_project_id: 'proj-1',
      });
      repo.create({
        source_project_id: 'proj-2',
        target_project_id: 'proj-3',
      });

      repo.deleteByProject('proj-1');

      const all = repo.findAll();
      expect(all).toHaveLength(1);
      expect(all[0].source_project_id).toBe('proj-2');
      expect(all[0].target_project_id).toBe('proj-3');
    });

    it('does nothing for non-existent project', () => {
      repo.create({ source_project_id: 'proj-1', target_project_id: 'proj-2' });

      repo.deleteByProject('non-existent');

      const all = repo.findAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('syncFromServiceConnections', () => {
    it('creates auto dependencies from service connections', () => {
      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-pg', service_type: 'postgres' },
        { project_id: 'proj-1', service_id: 'svc-redis', service_type: 'redis' },
      ]);

      const deps = repo.findByProject('proj-1');
      expect(deps).toHaveLength(2);

      const pgDep = deps.find((d) => d.target_service_id === 'svc-pg');
      expect(pgDep).toBeDefined();
      expect(pgDep!.dependency_type).toBe('database');
      expect(pgDep!.source).toBe('auto');

      const redisDep = deps.find((d) => d.target_service_id === 'svc-redis');
      expect(redisDep).toBeDefined();
      expect(redisDep!.dependency_type).toBe('cache');
      expect(redisDep!.source).toBe('auto');
    });

    it('maps mysql to database type', () => {
      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-mysql', service_type: 'mysql' },
      ]);

      const deps = repo.findByProject('proj-1');
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_type).toBe('database');
    });

    it('maps unknown service type to custom', () => {
      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-minio', service_type: 'minio' },
      ]);

      const deps = repo.findByProject('proj-1');
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_type).toBe('custom');
    });

    it('maps undefined service type to custom', () => {
      repo.syncFromServiceConnections([{ project_id: 'proj-1', service_id: 'svc-x' }]);

      const deps = repo.findByProject('proj-1');
      expect(deps).toHaveLength(1);
      expect(deps[0].dependency_type).toBe('custom');
    });

    it('replaces existing auto entries on re-sync', () => {
      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-pg', service_type: 'postgres' },
      ]);

      repo.create({
        source_project_id: 'proj-1',
        target_project_id: 'proj-2',
        dependency_type: 'api',
        source: 'manual',
      });

      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-redis', service_type: 'redis' },
      ]);

      const deps = repo.findByProject('proj-1');
      expect(deps).toHaveLength(2);

      const manual = deps.find((d) => d.source === 'manual');
      expect(manual).toBeDefined();
      expect(manual!.target_project_id).toBe('proj-2');

      const auto = deps.find((d) => d.source === 'auto');
      expect(auto).toBeDefined();
      expect(auto!.target_service_id).toBe('svc-redis');
    });

    it('handles empty connections array', () => {
      repo.syncFromServiceConnections([
        { project_id: 'proj-1', service_id: 'svc-pg', service_type: 'postgres' },
      ]);

      repo.syncFromServiceConnections([]);

      const deps = repo.findAll();
      expect(deps).toHaveLength(0);
    });
  });
});
