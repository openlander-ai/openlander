import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { Database } from '../src/db/index.js';
import { ProjectAlreadyExistsError } from '../src/errors.js';

type LegacySqlite = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { all: () => unknown };
  close: () => void;
};

function createLegacySqlite(dbPath: string): LegacySqlite {
  const require = createRequire(import.meta.url);

  const BetterSqlite3 = require('better-sqlite3') as new (path: string) => LegacySqlite;
  return new BetterSqlite3(dbPath);
}

describe('Database', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-db-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- Projects ---

  describe('Projects', () => {
    it('creates and retrieves a project', () => {
      const project = db.createProject({
        id: 'p1',
        name: 'my-app',
        repoUrl: 'https://github.com/user/my-app',
      });

      expect(project.id).toBe('p1');
      expect(project.name).toBe('my-app');
      expect(project.status).toBe('stopped');
      expect(project.visibility).toBe('internal');
    });

    it('gets project by name', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

      const found = db.getProjectByName('my-app');
      expect(found).toBeDefined();
      expect(found!.id).toBe('p1');
    });

    it('returns undefined for missing project', () => {
      expect(db.getProject('nonexistent')).toBeUndefined();
      expect(db.getProjectByName('nonexistent')).toBeUndefined();
    });

    it('updates project status', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
      db.updateProject('p1', { status: 'running', assignedPort: 10001 });

      const updated = db.getProject('p1');
      expect(updated!.status).toBe('running');
      expect(updated!.assigned_port).toBe(10001);
    });

    it('stores shared visibility and encrypted access code fields', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

      db.updateProject('p1', {
        visibility: 'shared',
        accessCode: 'encrypted-value',
        accessCodeIv: 'iv-value',
      });

      const updated = db.getProject('p1');
      expect(updated!.visibility).toBe('shared');
      expect(updated!.access_code).toBe('encrypted-value');
      expect(updated!.access_code_iv).toBe('iv-value');
    });

    it('persists preview flags via updateProject', () => {
      db.createProject({ id: 'p1', name: 'preview-app', repoUrl: 'https://github.com/test/a' });

      db.updateProject('p1', {
        isPreview: 1,
        prNumber: 17,
      });

      const updated = db.getProject('p1');
      expect(updated!.is_preview).toBe(1);
      expect(updated!.pr_number).toBe(17);
    });

    it('lists projects filtered by status', () => {
      db.createProject({ id: 'p1', name: 'app-1', repoUrl: 'https://github.com/test/a' });
      db.updateProject('p1', { status: 'running' });

      db.createProject({ id: 'p2', name: 'app-2', repoUrl: 'https://github.com/test/b' });
      // status = 'stopped' (default)

      const running = db.listProjects('running');
      expect(running).toHaveLength(1);
      expect(running[0]!.name).toBe('app-1');

      const all = db.listProjects();
      expect(all).toHaveLength(2);
    });

    it('deletes project and cascades', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
      db.setEnvVar('p1', 'KEY', 'value');

      db.deleteProject('p1');

      expect(db.getProject('p1')).toBeUndefined();
      // Env vars should be cascade-deleted
      const envVars = db.getEnvVars('p1');
      expect(Object.keys(envVars)).toHaveLength(0);
    });
  });

  // --- Environment Variables ---

  describe('Environment Variables', () => {
    beforeEach(() => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
    });

    it('sets and gets env vars', () => {
      db.setEnvVar('p1', 'DATABASE_URL', 'postgres://localhost/db');
      db.setEnvVar('p1', 'API_KEY', 'sk-123');

      const vars = db.getEnvVars('p1');
      expect(vars['DATABASE_URL']).toBe('postgres://localhost/db');
      expect(vars['API_KEY']).toBe('sk-123');
    });

    it('upserts env vars', () => {
      db.setEnvVar('p1', 'KEY', 'old-value');
      db.setEnvVar('p1', 'KEY', 'new-value');

      const vars = db.getEnvVars('p1');
      expect(vars['KEY']).toBe('new-value');
    });

    it('deletes env vars', () => {
      db.setEnvVar('p1', 'KEY', 'value');
      db.deleteEnvVar('p1', 'KEY');

      const vars = db.getEnvVars('p1');
      expect(vars['KEY']).toBeUndefined();
    });

    it('bulk sets env vars', () => {
      db.setEnvVarsBulk('p1', {
        A: '1',
        B: '2',
        C: '3',
      });

      const vars = db.getEnvVars('p1');
      expect(Object.keys(vars)).toHaveLength(3);
      expect(vars['A']).toBe('1');
    });

    it('mergeEnvVars preserves existing keys not in new vars', () => {
      db.setEnvVar('p1', 'A', '1');
      db.setEnvVar('p1', 'B', '2');

      db.mergeEnvVars('p1', { C: '3' });

      const vars = db.getEnvVars('p1');
      expect(vars['A']).toBe('1');
      expect(vars['B']).toBe('2');
      expect(vars['C']).toBe('3');
      expect(Object.keys(vars)).toHaveLength(3);
    });

    it('mergeEnvVars updates existing keys', () => {
      db.setEnvVar('p1', 'A', '1');

      db.mergeEnvVars('p1', { A: 'updated', B: '2' });

      const vars = db.getEnvVars('p1');
      expect(vars['A']).toBe('updated');
      expect(vars['B']).toBe('2');
    });

    it('finds projects by env key', () => {
      db.createProject({ id: 'p2', name: 'other-app', repoUrl: 'https://github.com/test/b' });

      db.setEnvVar('p1', 'SHARED_KEY', 'v1');
      db.setEnvVar('p2', 'SHARED_KEY', 'v2');

      const projectIds = db.findProjectsByEnvKey('SHARED_KEY');
      expect(projectIds).toHaveLength(2);
      expect(projectIds).toContain('p1');
      expect(projectIds).toContain('p2');
    });
  });

  // --- Deploy Logs ---

  describe('Deploy Logs', () => {
    beforeEach(() => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
    });

    it('creates and retrieves deploy logs', () => {
      db.createDeployLog({
        id: 'dl1',
        projectId: 'p1',
        status: 'success',
        trigger: 'chat',
        commitSha: 'abc123',
        durationMs: 5000,
      });

      const logs = db.getDeployLogs('p1');
      expect(logs).toHaveLength(1);
      expect(logs[0]!.status).toBe('success');
      expect(logs[0]!.commit_sha).toBe('abc123');
    });

    it('getLastDeployLog returns most recent', () => {
      db.createDeployLog({ id: 'dl1', projectId: 'p1', status: 'failed', trigger: 'api' });
      db.createDeployLog({ id: 'dl2', projectId: 'p1', status: 'success', trigger: 'chat' });

      const last = db.getLastDeployLog('p1');
      expect(last).toBeDefined();
      expect(last!.id).toBe('dl2');
    });

    it('initializes and migrates legacy deploy_logs without environment_id', () => {
      const dbPath = join(tmpDir, 'test.db');
      db.close();

      const legacy = createLegacySqlite(dbPath);
      legacy.exec('DROP TABLE IF EXISTS deploy_logs');
      legacy.exec('DROP TABLE IF EXISTS __drizzle_migrations');
      legacy.exec(`CREATE TABLE deploy_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        status TEXT,
        trigger_source TEXT,
        commit_sha TEXT,
        build_log TEXT,
        duration_ms INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      legacy.close();

      db = new Database(dbPath);

      db.createProject({
        id: 'legacy-p1',
        name: 'legacy-app',
        repoUrl: 'https://github.com/test/legacy',
      });
      db.createDeployLog({
        id: 'legacy-dl1',
        projectId: 'legacy-p1',
        environmentId: 'legacy-p1-production',
        status: 'success',
        trigger: 'api',
      });

      const scopedLogs = db.getDeployLogs('legacy-p1', 20, 'legacy-p1-production');
      expect(scopedLogs).toHaveLength(1);
      expect(scopedLogs[0]!.id).toBe('legacy-dl1');
    });
  });

  describe('Monorepo (parent-child projects)', () => {
    it('creates a parent project with children', () => {
      db.createProject({ id: 'parent1', name: 'my-saas', repoUrl: 'https://github.com/test/saas' });
      db.createProject({
        id: 'child1',
        name: 'my-saas/frontend',
        repoUrl: 'https://github.com/test/saas',
        parentProjectId: 'parent1',
        dockerfilePath: 'frontend/Dockerfile',
      });
      db.createProject({
        id: 'child2',
        name: 'my-saas/backend',
        repoUrl: 'https://github.com/test/saas',
        parentProjectId: 'parent1',
        dockerfilePath: 'backend/Dockerfile',
      });

      const children = db.getChildProjects('parent1');
      expect(children).toHaveLength(2);
      expect(children[0]!.name).toBe('my-saas/backend');
      expect(children[1]!.name).toBe('my-saas/frontend');
    });

    it('isParentProject returns true for parents', () => {
      db.createProject({ id: 'p1', name: 'parent', repoUrl: 'https://github.com/test/repo' });
      db.createProject({
        id: 'c1',
        name: 'parent/svc',
        repoUrl: 'https://github.com/test/repo',
        parentProjectId: 'p1',
      });

      expect(db.isParentProject('p1')).toBe(true);
      expect(db.isParentProject('c1')).toBe(false);
    });

    it('stores dockerfile_path correctly', () => {
      db.createProject({
        id: 'c1',
        name: 'app/api',
        repoUrl: 'https://github.com/test/app',
        dockerfilePath: 'api/Dockerfile',
      });

      const project = db.getProject('c1');
      expect(project!.dockerfile_path).toBe('api/Dockerfile');
    });

    it('defaults dockerfile_path to Dockerfile', () => {
      db.createProject({ id: 'p1', name: 'simple', repoUrl: 'https://github.com/test/simple' });
      const project = db.getProject('p1');
      expect(project!.dockerfile_path).toBe('Dockerfile');
    });

    it('defaults parent_project_id to null', () => {
      db.createProject({
        id: 'p1',
        name: 'standalone',
        repoUrl: 'https://github.com/test/standalone',
      });
      const project = db.getProject('p1');
      expect(project!.parent_project_id).toBeNull();
    });

    it('cascading delete removes children when parent is deleted', () => {
      db.createProject({ id: 'parent', name: 'group', repoUrl: 'https://github.com/test/group' });
      db.createProject({
        id: 'child1',
        name: 'group/a',
        repoUrl: 'https://github.com/test/group',
        parentProjectId: 'parent',
      });
      db.createProject({
        id: 'child2',
        name: 'group/b',
        repoUrl: 'https://github.com/test/group',
        parentProjectId: 'parent',
      });

      db.deleteProject('parent');

      expect(db.getProject('parent')).toBeUndefined();
      expect(db.getProject('child1')).toBeUndefined();
      expect(db.getProject('child2')).toBeUndefined();
    });

    it('getChildProjects returns empty for non-parent', () => {
      db.createProject({ id: 'p1', name: 'solo', repoUrl: 'https://github.com/test/solo' });
      expect(db.getChildProjects('p1')).toHaveLength(0);
    });

    it('getPreviewProjects returns preview children only', () => {
      db.createProject({ id: 'parent', name: 'app', repoUrl: 'https://github.com/test/app' });
      db.createProject({
        id: 'preview-1',
        name: 'app-pr-10',
        repoUrl: 'https://github.com/test/app',
        parentProjectId: 'parent',
      });
      db.createProject({
        id: 'child-1',
        name: 'app-worker',
        repoUrl: 'https://github.com/test/app',
        parentProjectId: 'parent',
      });

      db.updateProject('preview-1', { isPreview: 1, prNumber: 10 });

      const previews = db.getPreviewProjects('parent');
      expect(previews).toHaveLength(1);
      expect(previews[0]!.id).toBe('preview-1');
      expect(previews[0]!.is_preview).toBe(1);
      expect(previews[0]!.pr_number).toBe(10);
    });

    it('updateProject can set parentProjectId and dockerfilePath', () => {
      db.createProject({ id: 'p1', name: 'late-parent', repoUrl: 'https://github.com/test/lp' });
      db.createProject({ id: 'c1', name: 'orphan', repoUrl: 'https://github.com/test/lp' });

      db.updateProject('c1', { parentProjectId: 'p1', dockerfilePath: 'services/api/Dockerfile' });

      const updated = db.getProject('c1');
      expect(updated!.parent_project_id).toBe('p1');
      expect(updated!.dockerfile_path).toBe('services/api/Dockerfile');
      expect(db.isParentProject('p1')).toBe(true);
    });
  });

  describe('Duplicate project name', () => {
    it('throws ProjectAlreadyExistsError when name already exists', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

      expect(() =>
        db.createProject({ id: 'p2', name: 'my-app', repoUrl: 'https://github.com/test/b' }),
      ).toThrow(ProjectAlreadyExistsError);
    });

    it('includes project name in error message', () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

      expect(() =>
        db.createProject({ id: 'p2', name: 'my-app', repoUrl: 'https://github.com/test/b' }),
      ).toThrow('my-app');
    });

    it('allows creating projects with different names', () => {
      db.createProject({ id: 'p1', name: 'app-1', repoUrl: 'https://github.com/test/a' });

      expect(() =>
        db.createProject({ id: 'p2', name: 'app-2', repoUrl: 'https://github.com/test/b' }),
      ).not.toThrow();
    });
  });

  describe('Environments container_port', () => {
    beforeEach(() => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
    });

    it('environments table has container_port column after migration', () => {
      const dbPath = join(tmpDir, 'test.db');
      const sqlite = createLegacySqlite(dbPath);

      const columns = (
        sqlite.prepare('PRAGMA table_info(environments)').all() as Array<{
          name: string;
        }>
      ).map((c) => c.name);

      sqlite.close();
      expect(columns).toContain('container_port');
    });

    it('updateEnvironment persists containerPort', () => {
      const envs = db.getEnvironmentsByProject('p1');
      const env = envs.find((e) => e.type === 'production');
      expect(env).toBeDefined();

      db.updateEnvironment(env!.id, { containerPort: 8080 });

      const updated = db.getEnvironment(env!.id);
      expect(updated).toBeDefined();
      expect(updated!.container_port).toBe(8080);
    });

    it('backfill SQL copies container_port from projects to environments', () => {
      db.updateProject('p1', { containerPort: 3000 });

      db.updateEnvironment(
        db.getEnvironmentsByProject('p1').find((e) => e.type === 'production')!.id,
        { containerPort: null },
      );

      const sqlite = (db as unknown as { sqlite: { exec: (sql: string) => void } }).sqlite;
      sqlite.exec(
        'UPDATE environments SET container_port = (SELECT container_port FROM projects WHERE id = environments.project_id) WHERE container_port IS NULL',
      );

      const env = db.getEnvironmentsByProject('p1').find((e) => e.type === 'production');
      expect(env).toBeDefined();
      expect(env!.container_port).toBe(3000);
    });
  });
});
