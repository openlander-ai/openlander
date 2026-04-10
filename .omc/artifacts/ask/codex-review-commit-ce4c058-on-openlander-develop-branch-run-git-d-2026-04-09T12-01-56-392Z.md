# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-09T12:01:56.393Z

## Original task

Review commit ce4c058 on OpenLander develop branch. Run: git diff 62ae2bf..ce4c058 to see the full diff. This commit stabilizes the ops v2 activity feed. Focus on: 1) src/web/api/ops-routes.ts — new/modified API endpoints, data contracts 2) src/web/api/routes.ts — activity endpoint changes 3) web/src/hooks/use-ops-center-data.ts — hook changes 4) web/src/lib/api/operations.ts — type changes 5) Any backend correctness issues, race conditions, or contract mismatches between API and frontend. Report as CRITICAL/MAJOR/MINOR.

## Final prompt

Review commit ce4c058 on OpenLander develop branch. Run: git diff 62ae2bf..ce4c058 to see the full diff. This commit stabilizes the ops v2 activity feed. Focus on: 1) src/web/api/ops-routes.ts — new/modified API endpoints, data contracts 2) src/web/api/routes.ts — activity endpoint changes 3) web/src/hooks/use-ops-center-data.ts — hook changes 4) web/src/lib/api/operations.ts — type changes 5) Any backend correctness issues, race conditions, or contract mismatches between API and frontend. Report as CRITICAL/MAJOR/MINOR.

## Raw output

