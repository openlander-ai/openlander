# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-09T04:39:32.758Z

## Original task

You are reviewing the BACKEND changes of the ops-center-v2 feature in OpenLander. Focus on: 1) src/db/repos/activity-log.repo.ts - ULID generation correctness, query patterns, index usage 2) src/monitor/activity-event-mapper.ts - event mapping extraction quality, type safety 3) src/monitor/activity-logger.ts - EventBus subscriber pattern, fire-and-forget correctness 4) src/web/api/routes.ts - /api/activity rewrite (REST + SSE backfill protocol with 5-step ordering) 5) src/db/schema.drizzle.ts and src/db/migration.ts - activity_log table and indexes 6) src/events/index.ts - correlationId additions to EventPayload types 7) src/pipeline/auto-recovery.ts and src/monitor/ops-recovery.ts - correlationId propagation 8) src/app.ts - ActivityLogger initialization, 30-day cleanup job, shutdown cleanup. Review for: correctness, race conditions, performance (SQLite write pressure from persistence subscriber), error handling, type safety. Report issues as CRITICAL/MAJOR/MINOR with file:line references.

## Final prompt

You are reviewing the BACKEND changes of the ops-center-v2 feature in OpenLander. Focus on: 1) src/db/repos/activity-log.repo.ts - ULID generation correctness, query patterns, index usage 2) src/monitor/activity-event-mapper.ts - event mapping extraction quality, type safety 3) src/monitor/activity-logger.ts - EventBus subscriber pattern, fire-and-forget correctness 4) src/web/api/routes.ts - /api/activity rewrite (REST + SSE backfill protocol with 5-step ordering) 5) src/db/schema.drizzle.ts and src/db/migration.ts - activity_log table and indexes 6) src/events/index.ts - correlationId additions to EventPayload types 7) src/pipeline/auto-recovery.ts and src/monitor/ops-recovery.ts - correlationId propagation 8) src/app.ts - ActivityLogger initialization, 30-day cleanup job, shutdown cleanup. Review for: correctness, race conditions, performance (SQLite write pressure from persistence subscriber), error handling, type safety. Report issues as CRITICAL/MAJOR/MINOR with file:line references.

## Raw output

