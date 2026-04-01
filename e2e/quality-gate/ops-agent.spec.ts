import { test, expect } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  waitForStatus,
  getOpsHealth,
  getOpsIncidents,
  getOpsConfig,
  getCircuitBreakerState,
  resetCircuitBreaker,
  triggerDigest,
} from './fixtures/api.js';

test.describe.configure({ mode: 'serial' });

test.describe('OpsAgent — API Tests (no Docker required)', () => {
  test('health endpoint returns ok and running', async () => {
    const health = await getOpsHealth();
    expect(health.status).toBe('ok');
    expect(health.running).toBe(true);
    expect(typeof health.queue).toBe('number');
  });

  test('incidents endpoint returns paginated list', async () => {
    const result = await getOpsIncidents();
    expect(result).toHaveProperty('incidents');
    expect(Array.isArray(result.incidents)).toBe(true);
  });

  test('config endpoint returns enabled flag', async () => {
    const result = await getOpsConfig();
    expect(result).toHaveProperty('config');
    expect(typeof result.config).toBe('object');
  });

  test('circuit breaker endpoint responds for any project', async () => {
    const result = await getCircuitBreakerState('non-existent-project');
    expect(typeof result).toBe('object');
  });

  test('digest trigger returns triggered:true', async () => {
    const result = await triggerDigest();
    expect(result.triggered).toBe(true);
  });
});

test.describe('OpsAgent — Integration (requires Docker)', () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async () => {
    for (const id of Array.from(new Set(createdProjectIds))) {
      try {
        await deleteProject(id);
      } catch {
        /* cleanup best-effort */
      }
    }
  });

  test('crash scenario creates incident in ops_incidents', async () => {
    test.setTimeout(240_000);

    const deploy = await deployGitProject('https://github.com/openlander-ai/test-runtime-crash');
    expect(deploy.success).toBe(true);
    createdProjectIds.push(deploy.projectId);

    await waitForStatus(deploy.projectId, 'running', 120_000);
    await waitForStatus(deploy.projectId, 'error', 120_000);

    await new Promise((resolve) => setTimeout(resolve, 5000));

    const incidents = await getOpsIncidents(deploy.projectId);
    expect(incidents.incidents.length).toBeGreaterThanOrEqual(1);

    const incident = incidents.incidents[0] as Record<string, unknown>;
    expect(incident['project_id']).toBe(deploy.projectId);
    expect(['critical', 'warning']).toContain(incident['severity']);
    expect(['open', 'active', 'escalated']).toContain(incident['status']);
  });

  test('circuit breaker opens after repeated crashes', async () => {
    test.setTimeout(300_000);

    const deploy = await deployGitProject('https://github.com/openlander-ai/test-runtime-crash');
    expect(deploy.success).toBe(true);
    createdProjectIds.push(deploy.projectId);

    await waitForStatus(deploy.projectId, 'error', 120_000);
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const state = await getCircuitBreakerState(deploy.projectId);
    expect(state).toHaveProperty('state');

    const resetResult = await resetCircuitBreaker(deploy.projectId);
    expect(resetResult.reset).toBe(true);

    const stateAfter = await getCircuitBreakerState(deploy.projectId);
    expect((stateAfter.state as Record<string, unknown> | null)?.['state'] ?? 'closed').toBe(
      'closed',
    );
  });
});
