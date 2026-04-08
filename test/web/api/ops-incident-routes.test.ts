import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';
import type { OpsIncidentEventRow, OpsIncidentRow } from '../../../src/db/types.js';

interface TestHarness {
  app: Hono;
  listOpsIncidentEventsByIncidentIds: ReturnType<typeof vi.fn>;
  listOpsIncidentEvents: ReturnType<typeof vi.fn>;
}

function createHarness(): TestHarness {
  const incidents: OpsIncidentRow[] = [
    {
      id: 'inc-1',
      project_id: 'proj-1',
      severity: 'critical',
      status: 'open',
      root_cause: 'Health check failed after restart (3 attempts over 90s)',
      diagnosis: 'container restarted repeatedly',
      actions_taken: null,
      created_at: 1_700_000_000_000,
      resolved_at: null,
      escalated_at: null,
    },
  ];

  const events: OpsIncidentEventRow[] = [
    {
      id: 'evt-1',
      incident_id: 'inc-1',
      event_type: 'detected',
      description: 'Incident detected: deploy:crash — npm install failed',
      metadata: JSON.stringify({
        trigger_type: 'deploy:crash',
        trigger_details: 'npm install failed',
      }),
      created_at: 1_700_000_000_001,
    },
    {
      id: 'evt-2',
      incident_id: 'inc-1',
      event_type: 'cascade_detected',
      description: '1 dependent project(s) may be affected',
      metadata: JSON.stringify({
        affected_project_ids: ['proj-2'],
      }),
      created_at: 1_700_000_000_002,
    },
  ];

  const listOpsIncidentEventsByIncidentIds = vi.fn((incidentIds: string[]) =>
    events.filter((event) => incidentIds.includes(event.incident_id)),
  );
  const listOpsIncidentEvents = vi.fn((incidentId: string) =>
    events.filter((event) => event.incident_id === incidentId),
  );

  const ctx = {
    opsAgent: {
      getConfig: () => ({}),
      getDigest: () => null,
      generateDigest: vi.fn(),
      reloadConfig: vi.fn(),
    },
    db: {
      listOpsIncidentsByProject: () => incidents,
      listOpsIncidentsByDateRange: () => incidents,
      listOpsIncidentEventsByIncidentIds,
      listOpsIncidentEvents,
      getOpsIncident: (id: string) => incidents.find((incident) => incident.id === id),
      getProject: () => undefined,
      getProjectOpsOverride: () => undefined,
      setProjectOpsOverride: vi.fn(),
      deleteProjectOpsOverride: vi.fn(),
      getCircuitBreakerState: () => null,
      resetCircuitBreaker: vi.fn(),
      listAllCircuitBreakers: () => [],
      listProjects: () => [{ id: 'proj-1', name: 'alpha-service', status: 'error' }],
      listServices: () => [],
      findAllProjectDependencies: () => [],
      getActionRunsByProject: () => [],
      getActionRunsByApprovalStatus: () => [],
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api', createOpsRoutes(ctx));
  return { app, listOpsIncidentEventsByIncidentIds, listOpsIncidentEvents };
}

describe('Ops incident routes', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('returns triggerType from detected metadata in /incidents', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0].title).toBe('Health check failed after restart (3 attempts over 90s)');
    expect(body.incidents[0].triggerType).toBe('deploy:crash');
    expect(body.incidents[0].trigger_type).toBe('deploy:crash');
  });

  it('returns event aliases (type/message) in /incidents/:id/events', async () => {
    const response = await harness.app.request('/api/incidents/inc-1/events');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].type).toBe('detected');
    expect(body.events[0].message).toBe('Incident detected: deploy:crash — npm install failed');
    expect(body.events[0].event_type).toBe('detected');
    expect(body.events[0].description).toBe('Incident detected: deploy:crash — npm install failed');
  });

  it('uses batched incident events and includes triggerType in /activity', async () => {
    const response = await harness.app.request('/api/activity?types=incident,alert');
    expect(response.status).toBe(200);

    const body = await response.json();
    const incidentActivity = body.activities.find(
      (item: { type: string }) => item.type === 'incident',
    );
    const alertActivity = body.activities.find((item: { type: string }) => item.type === 'alert');

    expect(incidentActivity?.triggerType).toBe('deploy:crash');
    expect(incidentActivity?.trigger_type).toBe('deploy:crash');
    expect(alertActivity?.cascadeGroup).toEqual(['proj-2']);
    expect(harness.listOpsIncidentEventsByIncidentIds).toHaveBeenCalledTimes(1);
    expect(harness.listOpsIncidentEvents).not.toHaveBeenCalled();
  });
});