```text
- `CRITICAL` Live `/api/activity` emits synthetic, non-persisted IDs instead of the `activity_log` ULIDs that the `since` cursor queries operate on. The SSE path builds a fresh `ActivityEvent` in-memory and writes that directly, while backfill/REST read from `activity_log` using `findActivityLogSinceFiltered(gt(id, since))`. That breaks the 5-step gap-recovery contract: a reconnecting client can hand back an ID that does not exist in the table, so backfill ordering/deduplication becomes unsound and events can be duplicated or skipped. Refs: [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L257), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L289), [activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L421), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L171)

- `MAJOR` The persistence subscriber is not actually fire-and-forget. `ActivityLogger` registers a synchronous handler, and `EventBus.emit()` executes non-Promise handlers inline. Each emitted event therefore blocks on a SQLite insert plus an immediate select-by-id readback. On noisy event streams this adds synchronous WAL write pressure and latency directly onto the producer path, contrary to the class comment. Refs: [activity-logger.ts](/home/lee/OpenLander/src/monitor/activity-logger.ts#L68), [events/index.ts](/home/lee/OpenLander/src/events/index.ts#L427), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L68), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L85)

- `MAJOR` Multi-type filtering is incorrect in both REST and SSE backfill. When `types` contains more than one value, the route applies no DB-level type filter, limits the raw query first, and only then filters in memory. That can return fewer than `limit` matching rows even when more qualifying events exist later in the table. Refs: [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L230), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L289), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L331)

- `MAJOR` Correlation threading is inconsistent across recovery flows. Deploy auto-recovery creates its `action_run` without `correlationId`, while ops recovery does store one; later, approval-resolution events are emitted without `correlationId` even though the payload type now supports it. That means approval events for deploy auto-recovery cannot be reliably grouped with the surrounding recovery thread or fetched via `correlationId` filters. Refs: [auto-recovery.ts](/home/lee/OpenLander/src/pipeline/auto-recovery.ts#L373), [ops-recovery.ts](/home/lee/OpenLander/src/monitor/ops-recovery.ts#L115), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L385), [events/index.ts](/home/lee/OpenLander/src/events/index.ts#L345), [action-run.repo.ts](/home/lee/OpenLander/src/db/repos/action-run.repo.ts#L16)

- `MAJOR` The hot read paths do not line up with the new indexes. The table is indexed on `created_at`, `(project_id, created_at)`, and `(activity_type, created_at)`, but the route/repo query the feed by `id` for ordering/cursoring and optionally by `severity`/`correlation_id`. As written, the main `/api/activity` queries cannot use the composite `*_created` indexes for their sort order, and filtered recent queries will degrade as the 30-day table grows. Refs: [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L133), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L171), [schema.drizzle.ts](/home/lee/OpenLander/src/db/schema.drizzle.ts#L617), [migration.ts](/home/lee/OpenLander/src/db/migration.ts#L643)

- `MAJOR` Activity-log retention cleanup has no error boundary. `runActivityLogCleanup()` is called during startup and again from `setInterval()` without any `try/catch`. A DB failure here can abort app initialization or crash the process from the timer callback. Refs: [app.ts](/home/lee/OpenLander/src/app.ts#L586), [app.ts](/home/lee/OpenLander/src/app.ts#L592)

- `MINOR` The custom ULID implementation is hand-rolled and only monotonic for the “same millisecond, clock never goes backwards” case. Because feed pagination depends on lexicographic ID monotonicity, this is weaker than using a vetted monotonic ULID implementation and is vulnerable to clock skew/regression edge cases. Refs: [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L6)


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
session id: 019d7087-3ddb-73f1-a0f8-cb757fd5ea41
--------
user
You are reviewing the BACKEND changes of the ops-center-v2 feature in OpenLander. Focus on: 1) src/db/repos/activity-log.repo.ts - ULID generation correctness, query patterns, index usage 2) src/monitor/activity-event-mapper.ts - event mapping extraction quality, type safety 3) src/monitor/activity-logger.ts - EventBus subscriber pattern, fire-and-forget correctness 4) src/web/api/routes.ts - /api/activity rewrite (REST + SSE backfill protocol with 5-step ordering) 5) src/db/schema.drizzle.ts and src/db/migration.ts - activity_log table and indexes 6) src/events/index.ts - correlationId additions to EventPayload types 7) src/pipeline/auto-recovery.ts and src/monitor/ops-recovery.ts - correlationId propagation 8) src/app.ts - ActivityLogger initialization, 30-day cleanup job, shutdown cleanup. Review for: correctness, race conditions, performance (SQLite write pressure from persistence subscriber), error handling, type safety. Report issues as CRITICAL/MAJOR/MINOR with file:line references.
codex
Reviewing the backend changes around ops-center-v2. I’m pulling the touched files and diff context first, then I’ll check the event flow end-to-end from schema and repo through EventBus, logger, API, and recovery correlation propagation.
exec
/bin/bash -lc "nl -ba src/db/repos/activity-log.repo.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { and, asc, between, desc, eq, gt, lt } from 'drizzle-orm';
     2	import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
     3	import { activityLog } from '../schema.drizzle.js';
     4	import type { ActivityLogRow } from '../types.js';
     5
     6	// ── Inline ULID generator (Crockford Base32, 26 chars, monotonic) ──
     7	const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
     8
     9	let lastTime = 0;
    10	let lastRandom: number[] = [];
    11
    12	function ulid(): string {
    13	  const now = Date.now();
    14	  // 10-char timestamp (ms since epoch, Crockford Base32, big-endian)
    15	  let ts = now;
    16	  const timePart = new Array<string>(10);
    17	  for (let i = 9; i >= 0; i--) {
    18	    timePart[i] = CROCKFORD[ts & 0x1f] ?? '0';
    19	    ts = Math.floor(ts / 32);
    20	  }
    21
    22	  // 16-char random component — monotonic within same millisecond
    23	  const randPart = new Array<string>(16);
    24	  if (now === lastTime && lastRandom.length === 16) {
    25	    // Increment the previous random part by 1 (big-endian carry)
    26	    const prev = [...lastRandom];
    27	    for (let i = 15; i >= 0; i--) {
    28	      prev[i] = ((prev[i] ?? 0) + 1) % 32;
    29	      if (prev[i] !== 0) break; // no carry needed
    30	    }
    31	    lastRandom = prev;
    32	  } else {
    33	    lastTime = now;
    34	    lastRandom = [];
    35	    for (let i = 0; i < 16; i++) {
    36	      lastRandom.push(Math.floor(Math.random() * 32));
    37	    }
    38	  }
    39	  for (let i = 0; i < 16; i++) {
    40	    randPart[i] = CROCKFORD[lastRandom[i] ?? 0] ?? '0';
    41	  }
    42	  return timePart.join('') + randPart.join('');
    43	}
    44
    45	export class ActivityLogRepo {
    46	  constructor(
    47	    private readonly db: DrizzleClient,
    48	    private readonly sqlite: SqliteDatabase,
    49	  ) {
    50	    void this.sqlite;
    51	  }
    52
    53	  insert(entry: {
    54	    event_type: string;
    55	    activity_type: string;
    56	    severity: string;
    57	    project_id: string;
    58	    correlation_id?: string | null;
    59	    title: string;
    60	    description: string;
    61	    status: string;
    62	    metadata?: string;
    63	    created_at?: string;
    64	  }): ActivityLogRow {
    65	    const id = ulid();
    66	    const now = entry.created_at ?? new Date().toISOString();
    67
    68	    this.db
    69	      .insert(activityLog)
    70	      .values({
    71	        id,
    72	        event_type: entry.event_type,
    73	        activity_type: entry.activity_type,
    74	        severity: entry.severity,
    75	        project_id: entry.project_id,
    76	        correlation_id: entry.correlation_id ?? null,
    77	        title: entry.title,
    78	        description: entry.description,
    79	        status: entry.status,
    80	        metadata: entry.metadata ?? '{}',
    81	        created_at: now,
    82	      })
    83	      .run();
    84
    85	    const created = this.db
    86	      .select()
    87	      .from(activityLog)
    88	      .where(eq(activityLog.id, id))
    89	      .get() as ActivityLogRow | undefined;
    90
    91	    if (!created) throw new Error(`Failed to create activity log entry ${id}`);
    92	    return created;
    93	  }
    94
    95	  findSince(lastUlid: string, limit = 50): ActivityLogRow[] {
    96	    return this.db
    97	      .select()
    98	      .from(activityLog)
    99	      .where(gt(activityLog.id, lastUlid))
   100	      .orderBy(asc(activityLog.id))
   101	      .limit(limit)
   102	      .all() as ActivityLogRow[];
   103	  }
   104
   105	  findByDateRange(
   106	    from: string,
   107	    to: string,
   108	    filters?: { project_id?: string; activity_type?: string },
   109	    cursor?: string,
   110	    limit = 50,
   111	  ): ActivityLogRow[] {
   112	    const conditions = [between(activityLog.created_at, from, to)];
   113
   114	    if (filters?.project_id) {
   115	      conditions.push(eq(activityLog.project_id, filters.project_id));
   116	    }
   117	    if (filters?.activity_type) {
   118	      conditions.push(eq(activityLog.activity_type, filters.activity_type));
   119	    }
   120	    if (cursor) {
   121	      conditions.push(gt(activityLog.id, cursor));
   122	    }
   123
   124	    return this.db
   125	      .select()
   126	      .from(activityLog)
   127	      .where(and(...conditions))
   128	      .orderBy(asc(activityLog.id))
   129	      .limit(limit)
   130	      .all() as ActivityLogRow[];
   131	  }
   132
   133	  /** Find recent activity log entries with optional filters (newest first). */
   134	  findRecent(
   135	    limit = 50,
   136	    filters?: {
   137	      project_id?: string;
   138	      activity_type?: string;
   139	      severity?: string;
   140	      correlation_id?: string;
   141	    },
   142	  ): ActivityLogRow[] {
   143	    const conditions = [];
   144	    if (filters?.project_id) {
   145	      conditions.push(eq(activityLog.project_id, filters.project_id));
   146	    }
   147	    if (filters?.activity_type) {
   148	      conditions.push(eq(activityLog.activity_type, filters.activity_type));
   149	    }
   150	    if (filters?.severity) {
   151	      conditions.push(eq(activityLog.severity, filters.severity));
   152	    }
   153	    if (filters?.correlation_id) {
   154	      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
   155	    }
   156
   157	    const query =
   158	      conditions.length > 0
   159	        ? this.db
   160	            .select()
   161	            .from(activityLog)
   162	            .where(and(...conditions))
   163	            .orderBy(desc(activityLog.id))
   164	            .limit(limit)
   165	        : this.db.select().from(activityLog).orderBy(desc(activityLog.id)).limit(limit);
   166
   167	    return (query.all() as ActivityLogRow[]).reverse();
   168	  }
   169
   170	  /** Find entries since a ULID cursor with optional filters (ascending order). */
   171	  findSinceFiltered(
   172	    lastUlid: string,
   173	    limit = 50,
   174	    filters?: {
   175	      project_id?: string;
   176	      activity_type?: string;
   177	      severity?: string;
   178	      correlation_id?: string;
   179	    },
   180	  ): ActivityLogRow[] {
   181	    const conditions = [gt(activityLog.id, lastUlid)];
   182	    if (filters?.project_id) {
   183	      conditions.push(eq(activityLog.project_id, filters.project_id));
   184	    }
   185	    if (filters?.activity_type) {
   186	      conditions.push(eq(activityLog.activity_type, filters.activity_type));
   187	    }
   188	    if (filters?.severity) {
   189	      conditions.push(eq(activityLog.severity, filters.severity));
   190	    }
   191	    if (filters?.correlation_id) {
   192	      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
   193	    }
   194
   195	    return this.db
   196	      .select()
   197	      .from(activityLog)
   198	      .where(and(...conditions))
   199	      .orderBy(asc(activityLog.id))
   200	      .limit(limit)
   201	      .all() as ActivityLogRow[];
   202	  }
   203
   204	  deleteOlderThan(isoDate: string): number {
   205	    const result = this.db
   206	      .delete(activityLog)
   207	      .where(lt(activityLog.created_at, isoDate))
   208	      .run();
   209	    return (result as { changes: number }).changes;
   210	  }
   211	}

exec
/bin/bash -lc 'git diff -- src/db/repos/activity-log.repo.ts src/monitor/activity-event-mapper.ts src/monitor/activity-logger.ts src/web/api/routes.ts src/db/schema.drizzle.ts src/db/migration.ts src/events/index.ts src/pipeline/auto-recovery.ts src/monitor/ops-recovery.ts src/app.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/app.ts b/src/app.ts
index 685fa7d..a6c0a1f 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -28,6 +28,7 @@ import {
   getPostmortemInstance,
 } from './monitor/postmortem.js';
 import { RollbackWatcher } from './monitor/rollback-watcher.js';
+import { ActivityLogger } from './monitor/activity-logger.js';
 import { McpClientManager } from './mcp/client-manager.js';
 import { PlanEngine } from './pipeline/deploy-plan/engine.js';
 import { RecoveryCoordinator } from './monitor/recovery-coordinator.js';
@@ -49,8 +50,12 @@ const log = createModuleLogger('app');
 let activeIncidentReporter: IncidentReporter | null = null;
 let activeRollbackWatcher: RollbackWatcher | null = null;
 let activePostmortemAutomationStop: (() => void) | null = null;
+let activeActivityLogger: ActivityLogger | null = null;
+let activeActivityLogCleanupInterval: ReturnType<typeof setInterval> | null = null;

 const POSTMORTEM_STABILITY_WINDOW_MS = 5 * 60 * 1000;
+const ACTIVITY_LOG_TTL_DAYS = 30;
+const ACTIVITY_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
 const POSTMORTEM_CANCEL_EVENTS = [
   'recovery:failed',
   'recovery:exhausted',
@@ -578,6 +583,22 @@ export async function createAppContext(
   rollbackWatcher.start();
   activeRollbackWatcher = rollbackWatcher;

+  // Activity log cleanup: purge records older than ACTIVITY_LOG_TTL_DAYS on startup and every 24h
+  const runActivityLogCleanup = (): void => {
+    const cutoff = new Date(Date.now() - ACTIVITY_LOG_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
+    const deleted = db.deleteActivityLogOlderThan(cutoff);
+    log.info({ deleted }, 'Activity log cleanup completed');
+  };
+  runActivityLogCleanup();
+  if (activeActivityLogCleanupInterval) clearInterval(activeActivityLogCleanupInterval);
+  activeActivityLogCleanupInterval = setInterval(runActivityLogCleanup, ACTIVITY_LOG_CLEANUP_INTERVAL_MS);
+
+  // Activity event persistence subscriber
+  activeActivityLogger?.stop();
+  const activityLogger = new ActivityLogger(eventBus, db);
+  activityLogger.start();
+  activeActivityLogger = activityLogger;
+
   dockerEventListener.start();

   return ctx;
@@ -587,9 +608,15 @@ export async function createAppContext(
 export function shutdownAppContext(ctx: AppContext): void {
   activeIncidentReporter?.stop();
   activeRollbackWatcher?.stop();
+  activeActivityLogger?.stop();
   activePostmortemAutomationStop?.();
+  if (activeActivityLogCleanupInterval) {
+    clearInterval(activeActivityLogCleanupInterval);
+    activeActivityLogCleanupInterval = null;
+  }
   activeIncidentReporter = null;
   activeRollbackWatcher = null;
+  activeActivityLogger = null;
   activePostmortemAutomationStop = null;
   getPostmortemInstance()?.stop();
   ctx.dockerEventListener?.stop();
diff --git a/src/db/migration.ts b/src/db/migration.ts
index 9f9cfe8..00de620 100644
--- a/src/db/migration.ts
+++ b/src/db/migration.ts
@@ -625,4 +625,29 @@ export function runMigrations(sqlite: SqliteDatabase): void {
   sqlite.exec(
     'CREATE INDEX IF NOT EXISTS idx_project_dependencies_target_service ON project_dependencies(target_service_id)',
   );
+
+  // activity_log table (ops-center-v2)
+  sqlite.exec(`CREATE TABLE IF NOT EXISTS activity_log (
+    id TEXT PRIMARY KEY,
+    event_type TEXT NOT NULL,
+    activity_type TEXT NOT NULL,
+    severity TEXT NOT NULL,
+    project_id TEXT NOT NULL,
+    correlation_id TEXT,
+    title TEXT NOT NULL,
+    description TEXT NOT NULL,
+    status TEXT NOT NULL,
+    metadata TEXT NOT NULL DEFAULT '{}',
+    created_at TEXT NOT NULL
+  )`);
+  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)');
+  sqlite.exec(
+    'CREATE INDEX IF NOT EXISTS idx_activity_log_correlation_id ON activity_log(correlation_id)',
+  );
+  sqlite.exec(
+    'CREATE INDEX IF NOT EXISTS idx_activity_log_project_created ON activity_log(project_id, created_at)',
+  );
+  sqlite.exec(
+    'CREATE INDEX IF NOT EXISTS idx_activity_log_type_created ON activity_log(activity_type, created_at)',
+  );
 }
diff --git a/src/db/schema.drizzle.ts b/src/db/schema.drizzle.ts
index ad33214..36e5d9d 100644
--- a/src/db/schema.drizzle.ts
+++ b/src/db/schema.drizzle.ts
@@ -598,6 +598,32 @@ export type NewOpsIncidentEvent = typeof opsIncidentEvents.$inferInsert;
 export type CircuitBreakerRow = typeof circuitBreakerState.$inferSelect;
 export type NewCircuitBreaker = typeof circuitBreakerState.$inferInsert;

+export const activityLog = sqliteTable(
+  'activity_log',
+  {
+    id: text('id').primaryKey(),
+    event_type: text('event_type').notNull(),
+    activity_type: text('activity_type').notNull(),
+    severity: text('severity').notNull(),
+    project_id: text('project_id').notNull(),
+    correlation_id: text('correlation_id'),
+    title: text('title').notNull(),
+    description: text('description').notNull(),
+    status: text('status').notNull(),
+    metadata: text('metadata').notNull().default('{}'),
+    created_at: text('created_at').notNull(),
+  },
+  (table) => [
+    index('idx_activity_log_created_at').on(table.created_at),
+    index('idx_activity_log_correlation_id').on(table.correlation_id),
+    index('idx_activity_log_project_created').on(table.project_id, table.created_at),
+    index('idx_activity_log_type_created').on(table.activity_type, table.created_at),
+  ],
+);
+
+export type ActivityLogRow = typeof activityLog.$inferSelect;
+export type NewActivityLog = typeof activityLog.$inferInsert;
+
 export const drizzleSchema = {
   projects,
   environments,
@@ -622,4 +648,5 @@ export const drizzleSchema = {
   opsIncidentEvents,
   circuitBreakerState,
   projectDependencies,
+  activityLog,
 };
diff --git a/src/events/index.ts b/src/events/index.ts
index a0977ba..806ea6c 100644
--- a/src/events/index.ts
+++ b/src/events/index.ts
@@ -275,6 +275,7 @@ export interface EventPayload {
     source: string;
     model: string;
     action: string;
+    correlationId?: string;
   };
   'ai:completed': {
     projectId: string;
@@ -285,6 +286,7 @@ export interface EventPayload {
     inputTokens?: number;
     outputTokens?: number;
     success: boolean;
+    correlationId?: string;
   };
   'health:degraded': {
     projectId: string;
@@ -298,10 +300,12 @@ export interface EventPayload {
   'recovery:stopped': {
     projectId: string;
     reason: string;
+    correlationId?: string;
   };
   'recovery:started': {
     projectId: string;
     trigger: string;
+    correlationId?: string;
   };
   'recovery:start': {
     projectId: string;
@@ -309,6 +313,7 @@ export interface EventPayload {
     attempt: number;
     source?: string;
     identity?: RequestIdentity;
+    correlationId?: string;
   };
   'recovery:success': {
     projectId: string;
@@ -319,6 +324,7 @@ export interface EventPayload {
     identity?: RequestIdentity;
     tokenCount?: number;
     costUsd?: number | null;
+    correlationId?: string;
   };
   'recovery:failed': {
     projectId: string;
@@ -326,6 +332,7 @@ export interface EventPayload {
     attempt: number;
     source?: string;
     identity?: RequestIdentity;
+    correlationId?: string;
   };
   'recovery:exhausted': {
     projectId: string;
@@ -333,6 +340,7 @@ export interface EventPayload {
     lastError: string;
     source?: string;
     identity?: RequestIdentity;
+    correlationId?: string;
   };
   'recovery:approval-needed': {
     projectId: string;
@@ -341,11 +349,13 @@ export interface EventPayload {
     attempt: number;
     source?: string;
     identity?: RequestIdentity;
+    correlationId?: string;
   };
   'recovery:approval-resolved': {
     actionRunId: string;
     approved: boolean;
     projectId?: string;
+    correlationId?: string;
   };
   'env:new-keys-detected': {
     projectId: string;
diff --git a/src/monitor/ops-recovery.ts b/src/monitor/ops-recovery.ts
index be62f6d..4a2f7ef 100644
--- a/src/monitor/ops-recovery.ts
+++ b/src/monitor/ops-recovery.ts
@@ -116,6 +116,7 @@ export class RecoveryPipeline {
       projectId,
       triggerSource: 'auto_recovery',
       recoveryStrategy: 'recipe',
+      correlationId: incidentId ?? undefined,
     });

     const executionContext: RecoveryContext = {
@@ -168,6 +169,7 @@ export class RecoveryPipeline {
       toolName: step,
       attempt: 1,
       source: 'ops_recovery',
+      correlationId: context.incidentId ?? undefined,
     });

     const metadata: ApprovalMetadata = {
@@ -592,6 +594,7 @@ export class RecoveryPipeline {
       projectId: context.projectId,
       totalAttempts: this.ctx.db.getCircuitBreakerState(context.projectId)?.failure_count ?? 0,
       lastError: reason,
+      correlationId: context.incidentId ?? undefined,
     });

     log.error({ projectId: context.projectId, reason }, 'Recovery escalated');
diff --git a/src/pipeline/auto-recovery.ts b/src/pipeline/auto-recovery.ts
index f6b60c7..ecb3d0f 100644
--- a/src/pipeline/auto-recovery.ts
+++ b/src/pipeline/auto-recovery.ts
@@ -380,6 +380,7 @@ export function setupAutoRecovery(params: SetupAutoRecoveryParams): AutoRecovery
       projectId,
       error,
       attempt,
+      correlationId: projectId,
     });

     questionBridge.setActiveProject(projectId);
@@ -460,6 +461,7 @@ ${plan.agentGuidance}
                 actionRunId,
                 toolName: event.toolName,
                 attempt,
+                correlationId: projectId,
               });

               db.updateActionRunStatus(actionRunId, 'pending_approval');
@@ -505,12 +507,14 @@ ${plan.agentGuidance}
             await eventBus.emit('recovery:stopped', {
               projectId,
               reason: failureReason,
+              correlationId: projectId,
             });
           } else {
             await eventBus.emit('recovery:failed', {
               projectId,
               error: failureReason,
               attempt,
+              correlationId: projectId,
             });
           }
           trySavePattern(false);
@@ -527,6 +531,7 @@ ${plan.agentGuidance}
             attempt,
             durationMs,
             lastError: normalizedError,
+            correlationId: projectId,
           });
           trySavePattern(true);
         } else {
@@ -538,6 +543,7 @@ ${plan.agentGuidance}
             projectId,
             error: failureReason,
             attempt,
+            correlationId: projectId,
           });
           trySavePattern(false);
         }
@@ -551,6 +557,7 @@ ${plan.agentGuidance}
           projectId,
           error: errorMessage,
           attempt,
+          correlationId: projectId,
         });
         trySavePattern(false);
         return;
diff --git a/src/web/api/routes.ts b/src/web/api/routes.ts
index ed2114b..2e42a93 100644
--- a/src/web/api/routes.ts
+++ b/src/web/api/routes.ts
@@ -2,9 +2,11 @@ import { Hono } from 'hono';
 import { stream } from 'hono/streaming';

 import type { AppContext } from '../../app.js';
+import type { ActivityLogRow } from '../../db/types.js';
 import { OpenLanderError } from '../../errors.js';
 import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
 import { createModuleLogger } from '../../lib/logger.js';
+import { type ActivityEvent, buildActivityEvent } from '../../monitor/activity-event-mapper.js';
 import { createDeployStreamRoutes } from './deploy-stream-routes.js';
 import { createProjectRoutes } from './project-routes.js';
 import { createSystemRoutes } from './system-routes.js';
@@ -18,59 +20,6 @@ const log = createModuleLogger('api');
 const API_SLOW_REQUEST_MS = 300;
 const API_OBSERVE_REQUEST_MS = 150;

-interface ActivityEvent {
-  id: string;
-  timestamp: string;
-  type:
-    | 'incident'
-    | 'recovery'
-    | 'approval'
-    | 'circuit_breaker'
-    | 'cleanup'
-    | 'alert'
-    | 'ai_diagnosis'
-    | 'ai:invoked'
-    | 'ai:completed'
-    | 'recovery:blocked'
-    | 'recovery:stopped'
-    | 'recovery:started';
-  severity: 'critical' | 'warning' | 'info';
-  projectId: string;
-  projectName: string;
-  title: string;
-  description: string;
-  status:
-    | 'active'
-    | 'resolved'
-    | 'pending'
-    | 'failed'
-    | 'ai-running'
-    | 'ai-completed'
-    | 'recovery-blocked'
-    | 'recovery-stopped'
-    | 'recovering';
-  incidentId?: string;
-  actionRunId?: string;
-  correlationId?: string;
-  cascadeGroup?: string[];
-  aiMetadata?: {
-    model: string;
-    tokensUsed?: number;
-    durationMs?: number;
-    diagnosisSummary?: string;
-  };
-  rawType: EventType;
-  // Backward-compatibility aliases for legacy consumers of /api/activity
-  project: string;
-  user: string;
-  detail?: string;
-  time: string;
-  reason?: string;
-}
-
-const activityBuffer: ActivityEvent[] = [];
-const MAX_ACTIVITY = 100;
-
 const ACTIVITY_TYPES = [
   'incident',
   'recovery',
@@ -106,386 +55,6 @@ function parseSeverityFilter(raw: string | undefined): ActivityEvent['severity']
   return null;
 }

-function formatEventName(eventType: string): string {
-  return eventType.replace(/[:_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
-}
-
-function resolveProjectIdFromEvent<T extends EventType>(
-  ctx: AppContext,
-  eventType: T,
-  payload: EventPayload[T],
-): string | undefined {
-  if (eventType === 'alert:new') {
-    const alertPayload = payload as EventPayload['alert:new'];
-    const projectId = alertPayload.alert.details.projectId;
-    return typeof projectId === 'string' ? projectId : undefined;
-  }
-
-  if (eventType === 'recovery:approval-resolved') {
-    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
-    if (approvalPayload.projectId) return approvalPayload.projectId;
-    const statuses: Array<'pending' | 'approved' | 'rejected'> = [
-      'pending',
-      'approved',
-      'rejected',
-    ];
-    for (const status of statuses) {
-      const matched = ctx.db
-        .getActionRunsByApprovalStatus(status, 200)
-        .find((run) => run.id === approvalPayload.actionRunId);
-      if (matched) {
-        return matched.project_id;
-      }
-    }
-  }
-
-  const projectId = (payload as { projectId?: string }).projectId;
-  return typeof projectId === 'string' ? projectId : undefined;
-}
-
-function mapActivityType(eventType: EventType): ActivityEvent['type'] {
-  if (
-    eventType === 'ai:invoked' ||
-    eventType === 'ai:completed' ||
-    eventType === 'recovery:blocked' ||
-    eventType === 'recovery:stopped' ||
-    eventType === 'recovery:started'
-  ) {
-    return eventType;
-  }
-  if (eventType === 'recovery:approval-needed' || eventType === 'recovery:approval-resolved') {
-    return 'approval';
-  }
-  if (
-    eventType === 'recovery:start' ||
-    eventType === 'recovery:success' ||
-    eventType === 'recovery:failed' ||
-    eventType === 'recovery:exhausted'
-  ) {
-    return 'recovery';
-  }
-  if (eventType.startsWith('alert:')) {
-    return 'alert';
-  }
-  return 'incident';
-}
-
-function mapActivityStatus<T extends EventType>(
-  eventType: T,
-  payload: EventPayload[T],
-): ActivityEvent['status'] {
-  if (eventType === 'ai:invoked') return 'ai-running';
-  if (eventType === 'ai:completed') {
-    const completedPayload = payload as EventPayload['ai:completed'];
-    return completedPayload.success ? 'ai-completed' : 'failed';
-  }
-  if (eventType === 'recovery:blocked') return 'recovery-blocked';
-  if (eventType === 'recovery:stopped') return 'recovery-stopped';
-  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
-  if (eventType === 'recovery:success') return 'resolved';
-  if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
-  if (eventType === 'recovery:approval-needed') return 'pending';
-  if (eventType === 'recovery:approval-resolved') {
-    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
-    return approvalPayload.approved ? 'resolved' : 'failed';
-  }
-  if (eventType === 'alert:resolved') return 'resolved';
-  if (
-    eventType === 'deploy:failed' ||
-    eventType === 'deploy:crash' ||
-    eventType === 'compose:failed' ||
-    eventType === 'container:die' ||
-    eventType === 'container:oom' ||
-    eventType === 'container:missing' ||
-    eventType === 'health:degraded'
-  ) {
-    return 'failed';
-  }
-  return 'active';
-}
-
-function mapActivitySeverity<T extends EventType>(
-  eventType: T,
-  payload: EventPayload[T],
-  status: ActivityEvent['status'],
-): ActivityEvent['severity'] {
-  if (eventType === 'alert:new') {
-    const alertPayload = payload as EventPayload['alert:new'];
-    return alertPayload.alert.severity === 'critical' ? 'critical' : 'warning';
-  }
-  if (
-    eventType === 'deploy:crash' ||
-    eventType === 'container:die' ||
-    eventType === 'container:oom' ||
-    eventType === 'container:missing' ||
-    eventType === 'health:degraded'
-  ) {
-    return 'critical';
-  }
-  if (status === 'failed' || status === 'recovery-blocked' || status === 'recovery-stopped') {
-    return 'warning';
-  }
-  if (eventType === 'recovery:approval-needed') {
-    return 'warning';
-  }
-  return 'info';
-}
-
-function extractEventDetail<T extends EventType>(eventType: T, payload: EventPayload[T]): string {
-  if (eventType === 'deploy:failed') {
-    return (payload as EventPayload['deploy:failed']).error;
-  }
-  if (eventType === 'tunnel:url') {
-    return (payload as EventPayload['tunnel:url']).url;
-  }
-  if (eventType === 'compose:failed') {
-    return (payload as EventPayload['compose:failed']).error;
-  }
-  if (eventType === 'recovery:start') {
-    return (payload as EventPayload['recovery:start']).error;
-  }
-  if (eventType === 'recovery:failed') {
-    return (payload as EventPayload['recovery:failed']).error;
-  }
-  if (eventType === 'recovery:exhausted') {
-    return (payload as EventPayload['recovery:exhausted']).lastError;
-  }
-  if (eventType === 'recovery:blocked') {
-    return (payload as EventPayload['recovery:blocked']).reason;
-  }
-  if (eventType === 'recovery:stopped') {
-    return (payload as EventPayload['recovery:stopped']).reason;
-  }
-  if (eventType === 'recovery:started') {
-    return (payload as EventPayload['recovery:started']).trigger;
-  }
-  if (eventType === 'alert:new') {
-    return (payload as EventPayload['alert:new']).alert.message;
-  }
-  if (eventType === 'ai:invoked') {
-    const aiPayload = payload as EventPayload['ai:invoked'];
-    return `${aiPayload.model} ${aiPayload.action}`;
-  }
-  if (eventType === 'ai:completed') {
-    return `${String((payload as EventPayload['ai:completed']).durationMs)}ms`;
-  }
-  return '';
-}
-
-function describeActivityEvent<T extends EventType>(
-  eventType: T,
-  payload: EventPayload[T],
-): Pick<
-  ActivityEvent,
-  'title' | 'description' | 'actionRunId' | 'aiMetadata' | 'reason' | 'incidentId'
-> {
-  if (eventType === 'deploy:failed') {
-    const deployPayload = payload as EventPayload['deploy:failed'];
-    return {
-      title: `Deploy failed (${deployPayload.step})`,
-      description: deployPayload.error,
-    };
-  }
-  if (eventType === 'deploy:crash') {
-    const crashPayload = payload as EventPayload['deploy:crash'];
-    return {
-      title: 'Deploy crashed',
-      description:
-        crashPayload.error ??
-        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
-    };
-  }
-  if (eventType === 'compose:failed') {
-    return {
-      title: 'Compose failed',
-      description: (payload as EventPayload['compose:failed']).error,
-    };
-  }
-  if (eventType === 'container:die') {
-    const diePayload = payload as EventPayload['container:die'];
-    return {
-      title: 'Container exited',
-      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
-    };
-  }
-  if (eventType === 'container:oom') {
-    const oomPayload = payload as EventPayload['container:oom'];
-    return {
-      title: 'Container out of memory',
-      description: oomPayload.containerName,
-    };
-  }
-  if (eventType === 'container:missing') {
-    const missingPayload = payload as EventPayload['container:missing'];
-    return {
-      title: 'Container missing',
-      description: missingPayload.suggestion,
-    };
-  }
-  if (eventType === 'monitor:inactive') {
-    const monitorPayload = payload as EventPayload['monitor:inactive'];
-    return {
-      title: 'Project inactive',
-      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
-    };
-  }
-  if (eventType === 'health:degraded') {
-    const degradedPayload = payload as EventPayload['health:degraded'];
-    return {
-      title: 'Health degraded',
-      description:
-        degradedPayload.lastError ??
-        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
-    };
-  }
-  if (eventType === 'recovery:start') {
-    const recoveryPayload = payload as EventPayload['recovery:start'];
-    return {
-      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
-      description: recoveryPayload.error,
-    };
-  }
-  if (eventType === 'recovery:success') {
-    const recoveryPayload = payload as EventPayload['recovery:success'];
-    return {
-      title: 'Auto-recovery succeeded',
-      description:
-        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
-    };
-  }
-  if (eventType === 'recovery:failed') {
-    const recoveryPayload = payload as EventPayload['recovery:failed'];
-    return {
-      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
-      description: recoveryPayload.error,
-    };
-  }
-  if (eventType === 'recovery:exhausted') {
-    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
-    return {
-      title: 'Auto-recovery exhausted',
-      description: recoveryPayload.lastError,
-    };
-  }
-  if (eventType === 'recovery:blocked') {
-    const blockedPayload = payload as EventPayload['recovery:blocked'];
-    return {
-      title: 'Recovery blocked',
-      description: blockedPayload.reason,
-      reason: blockedPayload.reason,
-    };
-  }
-  if (eventType === 'recovery:stopped') {
-    const stoppedPayload = payload as EventPayload['recovery:stopped'];
-    return {
-      title: 'Recovery stopped',
-      description: stoppedPayload.reason,
-      reason: stoppedPayload.reason,
-    };
-  }
-  if (eventType === 'recovery:started') {
-    const startedPayload = payload as EventPayload['recovery:started'];
-    return {
-      title: 'Recovery started',
-      description: startedPayload.trigger,
-    };
-  }
-  if (eventType === 'recovery:approval-needed') {
-    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
-    return {
-      title: `Approval required: ${approvalPayload.toolName}`,
-      description: `Attempt #${String(approvalPayload.attempt)}`,
-      actionRunId: approvalPayload.actionRunId,
-    };
-  }
-  if (eventType === 'recovery:approval-resolved') {
-    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
-    return {
-      title: approvalPayload.approved ? 'Approval approved' : 'Approval rejected',
-      description: approvalPayload.actionRunId,
-      actionRunId: approvalPayload.actionRunId,
-    };
-  }
-  if (eventType === 'ai:invoked') {
-    const aiPayload = payload as EventPayload['ai:invoked'];
-    return {
-      title: 'AI invoked',
-      description: `${aiPayload.model} ${aiPayload.action}`,
-      aiMetadata: {
-        model: aiPayload.model,
-      },
-    };
-  }
-  if (eventType === 'ai:completed') {
-    const aiPayload = payload as EventPayload['ai:completed'];
-    return {
-      title: aiPayload.success ? 'AI completed' : 'AI failed',
-      description: `${aiPayload.action} (${String(aiPayload.durationMs)}ms)`,
-      aiMetadata: {
-        model: aiPayload.model,
-        durationMs: aiPayload.durationMs,
-        tokensUsed: (aiPayload.inputTokens ?? 0) + (aiPayload.outputTokens ?? 0) || undefined,
-      },
-    };
-  }
-  if (eventType === 'alert:new') {
-    const alertPayload = payload as EventPayload['alert:new'];
-    return {
-      title: `Alert: ${alertPayload.alert.type}`,
-      description: alertPayload.alert.message,
-      incidentId:
-        typeof alertPayload.alert.details.incidentId === 'string'
-          ? alertPayload.alert.details.incidentId
-          : undefined,
-    };
-  }
-
-  return {
-    title: formatEventName(eventType),
-    description: extractEventDetail(eventType, payload),
-  };
-}
-
-function buildActivityEvent<T extends EventType>(
-  ctx: AppContext,
-  eventType: T,
-  payload: EventPayload[T],
-): ActivityEvent | null {
-  const projectId = resolveProjectIdFromEvent(ctx, eventType, payload);
-  if (!projectId) return null;
-
-  const project = ctx.db.getProject(projectId);
-  const projectName = project?.name ?? projectId;
-  const timestamp = new Date().toISOString();
-  const type = mapActivityType(eventType);
-  const status = mapActivityStatus(eventType, payload);
-  const severity = mapActivitySeverity(eventType, payload, status);
-  const content = describeActivityEvent(eventType, payload);
-  const id = `${eventType}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
-
-  return {
-    id,
-    timestamp,
-    type,
-    severity,
-    projectId,
-    projectName,
-    title: content.title,
-    description: content.description,
-    status,
-    incidentId: content.incidentId,
-    actionRunId: content.actionRunId,
-    correlationId: content.actionRunId,
-    aiMetadata: content.aiMetadata,
-    rawType: eventType,
-    project: projectName,
-    user: 'system',
-    detail: content.description || undefined,
-    time: timestamp,
-    reason: content.reason,
-  };
-}
-
 function shouldIncludeActivity(
   event: ActivityEvent,
   filters: {
@@ -500,6 +69,41 @@ function shouldIncludeActivity(
   return true;
 }

+/**
+ * Convert an ActivityLogRow from the database into the ActivityEvent shape
+ * consumed by the frontend useActivityStream hook.
+ */
+function activityLogRowToEvent(row: ActivityLogRow, projectName: string): ActivityEvent {
+  let metadata: Record<string, unknown> = {};
+  try {
+    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
+  } catch {
+    // ignore malformed metadata
+  }
+
+  return {
+    id: row.id,
+    timestamp: row.created_at,
+    type: row.activity_type as ActivityEvent['type'],
+    severity: row.severity as ActivityEvent['severity'],
+    projectId: row.project_id,
+    projectName,
+    title: row.title,
+    description: row.description,
+    status: row.status as ActivityEvent['status'],
+    incidentId: typeof metadata.incidentId === 'string' ? metadata.incidentId : undefined,
+    actionRunId: typeof metadata.actionRunId === 'string' ? metadata.actionRunId : undefined,
+    correlationId: row.correlation_id ?? undefined,
+    aiMetadata: metadata.aiMetadata as ActivityEvent['aiMetadata'],
+    rawType: row.event_type as EventType,
+    project: projectName,
+    user: 'system',
+    detail: row.description || undefined,
+    time: row.created_at,
+    reason: typeof metadata.reason === 'string' ? metadata.reason : undefined,
+  };
+}
+
 export function createApiRoutes(ctx: AppContext): Hono {
   const api = new Hono();

@@ -539,7 +143,7 @@ export function createApiRoutes(ctx: AppContext): Hono {
     return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
   });

-  // --- Event Subscription for Activity Buffer ---
+  // --- Event types for SSE streaming ---

   const eventTypes: EventType[] = [
     'deploy:start',
@@ -582,18 +186,6 @@ export function createApiRoutes(ctx: AppContext): Hono {
     'alert:resolved',
   ];

-  for (const eventType of eventTypes) {
-    eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
-      const activityEvent = buildActivityEvent(ctx, eventType, payload);
-      if (!activityEvent) return;
-
-      activityBuffer.push(activityEvent);
-      if (activityBuffer.length > MAX_ACTIVITY) {
-        activityBuffer.shift();
-      }
-    });
-  }
-
   // Auto-release deploy locks on completion/failure
   eventBus.on('deploy:success', (p) => {
     ctx.db.releaseDeployLock(p.projectId);
@@ -608,25 +200,63 @@ export function createApiRoutes(ctx: AppContext): Hono {
     ctx.db.releaseDeployLock(p.projectId);
   });

-  // --- Activity Streaming ---
+  // --- Helper: resolve project names for activity log rows ---
+
+  function resolveActivityRows(rows: ActivityLogRow[]): ActivityEvent[] {
+    const projectNameCache = new Map<string, string>();
+    return rows.map((row) => {
+      let name = projectNameCache.get(row.project_id);
+      if (name === undefined) {
+        const project = ctx.db.getProject(row.project_id);
+        name = project?.name ?? row.project_id;
+        projectNameCache.set(row.project_id, name);
+      }
+      return activityLogRowToEvent(row, name);
+    });
+  }
+
+  // --- Activity Endpoint (DB-backed with SSE gap recovery) ---

   api.get('/activity', (c) => {
     const follow = c.req.query('follow');
+    const sinceId = c.req.query('since') ?? undefined;
     const projectIdFilter = c.req.query('projectId') ?? undefined;
     const typeFilter = parseActivityTypeFilter(c.req.query('types'));
     const severityFilter = parseSeverityFilter(c.req.query('severity'));
-    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '20', 10);
-    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 20;
+    const correlationIdFilter = c.req.query('correlationId') ?? undefined;
+    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
+    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
+
+    // Build DB filter object from query params.
+    // Note: activity_type filter uses comma-separated types from ?types= param;
+    // we pass the first value for DB-level filtering and apply full set in-memory.
+    const dbFilters: {
+      project_id?: string;
+      activity_type?: string;
+      severity?: string;
+      correlation_id?: string;
+    } = {};
+    if (projectIdFilter) dbFilters.project_id = projectIdFilter;
+    if (severityFilter) dbFilters.severity = severityFilter;
+    if (correlationIdFilter) dbFilters.correlation_id = correlationIdFilter;
+    // When a single type is requested, push it to the DB filter for efficiency
+    if (typeFilter && typeFilter.size === 1) {
+      dbFilters.activity_type = [...typeFilter][0];
+    }

     if (follow) {
       return stream(c, async (s) => {
         c.header('Content-Type', 'application/x-ndjson');

+        // Step 1: Register EventBus listener FIRST to buffer live events during backfill
+        const liveBuffer: ActivityEvent[] = [];
+        let backfillComplete = !sinceId; // no backfill needed if no since param
         const unsubscribers: Array<() => void> = [];
+
         for (const eventType of eventTypes) {
           unsubscribers.push(
             eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
-              const activityEvent = buildActivityEvent(ctx, eventType, payload);
+              const activityEvent = buildActivityEvent(ctx.db, eventType, payload);
               if (!activityEvent) return;
               if (
                 !shouldIncludeActivity(activityEvent, {
@@ -637,7 +267,12 @@ export function createApiRoutes(ctx: AppContext): Hono {
               ) {
                 return;
               }
-              void s.write(JSON.stringify(activityEvent) + '\n');
+              if (!backfillComplete) {
+                // Buffer events that arrive during backfill query
+                liveBuffer.push(activityEvent);
+              } else {
+                void s.write(JSON.stringify(activityEvent) + '\n');
+              }
             }),
           );
         }
@@ -648,18 +283,67 @@ export function createApiRoutes(ctx: AppContext): Hono {
           }
         });

+        // Step 2: If since param provided, query missed events and send as backfill
+        if (sinceId) {
+          try {
+            const missedRows = ctx.db.findActivityLogSinceFiltered(
+              sinceId,
+              limit,
+              dbFilters,
+            );
+            const missedEvents = resolveActivityRows(missedRows);
+
+            // Apply multi-type filter in-memory (DB only filters single type)
+            const filtered =
+              typeFilter && typeFilter.size > 1
+                ? missedEvents.filter((e) => typeFilter.has(e.type))
+                : missedEvents;
+
+            // Step 3: Send backfill events with backfill flag
+            for (const event of filtered) {
+              await s.write(JSON.stringify({ ...event, backfill: true }) + '\n');
+            }
+
+            // Step 4: Send sentinel
+            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
+          } catch (err) {
+            log.error({ err }, 'Failed to query activity_log for backfill');
+            // Send sentinel even on error so client knows backfill phase is done
+            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
+          }
+
+          // Step 5: Flush buffered live events that arrived during backfill
+          backfillComplete = true;
+          for (const buffered of liveBuffer) {
+            await s.write(JSON.stringify(buffered) + '\n');
+          }
+          liveBuffer.length = 0;
+        }
+
+        // Step 6: From here, live events are written directly by the listener above
         await Promise.resolve();
       });
     }

-    const activities = activityBuffer.filter((activity) =>
-      shouldIncludeActivity(activity, {
-        projectId: projectIdFilter,
-        types: typeFilter,
-        severity: severityFilter,
-      }),
-    );
-    return c.json({ activities: activities.slice(-limit) });
+    // --- REST mode: Query activity_log table ---
+    let activities: ActivityEvent[];
+
+    if (sinceId) {
+      // Cursor-based pagination: return events after the given ULID
+      const rows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
+      activities = resolveActivityRows(rows);
+    } else {
+      // No cursor: return most recent events
+      const rows = ctx.db.findActivityLogRecent(limit, dbFilters);
+      activities = resolveActivityRows(rows);
+    }
+
+    // Apply multi-type filter in-memory when multiple types requested
+    if (typeFilter && typeFilter.size > 1) {
+      activities = activities.filter((e) => typeFilter.has(e.type));
+    }
+
+    return c.json({ activities });
   });

   // --- Global Secrets ---

exec
/bin/bash -lc 'git status --short' in /home/lee/OpenLander
 succeeded in 0ms:
 M src/app.ts
 M src/db/index.ts
 M src/db/migration.ts
 M src/db/repos/action-run.repo.ts
 M src/db/schema.drizzle.ts
 M src/db/types.ts
 M src/events/index.ts
 M src/llm/agent.ts
 M src/monitor/ops-recovery.ts
 M src/monitor/recovery-coordinator.ts
 M src/pipeline/auto-recovery.ts
 M src/web/api/ops-routes.ts
 M src/web/api/routes.ts
 M test/pipeline/auto-recovery.test.ts
 M test/web/api/ops-incident-routes.test.ts
 M web/src/App.tsx
 M web/src/components/ops/ApprovalQueue.tsx
 M web/src/components/ops/CircuitBreakerBadge.tsx
 M web/src/components/ops/IncidentCard.tsx
 M web/src/components/ops/IncidentMap.tsx
 M web/src/components/ops/IncidentTimeline.tsx
 M web/src/components/ops/SeverityBadge.tsx
 M web/src/components/ops/StatusHeroCard.tsx
 M web/src/components/ops/utils.ts
 M web/src/components/project/OperationsTab.tsx
 M web/src/i18n/en.ts
 M web/src/i18n/ko.ts
 M web/src/lib/api/operations.ts
?? .omc/
?? src/db/repos/activity-log.repo.ts
?? src/monitor/activity-event-mapper.ts
?? src/monitor/activity-logger.ts
?? test/web/api/activity-routes.test.ts
?? web/src/components/ops/v2/
?? web/src/hooks/use-ops-center-data.ts
?? web/src/pages/OpsCenterV2.tsx

exec
/bin/bash -lc "nl -ba src/monitor/activity-event-mapper.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * Shared event-to-activity mapping functions.
     3	 *
     4	 * Extracted from src/web/api/routes.ts so that both the API activity buffer
     5	 * and the persistence subscriber (ActivityLogger) can reuse the same logic.
     6	 */
     7
     8	import type { EventType, EventPayload } from '../events/index.js';
     9
    10	// ── ActivityEvent shape (matches the legacy /api/activity format) ──
    11
    12	export interface ActivityEvent {
    13	  id: string;
    14	  timestamp: string;
    15	  type:
    16	    | 'incident'
    17	    | 'recovery'
    18	    | 'approval'
    19	    | 'circuit_breaker'
    20	    | 'cleanup'
    21	    | 'alert'
    22	    | 'ai_diagnosis'
    23	    | 'ai:invoked'
    24	    | 'ai:completed'
    25	    | 'recovery:blocked'
    26	    | 'recovery:stopped'
    27	    | 'recovery:started';
    28	  severity: 'critical' | 'warning' | 'info';
    29	  projectId: string;
    30	  projectName: string;
    31	  title: string;
    32	  description: string;
    33	  status:
    34	    | 'active'
    35	    | 'resolved'
    36	    | 'pending'
    37	    | 'failed'
    38	    | 'ai-running'
    39	    | 'ai-completed'
    40	    | 'recovery-blocked'
    41	    | 'recovery-stopped'
    42	    | 'recovering';
    43	  incidentId?: string;
    44	  actionRunId?: string;
    45	  correlationId?: string;
    46	  cascadeGroup?: string[];
    47	  aiMetadata?: {
    48	    model: string;
    49	    tokensUsed?: number;
    50	    durationMs?: number;
    51	    diagnosisSummary?: string;
    52	  };
    53	  rawType: EventType;
    54	  // Backward-compatibility aliases for legacy consumers of /api/activity
    55	  project: string;
    56	  user: string;
    57	  detail?: string;
    58	  time: string;
    59	  reason?: string;
    60	}
    61
    62	// ── Database abstraction for project resolution ──
    63
    64	/**
    65	 * Minimal database interface needed by resolveProjectIdFromEvent().
    66	 * Accepts the full Database class or any object that satisfies these methods.
    67	 */
    68	export interface ActivityMapperDb {
    69	  getActionRunsByApprovalStatus(
    70	    status: 'pending' | 'approved' | 'rejected',
    71	    limit: number,
    72	  ): Array<{ id: string; project_id: string }>;
    73	  getProject(id: string): { name: string } | undefined;
    74	}
    75
    76	// ── Mapping functions ──
    77
    78	export function formatEventName(eventType: string): string {
    79	  return eventType.replace(/[:_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    80	}
    81
    82	export function resolveProjectIdFromEvent<T extends EventType>(
    83	  db: ActivityMapperDb,
    84	  eventType: T,
    85	  payload: EventPayload[T],
    86	): string | undefined {
    87	  if (eventType === 'alert:new') {
    88	    const alertPayload = payload as EventPayload['alert:new'];
    89	    const projectId = alertPayload.alert.details.projectId;
    90	    return typeof projectId === 'string' ? projectId : undefined;
    91	  }
    92
    93	  if (eventType === 'recovery:approval-resolved') {
    94	    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    95	    if (approvalPayload.projectId) return approvalPayload.projectId;
    96	    const statuses: Array<'pending' | 'approved' | 'rejected'> = [
    97	      'pending',
    98	      'approved',
    99	      'rejected',
   100	    ];
   101	    for (const status of statuses) {
   102	      const matched = db
   103	        .getActionRunsByApprovalStatus(status, 200)
   104	        .find((run) => run.id === approvalPayload.actionRunId);
   105	      if (matched) {
   106	        return matched.project_id;
   107	      }
   108	    }
   109	  }
   110
   111	  const projectId = (payload as { projectId?: string }).projectId;
   112	  return typeof projectId === 'string' ? projectId : undefined;
   113	}
   114
   115	export function mapActivityType(eventType: EventType): ActivityEvent['type'] {
   116	  if (
   117	    eventType === 'ai:invoked' ||
   118	    eventType === 'ai:completed' ||
   119	    eventType === 'recovery:blocked' ||
   120	    eventType === 'recovery:stopped' ||
   121	    eventType === 'recovery:started'
   122	  ) {
   123	    return eventType;
   124	  }
   125	  if (eventType === 'recovery:approval-needed' || eventType === 'recovery:approval-resolved') {
   126	    return 'approval';
   127	  }
   128	  if (
   129	    eventType === 'recovery:start' ||
   130	    eventType === 'recovery:success' ||
   131	    eventType === 'recovery:failed' ||
   132	    eventType === 'recovery:exhausted'
   133	  ) {
   134	    return 'recovery';
   135	  }
   136	  if (eventType.startsWith('alert:')) {
   137	    return 'alert';
   138	  }
   139	  return 'incident';
   140	}
   141
   142	export function mapActivityStatus<T extends EventType>(
   143	  eventType: T,
   144	  payload: EventPayload[T],
   145	): ActivityEvent['status'] {
   146	  if (eventType === 'ai:invoked') return 'ai-running';
   147	  if (eventType === 'ai:completed') {
   148	    const completedPayload = payload as EventPayload['ai:completed'];
   149	    return completedPayload.success ? 'ai-completed' : 'failed';
   150	  }
   151	  if (eventType === 'recovery:blocked') return 'recovery-blocked';
   152	  if (eventType === 'recovery:stopped') return 'recovery-stopped';
   153	  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
   154	  if (eventType === 'recovery:success') return 'resolved';
   155	  if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
   156	  if (eventType === 'recovery:approval-needed') return 'pending';
   157	  if (eventType === 'recovery:approval-resolved') {
   158	    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
   159	    return approvalPayload.approved ? 'resolved' : 'failed';
   160	  }
   161	  if (eventType === 'alert:resolved') return 'resolved';
   162	  if (
   163	    eventType === 'deploy:failed' ||
   164	    eventType === 'deploy:crash' ||
   165	    eventType === 'compose:failed' ||
   166	    eventType === 'container:die' ||
   167	    eventType === 'container:oom' ||
   168	    eventType === 'container:missing' ||
   169	    eventType === 'health:degraded'
   170	  ) {
   171	    return 'failed';
   172	  }
   173	  return 'active';
   174	}
   175
   176	export function mapActivitySeverity<T extends EventType>(
   177	  eventType: T,
   178	  payload: EventPayload[T],
   179	  status: ActivityEvent['status'],
   180	): ActivityEvent['severity'] {
   181	  if (eventType === 'alert:new') {
   182	    const alertPayload = payload as EventPayload['alert:new'];
   183	    return alertPayload.alert.severity === 'critical' ? 'critical' : 'warning';
   184	  }
   185	  if (
   186	    eventType === 'deploy:crash' ||
   187	    eventType === 'container:die' ||
   188	    eventType === 'container:oom' ||
   189	    eventType === 'container:missing' ||
   190	    eventType === 'health:degraded'
   191	  ) {
   192	    return 'critical';
   193	  }
   194	  if (status === 'failed' || status === 'recovery-blocked' || status === 'recovery-stopped') {
   195	    return 'warning';
   196	  }
   197	  if (eventType === 'recovery:approval-needed') {
   198	    return 'warning';
   199	  }
   200	  return 'info';
   201	}
   202
   203	export function extractEventDetail<T extends EventType>(
   204	  eventType: T,
   205	  payload: EventPayload[T],
   206	): string {
   207	  if (eventType === 'deploy:failed') {
   208	    return (payload as EventPayload['deploy:failed']).error;
   209	  }
   210	  if (eventType === 'tunnel:url') {
   211	    return (payload as EventPayload['tunnel:url']).url;
   212	  }
   213	  if (eventType === 'compose:failed') {
   214	    return (payload as EventPayload['compose:failed']).error;
   215	  }
   216	  if (eventType === 'recovery:start') {
   217	    return (payload as EventPayload['recovery:start']).error;
   218	  }
   219	  if (eventType === 'recovery:failed') {
   220	    return (payload as EventPayload['recovery:failed']).error;
   221	  }
   222	  if (eventType === 'recovery:exhausted') {
   223	    return (payload as EventPayload['recovery:exhausted']).lastError;
   224	  }
   225	  if (eventType === 'recovery:blocked') {
   226	    return (payload as EventPayload['recovery:blocked']).reason;
   227	  }
   228	  if (eventType === 'recovery:stopped') {
   229	    return (payload as EventPayload['recovery:stopped']).reason;
   230	  }
   231	  if (eventType === 'recovery:started') {
   232	    return (payload as EventPayload['recovery:started']).trigger;
   233	  }
   234	  if (eventType === 'alert:new') {
   235	    return (payload as EventPayload['alert:new']).alert.message;
   236	  }
   237	  if (eventType === 'ai:invoked') {
   238	    const aiPayload = payload as EventPayload['ai:invoked'];
   239	    return `${aiPayload.model} ${aiPayload.action}`;
   240	  }
   241	  if (eventType === 'ai:completed') {
   242	    return `${String((payload as EventPayload['ai:completed']).durationMs)}ms`;
   243	  }
   244	  return '';
   245	}
   246
   247	export function describeActivityEvent<T extends EventType>(
   248	  eventType: T,
   249	  payload: EventPayload[T],
   250	): Pick<
   251	  ActivityEvent,
   252	  'title' | 'description' | 'actionRunId' | 'aiMetadata' | 'reason' | 'incidentId'
   253	> {
   254	  if (eventType === 'deploy:failed') {
   255	    const deployPayload = payload as EventPayload['deploy:failed'];
   256	    return {
   257	      title: `Deploy failed (${deployPayload.step})`,
   258	      description: deployPayload.error,
   259	    };
   260	  }

exec
/bin/bash -lc "nl -ba src/monitor/activity-logger.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * ActivityLogger — persists EventBus events to the activity_log table.
     3	 *
     4	 * Subscribes to all monitored event types and writes each event
     5	 * as an activity_log row via Database.insertActivityLog().
     6	 *
     7	 * CRITICAL: handlers return void (not Promise) to avoid blocking
     8	 * the EventBus emit chain. Persistence is fire-and-forget.
     9	 */
    10
    11	import type { Database } from '../db/index.js';
    12	import type { EventBus, EventType, EventPayload } from '../events/index.js';
    13	import { createModuleLogger } from '../lib/logger.js';
    14	import { buildActivityEvent } from './activity-event-mapper.js';
    15
    16	const log = createModuleLogger('activity-logger');
    17
    18	/** All event types that should be persisted to activity_log. */
    19	const PERSISTED_EVENT_TYPES: EventType[] = [
    20	  'deploy:start',
    21	  'deploy:clone',
    22	  'deploy:build',
    23	  'deploy:run',
    24	  'deploy:success',
    25	  'deploy:failed',
    26	  'deploy:crash',
    27	  'deploy:rollback',
    28	  'container:start',
    29	  'container:stop',
    30	  'container:remove',
    31	  'container:health',
    32	  'container:die',
    33	  'container:oom',
    34	  'container:missing',
    35	  'tunnel:start',
    36	  'tunnel:stop',
    37	  'tunnel:url',
    38	  'env:set',
    39	  'env:delete',
    40	  'compose:start',
    41	  'compose:up',
    42	  'compose:failed',
    43	  'monitor:inactive',
    44	  'health:degraded',
    45	  'recovery:start',
    46	  'recovery:success',
    47	  'recovery:failed',
    48	  'recovery:exhausted',
    49	  'recovery:approval-needed',
    50	  'recovery:approval-resolved',
    51	  'recovery:blocked',
    52	  'recovery:stopped',
    53	  'recovery:started',
    54	  'ai:invoked',
    55	  'ai:completed',
    56	  'alert:new',
    57	  'alert:resolved',
    58	];
    59
    60	export class ActivityLogger {
    61	  private readonly unsubscribers: Array<() => void> = [];
    62
    63	  constructor(
    64	    private readonly eventBus: EventBus,
    65	    private readonly db: Database,
    66	  ) {}
    67
    68	  /** Subscribe to all monitored event types and start persisting. */
    69	  start(): void {
    70	    for (const eventType of PERSISTED_EVENT_TYPES) {
    71	      const unsub = this.eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
    72	        // Synchronous insert — SQLite is sync via better-sqlite3
    73	        try {
    74	          const activity = buildActivityEvent(this.db, eventType, payload);
    75	          if (!activity) return;
    76
    77	          // Extract correlationId from payload when available
    78	          const correlationId =
    79	            activity.correlationId ??
    80	            (payload as { correlationId?: string }).correlationId ??
    81	            undefined;
    82
    83	          const metadata: Record<string, unknown> = {};
    84	          if (activity.incidentId) metadata.incidentId = activity.incidentId;
    85	          if (activity.actionRunId) metadata.actionRunId = activity.actionRunId;
    86	          if (activity.aiMetadata) metadata.aiMetadata = activity.aiMetadata;
    87	          if (activity.reason) metadata.reason = activity.reason;
    88
    89	          this.db.insertActivityLog({
    90	            event_type: eventType,
    91	            activity_type: activity.type,
    92	            severity: activity.severity,
    93	            project_id: activity.projectId,
    94	            correlation_id: correlationId ?? null,
    95	            title: activity.title,
    96	            description: activity.description,
    97	            status: activity.status,
    98	            metadata: JSON.stringify(metadata),
    99	          });
   100	        } catch (err) {
   101	          log.error({ err, eventType }, 'Failed to persist activity event');
   102	        }
   103	      });
   104	      this.unsubscribers.push(unsub);
   105	    }
   106
   107	    log.info(
   108	      { eventCount: PERSISTED_EVENT_TYPES.length },
   109	      'ActivityLogger started — persisting events to activity_log',
   110	    );
   111	  }
   112
   113	  /** Unsubscribe from all events. */
   114	  stop(): void {
   115	    for (const unsub of this.unsubscribers) {
   116	      unsub();
   117	    }
   118	    this.unsubscribers.length = 0;
   119	    log.info('ActivityLogger stopped');
   120	  }
   121	}

exec
/bin/bash -lc "nl -ba src/web/api/routes.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { Hono } from 'hono';
     2	import { stream } from 'hono/streaming';
     3
     4	import type { AppContext } from '../../app.js';
     5	import type { ActivityLogRow } from '../../db/types.js';
     6	import { OpenLanderError } from '../../errors.js';
     7	import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
     8	import { createModuleLogger } from '../../lib/logger.js';
     9	import { type ActivityEvent, buildActivityEvent } from '../../monitor/activity-event-mapper.js';
    10	import { createDeployStreamRoutes } from './deploy-stream-routes.js';
    11	import { createProjectRoutes } from './project-routes.js';
    12	import { createSystemRoutes } from './system-routes.js';
    13	import { createAiUsageRoutes } from './ai-usage-routes.js';
    14	import { createApprovalRoutes } from './approval-routes.js';
    15	import { createOpsRoutes } from './ops-routes.js';
    16	import { containerName as projectContainerName } from '../../pipeline/helpers.js';
    17	import { getEnvironmentProjectHostname, getAllIps } from '../../pipeline/traefik.js';
    18
    19	const log = createModuleLogger('api');
    20	const API_SLOW_REQUEST_MS = 300;
    21	const API_OBSERVE_REQUEST_MS = 150;
    22
    23	const ACTIVITY_TYPES = [
    24	  'incident',
    25	  'recovery',
    26	  'approval',
    27	  'circuit_breaker',
    28	  'cleanup',
    29	  'alert',
    30	  'ai_diagnosis',
    31	  'ai:invoked',
    32	  'ai:completed',
    33	  'recovery:blocked',
    34	  'recovery:stopped',
    35	  'recovery:started',
    36	] as const;
    37
    38	function isActivityType(value: string): value is ActivityEvent['type'] {
    39	  return (ACTIVITY_TYPES as readonly string[]).includes(value);
    40	}
    41
    42	function parseActivityTypeFilter(raw: string | undefined): Set<ActivityEvent['type']> | null {
    43	  if (!raw) return null;
    44	  const parsed = raw
    45	    .split(',')
    46	    .map((value) => value.trim())
    47	    .filter((value) => value.length > 0)
    48	    .filter(isActivityType);
    49	  if (parsed.length === 0) return null;
    50	  return new Set(parsed);
    51	}
    52
    53	function parseSeverityFilter(raw: string | undefined): ActivityEvent['severity'] | null {
    54	  if (raw === 'critical' || raw === 'warning' || raw === 'info') return raw;
    55	  return null;
    56	}
    57
    58	function shouldIncludeActivity(
    59	  event: ActivityEvent,
    60	  filters: {
    61	    projectId?: string;
    62	    types?: Set<ActivityEvent['type']> | null;
    63	    severity?: ActivityEvent['severity'] | null;
    64	  },
    65	): boolean {
    66	  if (filters.projectId && event.projectId !== filters.projectId) return false;
    67	  if (filters.types && !filters.types.has(event.type)) return false;
    68	  if (filters.severity && event.severity !== filters.severity) return false;
    69	  return true;
    70	}
    71
    72	/**
    73	 * Convert an ActivityLogRow from the database into the ActivityEvent shape
    74	 * consumed by the frontend useActivityStream hook.
    75	 */
    76	function activityLogRowToEvent(row: ActivityLogRow, projectName: string): ActivityEvent {
    77	  let metadata: Record<string, unknown> = {};
    78	  try {
    79	    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    80	  } catch {
    81	    // ignore malformed metadata
    82	  }
    83
    84	  return {
    85	    id: row.id,
    86	    timestamp: row.created_at,
    87	    type: row.activity_type as ActivityEvent['type'],
    88	    severity: row.severity as ActivityEvent['severity'],
    89	    projectId: row.project_id,
    90	    projectName,
    91	    title: row.title,
    92	    description: row.description,
    93	    status: row.status as ActivityEvent['status'],
    94	    incidentId: typeof metadata.incidentId === 'string' ? metadata.incidentId : undefined,
    95	    actionRunId: typeof metadata.actionRunId === 'string' ? metadata.actionRunId : undefined,
    96	    correlationId: row.correlation_id ?? undefined,
    97	    aiMetadata: metadata.aiMetadata as ActivityEvent['aiMetadata'],
    98	    rawType: row.event_type as EventType,
    99	    project: projectName,
   100	    user: 'system',
   101	    detail: row.description || undefined,
   102	    time: row.created_at,
   103	    reason: typeof metadata.reason === 'string' ? metadata.reason : undefined,
   104	  };
   105	}
   106
   107	export function createApiRoutes(ctx: AppContext): Hono {
   108	  const api = new Hono();
   109
   110	  api.use('*', async (c, next) => {
   111	    const startedAt = Date.now();
   112	    try {
   113	      await next();
   114	    } finally {
   115	      const durationMs = Date.now() - startedAt;
   116	      const contentType = c.res.headers.get('content-type') ?? '';
   117	      const isStreamingResponse =
   118	        contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream');
   119
   120	      if (!isStreamingResponse) {
   121	        const requestMeta = {
   122	          method: c.req.method,
   123	          path: c.req.path,
   124	          status: c.res.status,
   125	          durationMs,
   126	        };
   127
   128	        if (durationMs >= API_SLOW_REQUEST_MS) {
   129	          log.warn(requestMeta, 'Slow API request');
   130	        } else if (durationMs >= API_OBSERVE_REQUEST_MS) {
   131	          log.info(requestMeta, 'API request latency');
   132	        }
   133	      }
   134	    }
   135	  });
   136
   137	  // --- Error handler ---
   138	  api.onError((err, c) => {
   139	    if (err instanceof OpenLanderError) {
   140	      return c.json(err.toJSON(), err.statusCode as 400);
   141	    }
   142	    log.error({ err }, 'API Error');
   143	    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
   144	  });
   145
   146	  // --- Event types for SSE streaming ---
   147
   148	  const eventTypes: EventType[] = [
   149	    'deploy:start',
   150	    'deploy:clone',
   151	    'deploy:build',
   152	    'deploy:run',
   153	    'deploy:success',
   154	    'deploy:failed',
   155	    'deploy:crash',
   156	    'deploy:rollback',
   157	    'container:start',
   158	    'container:stop',
   159	    'container:remove',
   160	    'container:health',
   161	    'container:die',
   162	    'container:oom',
   163	    'container:missing',
   164	    'tunnel:start',
   165	    'tunnel:stop',
   166	    'tunnel:url',
   167	    'env:set',
   168	    'env:delete',
   169	    'compose:start',
   170	    'compose:up',
   171	    'compose:failed',
   172	    'monitor:inactive',
   173	    'health:degraded',
   174	    'recovery:start',
   175	    'recovery:success',
   176	    'recovery:failed',
   177	    'recovery:exhausted',
   178	    'recovery:approval-needed',
   179	    'recovery:approval-resolved',
   180	    'recovery:blocked',
   181	    'recovery:stopped',
   182	    'recovery:started',
   183	    'ai:invoked',
   184	    'ai:completed',
   185	    'alert:new',
   186	    'alert:resolved',
   187	  ];
   188
   189	  // Auto-release deploy locks on completion/failure
   190	  eventBus.on('deploy:success', (p) => {
   191	    ctx.db.releaseDeployLock(p.projectId);
   192	  });
   193	  eventBus.on('deploy:failed', (p) => {
   194	    ctx.db.releaseDeployLock(p.projectId);
   195	  });
   196	  eventBus.on('compose:up', (p) => {
   197	    ctx.db.releaseDeployLock(p.projectId);
   198	  });
   199	  eventBus.on('compose:failed', (p) => {
   200	    ctx.db.releaseDeployLock(p.projectId);
   201	  });
   202
   203	  // --- Helper: resolve project names for activity log rows ---
   204
   205	  function resolveActivityRows(rows: ActivityLogRow[]): ActivityEvent[] {
   206	    const projectNameCache = new Map<string, string>();
   207	    return rows.map((row) => {
   208	      let name = projectNameCache.get(row.project_id);
   209	      if (name === undefined) {
   210	        const project = ctx.db.getProject(row.project_id);
   211	        name = project?.name ?? row.project_id;
   212	        projectNameCache.set(row.project_id, name);
   213	      }
   214	      return activityLogRowToEvent(row, name);
   215	    });
   216	  }
   217
   218	  // --- Activity Endpoint (DB-backed with SSE gap recovery) ---
   219
   220	  api.get('/activity', (c) => {
   221	    const follow = c.req.query('follow');
   222	    const sinceId = c.req.query('since') ?? undefined;
   223	    const projectIdFilter = c.req.query('projectId') ?? undefined;
   224	    const typeFilter = parseActivityTypeFilter(c.req.query('types'));
   225	    const severityFilter = parseSeverityFilter(c.req.query('severity'));
   226	    const correlationIdFilter = c.req.query('correlationId') ?? undefined;
   227	    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
   228	    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;
   229
   230	    // Build DB filter object from query params.
   231	    // Note: activity_type filter uses comma-separated types from ?types= param;
   232	    // we pass the first value for DB-level filtering and apply full set in-memory.
   233	    const dbFilters: {
   234	      project_id?: string;
   235	      activity_type?: string;
   236	      severity?: string;
   237	      correlation_id?: string;
   238	    } = {};
   239	    if (projectIdFilter) dbFilters.project_id = projectIdFilter;
   240	    if (severityFilter) dbFilters.severity = severityFilter;
   241	    if (correlationIdFilter) dbFilters.correlation_id = correlationIdFilter;
   242	    // When a single type is requested, push it to the DB filter for efficiency
   243	    if (typeFilter && typeFilter.size === 1) {
   244	      dbFilters.activity_type = [...typeFilter][0];
   245	    }
   246
   247	    if (follow) {
   248	      return stream(c, async (s) => {
   249	        c.header('Content-Type', 'application/x-ndjson');
   250
   251	        // Step 1: Register EventBus listener FIRST to buffer live events during backfill
   252	        const liveBuffer: ActivityEvent[] = [];
   253	        let backfillComplete = !sinceId; // no backfill needed if no since param
   254	        const unsubscribers: Array<() => void> = [];
   255
   256	        for (const eventType of eventTypes) {
   257	          unsubscribers.push(
   258	            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
   259	              const activityEvent = buildActivityEvent(ctx.db, eventType, payload);
   260	              if (!activityEvent) return;
   261	              if (
   262	                !shouldIncludeActivity(activityEvent, {
   263	                  projectId: projectIdFilter,
   264	                  types: typeFilter,
   265	                  severity: severityFilter,
   266	                })
   267	              ) {
   268	                return;
   269	              }
   270	              if (!backfillComplete) {
   271	                // Buffer events that arrive during backfill query
   272	                liveBuffer.push(activityEvent);
   273	              } else {
   274	                void s.write(JSON.stringify(activityEvent) + '\n');
   275	              }
   276	            }),
   277	          );
   278	        }
   279
   280	        s.onAbort(() => {
   281	          for (const unsub of unsubscribers) {
   282	            unsub();
   283	          }
   284	        });
   285
   286	        // Step 2: If since param provided, query missed events and send as backfill
   287	        if (sinceId) {
   288	          try {
   289	            const missedRows = ctx.db.findActivityLogSinceFiltered(
   290	              sinceId,
   291	              limit,
   292	              dbFilters,
   293	            );
   294	            const missedEvents = resolveActivityRows(missedRows);
   295
   296	            // Apply multi-type filter in-memory (DB only filters single type)
   297	            const filtered =
   298	              typeFilter && typeFilter.size > 1
   299	                ? missedEvents.filter((e) => typeFilter.has(e.type))
   300	                : missedEvents;
   301
   302	            // Step 3: Send backfill events with backfill flag
   303	            for (const event of filtered) {
   304	              await s.write(JSON.stringify({ ...event, backfill: true }) + '\n');
   305	            }
   306
   307	            // Step 4: Send sentinel
   308	            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   309	          } catch (err) {
   310	            log.error({ err }, 'Failed to query activity_log for backfill');
   311	            // Send sentinel even on error so client knows backfill phase is done
   312	            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   313	          }
   314
   315	          // Step 5: Flush buffered live events that arrived during backfill
   316	          backfillComplete = true;
   317	          for (const buffered of liveBuffer) {
   318	            await s.write(JSON.stringify(buffered) + '\n');
   319	          }
   320	          liveBuffer.length = 0;

exec
/bin/bash -lc "nl -ba src/db/schema.drizzle.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { sql } from 'drizzle-orm';
     2	import {
     3	  check,
     4	  index,
     5	  integer,
     6	  real,
     7	  sqliteTable,
     8	  text,
     9	  uniqueIndex,
    10	  type AnySQLiteColumn,
    11	} from 'drizzle-orm/sqlite-core';
    12
    13	export const projects = sqliteTable(
    14	  'projects',
    15	  {
    16	    id: text('id').primaryKey(),
    17	    name: text('name').notNull().unique(),
    18	    repo_url: text('repo_url'),
    19	    branch: text('branch').default('main'),
    20	    status: text('status', {
    21	      enum: ['running', 'stopped', 'building', 'error', 'recovering'],
    22	    }).default('stopped'),
    23	    visibility: text('visibility', {
    24	      enum: ['internal', 'quick-share', 'shared', 'production'],
    25	    }).default('internal'),
    26	    assigned_port: integer('assigned_port').unique(),
    27	    container_id: text('container_id'),
    28	    image_tag: text('image_tag'),
    29	    previous_image_tag: text('previous_image_tag'),
    30	    public_url: text('public_url'),
    31	    parent_project_id: text('parent_project_id').references((): AnySQLiteColumn => projects.id, {
    32	      onDelete: 'cascade',
    33	    }),
    34	    dockerfile_path: text('dockerfile_path').default('Dockerfile'),
    35	    docker_target: text('docker_target'),
    36	    build_context: text('build_context'),
    37	    build_method: text('build_method', { enum: ['dockerfile', 'compose'] }),
    38	    source: text('source').notNull().default('git'),
    39	    image_url: text('image_url'),
    40	    image_cmd: text('image_cmd'),
    41	    container_port: integer('container_port'),
    42	    pending_fix: text('pending_fix'),
    43	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    44	    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    45	    archived_at: text('archived_at'),
    46	    deploy_lock_session: text('deploy_lock_session'),
    47	    deploy_lock_at: text('deploy_lock_at'),
    48	    access_code: text('access_code'),
    49	    access_code_iv: text('access_code_iv'),
    50	    is_preview: integer('is_preview').default(0),
    51	    pr_number: integer('pr_number'),
    52	  },
    53	  (table) => [
    54	    check(
    55	      'projects_status_check',
    56	      sql`${table.status} IN ('running', 'stopped', 'building', 'error', 'recovering')`,
    57	    ),
    58	    check(
    59	      'projects_visibility_check',
    60	      sql`${table.visibility} IN ('internal', 'quick-share', 'shared', 'production')`,
    61	    ),
    62	    check('projects_build_method_check', sql`${table.build_method} IN ('dockerfile', 'compose')`),
    63	    check('projects_is_preview_check', sql`${table.is_preview} IN (0, 1)`),
    64	    index('idx_projects_parent').on(table.parent_project_id),
    65	  ],
    66	);
    67
    68	export const environments = sqliteTable(
    69	  'environments',
    70	  {
    71	    id: text('id').primaryKey(),
    72	    project_id: text('project_id')
    73	      .notNull()
    74	      .references(() => projects.id, { onDelete: 'cascade' }),
    75	    type: text('type', { enum: ['production', 'development'] }).notNull(),
    76	    branch: text('branch').notNull().default('main'),
    77	    status: text('status', { enum: ['running', 'stopped', 'building', 'error', 'idle'] }).default(
    78	      'idle',
    79	    ),
    80	    assigned_port: integer('assigned_port').unique(),
    81	    container_id: text('container_id'),
    82	    image_tag: text('image_tag'),
    83	    previous_image_tag: text('previous_image_tag'),
    84	    public_url: text('public_url'),
    85	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    86	    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    87	  },
    88	  (table) => [
    89	    check('environments_type_check', sql`${table.type} IN ('production', 'development')`),
    90	    check(
    91	      'environments_status_check',
    92	      sql`${table.status} IN ('running', 'stopped', 'building', 'error', 'idle')`,
    93	    ),
    94	    uniqueIndex('environments_project_type_unique').on(table.project_id, table.type),
    95	    index('idx_environments_project').on(table.project_id),
    96	  ],
    97	);
    98
    99	export const envVars = sqliteTable(
   100	  'env_vars',
   101	  {
   102	    id: text('id').primaryKey(),
   103	    project_id: text('project_id')
   104	      .notNull()
   105	      .references(() => projects.id, { onDelete: 'cascade' }),
   106	    environment_id: text('environment_id').references(() => environments.id, {
   107	      onDelete: 'cascade',
   108	    }),
   109	    key: text('key').notNull(),
   110	    value: text('value').notNull(),
   111	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   112	  },
   113	  (table) => [
   114	    uniqueIndex('env_vars_project_key_unique').on(table.project_id, table.key),
   115	    index('idx_env_vars_project').on(table.project_id),
   116	    index('idx_env_vars_environment').on(table.environment_id),
   117	  ],
   118	);
   119
   120	export const deployLogs = sqliteTable(
   121	  'deploy_logs',
   122	  {
   123	    id: text('id').primaryKey(),
   124	    project_id: text('project_id')
   125	      .notNull()
   126	      .references(() => projects.id, { onDelete: 'cascade' }),
   127	    environment_id: text('environment_id').references(() => environments.id, {
   128	      onDelete: 'cascade',
   129	    }),
   130	    status: text('status', { enum: ['success', 'failed', 'cancelled'] }),
   131	    trigger: text('trigger_source', { enum: ['chat', 'webhook', 'api'] }),
   132	    trigger_detail: text('trigger_detail'),
   133	    commit_sha: text('commit_sha'),
   134	    commit_message: text('commit_message'),
   135	    build_log: text('build_log'),
   136	    runtime_log: text('runtime_log'),
   137	    duration_ms: integer('duration_ms'),
   138	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   139	  },
   140	  (table) => [
   141	    check('deploy_logs_status_check', sql`${table.status} IN ('success', 'failed', 'cancelled')`),
   142	    check('deploy_logs_trigger_check', sql`${table.trigger} IN ('chat', 'webhook', 'api')`),
   143	    index('idx_deploy_logs_project').on(table.project_id),
   144	    index('idx_deploy_logs_environment').on(table.environment_id),
   145	  ],
   146	);
   147
   148	export const timelineEvents = sqliteTable(
   149	  'timeline_events',
   150	  {
   151	    id: text('id').primaryKey(),
   152	    project_id: text('project_id')
   153	      .notNull()
   154	      .references(() => projects.id, { onDelete: 'cascade' }),
   155	    deploy_id: text('deploy_id'),
   156	    type: text('type').notNull(),
   157	    message: text('message').notNull(),
   158	    detail: text('detail'),
   159	    severity: text('severity'),
   160	    percent: integer('percent'),
   161	    tool_name: text('tool_name'),
   162	    action_buttons: text('action_buttons'),
   163	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   164	  },
   165	  (table) => [index('idx_timeline_project').on(table.project_id, table.created_at)],
   166	);
   167
   168	export const domainMappings = sqliteTable(
   169	  'domain_mappings',
   170	  {
   171	    id: text('id').primaryKey(),
   172	    project_id: text('project_id')
   173	      .notNull()
   174	      .references(() => projects.id, { onDelete: 'cascade' }),
   175	    domain: text('domain').notNull().unique(),
   176	    cloudflare_zone_id: text('cloudflare_zone_id'),
   177	    cloudflare_dns_record_id: text('cloudflare_dns_record_id'),
   178	    status: text('status', { enum: ['active', 'pending', 'error'] }).default('active'),
   179	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   180	  },
   181	  (table) => [
   182	    check('domain_mappings_status_check', sql`${table.status} IN ('active', 'pending', 'error')`),
   183	    index('idx_domain_mappings_project').on(table.project_id),
   184	  ],
   185	);
   186
   187	export const oauthTokens = sqliteTable(
   188	  'oauth_tokens',
   189	  {
   190	    id: text('id').primaryKey(),
   191	    provider: text('provider').notNull().unique(),
   192	    access_token: text('access_token').notNull(),
   193	    refresh_token: text('refresh_token'),
   194	    expires_at: text('expires_at'),
   195	    token_type: text('token_type').default('Bearer'),
   196	    auth_method: text('auth_method').default('manual'),
   197	    user_email: text('user_email'),
   198	    iv: text('iv'),
   199	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   200	    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
   201	  },
   202	  (table) => [index('idx_oauth_tokens_provider').on(table.provider)],
   203	);
   204
   205	export const webhookConfigs = sqliteTable(
   206	  'webhook_configs',
   207	  {
   208	    id: text('id').primaryKey(),
   209	    project_id: text('project_id')
   210	      .notNull()
   211	      .references(() => projects.id, { onDelete: 'cascade' }),
   212	    source: text('source', { enum: ['github', 'gitlab', 'bitbucket'] }).notNull(),
   213	    secret: text('secret').notNull(),
   214	    branch_filter: text('branch_filter').default('main'),
   215	    enabled: integer('enabled').default(1),
   216	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   217	  },
   218	  (table) => [
   219	    check(
   220	      'webhook_configs_source_check',
   221	      sql`${table.source} IN ('github', 'gitlab', 'bitbucket')`,
   222	    ),
   223	    check('webhook_configs_enabled_check', sql`${table.enabled} IN (0, 1)`),
   224	    uniqueIndex('webhook_configs_project_source_unique').on(table.project_id, table.source),
   225	    index('idx_webhook_configs_project_source').on(table.project_id, table.source),
   226	  ],
   227	);
   228
   229	export const globalSecrets = sqliteTable(
   230	  'global_secrets',
   231	  {
   232	    id: text('id').primaryKey(),
   233	    key: text('key').notNull().unique(),
   234	    encrypted_value: text('encrypted_value').notNull(),
   235	    iv: text('iv').notNull(),
   236	    description: text('description'),
   237	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   238	    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
   239	  },
   240	  (table) => [index('idx_global_secrets_key').on(table.key)],
   241	);
   242
   243	export const services = sqliteTable(
   244	  'services',
   245	  {
   246	    id: text('id').primaryKey(),
   247	    name: text('name').notNull().unique(),
   248	    type: text('type').notNull(),
   249	    image: text('image').notNull(),
   250	    status: text('status', { enum: ['running', 'stopped', 'error'] }).default('stopped'),
   251	    container_id: text('container_id'),
   252	    container_name: text('container_name').notNull().unique(),
   253	    port: integer('port').notNull(),
   254	    env_vars: text('env_vars'),
   255	    credentials: text('credentials'),
   256	    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
   257	    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
   258	  },
   259	  (table) => [
   260	    check('services_status_check', sql`${table.status} IN ('running', 'stopped', 'error')`),
   261	    index('idx_services_type').on(table.type),
   262	  ],
   263	);
   264
   265	export const serviceConnections = sqliteTable(
   266	  'service_connections',
   267	  {
   268	    id: text('id')
   269	      .primaryKey()
   270	      .$defaultFn(() => crypto.randomUUID()),
   271	    project_id: text('project_id')
   272	      .notNull()
   273	      .references(() => projects.id, { onDelete: 'cascade' }),
   274	    service_id: text('service_id')
   275	      .notNull()
   276	      .references(() => services.id, { onDelete: 'cascade' }),
   277	    environment_id: text('environment_id').references(() => environments.id, {
   278	      onDelete: 'set null',
   279	    }),
   280	    auto_injected_env_keys: text('auto_injected_env_keys'),
   281	    created_at: text('created_at')
   282	      .notNull()
   283	      .$defaultFn(() => new Date().toISOString()),
   284	  },
   285	  (table) => [
   286	    uniqueIndex('service_connections_project_service_idx').on(table.project_id, table.service_id),
   287	    index('idx_service_connections_project').on(table.project_id),
   288	    index('idx_service_connections_service').on(table.service_id),
   289	  ],
   290	);
   291
   292	export const runtimeIncidents = sqliteTable(
   293	  'runtime_incidents',
   294	  {
   295	    id: text('id')
   296	      .primaryKey()
   297	      .$defaultFn(() => crypto.randomUUID()),
   298	    project_id: text('project_id')
   299	      .notNull()
   300	      .references(() => projects.id, { onDelete: 'cascade' }),
   301	    environment_id: text('environment_id').references(() => environments.id),
   302	    category: text('category').notNull(),
   303	    exit_code: integer('exit_code'),
   304	    error_snippet: text('error_snippet'),
   305	    container_image: text('container_image'),
   306	    container_uptime_ms: integer('container_uptime_ms'),
   307	    restart_count: integer('restart_count'),
   308	    diagnosis: text('diagnosis'),
   309	    resolved: integer('resolved').notNull().default(0),
   310	    resolved_at: text('resolved_at'),
   311	    created_at: text('created_at')
   312	      .notNull()
   313	      .$defaultFn(() => new Date().toISOString()),
   314	  },
   315	  (table) => [
   316	    index('idx_runtime_incidents_project').on(table.project_id),
   317	    index('idx_runtime_incidents_resolved').on(table.resolved),
   318	  ],
   319	);
   320

exec
/bin/bash -lc "nl -ba src/db/migration.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import type { SqliteDatabase } from './drizzle.js';
     2	import { SCHEMA } from './schema.js';
     3
     4	/**
     5	 * Initialize the database by creating tables and running migrations.
     6	 */
     7	export function initializeDatabase(sqlite: SqliteDatabase): void {
     8	  sqlite.exec(SCHEMA);
     9	  runMigrations(sqlite);
    10	}
    11
    12	/**
    13	 * Run all schema migrations.
    14	 */
    15	export function runMigrations(sqlite: SqliteDatabase): void {
    16	  sqlite.exec('DROP TABLE IF EXISTS chat_history');
    17
    18	  const columns = sqlite.prepare("PRAGMA table_info('projects')").all() as Array<{
    19	    name: string;
    20	  }>;
    21	  const colNames = new Set(columns.map((c) => c.name));
    22
    23	  if (!colNames.has('parent_project_id')) {
    24	    sqlite.exec(
    25	      'ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE',
    26	    );
    27	  }
    28	  if (!colNames.has('dockerfile_path')) {
    29	    sqlite.exec("ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT 'Dockerfile'");
    30	  }
    31	  if (!colNames.has('docker_target')) {
    32	    sqlite.exec('ALTER TABLE projects ADD COLUMN docker_target TEXT DEFAULT NULL');
    33	  }
    34	  if (!colNames.has('build_context')) {
    35	    sqlite.exec('ALTER TABLE projects ADD COLUMN build_context TEXT DEFAULT NULL');
    36	  }
    37	  if (!colNames.has('build_method')) {
    38	    sqlite.exec(
    39	      "ALTER TABLE projects ADD COLUMN build_method TEXT DEFAULT NULL CHECK(build_method IN ('dockerfile', 'compose'))",
    40	    );
    41	  }
    42	  if (!colNames.has('pending_fix')) {
    43	    sqlite.exec('ALTER TABLE projects ADD COLUMN pending_fix TEXT DEFAULT NULL');
    44	  }
    45	  if (!colNames.has('deploy_lock_session')) {
    46	    sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_session TEXT DEFAULT NULL');
    47	  }
    48	  if (!colNames.has('deploy_lock_at')) {
    49	    sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_at DATETIME DEFAULT NULL');
    50	  }
    51	  if (!colNames.has('access_code')) {
    52	    sqlite.exec('ALTER TABLE projects ADD COLUMN access_code TEXT');
    53	  }
    54	  if (!colNames.has('access_code_iv')) {
    55	    sqlite.exec('ALTER TABLE projects ADD COLUMN access_code_iv TEXT');
    56	  }
    57	  if (!colNames.has('is_preview')) {
    58	    sqlite.exec('ALTER TABLE projects ADD COLUMN is_preview INTEGER DEFAULT 0');
    59	  }
    60	  if (!colNames.has('pr_number')) {
    61	    sqlite.exec('ALTER TABLE projects ADD COLUMN pr_number INTEGER');
    62	  }
    63	  if (!colNames.has('source')) {
    64	    sqlite.exec("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'git'");
    65	  }
    66	  if (!colNames.has('image_url')) {
    67	    sqlite.exec('ALTER TABLE projects ADD COLUMN image_url TEXT DEFAULT NULL');
    68	  }
    69	  if (!colNames.has('image_cmd')) {
    70	    sqlite.exec('ALTER TABLE projects ADD COLUMN image_cmd TEXT DEFAULT NULL');
    71	  }
    72	  if (!colNames.has('container_port')) {
    73	    sqlite.exec('ALTER TABLE projects ADD COLUMN container_port INTEGER DEFAULT NULL');
    74	  }
    75	  if (!colNames.has('archived_at')) {
    76	    sqlite.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
    77	  }
    78	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)');
    79
    80	  sqlite.exec(`CREATE TABLE IF NOT EXISTS environments (
    81	    id TEXT PRIMARY KEY,
    82	    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    83	    type TEXT NOT NULL CHECK(type IN ('production', 'development')),
    84	    branch TEXT NOT NULL DEFAULT 'main',
    85	    status TEXT DEFAULT 'idle' CHECK(status IN ('running', 'stopped', 'building', 'error', 'idle')),
    86	    assigned_port INTEGER UNIQUE,
    87	    container_id TEXT,
    88	    image_tag TEXT,
    89	    previous_image_tag TEXT,
    90	    public_url TEXT,
    91	    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    92	    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    93	    UNIQUE(project_id, type)
    94	  )`);
    95	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)');
    96
    97	  const envVarColumns = sqlite.prepare("PRAGMA table_info('env_vars')").all() as Array<{
    98	    name: string;
    99	  }>;
   100	  const envVarColumnNames = new Set(envVarColumns.map((c) => c.name));
   101	  const envVarTable = sqlite
   102	    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'env_vars'")
   103	    .get() as { sql: string | null } | undefined;
   104	  const hasLegacyProjectKeyUnique =
   105	    typeof envVarTable?.sql === 'string' && envVarTable.sql.includes('UNIQUE(project_id, key)');
   106
   107	  if (hasLegacyProjectKeyUnique) {
   108	    const environmentIdSelect = envVarColumnNames.has('environment_id')
   109	      ? 'environment_id'
   110	      : 'NULL AS environment_id';
   111
   112	    sqlite.exec(`CREATE TABLE env_vars_migrated (
   113	      id TEXT PRIMARY KEY,
   114	      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
   115	      environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
   116	      key TEXT NOT NULL,
   117	      value TEXT NOT NULL,
   118	      created_at TEXT DEFAULT CURRENT_TIMESTAMP
   119	    )`);
   120	    sqlite.exec(`INSERT INTO env_vars_migrated (
   121	      id,
   122	      project_id,
   123	      environment_id,
   124	      key,
   125	      value,
   126	      created_at
   127	    ) SELECT
   128	      id,
   129	      project_id,
   130	      ${environmentIdSelect},
   131	      key,
   132	      value,
   133	      created_at
   134	    FROM env_vars`);
   135	    sqlite.exec('DROP TABLE env_vars');
   136	    sqlite.exec('ALTER TABLE env_vars_migrated RENAME TO env_vars');
   137	  } else if (!envVarColumnNames.has('environment_id')) {
   138	    sqlite.exec(
   139	      'ALTER TABLE env_vars ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
   140	    );
   141	  }
   142
   143	  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_project');
   144	  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_environment');
   145	  sqlite.exec(
   146	    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_key_global_unique ON env_vars(project_id, key) WHERE environment_id IS NULL',
   147	  );
   148	  sqlite.exec(
   149	    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_environment_key_unique ON env_vars(project_id, environment_id, key) WHERE environment_id IS NOT NULL',
   150	  );
   151	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)');
   152	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON env_vars(environment_id)');
   153
   154	  sqlite.exec(`INSERT INTO environments (
   155	    id,
   156	    project_id,
   157	    type,
   158	    branch,
   159	    status,
   160	    assigned_port,
   161	    container_id,
   162	    image_tag,
   163	    previous_image_tag,
   164	    public_url
   165	  )
   166	  SELECT
   167	    lower(hex(randomblob(8))),
   168	    p.id,
   169	    'production',
   170	    COALESCE(p.branch, 'main'),
   171	    COALESCE(p.status, 'idle'),
   172	    p.assigned_port,
   173	    p.container_id,
   174	    p.image_tag,
   175	    p.previous_image_tag,
   176	    p.public_url
   177	  FROM projects p
   178	  WHERE NOT EXISTS (
   179	    SELECT 1 FROM environments e
   180	    WHERE e.project_id = p.id AND e.type = 'production'
   181	  )`);
   182
   183	  // deploy_logs migrations
   184	  const dlCols = sqlite.prepare("PRAGMA table_info('deploy_logs')").all() as Array<{
   185	    name: string;
   186	  }>;
   187	  const dlColNames = new Set(dlCols.map((c) => c.name));
   188
   189	  if (!dlColNames.has('trigger_source')) {
   190	    sqlite.exec(
   191	      "ALTER TABLE deploy_logs ADD COLUMN trigger_source TEXT CHECK(trigger_source IN ('chat', 'webhook', 'api'))",
   192	    );
   193	  }
   194	  if (!dlColNames.has('environment_id')) {
   195	    sqlite.exec(
   196	      'ALTER TABLE deploy_logs ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
   197	    );
   198	  }
   199	  if (!dlColNames.has('trigger_detail')) {
   200	    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN trigger_detail TEXT');
   201	  }
   202	  if (!dlColNames.has('commit_message')) {
   203	    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN commit_message TEXT');
   204	  }
   205	  if (!dlColNames.has('runtime_log')) {
   206	    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN runtime_log TEXT');
   207	  }
   208	  sqlite.exec(
   209	    'CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id)',
   210	  );
   211
   212	  // global_secrets table (v0.0.10)
   213	  sqlite.exec(`CREATE TABLE IF NOT EXISTS global_secrets (
   214	    id TEXT PRIMARY KEY,
   215	    key TEXT NOT NULL UNIQUE,
   216	    encrypted_value TEXT NOT NULL,
   217	    iv TEXT NOT NULL,
   218	    description TEXT,
   219	    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
   220	    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
   221	  )`);
   222	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key)');
   223
   224	  sqlite.exec(`CREATE TABLE IF NOT EXISTS services (
   225	    id TEXT PRIMARY KEY,
   226	    name TEXT NOT NULL UNIQUE,
   227	    type TEXT NOT NULL,
   228	    image TEXT NOT NULL,
   229	    status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
   230	    container_id TEXT,
   231	    container_name TEXT NOT NULL UNIQUE,
   232	    port INTEGER NOT NULL,
   233	    env_vars TEXT,
   234	    credentials TEXT,
   235	    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
   236	    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
   237	  )`);
   238	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');
   239
   240	  sqlite.exec(`CREATE TABLE IF NOT EXISTS timeline_events (
   241	    id TEXT PRIMARY KEY,
   242	    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
   243	    deploy_id TEXT,
   244	    type TEXT NOT NULL,
   245	    message TEXT NOT NULL,
   246	    detail TEXT,
   247	    severity TEXT,
   248	    percent INTEGER,
   249	    tool_name TEXT,
   250	    action_buttons TEXT,
   251	    created_at TEXT DEFAULT CURRENT_TIMESTAMP
   252	  )`);
   253	  sqlite.exec(
   254	    'CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at)',
   255	  );
   256
   257	  const svcTable = sqlite
   258	    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'services'")
   259	    .get() as { sql: string | null } | undefined;
   260	  const svcCols = sqlite.prepare("PRAGMA table_info('services')").all() as Array<{
   261	    name: string;
   262	  }>;
   263	  const svcColNames = new Set(svcCols.map((c) => c.name));
   264
   265	  const hasLegacyTypeCheck =
   266	    typeof svcTable?.sql === 'string' &&
   267	    svcTable.sql.includes("CHECK(type IN ('postgresql', 'mysql', 'redis', 'mongodb'))");
   268
   269	  if (hasLegacyTypeCheck) {
   270	    const envVarsSelect = svcColNames.has('env_vars') ? 'env_vars' : 'NULL';
   271
   272	    sqlite.exec(`CREATE TABLE services_migrated (
   273	      id TEXT PRIMARY KEY,
   274	      name TEXT NOT NULL UNIQUE,
   275	      type TEXT NOT NULL,
   276	      image TEXT NOT NULL,
   277	      status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
   278	      container_id TEXT,
   279	      container_name TEXT NOT NULL UNIQUE,
   280	      port INTEGER NOT NULL,
   281	      env_vars TEXT,
   282	      credentials TEXT,
   283	      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
   284	      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
   285	    )`);
   286	    sqlite.exec(`INSERT INTO services_migrated (
   287	      id,
   288	      name,
   289	      type,
   290	      image,
   291	      status,
   292	      container_id,
   293	      container_name,
   294	      port,
   295	      env_vars,
   296	      credentials,
   297	      created_at,
   298	      updated_at
   299	    ) SELECT
   300	      id,
   301	      name,
   302	      type,
   303	      image,
   304	      status,
   305	      container_id,
   306	      container_name,
   307	      port,
   308	      ${envVarsSelect},
   309	      credentials,
   310	      created_at,
   311	      updated_at
   312	    FROM services`);
   313	    sqlite.exec('DROP TABLE services');
   314	    sqlite.exec('ALTER TABLE services_migrated RENAME TO services');
   315	    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');
   316
   317	    // secret_files table (v0.4.2)
   318	    sqlite.exec(`CREATE TABLE IF NOT EXISTS secret_files (
   319	    id TEXT PRIMARY KEY,
   320	    project_id TEXT,

exec
/bin/bash -lc "nl -ba src/events/index.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * Event Bus for OpenLander.
     3	 *
     4	 * Central event system that decouples modules.
     5	 * v0.1 uses it for deploy lifecycle events.
     6	 * v0.2+ adds monitoring, webhook, and channel events.
     7	 *
     8	 * Pattern inspired by OpenClaw's hooks system but simplified
     9	 * for single-agent architecture.
    10	 */
    11
    12	import { createModuleLogger } from '../lib/logger.js';
    13	import type { BuildTier } from '../pipeline/build-recovery.js';
    14	import type { ChatStreamEvent } from '../types/agent-events.js';
    15	import type { Question } from '../lib/question-bridge.js';
    16	import type { Alert } from '../monitor/alerts.js';
    17	import type { RequestIdentity } from '../types/identity.js';
    18
    19	const log = createModuleLogger('events');
    20
    21	// --- Event types ---
    22	export type EventType =
    23	  // Deploy lifecycle
    24	  | 'deploy:start'
    25	  | 'deploy:clone'
    26	  | 'deploy:build'
    27	  | 'deploy:run'
    28	  | 'deploy:auto-detect'
    29	  | 'deploy:success'
    30	  | 'deploy:failed'
    31	  | 'deploy:needs-user-action'
    32	  | 'deploy:crash'
    33	  | 'deploy:rollback'
    34	  | 'build:suggest'
    35	  | 'build:inform'
    36	  | 'build:output'
    37	  | 'compose:start'
    38	  | 'compose:up'
    39	  | 'compose:down'
    40	  | 'compose:orphans-cleaned'
    41	  | 'compose:failed'
    42	  | 'orchestration:plan'
    43	  | 'orchestration:service-start'
    44	  | 'orchestration:service-healthy'
    45	  | 'orchestration:service-failed'
    46	  | 'orchestration:complete'
    47	  // Container lifecycle
    48	  | 'container:start'
    49	  | 'container:stop'
    50	  | 'container:remove'
    51	  | 'project:archive'
    52	  | 'project:unarchive'
    53	  | 'container:missing'
    54	  | 'container:health'
    55	  | 'container:die'
    56	  | 'container:oom'
    57	  // Tunnel
    58	  | 'tunnel:start'
    59	  | 'tunnel:stop'
    60	  | 'tunnel:url'
    61	  // Config changes
    62	  | 'env:set'
    63	  | 'env:delete'
    64	  // v0.2: Monitoring
    65	  | 'monitor:healthcheck'
    66	  | 'monitor:inactive'
    67	  // v0.3: MCP
    68	  | 'mcp:connect'
    69	  | 'mcp:disconnect'
    70	  // v0.4: Channels
    71	  | 'channel:message'
    72	  | 'channel:connect'
    73	  // v0.5: Alerts
    74	  | 'alert:new'
    75	  | 'alert:resolved'
    76	  | 'alert:dismissed'
    77	  // v0.7: Agent questions
    78	  | 'question:pending'
    79	  | 'question:answered'
    80	  // v0.2.0: Agent events (deploy UX fix)
    81	  | 'agent:event'
    82	  | 'ai:invoked'
    83	  | 'ai:completed'
    84	  | 'health:degraded'
    85	  | 'recovery:blocked'
    86	  | 'recovery:stopped'
    87	  | 'recovery:started'
    88	  | 'recovery:start'
    89	  | 'recovery:success'
    90	  | 'recovery:failed'
    91	  | 'recovery:exhausted'
    92	  | 'recovery:approval-needed'
    93	  | 'recovery:approval-resolved'
    94	  | 'env:new-keys-detected'
    95	  | 'rollback:suggested'
    96	  | 'secret:detected'
    97	  | 'deploy:diff-analyzed';
    98
    99	export interface EventPayload {
   100	  'deploy:start': {
   101	    projectId: string;
   102	    repoUrl: string;
   103	    parentProjectId?: string;
   104	    phase?: string;
   105	    scope?: string;
   106	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   107	    message?: string;
   108	  };
   109	  'deploy:clone': {
   110	    projectId: string;
   111	    path: string;
   112	    commitSha: string;
   113	    parentProjectId?: string;
   114	    phase?: string;
   115	    scope?: string;
   116	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   117	    message?: string;
   118	  };
   119	  'deploy:build': {
   120	    projectId: string;
   121	    imageTag: string;
   122	    durationMs: number;
   123	    parentProjectId?: string;
   124	    phase?: string;
   125	    scope?: string;
   126	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   127	    message?: string;
   128	  };
   129	  'deploy:run': {
   130	    projectId: string;
   131	    containerId: string;
   132	    port: number;
   133	    url: string;
   134	    parentProjectId?: string;
   135	    phase?: string;
   136	    scope?: string;
   137	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   138	    message?: string;
   139	  };
   140	  'deploy:auto-detect': { projectId: string; framework: string; type: 'dockerfile' | 'compose' };
   141	  'deploy:success': {
   142	    projectId: string;
   143	    url: string;
   144	    totalDurationMs: number;
   145	    parentProjectId?: string;
   146	    phase?: string;
   147	    scope?: string;
   148	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   149	    message?: string;
   150	    planId?: string;
   151	  };
   152	  'deploy:failed': {
   153	    projectId: string;
   154	    step: string;
   155	    error: string;
   156	    buildLog?: string;
   157	    diffContext?: string;
   158	    parentProjectId?: string;
   159	    phase?: string;
   160	    scope?: string;
   161	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   162	    message?: string;
   163	    durationMs?: number;
   164	    /** When 'mcp', auto-recovery is skipped — the MCP client agent handles failure. */
   165	    source?: 'mcp' | 'dashboard' | 'webhook';
   166	  };
   167	  'deploy:needs-user-action': {
   168	    projectId: string;
   169	    category: string;
   170	    title: string;
   171	    description: string;
   172	    userSteps: Array<{ label: string; actionUrl?: string }>;
   173	  };
   174	  'deploy:crash': { projectId: string; containerId: string; error?: string; exitCode?: number };
   175	  'deploy:rollback': { projectId: string; fromImage: string; toImage: string };
   176	  'build:suggest': { projectId: string; suggestion: string; diff?: string };
   177	  'build:inform': { projectId: string; summary: string; tier: BuildTier };
   178	  'build:output': {
   179	    projectId: string;
   180	    line: string;
   181	    stream: 'stdout' | 'error';
   182	    parentProjectId?: string;
   183	    phase?: string;
   184	    scope?: string;
   185	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   186	    message?: string;
   187	    durationMs?: number;
   188	    logChunk?: string;
   189	  };
   190	  'compose:start': { projectId: string; composePath: string; serviceCount: number };
   191	  'compose:up': { projectId: string; services: string[] };
   192	  'compose:down': { projectId: string };
   193	  'compose:orphans-cleaned': { projectId: string; removed: string[] };
   194	  'compose:failed': { projectId: string; error: string };
   195	  'orchestration:plan': {
   196	    topology: {
   197	      services: Array<{
   198	        name: string;
   199	        dockerfile?: string;
   200	        composePath?: string;
   201	        dependsOn: string[];
   202	        port?: number;
   203	        envVars?: Record<string, string>;
   204	      }>;
   205	      executionOrder: string[][];
   206	      repoUrl: string;
   207	      branch?: string;
   208	      clonePath: string;
   209	      commitSha: string;
   210	    };
   211	  };
   212	  'orchestration:service-start': { serviceName: string };
   213	  'orchestration:service-healthy': { serviceName: string };
   214	  'orchestration:service-failed': { serviceName: string; error: string };
   215	  'orchestration:complete': {
   216	    result: {
   217	      success: boolean;
   218	      services: Array<{
   219	        name: string;
   220	        status: 'deployed' | 'failed' | 'rolled_back' | 'skipped';
   221	        projectId?: string;
   222	        url?: string;
   223	        error?: string;
   224	        duration?: number;
   225	      }>;
   226	      totalDuration: number;
   227	    };
   228	  };
   229	  'container:start': { projectId: string; containerId: string };
   230	  'container:stop': { projectId: string; containerId: string };
   231	  'container:remove': { projectId: string; containerId: string };
   232	  'project:archive': { projectId: string };
   233	  'project:unarchive': { projectId: string; port: number };
   234	  'container:missing': {
   235	    projectId: string;
   236	    projectName: string;
   237	    containerId: string;
   238	    suggestion: string;
   239	  };
   240	  'container:health': { projectId: string; healthy: boolean };
   241	  'container:die': {
   242	    projectId: string;
   243	    containerId: string;
   244	    containerName: string;
   245	    exitCode: number;
   246	  };
   247	  'container:oom': {
   248	    projectId: string;
   249	    containerId: string;
   250	    containerName: string;
   251	  };
   252	  'tunnel:start': { projectId: string; localPort: number };
   253	  'tunnel:stop': { projectId: string };
   254	  'tunnel:url': { projectId: string; url: string };
   255	  'env:set': { projectId: string; key: string };
   256	  'env:delete': { projectId: string; key: string };
   257	  'monitor:healthcheck': { projectId: string; healthy: boolean; responseTimeMs: number };
   258	  'monitor:inactive': { projectId: string; daysSinceLastAccess: number };
   259	  'mcp:connect': { clientId: string };
   260	  'mcp:disconnect': { clientId: string };
   261	  'channel:message': { channelType: string; content: string; sender: string };
   262	  'channel:connect': { channelType: string };
   263	  'alert:new': { alert: Alert };
   264	  'alert:resolved': { alertId: string; type: Alert['type'] };
   265	  'alert:dismissed': { alertId: string };
   266	  'question:pending': { projectId: string; requestId: string; questions: Question[] };
   267	  'question:answered': { projectId: string; requestId: string };
   268	  'agent:event': {
   269	    projectId: string;
   270	    event: ChatStreamEvent & { timestamp: string };
   271	    identity?: RequestIdentity;
   272	  };
   273	  'ai:invoked': {
   274	    projectId: string;
   275	    source: string;
   276	    model: string;
   277	    action: string;
   278	    correlationId?: string;
   279	  };
   280	  'ai:completed': {
   281	    projectId: string;
   282	    source: string;
   283	    model: string;
   284	    action: string;
   285	    durationMs: number;
   286	    inputTokens?: number;
   287	    outputTokens?: number;
   288	    success: boolean;
   289	    correlationId?: string;
   290	  };
   291	  'health:degraded': {
   292	    projectId: string;
   293	    consecutiveFailures: number;
   294	    lastError: string | null;
   295	  };
   296	  'recovery:blocked': {
   297	    projectId: string;
   298	    reason: string;
   299	  };
   300	  'recovery:stopped': {
   301	    projectId: string;
   302	    reason: string;
   303	    correlationId?: string;
   304	  };
   305	  'recovery:started': {
   306	    projectId: string;
   307	    trigger: string;
   308	    correlationId?: string;
   309	  };
   310	  'recovery:start': {
   311	    projectId: string;
   312	    error: string;
   313	    attempt: number;
   314	    source?: string;
   315	    identity?: RequestIdentity;
   316	    correlationId?: string;
   317	  };
   318	  'recovery:success': {
   319	    projectId: string;
   320	    attempt: number;

exec
/bin/bash -lc "nl -ba src/pipeline/auto-recovery.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { nanoid } from 'nanoid';
     2
     3	import type { ChatStreamEvent } from '../types/agent-events.js';
     4	import type { BuildDebugger } from './build-debugger.js';
     5	import type { Database } from '../db/index.js';
     6	import type { EventBus } from '../events/index.js';
     7	import type { EventPayload } from '../events/index.js';
     8	import type { QuestionBridge } from '../lib/question-bridge.js';
     9	import { createModuleLogger } from '../lib/logger.js';
    10	import { buildContextSnapshot } from '../llm/context-assembler.js';
    11	import { dispatchRecovery, type Locale, type RecoveryPlan } from './recovery-dispatch.js';
    12	import { matchRecipe, type RecipeAction } from './recipes.js';
    13	import type { DeployQueue } from './deploy-queue.js';
    14	import type { DeployPipeline } from './deploy.js';
    15	import type { OpenLanderConfig } from '../config/index.js';
    16	import { ApprovalGate, type ApprovalGate as ApprovalGateType } from './approval-gate.js';
    17	import { decisionEngine } from '../llm/decision.js';
    18	import type { PendingFixPatch } from './deploy/helpers.js';
    19	import { findMatchingPatterns, saveRecoveryPattern } from '../llm/memory.js';
    20
    21	const log = createModuleLogger('auto-recovery');
    22
    23	const RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS = 300_000;
    24	const RECOVERY_OUTCOME_MAX_TIMEOUT_MS = 600_000;
    25	const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
    26
    27	type RecoveryStrategy = 'recipe' | 'llm';
    28
    29	interface GateCheckResult {
    30	  blocked: boolean;
    31	  reason?: 'infra-error';
    32	}
    33
    34	export interface AutoRecoveryAgent {
    35	  chatStream(
    36	    input: string,
    37	    onEvent: (event: ChatStreamEvent) => Promise<void>,
    38	    sessionId?: string,
    39	    scope?: { type: string; projectId?: string },
    40	  ): Promise<void>;
    41	}
    42
    43	export interface SetupAutoRecoveryParams {
    44	  eventBus: EventBus;
    45	  agent: AutoRecoveryAgent | null;
    46	  db: Database;
    47	  buildDebugger: BuildDebugger | null;
    48	  deployQueue: DeployQueue;
    49	  pipeline: DeployPipeline;
    50	  questionBridge: QuestionBridge;
    51	  approvalGate?: ApprovalGateType;
    52	  language: Locale;
    53	  config: OpenLanderConfig;
    54	  shouldContinue?: (projectId: string) => boolean;
    55	}
    56
    57	export interface AutoRecoveryHandlers {
    58	  handleDeploymentRecovery(
    59	    projectId: string,
    60	    error: string,
    61	    step?: string,
    62	    buildLog?: string,
    63	    eventType?: 'deploy:failed' | 'compose:failed',
    64	  ): Promise<void>;
    65	  handleEnvNewKeysDetected(payload: EventPayload['env:new-keys-detected']): Promise<void>;
    66	  handleSecretDetected(payload: EventPayload['secret:detected']): Promise<void>;
    67	  handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void>;
    68	  resolveApproval(actionRunId: string, approved: boolean): void;
    69	}
    70
    71	function normalizeError(error: string): string {
    72	  return error
    73	    .replace(/[0-9a-f]{8,}/gi, '<id>')
    74	    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
    75	    .replace(/:\d{4,5}/g, ':<port>')
    76	    .replace(/\s+/g, ' ')
    77	    .trim();
    78	}
    79
    80	function isRecent(createdAt: string, nowMs: number): boolean {
    81	  const ts = new Date(createdAt).getTime();
    82	  if (!Number.isFinite(ts)) {
    83	    return false;
    84	  }
    85	  return ts > nowMs - RECOVERY_WINDOW_MS;
    86	}
    87
    88	function getDynamicOutcomeTimeoutMs(db: Database, projectId: string): number {
    89	  const logs = db.getDeployLogs(projectId, 10);
    90	  const durations = logs
    91	    .map((logRow) => logRow.duration_ms)
    92	    .filter((duration): duration is number => typeof duration === 'number' && duration > 0);
    93
    94	  if (durations.length === 0) {
    95	    return RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS;
    96	  }
    97
    98	  const averageDuration =
    99	    durations.reduce((sum, duration) => sum + duration, 0) / Math.max(durations.length, 1);
   100
   101	  const buffered = Math.round(averageDuration * 1.5);
   102	  return Math.min(
   103	    Math.max(buffered, RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS),
   104	    RECOVERY_OUTCOME_MAX_TIMEOUT_MS,
   105	  );
   106	}
   107
   108	function runGateChecks(projectId: string, error: string, db: Database): GateCheckResult {
   109	  const infraPatterns = [
   110	    /docker daemon/i,
   111	    /cannot connect to docker/i,
   112	    /permission denied.*docker/i,
   113	  ];
   114	  if (infraPatterns.some((pattern) => pattern.test(error))) {
   115	    return { blocked: true, reason: 'infra-error' };
   116	  }
   117
   118	  void projectId;
   119	  void db;
   120
   121	  return { blocked: false };
   122	}
   123
   124	async function emitTimelineMessage(
   125	  eventBus: EventBus,
   126	  projectId: string,
   127	  content: string,
   128	): Promise<void> {
   129	  const event: ChatStreamEvent & { timestamp: string } = {
   130	    type: 'message',
   131	    content,
   132	    timestamp: new Date().toISOString(),
   133	  };
   134
   135	  await eventBus.emit('agent:event', {
   136	    projectId,
   137	    event,
   138	  });
   139	}
   140
   141	function waitForRecoveryOutcome(
   142	  eventBus: EventBus,
   143	  projectId: string,
   144	  timeoutMs: number,
   145	): Promise<{ success: boolean; timedOut: boolean }> {
   146	  return new Promise((resolve) => {
   147	    let settled = false;
   148	    let unsubscribeSuccess: () => void = () => undefined;
   149	    let unsubscribeFailed: () => void = () => undefined;
   150	    const subscribeOnce = eventBus['once'].bind(eventBus);
   151
   152	    const finalize = (success: boolean, timedOut: boolean): void => {
   153	      if (settled) {
   154	        return;
   155	      }
   156
   157	      settled = true;
   158	      clearTimeout(timer);
   159	      unsubscribeSuccess();
   160	      unsubscribeFailed();
   161	      resolve({ success, timedOut });
   162	    };
   163
   164	    const waitForSuccess = (): void => {
   165	      unsubscribeSuccess = subscribeOnce('deploy:success', (payload) => {
   166	        if (payload.projectId === projectId) {
   167	          finalize(true, false);
   168	          return;
   169	        }
   170
   171	        waitForSuccess();
   172	      });
   173	    };
   174
   175	    const waitForFailure = (): void => {
   176	      unsubscribeFailed = subscribeOnce('deploy:failed', (payload) => {
   177	        if (payload.projectId === projectId) {
   178	          finalize(false, false);
   179	          return;
   180	        }
   181
   182	        waitForFailure();
   183	      });
   184	    };
   185
   186	    waitForSuccess();
   187	    waitForFailure();
   188
   189	    const timer = setTimeout(() => {
   190	      finalize(false, true);
   191	    }, timeoutMs);
   192	  });
   193	}
   194
   195	function mapFailStep(step?: string): 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime' {
   196	  if (step === 'clone' || step === 'dockerfile' || step === 'build' || step === 'run') {
   197	    return step;
   198	  }
   199
   200	  return 'runtime';
   201	}
   202
   203	function selectRecoveryStrategy(recipeMatched: boolean, hasAgent: boolean): RecoveryStrategy {
   204	  if (recipeMatched || !hasAgent) {
   205	    return 'recipe';
   206	  }
   207
   208	  return 'llm';
   209	}
   210
   211	function buildPendingFixFromAction(
   212	  action: RecipeAction,
   213	): { filePath: string; patches: PendingFixPatch[] } | null {
   214	  switch (action.type) {
   215	    case 'dockerfile_replace_pattern':
   216	      return {
   217	        filePath: 'Dockerfile',
   218	        patches: [{ pattern: action.pattern, replacement: action.replacement, flags: 'gm' }],
   219	      };
   220	    case 'dockerfile_add_line': {
   221	      const insertBefore = action.position === 'before';
   222	      const replacement = insertBefore ? `${action.line}\n$&` : `$&\n${action.line}`;
   223	      return {
   224	        filePath: 'Dockerfile',
   225	        patches: [{ pattern: action.anchor, replacement, flags: 'm' }],
   226	      };
   227	    }
   228	    case 'set_env':
   229	    case 'retry_no_cache':
   230	    case 'skip':
   231	      return null;
   232	  }
   233	}
   234
   235	/**
   236	 * Registers automatic recovery handlers for deploy/runtime failures.
   237	 *
   238	 * - LLM mode (`agent !== null`): streams agent-driven analysis and recovery.
   239	 * - Programmatic mode (`agent === null`): recipe match + optional debugger + single redeploy retry.
   240	 */
   241	const mcpDeployTimers = new Map<string, ReturnType<typeof setTimeout>>();
   242
   243	export function markMcpDeploy(projectId: string): void {
   244	  const existing = mcpDeployTimers.get(projectId);
   245	  if (existing) clearTimeout(existing);
   246	  const timer = setTimeout(() => mcpDeployTimers.delete(projectId), 10 * 60 * 1000);
   247	  mcpDeployTimers.set(projectId, timer);
   248	}
   249
   250	export function consumeMcpDeploy(projectId: string): boolean {
   251	  const existing = mcpDeployTimers.get(projectId);
   252	  if (!existing) {
   253	    return false;
   254	  }
   255
   256	  clearTimeout(existing);
   257	  mcpDeployTimers.delete(projectId);
   258	  return true;
   259	}
   260

exec
/bin/bash -lc "nl -ba src/monitor/ops-recovery.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { randomUUID } from 'node:crypto';
     2	import { generateText } from 'ai';
     3
     4	import type { AppContext } from '../app.js';
     5	import type { OpsIncidentEventRow } from '../db/types.js';
     6	import { createModuleLogger } from '../lib/logger.js';
     7	import { createModelProxy } from '../llm/model-proxy.js';
     8	import { eventBus } from '../events/index.js';
     9	import type {
    10	  ApprovalMetadata,
    11	  ApprovalResult,
    12	  ApprovalGate as ApprovalGateType,
    13	} from '../pipeline/approval-gate.js';
    14	import type { ConfigurableRecoveryStep, RecoveryAutomationPolicy } from './ops-types.js';
    15
    16	const log = createModuleLogger('ops-recovery');
    17
    18	const HEALTH_CHECK_ATTEMPTS = 3;
    19	const HEALTH_CHECK_INTERVAL_MS = 30_000;
    20
    21	type Locale = 'en' | 'ko';
    22
    23	const RECOVERY_MESSAGES: Record<
    24	  Locale,
    25	  {
    26	    diagnosisPrompt: (name: string, reason: string) => string;
    27	    fixesWithDiagnosis: (name: string, reason: string, diagnosis: string) => string;
    28	    fixesNoDiagnosis: (name: string, reason: string) => string;
    29	    rollback: (name: string, reason: string) => string;
    30	    llmSystemPrompt: string;
    31	  }
    32	> = {
    33	  ko: {
    34	    diagnosisPrompt: (name, reason) =>
    35	      `[${name}] ${reason}\nLLM을 통한 크래시 원인 분석을 실행합니다.`,
    36	    fixesWithDiagnosis: (name, reason, diagnosis) =>
    37	      `[${name}]\n\n📌 원인\n${reason}\n\n🔍 진단\n${diagnosis.slice(0, 200)}\n\n🔧 조치\n자동 수정을 적용합니다.`,
    38	    fixesNoDiagnosis: (name, reason) =>
    39	      `[${name}]\n\n📌 원인\n${reason}\n\n🔧 조치\n자동 수정을 적용합니다.`,
    40	    rollback: (name, reason) =>
    41	      `[${name}]\n\n📌 원인\n${reason}\n\n⏪ 조치\n재시작 및 수정 실패. 이전 버전으로 롤백합니다.`,
    42	    llmSystemPrompt:
    43	      '크래시된 Docker 서비스를 진단합니다. 근본 원인과 즉시 조치 방안을 간결한 한국어로 작성하세요. 기술 용어(Docker, container, OOM 등)는 영어 유지.',
    44	  },
    45	  en: {
    46	    diagnosisPrompt: (name, reason) =>
    47	      `[${name}] ${reason}\nRunning LLM-based crash root cause analysis.`,
    48	    fixesWithDiagnosis: (name, reason, diagnosis) =>
    49	      `[${name}]\n\n📌 Cause\n${reason}\n\n🔍 Diagnosis\n${diagnosis.slice(0, 200)}\n\n🔧 Action\nApplying automatic fixes.`,
    50	    fixesNoDiagnosis: (name, reason) =>
    51	      `[${name}]\n\n📌 Cause\n${reason}\n\n🔧 Action\nApplying automatic fixes.`,
    52	    rollback: (name, reason) =>
    53	      `[${name}]\n\n📌 Cause\n${reason}\n\n⏪ Action\nRestart and fixes failed. Rolling back to previous version.`,
    54	    llmSystemPrompt:
    55	      'You diagnose crashed Dockerized services. Return concise root cause and immediate remediation steps in plain text.',
    56	  },
    57	};
    58
    59	export interface RecoveryContext {
    60	  projectId: string;
    61	  projectName: string;
    62	  containerId: string;
    63	  incidentId: string | null;
    64	  automationPolicy: RecoveryAutomationPolicy;
    65	  actionRunId: string;
    66	}
    67
    68	type RecoveryOutcome = 'recovered' | 'escalated' | 'skipped';
    69	type RecoveryExecuteContext = Omit<RecoveryContext, 'actionRunId'>;
    70	type RecoveryContextForGuards = RecoveryExecuteContext | RecoveryContext;
    71
    72	export class RecoveryPipeline {
    73	  private readonly ctx: AppContext;
    74	  private readonly approvalGate: ApprovalGateType;
    75	  private readonly activeRecoveries = new Set<string>();
    76
    77	  constructor(ctx: AppContext, approvalGate: ApprovalGateType) {
    78	    this.ctx = ctx;
    79	    this.approvalGate = approvalGate;
    80	  }
    81
    82	  private getLocale(): Locale {
    83	    return this.ctx.config.language === 'ko' ? 'ko' : 'en';
    84	  }
    85
    86	  private get msg() {
    87	    return RECOVERY_MESSAGES[this.getLocale()];
    88	  }
    89
    90	  async execute(context: RecoveryExecuteContext): Promise<RecoveryOutcome> {
    91	    const { projectId, incidentId } = context;
    92
    93	    if (!this.isProductionRecovery(context)) {
    94	      this.addIncidentEvent(
    95	        incidentId,
    96	        'interrupted',
    97	        'Recovery skipped because target is not production environment',
    98	      );
    99	      return 'skipped';
   100	    }
   101
   102	    if (this.ctx.db.isCircuitBreakerOpen(projectId)) {
   103	      log.warn({ projectId }, 'Circuit breaker open — skipping recovery');
   104	      await this.escalate(context, 'Circuit breaker open — too many failures');
   105	      return 'skipped';
   106	    }
   107
   108	    const isHalfOpenAttempt = this.ctx.db.getCircuitBreakerState(projectId)?.state === 'half_open';
   109
   110	    if (this.activeRecoveries.has(projectId)) {
   111	      log.warn({ projectId }, 'Recovery already in progress — skipping');
   112	      return 'skipped';
   113	    }
   114
   115	    const actionRunId = this.ctx.db.createActionRun({
   116	      projectId,
   117	      triggerSource: 'auto_recovery',
   118	      recoveryStrategy: 'recipe',
   119	      correlationId: incidentId ?? undefined,
   120	    });
   121
   122	    const executionContext: RecoveryContext = {
   123	      ...context,
   124	      actionRunId,
   125	    };
   126
   127	    this.activeRecoveries.add(projectId);
   128	    try {
   129	      const outcome = await this.runRecoverySequence(executionContext);
   130	      if (isHalfOpenAttempt && outcome === 'escalated') {
   131	        this.ctx.db.openCircuitBreaker(projectId);
   132	        log.warn({ projectId }, 'Half-open recovery attempt failed — circuit breaker re-opened');
   133	      }
   134	      this.ctx.db.updateActionRunStatus(
   135	        actionRunId,
   136	        outcome === 'recovered' ? 'succeeded' : 'failed',
   137	        outcome === 'escalated' ? 'Recovery pipeline exhausted' : undefined,
   138	      );
   139	      return outcome;
   140	    } catch (error) {
   141	      this.ctx.db.updateActionRunStatus(
   142	        actionRunId,
   143	        'failed',
   144	        error instanceof Error ? error.message : String(error),
   145	      );
   146	      throw error;
   147	    } finally {
   148	      this.activeRecoveries.delete(projectId);
   149	    }
   150	  }
   151
   152	  private async gateStep(
   153	    context: RecoveryContext,
   154	    step: ConfigurableRecoveryStep,
   155	    description: string,
   156	  ): Promise<'proceed' | 'rejected' | 'timed_out'> {
   157	    const mode = context.automationPolicy[step];
   158	    if (mode === 'auto') {
   159	      return 'proceed';
   160	    }
   161
   162	    this.ctx.db.updateActionRunStatus(context.actionRunId, 'pending_approval');
   163	    this.ctx.db.updateActionRunApproval(context.actionRunId, 'pending', step);
   164	    this.ctx.db.updateActionRunPlan(context.actionRunId, description);
   165
   166	    await eventBus.emit('recovery:approval-needed', {
   167	      projectId: context.projectId,
   168	      actionRunId: context.actionRunId,
   169	      toolName: step,
   170	      attempt: 1,
   171	      source: 'ops_recovery',
   172	      correlationId: context.incidentId ?? undefined,
   173	    });
   174
   175	    const metadata: ApprovalMetadata = {
   176	      projectId: context.projectId,
   177	      projectName: context.projectName,
   178	      toolName: step,
   179	      attempt: 1,
   180	      actionRunId: context.actionRunId,
   181	      createdAt: new Date(),
   182	    };
   183
   184	    const result: ApprovalResult = await this.approvalGate.waitForApproval(
   185	      context.actionRunId,
   186	      metadata,
   187	    );
   188
   189	    if (result === 'approved') {
   190	      this.ctx.db.updateActionRunStatus(context.actionRunId, 'running');
   191	      this.ctx.db.updateActionRunApproval(context.actionRunId, 'approved', step);
   192	      return 'proceed';
   193	    }
   194
   195	    this.ctx.db.updateActionRunApproval(context.actionRunId, 'rejected', step);
   196	    return result;
   197	  }
   198
   199	  private async runRecoverySequence(context: RecoveryContext): Promise<RecoveryOutcome> {
   200	    const { projectId, containerId, incidentId } = context;
   201	    const project = this.ctx.db.getProject(projectId);
   202
   203	    if (!project) {
   204	      log.error({ projectId }, 'Project not found for recovery');
   205	      await this.escalate(context, 'Project not found for recovery');
   206	      return 'escalated';
   207	    }
   208
   209	    if (project.deploy_lock_session) {
   210	      this.addIncidentEvent(
   211	        incidentId,
   212	        'interrupted',
   213	        'Deploy lock is held by another process — recovery skipped',
   214	      );
   215	      log.info(
   216	        { projectId, lockSession: project.deploy_lock_session },
   217	        'Deploy lock held — skipping',
   218	      );
   219	      return 'skipped';
   220	    }
   221
   222	    const restartGate = await this.gateStep(context, 'restart', 'Container restart');
   223	    if (restartGate !== 'proceed') {
   224	      return await this.escalate(
   225	        context,
   226	        `Recovery gated: restart step ${restartGate} by operator`,
   227	      );
   228	    }
   229
   230	    this.addIncidentEvent(incidentId, 'action_taken', 'Step restart: attempting container restart');
   231	    const restartResult = await this.restartContainer(projectId, containerId);
   232	    if (!restartResult.success) {
   233	      this.incrementAndCheckBreaker(projectId);
   234	      const restartFailureReason = `Restart failed: ${restartResult.reason}`;
   235
   236	      const diagnosisGate = await this.gateStep(
   237	        context,
   238	        'diagnosis',
   239	        this.msg.diagnosisPrompt(context.projectName, restartFailureReason),
   240	      );
   241	      if (diagnosisGate !== 'proceed') {
   242	        return await this.escalate(
   243	          context,
   244	          `Recovery gated: diagnosis step ${diagnosisGate} by operator`,
   245	        );
   246	      }
   247
   248	      this.addIncidentEvent(
   249	        context.incidentId,
   250	        'diagnosed',
   251	        `Step diagnosis: ${restartFailureReason}`,
   252	      );
   253
   254	      const restartLogs = await this.readContainerLogs(context.containerId);
   255	      const restartDiagnosis = await this.generateDiagnosis(
   256	        context,
   257	        restartFailureReason,
   258	        restartLogs,
   259	      );
   260	      if (restartDiagnosis && context.incidentId) {
   261	        this.ctx.db.updateOpsIncident(context.incidentId, {
   262	          diagnosis: restartDiagnosis,
   263	          root_cause: restartFailureReason,
   264	        });
   265	      }
   266
   267	      let restartFixNotes: string[] = [];
   268	      const fixesDesc = restartDiagnosis
   269	        ? this.msg.fixesWithDiagnosis(context.projectName, restartFailureReason, restartDiagnosis)
   270	        : this.msg.fixesNoDiagnosis(context.projectName, restartFailureReason);
   271	      const fixesGate = await this.gateStep(context, 'apply_fixes', fixesDesc);
   272	      if (fixesGate === 'proceed') {
   273	        restartFixNotes = await this.applyFixes(context, restartLogs);
   274	        if (restartFixNotes.length > 0) {
   275	          this.addIncidentEvent(
   276	            context.incidentId,
   277	            'action_taken',
   278	            `Step fix: ${restartFixNotes.join(' | ')}`,
   279	          );
   280	          if (context.incidentId) {
   281	            this.ctx.db.updateOpsIncident(context.incidentId, {
   282	              actions_taken: restartFixNotes.join('\n'),
   283	            });
   284	          }
   285	        }
   286	      }
   287
   288	      const rollbackDesc = this.msg.rollback(context.projectName, restartFailureReason);
   289	      const rollbackGate = await this.gateStep(context, 'rollback', rollbackDesc);
   290	      if (rollbackGate !== 'proceed') {
   291	        return await this.escalate(
   292	          context,
   293	          `Recovery gated: rollback step ${rollbackGate} by operator`,
   294	        );
   295	      }
   296
   297	      return await this.tryRollback(
   298	        context,
   299	        `${restartFailureReason}; ${restartFixNotes.join('; ')}`,
   300	      );
   301	    }
   302
   303	    this.addIncidentEvent(
   304	      incidentId,
   305	      'action_taken',
   306	      'Step healthcheck: waiting for HTTP and container health checks',
   307	    );
   308	    const healthy = await this.waitForHealthy(projectId, containerId);
   309	    if (healthy) {
   310	      this.addIncidentEvent(incidentId, 'recovered', 'Container recovered after restart');
   311	      if (incidentId) {
   312	        this.ctx.db.updateOpsIncidentStatus(incidentId, 'resolved', { resolved_at: Date.now() });
   313	      }
   314	      return 'recovered';
   315	    }
   316
   317	    this.incrementAndCheckBreaker(projectId);
   318	    const healthFailureReason = 'Health check failed after restart (3 attempts over 90 seconds)';
   319
   320	    const diagnosisGate = await this.gateStep(

exec
/bin/bash -lc "nl -ba src/app.ts | sed -n '1,360p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { Database } from './db/index.js';
     2	import { Docker } from './pipeline/docker.js';
     3	import { DeployPipeline } from './pipeline/deploy.js';
     4	import { TraefikManager } from './pipeline/traefik.js';
     5	import { EnvManager } from './pipeline/env.js';
     6	import { Agent } from './llm/agent.js';
     7	import { DeployQueue } from './pipeline/deploy-queue.js';
     8	import { QuestionBridge } from './lib/question-bridge.js';
     9	import { ModelRegistry } from './llm/model-registry.js';
    10	import { createModelProxy } from './llm/model-proxy.js';
    11	import { HealthMonitor } from './monitor/health.js';
    12	import { WebhookManager } from './webhook/index.js';
    13	import { CloudflareTunnelManager } from './pipeline/cloudflare.js';
    14
    15	import { ServiceManager } from './pipeline/service-manager.js';
    16	import { BuildDebugger } from './pipeline/build-debugger.js';
    17	import { ChannelManager } from './channels/base.js';
    18	import { PreviewDeployer } from './pipeline/preview.js';
    19	import { JobManager } from './pipeline/job-manager.js';
    20	import { ComposePipeline } from './pipeline/compose.js';
    21	import { AutoDetector } from './pipeline/auto-detect.js';
    22	import { AlertMonitor } from './monitor/alerts.js';
    23	import { DockerEventListener } from './monitor/docker-events.js';
    24	import { IncidentReporter } from './monitor/incident-reporter.js';
    25	import {
    26	  PostmortemGenerator,
    27	  setPostmortemInstance,
    28	  getPostmortemInstance,
    29	} from './monitor/postmortem.js';
    30	import { RollbackWatcher } from './monitor/rollback-watcher.js';
    31	import { ActivityLogger } from './monitor/activity-logger.js';
    32	import { McpClientManager } from './mcp/client-manager.js';
    33	import { PlanEngine } from './pipeline/deploy-plan/engine.js';
    34	import { RecoveryCoordinator } from './monitor/recovery-coordinator.js';
    35	import { eventBus } from './events/index.js';
    36	import type { EventBus } from './events/index.js';
    37	import type { OpenLanderConfig } from './config/index.js';
    38	import { normalizeLlmConfig } from './config/index.js';
    39	import type { LanguageModel } from 'ai';
    40	import { buildContextSnapshot } from './llm/prompts.js';
    41	import { createModuleLogger } from './lib/logger.js';
    42	import { setupAutoRecovery } from './pipeline/auto-recovery.js';
    43	import { AgentPool } from './llm/agent-pool.js';
    44	import { createTools } from './tools/index.js';
    45	import { ApprovalGate } from './pipeline/approval-gate.js';
    46	import type { OpsAgent } from './monitor/ops-agent.js';
    47
    48	const log = createModuleLogger('app');
    49
    50	let activeIncidentReporter: IncidentReporter | null = null;
    51	let activeRollbackWatcher: RollbackWatcher | null = null;
    52	let activePostmortemAutomationStop: (() => void) | null = null;
    53	let activeActivityLogger: ActivityLogger | null = null;
    54	let activeActivityLogCleanupInterval: ReturnType<typeof setInterval> | null = null;
    55
    56	const POSTMORTEM_STABILITY_WINDOW_MS = 5 * 60 * 1000;
    57	const ACTIVITY_LOG_TTL_DAYS = 30;
    58	const ACTIVITY_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    59	const POSTMORTEM_CANCEL_EVENTS = [
    60	  'recovery:failed',
    61	  'recovery:exhausted',
    62	  'deploy:failed',
    63	] as const;
    64
    65	type PostmortemProjectLookup = Pick<Database, 'getProject'>;
    66	type PostmortemGeneratorLike = Pick<PostmortemGenerator, 'generatePostmortem'>;
    67
    68	interface RecoveryPostmortemAutomationOptions {
    69	  eventBus: EventBus;
    70	  db: PostmortemProjectLookup;
    71	  getPostmortem: () => PostmortemGeneratorLike | null;
    72	  isEligible?: (projectId: string) => boolean;
    73	  delayMs?: number;
    74	}
    75
    76	export function setupRecoveryPostmortemAutomation({
    77	  eventBus,
    78	  db,
    79	  getPostmortem,
    80	  isEligible,
    81	  delayMs = POSTMORTEM_STABILITY_WINDOW_MS,
    82	}: RecoveryPostmortemAutomationOptions): () => void {
    83	  const postmortemTimers = new Map<string, ReturnType<typeof setTimeout>>();
    84	  const cancelTimer = (projectId: string): void => {
    85	    const existingTimer = postmortemTimers.get(projectId);
    86	    if (!existingTimer) {
    87	      return;
    88	    }
    89
    90	    clearTimeout(existingTimer);
    91	    postmortemTimers.delete(projectId);
    92	  };
    93
    94	  const unsubscribeRecoverySuccess = eventBus.on('recovery:success', (payload) => {
    95	    cancelTimer(payload.projectId);
    96
    97	    const timer = setTimeout(() => {
    98	      void (async () => {
    99	        postmortemTimers.delete(payload.projectId);
   100
   101	        const project = db.getProject(payload.projectId);
   102	        if (!project || project.status !== 'running') {
   103	          return;
   104	        }
   105
   106	        if (isEligible && !isEligible(payload.projectId)) {
   107	          log.info({ projectId: payload.projectId }, 'Auto-postmortem skipped: not eligible');
   108	          return;
   109	        }
   110
   111	        const postmortem = getPostmortem();
   112	        if (!postmortem) {
   113	          return;
   114	        }
   115
   116	        try {
   117	          await postmortem.generatePostmortem(payload.projectId);
   118	          log.info({ projectId: payload.projectId }, 'Auto-postmortem generated after recovery');
   119	        } catch (err) {
   120	          log.error({ err, projectId: payload.projectId }, 'Auto-postmortem generation failed');
   121	        }
   122	      })();
   123	    }, delayMs);
   124
   125	    postmortemTimers.set(payload.projectId, timer);
   126	  });
   127
   128	  const unsubscribeCancels = POSTMORTEM_CANCEL_EVENTS.map((eventName) =>
   129	    eventBus.on(eventName, (payload) => {
   130	      cancelTimer(payload.projectId);
   131	    }),
   132	  );
   133
   134	  return () => {
   135	    unsubscribeRecoverySuccess();
   136	    for (const unsubscribe of unsubscribeCancels) {
   137	      unsubscribe();
   138	    }
   139	    for (const timer of postmortemTimers.values()) {
   140	      clearTimeout(timer);
   141	    }
   142	    postmortemTimers.clear();
   143	  };
   144	}
   145
   146	/**
   147	 * Application context — wires all modules together.
   148	 *
   149	 * Created once at startup. Passed to API routes and CLI commands.
   150	 * This is the single source of truth for all runtime instances.
   151	 */
   152	export interface AppContext {
   153	  config: OpenLanderConfig;
   154	  db: Database;
   155	  docker: Docker;
   156	  pipeline: DeployPipeline;
   157	  composePipeline: ComposePipeline;
   158	  traefik: TraefikManager;
   159	  env: EnvManager;
   160	  agentPool: AgentPool | null;
   161	  agent: Agent | null;
   162	  modelRegistry: ModelRegistry;
   163	  model: LanguageModel | null;
   164	  deployQueue: DeployQueue;
   165	  // v0.2 modules
   166	  healthMonitor: HealthMonitor;
   167	  dockerEventListener?: DockerEventListener;
   168	  opsAgent?: OpsAgent;
   169	  webhookManager: WebhookManager;
   170	  cloudflare: CloudflareTunnelManager;
   171	  // v0.3 modules
   172	  buildDebugger: BuildDebugger | null;
   173	  // v0.4 modules
   174	  channelManager: ChannelManager;
   175	  previewDeployer: PreviewDeployer;
   176	  jobManager: JobManager;
   177	  autoDetector: AutoDetector;
   178	  // v0.5 modules
   179	  alertMonitor: AlertMonitor;
   180	  questionBridge: QuestionBridge;
   181	  serviceManager: ServiceManager;
   182	  approvalGate: ApprovalGate;
   183	  // v1.0 modules
   184	  mcpClientManager: McpClientManager;
   185	  planEngine: PlanEngine;
   186	  // v1.0: Recovery coordinator
   187	  coordinator: RecoveryCoordinator;
   188	  llmVerified: boolean;
   189	}
   190
   191	/** Reset projects and environments stuck in 'building' status from a previous server run. */
   192	async function cleanupStaleBuilds(db: Database, docker: Docker): Promise<void> {
   193	  const staleProjects = db.listProjects('building', { includeArchived: true });
   194	  if (staleProjects.length === 0) return;
   195
   196	  log.info({ count: staleProjects.length }, 'Found stale building projects — cleaning up');
   197
   198	  let runningContainerIds: Set<string>;
   199	  try {
   200	    const containers = await docker.listManagedContainers();
   201	    runningContainerIds = new Set(
   202	      containers.filter((c) => c.status === 'running').map((c) => c.id),
   203	    );
   204	  } catch (err) {
   205	    log.warn({ err }, 'Docker unreachable during stale build cleanup — deferring reconciliation');
   206	    return;
   207	  }
   208
   209	  for (const project of staleProjects) {
   210	    if (project.status !== 'building') continue;
   211	    const isContainerRunning =
   212	      project.container_id != null && runningContainerIds.has(project.container_id);
   213	    const newStatus = isContainerRunning ? 'running' : 'stopped';
   214	    db.updateProject(project.id, { status: newStatus });
   215	    log.info(
   216	      { projectId: project.id, name: project.name, from: 'building', to: newStatus },
   217	      'Stale build status reset',
   218	    );
   219
   220	    const envs = db.getEnvironmentsByProject(project.id);
   221	    for (const env of envs) {
   222	      if (env.status !== 'building') continue;
   223	      const envContainerRunning =
   224	        env.container_id != null && runningContainerIds.has(env.container_id);
   225	      const envNewStatus = envContainerRunning ? 'running' : 'stopped';
   226	      db.updateEnvironment(env.id, { status: envNewStatus });
   227	      log.info(
   228	        { envId: env.id, type: env.type, from: 'building', to: envNewStatus },
   229	        'Stale environment status reset',
   230	      );
   231	    }
   232	  }
   233	}
   234
   235	/** Create the application context from config. */
   236	export async function createAppContext(
   237	  config: OpenLanderConfig,
   238	  dbPath: string,
   239	): Promise<AppContext> {
   240	  const db = new Database(dbPath);
   241	  const docker = new Docker(config.docker.socketPath || undefined, config.docker.networkName);
   242
   243	  await cleanupStaleBuilds(db, docker);
   244	  const jobManager = new JobManager();
   245	  const env = new EnvManager(db);
   246	  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager, env);
   247	  const traefik = new TraefikManager(docker, config.server.port, {
   248	    networkName: config.docker.networkName,
   249	  });
   250
   251	  const normalizedLlm = normalizeLlmConfig(config.llm);
   252
   253	  const hasLlmConfigured = (() => {
   254	    if (Object.keys(normalizedLlm.providers).length === 0) {
   255	      return false;
   256	    }
   257
   258	    const defaultProvider = normalizedLlm.providers[normalizedLlm.defaultRoute.providerId];
   259	    if (!defaultProvider) {
   260	      return false;
   261	    }
   262
   263	    return !!(defaultProvider.apiKey || defaultProvider.authToken);
   264	  })();
   265
   266	  const modelRegistry = new ModelRegistry(
   267	    hasLlmConfigured
   268	      ? {
   269	          providers: normalizedLlm.providers,
   270	          defaultRoute: normalizedLlm.defaultRoute,
   271	          routes: normalizedLlm.routes,
   272	        }
   273	      : { providers: {}, defaultRoute: { providerId: '__none__' } },
   274	  );
   275
   276	  const model: LanguageModel | null = hasLlmConfigured
   277	    ? createModelProxy(modelRegistry, 'default')
   278	    : null;
   279
   280	  const autoDetector = new AutoDetector(
   281	    hasLlmConfigured ? createModelProxy(modelRegistry, 'envDetection') : null,
   282	  );
   283
   284	  const webAgentEnabled = config.ai.webAgent.enabled;
   285	  const autoRecoveryEnabled = config.ai.autoRecovery.enabled;
   286	  const buildDebuggerEnabled = config.ai.buildDebugger.enabled;
   287
   288	  // v0.3: Build debugger (requires LLM) — created before pipeline so it can be injected
   289	  let buildDebugger: BuildDebugger | null = null;
   290	  if (hasLlmConfigured && buildDebuggerEnabled) {
   291	    try {
   292	      buildDebugger = new BuildDebugger(
   293	        createModelProxy(modelRegistry, 'buildDebugger'),
   294	        config.language,
   295	        db,
   296	        config.llm.provider,
   297	      );
   298	    } catch (err) {
   299	      log.debug({ err }, 'Build debugger creation failed');
   300	    }
   301	  }
   302
   303	  // v1.0: Recovery coordinator — single owner of all recovery decisions
   304	  const coordinator = new RecoveryCoordinator(db, eventBus, config);
   305	  coordinator.start();
   306
   307	  const pipeline = new DeployPipeline(
   308	    docker,
   309	    db,
   310	    env,
   311	    config,
   312	    jobManager,
   313	    composePipeline,
   314	    autoDetector,
   315	    coordinator,
   316	  );
   317	  const approvalGate = new ApprovalGate();
   318
   319	  let agentPool: AgentPool | null = null;
   320	  let agent: Agent | null = null;
   321	  if (hasLlmConfigured && webAgentEnabled) {
   322	    try {
   323	      agentPool = new AgentPool(
   324	        createModelProxy(modelRegistry, 'webAgent'),
   325	        db,
   326	        async (scope) => buildContextSnapshot(db, docker, scope),
   327	        config.llm.provider,
   328	        config.language,
   329	        approvalGate,
   330	      );
   331	    } catch (err) {
   332	      log.debug({ err }, 'AgentPool creation failed — web agent disabled');
   333	      agentPool = null;
   334	    }
   335	  }
   336
   337	  if (hasLlmConfigured && autoRecoveryEnabled) {
   338	    if (agentPool) {
   339	      agent = agentPool.getRecoveryAgent();
   340	    } else {
   341	      try {
   342	        agent = new Agent(
   343	          createModelProxy(modelRegistry, 'autoRecovery'),
   344	          db,
   345	          async (scope) => buildContextSnapshot(db, docker, scope),
   346	          config.llm.provider,
   347	          config.language,
   348	          'auto_recovery',
   349	        );
   350	      } catch (err) {
   351	        log.debug({ err }, 'Recovery agent creation failed — agent will be null');
   352	      }
   353	    }
   354	  }
   355
   356	  // v0.7: Question bridge (agent ↔ UI)
   357	  const questionBridge = new QuestionBridge();
   358	  questionBridge.setEventBus(eventBus);
   359	  if (agentPool) {
   360	    agentPool.setQuestionBridge(questionBridge);

codex
I’ve got the main diff. Next I’m checking the mapper implementation details and the database wrapper methods that the new route/logger rely on, because most of the risk here is hidden in those seams rather than in the route handler itself.
exec
/bin/bash -lc "nl -ba src/monitor/activity-event-mapper.ts | sed -n '260,520p'" in /home/lee/OpenLander
 succeeded in 0ms:
   260	  }
   261	  if (eventType === 'deploy:crash') {
   262	    const crashPayload = payload as EventPayload['deploy:crash'];
   263	    return {
   264	      title: 'Deploy crashed',
   265	      description:
   266	        crashPayload.error ??
   267	        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
   268	    };
   269	  }
   270	  if (eventType === 'compose:failed') {
   271	    return {
   272	      title: 'Compose failed',
   273	      description: (payload as EventPayload['compose:failed']).error,
   274	    };
   275	  }
   276	  if (eventType === 'container:die') {
   277	    const diePayload = payload as EventPayload['container:die'];
   278	    return {
   279	      title: 'Container exited',
   280	      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
   281	    };
   282	  }
   283	  if (eventType === 'container:oom') {
   284	    const oomPayload = payload as EventPayload['container:oom'];
   285	    return {
   286	      title: 'Container out of memory',
   287	      description: oomPayload.containerName,
   288	    };
   289	  }
   290	  if (eventType === 'container:missing') {
   291	    const missingPayload = payload as EventPayload['container:missing'];
   292	    return {
   293	      title: 'Container missing',
   294	      description: missingPayload.suggestion,
   295	    };
   296	  }
   297	  if (eventType === 'monitor:inactive') {
   298	    const monitorPayload = payload as EventPayload['monitor:inactive'];
   299	    return {
   300	      title: 'Project inactive',
   301	      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
   302	    };
   303	  }
   304	  if (eventType === 'health:degraded') {
   305	    const degradedPayload = payload as EventPayload['health:degraded'];
   306	    return {
   307	      title: 'Health degraded',
   308	      description:
   309	        degradedPayload.lastError ??
   310	        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
   311	    };
   312	  }
   313	  if (eventType === 'recovery:start') {
   314	    const recoveryPayload = payload as EventPayload['recovery:start'];
   315	    return {
   316	      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
   317	      description: recoveryPayload.error,
   318	    };
   319	  }
   320	  if (eventType === 'recovery:success') {
   321	    const recoveryPayload = payload as EventPayload['recovery:success'];
   322	    return {
   323	      title: 'Auto-recovery succeeded',
   324	      description:
   325	        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
   326	    };
   327	  }
   328	  if (eventType === 'recovery:failed') {
   329	    const recoveryPayload = payload as EventPayload['recovery:failed'];
   330	    return {
   331	      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
   332	      description: recoveryPayload.error,
   333	    };
   334	  }
   335	  if (eventType === 'recovery:exhausted') {
   336	    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
   337	    return {
   338	      title: 'Auto-recovery exhausted',
   339	      description: recoveryPayload.lastError,
   340	    };
   341	  }
   342	  if (eventType === 'recovery:blocked') {
   343	    const blockedPayload = payload as EventPayload['recovery:blocked'];
   344	    return {
   345	      title: 'Recovery blocked',
   346	      description: blockedPayload.reason,
   347	      reason: blockedPayload.reason,
   348	    };
   349	  }
   350	  if (eventType === 'recovery:stopped') {
   351	    const stoppedPayload = payload as EventPayload['recovery:stopped'];
   352	    return {
   353	      title: 'Recovery stopped',
   354	      description: stoppedPayload.reason,
   355	      reason: stoppedPayload.reason,
   356	    };
   357	  }
   358	  if (eventType === 'recovery:started') {
   359	    const startedPayload = payload as EventPayload['recovery:started'];
   360	    return {
   361	      title: 'Recovery started',
   362	      description: startedPayload.trigger,
   363	    };
   364	  }
   365	  if (eventType === 'recovery:approval-needed') {
   366	    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
   367	    return {
   368	      title: `Approval required: ${approvalPayload.toolName}`,
   369	      description: `Attempt #${String(approvalPayload.attempt)}`,
   370	      actionRunId: approvalPayload.actionRunId,
   371	    };
   372	  }
   373	  if (eventType === 'recovery:approval-resolved') {
   374	    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
   375	    return {
   376	      title: approvalPayload.approved ? 'Approval approved' : 'Approval rejected',
   377	      description: approvalPayload.actionRunId,
   378	      actionRunId: approvalPayload.actionRunId,
   379	    };
   380	  }
   381	  if (eventType === 'ai:invoked') {
   382	    const aiPayload = payload as EventPayload['ai:invoked'];
   383	    return {
   384	      title: 'AI invoked',
   385	      description: `${aiPayload.model} ${aiPayload.action}`,
   386	      aiMetadata: {
   387	        model: aiPayload.model,
   388	      },
   389	    };
   390	  }
   391	  if (eventType === 'ai:completed') {
   392	    const aiPayload = payload as EventPayload['ai:completed'];
   393	    return {
   394	      title: aiPayload.success ? 'AI completed' : 'AI failed',
   395	      description: `${aiPayload.action} (${String(aiPayload.durationMs)}ms)`,
   396	      aiMetadata: {
   397	        model: aiPayload.model,
   398	        durationMs: aiPayload.durationMs,
   399	        tokensUsed: (aiPayload.inputTokens ?? 0) + (aiPayload.outputTokens ?? 0) || undefined,
   400	      },
   401	    };
   402	  }
   403	  if (eventType === 'alert:new') {
   404	    const alertPayload = payload as EventPayload['alert:new'];
   405	    return {
   406	      title: `Alert: ${alertPayload.alert.type}`,
   407	      description: alertPayload.alert.message,
   408	      incidentId:
   409	        typeof alertPayload.alert.details.incidentId === 'string'
   410	          ? alertPayload.alert.details.incidentId
   411	          : undefined,
   412	    };
   413	  }
   414
   415	  return {
   416	    title: formatEventName(eventType),
   417	    description: extractEventDetail(eventType, payload),
   418	  };
   419	}
   420
   421	export function buildActivityEvent<T extends EventType>(
   422	  db: ActivityMapperDb,
   423	  eventType: T,
   424	  payload: EventPayload[T],
   425	): ActivityEvent | null {
   426	  const projectId = resolveProjectIdFromEvent(db, eventType, payload);
   427	  if (!projectId) return null;
   428
   429	  const project = db.getProject(projectId);
   430	  const projectName = project?.name ?? projectId;
   431	  const timestamp = new Date().toISOString();
   432	  const type = mapActivityType(eventType);
   433	  const status = mapActivityStatus(eventType, payload);
   434	  const severity = mapActivitySeverity(eventType, payload, status);
   435	  const content = describeActivityEvent(eventType, payload);
   436	  const id = `${eventType}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
   437
   438	  return {
   439	    id,
   440	    timestamp,
   441	    type,
   442	    severity,
   443	    projectId,
   444	    projectName,
   445	    title: content.title,
   446	    description: content.description,
   447	    status,
   448	    incidentId: content.incidentId,
   449	    actionRunId: content.actionRunId,
   450	    correlationId: content.actionRunId,
   451	    aiMetadata: content.aiMetadata,
   452	    rawType: eventType,
   453	    project: projectName,
   454	    user: 'system',
   455	    detail: content.description || undefined,
   456	    time: timestamp,
   457	    reason: content.reason,
   458	  };
   459	}

exec
/bin/bash -lc "nl -ba src/db/index.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { mkdirSync } from 'node:fs';
     2	import { dirname } from 'node:path';
     3	import { isNotNull } from 'drizzle-orm';
     4	import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from './drizzle.js';
     5	import { initializeDatabase } from './migration.js';
     6	import { environments, projects } from './schema.drizzle.js';
     7	import { ProjectRepo } from './repos/project.repo.js';
     8	import { EnvironmentRepo } from './repos/environment.repo.js';
     9	import { EnvVarRepo } from './repos/env-var.repo.js';
    10	import { GlobalSecretRepo } from './repos/global-secret.repo.js';
    11	import { SecretFileRepo } from './repos/secret-file.repo.js';
    12	import { ServiceRepo } from './repos/service.repo.js';
    13	import { ServiceConnectionRepo } from './repos/service-connection.repo.js';
    14	import { RuntimeIncidentRepo } from './repos/runtime-incident.repo.js';
    15	import { DeployLogRepo } from './repos/deploy-log.repo.js';
    16	import { TimelineRepo } from './repos/timeline.repo.js';
    17	import { DomainMappingRepo } from './repos/domain-mapping.repo.js';
    18	import { OAuthRepo } from './repos/oauth.repo.js';
    19	import { WebhookRepo } from './repos/webhook.repo.js';
    20	import { DeployPlanRepo } from './repos/deploy-plan.repo.js';
    21	import { DeployConfigRepo } from './repos/deploy-config.repo.js';
    22	import { AuthRepo } from './repos/auth.repo.js';
    23	import { AiUsageLogRepo } from './repos/ai-usage-log.repo.js';
    24	import { ActionRunRepo } from './repos/action-run.repo.js';
    25	import { DeploymentPatternRepo } from './repos/deployment-pattern.repo.js';
    26	import { OpsIncidentRepo } from './repos/ops-incident.repo.js';
    27	import { OpsIncidentEventRepo } from './repos/ops-incident-event.repo.js';
    28	import { CircuitBreakerRepo } from './repos/circuit-breaker.repo.js';
    29	import { ProjectDependencyRepo } from './repos/project-dependency.repo.js';
    30	import { ProjectOpsOverrideRepo } from './repos/project-ops-override.repo.js';
    31	import { ActivityLogRepo } from './repos/activity-log.repo.js';
    32	import type { ProjectRow } from './types.js';
    33	import type { AuthDatabase } from '../auth/auth-service.js';
    34	import type { ProjectOpsOverride } from '../monitor/ops-types.js';
    35
    36	export type {
    37	  EnvironmentType,
    38	  ProjectRow,
    39	  EnvironmentRow,
    40	  DeployLogRow,
    41	  TimelineEventRow,
    42	  DomainMappingRow,
    43	  OAuthTokenRow,
    44	  WebhookConfigRow,
    45	  ServiceRow,
    46	  ServiceConnectionRow,
    47	  RuntimeIncidentRow,
    48	  PendingFixRow,
    49	  DeployPlanRow,
    50	  AuthRow,
    51	  OpsIncidentRow,
    52	  OpsIncidentEventRow,
    53	  CircuitBreakerRow,
    54	  ActivityLogRow,
    55	} from './types.js';
    56
    57	// prettier-ignore
    58	export class Database implements AuthDatabase {
    59	  private sqlite: SqliteDatabase;
    60	  private db: DrizzleClient;
    61	  private readonly projectRepo: ProjectRepo;
    62	  private readonly environmentRepo: EnvironmentRepo;
    63	  private readonly envVarRepo: EnvVarRepo;
    64	  private readonly globalSecretRepo: GlobalSecretRepo;
    65	  private readonly secretFileRepo: SecretFileRepo;
    66	  private readonly serviceRepo: ServiceRepo;
    67	  private readonly serviceConnectionRepo: ServiceConnectionRepo;
    68	  private readonly runtimeIncidentRepo: RuntimeIncidentRepo;
    69	  private readonly deployLogRepo: DeployLogRepo;
    70	  private readonly timelineRepo: TimelineRepo;
    71	  private readonly domainMappingRepo: DomainMappingRepo;
    72	  private readonly oauthRepo: OAuthRepo;
    73	  private readonly webhookRepo: WebhookRepo;
    74	  private readonly deployPlanRepo: DeployPlanRepo;
    75	  private readonly deployConfigRepo: DeployConfigRepo;
    76	  private readonly authRepo: AuthRepo;
    77	  private readonly aiUsageLogRepo: AiUsageLogRepo;
    78	  private readonly actionRunRepo: ActionRunRepo;
    79	  private readonly deploymentPatternRepo: DeploymentPatternRepo;
    80	  private readonly opsIncidentRepo: OpsIncidentRepo;
    81	  private readonly opsIncidentEventRepo: OpsIncidentEventRepo;
    82	  private readonly circuitBreakerRepo: CircuitBreakerRepo;
    83	  private readonly projectDependencyRepo: ProjectDependencyRepo;
    84	  private readonly projectOpsOverrideRepo: ProjectOpsOverrideRepo;
    85	  private readonly activityLogRepo: ActivityLogRepo;
    86
    87	  constructor(dbPath: string) {
    88	    mkdirSync(dirname(dbPath), { recursive: true });
    89	    const { sqlite, db } = createDrizzleDatabase(dbPath);
    90	    this.sqlite = sqlite;
    91	    this.db = db;
    92	    initializeDatabase(this.sqlite);
    93	    this.projectRepo = new ProjectRepo(this.db, this.sqlite);
    94	    this.environmentRepo = new EnvironmentRepo(this.db, this.sqlite);
    95	    this.envVarRepo = new EnvVarRepo(this.db, this.sqlite);
    96	    this.globalSecretRepo = new GlobalSecretRepo(this.db, this.sqlite);
    97	    this.secretFileRepo = new SecretFileRepo(this.db, this.sqlite);
    98	    this.serviceRepo = new ServiceRepo(this.db, this.sqlite);
    99	    this.serviceConnectionRepo = new ServiceConnectionRepo(this.db, this.sqlite);
   100	    this.runtimeIncidentRepo = new RuntimeIncidentRepo(this.db, this.sqlite);
   101	    this.deployLogRepo = new DeployLogRepo(this.db, this.sqlite);
   102	    this.timelineRepo = new TimelineRepo(this.db, this.sqlite);
   103	    this.domainMappingRepo = new DomainMappingRepo(this.db, this.sqlite);
   104	    this.oauthRepo = new OAuthRepo(this.db, this.sqlite);
   105	    this.webhookRepo = new WebhookRepo(this.db, this.sqlite);
   106	    this.deployPlanRepo = new DeployPlanRepo(this.db, this.sqlite);
   107	    this.deployConfigRepo = new DeployConfigRepo(this.db, this.sqlite);
   108	    this.authRepo = new AuthRepo(this.db);
   109	    this.aiUsageLogRepo = new AiUsageLogRepo(this.db, this.sqlite);
   110	    this.actionRunRepo = new ActionRunRepo(this.db, this.sqlite);
   111	    this.deploymentPatternRepo = new DeploymentPatternRepo(this.db, this.sqlite);
   112	    this.opsIncidentRepo = new OpsIncidentRepo(this.db, this.sqlite);
   113	    this.opsIncidentEventRepo = new OpsIncidentEventRepo(this.db, this.sqlite);
   114	    this.circuitBreakerRepo = new CircuitBreakerRepo(this.db, this.sqlite);
   115	    this.projectDependencyRepo = new ProjectDependencyRepo(this.db, this.sqlite);
   116	    this.projectOpsOverrideRepo = new ProjectOpsOverrideRepo(this.db, this.sqlite);
   117	    this.activityLogRepo = new ActivityLogRepo(this.db, this.sqlite);
   118	    this.actionRunRepo.markStaleAsFailedOnStartup();
   119	  }
   120
   121	  createProject(project: Parameters<ProjectRepo['createProject']>[0]): ProjectRow { const created = this.projectRepo.createProject(project); this.environmentRepo.createEnvironment({ id: `${project.id}-production`, projectId: created.id, type: 'production', branch: project.branch ?? 'main' }); return created; }
   122	  getProject(id: string) { return this.projectRepo.getProject(id); }
   123	  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
   124	  listProjects(status?: ProjectRow['status'], opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
   125	  archiveProject(id: string) { this.projectRepo.archiveProject(id); }
   126	  unarchiveProject(id: string) { this.projectRepo.unarchiveProject(id); }
   127	  listArchivedProjects() { return this.projectRepo.listArchivedProjects(); }
   128	  isArchived(id: string) { return this.projectRepo.isArchived(id); }
   129	  updateProject(id: string, updates: Parameters<ProjectRepo['updateProject']>[1]) { this.projectRepo.updateProject(id, updates); }
   130	  setPendingFix(projectId: string, pendingFix: Parameters<ProjectRepo['setPendingFix']>[1]) { this.projectRepo.setPendingFix(projectId, pendingFix); }
   131	  consumePendingFix(projectId: string) { return this.projectRepo.consumePendingFix(projectId); }
   132	  deleteProject(id: string) { this.projectRepo.deleteProject(id); }
   133	  getChildProjects(parentId: string) { return this.projectRepo.getChildProjects(parentId); }
   134	  getPreviewProjects(parentProjectId: string) { return this.projectRepo.getPreviewProjects(parentProjectId); }
   135	  isParentProject(id: string) { return this.projectRepo.isParentProject(id); }
   136	  acquireDeployLock(projectId: string, sessionId: string) { return this.projectRepo.acquireDeployLock(projectId, sessionId); }
   137	  releaseDeployLock(projectId: string) { this.projectRepo.releaseDeployLock(projectId); }
   138	  getDeployLockInfo(projectId: string) { return this.projectRepo.getDeployLockInfo(projectId); }
   139	  cleanExpiredDeployLocks(timeoutMinutes = 10) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
   140	  createEnvironment(environment: Parameters<EnvironmentRepo['createEnvironment']>[0]) { return this.environmentRepo.createEnvironment(environment); }
   141	  getEnvironment(id: string) { return this.environmentRepo.getEnvironment(id); }
   142	  getEnvironmentsByProject(projectId: string) { return this.environmentRepo.getEnvironmentsByProject(projectId); }
   143	  updateEnvironment(id: string, updates: Parameters<EnvironmentRepo['updateEnvironment']>[1]) { this.environmentRepo.updateEnvironment(id, updates); }
   144	  deleteEnvironment(id: string) { this.environmentRepo.deleteEnvironment(id); }
   145	  getEnvVars(projectId: string, environmentId?: string) { return this.envVarRepo.getEnvVars(projectId, environmentId); }
   146	  setEnvVar(projectId: string, key: string, value: string, environmentId?: string) { this.envVarRepo.setEnvVar(projectId, key, value, environmentId); }
   147	  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.setEnvVarsBulk(projectId, vars, environmentId); }
   148	  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.mergeEnvVars(projectId, vars, environmentId); }
   149	  deleteEnvVar(projectId: string, key: string, environmentId?: string) { this.envVarRepo.deleteEnvVar(projectId, key, environmentId); }
   150	  findProjectsByEnvKey(key: string) { return this.envVarRepo.findProjectsByEnvKey(key); }
   151	  getGlobalSecrets() { return this.globalSecretRepo.getGlobalSecrets(); }
   152	  getGlobalSecret(key: string) { return this.globalSecretRepo.getGlobalSecret(key); }
   153	  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string) { this.globalSecretRepo.setGlobalSecret(key, encryptedValue, iv, description); }
   154	  deleteGlobalSecret(key: string) { return this.globalSecretRepo.deleteGlobalSecret(key); }
   155	  getSecretFiles(projectId: string | null) { return this.secretFileRepo.getSecretFiles(projectId); }
   156	  getSecretFilesForDeploy(projectId: string) { return this.secretFileRepo.getSecretFilesForDeploy(projectId); }
   157	  upsertSecretFile(projectId: string | null, filename: string, encryptedContent: string, iv: string, mountPath: string = '/run/secrets') { this.secretFileRepo.upsertSecretFile(projectId, filename, encryptedContent, iv, mountPath); }
   158	  deleteSecretFile(projectId: string | null, filename: string) { return this.secretFileRepo.deleteSecretFile(projectId, filename); }
   159	  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
   160	  getService(id: string) { return this.serviceRepo.getService(id); }
   161	  listServices() { return this.serviceRepo.listServices(); }
   162	  updateService(id: string, updates: Parameters<ServiceRepo['updateService']>[1]) { this.serviceRepo.updateService(id, updates); }
   163	  deleteService(id: string) { this.serviceRepo.deleteService(id); }
   164	  createServiceConnection(opts: Parameters<ServiceConnectionRepo['createConnection']>[0]) { return this.serviceConnectionRepo.createConnection(opts); }
   165	  getServiceConnection(id: string) { return this.serviceConnectionRepo.getConnection(id); }
   166	  getServiceConnectionByProjectAndService(projectId: string, serviceId: string) { return this.serviceConnectionRepo.getConnectionByProjectAndService(projectId, serviceId); }
   167	  listServiceConnectionsByProject(projectId: string, environmentId?: string) { return this.serviceConnectionRepo.listConnectionsByProject(projectId, environmentId); }
   168	  listServiceConnectionsByService(serviceId: string) { return this.serviceConnectionRepo.listConnectionsByService(serviceId); }
   169	  updateServiceConnection(id: string, updates: Parameters<ServiceConnectionRepo['updateConnection']>[1]) { this.serviceConnectionRepo.updateConnection(id, updates); }
   170	  deleteServiceConnection(id: string) { this.serviceConnectionRepo.deleteConnection(id); }
   171	  deleteServiceConnectionByProjectAndService(projectId: string, serviceId: string) { this.serviceConnectionRepo.deleteConnectionByProjectAndService(projectId, serviceId); }
   172	  createRuntimeIncident(opts: Parameters<RuntimeIncidentRepo['createIncident']>[0]) { return this.runtimeIncidentRepo.createIncident(opts); }
   173	  getRuntimeIncident(id: string) { return this.runtimeIncidentRepo.getIncident(id); }
   174	  listRuntimeIncidentsByProject(projectId: string, opts?: Parameters<RuntimeIncidentRepo['listByProject']>[1]) { return this.runtimeIncidentRepo.listByProject(projectId, opts); }
   175	  listUnresolvedRuntimeIncidents() { return this.runtimeIncidentRepo.listUnresolved(); }
   176	  resolveRuntimeIncident(id: string) { this.runtimeIncidentRepo.resolveIncident(id); }
   177	  updateRuntimeIncidentDiagnosis(id: string, diagnosis: string) { this.runtimeIncidentRepo.updateDiagnosis(id, diagnosis); }
   178	  createDeployLog(log: Parameters<DeployLogRepo['createDeployLog']>[0]) { this.deployLogRepo.createDeployLog(log); }
   179	  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
   180	  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
   181	  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
   182	  updateRuntimeLog(deployId: string, runtimeLog: string) { this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
   183	  createTimelineEvent(event: Parameters<TimelineRepo['createTimelineEvent']>[0]) { this.timelineRepo.createTimelineEvent(event); }
   184	  getTimelineEvents(projectId: string, limit = 200) { return this.timelineRepo.getTimelineEvents(projectId, limit); }
   185	  deleteTimelineEvents(projectId: string) { this.timelineRepo.deleteTimelineEvents(projectId); }
   186	  createDomainMapping(mapping: Parameters<DomainMappingRepo['createDomainMapping']>[0]) { this.domainMappingRepo.createDomainMapping(mapping); }
   187	  getDomainMappings(projectId: string) { return this.domainMappingRepo.getDomainMappings(projectId); }
   188	  listDomainMappings() { return this.domainMappingRepo.listDomainMappings(); }
   189	  deleteDomainMapping(id: string) { this.domainMappingRepo.deleteDomainMapping(id); }
   190	  getOAuthTokens(provider: string) { return this.oauthRepo.getOAuthTokens(provider); }
   191	  upsertOAuthTokens(token: Parameters<OAuthRepo['upsertOAuthTokens']>[0]) { this.oauthRepo.upsertOAuthTokens(token); }
   192	  deleteOAuthTokens(provider: string) { this.oauthRepo.deleteOAuthTokens(provider); }
   193	  getWebhookConfig(projectId: string, source: Parameters<WebhookRepo['getWebhookConfig']>[1]) { return this.webhookRepo.getWebhookConfig(projectId, source); }
   194	  setWebhookConfig(config: Parameters<WebhookRepo['setWebhookConfig']>[0]) { this.webhookRepo.setWebhookConfig(config); }
   195	  setWebhookEnabled(id: string, enabled: boolean) { this.webhookRepo.setWebhookEnabled(id, enabled); }
   196	  getWebhookConfigs(projectId: string) { return this.webhookRepo.getWebhookConfigs(projectId); }
   197	  deleteWebhookConfig(projectId: string, source: Parameters<WebhookRepo['deleteWebhookConfig']>[1]) { this.webhookRepo.deleteWebhookConfig(projectId, source); }
   198	  createDeployPlan(plan: Parameters<DeployPlanRepo['createDeployPlan']>[0]) { return this.deployPlanRepo.createDeployPlan(plan); }
   199	  getDeployPlan(planId: string) { return this.deployPlanRepo.getDeployPlan(planId); }
   200	  updateDeployPlan(planId: string, updates: Parameters<DeployPlanRepo['updateDeployPlan']>[1]) { this.deployPlanRepo.updateDeployPlan(planId, updates); }
   201	  updateDeployPlanStatus(planId: string, status: string) { this.deployPlanRepo.updateDeployPlanStatus(planId, status); }
   202	  listDeployPlans(projectName?: string) { return this.deployPlanRepo.listDeployPlans(projectName); }
   203	  getLatestPlanForProject(projectName: string) { return this.deployPlanRepo.getLatestPlanForProject(projectName); }
   204	  saveDeployConfig(projectId: string, configJson: string, configVersion: number) { this.deployConfigRepo.save(projectId, configJson, configVersion); }
   205	  loadDeployConfig(projectId: string) { return this.deployConfigRepo.load(projectId); }
   206	  deleteDeployConfig(projectId: string) { this.deployConfigRepo.delete(projectId); }
   207	  isPasswordSet() { return this.authRepo.isPasswordSet(); }
   208	  getAuth() { return this.authRepo.getAuth(); }
   209	  setPassword(hash: string) { this.authRepo.setPassword(hash); }
   210	  getApiToken() { return this.authRepo.getApiToken(); }
   211	  setApiToken(encrypted: string, iv: string) { this.authRepo.setApiToken(encrypted, iv); }
   212	  getSession() { return this.authRepo.getSession(); }
   213	  createSession(token: string, createdAt: number, expiresAt: number) { this.authRepo.createSession(token, createdAt, expiresAt); }
   214	  deleteSession() { this.authRepo.deleteSession(); }
   215	  getUsedPorts(): number[] { const projectPorts = this.db.select({ assigned_port: projects.assigned_port }).from(projects).where(isNotNull(projects.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...projectPorts, ...envPorts])]; }
   216	  createAiUsageLog(data: Parameters<AiUsageLogRepo['create']>[0]) { return this.aiUsageLogRepo.create(data); }
   217	  getAiUsageLogsByProject(projectId: string) { return this.aiUsageLogRepo.findByProjectId(projectId); }
   218	  getAiUsageLogsByDateRange(from: Date, to: Date) { return this.aiUsageLogRepo.findByDateRange(from, to); }
   219	  getAiTokenSummary(projectId?: string) { return this.aiUsageLogRepo.getTokenSummary(projectId); }
   220	  getAiTokenSummaryFiltered(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.getTokenSummaryFiltered(opts); }
   221	  getRecentAiUsageLogs(opts: { limit: number; projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.findRecent(opts); }
   222	  countAiUsageLogs(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.countAll(opts); }
   223	  createActionRun(data: Parameters<ActionRunRepo['create']>[0]) { return this.actionRunRepo.create(data); }
   224	  updateActionRunStatus(id: string, status: 'running' | 'succeeded' | 'failed' | 'pending_approval', errorMessage?: string) { this.actionRunRepo.updateStatus(id, status, errorMessage); }
   225	  updateActionRunStep(id: string, currentStep: number, totalSteps?: number) { this.actionRunRepo.updateStep(id, currentStep, totalSteps); }
   226	  updateActionRunApproval(id: string, approvalStatus: 'pending' | 'approved' | 'rejected', approvalTool?: string) { this.actionRunRepo.updateApproval(id, approvalStatus, approvalTool); }
   227	  updateActionRunRecoveryStrategy(id: string, strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null) { this.actionRunRepo.updateRecoveryStrategy(id, strategy); }
   228	  updateActionRunPlan(id: string, plan: string) { this.actionRunRepo.updatePlan(id, plan); }
   229	  getRunningActionRuns(projectId: string) { return this.actionRunRepo.findRunning(projectId); }
   230	  getActionRunsByProject(projectId: string, limit?: number) { return this.actionRunRepo.findByProjectId(projectId, limit); }
   231	  findActionRunPendingApproval(actionRunId: string) { return this.actionRunRepo.findPendingApproval(actionRunId); }
   232	  getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
   233	  findDeploymentPatternsByProject(projectId: string) { return this.deploymentPatternRepo.findByProject(projectId); }
   234	  findDeploymentPatternBySignature(projectId: string, signature: string) { return this.deploymentPatternRepo.findBySignature(projectId, signature); }
   235	  upsertDeploymentPattern(data: { project_id: string; pattern_type: string; error_signature: string; fix_action: string }) { return this.deploymentPatternRepo.upsertPattern(data); }
   236	  recordDeploymentPatternSuccess(id: string) { this.deploymentPatternRepo.recordSuccess(id); }
   237	  recordDeploymentPatternFailure(id: string) { this.deploymentPatternRepo.recordFailure(id); }
   238	  getTopDeploymentPatterns(projectId: string, limit?: number) { return this.deploymentPatternRepo.getTopPatterns(projectId, limit); }
   239	  createOpsIncident(data: Parameters<OpsIncidentRepo['create']>[0]) { return this.opsIncidentRepo.create(data); }
   240	  getOpsIncident(id: string) { return this.opsIncidentRepo.findById(id); }
   241	  listOpsIncidentsByProject(projectId: string, limit?: number) { return this.opsIncidentRepo.findByProjectId(projectId, limit); }
   242	  getActiveOpsIncident(projectId: string) { return this.opsIncidentRepo.findActive(projectId); }
   243	  listAllActiveOpsIncidents() { return this.opsIncidentRepo.findAllActive(); }
   244	  updateOpsIncidentStatus(id: string, status: string, extra?: { resolved_at?: number; escalated_at?: number }) { this.opsIncidentRepo.updateStatus(id, status, extra); }
   245	  updateOpsIncident(id: string, data: Parameters<OpsIncidentRepo['update']>[1]) { this.opsIncidentRepo.update(id, data); }
   246	  addOpsIncidentEvent(data: Parameters<OpsIncidentEventRepo['addEvent']>[0]) { return this.opsIncidentEventRepo.addEvent(data); }
   247	  listOpsIncidentEvents(incidentId: string) { return this.opsIncidentEventRepo.findByIncidentId(incidentId); }
   248	  listOpsIncidentEventsByIncidentIds(incidentIds: string[]) { return this.opsIncidentEventRepo.findByIncidentIds(incidentIds); }
   249	  listOpsIncidentsByDateRange(from: number, to: number) { return this.opsIncidentRepo.findByDateRange(from, to); }
   250	  getCircuitBreakerState(projectId: string) { return this.circuitBreakerRepo.getState(projectId); }
   251	  upsertCircuitBreakerState(projectId: string, data: Parameters<CircuitBreakerRepo['upsert']>[1]) { this.circuitBreakerRepo.upsert(projectId, data); }
   252	  incrementCircuitBreakerFailure(projectId: string) { return this.circuitBreakerRepo.incrementFailure(projectId); }
   253	  openCircuitBreaker(projectId: string) { this.circuitBreakerRepo.openBreaker(projectId); }
   254	  halfOpenCircuitBreaker(projectId: string) { this.circuitBreakerRepo.halfOpen(projectId); }
   255	  resetCircuitBreaker(projectId: string) { this.circuitBreakerRepo.reset(projectId); }
   256	  findAllOpenCircuitBreakers() { return this.circuitBreakerRepo.findAllOpen(); }
   257	  listAllCircuitBreakers() { return this.circuitBreakerRepo.findAll(); }
   258	  isCircuitBreakerOpen(projectId: string) { return this.circuitBreakerRepo.isOpen(projectId); }
   259	  createProjectDependency(data: Parameters<ProjectDependencyRepo['create']>[0]) { return this.projectDependencyRepo.create(data); }
   260	  findDependenciesByProject(projectId: string) { return this.projectDependencyRepo.findByProject(projectId); }

exec
/bin/bash -lc "nl -ba test/web/api/activity-routes.test.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * Regression tests for the activity data layer.
     3	 *
     4	 * The `/api/activity` endpoint (routes.ts) uses the in-memory EventBus buffer
     5	 * and is not easily unit-tested in isolation because `createApiRoutes()` registers
     6	 * live EventBus listeners as a module-level side effect. These tests therefore
     7	 * exercise the two testable layers:
     8	 *
     9	 * 1. ActivityLogRepo — the DB-backed data source introduced in T2/T6.
    10	 *    Tests verify CRUD, cursor pagination (findSince), date-range queries,
    11	 *    and retention cleanup (deleteOlderThan).
    12	 *
    13	 * 2. ActivityEvent mapper helpers — pure functions that transform raw EventBus
    14	 *    payloads into the ActivityEvent shape used by the endpoint response.
    15	 *
    16	 * SSE streaming is deliberately excluded (E2E / Playwright concern, not unit).
    17	 */
    18
    19	import { afterEach, beforeEach, describe, expect, it } from 'vitest';
    20
    21	import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
    22	import { initializeDatabase } from '../../../src/db/migration.js';
    23	import { ActivityLogRepo } from '../../../src/db/repos/activity-log.repo.js';
    24	import type { ActivityLogRow } from '../../../src/db/types.js';
    25	import {
    26	  buildActivityEvent,
    27	  mapActivitySeverity,
    28	  mapActivityStatus,
    29	  mapActivityType,
    30	} from '../../../src/monitor/activity-event-mapper.js';
    31
    32	// ── helpers ───────────────────────────────────────────────────────────────────
    33
    34	function makeEntry(
    35	  overrides: Partial<Omit<ActivityLogRow, 'id' | 'created_at'>> = {},
    36	): Omit<ActivityLogRow, 'id' | 'created_at'> {
    37	  return {
    38	    event_type: 'deploy:crash',
    39	    activity_type: 'incident',
    40	    severity: 'critical',
    41	    project_id: 'proj-1',
    42	    correlation_id: null,
    43	    title: 'Deploy crashed',
    44	    description: 'npm install failed',
    45	    status: 'active',
    46	    metadata: '{}',
    47	    ...overrides,
    48	  };
    49	}
    50
    51	// ── ActivityLogRepo tests ─────────────────────────────────────────────────────
    52
    53	describe('ActivityLogRepo', () => {
    54	  let repo: ActivityLogRepo;
    55	  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];
    56
    57	  beforeEach(() => {
    58	    const db = createDrizzleDatabase(':memory:');
    59	    sqlite = db.sqlite;
    60	    initializeDatabase(sqlite);
    61	    repo = new ActivityLogRepo(db.db, db.sqlite);
    62	  });
    63
    64	  afterEach(() => {
    65	    sqlite.close();
    66	  });
    67
    68	  describe('insert', () => {
    69	    it('returns a row with a 26-character ULID id', () => {
    70	      const row = repo.insert(makeEntry());
    71	      expect(typeof row.id).toBe('string');
    72	      expect(row.id).toHaveLength(26);
    73	    });
    74
    75	    it('persisted row has all required ActivityLogRow fields', () => {
    76	      const row = repo.insert(makeEntry({ project_id: 'proj-x', title: 'Test title' }));
    77	      expect(row.event_type).toBe('deploy:crash');
    78	      expect(row.activity_type).toBe('incident');
    79	      expect(row.severity).toBe('critical');
    80	      expect(row.project_id).toBe('proj-x');
    81	      expect(row.title).toBe('Test title');
    82	      expect(row.description).toBe('npm install failed');
    83	      expect(row.status).toBe('active');
    84	    });
    85
    86	    it('stores correlation_id when provided', () => {
    87	      const row = repo.insert(makeEntry({ correlation_id: 'inc-abc' }));
    88	      expect(row.correlation_id).toBe('inc-abc');
    89	    });
    90
    91	    it('stores null correlation_id when omitted', () => {
    92	      const row = repo.insert(makeEntry());
    93	      expect(row.correlation_id).toBeNull();
    94	    });
    95
    96	    it('created_at is an ISO 8601 string', () => {
    97	      const row = repo.insert(makeEntry());
    98	      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
    99	    });
   100	  });
   101
   102	  describe('findSince (cursor pagination)', () => {
   103	    it('returns rows with id lexicographically greater than the given cursor', () => {
   104	      const a = repo.insert(makeEntry({ title: 'row-a' }));
   105	      const b = repo.insert(makeEntry({ title: 'row-b' }));
   106	      const c = repo.insert(makeEntry({ title: 'row-c' }));
   107
   108	      // Determine which rows have ids greater than a.id by sorting all ids.
   109	      // (ULIDs in same millisecond are not guaranteed to be in insertion order.)
   110	      const allRows = [a, b, c];
   111	      const afterA = allRows.filter((r) => r.id > a.id);
   112
   113	      const results = repo.findSince(a.id, 50);
   114	      expect(results).toHaveLength(afterA.length);
   115	      for (const row of results) {
   116	        expect(row.id.localeCompare(a.id)).toBeGreaterThan(0);
   117	      }
   118	      // The cursor row itself must not be returned.
   119	      expect(results.some((r) => r.id === a.id)).toBe(false);
   120	    });
   121
   122	    it('returns empty array when no rows exist after cursor', () => {
   123	      const row = repo.insert(makeEntry());
   124	      const results = repo.findSince(row.id, 50);
   125	      expect(results).toHaveLength(0);
   126	    });
   127
   128	    it('respects the limit parameter', () => {
   129	      for (let i = 0; i < 10; i++) {
   130	        repo.insert(makeEntry({ title: `entry-${String(i)}` }));
   131	      }
   132	      const first = repo.findSince('', 3);
   133	      expect(first).toHaveLength(3);
   134	    });
   135
   136	    it('returns rows in ascending ULID order (lexicographic)', () => {
   137	      repo.insert(makeEntry({ title: 'x' }));
   138	      repo.insert(makeEntry({ title: 'y' }));
   139	      repo.insert(makeEntry({ title: 'z' }));
   140
   141	      const results = repo.findSince('', 50);
   142	      const ids = results.map((r) => r.id);
   143	      // Verify the returned list is sorted ascending by id.
   144	      for (let i = 1; i < ids.length; i++) {
   145	        expect(ids[i]!.localeCompare(ids[i - 1]!)).toBeGreaterThanOrEqual(0);
   146	      }
   147	    });
   148	  });
   149
   150	  describe('findByDateRange', () => {
   151	    it('returns rows whose created_at falls within the range', () => {
   152	      repo.insert(makeEntry({ title: 'in-range' }));
   153
   154	      const from = new Date(Date.now() - 60_000).toISOString();
   155	      const to = new Date(Date.now() + 60_000).toISOString();
   156
   157	      const results = repo.findByDateRange(from, to);
   158	      expect(results.length).toBeGreaterThanOrEqual(1);
   159	      const titles = results.map((r) => r.title);
   160	      expect(titles).toContain('in-range');
   161	    });
   162
   163	    it('excludes rows outside the date range', () => {
   164	      repo.insert(makeEntry({ title: 'recent' }));
   165
   166	      const pastFrom = '2020-01-01T00:00:00.000Z';
   167	      const pastTo = '2020-01-02T00:00:00.000Z';
   168
   169	      const results = repo.findByDateRange(pastFrom, pastTo);
   170	      expect(results).toHaveLength(0);
   171	    });
   172
   173	    it('filters by project_id when provided', () => {
   174	      repo.insert(makeEntry({ project_id: 'proj-1', title: 'for-proj-1' }));
   175	      repo.insert(makeEntry({ project_id: 'proj-2', title: 'for-proj-2' }));
   176
   177	      const from = new Date(Date.now() - 60_000).toISOString();
   178	      const to = new Date(Date.now() + 60_000).toISOString();
   179
   180	      const results = repo.findByDateRange(from, to, { project_id: 'proj-1' });
   181	      expect(results.every((r) => r.project_id === 'proj-1')).toBe(true);
   182	      const titles = results.map((r) => r.title);
   183	      expect(titles).toContain('for-proj-1');
   184	      expect(titles).not.toContain('for-proj-2');
   185	    });
   186
   187	    it('filters by activity_type when provided', () => {
   188	      repo.insert(makeEntry({ activity_type: 'incident', title: 'an-incident' }));
   189	      repo.insert(makeEntry({ activity_type: 'recovery', title: 'a-recovery' }));
   190
   191	      const from = new Date(Date.now() - 60_000).toISOString();
   192	      const to = new Date(Date.now() + 60_000).toISOString();
   193
   194	      const results = repo.findByDateRange(from, to, { activity_type: 'incident' });
   195	      expect(results.every((r) => r.activity_type === 'incident')).toBe(true);
   196	    });
   197
   198	    it('supports ULID cursor to exclude rows at or before the cursor id', () => {
   199	      // Insert several rows and capture their IDs in insertion order.
   200	      // findByDateRange uses gt(id, cursor), so rows with ids > cursor are returned.
   201	      const all = [
   202	        repo.insert(makeEntry({ title: 'row-1' })),
   203	        repo.insert(makeEntry({ title: 'row-2' })),
   204	        repo.insert(makeEntry({ title: 'row-3' })),
   205	      ];
   206
   207	      const from = new Date(Date.now() - 60_000).toISOString();
   208	      const to = new Date(Date.now() + 60_000).toISOString();
   209
   210	      // Sort the inserted rows by id to determine which are "after" the first one.
   211	      const sorted = [...all].sort((a, b) => a.id.localeCompare(b.id));
   212	      const cursor = sorted[0]!.id;
   213
   214	      const results = repo.findByDateRange(from, to, {}, cursor);
   215
   216	      // All returned rows must have id > cursor.
   217	      for (const row of results) {
   218	        expect(row.id.localeCompare(cursor)).toBeGreaterThan(0);
   219	      }
   220	      // The row at cursor must not appear in results.
   221	      expect(results.some((r) => r.id === cursor)).toBe(false);
   222	    });
   223	  });
   224
   225	  describe('deleteOlderThan', () => {
   226	    it('removes rows created before the threshold and returns the count deleted', () => {
   227	      const pastIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
   228	      repo.insert(makeEntry({ created_at: pastIso, title: 'old-entry' }));
   229	      repo.insert(makeEntry({ title: 'recent-entry' }));
   230
   231	      const threshold = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
   232	      const deleted = repo.deleteOlderThan(threshold);
   233
   234	      expect(deleted).toBe(1);
   235
   236	      // recent entry should still be present via findSince
   237	      const remaining = repo.findSince('', 50);
   238	      const titles = remaining.map((r) => r.title);
   239	      expect(titles).not.toContain('old-entry');
   240	      expect(titles).toContain('recent-entry');
   241	    });
   242
   243	    it('returns 0 when no rows are older than the threshold', () => {
   244	      repo.insert(makeEntry());
   245	      const futureThreshold = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
   246	      const deleted = repo.deleteOlderThan(futureThreshold);
   247	      expect(deleted).toBe(0);
   248	    });
   249	  });
   250	});
   251
   252	// ── ActivityEvent mapper regression tests ────────────────────────────────────
   253	//
   254	// These verify that the pure mapping functions that produce the ActivityEvent
   255	// response shape remain stable across T1-T7 changes.
   256
   257	describe('mapActivityType', () => {
   258	  it('maps recovery:start to recovery', () => {
   259	    expect(mapActivityType('recovery:start')).toBe('recovery');
   260	  });
   261
   262	  it('maps recovery:success to recovery', () => {
   263	    expect(mapActivityType('recovery:success')).toBe('recovery');
   264	  });
   265
   266	  it('maps recovery:failed to recovery', () => {
   267	    expect(mapActivityType('recovery:failed')).toBe('recovery');
   268	  });
   269
   270	  it('maps recovery:approval-needed to approval', () => {
   271	    expect(mapActivityType('recovery:approval-needed')).toBe('approval');
   272	  });
   273
   274	  it('maps recovery:approval-resolved to approval', () => {
   275	    expect(mapActivityType('recovery:approval-resolved')).toBe('approval');
   276	  });
   277
   278	  it('maps alert:new to alert', () => {
   279	    expect(mapActivityType('alert:new')).toBe('alert');
   280	  });
   281
   282	  it('maps alert:resolved to alert', () => {
   283	    expect(mapActivityType('alert:resolved')).toBe('alert');
   284	  });
   285
   286	  it('maps ai:invoked to ai:invoked (passthrough)', () => {
   287	    expect(mapActivityType('ai:invoked')).toBe('ai:invoked');
   288	  });
   289
   290	  it('maps ai:completed to ai:completed (passthrough)', () => {
   291	    expect(mapActivityType('ai:completed')).toBe('ai:completed');
   292	  });
   293
   294	  it('maps deploy:crash to incident (default)', () => {
   295	    expect(mapActivityType('deploy:crash')).toBe('incident');
   296	  });
   297
   298	  it('maps container:die to incident (default)', () => {
   299	    expect(mapActivityType('container:die')).toBe('incident');
   300	  });
   301	});
   302
   303	describe('mapActivityStatus', () => {
   304	  it('returns active for deploy:start', () => {
   305	    expect(mapActivityStatus('deploy:start', { projectId: 'p1' })).toBe('active');
   306	  });
   307
   308	  it('returns failed for deploy:crash', () => {
   309	    expect(mapActivityStatus('deploy:crash', { projectId: 'p1' })).toBe('failed');
   310	  });
   311
   312	  it('returns resolved for recovery:success', () => {
   313	    expect(mapActivityStatus('recovery:success', { projectId: 'p1', durationMs: 100, lastError: null })).toBe('resolved');
   314	  });
   315
   316	  it('returns pending for recovery:approval-needed', () => {
   317	    expect(
   318	      mapActivityStatus('recovery:approval-needed', {
   319	        projectId: 'p1',
   320	        toolName: 'rollback',

exec
/bin/bash -lc "rg -n \"insertActivityLog|findActivityLog|deleteActivityLogOlderThan|activityLog\" src/db/index.ts src/db/types.ts src/db/repos -g '"'!src/db/repos/activity-log.repo.ts'"'" in /home/lee/OpenLander
 succeeded in 0ms:
src/db/index.ts:85:  private readonly activityLogRepo: ActivityLogRepo;
src/db/index.ts:117:    this.activityLogRepo = new ActivityLogRepo(this.db, this.sqlite);
src/db/index.ts:269:  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
src/db/index.ts:270:  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
src/db/index.ts:271:  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
src/db/index.ts:272:  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
src/db/index.ts:273:  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
src/db/index.ts:274:  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }

exec
/bin/bash -lc "rg -n \"emit\\('recovery:(start|success|failed|exhausted|approval-needed|approval-resolved|stopped|started)'|emit\\('ai:(invoked|completed)'\" src/pipeline/auto-recovery.ts src/monitor/ops-recovery.ts src/monitor/recovery-coordinator.ts src/llm/agent.ts src -g '"'!dist'"'" in /home/lee/OpenLander
 succeeded in 0ms:
src/llm/agent.ts:225:        await eventBus.emit('ai:invoked', {
src/llm/agent.ts:325:          await eventBus.emit('ai:completed', {
src/monitor/recovery-coordinator.ts:263:      await this.events.emit('recovery:started', {
src/monitor/recovery-coordinator.ts:316:      await this.events.emit('recovery:started', {
src/monitor/ops-recovery.ts:166:    await eventBus.emit('recovery:approval-needed', {
src/monitor/ops-recovery.ts:593:    await eventBus.emit('recovery:exhausted', {
src/pipeline/auto-recovery.ts:379:    await eventBus.emit('recovery:start', {
src/pipeline/auto-recovery.ts:459:              await eventBus.emit('recovery:approval-needed', {
src/pipeline/auto-recovery.ts:507:            await eventBus.emit('recovery:stopped', {
src/pipeline/auto-recovery.ts:513:            await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:529:          await eventBus.emit('recovery:success', {
src/pipeline/auto-recovery.ts:542:          await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:556:        await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:669:        await eventBus.emit('recovery:success', {
src/pipeline/auto-recovery.ts:678:        await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:689:      await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:379:    await eventBus.emit('recovery:start', {
src/pipeline/auto-recovery.ts:459:              await eventBus.emit('recovery:approval-needed', {
src/pipeline/auto-recovery.ts:507:            await eventBus.emit('recovery:stopped', {
src/pipeline/auto-recovery.ts:513:            await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:529:          await eventBus.emit('recovery:success', {
src/pipeline/auto-recovery.ts:542:          await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:556:        await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:669:        await eventBus.emit('recovery:success', {
src/pipeline/auto-recovery.ts:678:        await eventBus.emit('recovery:failed', {
src/pipeline/auto-recovery.ts:689:      await eventBus.emit('recovery:failed', {
src/web/api/routes.ts:385:    await eventBus.emit('recovery:approval-resolved', {
src/web/api/routes.ts:402:    await eventBus.emit('recovery:approval-resolved', {
src/llm/agent.ts:225:        await eventBus.emit('ai:invoked', {
src/llm/agent.ts:325:          await eventBus.emit('ai:completed', {
src/monitor/ops-recovery.ts:166:    await eventBus.emit('recovery:approval-needed', {
src/monitor/ops-recovery.ts:593:    await eventBus.emit('recovery:exhausted', {
src/monitor/recovery-coordinator.ts:263:      await this.events.emit('recovery:started', {
src/monitor/recovery-coordinator.ts:316:      await this.events.emit('recovery:started', {

exec
/bin/bash -lc "rg -n \"createApiRoutes\\(|shutdownAppContext\\(|createAppContext\\(\" test src | sed -n '1,200p'" in /home/lee/OpenLander
 succeeded in 0ms:
src/lib/question-bridge.ts:79:   * Called once at startup in createAppContext().
src/web/server.ts:139:  const apiRoutes = createApiRoutes(ctx);
src/web/api/routes.ts:107:export function createApiRoutes(ctx: AppContext): Hono {
src/app.ts:236:export async function createAppContext(
src/app.ts:608:export function shutdownAppContext(ctx: AppContext): void {
test/env-api-routes.test.ts:26:    app.route('/api', createApiRoutes(ctx));
test/web-routes.test.ts:80:    app.route('/api', createApiRoutes(ctx));
test/web/api/activity-routes.test.ts:5: * and is not easily unit-tested in isolation because `createApiRoutes()` registers
src/cli/index.ts:42:    const ctx = await createAppContext(config, getDbPath());
src/cli/index.ts:99:      shutdownAppContext(ctx);
src/cli/index.ts:116:    const ctx = await createAppContext(config, getDbPath());
src/cli/index.ts:244:    const ctx = await createAppContext(config, getDbPath());
src/cli/index.ts:366:    const ctx = await createAppContext(config, getDbPath());
src/cli/index.ts:481:    const ctx = await createAppContext(config, getDbPath());

codex
The data-path wrappers are straightforward. I’m checking two remaining risk areas now: whether correlation IDs are actually propagated consistently across the emitters, and whether the new queries line up with the available indexes or quietly degrade into scans under normal filters.
exec
/bin/bash -lc "nl -ba src/db/types.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	// --- Row types (match DB schema) ---
     2
     3	export type EnvironmentType = 'production' | 'development';
     4
     5	export interface ProjectRow {
     6	  id: string;
     7	  name: string;
     8	  repo_url: string | null;
     9	  branch: string;
    10	  status: 'running' | 'stopped' | 'building' | 'error';
    11	  visibility: 'internal' | 'quick-share' | 'shared' | 'production';
    12	  assigned_port: number | null;
    13	  container_id: string | null;
    14	  image_tag: string | null;
    15	  previous_image_tag: string | null;
    16	  public_url: string | null;
    17	  parent_project_id: string | null;
    18	  dockerfile_path: string;
    19	  docker_target: string | null;
    20	  build_context: string | null;
    21	  build_method: 'dockerfile' | 'compose' | null;
    22	  source: 'git' | 'image';
    23	  image_url: string | null;
    24	  image_cmd: string | null;
    25	  container_port: number | null;
    26	  pending_fix: string | null;
    27	  created_at: string;
    28	  updated_at: string;
    29	  archived_at: string | null;
    30	  deploy_lock_session: string | null;
    31	  deploy_lock_at: string | null;
    32	  access_code: string | null;
    33	  access_code_iv: string | null;
    34	  is_preview: 0 | 1;
    35	  pr_number: number | null;
    36	}
    37
    38	export interface EnvironmentRow {
    39	  id: string;
    40	  project_id: string;
    41	  type: EnvironmentType;
    42	  branch: string;
    43	  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
    44	  assigned_port: number | null;
    45	  container_id: string | null;
    46	  image_tag: string | null;
    47	  previous_image_tag: string | null;
    48	  public_url: string | null;
    49	  created_at: string;
    50	  updated_at: string;
    51	}
    52
    53	export interface DeployLogRow {
    54	  id: string;
    55	  project_id: string;
    56	  environment_id: string | null;
    57	  status: 'success' | 'failed' | 'cancelled';
    58	  trigger: 'chat' | 'webhook' | 'api';
    59	  trigger_detail: string | null;
    60	  commit_sha: string | null;
    61	  commit_message: string | null;
    62	  build_log: string | null;
    63	  runtime_log: string | null;
    64	  duration_ms: number | null;
    65	  created_at: string;
    66	}
    67
    68	export interface TimelineEventRow {
    69	  id: string;
    70	  project_id: string;
    71	  deploy_id: string | null;
    72	  type: string;
    73	  message: string;
    74	  detail: string | null;
    75	  severity: string | null;
    76	  percent: number | null;
    77	  tool_name: string | null;
    78	  action_buttons: string | null;
    79	  created_at: string;
    80	}
    81
    82	export interface DomainMappingRow {
    83	  id: string;
    84	  project_id: string;
    85	  domain: string;
    86	  cloudflare_zone_id: string | null;
    87	  cloudflare_dns_record_id: string | null;
    88	  status: 'active' | 'pending' | 'error';
    89	  created_at: string;
    90	}
    91
    92	export interface OAuthTokenRow {
    93	  id: string;
    94	  provider: string;
    95	  access_token: string;
    96	  refresh_token: string | null;
    97	  expires_at: string | null;
    98	  token_type: string;
    99	  auth_method: string | null;
   100	  user_email: string | null;
   101	  iv: string | null;
   102	  created_at: string;
   103	  updated_at: string;
   104	}
   105
   106	export interface WebhookConfigRow {
   107	  id: string;
   108	  project_id: string;
   109	  source: 'github' | 'gitlab' | 'bitbucket';
   110	  secret: string;
   111	  branch_filter: string;
   112	  enabled: 0 | 1;
   113	  created_at: string;
   114	}
   115
   116	export interface ServiceRow {
   117	  id: string;
   118	  name: string;
   119	  type: string;
   120	  image: string;
   121	  status: 'running' | 'stopped' | 'error';
   122	  container_id: string | null;
   123	  container_name: string;
   124	  port: number;
   125	  env_vars: string | null;
   126	  credentials: string | null;
   127	  created_at: string;
   128	  updated_at: string;
   129	}
   130
   131	export interface ServiceConnectionRow {
   132	  id: string;
   133	  project_id: string;
   134	  service_id: string;
   135	  environment_id: string | null;
   136	  auto_injected_env_keys: string | null;
   137	  created_at: string;
   138	}
   139
   140	export interface RuntimeIncidentRow {
   141	  id: string;
   142	  project_id: string;
   143	  environment_id: string | null;
   144	  category: string;
   145	  exit_code: number | null;
   146	  error_snippet: string | null;
   147	  container_image: string | null;
   148	  container_uptime_ms: number | null;
   149	  restart_count: number | null;
   150	  diagnosis: string | null;
   151	  resolved: number;
   152	  resolved_at: string | null;
   153	  created_at: string;
   154	}
   155
   156	export interface DeployConfigRow {
   157	  id: string;
   158	  project_id: string;
   159	  config_json: string;
   160	  config_version: number;
   161	  created_at: string;
   162	  updated_at: string;
   163	}
   164
   165	export interface PendingFixRow {
   166	  filePath: string;
   167	  content?: string;
   168	  patches?: Array<{
   169	    pattern: string;
   170	    replacement: string;
   171	    flags?: string;
   172	  }>;
   173	}
   174
   175	export interface DeployPlanRow {
   176	  id: string;
   177	  project_name: string | null;
   178	  project_id: string | null;
   179	  status: string;
   180	  complexity: string | null;
   181	  plan_json: string;
   182	  commit_sha: string | null;
   183	  error_message: string | null;
   184	  created_at: string;
   185	  updated_at: string;
   186	  executed_at: string | null;
   187	  completed_at: string | null;
   188	}
   189
   190	export interface AuthRow {
   191	  id: number;
   192	  password_hash: string;
   193	  api_token: string;
   194	  api_token_iv: string | null;
   195	  session_token: string | null;
   196	  session_created_at: number | null;
   197	  session_expires_at: number | null;
   198	}
   199
   200	export interface AiUsageLogRow {
   201	  id: string;
   202	  project_id: string | null;
   203	  session_id: string | null;
   204	  action_type: 'web_agent' | 'auto_recovery' | 'build_debugger' | 'monitor_alert';
   205	  model_name: string;
   206	  provider: string;
   207	  input_tokens: number;
   208	  output_tokens: number;
   209	  total_tokens: number;
   210	  cost_usd: number | null;
   211	  tools_called: string;
   212	  result: 'success' | 'failure' | 'partial';
   213	  duration_ms: number;
   214	  user_id: string | null;
   215	  tenant_id: string | null;
   216	  source: 'web' | 'mcp' | 'auto-recovery' | 'monitor' | null;
   217	  created_at: string;
   218	}
   219
   220	export interface ActionRunRow {
   221	  id: string;
   222	  project_id: string;
   223	  trigger_source: 'web_agent' | 'auto_recovery' | 'monitor' | 'mcp';
   224	  trigger_session_id: string | null;
   225	  status: 'running' | 'succeeded' | 'failed';
   226	  error_message: string | null;
   227	  recovery_strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null;
   228	  steps_json: string | null;
   229	  started_at: string;
   230	  completed_at: string | null;
   231	  tenant_id: string | null;
   232	  user_id: string | null;
   233	  plan: string | null;
   234	  current_step: number | null;
   235	  total_steps: number | null;
   236	  correlation_id: string | null;
   237	  updated_at: string | null;
   238	  approval_status: 'pending' | 'approved' | 'rejected' | null;
   239	  approval_tool: string | null;
   240	  approval_requested_at: string | null;
   241	  approval_resolved_at: string | null;
   242	  created_at: string;
   243	}
   244
   245	export interface OpsIncidentRow {
   246	  id: string;
   247	  project_id: string;
   248	  severity: 'critical' | 'warning' | 'info';
   249	  status: 'open' | 'active' | 'resolved' | 'escalated';
   250	  root_cause: string | null;
   251	  diagnosis: string | null;
   252	  actions_taken: string | null;
   253	  created_at: number;
   254	  resolved_at: number | null;
   255	  escalated_at: number | null;
   256	}
   257
   258	export interface OpsIncidentEventRow {
   259	  id: string;
   260	  incident_id: string;

exec
/bin/bash -lc "nl -ba src/events/index.ts | sed -n '320,520p'" in /home/lee/OpenLander
 succeeded in 0ms:
   320	    attempt: number;
   321	    durationMs: number;
   322	    lastError?: string;
   323	    source?: string;
   324	    identity?: RequestIdentity;
   325	    tokenCount?: number;
   326	    costUsd?: number | null;
   327	    correlationId?: string;
   328	  };
   329	  'recovery:failed': {
   330	    projectId: string;
   331	    error: string;
   332	    attempt: number;
   333	    source?: string;
   334	    identity?: RequestIdentity;
   335	    correlationId?: string;
   336	  };
   337	  'recovery:exhausted': {
   338	    projectId: string;
   339	    totalAttempts: number;
   340	    lastError: string;
   341	    source?: string;
   342	    identity?: RequestIdentity;
   343	    correlationId?: string;
   344	  };
   345	  'recovery:approval-needed': {
   346	    projectId: string;
   347	    actionRunId: string;
   348	    toolName: string;
   349	    attempt: number;
   350	    source?: string;
   351	    identity?: RequestIdentity;
   352	    correlationId?: string;
   353	  };
   354	  'recovery:approval-resolved': {
   355	    actionRunId: string;
   356	    approved: boolean;
   357	    projectId?: string;
   358	    correlationId?: string;
   359	  };
   360	  'env:new-keys-detected': {
   361	    projectId: string;
   362	    projectName: string;
   363	    newKeys: string[];
   364	    templateFile: string;
   365	  };
   366	  'rollback:suggested': {
   367	    projectId: string;
   368	    projectName: string;
   369	    consecutiveFailures: number;
   370	    previousImageTag: string;
   371	  };
   372	  'secret:detected': {
   373	    projectId: string;
   374	    projectName: string;
   375	    secrets: Array<{ file: string; line: number; pattern: string; type: string }>;
   376	  };
   377	  'deploy:diff-analyzed': {
   378	    projectId: string;
   379	    previousSha: string;
   380	    currentSha: string;
   381	    totalChanged: number;
   382	    buildImpactFiles: string[];
   383	    envTemplateChanged: boolean;
   384	    dockerChanged: boolean;
   385	    depsChanged: boolean;
   386	  };
   387	}
   388
   389	// --- Event handler type ---
   390
   391	type EventHandler<T extends EventType> = (payload: EventPayload[T]) => void | Promise<void>;
   392
   393	// --- Event Bus ---
   394
   395	export class EventBus {
   396	  private handlers = new Map<EventType, Set<EventHandler<EventType>>>();
   397	  private captureHook?: (event: string, payload: unknown) => void;
   398
   399	  /** Subscribe to an event. Returns an unsubscribe function. */
   400	  on<T extends EventType>(event: T, handler: EventHandler<T>): () => void {
   401	    if (!this.handlers.has(event)) {
   402	      this.handlers.set(event, new Set());
   403	    }
   404
   405	    const handlerSet = this.handlers.get(event);
   406	    if (!handlerSet) {
   407	      return () => {
   408	        /* noop */
   409	      };
   410	    }
   411	    handlerSet.add(handler as EventHandler<EventType>);
   412
   413	    return () => {
   414	      handlerSet.delete(handler as EventHandler<EventType>);
   415	    };
   416	  }
   417
   418	  /** Subscribe to an event — fires only once, then auto-unsubscribes. */
   419	  once<T extends EventType>(event: T, handler: EventHandler<T>): () => void {
   420	    const unsubscribe = this.on(event, (payload) => {
   421	      unsubscribe();
   422	      return handler(payload);
   423	    });
   424	    return unsubscribe;
   425	  }
   426
   427	  /** Emit an event to all subscribers. Errors in handlers are caught and logged. */
   428	  async emit<T extends EventType>(event: T, payload: EventPayload[T]): Promise<void> {
   429	    if (this.captureHook) {
   430	      try {
   431	        this.captureHook(event, payload);
   432	      } catch {
   433	        // Swallow capture hook errors to never break emit flow
   434	      }
   435	    }
   436
   437	    const handlerSet = this.handlers.get(event);
   438	    if (!handlerSet || handlerSet.size === 0) return;
   439
   440	    const promises: Promise<void>[] = [];
   441
   442	    for (const handler of handlerSet) {
   443	      try {
   444	        const result = handler(payload);
   445	        if (result instanceof Promise) {
   446	          promises.push(
   447	            result.catch((err: unknown) => {
   448	              log.error({ err, event }, 'Error in handler');
   449	            }),
   450	          );
   451	        }
   452	      } catch (err) {
   453	        log.error({ err, event }, 'Error in handler');
   454	      }
   455	    }
   456
   457	    if (promises.length > 0) {
   458	      await Promise.all(promises);
   459	    }
   460	  }
   461
   462	  /** Remove all handlers for an event (or all events if no event specified). */
   463	  clear(event?: EventType): void {
   464	    if (event) {
   465	      this.handlers.delete(event);
   466	    } else {
   467	      this.handlers.clear();
   468	    }
   469	  }
   470
   471	  /** Get count of handlers for an event. Useful for testing. */
   472	  listenerCount(event: EventType): number {
   473	    return this.handlers.get(event)?.size ?? 0;
   474	  }
   475
   476	  /** Set a capture hook that receives all emitted events. */
   477	  setCaptureHook(hook: (event: string, payload: unknown) => void): void {
   478	    this.captureHook = hook;
   479	  }
   480
   481	  /** Remove the capture hook. */
   482	  removeCaptureHook(): void {
   483	    this.captureHook = undefined;
   484	  }
   485	}
   486
   487	/** Singleton event bus instance for the application. */
   488	export const eventBus = new EventBus();

exec
/bin/bash -lc "nl -ba src/monitor/recovery-coordinator.ts | sed -n '220,360p'" in /home/lee/OpenLander
 succeeded in 0ms:
   220
   221	    if (!this.getConfig().ai.autoRecovery.enabled) {
   222	      return false;
   223	    }
   224
   225	    if (this.isOperatorSuppressed(projectId)) {
   226	      return false;
   227	    }
   228
   229	    const hourAgo = Date.now() - 3_600_000;
   230	    this.llmCallTimestamps = this.llmCallTimestamps.filter((timestamp) => timestamp > hourAgo);
   231	    return this.llmCallTimestamps.length <= this.maxLlmCallsPerHour;
   232	  }
   233
   234	  private async handleHealthDegraded(payload: EventPayload['health:degraded']): Promise<void> {
   235	    try {
   236	      const result = this.checkEligibility(payload.projectId);
   237	      if (!result.eligible) {
   238	        await this.emitBlocked(payload.projectId, result.reason);
   239	        return;
   240	      }
   241
   242	      this.recordLlmCall();
   243
   244	      if (this.opsAgent) {
   245	        const project = this.getProjectSnapshot(payload.projectId);
   246	        this.opsAgent.enqueue({
   247	          type: 'deploy:crash',
   248	          payload: {
   249	            projectId: payload.projectId,
   250	            projectName: project?.name ?? payload.projectId,
   251	            containerId: project?.container_id ?? '',
   252	          },
   253	          timestamp: Date.now(),
   254	        });
   255	      }
   256
   257	      this.projectStatusWriter.updateProject(payload.projectId, { status: 'recovering' });
   258
   259	      // When OpsAgent is unavailable (null), use projectId as fallback correlationId
   260	      // since no incident is created in that case
   261	      const correlationId = this.opsAgent ? undefined : payload.projectId;
   262
   263	      await this.events.emit('recovery:started', {
   264	        projectId: payload.projectId,
   265	        trigger: 'health:degraded',
   266	        correlationId,
   267	      });
   268	    } catch (err) {
   269	      log.error(
   270	        { err, projectId: payload.projectId },
   271	        'Unhandled error in health:degraded handler',
   272	      );
   273	    }
   274	  }
   275
   276	  private async handleContainerFailure(
   277	    trigger: 'container:die' | 'container:oom' | 'container:missing',
   278	    payload:
   279	      | EventPayload['container:die']
   280	      | EventPayload['container:oom']
   281	      | EventPayload['container:missing'],
   282	  ): Promise<void> {
   283	    try {
   284	      const result = this.checkEligibility(payload.projectId);
   285	      if (!result.eligible) {
   286	        const unhandledReasons: EligibilityReason[] = [
   287	          'ai_disabled',
   288	          'global_budget_exceeded',
   289	          'circuit_breaker_open',
   290	        ];
   291	        if (result.reason && unhandledReasons.includes(result.reason)) {
   292	          this.projectStatusWriter.updateProject(payload.projectId, { status: 'error' });
   293	        }
   294	        await this.emitBlocked(payload.projectId, result.reason);
   295	        return;
   296	      }
   297
   298	      if (this.opsAgent) {
   299	        const project = this.getProjectSnapshot(payload.projectId);
   300	        this.opsAgent.enqueue({
   301	          type: 'deploy:crash',
   302	          payload: {
   303	            projectId: payload.projectId,
   304	            projectName: project?.name ?? payload.projectId,
   305	            containerId: payload.containerId || project?.container_id || '',
   306	          },
   307	          timestamp: Date.now(),
   308	        });
   309	      }
   310
   311	      this.projectStatusWriter.updateProject(payload.projectId, { status: 'recovering' });
   312
   313	      // When OpsAgent is unavailable (null), use projectId as fallback correlationId
   314	      const correlationId = this.opsAgent ? undefined : payload.projectId;
   315
   316	      await this.events.emit('recovery:started', {
   317	        projectId: payload.projectId,
   318	        trigger,
   319	        correlationId,
   320	      });
   321	    } catch (err) {
   322	      log.error({ err, projectId: payload.projectId }, `Unhandled error in ${trigger} handler`);
   323	    }
   324	  }
   325
   326	  private async handleDeployFailed(payload: EventPayload['deploy:failed']): Promise<void> {
   327	    try {
   328	      if (payload.source === 'mcp' || consumeMcpDeploy(payload.projectId)) {
   329	        log.info({ projectId: payload.projectId }, 'MCP-triggered deploy, skipping auto-recovery');
   330	        return;
   331	      }
   332
   333	      const result = this.checkEligibility(payload.projectId);
   334	      if (!result.eligible) {
   335	        await this.emitBlocked(payload.projectId, result.reason);
   336	        return;
   337	      }
   338
   339	      await this.deploymentRecovery?.(
   340	        payload.projectId,
   341	        payload.error,
   342	        payload.step,
   343	        payload.buildLog,
   344	      );
   345	    } catch (err) {
   346	      log.error({ err, projectId: payload.projectId }, 'Unhandled error in deploy:failed handler');
   347	    }
   348	  }
   349
   350	  private async handleComposeFailed(payload: EventPayload['compose:failed']): Promise<void> {
   351	    try {
   352	      if (consumeMcpDeploy(payload.projectId)) {
   353	        log.info(
   354	          { projectId: payload.projectId },
   355	          'MCP-triggered compose deploy, skipping auto-recovery',
   356	        );
   357	        return;
   358	      }
   359
   360	      const result = this.checkEligibility(payload.projectId);

exec
/bin/bash -lc "nl -ba src/llm/agent.ts | sed -n '200,360p'" in /home/lee/OpenLander
 succeeded in 0ms:
   200	      this.history.push({ role: 'user', content: userMessage });
   201
   202	      await onEvent({ type: 'thinking' });
   203
   204	      // Wire question bridge to emit through this stream's onEvent callback.
   205	      if (this.questionBridge) {
   206	        this.questionBridge.setQuestionHandler((request: QuestionRequest) => {
   207	          void onEvent({ type: 'question', request });
   208	        });
   209	      }
   210
   211	      const allToolResults: ToolResult[] = [];
   212	      let responseText = '';
   213	      const startedAt = Date.now();
   214	      const projectId = scope?.projectId;
   215	      const modelName = this.getModelName();
   216	      const source = this.actionType;
   217	      let didStreamFail = false;
   218	      let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
   219	      let currentStepIndex = 0;
   220	      let lastToolName: string | undefined;
   221
   222	      const guardedTools = this.buildGuardedTools(onEvent, actionRunId);
   223
   224	      if (projectId) {
   225	        await eventBus.emit('ai:invoked', {
   226	          projectId,
   227	          source,
   228	          model: modelName,
   229	          action: 'chatStream',
   230	          correlationId: projectId,
   231	        });
   232	      }
   233
   234	      try {
   235	        const result = streamText({
   236	          model: this.model,
   237	          messages: this.history.map((m) => ({
   238	            role: m.role,
   239	            content: m.content,
   240	          })),
   241	          tools: guardedTools,
   242	          maxRetries: 1,
   243	          stopWhen: stepCountIs(MAX_TOOL_STEPS),
   244	        });
   245
   246	        streamLoop: for await (const part of result.fullStream) {
   247	          switch (part.type) {
   248	            case 'text-delta': {
   249	              responseText += part.text;
   250	              break;
   251	            }
   252	            case 'reasoning-delta': {
   253	              await onEvent({ type: 'reasoning', content: part.text });
   254	              break;
   255	            }
   256	            case 'tool-call': {
   257	              lastToolName = part.toolName;
   258	              await onEvent({
   259	                type: 'tool_call',
   260	                toolName: part.toolName,
   261	                arguments: part.input as Record<string, unknown>,
   262	                stepIndex: currentStepIndex,
   263	              });
   264	              break;
   265	            }
   266	            case 'tool-result': {
   267	              const toolResult: ToolResult = {
   268	                toolName: part.toolName,
   269	                success: true,
   270	                result: part.output,
   271	              };
   272	              allToolResults.push(toolResult);
   273	              await onEvent({ type: 'tool_result', ...toolResult, stepIndex: currentStepIndex });
   274	              break;
   275	            }
   276	            case 'tool-error': {
   277	              const errorResult: ToolResult = {
   278	                toolName: part.toolName,
   279	                success: false,
   280	                error: part.error instanceof Error ? part.error.message : String(part.error),
   281	              };
   282	              allToolResults.push(errorResult);
   283	              await onEvent({ type: 'tool_result', ...errorResult, stepIndex: currentStepIndex });
   284	              break;
   285	            }
   286	            case 'finish-step': {
   287	              currentStepIndex++;
   288	              if (actionRunId) {
   289	                this.db.updateActionRunStep(actionRunId, currentStepIndex);
   290	              }
   291	              await onEvent({
   292	                type: 'step_progress',
   293	                step: currentStepIndex,
   294	                toolName: lastToolName,
   295	              });
   296	              lastToolName = undefined;
   297	              // Emit thinking for next step if there are more steps coming
   298	              await onEvent({ type: 'thinking' });
   299	              break;
   300	            }
   301	            case 'error': {
   302	              const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
   303	              await onEvent({ type: 'error', error: errMsg });
   304	              didStreamFail = true;
   305	              break streamLoop;
   306	            }
   307	            default:
   308	              break;
   309	          }
   310	        }
   311
   312	        if (!didStreamFail) {
   313	          usage = extractUsageFromResult(await result.usage);
   314	        }
   315	      } catch (error) {
   316	        const rawMsg = error instanceof Error ? error.message : String(error);
   317	        const isRateLimit = /rate.limit|too many|429|quota|exceeded/i.test(rawMsg);
   318	        const errMsg = isRateLimit
   319	          ? `LLM rate limit exceeded. Please wait a moment and try again. (${rawMsg})`
   320	          : rawMsg;
   321	        await onEvent({ type: 'error', error: errMsg });
   322	        didStreamFail = true;
   323	      } finally {
   324	        if (projectId) {
   325	          await eventBus.emit('ai:completed', {
   326	            projectId,
   327	            source,
   328	            model: modelName,
   329	            action: 'chatStream',
   330	            correlationId: projectId,
   331	            durationMs: Date.now() - startedAt,
   332	            inputTokens: usage.inputTokens || undefined,
   333	            outputTokens: usage.outputTokens || undefined,
   334	            success: !didStreamFail,
   335	          });
   336	        }
   337	      }
   338
   339	      if (didStreamFail) {
   340	        if (actionRunId) {
   341	          this.db.updateActionRunStatus(actionRunId, 'failed', 'Agent stream execution failed');
   342	        }
   343	        this.logUsageSafe({
   344	          projectId: this.currentScope?.projectId,
   345	          sessionId: resolvedSessionId,
   346	          actionType: this.actionType,
   347	          modelName,
   348	          provider: this.provider,
   349	          inputTokens: 0,
   350	          outputTokens: 0,
   351	          totalTokens: 0,
   352	          toolsCalled: allToolResults.map((toolResult) => toolResult.toolName),
   353	          result: 'failure',
   354	          durationMs: Date.now() - startedAt,
   355	          source: this.actionType === 'auto_recovery' ? 'auto-recovery' : 'web',
   356	        });
   357	        return;
   358	      }
   359
   360	      const finalText =

exec
/bin/bash -lc "nl -ba src/web/api/routes.ts | sed -n '320,430p'" in /home/lee/OpenLander
 succeeded in 0ms:
   320	          liveBuffer.length = 0;
   321	        }
   322
   323	        // Step 6: From here, live events are written directly by the listener above
   324	        await Promise.resolve();
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
   341	    // Apply multi-type filter in-memory when multiple types requested
   342	    if (typeFilter && typeFilter.size > 1) {
   343	      activities = activities.filter((e) => typeFilter.has(e.type));
   344	    }
   345
   346	    return c.json({ activities });
   347	  });
   348
   349	  // --- Global Secrets ---
   350
   351	  api.get('/secrets', (c) => {
   352	    const secrets = ctx.env.getGlobalSecretsMasked();
   353	    return c.json({ secrets });
   354	  });
   355
   356	  api.get('/action-runs', (c) => {
   357	    const approvalStatus = c.req.query('approval_status');
   358	    if (!approvalStatus) {
   359	      return c.json({ actionRuns: [] });
   360	    }
   361
   362	    if (
   363	      approvalStatus !== 'pending' &&
   364	      approvalStatus !== 'approved' &&
   365	      approvalStatus !== 'rejected'
   366	    ) {
   367	      return c.json({ error: 'INVALID_FIELD', message: 'approval_status is invalid' }, 400);
   368	    }
   369
   370	    const actionRuns = ctx.db.getActionRunsByApprovalStatus(approvalStatus, 20).map((run) => ({
   371	      ...run,
   372	      recovery_strategy: run.recovery_strategy === 'unknown' ? null : run.recovery_strategy,
   373	    }));
   374	    return c.json({ actionRuns });
   375	  });
   376
   377	  api.post('/action-runs/:id/approve', async (c) => {
   378	    const id = c.req.param('id');
   379	    const actionRun = ctx.db.findActionRunPendingApproval(id);
   380	    if (!actionRun) {
   381	      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
   382	    }
   383
   384	    ctx.db.updateActionRunApproval(id, 'approved', actionRun.approval_tool ?? undefined);
   385	    await eventBus.emit('recovery:approval-resolved', {
   386	      actionRunId: id,
   387	      approved: true,
   388	      projectId: actionRun.project_id,
   389	    });
   390
   391	    return c.json({ success: true, actionRunId: id, status: 'approved' });
   392	  });
   393
   394	  api.post('/action-runs/:id/reject', async (c) => {
   395	    const id = c.req.param('id');
   396	    const actionRun = ctx.db.findActionRunPendingApproval(id);
   397	    if (!actionRun) {
   398	      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
   399	    }
   400
   401	    ctx.db.updateActionRunApproval(id, 'rejected', actionRun.approval_tool ?? undefined);
   402	    await eventBus.emit('recovery:approval-resolved', {
   403	      actionRunId: id,
   404	      approved: false,
   405	      projectId: actionRun.project_id,
   406	    });
   407
   408	    return c.json({ success: true, actionRunId: id, status: 'rejected' });
   409	  });
   410
   411	  api.post('/secrets', async (c) => {
   412	    const body = await c.req.json<{ key: string; value: string; description?: string }>();
   413	    if (!body.key || !body.value) {
   414	      return c.json({ error: 'MISSING_FIELD', message: 'key and value are required' }, 400);
   415	    }
   416	    ctx.env.setGlobalSecret(body.key, body.value, body.description);
   417	    return c.json({ status: 'saved', key: body.key });
   418	  });
   419
   420	  api.delete('/secrets/:key', (c) => {
   421	    const key = c.req.param('key');
   422	    const deleted = ctx.env.deleteGlobalSecret(key);
   423	    if (!deleted) {
   424	      return c.json({ error: 'NOT_FOUND', message: `Secret "${key}" not found` }, 404);
   425	    }
   426	    return c.json({ status: 'deleted', key });
   427	  });
   428
   429	  api.get('/traefik/config', (c) => {
   430	    const routers: Record<string, { rule: string; entryPoints: string[]; service: string }> = {};

exec
/bin/bash -lc "rg -n \"new Database\\(|createDrizzleDatabase\\(|EXPLAIN QUERY PLAN|better-sqlite3|journal_mode|wal\" src test package.json" in /home/lee/OpenLander
 succeeded in 0ms:
package.json:60:    "better-sqlite3": "^12.8.0",
package.json:81:    "@types/better-sqlite3": "^7.6.13",
test/env-manager-environments.test.ts:18:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/env-merge-precedence.test.ts:59:    db = new Database(join(tmpDir, 'test.db'));
test/redeploy-build-method.test.ts:40:    db = new Database(join(tmpDir, 'test.db'));
test/config/ai-features.test.ts:127:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/image-deploy-e2e.test.ts:43:    db = new Database(join(tempDir, 'test.db'));
test/pipeline/image-deploy.test.ts:17:    db = new Database(join(tempDir, 'test.db'));
src/pipeline/secret-scan.ts:71:function walkDir(dir: string, basePath: string): string[] {
src/pipeline/secret-scan.ts:83:          files.push(...walkDir(fullPath, basePath));
src/pipeline/secret-scan.ts:103:  const files = walkDir(projectPath, projectPath);
test/pipeline/build-deploy-config.test.ts:16:    db = new Database(join(tempDir, 'test.db'));
test/port.test.ts:64:    db = new Database(join(tmpDir, 'test.db'));
test/port.test.ts:168:    db = new Database(join(tmpDir, 'test.db'));
test/compose.test.ts:56:    db = new Database(join(tmpDir, 'test.db'));
test/web/api/activity-routes.test.ts:58:    const db = createDrizzleDatabase(':memory:');
src/pipeline/docker.ts:1005:      // Check if image exists locally — if so, swallow the pull error
test/web/api/ai-usage-routes.test.ts:60:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/deploy-config-integration.test.ts:57:    db = new Database(join(tmpDir, 'test.db'));
test/db.test.ts:18:  const BetterSqlite3 = require('better-sqlite3') as new (path: string) => LegacySqlite;
test/db.test.ts:28:    db = new Database(join(tmpDir, 'test.db'));
test/db.test.ts:260:      db = new Database(dbPath);
test/pipeline/event-golden.test.ts:136:    db = new Database(join(tmpDir, 'test.db'));
test/llm/transparency.test.ts:69:      db = new Database(join(tmpDir, 'test.db'));
test/pipeline/resolve-env.test.ts:55:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/redeploy-config-char.test.ts:33:    db = new Database(join(tmpDir, 'test.db'));
test/llm/memory.test.ts:90:    db = new Database(join(tmpDir, 'test.db'));
test/llm/memory.test.ts:176:    db = new Database(join(tmpDir, 'test.db'));
src/pipeline/deploy-plan/engine.ts:492:        pattern: /better-sqlite3|"sqlite3"|sql\.js|drizzle.*sqlite|prisma.*sqlite/i,
test/setup-llm-routes.test.ts:143:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/performance-baseline.test.ts:60:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/auto-recovery.test.ts:58:  const db = new Database(join(tmpDir, 'test.db'));
test/pipeline/compose-redeploy-char.test.ts:47:    db = new Database(join(tmpDir, 'test.db'));
test/secret-files.test.ts:16:    db = new Database(join(tmpDir, 'test.db'));
test/deploy-controls.test.ts:48:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/preflight.test.ts:27:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/preflight.test.ts:368:      db = new Database(join(tmpDir, 'test.db'));
test/web-routes.test.ts:63:    db = new Database(join(tmpDir, 'test.db'));
test/compose-network.test.ts:32:    db = new Database(join(tmpDir, 'test.db'));
test/db/deploy-config-repo.test.ts:22:    db = new Database(join(tmpDir, 'test.db'));
test/db/deploy-config-repo.test.ts:84:    const dbBundle = createDrizzleDatabase(dbPath);
test/deploy-stream-routes.test.ts:71:    db = new Database(join(tmpDir, 'test.db'));
test/environments.test.ts:18:  const BetterSqlite3 = require('better-sqlite3') as new (
test/environments.test.ts:31:    db = new Database(join(tmpDir, 'test.db'));
test/environments.test.ts:170:    const migratedDb = new Database(legacyDbPath);
test/pipeline/deploy/lifecycle.test.ts:38:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/deploy/rollback.test.ts:37:    db = new Database(join(tmpDir, 'test.db'));
test/pipeline/deploy/tunnel.test.ts:42:    db = new Database(join(tmpDir, 'test.db'));
test/deploy-plan-db.test.ts:14:    db = new Database(join(tmpDir, 'test.db'));
test/db/repos/project-ops-override.repo.test.ts:15:    const dbInstance = createDrizzleDatabase(':memory:');
test/deploy-crash-log.test.ts:40:    db = new Database(join(tmpDir, 'test.db'));
test/db/repos/action-run.repo.test.ts:11:    const db = createDrizzleDatabase(':memory:');
test/domain-routes.test.ts:54:    db = new Database(join(tmpDir, 'test.db'));
test/env-example-gen.test.ts:66:    db = new Database(join(tmp, 'test.db'));
test/db/repos/project.repo.test.ts:12:    const db = createDrizzleDatabase(':memory:');
test/db/repos/deployment-pattern.repo.test.ts:11:    const db = createDrizzleDatabase(':memory:');
test/blue-green-port-conflict.test.ts:106:    db = new Database(join(tmpDir, 'test.db'));
test/db/repos/ai-usage-log.repo.test.ts:12:    const db = createDrizzleDatabase(':memory:');
test/deploy-lock.test.ts:46:    db = new Database(join(tmpDir, 'test.db'));
test/db/repos/project-dependency.repo.test.ts:11:    const db = createDrizzleDatabase(':memory:');
test/env-api-routes.test.ts:20:    db = new Database(join(tmpDir, 'test.db'));
test/deploy-build-method-fallback.test.ts:40:    db = new Database(join(tmpDir, 'test.db'));
test/tools/platform-integration.test.ts:231:    // Emit should still succeed (errors in capture hook are swallowed)
test/env-roundtrip.test.ts:18:    db = new Database(join(tmpDir, 'test.db'));
test/env-roundtrip.test.ts:131:    db = new Database(join(tmpDir, 'test.db'));
src/app.ts:240:  const db = new Database(dbPath);
test/tools/env-source.test.ts:20:    db = new Database(join(tmpDir, 'test.db'));
test/deploy-dockerfile-path.test.ts:41:    db = new Database(join(tmpDir, 'test.db'));
test/network-service-integration.test.ts:58:    db = new Database(join(tmpDir, 'test.db'));
test/network-service-integration.test.ts:207:    db = new Database(join(tmpDir, 'test.db'));
test/network-service-integration.test.ts:342:    db = new Database(join(tmpDir, 'test.db'));
src/lib/infra-analyzer.ts:134:  function walk(current: string, depth: number): void {
src/lib/infra-analyzer.ts:167:          walk(fullPath, depth + 1);
src/lib/infra-analyzer.ts:179:  walk(dir, 0);
test/start-deploy.test.ts:37:    db = new Database(join(tmpDir, 'test.db'));
test/deploy-environment.test.ts:59:    db = new Database(join(tmpDir, 'test.db'));
src/lib/repo-scanner.ts:13:  function walk(current: string, depth: number): void {
src/lib/repo-scanner.ts:32:          walk(fullPath, depth + 1);
src/lib/repo-scanner.ts:40:  walk(dir, 0);
src/cli/index.ts:318:      const db = new Database(dbPath);
src/events/index.ts:433:        // Swallow capture hook errors to never break emit flow
src/llm/prompts.ts:364:- Keep responses concise: short sections, scannable formatting, no long walls of text
src/db/drizzle.ts:31:export function createDrizzleDatabase(dbPath: string): DrizzleDatabase {
src/db/drizzle.ts:34:  const sqlite = new (require('better-sqlite3') as new (path: string) => SqliteDatabase)(dbPath);
src/db/drizzle.ts:36:  sqlite.exec('PRAGMA journal_mode = WAL');
src/db/drizzle.ts:41:    require('drizzle-orm/better-sqlite3') as {
src/monitor/activity-logger.ts:72:        // Synchronous insert — SQLite is sync via better-sqlite3
src/db/index.ts:89:    const { sqlite, db } = createDrizzleDatabase(dbPath);
src/tools/defs/git.ts:27:  function walk(current: string, depth: number): void {
src/tools/defs/git.ts:51:          walk(fullPath, depth + 1);
src/tools/defs/git.ts:60:  walk(dir, 0);
src/tools/defs/compose.ts:253:  function walk(current: string, depth: number): void {
src/tools/defs/compose.ts:277:          walk(fullPath, depth + 1);
src/tools/defs/compose.ts:285:  walk(dir, 0);

codex
I have the main failure modes now. I’m verifying one specific protocol concern against the client-side consumer: whether the SSE stream’s live event IDs are expected to become the next `since` cursor. If they are, there’s a hard correctness break in the current route implementation.
exec
/bin/bash -lc "rg -n \"backfill-complete|since=|/api/activity|correlationId|follow=1|lastEventId|lastSeen\" web/src src -g '"'!dist'"'" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/auto-recovery.ts:383:      correlationId: projectId,
src/pipeline/auto-recovery.ts:464:                correlationId: projectId,
src/pipeline/auto-recovery.ts:510:              correlationId: projectId,
src/pipeline/auto-recovery.ts:517:              correlationId: projectId,
src/pipeline/auto-recovery.ts:534:            correlationId: projectId,
src/pipeline/auto-recovery.ts:546:            correlationId: projectId,
src/pipeline/auto-recovery.ts:560:          correlationId: projectId,
src/llm/agent.ts:230:          correlationId: projectId,
src/llm/agent.ts:330:            correlationId: projectId,
src/events/index.ts:278:    correlationId?: string;
src/events/index.ts:289:    correlationId?: string;
src/events/index.ts:303:    correlationId?: string;
src/events/index.ts:308:    correlationId?: string;
src/events/index.ts:316:    correlationId?: string;
src/events/index.ts:327:    correlationId?: string;
src/events/index.ts:335:    correlationId?: string;
src/events/index.ts:343:    correlationId?: string;
src/events/index.ts:352:    correlationId?: string;
src/events/index.ts:358:    correlationId?: string;
src/db/repos/action-run.repo.ts:21:    correlationId?: string;
src/db/repos/action-run.repo.ts:37:        correlation_id: data.correlationId ?? null,
src/web/api/routes.ts:96:    correlationId: row.correlation_id ?? undefined,
src/web/api/routes.ts:226:    const correlationIdFilter = c.req.query('correlationId') ?? undefined;
src/web/api/routes.ts:241:    if (correlationIdFilter) dbFilters.correlation_id = correlationIdFilter;
src/web/api/routes.ts:308:            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
src/web/api/routes.ts:312:            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
src/web/api/ops-routes.ts:21:  correlationId?: string;
src/web/api/ops-routes.ts:458:            correlationId: run.correlation_id ?? undefined,
web/src/hooks/use-ops-center-data.ts:58:  const lastEventIdRef = useRef<string | null>(null);
web/src/hooks/use-ops-center-data.ts:90:        if (lastEventIdRef.current) {
web/src/hooks/use-ops-center-data.ts:91:          params.set('since', lastEventIdRef.current);
web/src/hooks/use-ops-center-data.ts:94:        const resp = await fetch(`/api/activity?${params.toString()}`, {
web/src/hooks/use-ops-center-data.ts:133:              // Handle backfill-complete sentinel
web/src/hooks/use-ops-center-data.ts:134:              if (parsed.type === 'backfill-complete') {
web/src/hooks/use-ops-center-data.ts:153:              lastEventIdRef.current = item.id;
web/src/hooks/use-ops-center-data.ts:220:      fetch('/api/activity?limit=100', { credentials: 'include' })
web/src/hooks/use-ops-center-data.ts:242:          lastEventIdRef.current = items[0].id;
web/src/hooks/use-activity-stream.ts:35:        const resp = await fetch(`/api/activity?${params.toString()}`, {
web/src/components/ops/IncidentMap.tsx:87:          lastSeen: Math.max(...entries.map((item) => new Date(item.created_at).getTime())),
web/src/components/ops/IncidentMap.tsx:99:      return b.group.lastSeen - a.group.lastSeen;
src/monitor/ops-recovery.ts:119:      correlationId: incidentId ?? undefined,
src/monitor/ops-recovery.ts:172:      correlationId: context.incidentId ?? undefined,
src/monitor/ops-recovery.ts:597:      correlationId: context.incidentId ?? undefined,
src/monitor/activity-logger.ts:77:          // Extract correlationId from payload when available
src/monitor/activity-logger.ts:78:          const correlationId =
src/monitor/activity-logger.ts:79:            activity.correlationId ??
src/monitor/activity-logger.ts:80:            (payload as { correlationId?: string }).correlationId ??
src/monitor/activity-logger.ts:94:            correlation_id: correlationId ?? null,
web/src/components/ops/ActivityFeed.tsx:113:    const key = item.correlationId || `${item.projectId}::${item.title}::${tsBucket}`;
web/src/components/ops/IncidentCard.tsx:25:  lastSeen: number;
web/src/components/ops/IncidentCard.tsx:137:            <span className="text-secondary-ol">{relativeTime(group.lastSeen, language)}</span>
web/src/components/ops/v2/MainTimeline.tsx:32:  correlationId: string;
web/src/components/ops/v2/MainTimeline.tsx:46:  onThreadSelect?: (correlationId: string) => void;
web/src/components/ops/v2/MainTimeline.tsx:59:    const key = item.correlationId || `${item.projectId}::${item.type}::${tsBucket}`;
web/src/components/ops/v2/MainTimeline.tsx:94:      correlationId: key,
web/src/components/ops/v2/MainTimeline.tsx:168:      initial[th.correlationId] = th.hasPendingApproval;
web/src/components/ops/v2/MainTimeline.tsx:173:  const allExpanded = threadData.length > 0 && threadData.every((th) => !!expandedMap[th.correlationId]);
web/src/components/ops/v2/MainTimeline.tsx:180:        map[th.correlationId] = next;
web/src/components/ops/v2/MainTimeline.tsx:187:    (correlationId: string) => {
web/src/components/ops/v2/MainTimeline.tsx:188:      setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
web/src/components/ops/v2/MainTimeline.tsx:189:      onThreadSelect?.(correlationId);
web/src/components/ops/v2/MainTimeline.tsx:194:  const showMoreEvents = useCallback((correlationId: string) => {
web/src/components/ops/v2/MainTimeline.tsx:197:      [correlationId]: (prev[correlationId] ?? EVENTS_PAGE_SIZE) + EVENTS_PAGE_SIZE,
web/src/components/ops/v2/MainTimeline.tsx:227:        const isExpanded = !!expandedMap[thread.correlationId];
web/src/components/ops/v2/MainTimeline.tsx:230:        const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
web/src/components/ops/v2/MainTimeline.tsx:236:            key={thread.correlationId}
web/src/components/ops/v2/MainTimeline.tsx:238:            onOpenChange={() => toggleThread(thread.correlationId)}
web/src/components/ops/v2/MainTimeline.tsx:327:                        showMoreEvents(thread.correlationId);
src/monitor/recovery-coordinator.ts:259:      // When OpsAgent is unavailable (null), use projectId as fallback correlationId
src/monitor/recovery-coordinator.ts:261:      const correlationId = this.opsAgent ? undefined : payload.projectId;
src/monitor/recovery-coordinator.ts:266:        correlationId,
src/monitor/recovery-coordinator.ts:313:      // When OpsAgent is unavailable (null), use projectId as fallback correlationId
src/monitor/recovery-coordinator.ts:314:      const correlationId = this.opsAgent ? undefined : payload.projectId;
src/monitor/recovery-coordinator.ts:319:        correlationId,
src/monitor/activity-event-mapper.ts:10:// ── ActivityEvent shape (matches the legacy /api/activity format) ──
src/monitor/activity-event-mapper.ts:45:  correlationId?: string;
src/monitor/activity-event-mapper.ts:54:  // Backward-compatibility aliases for legacy consumers of /api/activity
src/monitor/activity-event-mapper.ts:450:    correlationId: content.actionRunId,
web/src/lib/api/operations.ts:176:  correlationId?: string;
src/ipc/client.ts:328:      `/api/activity?limit=${String(limit)}`,
src/ipc/client.ts:334:    yield* this.streamNDJSON<ActivityEvent>('/api/activity/stream', signal);
web/src/components/project/OperationsTab.tsx:60:      lastSeen: Math.max(...incidents.map((i) => new Date(i.created_at).getTime())),

exec
/bin/bash -lc "nl -ba web/src/hooks/use-ops-center-data.ts | sed -n '1,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
     2
     3	import {
     4	  fetchAllCircuitBreakers,
     5	  fetchOpsIncidents,
     6	  type ActivityItem,
     7	  type CircuitBreakerWithProject,
     8	  type OpsIncident,
     9	} from '../lib/api/operations';
    10	import { fetchPendingApprovals, type ActionRun } from '../lib/api/projects';
    11	import { type AgentActiveState } from './use-agent-activity';
    12	import { fetchWithAuth } from '../lib/api/auth';
    13
    14	// ---------------------------------------------------------------------------
    15	// Constants
    16	// ---------------------------------------------------------------------------
    17
    18	const BUFFER_MAX = 500;
    19	const MAX_RETRIES = 5;
    20	const BASE_RETRY_DELAY = 3_000; // ms
    21
    22	// ---------------------------------------------------------------------------
    23	// Public interface
    24	// ---------------------------------------------------------------------------
    25
    26	export interface OpsCenterData {
    27	  activities: ActivityItem[];
    28	  incidents: OpsIncident[];
    29	  circuitBreakers: CircuitBreakerWithProject[];
    30	  approvals: ActionRun[];
    31	  agentStatus: AgentActiveState;
    32	  isConnected: boolean;
    33	  isReconnecting: boolean;
    34	  isLoading: boolean;
    35	  error: string | null;
    36	  retry: () => void;
    37	}
    38
    39	// ---------------------------------------------------------------------------
    40	// Hook
    41	// ---------------------------------------------------------------------------
    42
    43	export function useOpsCenterData(): OpsCenterData {
    44	  // --- Core state ---
    45	  const [activities, setActivities] = useState<ActivityItem[]>([]);
    46	  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
    47	  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerWithProject[]>([]);
    48	  const [approvals, setApprovals] = useState<ActionRun[]>([]);
    49	  const [agentStatus, setAgentStatus] = useState<AgentActiveState>({ isActive: false });
    50	  const [isConnected, setIsConnected] = useState(false);
    51	  const [isReconnecting, setIsReconnecting] = useState(false);
    52	  const [isLoading, setIsLoading] = useState(true);
    53	  const [error, setError] = useState<string | null>(null);
    54
    55	  // --- Refs for SSE lifecycle ---
    56	  const abortRef = useRef<AbortController | null>(null);
    57	  const retriesRef = useRef(0);
    58	  const lastEventIdRef = useRef<string | null>(null);
    59	  const dedupSetRef = useRef<Set<string>>(new Set());
    60	  const cancelledRef = useRef(false);
    61
    62	  // ---------------------------------------------------------------------------
    63	  // Deduplication helper: returns true if the item is new (not a dup)
    64	  // ---------------------------------------------------------------------------
    65	  const dedup = useCallback((id: string): boolean => {
    66	    const s = dedupSetRef.current;
    67	    if (s.has(id)) return false;
    68	    s.add(id);
    69	    // Prune when set exceeds 2x buffer to bound memory
    70	    if (s.size > BUFFER_MAX * 2) {
    71	      const arr = [...s];
    72	      dedupSetRef.current = new Set(arr.slice(arr.length - BUFFER_MAX));
    73	    }
    74	    return true;
    75	  }, []);
    76
    77	  // ---------------------------------------------------------------------------
    78	  // SSE connect with backfill + exponential backoff reconnect
    79	  // ---------------------------------------------------------------------------
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
    90	        if (lastEventIdRef.current) {
    91	          params.set('since', lastEventIdRef.current);
    92	        }
    93
    94	        const resp = await fetch(`/api/activity?${params.toString()}`, {
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
   152	              // Track last event ID for gap recovery
   153	              lastEventIdRef.current = item.id;
   154
   155	              if (!dedup(item.id)) continue;
   156
   157	              if (parsed.backfill === true) {
   158	                inBackfill = true;
   159	                backfillBatch.push(item);
   160	              } else if (inBackfill) {
   161	                // Non-backfill item arriving during backfill — buffer it too
   162	                backfillBatch.push(item);
   163	              } else {
   164	                // Incremental live update
   165	                setActivities((prev) => [item, ...prev].slice(0, BUFFER_MAX));
   166	              }
   167	            } catch {
   168	              // Ignore malformed NDJSON lines
   169	            }
   170	          }
   171	        }
   172
   173	        // Stream ended normally — attempt reconnect if still mounted
   174	        if (!cancelledRef.current && retriesRef.current < MAX_RETRIES) {
   175	          retriesRef.current += 1;
   176	          setIsConnected(false);
   177	          setIsReconnecting(true);
   178	          const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   179	          setTimeout(() => {
   180	            if (!cancelledRef.current) {
   181	              setIsReconnecting(false);
   182	              connect();
   183	            }
   184	          }, delay);
   185	        }
   186	      } catch (err) {
   187	        if (controller.signal.aborted) return;
   188
   189	        if (!cancelledRef.current) {
   190	          const message = err instanceof Error ? err.message : 'Stream failed';
   191	          setError(message);
   192	          setIsConnected(false);
   193
   194	          // Auto-retry with exponential backoff
   195	          if (retriesRef.current < MAX_RETRIES) {
   196	            retriesRef.current += 1;
   197	            setIsReconnecting(true);
   198	            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   199	            setTimeout(() => {
   200	              if (!cancelledRef.current) {
   201	                setIsReconnecting(false);
   202	                connect();
   203	              }
   204	            }, delay);
   205	          }
   206	        }
   207	      }
   208	    })();
   209	  }, [dedup]);
   210
   211	  // ---------------------------------------------------------------------------
   212	  // Initial parallel REST snapshot + SSE connect
   213	  // ---------------------------------------------------------------------------
   214	  useEffect(() => {
   215	    cancelledRef.current = false;
   216	    setIsLoading(true);
   217
   218	    // Parallel REST snapshot
   219	    Promise.all([
   220	      fetch('/api/activity?limit=100', { credentials: 'include' })
   221	        .then((r) => {
   222	          if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
   223	          return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
   224	        }),
   225	      fetchOpsIncidents(undefined, 'open'),
   226	      fetchAllCircuitBreakers(),
   227	      fetchPendingApprovals().catch(() => [] as ActionRun[]),
   228	      fetchWithAuth('/api/ops/agent/active')
   229	        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
   230	        .catch(() => ({ isActive: false }) as AgentActiveState),
   231	    ])
   232	      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
   233	        if (cancelledRef.current) return;
   234
   235	        const items = activityData.activities.slice(0, BUFFER_MAX);
   236	        // Seed dedup set with initial snapshot IDs
   237	        for (const item of items) {
   238	          dedupSetRef.current.add(item.id);
   239	        }
   240	        // Track last event ID for SSE gap recovery
   241	        if (items.length > 0) {
   242	          lastEventIdRef.current = items[0].id;
   243	        }
   244
   245	        setActivities(items);
   246	        setIncidents(incidentData.incidents ?? []);
   247	        setCircuitBreakers(cbData.breakers ?? []);
   248	        setApprovals(approvalData);
   249	        setAgentStatus(agentData as AgentActiveState);
   250	        setError(null);
   251	      })
   252	      .catch((err: unknown) => {
   253	        if (!cancelledRef.current) {
   254	          setError(err instanceof Error ? err.message : String(err));
   255	        }
   256	      })
   257	      .finally(() => {
   258	        if (!cancelledRef.current) setIsLoading(false);
   259
   260	        // Open SSE after snapshot
   261	        if (!cancelledRef.current) {
   262	          retriesRef.current = 0;
   263	          connect();
   264	        }
   265	      });
   266
   267	    return () => {
   268	      cancelledRef.current = true;
   269	      abortRef.current?.abort();
   270	      abortRef.current = null;
   271	      dedupSetRef.current.clear();
   272	    };
   273	  }, [connect]);
   274
   275	  // ---------------------------------------------------------------------------
   276	  // Manual retry: reset error and reconnect
   277	  // ---------------------------------------------------------------------------
   278	  const retry = useCallback(() => {
   279	    setError(null);
   280	    setIsLoading(true);
   281	    retriesRef.current = 0;
   282	    connect();
   283	  }, [connect]);
   284
   285	  // ---------------------------------------------------------------------------
   286	  // Derived data via useMemo (avoid recomputation on every SSE event)
   287	  // ---------------------------------------------------------------------------
   288	  const stableActivities = useMemo(() => activities, [activities]);
   289	  const stableIncidents = useMemo(() => incidents, [incidents]);
   290	  const stableCircuitBreakers = useMemo(() => circuitBreakers, [circuitBreakers]);
   291	  const stableApprovals = useMemo(() => approvals, [approvals]);
   292	  const stableAgentStatus = useMemo(() => agentStatus, [agentStatus]);
   293
   294	  return {
   295	    activities: stableActivities,
   296	    incidents: stableIncidents,
   297	    circuitBreakers: stableCircuitBreakers,
   298	    approvals: stableApprovals,
   299	    agentStatus: stableAgentStatus,
   300	    isConnected,
   301	    isReconnecting,
   302	    isLoading,
   303	    error,
   304	    retry,
   305	  };
   306	}

exec
/bin/bash -lc "nl -ba web/src/lib/api/operations.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { fetchWithAuth } from './auth.js';
     2
     3	export interface OpsConfig {
     4	  enabled: boolean;
     5	  recovery: {
     6	    enabled: boolean;
     7	    automation: Record<string, string>;
     8	  };
     9	  auto_cleanup: boolean;
    10	  drift_detection: boolean;
    11	  thresholds: {
    12	    disk_cleanup_percent: number;
    13	    recovery_max_per_day: number;
    14	    alert_dedup_minutes: number;
    15	    digest_time: string;
    16	  };
    17	  channels: {
    18	    email?: {
    19	      host: string;
    20	      port: number;
    21	      secure: boolean;
    22	      auth: { user: string; pass: string };
    23	      from: string;
    24	      to: string[];
    25	    };
    26	  };
    27	}
    28
    29	export async function fetchOpsConfig(): Promise<{ config: OpsConfig }> {
    30	  const res = await fetchWithAuth('/api/ops/config');
    31	  if (!res.ok) {
    32	    throw new Error('Failed to fetch operations config');
    33	  }
    34	  return res.json();
    35	}
    36
    37	export async function updateOpsConfig(config: Partial<OpsConfig>): Promise<{ config: OpsConfig }> {
    38	  const res = await fetchWithAuth('/api/ops/config', {
    39	    method: 'PUT',
    40	    headers: {
    41	      'Content-Type': 'application/json',
    42	    },
    43	    body: JSON.stringify(config),
    44	  });
    45	  if (!res.ok) {
    46	    throw new Error('Failed to update operations config');
    47	  }
    48	  return res.json();
    49	}
    50
    51	export async function triggerTestEmail(): Promise<void> {
    52	  const res = await fetchWithAuth('/api/ops/digest/trigger', {
    53	    method: 'POST',
    54	  });
    55	  if (!res.ok) {
    56	    throw new Error('Failed to send test email');
    57	  }
    58	}
    59
    60	export interface OpsIncidentEvent {
    61	  id: string;
    62	  incident_id: string;
    63	  type: string;
    64	  event_type?: string;
    65	  message: string | null;
    66	  description?: string;
    67	  metadata?: string | null;
    68	  created_at: string | number;
    69	}
    70
    71	export interface OpsIncident {
    72	  id: string;
    73	  project_id: string;
    74	  title: string;
    75	  status: string;
    76	  severity: string;
    77	  root_cause?: string | null;
    78	  diagnosis?: string | null;
    79	  actions_taken?: string | null;
    80	  created_at: string | number;
    81	  updated_at?: string | number;
    82	  resolved_at?: string | number | null;
    83	  escalated_at?: string | number | null;
    84	  events?: OpsIncidentEvent[];
    85	  triggerType?: string;
    86	  triggerDetails?: string;
    87	}
    88
    89	export interface CircuitBreakerState {
    90	  state: string;
    91	  failure_count?: number;
    92	  last_failure_at?: string;
    93	  next_retry_at?: string;
    94	}
    95
    96	export async function fetchOpsIncidents(
    97	  projectId?: string,
    98	  status?: string,
    99	): Promise<{ incidents: OpsIncident[] }> {
   100	  const params = new URLSearchParams();
   101	  if (projectId) params.set('projectId', projectId);
   102	  if (status) params.set('status', status);
   103	  const response = await fetchWithAuth(`/api/ops/incidents?${params.toString()}`);
   104	  if (!response.ok) throw new Error('Failed to fetch incidents');
   105	  return response.json();
   106	}
   107
   108	export async function fetchOpsIncident(
   109	  id: string,
   110	): Promise<{ incident: OpsIncident; events: OpsIncidentEvent[] }> {
   111	  const response = await fetchWithAuth(`/api/ops/incidents/${id}`);
   112	  if (!response.ok) throw new Error('Failed to fetch incident');
   113	  return response.json();
   114	}
   115
   116	export async function fetchCircuitBreakerState(projectId: string): Promise<CircuitBreakerState> {
   117	  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}`);
   118	  if (!response.ok) throw new Error('Failed to fetch circuit breaker state');
   119	  const data = (await response.json()) as {
   120	    state: (CircuitBreakerState & { project_id?: string }) | null;
   121	  };
   122	  return data.state ?? { state: 'closed' };
   123	}
   124
   125	export async function resetCircuitBreaker(projectId: string): Promise<{ reset: boolean }> {
   126	  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}/reset`, {
   127	    method: 'POST',
   128	  });
   129	  if (!response.ok) throw new Error('Failed to reset circuit breaker');
   130	  return response.json() as Promise<{ reset: boolean }>;
   131	}
   132
   133	export async function fetchIncidentEvents(
   134	  incidentId: string,
   135	): Promise<{ events: OpsIncidentEvent[] }> {
   136	  const response = await fetchWithAuth(`/api/ops/incidents/${incidentId}/events`);
   137	  if (!response.ok) return { events: [] };
   138	  return response.json() as Promise<{ events: OpsIncidentEvent[] }>;
   139	}
   140
   141	// === Operations Center types ===
   142
   143	export interface ActivityItem {
   144	  id: string;
   145	  timestamp: string;
   146	  type:
   147	    | 'incident'
   148	    | 'recovery'
   149	    | 'approval'
   150	    | 'circuit_breaker'
   151	    | 'cleanup'
   152	    | 'alert'
   153	    | 'ai_diagnosis'
   154	    | 'ai:invoked'
   155	    | 'ai:completed'
   156	    | 'recovery:blocked'
   157	    | 'recovery:stopped'
   158	    | 'recovery:started';
   159	  severity: 'critical' | 'warning' | 'info';
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
   178	  aiMetadata?: {
   179	    model: string;
   180	    tokensUsed?: number;
   181	    durationMs?: number;
   182	    diagnosisSummary?: string;
   183	  };
   184	}
   185
   186	export interface CircuitBreakerWithProject {
   187	  projectId: string;
   188	  projectName: string;
   189	  state: 'closed' | 'open' | 'half_open';
   190	  failureCount: number;
   191	  lastFailureAt: number | null;
   192	  openedAt: number | null;
   193	  resetAt: number | null;
   194	}
   195
   196	export interface DependencyNode {
   197	  id: string;
   198	  type: 'project' | 'service';
   199	  name: string;
   200	  status: string | null;
   201	}
   202
   203	export interface DependencyEdge {
   204	  source: string;
   205	  target: string;
   206	  dependencyType: string;
   207	}
   208
   209	export async function fetchActivityFeed(opts?: {
   210	  projectId?: string;
   211	  types?: string[];
   212	  severity?: string;
   213	  limit?: number;
   214	  before?: string;
   215	}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
   216	  const params = new URLSearchParams();
   217	  if (opts?.projectId) params.set('projectId', opts.projectId);
   218	  if (opts?.types?.length) params.set('types', opts.types.join(','));
   219	  if (opts?.severity) params.set('severity', opts.severity);
   220	  if (opts?.limit) params.set('limit', String(opts.limit));
   221	  if (opts?.before) params.set('before', opts.before);
   222	  const query = params.toString() ? `?${params.toString()}` : '';
   223	  const resp = await fetchWithAuth(`/api/ops/activity${query}`);
   224	  if (!resp.ok) throw new Error(`fetchActivityFeed failed: ${resp.status}`);
   225	  return resp.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
   226	}
   227
   228	export async function fetchAllCircuitBreakers(): Promise<{
   229	  breakers: CircuitBreakerWithProject[];
   230	}> {
   231	  const resp = await fetchWithAuth('/api/ops/circuit-breakers');
   232	  if (!resp.ok) throw new Error(`fetchAllCircuitBreakers failed: ${resp.status}`);
   233	  return resp.json() as Promise<{ breakers: CircuitBreakerWithProject[] }>;
   234	}
   235
   236	export async function fetchDependencyGraph(): Promise<{
   237	  nodes: DependencyNode[];
   238	  edges: DependencyEdge[];
   239	}> {
   240	  const resp = await fetchWithAuth('/api/ops/dependencies');
   241	  if (!resp.ok) throw new Error(`fetchDependencyGraph failed: ${resp.status}`);
   242	  return resp.json() as Promise<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>;
   243	}

codex
I’ve confirmed the client consumes each streamed item’s `id` as the next `since` cursor. That means the route’s live path must emit the exact persisted row identity, not a freshly synthesized one. I’m tightening the line references and then I’ll write the findings by severity.
exec
/bin/bash -lc "nl -ba src/db/schema.drizzle.ts | sed -n '590,635p'" in /home/lee/OpenLander
 succeeded in 0ms:
   590	export type ActionRunRow = typeof actionRuns.$inferSelect;
   591	export type NewActionRun = typeof actionRuns.$inferInsert;
   592	export type DeploymentPatternRow = typeof deploymentPatterns.$inferSelect;
   593	export type NewDeploymentPattern = typeof deploymentPatterns.$inferInsert;
   594	export type OpsIncidentRow = typeof opsIncidents.$inferSelect;
   595	export type NewOpsIncident = typeof opsIncidents.$inferInsert;
   596	export type OpsIncidentEventRow = typeof opsIncidentEvents.$inferSelect;
   597	export type NewOpsIncidentEvent = typeof opsIncidentEvents.$inferInsert;
   598	export type CircuitBreakerRow = typeof circuitBreakerState.$inferSelect;
   599	export type NewCircuitBreaker = typeof circuitBreakerState.$inferInsert;
   600
   601	export const activityLog = sqliteTable(
   602	  'activity_log',
   603	  {
   604	    id: text('id').primaryKey(),
   605	    event_type: text('event_type').notNull(),
   606	    activity_type: text('activity_type').notNull(),
   607	    severity: text('severity').notNull(),
   608	    project_id: text('project_id').notNull(),
   609	    correlation_id: text('correlation_id'),
   610	    title: text('title').notNull(),
   611	    description: text('description').notNull(),
   612	    status: text('status').notNull(),
   613	    metadata: text('metadata').notNull().default('{}'),
   614	    created_at: text('created_at').notNull(),
   615	  },
   616	  (table) => [
   617	    index('idx_activity_log_created_at').on(table.created_at),
   618	    index('idx_activity_log_correlation_id').on(table.correlation_id),
   619	    index('idx_activity_log_project_created').on(table.project_id, table.created_at),
   620	    index('idx_activity_log_type_created').on(table.activity_type, table.created_at),
   621	  ],
   622	);
   623
   624	export type ActivityLogRow = typeof activityLog.$inferSelect;
   625	export type NewActivityLog = typeof activityLog.$inferInsert;
   626
   627	export const drizzleSchema = {
   628	  projects,
   629	  environments,
   630	  envVars,
   631	  deployLogs,
   632	  timelineEvents,
   633	  domainMappings,
   634	  oauthTokens,
   635	  webhookConfigs,

exec
/bin/bash -lc "nl -ba src/db/migration.ts | sed -n '625,660p'" in /home/lee/OpenLander
 succeeded in 0ms:
   625	  sqlite.exec(
   626	    'CREATE INDEX IF NOT EXISTS idx_project_dependencies_target_service ON project_dependencies(target_service_id)',
   627	  );
   628
   629	  // activity_log table (ops-center-v2)
   630	  sqlite.exec(`CREATE TABLE IF NOT EXISTS activity_log (
   631	    id TEXT PRIMARY KEY,
   632	    event_type TEXT NOT NULL,
   633	    activity_type TEXT NOT NULL,
   634	    severity TEXT NOT NULL,
   635	    project_id TEXT NOT NULL,
   636	    correlation_id TEXT,
   637	    title TEXT NOT NULL,
   638	    description TEXT NOT NULL,
   639	    status TEXT NOT NULL,
   640	    metadata TEXT NOT NULL DEFAULT '{}',
   641	    created_at TEXT NOT NULL
   642	  )`);
   643	  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)');
   644	  sqlite.exec(
   645	    'CREATE INDEX IF NOT EXISTS idx_activity_log_correlation_id ON activity_log(correlation_id)',
   646	  );
   647	  sqlite.exec(
   648	    'CREATE INDEX IF NOT EXISTS idx_activity_log_project_created ON activity_log(project_id, created_at)',
   649	  );
   650	  sqlite.exec(
   651	    'CREATE INDEX IF NOT EXISTS idx_activity_log_type_created ON activity_log(activity_type, created_at)',
   652	  );
   653	}

exec
/bin/bash -lc "nl -ba src/db/index.ts | sed -n '262,276p'" in /home/lee/OpenLander
 succeeded in 0ms:
   262	  findAllProjectDependencies() { return this.projectDependencyRepo.findAll(); }
   263	  deleteProjectDependency(id: string) { this.projectDependencyRepo.delete(id); }
   264	  deleteProjectDependenciesByProject(projectId: string) { this.projectDependencyRepo.deleteByProject(projectId); }
   265	  syncDependenciesFromServiceConnections(serviceConnections: Parameters<ProjectDependencyRepo['syncFromServiceConnections']>[0]) { this.projectDependencyRepo.syncFromServiceConnections(serviceConnections); }
   266	  getProjectOpsOverride(projectId: string) { return this.projectOpsOverrideRepo.load(projectId); }
   267	  setProjectOpsOverride(projectId: string, overrides: ProjectOpsOverride) { this.projectOpsOverrideRepo.save(projectId, overrides); }
   268	  deleteProjectOpsOverride(projectId: string) { this.projectOpsOverrideRepo.delete(projectId); }
   269	  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
   270	  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
   271	  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
   272	  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
   273	  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
   274	  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }
   275	  transaction<T>(fn: () => T) { return this.sqlite.transaction(fn)(); }
   276	  close() { this.sqlite.close(); }

exec
/bin/bash -lc "nl -ba src/pipeline/auto-recovery.ts | sed -n '372,566p'" in /home/lee/OpenLander
 succeeded in 0ms:
   372	    };
   373	    const actionRunId = db.createActionRun({
   374	      projectId,
   375	      triggerSource: 'auto_recovery',
   376	      recoveryStrategy: matchingPatterns.length > 0 ? 'memory' : strategy,
   377	    });
   378
   379	    await eventBus.emit('recovery:start', {
   380	      projectId,
   381	      error,
   382	      attempt,
   383	      correlationId: projectId,
   384	    });
   385
   386	    questionBridge.setActiveProject(projectId);
   387
   388	    const project = db.getProject(projectId);
   389	    const projectName = project?.name ?? projectId;
   390
   391	    if (strategy === 'llm' && agent) {
   392	      await emitTimelineMessage(
   393	        eventBus,
   394	        projectId,
   395	        'AI is analyzing the failure and attempting to fix it...',
   396	      );
   397
   398	      try {
   399	        const sessionId = nanoid(12);
   400	        const contextSnapshot = await buildContextSnapshot(db);
   401	        const approvalState: {
   402	          blocked: 'rejected' | 'timed_out' | 'aborted' | null;
   403	          toolName?: string;
   404	        } = { blocked: null };
   405	        let recoveryMessage = `Deploy of "${projectName}" failed.
   406
   407	## Failure Context
   408	- Project: ${projectName} (${projectId})
   409	- Failed Step: ${step ?? 'unknown'}
   410	- Error: ${error}${
   411	          buildLog
   412	            ? `
   413
   414	## Build Log (last 3000 chars)
   415	${buildLog.slice(-3000)}`
   416	            : ''
   417	        }
   418
   419	## Server Context Snapshot
   420	${contextSnapshot}
   421
   422	${plan.agentGuidance}
   423
   424	## General Recovery Rules
   425	1. If build log is provided above, analyze it directly. Otherwise call debug_build_error("${projectName}").
   426	2. After fixing, redeploy with create_deploy_plan and execute_deploy_plan.
   427	3. Do NOT just suggest fixes - execute them.`;
   428
   429	        if (isAdvisory) {
   430	          recoveryMessage +=
   431	            "\n\nThis appears to be an infrastructure resource issue. You likely cannot fix this via tools alone. Diagnose the issue, explain it clearly, and suggest manual steps (e.g., docker system prune, increase memory). Do NOT retry the deploy unless you've confirmed the resource issue is resolved.";
   432	        }
   433
   434	        await agent.chatStream(
   435	          recoveryMessage,
   436	          async (event) => {
   437	            if (event.type === 'tool_call' && !shouldContinue(projectId)) {
   438	              approvalState.blocked = 'aborted';
   439	              log.info(
   440	                { projectId },
   441	                'shouldContinue: project no longer eligible, stopping recovery tool execution',
   442	              );
   443	              return;
   444	            }
   445
   446	            if (
   447	              event.type === 'tool_call' &&
   448	              decisionEngine.classify(event.toolName) === 'REQUIRE_APPROVAL'
   449	            ) {
   450	              const approvalMetadata = {
   451	                projectId,
   452	                projectName,
   453	                toolName: event.toolName,
   454	                attempt,
   455	                actionRunId,
   456	                createdAt: new Date(),
   457	              };
   458
   459	              await eventBus.emit('recovery:approval-needed', {
   460	                projectId,
   461	                actionRunId,
   462	                toolName: event.toolName,
   463	                attempt,
   464	                correlationId: projectId,
   465	              });
   466
   467	              db.updateActionRunStatus(actionRunId, 'pending_approval');
   468	              db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
   469	              approvalState.toolName = event.toolName;
   470	              const approvalResult = await approvalGate.waitForApproval(
   471	                actionRunId,
   472	                approvalMetadata,
   473	              );
   474
   475	              if (approvalResult === 'rejected') {
   476	                approvalState.blocked = 'rejected';
   477	                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   478	                return;
   479	              }
   480
   481	              if (approvalResult === 'timed_out') {
   482	                approvalState.blocked = 'timed_out';
   483	                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   484	                return;
   485	              }
   486
   487	              db.updateActionRunStatus(actionRunId, 'running');
   488	              db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
   489	            }
   490
   491	            await eventBus.emit('agent:event', {
   492	              projectId,
   493	              event: { ...event, timestamp: new Date().toISOString() },
   494	            });
   495	          },
   496	          sessionId,
   497	          { type: 'recovery', projectId },
   498	        );
   499
   500	        if (approvalState.blocked) {
   501	          const failureReason =
   502	            approvalState.blocked === 'aborted'
   503	              ? 'Recovery aborted because project is no longer eligible to continue'
   504	              : 'High-risk tool was rejected or timed out';
   505	          db.updateActionRunStatus(actionRunId, 'failed', failureReason);
   506	          if (approvalState.blocked === 'aborted') {
   507	            await eventBus.emit('recovery:stopped', {
   508	              projectId,
   509	              reason: failureReason,
   510	              correlationId: projectId,
   511	            });
   512	          } else {
   513	            await eventBus.emit('recovery:failed', {
   514	              projectId,
   515	              error: failureReason,
   516	              attempt,
   517	              correlationId: projectId,
   518	            });
   519	          }
   520	          trySavePattern(false);
   521	          return;
   522	        }
   523
   524	        const timeoutMs = getDynamicOutcomeTimeoutMs(db, projectId);
   525	        const outcome = await waitForRecoveryOutcome(eventBus, projectId, timeoutMs);
   526	        const durationMs = Date.now() - recoveryStartTime;
   527	        if (outcome.success) {
   528	          db.updateActionRunStatus(actionRunId, 'succeeded');
   529	          await eventBus.emit('recovery:success', {
   530	            projectId,
   531	            attempt,
   532	            durationMs,
   533	            lastError: normalizedError,
   534	            correlationId: projectId,
   535	          });
   536	          trySavePattern(true);
   537	        } else {
   538	          const failureReason = outcome.timedOut
   539	            ? `Recovery verification timed out after ${String(Math.round(timeoutMs / 1000))}s`
   540	            : error;
   541	          db.updateActionRunStatus(actionRunId, 'failed', failureReason);
   542	          await eventBus.emit('recovery:failed', {
   543	            projectId,
   544	            error: failureReason,
   545	            attempt,
   546	            correlationId: projectId,
   547	          });
   548	          trySavePattern(false);
   549	        }
   550
   551	        return;
   552	      } catch (err) {
   553	        const errorMessage = err instanceof Error ? err.message : error;
   554	        db.updateActionRunStatus(actionRunId, 'failed', errorMessage);
   555	        log.error({ err, projectId }, 'Auto-recovery agent call failed');
   556	        await eventBus.emit('recovery:failed', {
   557	          projectId,
   558	          error: errorMessage,
   559	          attempt,
   560	          correlationId: projectId,
   561	        });
   562	        trySavePattern(false);
   563	        return;
   564	      }
   565	    }
   566

codex
One more consistency check: deploy auto-recovery is still creating its action runs without a stored correlation ID, while ops recovery does store it. If that’s true, approval-resolution events can’t stay grouped to the same thread even after the payload type grew a `correlationId` field.
exec
/bin/bash -lc "nl -ba src/db/repos/action-run.repo.ts | sed -n '1,120p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { and, desc, eq, or, sql } from 'drizzle-orm';
     2	import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
     3	import { actionRuns } from '../schema.drizzle.js';
     4	import type { ActionRunRow } from '../types.js';
     5
     6	export class ActionRunRepo {
     7	  constructor(
     8	    private readonly db: DrizzleClient,
     9	    private readonly sqlite: SqliteDatabase,
    10	  ) {}
    11
    12	  /**
    13	   * Create a new action run with status='running'.
    14	   * Generates UUID and sets started_at timestamp.
    15	   */
    16	  create(data: {
    17	    projectId: string;
    18	    triggerSource: ActionRunRow['trigger_source'];
    19	    triggerSessionId?: string;
    20	    recoveryStrategy?: ActionRunRow['recovery_strategy'];
    21	    correlationId?: string;
    22	  }): string {
    23	    const id = crypto.randomUUID();
    24	    const now = new Date().toISOString();
    25	    const recoveryStrategy = data.recoveryStrategy === 'unknown' ? null : data.recoveryStrategy;
    26
    27	    this.db
    28	      .insert(actionRuns)
    29	      .values({
    30	        id,
    31	        project_id: data.projectId,
    32	        trigger_source: data.triggerSource,
    33	        trigger_session_id: data.triggerSessionId ?? null,
    34	        status: 'running',
    35	        error_message: null,
    36	        recovery_strategy: recoveryStrategy ?? null,
    37	        correlation_id: data.correlationId ?? null,
    38	        steps_json: null,
    39	        started_at: now,
    40	        completed_at: null,
    41	        tenant_id: null,
    42	        user_id: null,
    43	        created_at: now,
    44	      })
    45	      .run();
    46
    47	    return id;
    48	  }
    49
    50	  updateStatus(
    51	    id: string,
    52	    status: 'running' | 'succeeded' | 'failed' | 'pending_approval',
    53	    errorMessage?: string,
    54	  ): void {
    55	    const completedAt =
    56	      status === 'succeeded' || status === 'failed' ? new Date().toISOString() : null;
    57
    58	    this.db
    59	      .update(actionRuns)
    60	      .set({
    61	        status,
    62	        error_message: errorMessage ?? null,
    63	        completed_at: completedAt,
    64	      })
    65	      .where(eq(actionRuns.id, id))
    66	      .run();
    67	  }
    68
    69	  updatePlan(id: string, plan: string): void {
    70	    const now = new Date().toISOString();
    71	    this.db
    72	      .update(actionRuns)
    73	      .set({
    74	        plan,
    75	        updated_at: now,
    76	      })
    77	      .where(eq(actionRuns.id, id))
    78	      .run();
    79	  }
    80
    81	  updateStep(id: string, currentStep: number, totalSteps?: number): void {
    82	    const now = new Date().toISOString();
    83	    this.db
    84	      .update(actionRuns)
    85	      .set({
    86	        current_step: currentStep,
    87	        ...(totalSteps !== undefined ? { total_steps: totalSteps } : {}),
    88	        updated_at: now,
    89	      })
    90	      .where(eq(actionRuns.id, id))
    91	      .run();
    92	  }
    93
    94	  updateApproval(
    95	    id: string,
    96	    approvalStatus: 'pending' | 'approved' | 'rejected',
    97	    approvalTool?: string,
    98	  ): void {
    99	    const now = new Date().toISOString();
   100	    const isPending = approvalStatus === 'pending';
   101
   102	    this.db
   103	      .update(actionRuns)
   104	      .set({
   105	        approval_status: approvalStatus,
   106	        approval_tool: approvalTool ?? null,
   107	        approval_requested_at: isPending ? now : undefined,
   108	        approval_resolved_at: isPending ? undefined : now,
   109	        updated_at: now,
   110	      })
   111	      .where(eq(actionRuns.id, id))
   112	      .run();
   113	  }
   114
   115	  updateRecoveryStrategy(id: string, strategy: ActionRunRow['recovery_strategy']): void {
   116	    const normalized = strategy === 'unknown' ? null : strategy;
   117	    this.db
   118	      .update(actionRuns)
   119	      .set({ recovery_strategy: normalized, updated_at: new Date().toISOString() })
   120	      .where(eq(actionRuns.id, id))

exec
/bin/bash -lc "nl -ba src/monitor/ops-recovery.ts | sed -n '108,130p'" in /home/lee/OpenLander
 succeeded in 0ms:
   108	    const isHalfOpenAttempt = this.ctx.db.getCircuitBreakerState(projectId)?.state === 'half_open';
   109
   110	    if (this.activeRecoveries.has(projectId)) {
   111	      log.warn({ projectId }, 'Recovery already in progress — skipping');
   112	      return 'skipped';
   113	    }
   114
   115	    const actionRunId = this.ctx.db.createActionRun({
   116	      projectId,
   117	      triggerSource: 'auto_recovery',
   118	      recoveryStrategy: 'recipe',
   119	      correlationId: incidentId ?? undefined,
   120	    });
   121
   122	    const executionContext: RecoveryContext = {
   123	      ...context,
   124	      actionRunId,
   125	    };
   126
   127	    this.activeRecoveries.add(projectId);
   128	    try {
   129	      const outcome = await this.runRecoverySequence(executionContext);
   130	      if (isHalfOpenAttempt && outcome === 'escalated') {

codex
- `CRITICAL` Live `/api/activity` emits synthetic, non-persisted IDs instead of the `activity_log` ULIDs that the `since` cursor queries operate on. The SSE path builds a fresh `ActivityEvent` in-memory and writes that directly, while backfill/REST read from `activity_log` using `findActivityLogSinceFiltered(gt(id, since))`. That breaks the 5-step gap-recovery contract: a reconnecting client can hand back an ID that does not exist in the table, so backfill ordering/deduplication becomes unsound and events can be duplicated or skipped. Refs: [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L257), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L289), [activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L421), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L171)

- `MAJOR` The persistence subscriber is not actually fire-and-forget. `ActivityLogger` registers a synchronous handler, and `EventBus.emit()` executes non-Promise handlers inline. Each emitted event therefore blocks on a SQLite insert plus an immediate select-by-id readback. On noisy event streams this adds synchronous WAL write pressure and latency directly onto the producer path, contrary to the class comment. Refs: [activity-logger.ts](/home/lee/OpenLander/src/monitor/activity-logger.ts#L68), [events/index.ts](/home/lee/OpenLander/src/events/index.ts#L427), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L68), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L85)

- `MAJOR` Multi-type filtering is incorrect in both REST and SSE backfill. When `types` contains more than one value, the route applies no DB-level type filter, limits the raw query first, and only then filters in memory. That can return fewer than `limit` matching rows even when more qualifying events exist later in the table. Refs: [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L230), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L289), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L331)

- `MAJOR` Correlation threading is inconsistent across recovery flows. Deploy auto-recovery creates its `action_run` without `correlationId`, while ops recovery does store one; later, approval-resolution events are emitted without `correlationId` even though the payload type now supports it. That means approval events for deploy auto-recovery cannot be reliably grouped with the surrounding recovery thread or fetched via `correlationId` filters. Refs: [auto-recovery.ts](/home/lee/OpenLander/src/pipeline/auto-recovery.ts#L373), [ops-recovery.ts](/home/lee/OpenLander/src/monitor/ops-recovery.ts#L115), [routes.ts](/home/lee/OpenLander/src/web/api/routes.ts#L385), [events/index.ts](/home/lee/OpenLander/src/events/index.ts#L345), [action-run.repo.ts](/home/lee/OpenLander/src/db/repos/action-run.repo.ts#L16)

- `MAJOR` The hot read paths do not line up with the new indexes. The table is indexed on `created_at`, `(project_id, created_at)`, and `(activity_type, created_at)`, but the route/repo query the feed by `id` for ordering/cursoring and optionally by `severity`/`correlation_id`. As written, the main `/api/activity` queries cannot use the composite `*_created` indexes for their sort order, and filtered recent queries will degrade as the 30-day table grows. Refs: [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L133), [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L171), [schema.drizzle.ts](/home/lee/OpenLander/src/db/schema.drizzle.ts#L617), [migration.ts](/home/lee/OpenLander/src/db/migration.ts#L643)

- `MAJOR` Activity-log retention cleanup has no error boundary. `runActivityLogCleanup()` is called during startup and again from `setInterval()` without any `try/catch`. A DB failure here can abort app initialization or crash the process from the timer callback. Refs: [app.ts](/home/lee/OpenLander/src/app.ts#L586), [app.ts](/home/lee/OpenLander/src/app.ts#L592)

- `MINOR` The custom ULID implementation is hand-rolled and only monotonic for the “same millisecond, clock never goes backwards” case. Because feed pagination depends on lexicographic ID monotonicity, this is weaker than using a vetted monotonic ULID implementation and is vulnerable to clock skew/regression edge cases. Refs: [activity-log.repo.ts](/home/lee/OpenLander/src/db/repos/activity-log.repo.ts#L6)
tokens used
106,275

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
