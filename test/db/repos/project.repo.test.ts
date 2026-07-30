import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { EnvironmentRepo } from '../../../src/db/repos/environment.repo.js';
import { ProjectRepo } from '../../../src/db/repos/project.repo.js';
import { ServiceRepo } from '../../../src/db/repos/service.repo.js';
import type { SqliteDatabase } from '../../../src/db/drizzle.js';

/**
 * Insert a minimal service row for a project. The new listProjects EXISTS
 * subquery requires at least one service with kind != 'compose-child' per
 * project. This helper is the test-layer equivalent of the 0009 Phase D
 * INSERT that auto-creates service rows during migration.
 */
function insertServiceForProject(
  sqlite: SqliteDatabase,
  projectId: string,
  kind: string = 'git',
  parentServiceId: string | null = null,
): void {
  sqlite.exec(
    `INSERT OR IGNORE INTO services (id, project_id, name, kind, parent_service_id, source, project_type, server_id)
     VALUES ('${projectId}__svc', '${projectId}', '${projectId}__svc', '${kind}',
             ${parentServiceId ? `'${parentServiceId}'` : 'NULL'}, 'git', 'web', 'local')`,
  );
}

describe('ProjectRepo - Archive', () => {
  let repo: ProjectRepo;
  let serviceRepo: ServiceRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ProjectRepo(db.db, db.sqlite);
    serviceRepo = new ServiceRepo(db.db, db.sqlite);
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

    it('normalizes a stale building environment while archiving', async () => {
      await createTestProject();
      const envRepo = new EnvironmentRepo(
        (repo as unknown as { db: Parameters<typeof EnvironmentRepo>[0] }).db,
        sqlite,
      );
      await envRepo.createEnvironment({
        id: 'proj-1-prod',
        projectId: 'proj-1',
        type: 'production',
        branch: 'main',
        status: 'building',
      });

      await repo.archiveProject('proj-1');

      expect((await repo.getProject('proj-1'))?.archived_at).toBeTruthy();
      expect((await envRepo.getEnvironment('proj-1-prod'))?.status).toBe('stopped');
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

    // PR 4.5 regression: archive→unarchive must mirror to __svc row so
    // canonical-first readers don't see stale state (Codex repro: after
    // archive→unarchive, __svc kept status='running'/assigned_port/container_id).
    it('archive mirrors cleared runtime cols to __svc services row', () => {
      createTestProject();
      repo.updateProject('proj-1', {
        assignedPort: 10001,
        containerId: 'container-abc',
        imageTag: 'v1.0',
        status: 'running',
      });

      repo.archiveProject('proj-1');

      const svc = serviceRepo.getService('proj-1__svc');
      expect(svc).toBeDefined();
      expect(svc!.archived_at).toBeTruthy();
      expect(svc!.assigned_port).toBeNull();
      expect(svc!.container_id).toBeNull();
      expect(svc!.image_tag).toBeNull();
      expect(svc!.status).toBe('stopped');
    });

    it('unarchive mirrors cleared archived_at and stopped status to __svc services row', () => {
      createTestProject();
      repo.updateProject('proj-1', { status: 'running', assignedPort: 10001, containerId: 'ctr', imageTag: 'v1' });
      repo.archiveProject('proj-1');
      repo.unarchiveProject('proj-1');

      const svc = serviceRepo.getService('proj-1__svc');
      expect(svc).toBeDefined();
      expect(svc!.archived_at).toBeNull();
      expect(svc!.status).toBe('stopped');
    });
  });

  describe('listProjects', () => {
    it('excludes archived projects by default', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });
      createTestProject({ id: 'proj-2', name: 'archived-project' });
      insertServiceForProject(sqlite, 'proj-1');
      insertServiceForProject(sqlite, 'proj-2');
      repo.archiveProject('proj-2');

      const results = repo.listProjects();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('active-project');
    });

    it('includes archived projects when includeArchived is true', () => {
      createTestProject({ id: 'proj-1', name: 'active-project' });
      createTestProject({ id: 'proj-2', name: 'archived-project' });
      insertServiceForProject(sqlite, 'proj-1');
      insertServiceForProject(sqlite, 'proj-2');
      repo.archiveProject('proj-2');

      const results = repo.listProjects(undefined, { includeArchived: true });
      expect(results).toHaveLength(2);
    });

    it('filters by status and excludes archived by default', () => {
      createTestProject({ id: 'proj-1', name: 'running-project' });
      createTestProject({ id: 'proj-2', name: 'stopped-project' });
      createTestProject({ id: 'proj-3', name: 'archived-running' });
      insertServiceForProject(sqlite, 'proj-1');
      insertServiceForProject(sqlite, 'proj-2');
      insertServiceForProject(sqlite, 'proj-3');
      repo.updateProject('proj-1', { status: 'running' });
      repo.updateProject('proj-3', { status: 'running' });
      repo.archiveProject('proj-3');

      const running = repo.listProjects('running');
      expect(running).toHaveLength(1);
      expect(running[0].name).toBe('running-project');
    });

    it('listProjects with compose stack returns parent group only', () => {
      // Seed parent project (the compose group)
      repo.createProject({ id: 'stack-1', name: 'mystack', repoUrl: 'https://github.com/test/mystack' });
      // Seed 3 child projects under the parent
      repo.createProject({ id: 'stack-1__child-api', name: 'mystack/api', repoUrl: '', parentProjectId: 'stack-1' });
      repo.createProject({ id: 'stack-1__child-web', name: 'mystack/web', repoUrl: '', parentProjectId: 'stack-1' });
      repo.createProject({ id: 'stack-1__child-db', name: 'mystack/db', repoUrl: '', parentProjectId: 'stack-1' });

      // Parent gets a kind='compose' service (project_id = stack-1)
      insertServiceForProject(sqlite, 'stack-1', 'compose');

      // Children each get a kind='compose-child' service with parent_service_id pointing at stack-1__svc
      // project_id for children = stack-1 (their group), per 0009 Phase D convention
      sqlite.exec(
        `INSERT OR IGNORE INTO services (id, project_id, name, kind, parent_service_id, source, project_type, server_id)
         VALUES ('stack-1__child-api__svc', 'stack-1', 'stack-1__child-api__svc', 'compose-child', 'stack-1__svc', 'git', 'web', 'local')`,
      );
      sqlite.exec(
        `INSERT OR IGNORE INTO services (id, project_id, name, kind, parent_service_id, source, project_type, server_id)
         VALUES ('stack-1__child-web__svc', 'stack-1', 'stack-1__child-web__svc', 'compose-child', 'stack-1__svc', 'git', 'web', 'local')`,
      );
      sqlite.exec(
        `INSERT OR IGNORE INTO services (id, project_id, name, kind, parent_service_id, source, project_type, server_id)
         VALUES ('stack-1__child-db__svc', 'stack-1', 'stack-1__child-db__svc', 'compose-child', 'stack-1__svc', 'git', 'web', 'local')`,
      );

      // listProjects should return only 1 row: the parent (stack-1)
      // The 3 child project rows have NO services of kind != 'compose-child' pointing
      // at their own project_id, so the EXISTS subquery filters them out.
      const results = repo.listProjects();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('stack-1');
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

  it('returns empty array when there are no projects', () => {
    expect(repo.listProjectsWithMetadata()).toEqual([]);
  });

  it('returns each project paired with its environments and child count', () => {
    // Parent is built via compose (mirrors production: createProject sets the
    // backing svc kind='compose' when buildMethod='compose'). The compose
    // parent meta is excluded from childCount; only the children count.
    repo.createProject({
      id: 'parent-1',
      name: 'compose-app',
      repoUrl: 'https://x/y',
      buildMethod: 'compose',
    });
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

    // listProjects (via EXISTS) returns only parent-1 and standalone; compose
    // children are filtered out (no non-compose-child service under their project_id).
    expect(result).toHaveLength(2);

    expect(byId.get('parent-1')?.environments).toHaveLength(2);
    expect(byId.get('parent-1')?.childCount).toBe(2);
    expect(byId.get('parent-1')?.isCompose).toBe(true);

    // Post-PR-95: a plain project's own deployable counts as 1.
    expect(byId.get('standalone')?.environments).toHaveLength(1);
    expect(byId.get('standalone')?.childCount).toBe(1);
    expect(byId.get('standalone')?.isCompose).toBe(false);

    // child-a is no longer returned by listProjects (filtered by EXISTS subquery)
    expect(byId.has('child-a')).toBe(false);
  });

  it('does not mix compose-child service environments into parent metadata', () => {
    repo.createProject({
      id: 'stack-parent',
      name: 'stack-parent',
      repoUrl: 'https://x/stack',
      buildMethod: 'compose',
    });
    repo.createProject({
      id: 'stack-worker',
      name: 'stack-worker',
      repoUrl: '',
      parentProjectId: 'stack-parent',
    });

    envRepo.createEnvironment({
      id: 'stack-parent-prod',
      projectId: 'stack-parent',
      type: 'production',
      branch: 'main',
    });
    envRepo.createEnvironment({
      id: 'stack-worker-prod',
      projectId: 'stack-worker',
      type: 'production',
      branch: 'main',
    });

    const parent = repo
      .listProjectsWithMetadata()
      .find((entry) => entry.project.id === 'stack-parent');

    expect(parent).toBeDefined();
    expect(parent!.environments.map((env) => env.id)).toEqual(['stack-parent-prod']);
    expect(parent!.environments.every((env) => env.project_id === 'stack-parent')).toBe(true);
  });

  it('matches per-row legacy behavior (parity check) with O(3) queries', () => {
    // Seed 20 standalone projects + 1 compose parent + 4 compose children.
    // listProjects (via EXISTS) only returns the 20 standalones + 1 parent = 21.
    // Compose children have no non-compose-child service under their own project_id
    // (per 0009 Phase D convention), so they are filtered by the EXISTS subquery.
    for (let i = 0; i < 20; i++) {
      const id = `p-${String(i)}`;
      repo.createProject({ id, name: `proj-${String(i)}`, repoUrl: `https://x/${String(i)}` });
      insertServiceForProject(sqlite, id, 'git');
      envRepo.createEnvironment({
        id: `${id}-prod`,
        projectId: id,
        type: 'production',
        branch: 'main',
      });
    }
    repo.createProject({ id: 'parent', name: 'parent-app', repoUrl: 'https://x/parent' });
    insertServiceForProject(sqlite, 'parent', 'compose');
    for (let i = 0; i < 4; i++) {
      repo.createProject({
        id: `child-${String(i)}`,
        name: `child-${String(i)}`,
        repoUrl: '',
        parentProjectId: 'parent',
      });
      // compose-children do NOT get a service under their own project_id;
      // their service row points at the parent group (project_id='parent'),
      // matching the 0009 Phase D INSERT shape.
    }

    const batched = repo.listProjectsWithMetadata();
    // 20 standalones + 1 compose parent = 21 (children excluded by EXISTS subquery)
    expect(batched.length).toBe(21);

    // Parity: every row's environments + childCount should match per-row queries.
    // Post-PR-95 contract: childCount counts every deployable service in the
    // group (compose-children + plain git/image), excluding managed DBs and
    // the synthetic 'compose' parent meta. Mirror that here per-row.
    const MANAGED_AND_META: ReadonlySet<string> = new Set([
      'postgres', 'mysql', 'redis', 'mongo', 'minio', 'compose',
    ]);
    for (const row of batched) {
      const expectedEnvs = envRepo.getEnvironmentsByProject(row.project.id);
      expect(row.environments.map((e) => e.id).sort()).toEqual(
        expectedEnvs.map((e) => e.id).sort(),
      );

      const groupSvcs = sqlite
        .prepare('SELECT kind FROM services WHERE project_id = ?')
        .all(row.project.id) as Array<{ kind: string }>;
      const expectedChildren = groupSvcs.filter((s) => !MANAGED_AND_META.has(s.kind)).length;
      expect(row.childCount).toBe(expectedChildren);

      // isCompose now derives from actual compose markers, not childCount.
      const hasComposeMarker = groupSvcs.some(
        (s) => s.kind === 'compose' || s.kind === 'compose-child',
      );
      expect(row.isCompose).toBe(hasComposeMarker);
    }
  });

  it('honors status filter', () => {
    repo.createProject({ id: 'p1', name: 'a', repoUrl: '' });
    repo.createProject({ id: 'p2', name: 'b', repoUrl: '' });
    insertServiceForProject(sqlite, 'p1');
    insertServiceForProject(sqlite, 'p2');
    repo.updateProject('p1', { status: 'running' });
    repo.updateProject('p2', { status: 'stopped' });

    const running = repo.listProjectsWithMetadata('running');
    expect(running).toHaveLength(1);
    expect(running[0].project.id).toBe('p1');
  });

  it('excludes archived projects by default and includes them when requested', () => {
    repo.createProject({ id: 'p1', name: 'live', repoUrl: '' });
    repo.createProject({ id: 'p2', name: 'gone', repoUrl: '' });
    insertServiceForProject(sqlite, 'p1');
    insertServiceForProject(sqlite, 'p2');
    repo.archiveProject('p2');

    const defaultList = repo.listProjectsWithMetadata();
    expect(defaultList.map((r) => r.project.id)).toEqual(['p1']);

    const includeArchived = repo.listProjectsWithMetadata(undefined, { includeArchived: true });
    expect(includeArchived.map((r) => r.project.id).sort()).toEqual(['p1', 'p2']);
  });
});

describe('ProjectRepo - createProject auto-inserts backing services row', () => {
  let repo: ProjectRepo;
  let serviceRepo: ServiceRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ProjectRepo(db.db, db.sqlite);
    serviceRepo = new ServiceRepo(db.db, db.sqlite);
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

  it('createProject auto-inserts a backing services row so listProjects sees it without manual seeding', () => {
    const projectId = 'auto-svc-test';
    repo.createProject({
      id: projectId,
      name: 'auto-svc-project',
      repoUrl: 'https://github.com/test/auto-svc',
    });

    // listProjects must include the new project without any manual service seeding.
    const listed = repo.listProjects();
    expect(listed.map((p) => p.id)).toContain(projectId);

    // The backing service row must exist with the canonical id convention.
    const svc = serviceRepo.getService(`${projectId}__svc`);
    expect(svc).toBeDefined();
    expect(svc!.kind).toBe('git');
    expect(svc!.project_id).toBe(projectId);
  });

  it('derives kind=image for source=image projects', () => {
    repo.createProject({
      id: 'img-proj',
      name: 'image-project',
      repoUrl: '',
      source: 'image',
      imageUrl: 'nginx:latest',
    });

    const svc = serviceRepo.getService('img-proj__svc');
    expect(svc).toBeDefined();
    expect(svc!.kind).toBe('image');
  });

  it('derives kind=compose for build_method=compose projects', () => {
    repo.createProject({
      id: 'compose-proj',
      name: 'compose-project',
      repoUrl: 'https://github.com/test/stack',
      buildMethod: 'compose',
    });

    const svc = serviceRepo.getService('compose-proj__svc');
    expect(svc).toBeDefined();
    expect(svc!.kind).toBe('compose');
  });

  it('compose parent is visible in listProjects but compose-child projects are not', () => {
    repo.createProject({ id: 'parent-p', name: 'parent-compose', repoUrl: 'https://x/y', buildMethod: 'compose' });
    repo.createProject({ id: 'child-p', name: 'child-svc', repoUrl: '', parentProjectId: 'parent-p' });

    const listed = repo.listProjects();
    expect(listed.map((p) => p.id)).toContain('parent-p');
    // child has kind='compose-child', so the EXISTS subquery filters it out.
    expect(listed.map((p) => p.id)).not.toContain('child-p');
  });

  // CCG regression: createProject must be fully transactional. If the backing
  // services insert fails (e.g. orphan row from a prior deleted project), the
  // projects row must NOT be committed.
  describe('createProject — transactional atomicity', () => {
    it('throws when an orphan service row exists for the same id, and does NOT create the projects row', () => {
      const projectId = 'stale-proj';

      // Pre-seed the orphan service row that a previously-deleted project left behind.
      sqlite.exec(
        `INSERT INTO services (id, project_id, name, kind, source, project_type, server_id)
         VALUES ('${projectId}__svc', '__orphan_managed', '${projectId}__svc', 'git', 'git', 'web', 'local')`,
      );

      // createProject must throw because the services INSERT hits a UNIQUE conflict.
      expect(() =>
        repo.createProject({
          id: projectId,
          name: 'stale-project',
          repoUrl: 'https://github.com/test/stale',
        }),
      ).toThrow();

      // The transaction must have rolled back — no projects row should exist.
      const project = repo.getProject(projectId);
      expect(project).toBeUndefined();
    });

    it('error message mentions orphan service rows when services.id conflicts', () => {
      const projectId = 'orphan-id-proj';

      sqlite.exec(
        `INSERT INTO services (id, project_id, name, kind, source, project_type, server_id)
         VALUES ('${projectId}__svc', '__orphan_managed', '${projectId}__svc', 'git', 'git', 'web', 'local')`,
      );

      let thrown: Error | undefined;
      try {
        repo.createProject({
          id: projectId,
          name: 'orphan-id-project',
          repoUrl: 'https://github.com/test/orphan',
        });
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/orphan service rows/i);
    });
  });
});