```text
No `CRITICAL` findings.

`MAJOR` [src/web/api/ops-routes.ts:515](/home/lee/OpenLander/src/web/api/ops-routes.ts#L515), [src/web/api/ops-routes.ts:533](/home/lee/OpenLander/src/web/api/ops-routes.ts#L533), [src/web/api/ops-routes.ts:541](/home/lee/OpenLander/src/web/api/ops-routes.ts#L541), [web/src/hooks/use-ops-center-data.ts:90](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L90), [web/src/hooks/use-ops-center-data.ts:154](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L154), [web/src/hooks/use-ops-center-data.ts:243](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L243)
The new follow mode uses a plain timestamp cursor with `timestamp > since`, and the client now stores only `lastEventTimestamp`. That drops events in two real cases:
1. If multiple activities share the same timestamp, anything arriving after reconnect with the same timestamp as the saved cursor is skipped permanently.
2. If more than 100 activities arrive between polls/reconnects, `fetchActivities()` keeps only the newest 100, then advances the cursor to the newest timestamp in that page, so older unseen events from the same gap are lost permanently.
This is a feed correctness regression versus the old stable `/api/activity` ULID cursor model.

`MAJOR` [src/web/api/ops-routes.ts:471](/home/lee/OpenLander/src/web/api/ops-routes.ts#L471), [src/web/api/ops-routes.ts:475](/home/lee/OpenLander/src/web/api/ops-routes.ts#L475), [src/web/api/ops-routes.ts:479](/home/lee/OpenLander/src/web/api/ops-routes.ts#L479)
The non-project-scoped recovery/approval query is not actually “latest global activity”. It pulls only the latest 20 action runs per project, then sorts globally, then filters out non-`auto_recovery` runs. That means a noisy project can hide its own recent recovery events if they are pushed below the top 20 by unrelated manual runs, and the final feed can show older events from other projects instead of the true latest recoveries/approvals.

`MINOR` [web/src/hooks/use-ops-center-data.ts:133](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L133), [web/src/hooks/use-ops-center-data.ts:159](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L159), [src/web/api/ops-routes.ts:551](/home/lee/OpenLander/src/web/api/ops-routes.ts#L551), [src/web/api/routes.ts:300](/home/lee/OpenLander/src/web/api/routes.ts#L300)
The frontend still expects `backfill: true` markers to batch reconnect backfill, but `/api/ops/activity` never emits them. The old `/api/activity` stream did. This won’t corrupt data, but reconnect backfill is now applied item-by-item, causing unnecessary rerenders and making the hook’s `inBackfill` path effectively dead.

The [src/web/api/routes.ts:320](/home/lee/OpenLander/src/web/api/routes.ts#L320) change itself looks correct; I did not find a new issue there.

Validation: `npm test -- test/web/api/ops-incident-routes.test.ts test/web/api/ops-routes.test.ts test/web/api/activity-routes.test.ts` passed.


Reading additional input from stdin...
OpenAI Codex v0.118.0 (research preview)
--------
workdir: /home/lee/OpenLander
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: none
reasoning summaries: none
session id: 019d721c-bbb1-7e53-8fa9-f1e1ccef92eb
--------
user
Review commit ce4c058 on OpenLander develop branch. Run: git diff 62ae2bf..ce4c058 to see the full diff. This commit stabilizes the ops v2 activity feed. Focus on: 1) src/web/api/ops-routes.ts — new/modified API endpoints, data contracts 2) src/web/api/routes.ts — activity endpoint changes 3) web/src/hooks/use-ops-center-data.ts — hook changes 4) web/src/lib/api/operations.ts — type changes 5) Any backend correctness issues, race conditions, or contract mismatches between API and frontend. Report as CRITICAL/MAJOR/MINOR.
codex
Reviewing commit `ce4c058` against `62ae2bf` with a code-review focus on ops feed stability. I’m pulling the diff and then tracing the API and frontend contract through the affected files to look for backend correctness issues, race conditions, and shape mismatches.
exec
/bin/bash -lc 'git diff 62ae2bf..ce4c058 -- src/web/api/ops-routes.ts src/web/api/routes.ts web/src/hooks/use-ops-center-data.ts web/src/lib/api/operations.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/web/api/ops-routes.ts b/src/web/api/ops-routes.ts
index 953c876..d9d7e65 100644
--- a/src/web/api/ops-routes.ts
+++ b/src/web/api/ops-routes.ts
@@ -1,4 +1,5 @@
 import { Hono } from 'hono';
+import { stream } from 'hono/streaming';

 import type { AppContext } from '../../app.js';
 import type { OpsIncidentEventRow, OpsIncidentRow } from '../../db/types.js';
@@ -187,6 +188,43 @@ export function createOpsRoutes(ctx: AppContext): Hono {

   // --- OpsAgent Config ---

+  api.get('/agent/active', (c) => {
+    try {
+      const projects = ctx.db.listProjects();
+      const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
+      const activeRuns = projects
+        .flatMap((project) => ctx.db.getRunningActionRuns(project.id))
+        .sort((a, b) => b.started_at.localeCompare(a.started_at));
+      const activeRun = activeRuns[0];
+
+      if (!activeRun) {
+        return c.json({ isActive: false });
+      }
+
+      const approvalPending =
+        activeRun.approval_status === 'pending' ||
+        (activeRun.status as string) === 'pending_approval';
+      const currentStep = approvalPending
+        ? 'Awaiting approval'
+        : typeof activeRun.current_step === 'number' && typeof activeRun.total_steps === 'number'
+          ? `Executing step ${String(activeRun.current_step)} / ${String(activeRun.total_steps)}`
+          : undefined;
+
+      return c.json({
+        isActive: true,
+        projectId: activeRun.project_id,
+        projectName: projectNameById.get(activeRun.project_id) ?? activeRun.project_id,
+        currentStep,
+        currentStepNumber: activeRun.current_step ?? undefined,
+        totalSteps: activeRun.total_steps ?? undefined,
+        startedAt: activeRun.started_at,
+        lastUpdatedAt: activeRun.updated_at ?? activeRun.created_at,
+      });
+    } catch {
+      return c.json({ isActive: false });
+    }
+  });
+
   api.get('/config', (c) => {
     const config = ctx.opsAgent?.getConfig() ?? {};
     return c.json({ config });
@@ -355,12 +393,16 @@ export function createOpsRoutes(ctx: AppContext): Hono {
   // --- Unified Activity Feed ---

   api.get('/activity', (c) => {
-    try {
+    const isFollow = c.req.query('follow') === 'true';
+
+    const fetchActivities = (sinceParam?: string) => {
       const projectId = c.req.query('projectId');
       const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
       const severity = c.req.query('severity');
-      const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
+      const limitParam = c.req.query('limit');
+      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
       const before = c.req.query('before');
+      const since = sinceParam || c.req.query('since');

       const projects = ctx.db.listProjects();
       const projectMap = new Map(projects.map((p) => [p.id, p.name]));
@@ -401,7 +443,11 @@ export function createOpsRoutes(ctx: AppContext): Hono {
               (e) => (e.event_type as string) === 'cascade_detected',
             )) {
               let cascadeGroup: string[] = [];
-              cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
+              try {
+                cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
+              } catch {
+                // ignore parsing error
+              }
               activities.push({
                 id: ev.id,
                 timestamp: new Date(ev.created_at).toISOString(),
@@ -422,9 +468,12 @@ export function createOpsRoutes(ctx: AppContext): Hono {

       // Action runs
       if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
-        const runs = projectId
+        const candidateRuns = projectId
           ? ctx.db.getActionRunsByProject(projectId, 100)
-          : ctx.db.getActionRunsByApprovalStatus('pending', 50);
+          : projects.flatMap((project) => ctx.db.getActionRunsByProject(project.id, 20));
+        const runs = candidateRuns
+          .sort((a, b) => b.created_at.localeCompare(a.created_at))
+          .slice(0, 200);
         for (const run of runs) {
           if (
             run.trigger_source !== 'auto_recovery' &&
@@ -463,11 +512,62 @@ export function createOpsRoutes(ctx: AppContext): Hono {
       let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
       if (severity) sorted = sorted.filter((a) => a.severity === severity);
       if (before) sorted = sorted.filter((a) => a.timestamp < before);
+      if (since) sorted = sorted.filter((a) => a.timestamp > since);
       const page = sorted.slice(0, limit);
-      return c.json({
+      return {
         activities: page,
         nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
+      };
+    };
+
+    if (isFollow) {
+      return stream(c, async (s) => {
+        c.header('Content-Type', 'application/x-ndjson');
+        let lastReportedTime = c.req.query('since') || new Date(Date.now() - 60000).toISOString();
+        let flushInProgress = false;
+
+        const sendUpdates = async (): Promise<void> => {
+          if (flushInProgress) return;
+          flushInProgress = true;
+          try {
+            const page = fetchActivities(lastReportedTime);
+            if (page.activities.length > 0) {
+              const forward = [...page.activities].reverse();
+              for (const act of forward) {
+                await s.write(JSON.stringify(act) + '\n');
+              }
+              const lastActivity = forward[forward.length - 1];
+              if (lastActivity) {
+                lastReportedTime = lastActivity.timestamp;
+              }
+            }
+          } catch (err) {
+            console.error('Unified feed streaming error:', err);
+          } finally {
+            flushInProgress = false;
+          }
+        };
+
+        // Initial backfill
+        await sendUpdates();
+        await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
+
+        const interval = setInterval(() => {
+          void sendUpdates();
+        }, 2000);
+
+        await new Promise<void>((resolve) => {
+          s.onAbort(() => {
+            clearInterval(interval);
+            resolve();
+          });
+        });
       });
+    }
+
+    try {
+      const page = fetchActivities();
+      return c.json(page);
     } catch (err) {
       return c.json({ error: String(err) }, 500);
     }
diff --git a/src/web/api/routes.ts b/src/web/api/routes.ts
index b332101..1edc082 100644
--- a/src/web/api/routes.ts
+++ b/src/web/api/routes.ts
@@ -317,7 +317,11 @@ export function createApiRoutes(ctx: AppContext): Hono {
         }

         // Step 6: From here, live events are written directly by the listener above
-        await Promise.resolve();
+        await new Promise<void>((resolve) => {
+          s.onAbort(() => {
+            resolve();
+          });
+        });
       });
     }

diff --git a/web/src/hooks/use-ops-center-data.ts b/web/src/hooks/use-ops-center-data.ts
index 8e2c43b..f9b6505 100644
--- a/web/src/hooks/use-ops-center-data.ts
+++ b/web/src/hooks/use-ops-center-data.ts
@@ -55,7 +55,7 @@ export function useOpsCenterData(): OpsCenterData {
   // --- Refs for SSE lifecycle ---
   const abortRef = useRef<AbortController | null>(null);
   const retriesRef = useRef(0);
-  const lastEventIdRef = useRef<string | null>(null);
+  const lastEventTimestampRef = useRef<string | null>(null);
   const dedupSetRef = useRef<Set<string>>(new Set());
   const cancelledRef = useRef(false);

@@ -87,11 +87,11 @@ export function useOpsCenterData(): OpsCenterData {
     void (async () => {
       try {
         const params = new URLSearchParams({ follow: 'true' });
-        if (lastEventIdRef.current) {
-          params.set('since', lastEventIdRef.current);
+        if (lastEventTimestampRef.current) {
+          params.set('since', lastEventTimestampRef.current);
         }

-        const resp = await fetch(`/api/activity?${params.toString()}`, {
+        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
           signal: controller.signal,
           credentials: 'include',
         });
@@ -149,8 +149,10 @@ export function useOpsCenterData(): OpsCenterData {
               const item = parsed as unknown as ActivityItem;
               if (!item.id) continue;

-              // Track last event ID for gap recovery
-              lastEventIdRef.current = item.id;
+              // Track last event timestamp for gap recovery
+              if (item.timestamp) {
+                lastEventTimestampRef.current = item.timestamp;
+              }

               if (!dedup(item.id)) continue;

@@ -217,7 +219,7 @@ export function useOpsCenterData(): OpsCenterData {

     // Parallel REST snapshot
     Promise.all([
-      fetch('/api/activity?limit=100', { credentials: 'include' }).then((r) => {
+      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
         if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
         return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
       }),
@@ -236,9 +238,9 @@ export function useOpsCenterData(): OpsCenterData {
         for (const item of items) {
           dedupSetRef.current.add(item.id);
         }
-        // Track last event ID for SSE gap recovery
+        // Track last event timestamp for SSE gap recovery
         if (items.length > 0) {
-          lastEventIdRef.current = items[0].id;
+          lastEventTimestampRef.current = items[0].timestamp;
         }

         setActivities(items);
diff --git a/web/src/lib/api/operations.ts b/web/src/lib/api/operations.ts
index 9ac94d3..c48dfce 100644
--- a/web/src/lib/api/operations.ts
+++ b/web/src/lib/api/operations.ts
@@ -175,6 +175,8 @@ export interface ActivityItem {
   actionRunId?: string;
   correlationId?: string;
   cascadeGroup?: string[];
+  triggerType?: string;
+  triggerDetails?: string;
   aiMetadata?: {
     model: string;
     tokensUsed?: number;

exec
/bin/bash -lc 'git status --short' in /home/lee/OpenLander
 succeeded in 0ms:
?? .omc/

codex
The diff is narrow: the main change is moving ops feed consumers onto `/api/ops/activity` with a new NDJSON follow mode and timestamp-based resume. I’m checking the surrounding implementations now, especially database access patterns and whether the follow stream can miss or duplicate events under load.
exec
/bin/bash -lc "sed -n '1,260p' src/web/api/ops-routes.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import type { OpsIncidentEventRow, OpsIncidentRow } from '../../db/types.js';
import { updateConfig } from '../../config/index.js';
import { resolveAutomationPolicy, isAutopilot } from '../../monitor/ops-config-resolver.js';
import { DEFAULT_OPS_CONFIG, DEFAULT_RECOVERY_AUTOMATION } from '../../monitor/ops-types.js';

interface ActivityItem {
  id: string;
  timestamp: string;
  type: 'incident' | 'recovery' | 'approval' | 'circuit_breaker' | 'cleanup' | 'alert';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: 'active' | 'resolved' | 'pending' | 'failed';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  triggerType?: string;
  triggerDetails?: string;
}

interface ParsedIncidentTrigger {
  triggerType?: string;
  triggerDetails?: string;
}

interface IncidentEventMetadata {
  trigger_type?: string;
  trigger_details?: string;
  affected_project_ids?: string[];
}

function groupEventsByIncidentId(
  events: OpsIncidentEventRow[],
): Map<string, OpsIncidentEventRow[]> {
  const grouped = new Map<string, OpsIncidentEventRow[]>();
  for (const event of events) {
    const existing = grouped.get(event.incident_id);
    if (existing) {
      existing.push(event);
      continue;
    }
    grouped.set(event.incident_id, [event]);
  }
  return grouped;
}

function parseEventMetadata(metadata: string | null): IncidentEventMetadata | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as IncidentEventMetadata;
  } catch {
    return null;
  }
}

function parseTriggerFromText(text: string | null | undefined): ParsedIncidentTrigger {
  if (!text) return {};
  const cleaned = text
    .replace(/^Incident detected:\s*/i, '')
    .replace(/^Recurring event:\s*/i, '')
    .trim();
  if (!cleaned) return {};
  const [typePart, ...detailsParts] = cleaned.split(' — ');
  const triggerType = typePart?.trim();
  if (!triggerType) return {};
  const details = detailsParts.join(' — ').trim();
  return {
    triggerType,
    triggerDetails: details || undefined,
  };
}

function extractIncidentTrigger(
  incident: OpsIncidentRow,
  events: OpsIncidentEventRow[],
): ParsedIncidentTrigger {
  const detected = events.find((event) => event.event_type === 'detected');
  if (detected) {
    const metadata = parseEventMetadata(detected.metadata);
    if (metadata?.trigger_type) {
      return {
        triggerType: metadata.trigger_type,
        triggerDetails: metadata.trigger_details,
      };
    }
    const detectedTrigger = parseTriggerFromText(detected.description);
    if (detectedTrigger.triggerType) return detectedTrigger;
  }
  return parseTriggerFromText(incident.root_cause);
}

function mapIncidentResponse(incident: OpsIncidentRow, events: OpsIncidentEventRow[]) {
  const trigger = extractIncidentTrigger(incident, events);
  const title = incident.root_cause ?? 'Incident detected';
  return {
    ...incident,
    title,
    triggerType: trigger.triggerType,
    triggerDetails: trigger.triggerDetails,
  };
}

function mapIncidentEventResponse(event: OpsIncidentEventRow) {
  return {
    ...event,
    type: event.event_type,
    message: event.description,
  };
}

export function createOpsRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // --- Incidents ---

  api.get('/incidents', (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const limit = Number(c.req.query('limit') ?? 50);

    try {
      let incidents;
      if (projectId) {
        incidents = ctx.db.listOpsIncidentsByProject(projectId, limit);
      } else {
        const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
        incidents = ctx.db.listOpsIncidentsByDateRange(from, Date.now());
      }

      if (status) {
        incidents = incidents.filter((i) => i.status === status);
      }

      const page = incidents.slice(0, limit);
      const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
      const eventsByIncidentId = groupEventsByIncidentId(events);
      return c.json({
        incidents: page.map((incident) =>
          mapIncidentResponse(incident, eventsByIncidentId.get(incident.id) ?? []),
        ),
      });
    } catch {
      return c.json({ error: 'Failed to fetch incidents' }, 500);
    }
  });

  api.get('/incidents/:id', (c) => {
    const id = c.req.param('id');

    try {
      const incident = ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const events = ctx.db.listOpsIncidentEvents(id);
      return c.json({
        incident: mapIncidentResponse(incident, events),
        events: events.map(mapIncidentEventResponse),
      });
    } catch {
      return c.json({ error: 'Failed to fetch incident' }, 500);
    }
  });

  api.get('/incidents/:id/events', (c) => {
    const id = c.req.param('id');

    try {
      const incident = ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const events = ctx.db.listOpsIncidentEvents(id);
      return c.json({ events: events.map(mapIncidentEventResponse) });
    } catch {
      return c.json({ error: 'Failed to fetch incident events' }, 500);
    }
  });

  // --- OpsAgent Config ---

  api.get('/agent/active', (c) => {
    try {
      const projects = ctx.db.listProjects();
      const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
      const activeRuns = projects
        .flatMap((project) => ctx.db.getRunningActionRuns(project.id))
        .sort((a, b) => b.started_at.localeCompare(a.started_at));
      const activeRun = activeRuns[0];

      if (!activeRun) {
        return c.json({ isActive: false });
      }

      const approvalPending =
        activeRun.approval_status === 'pending' ||
        (activeRun.status as string) === 'pending_approval';
      const currentStep = approvalPending
        ? 'Awaiting approval'
        : typeof activeRun.current_step === 'number' && typeof activeRun.total_steps === 'number'
          ? `Executing step ${String(activeRun.current_step)} / ${String(activeRun.total_steps)}`
          : undefined;

      return c.json({
        isActive: true,
        projectId: activeRun.project_id,
        projectName: projectNameById.get(activeRun.project_id) ?? activeRun.project_id,
        currentStep,
        currentStepNumber: activeRun.current_step ?? undefined,
        totalSteps: activeRun.total_steps ?? undefined,
        startedAt: activeRun.started_at,
        lastUpdatedAt: activeRun.updated_at ?? activeRun.created_at,
      });
    } catch {
      return c.json({ isActive: false });
    }
  });

  api.get('/config', (c) => {
    const config = ctx.opsAgent?.getConfig() ?? {};
    return c.json({ config });
  });

  api.put('/config', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      ctx.opsAgent?.reloadConfig(body);
      updateConfig({ ops: body });
      return c.json({ config: ctx.opsAgent?.getConfig() ?? {} });
    } catch {
      return c.json({ error: 'Invalid config' }, 400);
    }
  });

  // --- Digest ---

  api.get('/digest/latest', (c) => {
    const digest = ctx.opsAgent?.getDigest() ?? null;
    return c.json({ digest });
  });

  api.post('/digest/trigger', async (c) => {
    try {
      await ctx.opsAgent?.generateDigest();
      return c.json({ triggered: true });
    } catch (err) {
      return c.json({ triggered: false, error: String(err) }, 500);
    }
  });

  // --- Circuit Breaker ---

exec
/bin/bash -lc "sed -n '260,620p' src/web/api/ops-routes.ts" in /home/lee/OpenLander
 succeeded in 0ms:
  // --- Circuit Breaker ---

  api.get('/circuit-breaker/:projectId', (c) => {
    const projectId = c.req.param('projectId');

    try {
      const state = ctx.db.getCircuitBreakerState(projectId);
      return c.json({ state });
    } catch {
      return c.json({ state: null });
    }
  });

  api.post('/circuit-breaker/:projectId/reset', (c) => {
    const projectId = c.req.param('projectId');

    try {
      ctx.db.resetCircuitBreaker(projectId);
      return c.json({ reset: true });
    } catch {
      return c.json({ reset: false }, 500);
    }
  });

  // --- Health ---

  api.get('/health', (c) => {
    return c.json({
      status: 'ok',
      queue: 0,
      running: ctx.opsAgent !== undefined,
    });
  });

  // --- Global Circuit Breakers ---

  api.get('/circuit-breakers', (c) => {
    try {
      const allBreakers = ctx.db.listAllCircuitBreakers();
      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const breakers = allBreakers
        .map((b) => ({
          projectId: b.project_id,
          projectName: projectMap.get(b.project_id) ?? b.project_id,
          state: b.state,
          failureCount: b.failure_count,
          lastFailureAt: b.last_failure_at,
          openedAt: b.opened_at,
          resetAt: b.reset_at,
        }))
        .sort((a, b) => {
          const order: Record<string, number> = { open: 0, half_open: 1, closed: 2 };
          return (order[a.state] ?? 2) - (order[b.state] ?? 2);
        });
      return c.json({ breakers });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Automation Policy ---

  api.get('/automation/defaults', (c) => {
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const policy = resolveAutomationPolicy(config);
    return c.json({
      defaults: DEFAULT_RECOVERY_AUTOMATION,
      effective: policy,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.get('/projects/:projectId/automation', (c) => {
    const projectId = c.req.param('projectId');
    const project = ctx.db.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const override = ctx.db.getProjectOpsOverride(projectId);
    const policy = resolveAutomationPolicy(config, override);
    return c.json({
      effective: policy,
      overrides: override?.automation ?? null,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.put('/projects/:projectId/automation', async (c) => {
    const projectId = c.req.param('projectId');
    const project = ctx.db.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    let body: { automation?: Record<string, string> };
    try {
      body = await c.req.json<{ automation?: Record<string, string> }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);
    const validModes = new Set(['auto', 'confirm']);
    for (const [step, mode] of Object.entries(body.automation ?? {})) {
      if (!validSteps.has(step)) {
        return c.json({ error: `Invalid step: ${step}` }, 400);
      }
      if (!validModes.has(mode)) {
        return c.json({ error: `Invalid mode: ${mode}` }, 400);
      }
    }
    const typed = body.automation as
      | Partial<Record<'restart' | 'diagnosis' | 'apply_fixes' | 'rollback', 'auto' | 'confirm'>>
      | undefined;
    const existing = ctx.db.getProjectOpsOverride(projectId);
    const merged = { ...existing?.automation, ...typed };
    ctx.db.setProjectOpsOverride(projectId, { automation: merged });
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const override = ctx.db.getProjectOpsOverride(projectId);
    const policy = resolveAutomationPolicy(config, override);
    return c.json({
      effective: policy,
      overrides: override?.automation ?? null,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.delete('/projects/:projectId/automation', (c) => {
    const projectId = c.req.param('projectId');
    ctx.db.deleteProjectOpsOverride(projectId);
    return c.json({ deleted: true });
  });

  // --- Unified Activity Feed ---

  api.get('/activity', (c) => {
    const isFollow = c.req.query('follow') === 'true';

    const fetchActivities = (sinceParam?: string) => {
      const projectId = c.req.query('projectId');
      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
      const severity = c.req.query('severity');
      const limitParam = c.req.query('limit');
      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
      const before = c.req.query('before');
      const since = sinceParam || c.req.query('since');

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const incidents = projectId
          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
        const eventsByIncidentId = groupEventsByIncidentId(
          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
        );

        for (const inc of incidents) {
          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];
          const trigger = extractIncidentTrigger(inc, incidentEvents);

          if (types.length === 0 || types.includes('incident')) {
            activities.push({
              id: inc.id,
              timestamp: new Date(inc.created_at).toISOString(),
              type: 'incident',
              severity: inc.severity,
              projectId: inc.project_id,
              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
              title: inc.root_cause ?? 'Incident detected',
              description: inc.diagnosis ?? '',
              status: inc.status === 'resolved' ? 'resolved' : 'active',
              incidentId: inc.id,
              triggerType: trigger.triggerType,
              triggerDetails: trigger.triggerDetails,
            });
          }
          if (types.length === 0 || types.includes('alert')) {
            for (const ev of incidentEvents.filter(
              (e) => (e.event_type as string) === 'cascade_detected',
            )) {
              let cascadeGroup: string[] = [];
              try {
                cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
              } catch {
                // ignore parsing error
              }
              activities.push({
                id: ev.id,
                timestamp: new Date(ev.created_at).toISOString(),
                type: 'alert',
                severity: 'warning',
                projectId: inc.project_id,
                projectName: projectMap.get(inc.project_id) ?? inc.project_id,
                title: 'Cascade detected',
                description: ev.description,
                status: 'active',
                incidentId: inc.id,
                cascadeGroup,
              });
            }
          }
        }
      }

      // Action runs
      if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
        const candidateRuns = projectId
          ? ctx.db.getActionRunsByProject(projectId, 100)
          : projects.flatMap((project) => ctx.db.getActionRunsByProject(project.id, 20));
        const runs = candidateRuns
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 200);
        for (const run of runs) {
          if (
            run.trigger_source !== 'auto_recovery' &&
            (run.status as string) !== 'pending_approval'
          )
            continue;
          const itemType: ActivityItem['type'] =
            (run.status as string) === 'pending_approval' ? 'approval' : 'recovery';
          if (types.length > 0 && !types.includes(itemType)) continue;
          activities.push({
            id: run.id,
            timestamp: run.created_at,
            type: itemType,
            severity: run.status === 'failed' ? 'warning' : 'info',
            projectId: run.project_id,
            projectName: projectMap.get(run.project_id) ?? run.project_id,
            title:
              itemType === 'approval'
                ? `Approval required: ${run.approval_tool ?? 'action'}`
                : `Auto-recovery ${run.status}`,
            description: run.error_message ?? run.plan ?? '',
            status:
              run.status === 'succeeded'
                ? 'resolved'
                : run.status === 'failed'
                  ? 'failed'
                  : (run.status as string) === 'pending_approval'
                    ? 'pending'
                    : 'active',
            actionRunId: run.id,
            correlationId: run.correlation_id ?? undefined,
          });
        }
      }

      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (severity) sorted = sorted.filter((a) => a.severity === severity);
      if (before) sorted = sorted.filter((a) => a.timestamp < before);
      if (since) sorted = sorted.filter((a) => a.timestamp > since);
      const page = sorted.slice(0, limit);
      return {
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
      };
    };

    if (isFollow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');
        let lastReportedTime = c.req.query('since') || new Date(Date.now() - 60000).toISOString();
        let flushInProgress = false;

        const sendUpdates = async (): Promise<void> => {
          if (flushInProgress) return;
          flushInProgress = true;
          try {
            const page = fetchActivities(lastReportedTime);
            if (page.activities.length > 0) {
              const forward = [...page.activities].reverse();
              for (const act of forward) {
                await s.write(JSON.stringify(act) + '\n');
              }
              const lastActivity = forward[forward.length - 1];
              if (lastActivity) {
                lastReportedTime = lastActivity.timestamp;
              }
            }
          } catch (err) {
            console.error('Unified feed streaming error:', err);
          } finally {
            flushInProgress = false;
          }
        };

        // Initial backfill
        await sendUpdates();
        await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');

        const interval = setInterval(() => {
          void sendUpdates();
        }, 2000);

        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            clearInterval(interval);
            resolve();
          });
        });
      });
    }

    try {
      const page = fetchActivities();
      return c.json(page);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Dependency Graph ---

  api.get('/dependencies', (c) => {
    try {
      const projects = ctx.db.listProjects();
      const services = ctx.db.listServices();
      const dependencies = ctx.db.findAllProjectDependencies();

      const nodes: Array<{
        id: string;
        type: 'project' | 'service';
        name: string;
        status: string;
      }> = [
        ...projects.map((p) => ({
          id: p.id,
          type: 'project' as const,
          name: p.name,
          status: p.status,
        })),
        ...services.map((s) => ({
          id: s.id,
          type: 'service' as const,
          name: s.name,
          status: s.status,
        })),
      ];

      const edges = dependencies
        .map((dep) => ({
          source: dep.source_project_id,
          target: dep.target_project_id ?? dep.target_service_id ?? '',
          dependencyType: dep.dependency_type,
        }))
        .filter((e) => e.target !== '');

      return c.json({ nodes, edges });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return api;
}

exec
/bin/bash -lc "sed -n '1,260p' web/src/hooks/use-ops-center-data.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchAllCircuitBreakers,
  fetchOpsIncidents,
  type ActivityItem,
  type CircuitBreakerWithProject,
  type OpsIncident,
} from '../lib/api/operations';
import { fetchPendingApprovals, type ActionRun } from '../lib/api/projects';
import { type AgentActiveState } from './use-agent-activity';
import { fetchWithAuth } from '../lib/api/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_MAX = 500;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 3_000; // ms

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OpsCenterData {
  activities: ActivityItem[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  approvals: ActionRun[];
  agentStatus: AgentActiveState;
  isConnected: boolean;
  isReconnecting: boolean;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOpsCenterData(): OpsCenterData {
  // --- Core state ---
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerWithProject[]>([]);
  const [approvals, setApprovals] = useState<ActionRun[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentActiveState>({ isActive: false });
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Refs for SSE lifecycle ---
  const abortRef = useRef<AbortController | null>(null);
  const retriesRef = useRef(0);
  const lastEventTimestampRef = useRef<string | null>(null);
  const dedupSetRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Deduplication helper: returns true if the item is new (not a dup)
  // ---------------------------------------------------------------------------
  const dedup = useCallback((id: string): boolean => {
    const s = dedupSetRef.current;
    if (s.has(id)) return false;
    s.add(id);
    // Prune when set exceeds 2x buffer to bound memory
    if (s.size > BUFFER_MAX * 2) {
      const arr = [...s];
      dedupSetRef.current = new Set(arr.slice(arr.length - BUFFER_MAX));
    }
    return true;
  }, []);

  // ---------------------------------------------------------------------------
  // SSE connect with backfill + exponential backoff reconnect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (cancelledRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const params = new URLSearchParams({ follow: 'true' });
        if (lastEventTimestampRef.current) {
          params.set('since', lastEventTimestampRef.current);
        }

        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include',
        });

        if (!resp.ok || !resp.body) {
          if (!cancelledRef.current) {
            setError(`Stream error: ${resp.status}`);
          }
          return;
        }

        if (!cancelledRef.current) {
          setIsConnected(true);
          setIsReconnecting(false);
          retriesRef.current = 0; // reset on successful connection
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let inBackfill = false;
        let backfillBatch: ActivityItem[] = [];

        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelledRef.current) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>;

              // Handle backfill-complete sentinel
              if (parsed.type === 'backfill-complete') {
                if (backfillBatch.length > 0) {
                  // Batch-apply all backfill items in one state update
                  const batch = backfillBatch;
                  backfillBatch = [];
                  setActivities((prev) => {
                    const merged = [...batch, ...prev];
                    // Deduplicate already handled per-item, just enforce ceiling
                    return merged.slice(0, BUFFER_MAX);
                  });
                }
                inBackfill = false;
                continue;
              }

              const item = parsed as unknown as ActivityItem;
              if (!item.id) continue;

              // Track last event timestamp for gap recovery
              if (item.timestamp) {
                lastEventTimestampRef.current = item.timestamp;
              }

              if (!dedup(item.id)) continue;

              if (parsed.backfill === true) {
                inBackfill = true;
                backfillBatch.push(item);
              } else if (inBackfill) {
                // Non-backfill item arriving during backfill — buffer it too
                backfillBatch.push(item);
              } else {
                // Incremental live update
                setActivities((prev) => [item, ...prev].slice(0, BUFFER_MAX));
              }
            } catch {
              // Ignore malformed NDJSON lines
            }
          }
        }

        // Stream ended normally — attempt reconnect if still mounted
        if (!cancelledRef.current && retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1;
          setIsConnected(false);
          setIsReconnecting(true);
          const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
          setTimeout(() => {
            if (!cancelledRef.current) {
              setIsReconnecting(false);
              connect();
            }
          }, delay);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        if (!cancelledRef.current) {
          const message = err instanceof Error ? err.message : 'Stream failed';
          setError(message);
          setIsConnected(false);

          // Auto-retry with exponential backoff
          if (retriesRef.current < MAX_RETRIES) {
            retriesRef.current += 1;
            setIsReconnecting(true);
            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
            setTimeout(() => {
              if (!cancelledRef.current) {
                setIsReconnecting(false);
                connect();
              }
            }, delay);
          }
        }
      }
    })();
  }, [dedup]);

  // ---------------------------------------------------------------------------
  // Initial parallel REST snapshot + SSE connect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    cancelledRef.current = false;
    setIsLoading(true);

    // Parallel REST snapshot
    Promise.all([
      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
        return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
      }),
      fetchOpsIncidents(undefined, 'open'),
      fetchAllCircuitBreakers(),
      fetchPendingApprovals().catch(() => [] as ActionRun[]),
      fetchWithAuth('/api/ops/agent/active')
        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
        .catch(() => ({ isActive: false }) as AgentActiveState),
    ])
      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
        if (cancelledRef.current) return;

        const items = activityData.activities.slice(0, BUFFER_MAX);
        // Seed dedup set with initial snapshot IDs
        for (const item of items) {
          dedupSetRef.current.add(item.id);
        }
        // Track last event timestamp for SSE gap recovery
        if (items.length > 0) {
          lastEventTimestampRef.current = items[0].timestamp;
        }

        setActivities(items);
        setIncidents(incidentData.incidents ?? []);
        setCircuitBreakers(cbData.breakers ?? []);
        setApprovals(approvalData);
        setAgentStatus(agentData as AgentActiveState);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setIsLoading(false);


exec
/bin/bash -lc "sed -n '1,260p' web/src/lib/api/operations.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { fetchWithAuth } from './auth.js';

export interface OpsConfig {
  enabled: boolean;
  recovery: {
    enabled: boolean;
    automation: Record<string, string>;
  };
  auto_cleanup: boolean;
  drift_detection: boolean;
  thresholds: {
    disk_cleanup_percent: number;
    recovery_max_per_day: number;
    alert_dedup_minutes: number;
    digest_time: string;
  };
  channels: {
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
      to: string[];
    };
  };
}

export async function fetchOpsConfig(): Promise<{ config: OpsConfig }> {
  const res = await fetchWithAuth('/api/ops/config');
  if (!res.ok) {
    throw new Error('Failed to fetch operations config');
  }
  return res.json();
}

export async function updateOpsConfig(config: Partial<OpsConfig>): Promise<{ config: OpsConfig }> {
  const res = await fetchWithAuth('/api/ops/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error('Failed to update operations config');
  }
  return res.json();
}

export async function triggerTestEmail(): Promise<void> {
  const res = await fetchWithAuth('/api/ops/digest/trigger', {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to send test email');
  }
}

export interface OpsIncidentEvent {
  id: string;
  incident_id: string;
  type: string;
  event_type?: string;
  message: string | null;
  description?: string;
  metadata?: string | null;
  created_at: string | number;
}

export interface OpsIncident {
  id: string;
  project_id: string;
  title: string;
  status: string;
  severity: string;
  root_cause?: string | null;
  diagnosis?: string | null;
  actions_taken?: string | null;
  created_at: string | number;
  updated_at?: string | number;
  resolved_at?: string | number | null;
  escalated_at?: string | number | null;
  events?: OpsIncidentEvent[];
  triggerType?: string;
  triggerDetails?: string;
}

export interface CircuitBreakerState {
  state: string;
  failure_count?: number;
  last_failure_at?: string;
  next_retry_at?: string;
}

export async function fetchOpsIncidents(
  projectId?: string,
  status?: string,
): Promise<{ incidents: OpsIncident[] }> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  const response = await fetchWithAuth(`/api/ops/incidents?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch incidents');
  return response.json();
}

