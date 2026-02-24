import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../src/db/index.js';

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
  });

  // --- Chat History ---

  describe('Chat History', () => {
    it('saves and retrieves chat messages', () => {
      db.saveChatMessage({
        id: 'msg1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Deploy my app',
      });

      db.saveChatMessage({
        id: 'msg2',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Deploying...',
      });

      const history = db.getChatHistory('session-1');
      expect(history).toHaveLength(2);
      expect(history[0]!.role).toBe('user');
      expect(history[1]!.role).toBe('assistant');
    });

    it('lists chat sessions', () => {
      db.saveChatMessage({ id: 'msg1', sessionId: 's1', role: 'user', content: 'hi' });
      db.saveChatMessage({ id: 'msg2', sessionId: 's1', role: 'assistant', content: 'hello' });
      db.saveChatMessage({ id: 'msg3', sessionId: 's2', role: 'user', content: 'deploy' });

      const sessions = db.listChatSessions();
      expect(sessions).toHaveLength(2);
    });
  });
});
