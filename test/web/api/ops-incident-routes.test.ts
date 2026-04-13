import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';
import type {
  CircuitBreakerRow,
  OpsIncidentEventRow,
  OpsIncidentRow,
} from '../../../src/db/types.js';

interface TestHarness {
  app: Hono;
  listOpsIncidentEventsByIncidentIds: ReturnType<typeof vi.fn>;
  listOpsIncidentEvents: ReturnType<typeof vi.fn>;
  circuitBreakers: CircuitBreakerRow[];
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

  const circuitBreakers: CircuitBreakerRow[] = [
    {
      project_id: 'proj-1',
      state: 'open',
      failure_count: 5,
      last_failure_at: 1_700_000_000_000,
      opened_at: 1_700_000_000_000,
      reset_at: null,
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
      listAllCircuitBreakers: () => circuitBreakers,
      listProjects: () => [{ id: 'proj-1', name: 'alpha-service', status: 'error' }],
      listServices: () => [],
      findAllProjectDependencies: () => [],
      getActionRunsByProject: () => [],
      getRecentActionRuns: () => [],
      getActionRunsByApprovalStatus: () => [],
      findActivityLogRecent: () => [],
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api', createOpsRoutes(ctx));
  return { app, listOpsIncidentEventsByIncidentIds, listOpsIncidentEvents, circuitBreakers };
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
    expect(alertActivity?.cascadeGroup).toEqual(['proj-2']);
    expect(harness.listOpsIncidentEventsByIncidentIds).toHaveBeenCalledTimes(1);
    expect(harness.listOpsIncidentEvents).not.toHaveBeenCalled();
  });
});

// ── Regression tests: /api/ops/incidents response shape ───────────────────────

describe('GET /api/incidents regression shape', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('response has incidents array at root', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { incidents: unknown[] };
    expect(Array.isArray(body.incidents)).toBe(true);
  });

  it('each incident item has required identity fields', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    expect(typeof incident['id']).toBe('string');
    expect(typeof incident['project_id']).toBe('string');
  });

  it('each incident item has severity as critical/warning/info string', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    expect(['critical', 'warning', 'info']).toContain(incident['severity']);
  });

  it('each incident item has status as open/active/resolved/escalated string', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    expect(['open', 'active', 'resolved', 'escalated']).toContain(incident['status']);
  });

  it('each incident item has title derived from root_cause', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    expect(typeof incident['title']).toBe('string');
    expect((incident['title'] as string).length).toBeGreaterThan(0);
  });

  it('each incident item has numeric created_at timestamp', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    expect(typeof incident['created_at']).toBe('number');
  });

  it('each incident item has optional triggerType string when event metadata is present', async () => {
    const response = await harness.app.request('/api/incidents?projectId=proj-1');
    const body = (await response.json()) as { incidents: Record<string, unknown>[] };
    const [incident] = body.incidents;
    // triggerType is optional but must be string when present
    if (incident['triggerType'] !== undefined) {
      expect(typeof incident['triggerType']).toBe('string');
    }
  });

  it('returns 500 and error field when db throws', async () => {
    const brokenCtx = {
      opsAgent: {
        getConfig: () => ({}),
        getDigest: () => null,
        generateDigest: vi.fn(),
        reloadConfig: vi.fn(),
      },
      db: {
        listOpsIncidentsByProject: () => {
          throw new Error('db error');
        },
        listOpsIncidentsByDateRange: () => {
          throw new Error('db error');
        },
        listOpsIncidentEventsByIncidentIds: () => [],
        listOpsIncidentEvents: () => [],
        getOpsIncident: () => undefined,
        getProject: () => undefined,
        getProjectOpsOverride: () => undefined,
        setProjectOpsOverride: vi.fn(),
        deleteProjectOpsOverride: vi.fn(),
        getCircuitBreakerState: () => null,
        resetCircuitBreaker: vi.fn(),
        listAllCircuitBreakers: () => [],
        listProjects: () => [],
        listServices: () => [],
        findAllProjectDependencies: () => [],
        getActionRunsByProject: () => [],
        getRecentActionRuns: () => [],
        getActionRunsByApprovalStatus: () => [],
        findActivityLogRecent: () => [],
      },
    } as unknown as AppContext;
    const errorApp = new Hono();
    errorApp.route('/api', createOpsRoutes(brokenCtx));

    const response = await errorApp.request('/api/incidents?projectId=proj-1');
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

// ── Regression tests: /api/ops/circuit-breakers response shape ────────────────

describe('GET /api/circuit-breakers regression shape', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('response has breakers array at root', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { breakers: unknown[] };
    expect(Array.isArray(body.breakers)).toBe(true);
  });

  it('each breaker has projectId string field', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    const body = (await response.json()) as { breakers: Record<string, unknown>[] };
    const [breaker] = body.breakers;
    expect(typeof breaker['projectId']).toBe('string');
  });

  it('each breaker has projectName string field resolved from projects list', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    const body = (await response.json()) as { breakers: Record<string, unknown>[] };
    const [breaker] = body.breakers;
    expect(typeof breaker['projectName']).toBe('string');
    // proj-1 maps to alpha-service from the harness listProjects mock
    expect(breaker['projectName']).toBe('alpha-service');
  });

  it('each breaker has state as open/half_open/closed', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    const body = (await response.json()) as { breakers: Record<string, unknown>[] };
    const [breaker] = body.breakers;
    expect(['open', 'half_open', 'closed']).toContain(breaker['state']);
  });

  it('each breaker has numeric failureCount field', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    const body = (await response.json()) as { breakers: Record<string, unknown>[] };
    const [breaker] = body.breakers;
    expect(typeof breaker['failureCount']).toBe('number');
  });

  it('breakers are sorted with open state first', async () => {
    const response = await harness.app.request('/api/circuit-breakers');
    const body = (await response.json()) as { breakers: Record<string, unknown>[] };
    // harness only has one breaker in 'open' state — it must be first
    expect(body.breakers[0]?.['state']).toBe('open');
  });

  it('returns empty breakers array when no circuit breakers exist', async () => {
    const emptyCtx = {
      opsAgent: {
        getConfig: () => ({}),
        getDigest: () => null,
        generateDigest: vi.fn(),
        reloadConfig: vi.fn(),
      },
      db: {
        listAllCircuitBreakers: () => [],
        listProjects: () => [],
        listOpsIncidentsByProject: () => [],
        listOpsIncidentsByDateRange: () => [],
        listOpsIncidentEventsByIncidentIds: () => [],
        listOpsIncidentEvents: () => [],
        getOpsIncident: () => undefined,
        getProject: () => undefined,
        getProjectOpsOverride: () => undefined,
        setProjectOpsOverride: vi.fn(),
        deleteProjectOpsOverride: vi.fn(),
        getCircuitBreakerState: () => null,
        resetCircuitBreaker: vi.fn(),
        listServices: () => [],
        findAllProjectDependencies: () => [],
        getActionRunsByProject: () => [],
        getRecentActionRuns: () => [],
        getActionRunsByApprovalStatus: () => [],
        findActivityLogRecent: () => [],
      },
    } as unknown as AppContext;
    const emptyApp = new Hono();
    emptyApp.route('/api', createOpsRoutes(emptyCtx));

    const response = await emptyApp.request('/api/circuit-breakers');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { breakers: unknown[] };
    expect(body.breakers).toHaveLength(0);
  });
});