export async function fetchOpsIncident(
  id: string,
): Promise<{ incident: OpsIncident; events: OpsIncidentEvent[] }> {
  const response = await fetchWithAuth(`/api/ops/incidents/${id}`);
  if (!response.ok) throw new Error('Failed to fetch incident');
  return response.json();
}

export async function fetchCircuitBreakerState(projectId: string): Promise<CircuitBreakerState> {
  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch circuit breaker state');
  const data = (await response.json()) as {
    state: (CircuitBreakerState & { project_id?: string }) | null;
  };
  return data.state ?? { state: 'closed' };
}

export async function resetCircuitBreaker(projectId: string): Promise<{ reset: boolean }> {
  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}/reset`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to reset circuit breaker');
  return response.json() as Promise<{ reset: boolean }>;
}

export async function fetchIncidentEvents(
  incidentId: string,
): Promise<{ events: OpsIncidentEvent[] }> {
  const response = await fetchWithAuth(`/api/ops/incidents/${incidentId}/events`);
  if (!response.ok) return { events: [] };
  return response.json() as Promise<{ events: OpsIncidentEvent[] }>;
}

// === Operations Center types ===

export interface ActivityItem {
  id: string;
  timestamp: string;
  type:
    | 'incident'
    | 'recovery'
    | 'approval'
    | 'circuit_breaker'
    | 'cleanup'
    | 'alert'
    | 'ai_diagnosis'
    | 'ai:invoked'
    | 'ai:completed'
    | 'recovery:blocked'
    | 'recovery:stopped'
    | 'recovery:started';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status:
    | 'active'
    | 'resolved'
    | 'pending'
    | 'failed'
    | 'ai-running'
    | 'ai-completed'
    | 'recovery-blocked'
    | 'recovery-stopped'
    | 'recovering';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  triggerType?: string;
  triggerDetails?: string;
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
}

export interface CircuitBreakerWithProject {
  projectId: string;
  projectName: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  resetAt: number | null;
}

export interface DependencyNode {
  id: string;
  type: 'project' | 'service';
  name: string;
  status: string | null;
}

export interface DependencyEdge {
  source: string;
  target: string;
  dependencyType: string;
}

export async function fetchActivityFeed(opts?: {
  projectId?: string;
  types?: string[];
  severity?: string;
  limit?: number;
  before?: string;
}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts?.projectId) params.set('projectId', opts.projectId);
  if (opts?.types?.length) params.set('types', opts.types.join(','));
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const query = params.toString() ? `?${params.toString()}` : '';
  const resp = await fetchWithAuth(`/api/ops/activity${query}`);
  if (!resp.ok) throw new Error(`fetchActivityFeed failed: ${resp.status}`);
  return resp.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
}

export async function fetchAllCircuitBreakers(): Promise<{
  breakers: CircuitBreakerWithProject[];
}> {
  const resp = await fetchWithAuth('/api/ops/circuit-breakers');
  if (!resp.ok) throw new Error(`fetchAllCircuitBreakers failed: ${resp.status}`);
  return resp.json() as Promise<{ breakers: CircuitBreakerWithProject[] }>;
}

export async function fetchDependencyGraph(): Promise<{
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}> {
  const resp = await fetchWithAuth('/api/ops/dependencies');
  if (!resp.ok) throw new Error(`fetchDependencyGraph failed: ${resp.status}`);
  return resp.json() as Promise<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>;
}

// === Automation Policy types ===

export type AutomationStep = 'restart' | 'diagnosis' | 'apply_fixes' | 'rollback';
export type AutomationMode = 'auto' | 'confirm';
export type AutomationPolicy = Record<AutomationStep, AutomationMode>;

export interface AutomationDefaultsResponse {
  defaults: AutomationPolicy;
  effective: AutomationPolicy | null;
  isAutopilot: boolean;
}

export interface ProjectAutomationResponse {
  effective: AutomationPolicy | null;

exec
/bin/bash -lc "sed -n '250,360p' src/web/api/routes.ts" in /home/lee/OpenLander
 succeeded in 0ms:

        // Step 1: Register EventBus listener FIRST to buffer live events during backfill
        const liveBuffer: ActivityEvent[] = [];
        let backfillComplete = !sinceId; // no backfill needed if no since param
        const unsubscribers: Array<() => void> = [];

        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              const activityEvent = buildActivityEvent(ctx.db, eventType, payload);
              if (!activityEvent) return;
              if (
                !shouldIncludeActivity(activityEvent, {
                  projectId: projectIdFilter,
                  types: typeFilter,
                  severity: severityFilter,
                })
              ) {
                return;
              }
              if (!backfillComplete) {
                // Buffer events that arrive during backfill query
                liveBuffer.push(activityEvent);
              } else {
                void s.write(JSON.stringify(activityEvent) + '\n');
              }
            }),
          );
        }

        s.onAbort(() => {
          for (const unsub of unsubscribers) {
            unsub();
          }
        });

        // Step 2: If since param provided, query missed events and send as backfill
        if (sinceId) {
          try {
            const missedRows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
            const missedEvents = resolveActivityRows(missedRows);

            // Apply multi-type filter in-memory (DB only filters single type)
            const filtered =
              typeFilter && typeFilter.size > 1
                ? missedEvents.filter((e) => typeFilter.has(e.type))
                : missedEvents;

            // Step 3: Send backfill events with backfill flag
            for (const event of filtered) {
              await s.write(JSON.stringify({ ...event, backfill: true }) + '\n');
            }

            // Step 4: Send sentinel
            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
          } catch (err) {
            log.error({ err }, 'Failed to query activity_log for backfill');
            // Send sentinel even on error so client knows backfill phase is done
            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
          }

          // Step 5: Flush buffered live events that arrived during backfill
          backfillComplete = true;
          for (const buffered of liveBuffer) {
            await s.write(JSON.stringify(buffered) + '\n');
          }
          liveBuffer.length = 0;
        }

        // Step 6: From here, live events are written directly by the listener above
        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            resolve();
          });
        });
      });
    }

    // --- REST mode: Query activity_log table ---
    let activities: ActivityEvent[];

    if (sinceId) {
      // Cursor-based pagination: return events after the given ULID
      const rows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
      activities = resolveActivityRows(rows);
    } else {
      // No cursor: return most recent events
      const rows = ctx.db.findActivityLogRecent(limit, dbFilters);
      activities = resolveActivityRows(rows);
    }

    // Apply multi-type filter in-memory when multiple types requested
    if (typeFilter && typeFilter.size > 1) {
      activities = activities.filter((e) => typeFilter.has(e.type));
    }

    return c.json({ activities });
  });

  // --- Global Secrets ---

  api.get('/secrets', (c) => {
    const secrets = ctx.env.getGlobalSecretsMasked();
    return c.json({ secrets });
  });

  api.get('/action-runs', (c) => {
    const approvalStatus = c.req.query('approval_status');
    if (!approvalStatus) {
      return c.json({ actionRuns: [] });
    }

exec
/bin/bash -lc "git show 62ae2bf:src/web/api/ops-routes.ts | sed -n '340,560p'" in /home/lee/OpenLander
 succeeded in 0ms:
    const override = ctx.db.getProjectOpsOverride(projectId);
    const policy = resolveAutomationPolicy(config, override);
    return c.json({
      effective: policy,
      overrides: override?.automation ?? null,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.delete('/projects/:projectId/automation', (c) => {
    const projectId = c.req.param('projectId');
    ctx.db.deleteProjectOpsOverride(projectId);
    return c.json({ deleted: true });
  });

  // --- Unified Activity Feed ---

  api.get('/activity', (c) => {
    try {
      const projectId = c.req.query('projectId');
      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
      const severity = c.req.query('severity');
      const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
      const before = c.req.query('before');

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const incidents = projectId
          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
        const eventsByIncidentId = groupEventsByIncidentId(
          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
        );

        for (const inc of incidents) {
          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];
          const trigger = extractIncidentTrigger(inc, incidentEvents);

          if (types.length === 0 || types.includes('incident')) {
            activities.push({
              id: inc.id,
              timestamp: new Date(inc.created_at).toISOString(),
              type: 'incident',
              severity: inc.severity,
              projectId: inc.project_id,
              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
              title: inc.root_cause ?? 'Incident detected',
              description: inc.diagnosis ?? '',
              status: inc.status === 'resolved' ? 'resolved' : 'active',
              incidentId: inc.id,
              triggerType: trigger.triggerType,
              triggerDetails: trigger.triggerDetails,
            });
          }
          if (types.length === 0 || types.includes('alert')) {
            for (const ev of incidentEvents.filter(
              (e) => (e.event_type as string) === 'cascade_detected',
            )) {
              let cascadeGroup: string[] = [];
              cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
              activities.push({
                id: ev.id,
                timestamp: new Date(ev.created_at).toISOString(),
                type: 'alert',
                severity: 'warning',
                projectId: inc.project_id,
                projectName: projectMap.get(inc.project_id) ?? inc.project_id,
                title: 'Cascade detected',
                description: ev.description,
                status: 'active',
                incidentId: inc.id,
                cascadeGroup,
              });
            }
          }
        }
      }

      // Action runs
      if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
        const runs = projectId
          ? ctx.db.getActionRunsByProject(projectId, 100)
          : ctx.db.getActionRunsByApprovalStatus('pending', 50);
        for (const run of runs) {
          if (
            run.trigger_source !== 'auto_recovery' &&
            (run.status as string) !== 'pending_approval'
          )
            continue;
          const itemType: ActivityItem['type'] =
            (run.status as string) === 'pending_approval' ? 'approval' : 'recovery';
          if (types.length > 0 && !types.includes(itemType)) continue;
          activities.push({
            id: run.id,
            timestamp: run.created_at,
            type: itemType,
            severity: run.status === 'failed' ? 'warning' : 'info',
            projectId: run.project_id,
            projectName: projectMap.get(run.project_id) ?? run.project_id,
            title:
              itemType === 'approval'
                ? `Approval required: ${run.approval_tool ?? 'action'}`
                : `Auto-recovery ${run.status}`,
            description: run.error_message ?? run.plan ?? '',
            status:
              run.status === 'succeeded'
                ? 'resolved'
                : run.status === 'failed'
                  ? 'failed'
                  : (run.status as string) === 'pending_approval'
                    ? 'pending'
                    : 'active',
            actionRunId: run.id,
            correlationId: run.correlation_id ?? undefined,
          });
        }
      }

      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (severity) sorted = sorted.filter((a) => a.severity === severity);
      if (before) sorted = sorted.filter((a) => a.timestamp < before);
      const page = sorted.slice(0, limit);
      return c.json({
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Dependency Graph ---

  api.get('/dependencies', (c) => {
    try {
      const projects = ctx.db.listProjects();
      const services = ctx.db.listServices();
      const dependencies = ctx.db.findAllProjectDependencies();

      const nodes: Array<{
        id: string;
        type: 'project' | 'service';
        name: string;
        status: string;
      }> = [
        ...projects.map((p) => ({
          id: p.id,
          type: 'project' as const,
          name: p.name,
          status: p.status,
        })),
        ...services.map((s) => ({
          id: s.id,
          type: 'service' as const,
          name: s.name,
          status: s.status,
        })),
      ];

      const edges = dependencies
        .map((dep) => ({
          source: dep.source_project_id,
          target: dep.target_project_id ?? dep.target_service_id ?? '',
          dependencyType: dep.dependency_type,
        }))
        .filter((e) => e.target !== '');

      return c.json({ nodes, edges });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return api;
}

exec
/bin/bash -lc 'rg -n "getRunningActionRuns|getActionRunsByProject|getActionRunsByApprovalStatus|listOpsIncidentsByDateRange|listOpsIncidentEventsByIncidentIds" src test' in /home/lee/OpenLander
 succeeded in 0ms:
test/alerts.test.ts:76:      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
test/alerts.test.ts:190:      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
src/pipeline/auto-recovery.ts:329:      .getActionRunsByProject(projectId, 20)
test/web/api/ops-automation-routes.test.ts:28:      listOpsIncidentsByDateRange: () => [],
test/web/api/ops-automation-routes.test.ts:37:      getActionRunsByProject: () => [],
test/web/api/ops-automation-routes.test.ts:38:      getActionRunsByApprovalStatus: () => [],
test/web/api/ops-routes.test.ts:69:      listOpsIncidentsByDateRange: () => [],
test/web/api/ops-routes.test.ts:70:      listOpsIncidentEventsByIncidentIds: () => [],
test/web/api/ops-routes.test.ts:79:      getActionRunsByProject: () => [],
test/web/api/ops-routes.test.ts:80:      getActionRunsByApprovalStatus: () => [],
test/web/api/activity-routes.test.ts:389:    getActionRunsByApprovalStatus: () => [],
test/web/api/ops-incident-routes.test.ts:14:  listOpsIncidentEventsByIncidentIds: ReturnType<typeof vi.fn>;
test/web/api/ops-incident-routes.test.ts:70:  const listOpsIncidentEventsByIncidentIds = vi.fn((incidentIds: string[]) =>
test/web/api/ops-incident-routes.test.ts:86:      listOpsIncidentsByDateRange: () => incidents,
test/web/api/ops-incident-routes.test.ts:87:      listOpsIncidentEventsByIncidentIds,
test/web/api/ops-incident-routes.test.ts:100:      getActionRunsByProject: () => [],
test/web/api/ops-incident-routes.test.ts:101:      getActionRunsByApprovalStatus: () => [],
test/web/api/ops-incident-routes.test.ts:107:  return { app, listOpsIncidentEventsByIncidentIds, listOpsIncidentEvents, circuitBreakers };
test/web/api/ops-incident-routes.test.ts:151:    expect(harness.listOpsIncidentEventsByIncidentIds).toHaveBeenCalledTimes(1);
test/web/api/ops-incident-routes.test.ts:231:        listOpsIncidentsByDateRange: () => {
test/web/api/ops-incident-routes.test.ts:234:        listOpsIncidentEventsByIncidentIds: () => [],
test/web/api/ops-incident-routes.test.ts:247:        getActionRunsByProject: () => [],
test/web/api/ops-incident-routes.test.ts:248:        getActionRunsByApprovalStatus: () => [],
test/web/api/ops-incident-routes.test.ts:326:        listOpsIncidentsByDateRange: () => [],
test/web/api/ops-incident-routes.test.ts:327:        listOpsIncidentEventsByIncidentIds: () => [],
test/web/api/ops-incident-routes.test.ts:338:        getActionRunsByProject: () => [],
test/web/api/ops-incident-routes.test.ts:339:        getActionRunsByApprovalStatus: () => [],
test/pipeline/auto-recovery.test.ts:215:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:247:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:283:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:325:      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/pipeline/auto-recovery.test.ts:342:      const updatedRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/pipeline/auto-recovery.test.ts:384:      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/pipeline/auto-recovery.test.ts:392:      const updatedRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/pipeline/auto-recovery.test.ts:458:      const runningRuns = harness.db.getRunningActionRuns(projectId);
test/pipeline/auto-recovery.test.ts:494:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:513:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:578:      const runs = harness.db.getActionRunsByProject(projectId, 1);
test/pipeline/auto-recovery.test.ts:645:      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/pipeline/auto-recovery.test.ts:706:      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
test/monitor/ops-agent.test.ts:37:      getActionRunsByApprovalStatus: vi.fn(() => []),
test/monitor/ops-agent.test.ts:339:      mockCtx.db.getActionRunsByApprovalStatus.mockReturnValue([{ id: 'run-pending-1' }]);
test/alerts-container-gone.test.ts:75:      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
src/db/index.ts:229:  getRunningActionRuns(projectId: string) { return this.actionRunRepo.findRunning(projectId); }
src/db/index.ts:230:  getActionRunsByProject(projectId: string, limit?: number) { return this.actionRunRepo.findByProjectId(projectId, limit); }
src/db/index.ts:232:  getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
src/db/index.ts:248:  listOpsIncidentEventsByIncidentIds(incidentIds: string[]) { return this.opsIncidentEventRepo.findByIncidentIds(incidentIds); }
src/db/index.ts:249:  listOpsIncidentsByDateRange(from: number, to: number) { return this.opsIncidentRepo.findByDateRange(from, to); }
src/channels/base.ts:476:          const recent = this.ctx.db.listOpsIncidentsByDateRange(dayAgo, now);
src/web/api/ops-routes.ts:134:        incidents = ctx.db.listOpsIncidentsByDateRange(from, Date.now());
src/web/api/ops-routes.ts:142:      const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
src/web/api/ops-routes.ts:196:        .flatMap((project) => ctx.db.getRunningActionRuns(project.id))
src/web/api/ops-routes.ts:416:          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
src/web/api/ops-routes.ts:418:          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
src/web/api/ops-routes.ts:472:          ? ctx.db.getActionRunsByProject(projectId, 100)
src/web/api/ops-routes.ts:473:          : projects.flatMap((project) => ctx.db.getActionRunsByProject(project.id, 20));
src/monitor/activity-event-mapper.ts:70:  getActionRunsByApprovalStatus(
src/monitor/activity-event-mapper.ts:104:        .getActionRunsByApprovalStatus(status, 200)
src/monitor/ops-agent.ts:217:      const pendingApprovals = this.ctx.db.getActionRunsByApprovalStatus('pending', 100);
src/web/api/routes.ts:370:    const actionRuns = ctx.db.getActionRunsByApprovalStatus(approvalStatus, 20).map((run) => ({
src/monitor/ops-digest.ts:143:      return this.ctx.db.listOpsIncidentsByDateRange(from, to);

exec
/bin/bash -lc "git show 62ae2bf:web/src/hooks/use-ops-center-data.ts | sed -n '70,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
    if (s.size > BUFFER_MAX * 2) {
      const arr = [...s];
      dedupSetRef.current = new Set(arr.slice(arr.length - BUFFER_MAX));
    }
    return true;
  }, []);

  // ---------------------------------------------------------------------------
  // SSE connect with backfill + exponential backoff reconnect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (cancelledRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const params = new URLSearchParams({ follow: 'true' });
        if (lastEventIdRef.current) {
          params.set('since', lastEventIdRef.current);
        }

        const resp = await fetch(`/api/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include',
        });

        if (!resp.ok || !resp.body) {
          if (!cancelledRef.current) {
            setError(`Stream error: ${resp.status}`);
          }
          return;
        }

        if (!cancelledRef.current) {
          setIsConnected(true);
          setIsReconnecting(false);
          retriesRef.current = 0; // reset on successful connection
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let inBackfill = false;
        let backfillBatch: ActivityItem[] = [];

        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelledRef.current) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>;

              // Handle backfill-complete sentinel
              if (parsed.type === 'backfill-complete') {
                if (backfillBatch.length > 0) {
                  // Batch-apply all backfill items in one state update
                  const batch = backfillBatch;
                  backfillBatch = [];
                  setActivities((prev) => {
                    const merged = [...batch, ...prev];
                    // Deduplicate already handled per-item, just enforce ceiling
                    return merged.slice(0, BUFFER_MAX);
                  });
                }
                inBackfill = false;
                continue;
              }

              const item = parsed as unknown as ActivityItem;
              if (!item.id) continue;

              // Track last event ID for gap recovery
              lastEventIdRef.current = item.id;

              if (!dedup(item.id)) continue;

              if (parsed.backfill === true) {
                inBackfill = true;
                backfillBatch.push(item);
              } else if (inBackfill) {
                // Non-backfill item arriving during backfill — buffer it too
                backfillBatch.push(item);
              } else {
                // Incremental live update
                setActivities((prev) => [item, ...prev].slice(0, BUFFER_MAX));
              }
            } catch {
              // Ignore malformed NDJSON lines
            }
          }
        }

        // Stream ended normally — attempt reconnect if still mounted
        if (!cancelledRef.current && retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1;
          setIsConnected(false);
          setIsReconnecting(true);
          const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
          setTimeout(() => {
            if (!cancelledRef.current) {
              setIsReconnecting(false);
              connect();
            }
          }, delay);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        if (!cancelledRef.current) {
          const message = err instanceof Error ? err.message : 'Stream failed';
          setError(message);
          setIsConnected(false);

          // Auto-retry with exponential backoff
          if (retriesRef.current < MAX_RETRIES) {
            retriesRef.current += 1;
            setIsReconnecting(true);
            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
            setTimeout(() => {
              if (!cancelledRef.current) {
                setIsReconnecting(false);
                connect();
              }
            }, delay);
          }
        }
      }
    })();
  }, [dedup]);

  // ---------------------------------------------------------------------------
  // Initial parallel REST snapshot + SSE connect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    cancelledRef.current = false;
    setIsLoading(true);

    // Parallel REST snapshot
    Promise.all([
      fetch('/api/activity?limit=100', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
        return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
      }),
      fetchOpsIncidents(undefined, 'open'),
      fetchAllCircuitBreakers(),
      fetchPendingApprovals().catch(() => [] as ActionRun[]),
      fetchWithAuth('/api/ops/agent/active')
        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
        .catch(() => ({ isActive: false }) as AgentActiveState),
    ])
      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
        if (cancelledRef.current) return;

        const items = activityData.activities.slice(0, BUFFER_MAX);
        // Seed dedup set with initial snapshot IDs
        for (const item of items) {
          dedupSetRef.current.add(item.id);
        }
        // Track last event ID for SSE gap recovery
        if (items.length > 0) {
          lastEventIdRef.current = items[0].id;
        }

        setActivities(items);
        setIncidents(incidentData.incidents ?? []);
        setCircuitBreakers(cbData.breakers ?? []);
        setApprovals(approvalData);
        setAgentStatus(agentData as AgentActiveState);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setIsLoading(false);

        // Open SSE after snapshot
        if (!cancelledRef.current) {

exec
/bin/bash -lc "sed -n '260,380p' web/src/hooks/use-ops-center-data.ts" in /home/lee/OpenLander
 succeeded in 0ms:

        // Open SSE after snapshot
        if (!cancelledRef.current) {
          retriesRef.current = 0;
          connect();
        }
      });

    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
      dedupSetRef.current.clear();
    };
  }, [connect]);

  // ---------------------------------------------------------------------------
  // Manual retry: reset error and reconnect
  // ---------------------------------------------------------------------------
  const retry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    retriesRef.current = 0;
    connect();
  }, [connect]);

  return {
    activities,
    incidents,
    circuitBreakers,
    approvals,
    agentStatus,
    isConnected,
    isReconnecting,
    isLoading,
    error,
    retry,
  };
}

