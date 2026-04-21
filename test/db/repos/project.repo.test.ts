import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { EnvironmentRepo } from '../../../src/db/repos/environment.repo.js';
import { ProjectRepo } from '../../../src/db/repos/project.repo.js';
import { OpenLanderError } from '../../../src/errors.js';

describe('ProjectRepo - Archive', () => {
  let repo: ProjectRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ProjectRepo(db.db, db.sqlite);
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
  });

  afterEach(() => {
    sqlite.close();
  });

  function createTestProject(overrides: { id?: string; name?: string; repoUrl?: string } = {}) {
    return repo.createProject({
      id: overrides.id ?? 'proj-1',
      name: overrides.name ?? 'test-project',
      repoUrl: overrides.repoUrl ?? 'https://github.com/test/repo',
    });
  }

  describe('archiveProject', () => {
    it('sets archived_at timestamp, nulls assigned_port/container_id/image_tag, sets status stopped', () => {
      createTestProject();
      repo.updateProject('proj-1', {
        assignedPort: 10001,
        containerId: 'container-abc',
        imageTag: 'v1.0',
        status: 'running',
      });

      repo.archiveProject('proj-1');

      const project = repo.getProject('proj-1');
      expect(project).toBeDefined();
      expect(project!.archived_at).toBeTruthy();
      expect(project!.assigned_port).toBeNull();
      expect(project!.container_id).toBeNull();
      expect(project!.image_tag).toBeNull();
      expect(project!.status).toBe('stopped');
    });

    it('throws when project status is building', () => {
      createTestProject();
      repo.updateProject('proj-1', { status: 'building' });

      expect(() => repo.archiveProject('proj-1')).toThrow(
        'Cannot archive a project that is currently building',
      );

      try {
        repo.archiveProject('proj-1');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenLanderError);
        expect((err as OpenLanderError).code).toBe('ARCHIVE_BUILDING_PROJECT');
        expect((err as OpenLanderError).statusCode).toBe(400);
      }
    });

    it('throws ProjectNotFoundError for non-existent project', () => {
      expect(() => repo.archiveProject('nonexistent')).toThrow('Project not found');
    });

    it('preserves project name after archive', () => {
      createTestProject({ name: 'my-app' });
      repo.archiveProject('proj-1');

      const project = repo.getProject('proj-1');
      expect(project!.name).toBe('my-app');
    });
  });

  describe('unarchiveProject', () => {
    it('clears archived_at and sets status to stopped', () => {
      createTestProject();
      repo.archiveProject('proj-1');

      const archived = repo.getProject('proj-1');
      expect(archived!.archived_at).toBeTruthy();

      repo.unarchiveProject('proj-1');

      const unarchived = repo.getProject('proj-1');
      expect(unarchived!.archived_at).toBeNull();
      expect(unarchived!.status).toBe('stopped');
    });
  });

  describe('listProjects', () => {
    it('excludes archived projects by default', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });
      createTestProject({ id: 'proj-2', name: 'archived-project' });
      repo.archiveProject('proj-2');

      const results = repo.listProjects();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('active-project');
    });

    it('includes archived projects when includeArchived is true', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });
      createTestProject({ id: 'proj-2', name: 'archived-project' });
      repo.archiveProject('proj-2');

      const results = repo.listProjects(undefined, { includeArchived: true });
      expect(results).toHaveLength(2);
    });

    it('filters by status and excludes archived by default', () => {
      createTestProject({ id: 'proj-1', name: 'running-project' });
      createTestProject({ id: 'proj-2', name: 'stopped-project' });
      createTestProject({ id: 'proj-3', name: 'archived-running' });
      repo.updateProject('proj-1', { status: 'running' });
      repo.updateProject('proj-3', { status: 'running' });
      repo.archiveProject('proj-3');

      const running = repo.listProjects('running');
      expect(running).toHaveLength(1);
      expect(running[0].name).toBe('running-project');
    });
  });

  describe('listArchivedProjects', () => {
    it('returns only archived projects', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });
      createTestProject({ id: 'proj-2', name: 'archived-project' });
      repo.archiveProject('proj-2');

      const results = repo.listArchivedProjects();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('archived-project');
    });

    it('returns empty array when no projects are archived', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });

      const results = repo.listArchivedProjects();
      expect(results).toEqual([]);
    });
  });

  describe('isArchived', () => {
    it('returns true for archived project', () => {
      createTestProject();
      repo.archiveProject('proj-1');

      expect(repo.isArchived('proj-1')).toBe(true);
    });

    it('returns false for non-archived project', () => {
      createTestProject();

      expect(repo.isArchived('proj-1')).toBe(false);
    });

    it('returns false for non-existent project', () => {
      expect(repo.isArchived('nonexistent')).toBe(false);
    });
  });
});

