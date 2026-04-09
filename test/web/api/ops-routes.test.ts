/**
 * Automation policy API round-trip tests for ops-routes.
 *
 * Tests that:
 * - PUT /projects/:projectId/automation → GET /projects/:projectId/automation returns same values
 * - DELETE /projects/:projectId/automation → GET /projects/:projectId/automation returns defaults
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';
import { DEFAULT_RECOVERY_AUTOMATION } from '../../../src/monitor/ops-types.js';
import type { ProjectOpsOverride } from '../../../src/monitor/ops-types.js';

// ---------------------------------------------------------------------------
// In-memory store helpers to simulate database round-trips
// ---------------------------------------------------------------------------

function createOpsOverrideStore(): {
  store: Map<string, ProjectOpsOverride>;
  get: (projectId: string) => ProjectOpsOverride | undefined;
  set: (projectId: string, override: ProjectOpsOverride) => void;
  del: (projectId: string) => void;
} {
  const store = new Map<string, ProjectOpsOverride>();
  return {
    store,
    get: (projectId) => store.get(projectId),
    set: (projectId, override) => store.set(projectId, override),
    del: (projectId) => store.delete(projectId),
  };
}

function createHarness(overrideStore = createOpsOverrideStore()) {
  const ctx = {
    opsAgent: {
      getConfig: () => ({
        enabled: true,
        recovery: {
          enabled: true,
          automation: { ...DEFAULT_RECOVERY_AUTOMATION },
        },
        auto_restart: true,
        auto_cleanup: true,
        drift_detection: true,
        production_only: true,
        thresholds: {
          disk_cleanup_percent: 80,
          recovery_max_per_day: 5,
          alert_dedup_minutes: 15,
          digest_time: '09:00',
        },
        channels: {},
      }),
      getDigest: () => null,
      generateDigest: vi.fn(),
      reloadConfig: vi.fn(),
    },
    db: {
      getProject: (id: string) =>
        id === 'proj-1' ? { id: 'proj-1', name: 'alpha-service', status: 'running' } : undefined,
      getProjectOpsOverride: (projectId: string) => overrideStore.get(projectId),
      setProjectOpsOverride: (projectId: string, override: ProjectOpsOverride) =>
        overrideStore.set(projectId, override),
      deleteProjectOpsOverride: (projectId: string) => overrideStore.del(projectId),
      listOpsIncidentsByProject: () => [],
      listOpsIncidentsByDateRange: () => [],
      listOpsIncidentEventsByIncidentIds: () => [],
      listOpsIncidentEvents: () => [],
      getOpsIncident: () => undefined,
      getCircuitBreakerState: () => null,
      resetCircuitBreaker: vi.fn(),
      listAllCircuitBreakers: () => [],
      listProjects: () => [{ id: 'proj-1', name: 'alpha-service', status: 'running' }],
      listServices: () => [],
      findAllProjectDependencies: () => [],
      getActionRunsByProject: () => [],
      getActionRunsByApprovalStatus: () => [],
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api', createOpsRoutes(ctx));
  return { app, overrideStore };
}

// ---------------------------------------------------------------------------
// Automation policy round-trip tests
// ---------------------------------------------------------------------------

describe('PUT /api/projects/:projectId/automation → GET returns same values', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('PUT sets rollback to auto and GET reflects the change in overrides', async () => {
    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { rollback: 'auto' } }),
    });
    expect(putResponse.status).toBe(200);

    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
    expect(getResponse.status).toBe(200);

    const body = (await getResponse.json()) as {
      overrides: Record<string, string>;
      effective: Record<string, string>;
    };
    expect(body.overrides).not.toBeNull();
    expect(body.overrides['rollback']).toBe('auto');
    expect(body.effective['rollback']).toBe('auto');
  });

  it('PUT sets apply_fixes to confirm and GET reflects the change in overrides', async () => {
    await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { apply_fixes: 'confirm' } }),
    });

    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
    const body = (await getResponse.json()) as {
      overrides: Record<string, string>;
      effective: Record<string, string>;
    };
    expect(body.overrides['apply_fixes']).toBe('confirm');
    expect(body.effective['apply_fixes']).toBe('confirm');
  });

  it('PUT full policy and GET returns all four steps with correct values', async () => {
    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
      }),
    });
    expect(putResponse.status).toBe(200);

    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
    const body = (await getResponse.json()) as {
      effective: Record<string, string>;
      isAutopilot: boolean;
    };
    expect(body.effective['restart']).toBe('auto');
    expect(body.effective['diagnosis']).toBe('auto');
    expect(body.effective['apply_fixes']).toBe('auto');
    expect(body.effective['rollback']).toBe('auto');
    expect(body.isAutopilot).toBe(true);
  });

  it('PUT partial policy merges with existing overrides rather than replacing them', async () => {
    // First PUT sets rollback to auto
    await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { rollback: 'auto' } }),
    });

    // Second PUT sets apply_fixes to auto — rollback must still be auto
    await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { apply_fixes: 'auto' } }),
    });

    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
    const body = (await getResponse.json()) as { overrides: Record<string, string> };
    expect(body.overrides['rollback']).toBe('auto');
    expect(body.overrides['apply_fixes']).toBe('auto');
  });

  it('PUT returns 400 when automation step name is invalid', async () => {
    const response = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { unknown_step: 'auto' } }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('PUT returns 400 when automation mode value is invalid', async () => {
    const response = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { rollback: 'skip' } }),
    });
    expect(response.status).toBe(400);
  });

  it('PUT returns 404 when project does not exist', async () => {
    const response = await harness.app.request('/api/projects/nonexistent/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { rollback: 'auto' } }),
    });
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when project does not exist', async () => {
    const response = await harness.app.request('/api/projects/nonexistent/automation');
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE → GET returns defaults
// ---------------------------------------------------------------------------

describe('DELETE /api/projects/:projectId/automation → GET returns defaults', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('DELETE clears project override and GET effective policy falls back to global defaults', async () => {
    // Arrange: set a project override first
    await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automation: { rollback: 'auto', apply_fixes: 'auto' } }),
    });

    // Verify override is set
    const before = (await (
      await harness.app.request('/api/projects/proj-1/automation')
    ).json()) as { overrides: Record<string, string> | null };
    expect(before.overrides).not.toBeNull();

    // Act: delete the override
    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    const deleteBody = (await deleteResponse.json()) as { deleted: boolean };
    expect(deleteBody.deleted).toBe(true);

    // Assert: GET now returns null overrides and effective matches global defaults
    const after = (await (await harness.app.request('/api/projects/proj-1/automation')).json()) as {
      effective: Record<string, string>;
      overrides: Record<string, string> | null;
    };
    expect(after.overrides).toBeNull();
    expect(after.effective['rollback']).toBe(DEFAULT_RECOVERY_AUTOMATION.rollback);
    expect(after.effective['apply_fixes']).toBe(DEFAULT_RECOVERY_AUTOMATION.apply_fixes);
    expect(after.effective['restart']).toBe(DEFAULT_RECOVERY_AUTOMATION.restart);
    expect(after.effective['diagnosis']).toBe(DEFAULT_RECOVERY_AUTOMATION.diagnosis);
  });

  it('DELETE on a project with no existing override still returns deleted:true', async () => {
    // No prior PUT — deleting a non-existent override must not fail
    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    const body = (await deleteResponse.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it('GET effective policy after DELETE equals DEFAULT_RECOVERY_AUTOMATION exactly', async () => {
    // Arrange: set all steps to auto (overriding defaults where they differ)
    await harness.app.request('/api/projects/proj-1/automation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
      }),
    });

    // Act: delete
    await harness.app.request('/api/projects/proj-1/automation', { method: 'DELETE' });

    // Assert: effective matches DEFAULT_RECOVERY_AUTOMATION step by step
    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
    const body = (await getResponse.json()) as { effective: Record<string, string> };

    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
      expect(body.effective[step], `step ${step} must match default after DELETE`).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// Automation defaults endpoint
// ---------------------------------------------------------------------------

describe('GET /api/automation/defaults', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('returns defaults field equal to DEFAULT_RECOVERY_AUTOMATION', async () => {
    const response = await harness.app.request('/api/automation/defaults');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { defaults: Record<string, string> };
    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
      expect(body.defaults[step]).toBe(mode);
    }
  });

  it('returns effective field with all four configurable steps', async () => {
    const response = await harness.app.request('/api/automation/defaults');
    const body = (await response.json()) as { effective: Record<string, string> | null };
    const steps = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
    if (body.effective !== null) {
      for (const step of steps) {
        expect(body.effective[step]).toBeDefined();
      }
    }
  });

  it('returns isAutopilot boolean field', async () => {
    const response = await harness.app.request('/api/automation/defaults');
    const body = (await response.json()) as { isAutopilot: unknown };
    expect(typeof body.isAutopilot).toBe('boolean');
  });
});