exec
/bin/bash -lc "sed -n '1,260p' test/web/api/ops-routes.test.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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

exec
/bin/bash -lc "sed -n '1,260p' test/web/api/activity-routes.test.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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

import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { initializeDatabase } from '../../../src/db/migration.js';
import { ActivityLogRepo } from '../../../src/db/repos/activity-log.repo.js';
import type { ActivityLogRow } from '../../../src/db/types.js';
import {
  buildActivityEvent,
  mapActivitySeverity,
  mapActivityStatus,
  mapActivityType,
} from '../../../src/monitor/activity-event-mapper.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<Omit<ActivityLogRow, 'id' | 'created_at'>> = {},
): Omit<ActivityLogRow, 'id' | 'created_at'> {
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
    initializeDatabase(sqlite);
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

exec
/bin/bash -lc "sed -n '200,280p' src/db/index.ts" in /home/lee/OpenLander
 succeeded in 0ms:
  updateDeployPlan(planId: string, updates: Parameters<DeployPlanRepo['updateDeployPlan']>[1]) { this.deployPlanRepo.updateDeployPlan(planId, updates); }
  updateDeployPlanStatus(planId: string, status: string) { this.deployPlanRepo.updateDeployPlanStatus(planId, status); }
  listDeployPlans(projectName?: string) { return this.deployPlanRepo.listDeployPlans(projectName); }
  getLatestPlanForProject(projectName: string) { return this.deployPlanRepo.getLatestPlanForProject(projectName); }
  saveDeployConfig(projectId: string, configJson: string, configVersion: number) { this.deployConfigRepo.save(projectId, configJson, configVersion); }
  loadDeployConfig(projectId: string) { return this.deployConfigRepo.load(projectId); }
  deleteDeployConfig(projectId: string) { this.deployConfigRepo.delete(projectId); }
  isPasswordSet() { return this.authRepo.isPasswordSet(); }
  getAuth() { return this.authRepo.getAuth(); }
  setPassword(hash: string) { this.authRepo.setPassword(hash); }
  getApiToken() { return this.authRepo.getApiToken(); }
  setApiToken(encrypted: string, iv: string) { this.authRepo.setApiToken(encrypted, iv); }
  getSession() { return this.authRepo.getSession(); }
  createSession(token: string, createdAt: number, expiresAt: number) { this.authRepo.createSession(token, createdAt, expiresAt); }
  deleteSession() { this.authRepo.deleteSession(); }
  getUsedPorts(): number[] { const projectPorts = this.db.select({ assigned_port: projects.assigned_port }).from(projects).where(isNotNull(projects.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...projectPorts, ...envPorts])]; }
  createAiUsageLog(data: Parameters<AiUsageLogRepo['create']>[0]) { return this.aiUsageLogRepo.create(data); }
  getAiUsageLogsByProject(projectId: string) { return this.aiUsageLogRepo.findByProjectId(projectId); }
  getAiUsageLogsByDateRange(from: Date, to: Date) { return this.aiUsageLogRepo.findByDateRange(from, to); }
  getAiTokenSummary(projectId?: string) { return this.aiUsageLogRepo.getTokenSummary(projectId); }
  getAiTokenSummaryFiltered(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.getTokenSummaryFiltered(opts); }
  getRecentAiUsageLogs(opts: { limit: number; projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.findRecent(opts); }
  countAiUsageLogs(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.countAll(opts); }
  createActionRun(data: Parameters<ActionRunRepo['create']>[0]) { return this.actionRunRepo.create(data); }
  updateActionRunStatus(id: string, status: 'running' | 'succeeded' | 'failed' | 'pending_approval', errorMessage?: string) { this.actionRunRepo.updateStatus(id, status, errorMessage); }
  updateActionRunStep(id: string, currentStep: number, totalSteps?: number) { this.actionRunRepo.updateStep(id, currentStep, totalSteps); }
  updateActionRunApproval(id: string, approvalStatus: 'pending' | 'approved' | 'rejected', approvalTool?: string) { this.actionRunRepo.updateApproval(id, approvalStatus, approvalTool); }
  updateActionRunRecoveryStrategy(id: string, strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null) { this.actionRunRepo.updateRecoveryStrategy(id, strategy); }
  updateActionRunPlan(id: string, plan: string) { this.actionRunRepo.updatePlan(id, plan); }
  getRunningActionRuns(projectId: string) { return this.actionRunRepo.findRunning(projectId); }
  getActionRunsByProject(projectId: string, limit?: number) { return this.actionRunRepo.findByProjectId(projectId, limit); }
  findActionRunPendingApproval(actionRunId: string) { return this.actionRunRepo.findPendingApproval(actionRunId); }
  getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
  findDeploymentPatternsByProject(projectId: string) { return this.deploymentPatternRepo.findByProject(projectId); }
  findDeploymentPatternBySignature(projectId: string, signature: string) { return this.deploymentPatternRepo.findBySignature(projectId, signature); }
  upsertDeploymentPattern(data: { project_id: string; pattern_type: string; error_signature: string; fix_action: string }) { return this.deploymentPatternRepo.upsertPattern(data); }
  recordDeploymentPatternSuccess(id: string) { this.deploymentPatternRepo.recordSuccess(id); }
  recordDeploymentPatternFailure(id: string) { this.deploymentPatternRepo.recordFailure(id); }
  getTopDeploymentPatterns(projectId: string, limit?: number) { return this.deploymentPatternRepo.getTopPatterns(projectId, limit); }
  createOpsIncident(data: Parameters<OpsIncidentRepo['create']>[0]) { return this.opsIncidentRepo.create(data); }
  getOpsIncident(id: string) { return this.opsIncidentRepo.findById(id); }
  listOpsIncidentsByProject(projectId: string, limit?: number) { return this.opsIncidentRepo.findByProjectId(projectId, limit); }
  getActiveOpsIncident(projectId: string) { return this.opsIncidentRepo.findActive(projectId); }
  listAllActiveOpsIncidents() { return this.opsIncidentRepo.findAllActive(); }
  updateOpsIncidentStatus(id: string, status: string, extra?: { resolved_at?: number; escalated_at?: number }) { this.opsIncidentRepo.updateStatus(id, status, extra); }
  updateOpsIncident(id: string, data: Parameters<OpsIncidentRepo['update']>[1]) { this.opsIncidentRepo.update(id, data); }
  addOpsIncidentEvent(data: Parameters<OpsIncidentEventRepo['addEvent']>[0]) { return this.opsIncidentEventRepo.addEvent(data); }
  listOpsIncidentEvents(incidentId: string) { return this.opsIncidentEventRepo.findByIncidentId(incidentId); }
  listOpsIncidentEventsByIncidentIds(incidentIds: string[]) { return this.opsIncidentEventRepo.findByIncidentIds(incidentIds); }
  listOpsIncidentsByDateRange(from: number, to: number) { return this.opsIncidentRepo.findByDateRange(from, to); }
  getCircuitBreakerState(projectId: string) { return this.circuitBreakerRepo.getState(projectId); }
  upsertCircuitBreakerState(projectId: string, data: Parameters<CircuitBreakerRepo['upsert']>[1]) { this.circuitBreakerRepo.upsert(projectId, data); }
  incrementCircuitBreakerFailure(projectId: string) { return this.circuitBreakerRepo.incrementFailure(projectId); }
  openCircuitBreaker(projectId: string) { this.circuitBreakerRepo.openBreaker(projectId); }
  halfOpenCircuitBreaker(projectId: string) { this.circuitBreakerRepo.halfOpen(projectId); }
  resetCircuitBreaker(projectId: string) { this.circuitBreakerRepo.reset(projectId); }
  findAllOpenCircuitBreakers() { return this.circuitBreakerRepo.findAllOpen(); }
  listAllCircuitBreakers() { return this.circuitBreakerRepo.findAll(); }
  isCircuitBreakerOpen(projectId: string) { return this.circuitBreakerRepo.isOpen(projectId); }
  createProjectDependency(data: Parameters<ProjectDependencyRepo['create']>[0]) { return this.projectDependencyRepo.create(data); }
  findDependenciesByProject(projectId: string) { return this.projectDependencyRepo.findByProject(projectId); }
  findProjectDependents(targetProjectId?: string, targetServiceId?: string) { return this.projectDependencyRepo.findDependents(targetProjectId, targetServiceId); }
  findAllProjectDependencies() { return this.projectDependencyRepo.findAll(); }
  deleteProjectDependency(id: string) { this.projectDependencyRepo.delete(id); }
  deleteProjectDependenciesByProject(projectId: string) { this.projectDependencyRepo.deleteByProject(projectId); }
  syncDependenciesFromServiceConnections(serviceConnections: Parameters<ProjectDependencyRepo['syncFromServiceConnections']>[0]) { this.projectDependencyRepo.syncFromServiceConnections(serviceConnections); }
  getProjectOpsOverride(projectId: string) { return this.projectOpsOverrideRepo.load(projectId); }
  setProjectOpsOverride(projectId: string, overrides: ProjectOpsOverride) { this.projectOpsOverrideRepo.save(projectId, overrides); }
  deleteProjectOpsOverride(projectId: string) { this.projectOpsOverrideRepo.delete(projectId); }
  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }
  transaction<T>(fn: () => T) { return this.sqlite.transaction(fn)(); }
  close() { this.sqlite.close(); }
}