describe('ProjectRepo - listProjectsWithMetadata (N+1 fix)', () => {
  let repo: ProjectRepo;
  let envRepo: EnvironmentRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ProjectRepo(db.db, db.sqlite);
    envRepo = new EnvironmentRepo(db.db, db.sqlite);
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty array when there are no projects', () => {
    expect(repo.listProjectsWithMetadata()).toEqual([]);
  });

  it('returns each project paired with its environments and child count', () => {
    repo.createProject({ id: 'parent-1', name: 'compose-app', repoUrl: 'https://x/y' });
    repo.createProject({ id: 'child-a', name: 'svc-a', repoUrl: '', parentProjectId: 'parent-1' });
    repo.createProject({ id: 'child-b', name: 'svc-b', repoUrl: '', parentProjectId: 'parent-1' });
    repo.createProject({ id: 'standalone', name: 'lone-app', repoUrl: 'https://x/z' });

    envRepo.createEnvironment({
      id: 'parent-1-prod',
      projectId: 'parent-1',
      type: 'production',
      branch: 'main',
    });
    envRepo.createEnvironment({
      id: 'parent-1-dev',
      projectId: 'parent-1',
      type: 'development',
      branch: 'dev',
    });
    envRepo.createEnvironment({
      id: 'standalone-prod',
      projectId: 'standalone',
      type: 'production',
      branch: 'main',
    });

    const result = repo.listProjectsWithMetadata();
    const byId = new Map(result.map((r) => [r.project.id, r]));

    expect(byId.get('parent-1')?.environments).toHaveLength(2);
    expect(byId.get('parent-1')?.childCount).toBe(2);

    expect(byId.get('standalone')?.environments).toHaveLength(1);
    expect(byId.get('standalone')?.childCount).toBe(0);

    expect(byId.get('child-a')?.environments).toHaveLength(0);
    expect(byId.get('child-a')?.childCount).toBe(0);
  });

  it('matches per-row legacy behavior (parity check) with O(3) queries', () => {
    // Seed 25 projects, each with 1 environment, plus a few compose parents.
    for (let i = 0; i < 20; i++) {
      const id = `p-${String(i)}`;
      repo.createProject({ id, name: `proj-${String(i)}`, repoUrl: `https://x/${String(i)}` });
      envRepo.createEnvironment({
        id: `${id}-prod`,
        projectId: id,
        type: 'production',
        branch: 'main',
      });
    }
    repo.createProject({ id: 'parent', name: 'parent-app', repoUrl: 'https://x/parent' });
    for (let i = 0; i < 4; i++) {
      repo.createProject({
        id: `child-${String(i)}`,
        name: `child-${String(i)}`,
        repoUrl: '',
        parentProjectId: 'parent',
      });
    }

    const batched = repo.listProjectsWithMetadata();
    expect(batched.length).toBe(25);

    // Parity: every row's environments + childCount should match per-row queries.
    for (const row of batched) {
      const expectedEnvs = envRepo.getEnvironmentsByProject(row.project.id);
      expect(row.environments.map((e) => e.id).sort()).toEqual(
        expectedEnvs.map((e) => e.id).sort(),
      );

      const expectedChildren = repo.getChildProjects(row.project.id).length;
      expect(row.childCount).toBe(expectedChildren);

      // isCompose semantic check: childCount > 0 ⇔ isParentProject
      expect(row.childCount > 0).toBe(repo.isParentProject(row.project.id));
    }
  });

  it('honors status filter', () => {
    repo.createProject({ id: 'p1', name: 'a', repoUrl: '' });
    repo.createProject({ id: 'p2', name: 'b', repoUrl: '' });
    repo.updateProject('p1', { status: 'running' });
    repo.updateProject('p2', { status: 'stopped' });

    const running = repo.listProjectsWithMetadata('running');
    expect(running).toHaveLength(1);
    expect(running[0].project.id).toBe('p1');
  });

  it('excludes archived projects by default and includes them when requested', () => {
    repo.createProject({ id: 'p1', name: 'live', repoUrl: '' });
    repo.createProject({ id: 'p2', name: 'gone', repoUrl: '' });
    repo.archiveProject('p2');

    const defaultList = repo.listProjectsWithMetadata();
    expect(defaultList.map((r) => r.project.id)).toEqual(['p1']);

    const includeArchived = repo.listProjectsWithMetadata(undefined, { includeArchived: true });
    expect(includeArchived.map((r) => r.project.id).sort()).toEqual(['p1', 'p2']);
  });
});
