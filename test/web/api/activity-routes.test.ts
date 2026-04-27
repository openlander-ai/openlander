/**
 * Regression tests for the activity data layer.
 *
 * The `/api/activity` endpoint (routes.ts) uses the in-memory EventBus buffer
 * and is not easily unit-tested in isolation because `createApiRoutes()` registers
 * live EventBus listeners as a module-level side effect. These tests therefore
 * exercise the two testable layers:
 *
 * 1. ActivityLogRepo — the DB-backed data source introduced in T2/T6.
 *    Tests verify CRUD, cursor pagination (findSince), date-range queries,
 *    and retention cleanup (deleteOlderThan).
 *
 * 2. ActivityEvent mapper helpers — pure functions that transform raw EventBus
 *    payloads into the ActivityEvent shape used by the endpoint response.
 *
 * SSE streaming is deliberately excluded (E2E / Playwright concern, not unit).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { ActivityLogRepo } from '../../../src/db/repos/activity-log.repo.js';
import type { ActivityLogRow } from '../../../src/db/types.js';
import {
  buildActivityEvent,
  mapActivitySeverity,
  mapActivityStatus,
  mapActivityType,
} from '../../../src/monitor/activity-event-mapper.js';

type ActivityInsert = Parameters<ActivityLogRepo['insert']>[0];

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ActivityInsert> = {}): ActivityInsert {
  return {
    event_type: 'deploy:crash',
    activity_type: 'incident',
    severity: 'critical',
    project_id: 'proj-1',
    correlation_id: null,
    title: 'Deploy crashed',
    description: 'npm install failed',
    status: 'active',
    metadata: '{}',
    ...overrides,
  };
}

// ── ActivityLogRepo tests ─────────────────────────────────────────────────────

describe('ActivityLogRepo', () => {
  let repo: ActivityLogRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
    repo = new ActivityLogRepo(db.db, db.sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('insert', () => {
    it('returns a row with a 26-character ULID id', () => {
      const row = repo.insert(makeEntry());
      expect(typeof row.id).toBe('string');
      expect(row.id).toHaveLength(26);
    });

    it('persisted row has all required ActivityLogRow fields', () => {
      const row = repo.insert(makeEntry({ project_id: 'proj-x', title: 'Test title' }));
      expect(row.event_type).toBe('deploy:crash');
      expect(row.activity_type).toBe('incident');
      expect(row.severity).toBe('critical');
      expect(row.project_id).toBe('proj-x');
      expect(row.title).toBe('Test title');
      expect(row.description).toBe('npm install failed');
      expect(row.status).toBe('active');
    });

    it('stores correlation_id when provided', () => {
      const row = repo.insert(makeEntry({ correlation_id: 'inc-abc' }));
      expect(row.correlation_id).toBe('inc-abc');
    });

    it('stores null correlation_id when omitted', () => {
      const row = repo.insert(makeEntry());
      expect(row.correlation_id).toBeNull();
    });

    it('created_at is an ISO 8601 string', () => {
      const row = repo.insert(makeEntry());
      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
    });
  });

  describe('findSince (cursor pagination)', () => {
    it('returns rows with id lexicographically greater than the given cursor', () => {
      const a = repo.insert(makeEntry({ title: 'row-a' }));
      const b = repo.insert(makeEntry({ title: 'row-b' }));
      const c = repo.insert(makeEntry({ title: 'row-c' }));

      // Determine which rows have ids greater than a.id by sorting all ids.
      // (ULIDs in same millisecond are not guaranteed to be in insertion order.)
      const allRows = [a, b, c];
      const afterA = allRows.filter((r) => r.id > a.id);

      const results = repo.findSince(a.id, 50);
      expect(results).toHaveLength(afterA.length);
      for (const row of results) {
        expect(row.id.localeCompare(a.id)).toBeGreaterThan(0);
      }
      // The cursor row itself must not be returned.
      expect(results.some((r) => r.id === a.id)).toBe(false);
    });

    it('returns empty array when no rows exist after cursor', () => {
      const row = repo.insert(makeEntry());
      const results = repo.findSince(row.id, 50);
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        repo.insert(makeEntry({ title: `entry-${String(i)}` }));
      }
      const first = repo.findSince('', 3);
      expect(first).toHaveLength(3);
    });

    it('returns rows in ascending ULID order (lexicographic)', () => {
      repo.insert(makeEntry({ title: 'x' }));
      repo.insert(makeEntry({ title: 'y' }));
      repo.insert(makeEntry({ title: 'z' }));

      const results = repo.findSince('', 50);
      const ids = results.map((r) => r.id);
      // Verify the returned list is sorted ascending by id.
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]!.localeCompare(ids[i - 1]!)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('findByDateRange', () => {
    it('returns rows whose created_at falls within the range', () => {
      repo.insert(makeEntry({ title: 'in-range' }));

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const results = repo.findByDateRange(from, to);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('in-range');
    });

    it('excludes rows outside the date range', () => {
      repo.insert(makeEntry({ title: 'recent' }));

      const pastFrom = '2020-01-01T00:00:00.000Z';
      const pastTo = '2020-01-02T00:00:00.000Z';

      const results = repo.findByDateRange(pastFrom, pastTo);
      expect(results).toHaveLength(0);
    });

    it('filters by project_id when provided', () => {
      repo.insert(makeEntry({ project_id: 'proj-1', title: 'for-proj-1' }));
      repo.insert(makeEntry({ project_id: 'proj-2', title: 'for-proj-2' }));

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const results = repo.findByDateRange(from, to, { project_id: 'proj-1' });
      expect(results.every((r) => r.project_id === 'proj-1')).toBe(true);
      const titles = results.map((r) => r.title);
      expect(titles).toContain('for-proj-1');
      expect(titles).not.toContain('for-proj-2');
    });

    it('filters by activity_type when provided', () => {
      repo.insert(makeEntry({ activity_type: 'incident', title: 'an-incident' }));
      repo.insert(makeEntry({ activity_type: 'recovery', title: 'a-recovery' }));

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      const results = repo.findByDateRange(from, to, { activity_type: 'incident' });
      expect(results.every((r) => r.activity_type === 'incident')).toBe(true);
    });

    it('supports ULID cursor to exclude rows at or before the cursor id', () => {
      // Insert several rows and capture their IDs in insertion order.
      // findByDateRange uses gt(id, cursor), so rows with ids > cursor are returned.
      const all = [
        repo.insert(makeEntry({ title: 'row-1' })),
        repo.insert(makeEntry({ title: 'row-2' })),
        repo.insert(makeEntry({ title: 'row-3' })),
      ];

      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();

      // Sort the inserted rows by id to determine which are "after" the first one.
      const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
      const cursor = sorted[0]!.id;

      const results = repo.findByDateRange(from, to, {}, cursor);

      // All returned rows must have id > cursor.
      for (const row of results) {
        expect(row.id.localeCompare(cursor)).toBeGreaterThan(0);
      }
      // The row at cursor must not appear in results.
      expect(results.some((r) => r.id === cursor)).toBe(false);
    });
  });

  describe('deleteOlderThan', () => {
    it('removes rows created before the threshold and returns the count deleted', () => {
      const pastIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      repo.insert(makeEntry({ created_at: pastIso, title: 'old-entry' }));
      repo.insert(makeEntry({ title: 'recent-entry' }));

      const threshold = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = repo.deleteOlderThan(threshold);

      expect(deleted).toBe(1);

      // recent entry should still be present via findSince
      const remaining = repo.findSince('', 50);
      const titles = remaining.map((r) => r.title);
      expect(titles).not.toContain('old-entry');
      expect(titles).toContain('recent-entry');
    });

    it('returns 0 when no rows are older than the threshold', () => {
      repo.insert(makeEntry());
      const futureThreshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = repo.deleteOlderThan(futureThreshold);
      expect(deleted).toBe(0);
    });
  });
});

// ── ActivityEvent mapper regression tests ────────────────────────────────────
//
// These verify that the pure mapping functions that produce the ActivityEvent
// response shape remain stable across T1-T7 changes.

describe('mapActivityType', () => {
  it('maps recovery:start to recovery', () => {
    expect(mapActivityType('recovery:start')).toBe('recovery');
  });

  it('maps recovery:success to recovery', () => {
    expect(mapActivityType('recovery:success')).toBe('recovery');
  });

  it('maps recovery:failed to recovery', () => {
    expect(mapActivityType('recovery:failed')).toBe('recovery');
  });

  it('maps recovery:approval-needed to approval', () => {
    expect(mapActivityType('recovery:approval-needed')).toBe('approval');
  });

  it('maps recovery:approval-resolved to approval', () => {
    expect(mapActivityType('recovery:approval-resolved')).toBe('approval');
  });

  it('maps alert:new to alert', () => {
    expect(mapActivityType('alert:new')).toBe('alert');
  });

  it('maps alert:resolved to alert', () => {
    expect(mapActivityType('alert:resolved')).toBe('alert');
  });

  it('maps ai:invoked to ai:invoked (passthrough)', () => {
    expect(mapActivityType('ai:invoked')).toBe('ai:invoked');
  });

  it('maps ai:completed to ai:completed (passthrough)', () => {
    expect(mapActivityType('ai:completed')).toBe('ai:completed');
  });

  it('maps deploy:crash to incident (default)', () => {
    expect(mapActivityType('deploy:crash')).toBe('incident');
  });

  it('maps container:die to incident (default)', () => {
    expect(mapActivityType('container:die')).toBe('incident');
  });
});

describe('mapActivityStatus', () => {
  it('returns active for deploy:start', () => {
    expect(mapActivityStatus('deploy:start', { projectId: 'p1' } as never)).toBe('active');
  });

  it('returns failed for deploy:crash', () => {
    expect(mapActivityStatus('deploy:crash', { projectId: 'p1' } as never)).toBe('failed');
  });

  it('returns resolved for recovery:success', () => {
    expect(
      mapActivityStatus('recovery:success', {
        projectId: 'p1',
        durationMs: 100,
        lastError: null,
      } as never),
    ).toBe('resolved');
  });

  it('returns pending for recovery:approval-needed', () => {
    expect(
      mapActivityStatus('recovery:approval-needed', {
        projectId: 'p1',
        toolName: 'rollback',
        attempt: 1,
        actionRunId: 'run-1',
      } as never),
    ).toBe('pending');
  });

  it('returns ai-running for ai:invoked', () => {
    expect(
      mapActivityStatus('ai:invoked', {
        projectId: 'p1',
        model: 'claude-3',
        action: 'diagnose',
        actionRunId: 'run-1',
      } as never),
    ).toBe('ai-running');
  });

  it('returns recovery-blocked for recovery:blocked', () => {
    expect(
      mapActivityStatus('recovery:blocked', { projectId: 'p1', reason: 'circuit open' } as never),
    ).toBe('recovery-blocked');
  });
});

describe('mapActivitySeverity', () => {
  it('returns critical for deploy:crash', () => {
    expect(mapActivitySeverity('deploy:crash', { projectId: 'p1' } as never, 'failed')).toBe(
      'critical',
    );
  });

  it('returns critical for health:degraded', () => {
    expect(
      mapActivitySeverity(
        'health:degraded',
        { projectId: 'p1', consecutiveFailures: 3, lastError: null } as never,
        'failed',
      ),
    ).toBe('critical');
  });

  it('returns warning for recovery:approval-needed', () => {
    expect(
      mapActivitySeverity(
        'recovery:approval-needed',
        { projectId: 'p1', toolName: 'rollback', attempt: 1, actionRunId: 'run-1' } as never,
        'pending',
      ),
    ).toBe('warning');
  });

  it('returns info for deploy:start (non-failure, non-critical event)', () => {
    expect(mapActivitySeverity('deploy:start', { projectId: 'p1' } as never, 'active')).toBe(
      'info',
    );
  });

  it('returns warning for recovery-blocked status', () => {
    expect(
      mapActivitySeverity(
        'recovery:blocked',
        { projectId: 'p1', reason: 'cb open' } as never,
        'recovery-blocked',
      ),
    ).toBe('warning');
  });
});

describe('buildActivityEvent', () => {
  const mockDb = {
    getActionRunsByApprovalStatus: () => [],
    getProject: (id: string) => (id === 'proj-1' ? { name: 'alpha-service' } : undefined),
  };

  it('returns null when event has no projectId', () => {
    // alert:new payload with non-string projectId details
    const result = buildActivityEvent(mockDb, 'deploy:start', { projectId: '' } as never);
    expect(result).toBeNull();
  });

  it('returns ActivityEvent with all required fields for deploy:crash', () => {
    const event = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'proj-1',
      exitCode: 1,
    } as never);
    expect(event).not.toBeNull();
    expect(typeof event!.id).toBe('string');
    expect(typeof event!.timestamp).toBe('string');
    expect(event!.type).toBe('incident');
    expect(event!.severity).toBe('critical');
    expect(event!.projectId).toBe('proj-1');
    expect(event!.projectName).toBe('alpha-service');
    expect(typeof event!.title).toBe('string');
    expect(typeof event!.description).toBe('string');
    expect(event!.status).toBe('failed');
  });

  it('returned ActivityEvent has backward-compat aliases (project, user, time)', () => {
    const event = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'proj-1',
      exitCode: 1,
    } as never);
    expect(event).not.toBeNull();
    // Legacy aliases required by existing consumers of /api/activity
    expect(typeof event!.project).toBe('string');
    expect(event!.user).toBe('system');
    expect(typeof event!.time).toBe('string');
  });

  it('returned ActivityEvent rawType matches the original event type', () => {
    const event = buildActivityEvent(mockDb, 'recovery:start', {
      projectId: 'proj-1',
      error: 'crash',
      attempt: 1,
    } as never);
    expect(event).not.toBeNull();
    expect(event!.rawType).toBe('recovery:start');
  });

  it('returned ActivityEvent id is a non-empty unique string', () => {
    const a = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'proj-1',
      exitCode: 0,
    } as never);
    const b = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'proj-1',
      exitCode: 0,
    } as never);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id.length).toBeGreaterThan(0);
    expect(a!.id).not.toBe(b!.id);
  });

  it('resolves projectName from db.getProject when available', () => {
    const event = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'proj-1',
      exitCode: 1,
    } as never);
    expect(event!.projectName).toBe('alpha-service');
  });

  it('falls back to projectId as projectName when project not found in db', () => {
    const event = buildActivityEvent(mockDb, 'deploy:crash', {
      projectId: 'unknown-proj',
      exitCode: 1,
    } as never);
    expect(event).not.toBeNull();
    expect(event!.projectName).toBe('unknown-proj');
  });

  // ---------------------------------------------------------------------------
  // Day 8 Bug #1: recovery:degraded must surface through the activity event
  // mapper so the SSE feed and persisted activity_log show partial-failure
  // recovery events. Codex's Day 7 audit found that recovery:degraded was
  // wired through ActivityLogger but missing from the SSE eventTypes filter
  // in routes.ts and ops-routes.ts.
  // ---------------------------------------------------------------------------
  it('builds a recovery:degraded ActivityEvent with the correct mapped type and status', () => {
    const event = buildActivityEvent(mockDb, 'recovery:degraded', {
      projectId: 'proj-1',
      stage: 'B',
      reason: 'partial step failure',
    } as never);

    expect(event).not.toBeNull();
    expect(event!.type).toBe('recovery:degraded');
    expect(event!.status).toBe('failed');
    expect(event!.severity).toBe('warning');
    expect(event!.title).toContain('partial');
    expect(event!.reason).toBe('partial step failure');
    expect(event!.rawType).toBe('recovery:degraded');
    expect(event!.projectName).toBe('alpha-service');
  });
});

// ---------------------------------------------------------------------------
// Day 8 Bug #1: recovery:degraded MUST be present in the ops SSE event-type
// allowlist so the streaming `/api/ops/activity` endpoint doesn't filter it
// out before reaching the client. The companion routes.ts allowlist was
// retired when the orphan `/api/activity` (DB-backed activity_log feed) was
// replaced by the v4 cross-actor activity endpoint, so only the ops-routes
// guard remains.
// ---------------------------------------------------------------------------
describe('SSE event type allowlist (Day 8 Bug #1)', () => {
  it('ops-routes.ts ActivityItem type union includes recovery:degraded', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/web/api/ops-routes.ts', 'utf8');
    expect(source).toMatch(/'recovery:degraded'/);
  });
});