codex
I’ve confirmed this commit splits the ops center off the generic `/api/activity` stream, which avoids the old ID/timestamp cursor mismatch. Now I’m checking whether the new `/api/ops/activity` implementation is actually safe as a streaming source, because it no longer uses the EventBus buffer and instead polls reconstructed state.
exec
/bin/bash -lc "rg -n \"findRunning\\(|findByProjectId\\(|findByApprovalStatus\\(\" src/db/repos" in /home/lee/OpenLander
exec
/bin/bash -lc "rg -n \"/api/activity|fetchActivityFeed\\(|type ActivityItem|triggerType|agent/active|useOpsCenterData\\(\" web/src src test" in /home/lee/OpenLander
 succeeded in 0ms:
src/db/repos/action-run.repo.ts:134:  findByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit = 20): ActionRunRow[] {
src/db/repos/action-run.repo.ts:152:  findRunning(projectId: string): ActionRunRow[] {
src/db/repos/action-run.repo.ts:169:  findByProjectId(projectId: string, limit?: number): ActionRunRow[] {
src/db/repos/ops-incident.repo.ts:44:  findByProjectId(projectId: string, limit?: number): OpsIncidentRow[] {
src/db/repos/ai-usage-log.repo.ts:57:  findByProjectId(projectId: string): AiUsageLogRow[] {

 succeeded in 0ms:
web/src/pages/OpsCenterV2.tsx:49:  } = useOpsCenterData();
web/src/hooks/use-ops-center-data.ts:6:  type ActivityItem,
web/src/hooks/use-ops-center-data.ts:43:export function useOpsCenterData(): OpsCenterData {
web/src/hooks/use-ops-center-data.ts:229:      fetchWithAuth('/api/ops/agent/active')
web/src/hooks/use-agent-activity.ts:26:      const res = await fetchWithAuth('/api/ops/agent/active').catch(() => null);
web/src/hooks/use-activity-stream.ts:3:import { fetchActivityFeed, type ActivityItem } from '../lib/api/operations';
web/src/hooks/use-activity-stream.ts:16:    fetchActivityFeed({ projectId: options?.projectId, types: options?.types, limit: 50 })
web/src/hooks/use-activity-stream.ts:35:        const resp = await fetch(`/api/activity?${params.toString()}`, {
test/web/api/activity-routes.test.ts:4: * The `/api/activity` endpoint (routes.ts) uses the in-memory EventBus buffer
test/web/api/activity-routes.test.ts:422:    // Legacy aliases required by existing consumers of /api/activity
test/web/api/ops-incident-routes.test.ts:117:  it('returns triggerType from detected metadata in /incidents', async () => {
test/web/api/ops-incident-routes.test.ts:124:    expect(body.incidents[0].triggerType).toBe('deploy:crash');
test/web/api/ops-incident-routes.test.ts:139:  it('uses batched incident events and includes triggerType in /activity', async () => {
test/web/api/ops-incident-routes.test.ts:140:    const response = await harness.app.request('/api/activity?types=incident,alert');
test/web/api/ops-incident-routes.test.ts:149:    expect(incidentActivity?.triggerType).toBe('deploy:crash');
test/web/api/ops-incident-routes.test.ts:209:  it('each incident item has optional triggerType string when event metadata is present', async () => {
test/web/api/ops-incident-routes.test.ts:213:    // triggerType is optional but must be string when present
test/web/api/ops-incident-routes.test.ts:214:    if (incident['triggerType'] !== undefined) {
test/web/api/ops-incident-routes.test.ts:215:      expect(typeof incident['triggerType']).toBe('string');
test/web/api/ops-incident-routes.test.ts:354:describe('GET /api/activity (ops-routes) regression shape', () => {
test/web/api/ops-incident-routes.test.ts:362:    const response = await harness.app.request('/api/activity');
test/web/api/ops-incident-routes.test.ts:371:    const response = await harness.app.request('/api/activity?types=incident');
test/web/api/ops-incident-routes.test.ts:387:    const response = await harness.app.request('/api/activity?types=incident');
test/web/api/ops-incident-routes.test.ts:395:    const response = await harness.app.request('/api/activity');
test/web/api/ops-incident-routes.test.ts:411:    const response = await harness.app.request('/api/activity?types=incident');
test/web/api/ops-incident-routes.test.ts:419:    const response = await harness.app.request('/api/activity?types=incident');
test/web/api/ops-incident-routes.test.ts:427:    const response = await harness.app.request('/api/activity?types=incident');
test/web/api/ops-incident-routes.test.ts:434:    const response = await harness.app.request('/api/activity?limit=200');
test/web/api/ops-incident-routes.test.ts:442:    const response = await harness.app.request('/api/activity?types=approval');
test/web/api/ops-incident-routes.test.ts:450:    const response = await harness.app.request('/api/activity?types=incident');
src/monitor/activity-event-mapper.ts:11:// ── ActivityEvent shape (matches the legacy /api/activity format) ──
src/monitor/activity-event-mapper.ts:55:  // Backward-compatibility aliases for legacy consumers of /api/activity
src/monitor/ops-incidents.ts:88:    log.info({ incidentId: incident.id, projectId, triggerType: trigger.type }, 'Incident opened');
src/monitor/ops-incidents.ts:138:  private inferSeverity(triggerType: string): 'critical' | 'warning' | 'info' {
src/monitor/ops-incidents.ts:140:      triggerType.includes('crash') ||
src/monitor/ops-incidents.ts:141:      triggerType.includes('missing') ||
src/monitor/ops-incidents.ts:142:      triggerType.includes('exhausted')
src/monitor/ops-incidents.ts:147:      triggerType.includes('fail') ||
src/monitor/ops-incidents.ts:148:      triggerType.includes('degrad') ||
src/monitor/ops-incidents.ts:149:      triggerType.includes('inactive')
web/src/lib/api/operations.ts:85:  triggerType?: string;
web/src/lib/api/operations.ts:178:  triggerType?: string;
web/src/lib/api/operations.ts:211:export async function fetchActivityFeed(opts?: {
src/ipc/client.ts:328:      `/api/activity?limit=${String(limit)}`,
src/ipc/client.ts:334:    yield* this.streamNDJSON<ActivityEvent>('/api/activity/stream', signal);
src/web/api/ops-routes.ts:24:  triggerType?: string;
src/web/api/ops-routes.ts:29:  triggerType?: string;
src/web/api/ops-routes.ts:71:  const triggerType = typePart?.trim();
src/web/api/ops-routes.ts:72:  if (!triggerType) return {};
src/web/api/ops-routes.ts:75:    triggerType,
src/web/api/ops-routes.ts:89:        triggerType: metadata.trigger_type,
src/web/api/ops-routes.ts:94:    if (detectedTrigger.triggerType) return detectedTrigger;
src/web/api/ops-routes.ts:105:    triggerType: trigger.triggerType,
src/web/api/ops-routes.ts:191:  api.get('/agent/active', (c) => {
src/web/api/ops-routes.ts:437:              triggerType: trigger.triggerType,
web/src/components/ops/IncidentMap.tsx:41:      a.triggerType !== b.triggerType ||
web/src/components/ops/IncidentMap.tsx:61:      incident.triggerType ||
web/src/components/ops/IncidentMap.tsx:75:        latest.triggerType ||
web/src/components/project/OperationsTab.tsx:42:      inc.triggerType ||
web/src/components/project/OperationsTab.tsx:51:      latest.triggerType ||
web/src/components/ops/v2/MainFeedGrid.tsx:35:  triggerType?: string;
web/src/components/ops/v2/MainFeedGrid.tsx:87:    const triggerType = activeIncident?.triggerType;
web/src/components/ops/v2/MainFeedGrid.tsx:100:      triggerType,
web/src/components/ops/v2/MainFeedGrid.tsx:366:                    {thread.triggerType && (
web/src/components/ops/v2/MainFeedGrid.tsx:368:                        {thread.triggerType}

exec
/bin/bash -lc "sed -n '1,260p' src/db/repos/action-run.repo.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { actionRuns } from '../schema.drizzle.js';
import type { ActionRunRow } from '../types.js';

export class ActionRunRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  /**
   * Create a new action run with status='running'.
   * Generates UUID and sets started_at timestamp.
   */
  create(data: {
    projectId: string;
    triggerSource: ActionRunRow['trigger_source'];
    triggerSessionId?: string;
    recoveryStrategy?: ActionRunRow['recovery_strategy'];
    correlationId?: string;
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const recoveryStrategy = data.recoveryStrategy === 'unknown' ? null : data.recoveryStrategy;

    this.db
      .insert(actionRuns)
      .values({
        id,
        project_id: data.projectId,
        trigger_source: data.triggerSource,
        trigger_session_id: data.triggerSessionId ?? null,
        status: 'running',
        error_message: null,
        recovery_strategy: recoveryStrategy ?? null,
        correlation_id: data.correlationId ?? null,
        steps_json: null,
        started_at: now,
        completed_at: null,
        tenant_id: null,
        user_id: null,
        created_at: now,
      })
      .run();

    return id;
  }

  updateStatus(
    id: string,
    status: 'running' | 'succeeded' | 'failed' | 'pending_approval',
    errorMessage?: string,
  ): void {
    const completedAt =
      status === 'succeeded' || status === 'failed' ? new Date().toISOString() : null;

    this.db
      .update(actionRuns)
      .set({
        status,
        error_message: errorMessage ?? null,
        completed_at: completedAt,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updatePlan(id: string, plan: string): void {
    const now = new Date().toISOString();
    this.db
      .update(actionRuns)
      .set({
        plan,
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updateStep(id: string, currentStep: number, totalSteps?: number): void {
    const now = new Date().toISOString();
    this.db
      .update(actionRuns)
      .set({
        current_step: currentStep,
        ...(totalSteps !== undefined ? { total_steps: totalSteps } : {}),
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updateApproval(
    id: string,
    approvalStatus: 'pending' | 'approved' | 'rejected',
    approvalTool?: string,
  ): void {
    const now = new Date().toISOString();
    const isPending = approvalStatus === 'pending';

    this.db
      .update(actionRuns)
      .set({
        approval_status: approvalStatus,
        approval_tool: approvalTool ?? null,
        approval_requested_at: isPending ? now : undefined,
        approval_resolved_at: isPending ? undefined : now,
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updateRecoveryStrategy(id: string, strategy: ActionRunRow['recovery_strategy']): void {
    const normalized = strategy === 'unknown' ? null : strategy;
    this.db
      .update(actionRuns)
      .set({ recovery_strategy: normalized, updated_at: new Date().toISOString() })
      .where(eq(actionRuns.id, id))
      .run();
  }

  findPendingApproval(actionRunId: string): ActionRunRow | null {
    const result = this.db
      .select()
      .from(actionRuns)
      .where(and(eq(actionRuns.id, actionRunId), eq(actionRuns.approval_status, 'pending')))
      .get();

    return (result as ActionRunRow | undefined) ?? null;
  }

  findByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit = 20): ActionRunRow[] {
    const whereClause =
      status === 'pending'
        ? and(eq(actionRuns.approval_status, 'pending'), eq(actionRuns.status, 'pending_approval'))
        : eq(actionRuns.approval_status, status);

    return this.db
      .select()
      .from(actionRuns)
      .where(whereClause)
      .orderBy(desc(actionRuns.created_at))
      .limit(limit)
      .all() as ActionRunRow[];
  }

  /**
   * Find all running action runs for a project.
   */
  findRunning(projectId: string): ActionRunRow[] {
    return this.db
      .select()
      .from(actionRuns)
      .where(
        and(
          eq(actionRuns.project_id, projectId),
          or(eq(actionRuns.status, 'running'), eq(actionRuns.status, 'pending_approval')),
        ),
      )
      .orderBy(desc(actionRuns.created_at))
      .all() as ActionRunRow[];
  }

  /**
   * Find all action runs for a project, optionally limited.
   */
  findByProjectId(projectId: string, limit?: number): ActionRunRow[] {
    const baseQuery = this.db
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.project_id, projectId))
      .orderBy(desc(actionRuns.created_at));

    if (limit) {
      return baseQuery.limit(limit).all() as ActionRunRow[];
    }

    return baseQuery.all() as ActionRunRow[];
  }

  /**
   * Mark all stale running and pending_approval action runs as failed on startup.
   * Called during Database initialization to clean up incomplete runs from previous sessions.
   * Returns the count of updated rows.
   */
  markStaleAsFailedOnStartup(): number {
    this.db
      .update(actionRuns)
      .set({
        status: 'failed',
        error_message: 'Server restarted',
        completed_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(sql`${actionRuns.status} IN ('running', 'pending_approval')`)
      .run();

    const staleRow = this.sqlite.prepare('SELECT changes() as changes').get() as {
      changes: number;
    } | null;
    const staleChanges = staleRow?.changes ?? 0;

    this.db
      .update(actionRuns)
      .set({
        approval_status: 'rejected',
        approval_resolved_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(actionRuns.approval_status, 'pending'))
      .run();

    return staleChanges;
  }
}

exec
/bin/bash -lc "sed -n '1,260p' src/db/repos/ops-incident.repo.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { opsIncidents } from '../schema.drizzle.js';
import type { OpsIncidentRow } from '../types.js';

export class OpsIncidentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  create(data: {
    id: string;
    project_id: string;
    severity: string;
    status?: string;
    root_cause?: string;
  }): OpsIncidentRow {
    this.db
      .insert(opsIncidents)
      .values({
        id: data.id,
        project_id: data.project_id,
        severity: data.severity as 'critical' | 'warning' | 'info',
        status: (data.status ?? 'open') as 'open' | 'active' | 'resolved' | 'escalated',
        root_cause: data.root_cause,
        created_at: Date.now(),
      })
      .run();

    const created = this.findById(data.id);
    if (!created) throw new Error(`Failed to create ops incident ${data.id}`);
    return created;
  }

  findById(id: string): OpsIncidentRow | undefined {
    return this.db.select().from(opsIncidents).where(eq(opsIncidents.id, id)).get() as
      | OpsIncidentRow
      | undefined;
  }

  findByProjectId(projectId: string, limit?: number): OpsIncidentRow[] {
    const baseQuery = this.db
      .select()
      .from(opsIncidents)
      .where(eq(opsIncidents.project_id, projectId))
      .orderBy(desc(opsIncidents.created_at));

    if (limit) {
      return baseQuery.limit(limit).all() as OpsIncidentRow[];
    }

    return baseQuery.all() as OpsIncidentRow[];
  }

  findActive(projectId: string): OpsIncidentRow | undefined {
    return this.db
      .select()
      .from(opsIncidents)
      .where(
        and(
          eq(opsIncidents.project_id, projectId),
          inArray(opsIncidents.status, ['open', 'active']),
        ),
      )
      .orderBy(desc(opsIncidents.created_at))
      .get() as OpsIncidentRow | undefined;
  }

  findAllActive(): OpsIncidentRow[] {
    return this.db
      .select()
      .from(opsIncidents)
      .where(inArray(opsIncidents.status, ['open', 'active']))
      .orderBy(desc(opsIncidents.created_at))
      .all() as OpsIncidentRow[];
  }

  findByDateRange(from: number, to: number): OpsIncidentRow[] {
    return this.db
      .select()
      .from(opsIncidents)
      .where(and(gte(opsIncidents.created_at, from), lte(opsIncidents.created_at, to)))
      .orderBy(desc(opsIncidents.created_at))
      .all() as OpsIncidentRow[];
  }

  updateStatus(
    id: string,
    status: string,
    extra?: { resolved_at?: number; escalated_at?: number },
  ): void {
    const setValues: Record<string, unknown> = {
      status: status as 'open' | 'active' | 'resolved' | 'escalated',
    };
    if (extra?.resolved_at !== undefined) {
      setValues.resolved_at = extra.resolved_at;
    }
    if (extra?.escalated_at !== undefined) {
      setValues.escalated_at = extra.escalated_at;
    }

    this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id)).run();
  }

  update(
    id: string,
    data: Partial<{
      root_cause: string;
      diagnosis: string;
      actions_taken: string;
      status: string;
    }>,
  ): void {
    const setValues: Record<string, unknown> = {};

    if (data.root_cause !== undefined) {
      setValues.root_cause = data.root_cause;
    }
    if (data.diagnosis !== undefined) {
      setValues.diagnosis = data.diagnosis;
    }
    if (data.actions_taken !== undefined) {
      setValues.actions_taken = data.actions_taken;
    }
    if (data.status !== undefined) {
      setValues.status = data.status as 'open' | 'active' | 'resolved' | 'escalated';
    }

    if (Object.keys(setValues).length === 0) return;

    this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id)).run();
  }
}

exec
/bin/bash -lc "rg -n \"createOpsRoutes\\(|route\\('/api/ops|route\\('/api'\" src/web/server.ts src/web/api/routes.ts src/web/api -g'*.ts'" in /home/lee/OpenLander
 succeeded in 0ms:
src/web/api/routes.ts:496:  api.route('/ops', createOpsRoutes(ctx));
src/web/server.ts:137:  app.route('/api', authRoutes);
src/web/server.ts:140:  app.route('/api', apiRoutes);
src/web/server.ts:143:  app.route('/api', setupRoutes);
src/web/server.ts:147:  app.route('/api', webhookRoutes);
src/web/server.ts:150:  app.route('/api', terminalRoutes);
src/web/server.ts:154:  app.route('/api', domainRoutes);
src/web/server.ts:157:  app.route('/api', chatRoutes);
src/web/server.ts:160:  app.route('/api', llmRoutes);
src/web/api/routes.ts:496:  api.route('/ops', createOpsRoutes(ctx));
src/web/api/ops-routes.ts:118:export function createOpsRoutes(ctx: AppContext): Hono {

exec
/bin/bash -lc "sed -n '1,140p' web/src/hooks/use-agent-activity.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';

export interface AgentActiveState {
  isActive: boolean;
  projectId?: string;
  projectName?: string;
  incidentId?: string;
  currentStep?: string;
  currentStepNumber?: number;
  totalSteps?: number;
  startedAt?: string;
  lastUpdatedAt?: string;
  thoughtLog?: string[];
}

export function useAgentActivity() {
  const [data, setData] = useState<AgentActiveState>({ isActive: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      // Mocking for frontend UI development since endpoint might not exist yet
      // Removing the mock when endpoint is available.
      const res = await fetchWithAuth('/api/ops/agent/active').catch(() => null);

      if (!res || !res.ok) {
        // Fallback Mock UI state for demonstrating the UI/UX
        // if API returns 404 or backend is not updated.
        setData({
          isActive: false, // Set to true manually locally to test
          projectId: 'mock-1',
          projectName: 'hotdeal-api',
          currentStep: 'Analyzing crash dump logs...',
          currentStepNumber: 2,
          totalSteps: 4,
          startedAt: new Date(Date.now() - 45000).toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          thoughtLog: [
            'Detected OOM Kill in container hotdeal-api',
            'Fetching last 50 lines of logs',
            'Searching for memory leak footprint',
            'Identifying heavy DB queries...',
          ],
        });
        setError(null);
        return;
      }

      const payload = await res.json();
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();

    // Polling logic: fast when active, slow when idle
    const interval = setInterval(
      () => {
        void fetchStatus();
      },
      data.isActive ? 3000 : 10000,
    );

    return () => clearInterval(interval);
  }, [fetchStatus, data.isActive]);

  return { activeState: data, loading, error };
}

exec
/bin/bash -lc "sed -n '1,220p' web/src/components/ops/v2/MainFeedGrid.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo, useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Clock, AlertCircle, FileText } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { ActivityItem } from '../../../lib/api/operations.js';
import { SeverityBadge } from '../SeverityBadge.js';
import { relativeTime, humanizeEventType } from '../utils.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { ThreadApprovalActions } from './ThreadApprovalActions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREADS_PAGE_SIZE = 40;
const EVENTS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Thread {
  correlationId: string;
  projectId: string;
  projectName: string;
  severity: string;
  status: string;
  hasPendingApproval: boolean;
  lastEventTime: string;
  eventCount: number;
  events: ActivityItem[];
  isExpanded: boolean;
  triggerType?: string;
  title?: string;
}

export interface MainFeedGridProps {
  activities: ActivityItem[];
  onThreadSelect?: (correlationId: string) => void;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {
  const threadMap = new Map<string, ActivityItem[]>();
  const orderKeys: string[] = [];

  for (const item of items) {
    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    const key = item.correlationId || `${item.projectId}::${item.type}::${tsBucket}`;

    const existing = threadMap.get(key);
    if (existing) {
      existing.push(item);
    } else {
      threadMap.set(key, [item]);
      orderKeys.push(key);
    }
  }

  const threads: Omit<Thread, 'isExpanded'>[] = [];

  for (const key of orderKeys) {
    const events = threadMap.get(key)!;
    // Sort events within thread: newest first
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const head = events[0];
    const hasPendingApproval = events.some((e) => e.type === 'approval' && e.status === 'pending');

    // Severity: pick the most severe across all events in the thread
    const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    let maxSeverity = head.severity;
    for (const e of events) {
      if ((severityRank[e.severity] ?? 0) > (severityRank[maxSeverity] ?? 0)) {
        maxSeverity = e.severity;
      }
    }

    // Try to find a meaningful title
    const activeIncident = events.find((e) => e.type === 'incident');
    const title = activeIncident?.title || head.title || humanizeEventType(head.type, (k) => k);
    const triggerType = activeIncident?.triggerType;

    threads.push({
      correlationId: key,
      projectId: head.projectId,
      projectName: head.projectName,
      severity: maxSeverity,
      status: head.status,
      hasPendingApproval,
      lastEventTime: head.timestamp,
      eventCount: events.length,
      events,
      title,
      triggerType,
    });
  }

  // Sort threads: newest first by most recent event
  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());

  return threads;
}

// ---------------------------------------------------------------------------
// Layout Grid Definitions
// ---------------------------------------------------------------------------
// Density approach: standard table rows using CSS grid.
const ROW_GRID_CLASSES =
  'grid grid-cols-[24px_minmax(120px,1.5fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event: ActivityItem }) {
  const { t, language } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
  const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;

  const titleText =
    event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);

  return (
    <div className="flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors">
      <div className={cn(ROW_GRID_CLASSES, 'py-1.5 text-[11px]')}>
        {/* Empty left gap for alignment with parent chevron */}
        <div className="flex justify-end">
          <div
            className={cn('h-1.5 w-1.5 rounded-full mr-2', isAiEvent ? 'bg-agent' : 'bg-muted-ol')}
          />
        </div>

        {/* Time */}
        <div className="text-muted-ol whitespace-nowrap">
          {new Date(event.timestamp).toLocaleTimeString(language, {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>

        {/* Event Name & Expand Toggle */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
            title={titleText}
          >
            {titleText}
          </span>
          {hasDetails && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(!detailsOpen);
              }}
              className="shrink-0 inline-flex items-center gap-1 bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] rounded px-1.5 py-0.5 text-[9px] text-muted-ol font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-agent"
            >
              <FileText className="w-3 h-3" />
              {detailsOpen ? t('opsV2.timeline.detailsHide') : t('opsV2.timeline.detailsShow')}
            </button>
          )}
        </div>

        {/* Severity */}
        <div>
          <SeverityBadge severity={event.severity} />
        </div>

        {/* Status */}
        <div className="truncate text-muted-ol">{event.status.replace(/-/g, ' ')}</div>

        {/* Actions empty cell */}
        <div />

        {/* Metadata */}
        <div className="text-muted-ol text-[10px] truncate">
          {event.aiMetadata?.model && <span>{event.aiMetadata.model} </span>}
          {event.aiMetadata?.durationMs && (
            <span>({(event.aiMetadata.durationMs / 1000).toFixed(1)}s)</span>
          )}
        </div>
      </div>

      {/* Inline Details Expansion */}
      {detailsOpen && hasDetails && (
        <div className="pl-[165px] pr-4 pb-2 pt-1 animate-in fade-in slide-in-from-top-1">
          {event.aiMetadata?.diagnosisSummary && (
            <div className="mt-0.5 mb-1.5 p-2 bg-agent/5 border border-agent/20 rounded-md">
              <p className="text-[10px] font-semibold text-agent mb-1 uppercase tracking-wider">
                {t('ops.aiDiagnosisSummary')}
              </p>
              <p className="text-[11px] text-primary-ol leading-relaxed">
                {event.aiMetadata.diagnosisSummary}
              </p>
            </div>
          )}

          {event.description && (
            <div className="w-full overflow-hidden mt-0.5">
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[11px] text-secondary-ol prose-p:text-[11px] prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-xs prose-headings:font-semibold prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-[11px] prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});


exec
/bin/bash -lc "sed -n '1,180p' src/web/server.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { createAdaptorServer } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, unlinkSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

import { VERSION } from '../version.js';
import { createApiRoutes } from './api/routes.js';
import { createWebhookRoutes } from './api/webhook-routes.js';
import { createDomainRoutes } from './api/domain-routes.js';
import { createSetupRoutes } from './api/setup-routes.js';
import { createTerminalRoutes } from './api/terminal-routes.js';
import { createChatRoutes } from './api/chat-routes.js';
import { createLlmRoutes } from './api/llm-routes.js';
import { createAuthRoutes } from './api/auth-routes.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { AuthService } from '../auth/auth-service.js';
import { createMcpHttpRoutes } from '../mcp/server.js';
import { SlackChannel, createSlackWebhookHandler } from '../channels/slack.js';
import { DiscordChannel, createDiscordInteractionHandler } from '../channels/discord.js';
import { TelegramChannel, createTelegramWebhookHandler } from '../channels/telegram.js';
import { EmailChannel } from '../channels/email.js';
import type { AppContext } from '../app.js';
import { OpsAgent } from '../monitor/ops-agent.js';
import type { NodeWebSocket } from '@hono/node-ws';
import { getLlmRuntimeStatus } from './api/setup/shared.js';
const log = createModuleLogger('web');

import { createModuleLogger } from '../lib/logger.js';

// --- Uptime Tracking ---

let serverStartTime = Date.now();

/**
 * Format uptime in human-readable form (e.g., "14d 3h", "2h 45m", "5m 12s").
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (mins > 0) parts.push(`${String(mins)}m`);
  if (parts.length === 0) parts.push(`${String(secs)}s`);

  return parts.join(' ');
}

/** Get seconds since server start. */
export function getServerUptime(): number {
  return Math.floor((Date.now() - serverStartTime) / 1000);
}

export interface ServerOptions {
  port: number;
  host: string;
}

/**
 * Create and start the OpenLander headless API server.
 *
 * Serves:
 * - REST API at /api/*
 * - Health check at /health
 * - Webhook endpoints at /webhooks/*
 * - OAuth routes at /auth/*
 */
// --- Shared Hono app builder ---

/**
 * Build the Hono application with all routes and middleware.
 * Shared by both TCP createServer and Unix socket startDaemon.
 */
interface CreateAppOptions {
  app?: Hono;
  upgradeWebSocket?: UpgradeWebSocketHandler;
}

export type UpgradeWebSocketHandler = NodeWebSocket['upgradeWebSocket'];

function createApp(
  ctx: AppContext,
  options: CreateAppOptions = {},
): { app: Hono; mcpRoutes: ReturnType<typeof createMcpHttpRoutes> } {
  const app = options.app ?? new Hono();

  app.use('*', logger());
  app.use(
    '/api/*',
    cors({
      origin: ctx.config.server.corsOrigin ?? '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );

  const authService = new AuthService(ctx.db);
  app.use('*', createAuthMiddleware(authService));

  // Health check (enhanced with uptime)
  app.get('/health', async (c) => {
    const uptimeSeconds = getServerUptime();
    const uptime = formatUptime(uptimeSeconds);

    let dockerContainers = 0;
    try {
      const containers = await ctx.docker.getClient().listContainers({
        filters: { label: ['openlander.managed=true'] },
      });
      dockerContainers = containers.length;
    } catch (err) {
      log.debug({ err }, 'Docker container list failed during health check');
      // Docker not accessible
    }

    const llmRuntime = getLlmRuntimeStatus(ctx.config, ctx.llmVerified);
    const llmStatus = llmRuntime.state;

    return c.json({
      status: 'ok',
      version: VERSION,
      llmConfigured: llmRuntime.configured,
      llmStatus,
      timestamp: new Date().toISOString(),
      uptime,
      dockerContainers,
      environments: ['production', 'development'] as const,
    });
  });

  const authRoutes = createAuthRoutes(authService, ctx);
  app.route('/api', authRoutes);

  const apiRoutes = createApiRoutes(ctx);
  app.route('/api', apiRoutes);

  const setupRoutes = createSetupRoutes(ctx);
  app.route('/api', setupRoutes);

  // v0.2: Webhook auto-redeploy routes
  const webhookRoutes = createWebhookRoutes(ctx);
  app.route('/api', webhookRoutes);

  const terminalRoutes = createTerminalRoutes(ctx, options.upgradeWebSocket);
  app.route('/api', terminalRoutes);

  // v0.2: Domain management routes
  const domainRoutes = createDomainRoutes(ctx);
  app.route('/api', domainRoutes);

  const chatRoutes = createChatRoutes(ctx);
  app.route('/api', chatRoutes);

  const llmRoutes = createLlmRoutes(ctx);
  app.route('/api', llmRoutes);

  const mcpRoutes = createMcpHttpRoutes(ctx);
  app.route('/mcp', mcpRoutes);

  // v0.4: Channel webhook routes
  if (ctx.config.channels.slack.enabled) {
    const slackChannel = new SlackChannel({
      token: ctx.config.channels.slack.token,
      signingSecret: ctx.config.channels.slack.signingSecret,
      channelManager: ctx.channelManager,
      questionBridge: ctx.questionBridge,
    });
    ctx.channelManager.register('slack', slackChannel);
    app.post('/webhooks/slack', createSlackWebhookHandler(slackChannel));
  }

  if (ctx.config.channels.discord.enabled) {
    const discordChannel = new DiscordChannel({
      applicationId: ctx.config.channels.discord.applicationId,
      publicKey: ctx.config.channels.discord.publicKey,

codex
The contract itself mostly lines up, but the stream now advances by plain timestamp rather than a stable cursor. I’m running the relevant tests and checking whether that introduces dropped-event windows or ordering bugs, because that’s the main place this change can still be wrong even if the types compile.
exec
/bin/bash -lc "sed -n '1,260p' test/web/api/ops-incident-routes.test.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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
      getActionRunsByApprovalStatus: () => [],
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
        getActionRunsByApprovalStatus: () => [],
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


exec
/bin/bash -lc 'npm test -- test/web/api/ops-incident-routes.test.ts test/web/api/ops-routes.test.ts test/web/api/activity-routes.test.ts' in /home/lee/OpenLander
 succeeded in 697ms:

 RUN  v4.1.0 /home/lee/OpenLander


 Test Files  3 passed (3)
      Tests  87 passed (87)
   Start at  21:00:57
   Duration  480ms (transform 190ms, setup 57ms, import 431ms, tests 186ms, environment 0ms)


codex
The targeted tests pass, but they don’t exercise the new `/api/ops/activity?follow=true` path. I’ve isolated two backend feed correctness risks there: one in the resume cursor and one in how action runs are sampled across projects before filtering/sorting.
exec
/bin/bash -lc "nl -ba src/web/api/ops-routes.ts | sed -n '390,560p'" in /home/lee/OpenLander
 succeeded in 0ms:
   390	    return c.json({ deleted: true });
   391	  });
   392
   393	  // --- Unified Activity Feed ---
   394
   395	  api.get('/activity', (c) => {
   396	    const isFollow = c.req.query('follow') === 'true';
   397
   398	    const fetchActivities = (sinceParam?: string) => {
   399	      const projectId = c.req.query('projectId');
   400	      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
   401	      const severity = c.req.query('severity');
   402	      const limitParam = c.req.query('limit');
   403	      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
   404	      const before = c.req.query('before');
   405	      const since = sinceParam || c.req.query('since');
   406
   407	      const projects = ctx.db.listProjects();
   408	      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
   409	      const activities: ActivityItem[] = [];
   410
   411	      // Incidents
   412	      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
   413	        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
   414	        const incidents = projectId
   415	          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
   416	          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
   417	        const eventsByIncidentId = groupEventsByIncidentId(
   418	          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
   419	        );
   420
   421	        for (const inc of incidents) {
   422	          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];
   423	          const trigger = extractIncidentTrigger(inc, incidentEvents);
   424
   425	          if (types.length === 0 || types.includes('incident')) {
   426	            activities.push({
   427	              id: inc.id,
   428	              timestamp: new Date(inc.created_at).toISOString(),
   429	              type: 'incident',
   430	              severity: inc.severity,
   431	              projectId: inc.project_id,
   432	              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
   433	              title: inc.root_cause ?? 'Incident detected',
   434	              description: inc.diagnosis ?? '',
   435	              status: inc.status === 'resolved' ? 'resolved' : 'active',
   436	              incidentId: inc.id,
   437	              triggerType: trigger.triggerType,
   438	              triggerDetails: trigger.triggerDetails,
   439	            });
   440	          }
   441	          if (types.length === 0 || types.includes('alert')) {
   442	            for (const ev of incidentEvents.filter(
   443	              (e) => (e.event_type as string) === 'cascade_detected',
   444	            )) {
   445	              let cascadeGroup: string[] = [];
   446	              try {
   447	                cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
   448	              } catch {
   449	                // ignore parsing error
   450	              }
   451	              activities.push({
   452	                id: ev.id,
   453	                timestamp: new Date(ev.created_at).toISOString(),
   454	                type: 'alert',
   455	                severity: 'warning',
   456	                projectId: inc.project_id,
   457	                projectName: projectMap.get(inc.project_id) ?? inc.project_id,
   458	                title: 'Cascade detected',
   459	                description: ev.description,
   460	                status: 'active',
   461	                incidentId: inc.id,
   462	                cascadeGroup,
   463	              });
   464	            }
   465	          }
   466	        }
   467	      }
   468
   469	      // Action runs
   470	      if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
   471	        const candidateRuns = projectId
   472	          ? ctx.db.getActionRunsByProject(projectId, 100)
   473	          : projects.flatMap((project) => ctx.db.getActionRunsByProject(project.id, 20));
   474	        const runs = candidateRuns
   475	          .sort((a, b) => b.created_at.localeCompare(a.created_at))
   476	          .slice(0, 200);
   477	        for (const run of runs) {
   478	          if (
   479	            run.trigger_source !== 'auto_recovery' &&
   480	            (run.status as string) !== 'pending_approval'
   481	          )
   482	            continue;
   483	          const itemType: ActivityItem['type'] =
   484	            (run.status as string) === 'pending_approval' ? 'approval' : 'recovery';
   485	          if (types.length > 0 && !types.includes(itemType)) continue;
   486	          activities.push({
   487	            id: run.id,
   488	            timestamp: run.created_at,
   489	            type: itemType,
   490	            severity: run.status === 'failed' ? 'warning' : 'info',
   491	            projectId: run.project_id,
   492	            projectName: projectMap.get(run.project_id) ?? run.project_id,
   493	            title:
   494	              itemType === 'approval'
   495	                ? `Approval required: ${run.approval_tool ?? 'action'}`
   496	                : `Auto-recovery ${run.status}`,
   497	            description: run.error_message ?? run.plan ?? '',
   498	            status:
   499	              run.status === 'succeeded'
   500	                ? 'resolved'
   501	                : run.status === 'failed'
   502	                  ? 'failed'
   503	                  : (run.status as string) === 'pending_approval'
   504	                    ? 'pending'
   505	                    : 'active',
   506	            actionRunId: run.id,
   507	            correlationId: run.correlation_id ?? undefined,
   508	          });
   509	        }
   510	      }
   511
   512	      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
   513	      if (severity) sorted = sorted.filter((a) => a.severity === severity);
   514	      if (before) sorted = sorted.filter((a) => a.timestamp < before);
   515	      if (since) sorted = sorted.filter((a) => a.timestamp > since);
   516	      const page = sorted.slice(0, limit);
   517	      return {
   518	        activities: page,
   519	        nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
   520	      };
   521	    };
   522
   523	    if (isFollow) {
   524	      return stream(c, async (s) => {
   525	        c.header('Content-Type', 'application/x-ndjson');
   526	        let lastReportedTime = c.req.query('since') || new Date(Date.now() - 60000).toISOString();
   527	        let flushInProgress = false;
   528
   529	        const sendUpdates = async (): Promise<void> => {
   530	          if (flushInProgress) return;
   531	          flushInProgress = true;
   532	          try {
   533	            const page = fetchActivities(lastReportedTime);
   534	            if (page.activities.length > 0) {
   535	              const forward = [...page.activities].reverse();
   536	              for (const act of forward) {
   537	                await s.write(JSON.stringify(act) + '\n');
   538	              }
   539	              const lastActivity = forward[forward.length - 1];
   540	              if (lastActivity) {
   541	                lastReportedTime = lastActivity.timestamp;
   542	              }
   543	            }
   544	          } catch (err) {
   545	            console.error('Unified feed streaming error:', err);
   546	          } finally {
   547	            flushInProgress = false;
   548	          }
   549	        };
   550
   551	        // Initial backfill
   552	        await sendUpdates();
   553	        await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   554
   555	        const interval = setInterval(() => {
   556	          void sendUpdates();
   557	        }, 2000);
   558
   559	        await new Promise<void>((resolve) => {
   560	          s.onAbort(() => {

exec
/bin/bash -lc "nl -ba web/src/hooks/use-ops-center-data.ts | sed -n '80,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
    80	  const connect = useCallback(() => {
    81	    if (cancelledRef.current) return;
    82
    83	    abortRef.current?.abort();
    84	    const controller = new AbortController();
    85	    abortRef.current = controller;
    86
    87	    void (async () => {
    88	      try {
    89	        const params = new URLSearchParams({ follow: 'true' });
    90	        if (lastEventTimestampRef.current) {
    91	          params.set('since', lastEventTimestampRef.current);
    92	        }
    93
    94	        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
    95	          signal: controller.signal,
    96	          credentials: 'include',
    97	        });
    98
    99	        if (!resp.ok || !resp.body) {
   100	          if (!cancelledRef.current) {
   101	            setError(`Stream error: ${resp.status}`);
   102	          }
   103	          return;
   104	        }
   105
   106	        if (!cancelledRef.current) {
   107	          setIsConnected(true);
   108	          setIsReconnecting(false);
   109	          retriesRef.current = 0; // reset on successful connection
   110	        }
   111
   112	        const reader = resp.body.getReader();
   113	        const decoder = new TextDecoder();
   114	        let buf = '';
   115	        let inBackfill = false;
   116	        let backfillBatch: ActivityItem[] = [];
   117
   118	        for (;;) {
   119	          const { value, done } = await reader.read();
   120	          if (done || cancelledRef.current) break;
   121
   122	          buf += decoder.decode(value, { stream: true });
   123	          const lines = buf.split('\n');
   124	          buf = lines.pop() ?? '';
   125
   126	          for (const line of lines) {
   127	            const trimmed = line.trim();
   128	            if (!trimmed) continue;
   129
   130	            try {
   131	              const parsed = JSON.parse(trimmed) as Record<string, unknown>;
   132
   133	              // Handle backfill-complete sentinel
   134	              if (parsed.type === 'backfill-complete') {
   135	                if (backfillBatch.length > 0) {
   136	                  // Batch-apply all backfill items in one state update
   137	                  const batch = backfillBatch;
   138	                  backfillBatch = [];
   139	                  setActivities((prev) => {
   140	                    const merged = [...batch, ...prev];
   141	                    // Deduplicate already handled per-item, just enforce ceiling
   142	                    return merged.slice(0, BUFFER_MAX);
   143	                  });
   144	                }
   145	                inBackfill = false;
   146	                continue;
   147	              }
   148
   149	              const item = parsed as unknown as ActivityItem;
   150	              if (!item.id) continue;
   151
   152	              // Track last event timestamp for gap recovery
   153	              if (item.timestamp) {
   154	                lastEventTimestampRef.current = item.timestamp;
   155	              }
   156
   157	              if (!dedup(item.id)) continue;
   158
   159	              if (parsed.backfill === true) {
   160	                inBackfill = true;
   161	                backfillBatch.push(item);
   162	              } else if (inBackfill) {
   163	                // Non-backfill item arriving during backfill — buffer it too
   164	                backfillBatch.push(item);
   165	              } else {
   166	                // Incremental live update
   167	                setActivities((prev) => [item, ...prev].slice(0, BUFFER_MAX));
   168	              }
   169	            } catch {
   170	              // Ignore malformed NDJSON lines
   171	            }
   172	          }
   173	        }
   174
   175	        // Stream ended normally — attempt reconnect if still mounted
   176	        if (!cancelledRef.current && retriesRef.current < MAX_RETRIES) {
   177	          retriesRef.current += 1;
   178	          setIsConnected(false);
   179	          setIsReconnecting(true);
   180	          const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   181	          setTimeout(() => {
   182	            if (!cancelledRef.current) {
   183	              setIsReconnecting(false);
   184	              connect();
   185	            }
   186	          }, delay);
   187	        }
   188	      } catch (err) {
   189	        if (controller.signal.aborted) return;
   190
   191	        if (!cancelledRef.current) {
   192	          const message = err instanceof Error ? err.message : 'Stream failed';
   193	          setError(message);
   194	          setIsConnected(false);
   195
   196	          // Auto-retry with exponential backoff
   197	          if (retriesRef.current < MAX_RETRIES) {
   198	            retriesRef.current += 1;
   199	            setIsReconnecting(true);
   200	            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   201	            setTimeout(() => {
   202	              if (!cancelledRef.current) {
   203	                setIsReconnecting(false);
   204	                connect();
   205	              }
   206	            }, delay);
   207	          }
   208	        }
   209	      }
   210	    })();
   211	  }, [dedup]);
   212
   213	  // ---------------------------------------------------------------------------
   214	  // Initial parallel REST snapshot + SSE connect
   215	  // ---------------------------------------------------------------------------
   216	  useEffect(() => {
   217	    cancelledRef.current = false;
   218	    setIsLoading(true);
   219
   220	    // Parallel REST snapshot
   221	    Promise.all([
   222	      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
   223	        if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
   224	        return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
   225	      }),
   226	      fetchOpsIncidents(undefined, 'open'),
   227	      fetchAllCircuitBreakers(),
   228	      fetchPendingApprovals().catch(() => [] as ActionRun[]),
   229	      fetchWithAuth('/api/ops/agent/active')
   230	        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
   231	        .catch(() => ({ isActive: false }) as AgentActiveState),
   232	    ])
   233	      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
   234	        if (cancelledRef.current) return;
   235
   236	        const items = activityData.activities.slice(0, BUFFER_MAX);
   237	        // Seed dedup set with initial snapshot IDs
   238	        for (const item of items) {
   239	          dedupSetRef.current.add(item.id);
   240	        }
   241	        // Track last event timestamp for SSE gap recovery
   242	        if (items.length > 0) {
   243	          lastEventTimestampRef.current = items[0].timestamp;
   244	        }
   245
   246	        setActivities(items);
   247	        setIncidents(incidentData.incidents ?? []);
   248	        setCircuitBreakers(cbData.breakers ?? []);
   249	        setApprovals(approvalData);
   250	        setAgentStatus(agentData as AgentActiveState);
   251	        setError(null);
   252	      })
   253	      .catch((err: unknown) => {
   254	        if (!cancelledRef.current) {
   255	          setError(err instanceof Error ? err.message : String(err));
   256	        }
   257	      })
   258	      .finally(() => {
   259	        if (!cancelledRef.current) setIsLoading(false);
   260

exec
/bin/bash -lc "nl -ba src/web/api/routes.ts | sed -n '300,340p'" in /home/lee/OpenLander
 succeeded in 0ms:
   300	              await s.write(JSON.stringify({ ...event, backfill: true }) + '\n');
   301	            }
   302
   303	            // Step 4: Send sentinel
   304	            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   305	          } catch (err) {
   306	            log.error({ err }, 'Failed to query activity_log for backfill');
   307	            // Send sentinel even on error so client knows backfill phase is done
   308	            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   309	          }
   310
   311	          // Step 5: Flush buffered live events that arrived during backfill
   312	          backfillComplete = true;
   313	          for (const buffered of liveBuffer) {
   314	            await s.write(JSON.stringify(buffered) + '\n');
   315	          }
   316	          liveBuffer.length = 0;
   317	        }
   318
   319	        // Step 6: From here, live events are written directly by the listener above
   320	        await new Promise<void>((resolve) => {
   321	          s.onAbort(() => {
   322	            resolve();
   323	          });
   324	        });
   325	      });
   326	    }
   327
   328	    // --- REST mode: Query activity_log table ---
   329	    let activities: ActivityEvent[];
   330
   331	    if (sinceId) {
   332	      // Cursor-based pagination: return events after the given ULID
   333	      const rows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
   334	      activities = resolveActivityRows(rows);
   335	    } else {
   336	      // No cursor: return most recent events
   337	      const rows = ctx.db.findActivityLogRecent(limit, dbFilters);
   338	      activities = resolveActivityRows(rows);
   339	    }
   340

exec
/bin/bash -lc "nl -ba web/src/lib/api/operations.ts | sed -n '160,220p'" in /home/lee/OpenLander
 succeeded in 0ms:
   160	  projectId: string;
   161	  projectName: string;
   162	  title: string;
   163	  description: string;
   164	  status:
   165	    | 'active'
   166	    | 'resolved'
   167	    | 'pending'
   168	    | 'failed'
   169	    | 'ai-running'
   170	    | 'ai-completed'
   171	    | 'recovery-blocked'
   172	    | 'recovery-stopped'
   173	    | 'recovering';
   174	  incidentId?: string;
   175	  actionRunId?: string;
   176	  correlationId?: string;
   177	  cascadeGroup?: string[];
   178	  triggerType?: string;
   179	  triggerDetails?: string;
   180	  aiMetadata?: {
   181	    model: string;
   182	    tokensUsed?: number;
   183	    durationMs?: number;
   184	    diagnosisSummary?: string;
   185	  };
   186	}
   187
   188	export interface CircuitBreakerWithProject {
   189	  projectId: string;
   190	  projectName: string;
   191	  state: 'closed' | 'open' | 'half_open';
   192	  failureCount: number;
   193	  lastFailureAt: number | null;
   194	  openedAt: number | null;
   195	  resetAt: number | null;
   196	}
   197
   198	export interface DependencyNode {
   199	  id: string;
   200	  type: 'project' | 'service';
   201	  name: string;
   202	  status: string | null;
   203	}
   204
   205	export interface DependencyEdge {
   206	  source: string;
   207	  target: string;
   208	  dependencyType: string;
   209	}
   210
   211	export async function fetchActivityFeed(opts?: {
   212	  projectId?: string;
   213	  types?: string[];
   214	  severity?: string;
   215	  limit?: number;
   216	  before?: string;
   217	}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
   218	  const params = new URLSearchParams();
   219	  if (opts?.projectId) params.set('projectId', opts.projectId);
   220	  if (opts?.types?.length) params.set('types', opts.types.join(','));

codex
No `CRITICAL` findings.

`MAJOR` [src/web/api/ops-routes.ts:515](/home/lee/OpenLander/src/web/api/ops-routes.ts#L515), [src/web/api/ops-routes.ts:533](/home/lee/OpenLander/src/web/api/ops-routes.ts#L533), [src/web/api/ops-routes.ts:541](/home/lee/OpenLander/src/web/api/ops-routes.ts#L541), [web/src/hooks/use-ops-center-data.ts:90](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L90), [web/src/hooks/use-ops-center-data.ts:154](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L154), [web/src/hooks/use-ops-center-data.ts:243](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L243)
The new follow mode uses a plain timestamp cursor with `timestamp > since`, and the client now stores only `lastEventTimestamp`. That drops events in two real cases:
1. If multiple activities share the same timestamp, anything arriving after reconnect with the same timestamp as the saved cursor is skipped permanently.
2. If more than 100 activities arrive between polls/reconnects, `fetchActivities()` keeps only the newest 100, then advances the cursor to the newest timestamp in that page, so older unseen events from the same gap are lost permanently.
This is a feed correctness regression versus the old stable `/api/activity` ULID cursor model.

`MAJOR` [src/web/api/ops-routes.ts:471](/home/lee/OpenLander/src/web/api/ops-routes.ts#L471), [src/web/api/ops-routes.ts:475](/home/lee/OpenLander/src/web/api/ops-routes.ts#L475), [src/web/api/ops-routes.ts:479](/home/lee/OpenLander/src/web/api/ops-routes.ts#L479)
The non-project-scoped recovery/approval query is not actually “latest global activity”. It pulls only the latest 20 action runs per project, then sorts globally, then filters out non-`auto_recovery` runs. That means a noisy project can hide its own recent recovery events if they are pushed below the top 20 by unrelated manual runs, and the final feed can show older events from other projects instead of the true latest recoveries/approvals.

`MINOR` [web/src/hooks/use-ops-center-data.ts:133](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L133), [web/src/hooks/use-ops-center-data.ts:159](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L159), [src/web/api/ops-routes.ts:551](/home/lee/OpenLander/src/web/api/ops-routes.ts#L551), [src/web/api/routes.ts:300](/home/lee/OpenLander/src/web/api/routes.ts#L300)
The frontend still expects `backfill: true` markers to batch reconnect backfill, but `/api/ops/activity` never emits them. The old `/api/activity` stream did. This won’t corrupt data, but reconnect backfill is now applied item-by-item, causing unnecessary rerenders and making the hook’s `inBackfill` path effectively dead.

The [src/web/api/routes.ts:320](/home/lee/OpenLander/src/web/api/routes.ts#L320) change itself looks correct; I did not find a new issue there.

Validation: `npm test -- test/web/api/ops-incident-routes.test.ts test/web/api/ops-routes.test.ts test/web/api/activity-routes.test.ts` passed.
tokens used
55,700

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
