import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { ActionRunRepo } from '../../../src/db/repos/action-run.repo.js';
import { initializeDatabase } from '../../../src/db/migration.js';

describe('ActionRunRepo', () => {
  let repo: ActionRunRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new ActionRunRepo(db.db, db.sqlite);
    initializeDatabase(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('create', () => {
    it('creates a new action run with status=running', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
        triggerSessionId: 'sess-1',
        recoveryStrategy: 'llm',
      });

      expect(id).toBeTruthy();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(id);
      expect(runs[0].status).toBe('running');
      expect(runs[0].trigger_source).toBe('web_agent');
      expect(runs[0].recovery_strategy).toBe('llm');
      expect(runs[0].started_at).toBeTruthy();
      expect(runs[0].completed_at).toBeNull();
    });

    it('handles optional fields correctly', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'auto_recovery',
      });

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].trigger_session_id).toBeNull();
      expect(runs[0].recovery_strategy).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('updates status to succeeded and sets completed_at', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
      });

      repo.updateStatus(id, 'succeeded');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('succeeded');
      expect(runs[0].completed_at).toBeTruthy();
      expect(runs[0].error_message).toBeNull();
    });

    it('updates status to failed with error message', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'auto_recovery',
      });

      repo.updateStatus(id, 'failed', 'Build failed: out of memory');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error_message).toBe('Build failed: out of memory');
      expect(runs[0].completed_at).toBeTruthy();
    });

    it('updates status without error message', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'monitor',
      });

      repo.updateStatus(id, 'failed');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error_message).toBeNull();
    });

    it('updates status to pending_approval and keeps completed_at null', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
      });

      repo.updateStatus(id, 'pending_approval');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('pending_approval');
      expect(runs[0].completed_at).toBeNull();
      expect(runs[0].error_message).toBeNull();
    });

    it('transitions from pending_approval to succeeded', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
      });

      repo.updateStatus(id, 'pending_approval');
      repo.updateStatus(id, 'succeeded');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('succeeded');
      expect(runs[0].completed_at).toBeTruthy();
    });

    it('transitions from pending_approval to failed', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'auto_recovery',
      });

      repo.updateStatus(id, 'pending_approval');
      repo.updateStatus(id, 'failed', 'Approval rejected');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error_message).toBe('Approval rejected');
      expect(runs[0].completed_at).toBeTruthy();
    });
  });

  describe('updatePlan', () => {
    it('stores plan JSON and updates updated_at timestamp', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
      });

      repo.updatePlan(id, '{"steps":["analyze","fix"]}');

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].plan).toBe('{"steps":["analyze","fix"]}');
      expect(runs[0].updated_at).toBeTruthy();
    });
  });

  describe('updateStep', () => {
    it('updates current_step and total_steps when both are provided', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'auto_recovery',
      });

      repo.updateStep(id, 2, 5);

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].current_step).toBe(2);
      expect(runs[0].total_steps).toBe(5);
      expect(runs[0].updated_at).toBeTruthy();
    });

    it('updates only current_step when totalSteps is omitted', () => {
      const id = repo.create({
        projectId: 'proj-1',
        triggerSource: 'monitor',
      });

      repo.updateStep(id, 1);

      const runs = repo.findByProjectId('proj-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].current_step).toBe(1);
      expect(runs[0].total_steps).toBeNull();
      expect(runs[0].updated_at).toBeTruthy();
    });
  });

  describe('findRunning', () => {
    it('returns only running action runs for a project', () => {
      const projectId = 'proj-1';

      const id1 = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      const id2 = repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      repo.updateStatus(id1, 'succeeded');

      const running = repo.findRunning(projectId);

      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(id2);
      expect(running[0].status).toBe('running');
    });

    it('returns empty array when no running action runs', () => {
      const projectId = 'proj-1';

      const id = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      repo.updateStatus(id, 'succeeded');

      const running = repo.findRunning(projectId);

      expect(running).toHaveLength(0);
    });

    it('returns empty array for non-existent project', () => {
      const running = repo.findRunning('non-existent');
      expect(running).toHaveLength(0);
    });

    it('includes pending_approval as active', () => {
      const projectId = 'proj-1';

      const pendingId = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });
      repo.updateStatus(pendingId, 'pending_approval');

      const running = repo.findRunning(projectId);

      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(pendingId);
      expect(running[0].status).toBe('pending_approval');
    });
  });

  describe('findByProjectId', () => {
    it('returns all action runs for a project ordered by created_at descending', () => {
      const projectId = 'proj-1';

      repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      const runs = repo.findByProjectId(projectId);

      expect(runs).toHaveLength(2);
      expect(runs.map((r) => r.trigger_source)).toContain('web_agent');
      expect(runs.map((r) => r.trigger_source)).toContain('auto_recovery');
    });

    it('respects limit parameter', () => {
      const projectId = 'proj-1';

      repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      repo.create({
        projectId,
        triggerSource: 'monitor',
      });

      const runs = repo.findByProjectId(projectId, 2);

      expect(runs).toHaveLength(2);
    });

    it('returns empty array for non-existent project', () => {
      const runs = repo.findByProjectId('non-existent');
      expect(runs).toHaveLength(0);
    });
  });

  describe('markStaleAsFailedOnStartup', () => {
    it('marks all running action runs as failed with error message', () => {
      const projectId = 'proj-1';

      const id1 = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      const id2 = repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      repo.updateStatus(id1, 'succeeded');

      const count = repo.markStaleAsFailedOnStartup();

      expect(count).toBe(1);

      const runs = repo.findByProjectId(projectId);
      expect(runs).toHaveLength(2);

      const failed = runs.find((r) => r.id === id2);
      expect(failed?.status).toBe('failed');
      expect(failed?.error_message).toBe('Server restarted');
      expect(failed?.completed_at).toBeTruthy();

      const succeeded = runs.find((r) => r.id === id1);
      expect(succeeded?.status).toBe('succeeded');
    });

    it('returns 0 when no running action runs exist', () => {
      const projectId = 'proj-1';

      const id = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      repo.updateStatus(id, 'succeeded');

      const count = repo.markStaleAsFailedOnStartup();

      expect(count).toBe(0);
    });

    it('marks multiple stale runs across different projects', () => {
      const id1 = repo.create({
        projectId: 'proj-1',
        triggerSource: 'web_agent',
      });

      const id2 = repo.create({
        projectId: 'proj-2',
        triggerSource: 'auto_recovery',
      });

      const id3 = repo.create({
        projectId: 'proj-1',
        triggerSource: 'monitor',
      });

      repo.updateStatus(id1, 'succeeded');

      const count = repo.markStaleAsFailedOnStartup();

      expect(count).toBe(2);

      const runs1 = repo.findByProjectId('proj-1');
      const runs2 = repo.findByProjectId('proj-2');

      expect(runs1.find((r) => r.id === id3)?.status).toBe('failed');
      expect(runs2.find((r) => r.id === id2)?.status).toBe('failed');
    });

    it('marks pending_approval action runs as failed on startup', () => {
      const projectId = 'proj-1';

      const id1 = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      const id2 = repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      repo.updateStatus(id1, 'pending_approval');
      repo.updateStatus(id2, 'succeeded');

      const count = repo.markStaleAsFailedOnStartup();

      expect(count).toBe(1);

      const runs = repo.findByProjectId(projectId);
      expect(runs).toHaveLength(2);

      const failed = runs.find((r) => r.id === id1);
      expect(failed?.status).toBe('failed');
      expect(failed?.error_message).toBe('Server restarted');
      expect(failed?.completed_at).toBeTruthy();

      const succeeded = runs.find((r) => r.id === id2);
      expect(succeeded?.status).toBe('succeeded');
    });

    it('marks both running and pending_approval action runs as failed', () => {
      const projectId = 'proj-1';

      const id1 = repo.create({
        projectId,
        triggerSource: 'web_agent',
      });

      const id2 = repo.create({
        projectId,
        triggerSource: 'auto_recovery',
      });

      const id3 = repo.create({
        projectId,
        triggerSource: 'monitor',
      });

      repo.updateStatus(id1, 'pending_approval');
      repo.updateStatus(id3, 'succeeded');

      const count = repo.markStaleAsFailedOnStartup();

      expect(count).toBe(2);

      const runs = repo.findByProjectId(projectId);
      expect(runs).toHaveLength(3);

      const failed1 = runs.find((r) => r.id === id1);
      expect(failed1?.status).toBe('failed');
      expect(failed1?.error_message).toBe('Server restarted');

      const failed2 = runs.find((r) => r.id === id2);
      expect(failed2?.status).toBe('failed');
      expect(failed2?.error_message).toBe('Server restarted');

      const succeeded = runs.find((r) => r.id === id3);
      expect(succeeded?.status).toBe('succeeded');
    });
  });
});
