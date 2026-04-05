import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';
import {
  DEFAULT_OPS_CONFIG,
  DEFAULT_RECOVERY_AUTOMATION,
  type ProjectOpsOverride,
} from '../../../src/monitor/ops-types.js';

function createTestApp() {
  const overrides = new Map<string, ProjectOpsOverride>();

  const ctx = {
    opsAgent: {
      getConfig: () => DEFAULT_OPS_CONFIG,
      getDigest: () => null,
      generateDigest: vi.fn(),
      reloadConfig: vi.fn(),
    },
    db: {
      getProject: (id: string) => (id === 'proj-1' ? { id: 'proj-1', name: 'Test' } : undefined),
      getProjectOpsOverride: (id: string) => overrides.get(id),
      setProjectOpsOverride: (id: string, data: ProjectOpsOverride) => overrides.set(id, data),
      deleteProjectOpsOverride: (id: string) => overrides.delete(id),
      listOpsIncidentsByProject: () => [],
      listOpsIncidentsByDateRange: () => [],
      getOpsIncident: () => undefined,
      listOpsIncidentEvents: () => [],
      getCircuitBreakerState: () => null,
      resetCircuitBreaker: vi.fn(),
      listAllCircuitBreakers: () => [],
      listProjects: () => [{ id: 'proj-1', name: 'Test', status: 'running' }],
      listServices: () => [],
      findAllProjectDependencies: () => [],
      getActionRunsByProject: () => [],
      getActionRunsByApprovalStatus: () => [],
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api', createOpsRoutes(ctx));
  return { app, overrides };
}

describe('Automation Policy Routes', () => {
  let app: Hono;
  let overrides: Map<string, ProjectOpsOverride>;

  beforeEach(() => {
    const test = createTestApp();
    app = test.app;
    overrides = test.overrides;
  });

  describe('GET /api/automation/defaults', () => {
    it('returns defaults and effective policy', async () => {
      const res = await app.request('/api/automation/defaults');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.defaults).toEqual(DEFAULT_RECOVERY_AUTOMATION);
      expect(body.effective).toEqual(DEFAULT_RECOVERY_AUTOMATION);
      expect(body.isAutopilot).toBe(false);
    });
  });

  describe('GET /api/projects/:projectId/automation', () => {
    it('returns effective policy for existing project', async () => {
      const res = await app.request('/api/projects/proj-1/automation');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.effective).toEqual(DEFAULT_RECOVERY_AUTOMATION);
      expect(body.overrides).toBeNull();
      expect(body.isAutopilot).toBe(false);
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.request('/api/projects/no-such-project/automation');
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('PUT /api/projects/:projectId/automation', () => {
    it('saves valid automation overrides', async () => {
      const res = await app.request('/api/projects/proj-1/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: { restart: 'confirm', rollback: 'auto' } }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.effective.restart).toBe('confirm');
      expect(body.effective.rollback).toBe('auto');
      expect(body.overrides).toEqual({ restart: 'confirm', rollback: 'auto' });
    });

    it('returns 404 for non-existent project', async () => {
      const res = await app.request('/api/projects/no-such-project/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: { restart: 'auto' } }),
      });
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('returns 400 for invalid step name', async () => {
      const res = await app.request('/api/projects/proj-1/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: { invalid_step: 'auto' } }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Invalid step: invalid_step');
    });

    it('returns 400 for invalid mode value', async () => {
      const res = await app.request('/api/projects/proj-1/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: { restart: 'yolo' } }),
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Invalid mode: yolo');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/api/projects/proj-1/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Invalid JSON body');
    });
  });

  describe('DELETE /api/projects/:projectId/automation', () => {
    it('deletes override and returns deleted true', async () => {
      const res = await app.request('/api/projects/proj-1/automation', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ deleted: true });
    });

    it('returns null overrides after delete', async () => {
      overrides.set('proj-1', { automation: { restart: 'confirm' } });

      await app.request('/api/projects/proj-1/automation', { method: 'DELETE' });

      const res = await app.request('/api/projects/proj-1/automation');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.overrides).toBeNull();
    });
  });
});