// ── Regression tests: /api/ops/activity response shape ────────────────────────

describe('GET /api/activity (ops-routes) regression shape', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('response has activities array and nextCursor at root', async () => {
    const response = await harness.app.request('/api/activity');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { activities: unknown[]; nextCursor: unknown };
    expect(Array.isArray(body.activities)).toBe(true);
    // nextCursor is present (may be null or a string)
    expect('nextCursor' in body).toBe(true);
  });

  it('each activity item has required ActivityItem fields', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    const [item] = body.activities;
    // Required fields per ActivityItem interface in ops-routes.ts
    expect(typeof item['id']).toBe('string');
    expect(typeof item['timestamp']).toBe('string');
    expect(typeof item['type']).toBe('string');
    expect(typeof item['severity']).toBe('string');
    expect(typeof item['projectId']).toBe('string');
    expect(typeof item['projectName']).toBe('string');
    expect(typeof item['title']).toBe('string');
    expect(typeof item['description']).toBe('string');
    expect(typeof item['status']).toBe('string');
  });

  it('timestamp field is a valid ISO 8601 string', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    const [item] = body.activities;
    const timestamp = item['timestamp'] as string;
    expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
  });

  it('type field is one of the allowed ActivityItem type values', async () => {
    const response = await harness.app.request('/api/activity');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    const allowedTypes = [
      'incident',
      'recovery',
      'approval',
      'circuit_breaker',
      'cleanup',
      'alert',
    ];
    for (const item of body.activities as Record<string, unknown>[]) {
      expect(allowedTypes).toContain(item['type']);
    }
  });

  it('severity field is one of critical/warning/info', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    for (const item of body.activities as Record<string, unknown>[]) {
      expect(['critical', 'warning', 'info']).toContain(item['severity']);
    }
  });

  it('status field is one of active/resolved/pending/failed', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    for (const item of body.activities as Record<string, unknown>[]) {
      expect(['active', 'resolved', 'pending', 'failed']).toContain(item['status']);
    }
  });

  it('incident activity item has incidentId equal to incident id', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    const [item] = body.activities;
    expect(item['incidentId']).toBe('inc-1');
  });

  it('nextCursor is null when results are fewer than limit', async () => {
    const response = await harness.app.request('/api/activity?limit=200');
    const body = (await response.json()) as { activities: unknown[]; nextCursor: unknown };
    // harness returns 2 activities (1 incident + 1 alert from cascade_detected event)
    // which is fewer than limit=200, so cursor should be null
    expect(body.nextCursor).toBeNull();
  });

  it('filters by types parameter and excludes non-matching types', async () => {
    const response = await harness.app.request('/api/activity?types=approval');
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    for (const item of body.activities) {
      expect(item['type']).toBe('approval');
    }
  });

  it('returns only incidents when types=incident', async () => {
    const response = await harness.app.request('/api/activity?types=incident');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { activities: Record<string, unknown>[] };
    const nonIncident = body.activities.filter((a) => a['type'] !== 'incident');
    expect(nonIncident).toHaveLength(0);
  });
});
