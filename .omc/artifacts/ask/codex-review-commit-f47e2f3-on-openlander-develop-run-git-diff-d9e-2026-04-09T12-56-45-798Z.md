# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-09T12:56:45.798Z

## Original task

Review commit f47e2f3 on OpenLander develop. Run: git diff d9eab4c..f47e2f3 to see the diff. Focus on: 1) MainFeedGrid.tsx — localizeTitle() pattern matching correctness, humanizeEventType usage for triggerType, thread grouping key change (type removed) 2) LeftRail.tsx — CB filtering logic (closed hidden), incident dedup/grouping, type changes (CircuitBreakerWithProject). Check for edge cases: empty arrays, null triggerType, unknown patterns. Report CRITICAL/MAJOR/MINOR.

## Final prompt

Review commit f47e2f3 on OpenLander develop. Run: git diff d9eab4c..f47e2f3 to see the diff. Focus on: 1) MainFeedGrid.tsx — localizeTitle() pattern matching correctness, humanizeEventType usage for triggerType, thread grouping key change (type removed) 2) LeftRail.tsx — CB filtering logic (closed hidden), incident dedup/grouping, type changes (CircuitBreakerWithProject). Check for edge cases: empty arrays, null triggerType, unknown patterns. Report CRITICAL/MAJOR/MINOR.

## Raw output

```text
**CRITICAL**

None.

**MAJOR**

1. [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L76) groups every non-correlated event for a project into a single 5-minute bucket because `type` was removed from the fallback key. Most activity items do not carry a real `correlationId`; the mapper only sets it from `actionRunId` for approval-related entries ([activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L464)). That means an incident, a recovery event, and an unrelated deploy failure from the same project inside 5 minutes now collapse into one thread. The row then inherits one `title`, one `status`, one `triggerType`, and one severity summary for mixed events, so the feed can present the wrong problem as a single thread.

2. [LeftRail.tsx](/home/lee/OpenLander/web/src/components/ops/v2/LeftRail.tsx#L214) deduplicates incidents only by `triggerType ?? title`, ignoring `project_id` and `severity`. In the global ops view that merges unrelated incidents across different projects into one row, and the displayed severity dot comes from whichever incident hit the accumulator first. That is a real behavioral regression compared with the existing incident grouping logic in [IncidentMap.tsx](/home/lee/OpenLander/web/src/components/ops/IncidentMap.tsx#L63), which keys by project and severity as well.

3. [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L24) `localizeTitle()` is not aligned with the actual title strings produced by the backend. The mapper emits titles like `Deploy failed (build)` and `Deploy crashed` ([activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L260)), but the new regexes only recognize `deploy:failed`, `deploy:crash`, or any generic `deploy:` prefix. Result:
   - many real deploy titles never localize at all;
   - incident titles like `deploy:crash — Exit code 1` will miss the exact crash regex and then fall through to the generic `^deploy:` rule, incorrectly rendering as "Deploy failed".

**MINOR**

1. [LeftRail.tsx](/home/lee/OpenLander/web/src/components/ops/v2/LeftRail.tsx#L291) still shows the section badge count as `incidents.length` while the list renders `groupedIncidents`. After deduplication the badge and visible row count diverge, which is confusing even if the grouping logic is fixed.

2. `triggerType` null handling is safe in both files. Unknown patterns also fall back safely to the original string or `humanizeEventType()`. The regressions here are not crashers; they are incorrect grouping and mislabeling.


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
session id: 019d724e-d412-7e80-8365-646ac8004d61
--------
user
Review commit f47e2f3 on OpenLander develop. Run: git diff d9eab4c..f47e2f3 to see the diff. Focus on: 1) MainFeedGrid.tsx — localizeTitle() pattern matching correctness, humanizeEventType usage for triggerType, thread grouping key change (type removed) 2) LeftRail.tsx — CB filtering logic (closed hidden), incident dedup/grouping, type changes (CircuitBreakerWithProject). Check for edge cases: empty arrays, null triggerType, unknown patterns. Report CRITICAL/MAJOR/MINOR.
codex
Reviewing commit `f47e2f3` against `d9eab4c` with focus on the two React files and the edge cases you called out. I’m pulling the diff and the current file contents first so I can evaluate behavior rather than just syntax.
exec
/bin/bash -lc "sed -n '1,260p' web/src/components/ops/MainFeedGrid.tsx" in /home/lee/OpenLander
exec
/bin/bash -lc "sed -n '1,320p' web/src/components/ops/LeftRail.tsx" in /home/lee/OpenLander
 exited 2 in 0ms:
sed: can't read web/src/components/ops/LeftRail.tsx: No such file or directory

 exited 2 in 0ms:
sed: can't read web/src/components/ops/MainFeedGrid.tsx: No such file or directory

exec
/bin/bash -lc 'git diff d9eab4c..f47e2f3 -- web/src/components/ops/LeftRail.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
exec
/bin/bash -lc 'git diff d9eab4c..f47e2f3 -- web/src/components/ops/MainFeedGrid.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
codex
The requested paths aren’t under `web/src/components/ops/`; I’m locating the actual file locations in this tree and then I’ll inspect the exact commit delta there.
exec
/bin/bash -lc 'git diff --name-only d9eab4c..f47e2f3' in /home/lee/OpenLander
 succeeded in 0ms:
web/src/components/ops/v2/LeftRail.tsx
web/src/components/ops/v2/MainFeedGrid.tsx
web/src/i18n/en.ts
web/src/i18n/ko.ts

exec
/bin/bash -lc "rg --files | rg 'MainFeedGrid\\.tsx|LeftRail\\.tsx'" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/components/ops/v2/MainFeedGrid.tsx
web/src/components/ops/v2/LeftRail.tsx

exec
/bin/bash -lc 'git diff d9eab4c..f47e2f3 -- web/src/components/ops/v2/MainFeedGrid.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/src/components/ops/v2/MainFeedGrid.tsx b/web/src/components/ops/v2/MainFeedGrid.tsx
index 9155aab..fe9a7ea 100644
--- a/web/src/components/ops/v2/MainFeedGrid.tsx
+++ b/web/src/components/ops/v2/MainFeedGrid.tsx
@@ -17,6 +17,30 @@ import { ThreadApprovalActions } from './ThreadApprovalActions.js';
 const THREADS_PAGE_SIZE = 40;
 const EVENTS_PAGE_SIZE = 20;

+// ---------------------------------------------------------------------------
+// Title localisation helper
+// ---------------------------------------------------------------------------
+
+const TITLE_PATTERNS: [RegExp, string][] = [
+  [/^Auto-recovery running$/i, 'opsV2.titles.autoRecoveryRunning'],
+  [/^Auto-recovery failed$/i, 'opsV2.titles.autoRecoveryFailed'],
+  [/^Auto-recovery completed$/i, 'opsV2.titles.autoRecoveryCompleted'],
+  [/^Incident detected$/i, 'opsV2.titles.incidentDetected'],
+  [/^Health check failed/i, 'opsV2.titles.healthCheckFailed'],
+  [/^deploy:crash$/i, 'opsV2.titles.deployCrash'],
+  [/^deploy:failed$/i, 'opsV2.titles.deployFailed'],
+  [/^deploy:/i, 'opsV2.titles.deployFailed'],
+];
+
+function localizeTitle(title: string, t: (key: string) => string): string {
+  for (const [pattern, key] of TITLE_PATTERNS) {
+    if (pattern.test(title)) {
+      return t(key);
+    }
+  }
+  return title;
+}
+
 // ---------------------------------------------------------------------------
 // Types
 // ---------------------------------------------------------------------------
@@ -51,7 +75,7 @@ function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {

   for (const item of items) {
     const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
-    const key = item.correlationId || `${item.projectId}::${item.type}::${tsBucket}`;
+    const key = item.correlationId || `${item.projectId}::${tsBucket}`;

     const existing = threadMap.get(key);
     if (existing) {
@@ -112,7 +136,7 @@ function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {
 // ---------------------------------------------------------------------------
 // Density approach: standard table rows using CSS grid.
 const ROW_GRID_CLASSES =
-  'grid grid-cols-[24px_minmax(120px,1.5fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';
+  'grid grid-cols-[24px_minmax(140px,1.8fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';

 // ---------------------------------------------------------------------------
 // Sub-components
@@ -125,8 +149,9 @@ const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event
   const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
   const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;

-  const titleText =
+  const rawTitle =
     event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
+  const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);

   return (
     <div className="flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors">
@@ -310,7 +335,7 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
         <div role="columnheader">{t('opsV2.timeline.columns.detectedEvent')}</div>
         <div role="columnheader">{t('opsV2.timeline.columns.severity')}</div>
         <div role="columnheader">{t('opsV2.timeline.columns.state')}</div>
-        <div role="columnheader">{t('opsV2.timeline.columns.logsCount')}</div>
+        <div role="columnheader">{t('opsV2.timeline.columns.eventCount')}</div>
         <div role="columnheader">{t('opsV2.timeline.columns.latest')}</div>
       </div>

@@ -364,13 +389,22 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
                   <div role="cell" className="min-w-0 flex flex-col justify-center">
                     <span
                       className="truncate text-xs font-medium text-secondary-ol"
-                      title={thread.title}
+                      title={
+                        thread.title
+                          ? localizeTitle(thread.title, t as unknown as (key: string) => string)
+                          : undefined
+                      }
                     >
-                      {thread.title}
+                      {thread.title
+                        ? localizeTitle(thread.title, t as unknown as (key: string) => string)
+                        : thread.title}
                     </span>
                     {thread.triggerType && (
                       <span className="truncate text-[10px] font-mono text-muted-ol mt-0.5">
-                        {thread.triggerType}
+                        {humanizeEventType(
+                          thread.triggerType,
+                          t as unknown as (key: string) => string,
+                        )}
                       </span>
                     )}
                   </div>

exec
/bin/bash -lc 'git diff d9eab4c..f47e2f3 -- web/src/components/ops/v2/LeftRail.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/src/components/ops/v2/LeftRail.tsx b/web/src/components/ops/v2/LeftRail.tsx
index 9c54f48..f7ebcf0 100644
--- a/web/src/components/ops/v2/LeftRail.tsx
+++ b/web/src/components/ops/v2/LeftRail.tsx
@@ -3,7 +3,8 @@ import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from
 import { cn } from '../../../lib/utils.js';
 import { useLanguage } from '../../../i18n/context.js';
 import { ScrollArea } from '../../ui/scroll-area.js';
-import type { OpsIncident, CircuitBreakerState } from '../../../lib/api/operations.js';
+import { humanizeEventType } from '../utils.js';
+import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
 import type { ActionRun } from '../../../lib/api/projects.js';

 const STORAGE_KEY = 'ops-v2-rail-collapsed';
@@ -11,7 +12,7 @@ const STORAGE_KEY = 'ops-v2-rail-collapsed';
 export interface LeftRailProps {
   approvals: ActionRun[];
   incidents: OpsIncident[];
-  circuitBreakers: CircuitBreakerState[];
+  circuitBreakers: CircuitBreakerWithProject[];
   onFilterChange?: (filter: { type?: string; severity?: string }) => void;
   /** When true, forces icon-only collapsed mode regardless of local state */
   forceCollapsed?: boolean;
@@ -54,7 +55,16 @@ function SectionHeader({ icon, label, count, collapsed, active, onClick }: Secti
   );
 }

-function IncidentRow({ incident, collapsed }: { incident: OpsIncident; collapsed: boolean }) {
+function IncidentRow({
+  incident,
+  count,
+  collapsed,
+}: {
+  incident: OpsIncident;
+  count: number;
+  collapsed: boolean;
+}) {
+  const { t } = useLanguage();
   const severityColor =
     incident.severity === 'critical'
       ? 'bg-error'
@@ -62,12 +72,18 @@ function IncidentRow({ incident, collapsed }: { incident: OpsIncident; collapsed
         ? 'bg-warning'
         : 'bg-muted-ol';

+  const displayTitle = incident.triggerType
+    ? humanizeEventType(incident.triggerType, t)
+    : incident.title;
+
+  const titleWithCount = count > 1 ? `${displayTitle} (×${count})` : displayTitle;
+
   if (collapsed) {
     return (
       <div className="flex justify-center py-1">
         <span
           className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
-          title={incident.title}
+          title={titleWithCount}
         />
       </div>
     );
@@ -76,7 +92,7 @@ function IncidentRow({ incident, collapsed }: { incident: OpsIncident; collapsed
   return (
     <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
       <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
-      <span className="text-xs font-body text-primary-ol truncate">{incident.title}</span>
+      <span className="text-xs font-body text-primary-ol truncate">{titleWithCount}</span>
     </div>
   );
 }
@@ -111,14 +127,15 @@ function CircuitBreakerRow({
   index,
   collapsed,
 }: {
-  breaker: CircuitBreakerState;
+  breaker: CircuitBreakerWithProject;
   index: number;
   collapsed: boolean;
 }) {
   const isOpen = breaker.state === 'open';
   const isHalfOpen = breaker.state === 'half_open';
   const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
-  const label = `CB #${index + 1}: ${breaker.state}`;
+  const displayName = breaker.projectName || `CB #${index + 1}`;
+  const label = `${displayName}: ${breaker.state}`;

   if (collapsed) {
     return (
@@ -193,6 +210,21 @@ export function LeftRail({
   const approvalItems = approvals;
   const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');

+  // Group incidents by humanized trigger type (or title) to deduplicate
+  const groupedIncidents = incidents.reduce<Array<{ incident: OpsIncident; count: number }>>(
+    (acc, incident) => {
+      const key = incident.triggerType ?? incident.title;
+      const existing = acc.find((g) => (g.incident.triggerType ?? g.incident.title) === key);
+      if (existing) {
+        existing.count += 1;
+      } else {
+        acc.push({ incident, count: 1 });
+      }
+      return acc;
+    },
+    [],
+  );
+
   return (
     <aside
       style={{
@@ -264,8 +296,13 @@ export function LeftRail({
             {!effectivelyCollapsed && incidents.length === 0 && (
               <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
             )}
-            {incidents.map((incident) => (
-              <IncidentRow key={incident.id} incident={incident} collapsed={effectivelyCollapsed} />
+            {groupedIncidents.map(({ incident, count }) => (
+              <IncidentRow
+                key={incident.triggerType ?? incident.id}
+                incident={incident}
+                count={count}
+                collapsed={effectivelyCollapsed}
+              />
             ))}
           </div>

@@ -279,11 +316,16 @@ export function LeftRail({
               active={activeFilter === 'circuit_breaker'}
               onClick={() => handleSectionClick('circuit_breaker')}
             />
-            {!effectivelyCollapsed && circuitBreakers.length === 0 && (
+            {!effectivelyCollapsed && openBreakers.length === 0 && (
               <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.allSystemsNormal')}</p>
             )}
-            {circuitBreakers.map((cb, i) => (
-              <CircuitBreakerRow key={i} breaker={cb} index={i} collapsed={effectivelyCollapsed} />
+            {openBreakers.map((cb, i) => (
+              <CircuitBreakerRow
+                key={cb.projectId}
+                breaker={cb}
+                index={i}
+                collapsed={effectivelyCollapsed}
+              />
             ))}
           </div>
         </div>

exec
/bin/bash -lc "sed -n '1,280p' web/src/components/ops/v2/MainFeedGrid.tsx" in /home/lee/OpenLander
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
// Title localisation helper
// ---------------------------------------------------------------------------

const TITLE_PATTERNS: [RegExp, string][] = [
  [/^Auto-recovery running$/i, 'opsV2.titles.autoRecoveryRunning'],
  [/^Auto-recovery failed$/i, 'opsV2.titles.autoRecoveryFailed'],
  [/^Auto-recovery completed$/i, 'opsV2.titles.autoRecoveryCompleted'],
  [/^Incident detected$/i, 'opsV2.titles.incidentDetected'],
  [/^Health check failed/i, 'opsV2.titles.healthCheckFailed'],
  [/^deploy:crash$/i, 'opsV2.titles.deployCrash'],
  [/^deploy:failed$/i, 'opsV2.titles.deployFailed'],
  [/^deploy:/i, 'opsV2.titles.deployFailed'],
];

function localizeTitle(title: string, t: (key: string) => string): string {
  for (const [pattern, key] of TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return t(key);
    }
  }
  return title;
}

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
    const key = item.correlationId || `${item.projectId}::${tsBucket}`;

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
  'grid grid-cols-[24px_minmax(140px,1.8fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event: ActivityItem }) {
  const { t, language } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
  const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;

  const rawTitle =
    event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
  const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);

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
        <div className="truncate text-muted-ol">{t(`opsV2.status.${event.status}`)}</div>

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities]);

  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);
  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const th of threadData) {
      initial[th.correlationId] = th.hasPendingApproval;
    }
    return initial;
  });

  const allExpanded =
    threadData.length > 0 && threadData.every((th) => !!expandedMap[th.correlationId]);

  const toggleAll = useCallback(() => {
    const next = !allExpanded;
    setExpandedMap(() => {
      const map: Record<string, boolean> = {};
      for (const th of threadData) {
        map[th.correlationId] = next;

exec
/bin/bash -lc "sed -n '1,360p' web/src/components/ops/v2/LeftRail.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useState, useEffect, useCallback } from 'react';
import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import { humanizeEventType } from '../utils.js';
import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
import type { ActionRun } from '../../../lib/api/projects.js';

const STORAGE_KEY = 'ops-v2-rail-collapsed';

export interface LeftRailProps {
  approvals: ActionRun[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  onFilterChange?: (filter: { type?: string; severity?: string }) => void;
  /** When true, forces icon-only collapsed mode regardless of local state */
  forceCollapsed?: boolean;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}

function SectionHeader({ icon, label, count, collapsed, active, onClick }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150',
        'hover:bg-bg-subtle',
        active ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
        collapsed ? 'justify-center' : 'justify-start',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-xs font-semibold truncate">{label}</span>
          {count > 0 && (
            <span className="text-xs font-mono bg-bg-subtle border border-[hsl(var(--border))] px-1.5 py-0.5 rounded-full shrink-0">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function IncidentRow({
  incident,
  count,
  collapsed,
}: {
  incident: OpsIncident;
  count: number;
  collapsed: boolean;
}) {
  const { t } = useLanguage();
  const severityColor =
    incident.severity === 'critical'
      ? 'bg-error'
      : incident.severity === 'warning'
        ? 'bg-warning'
        : 'bg-muted-ol';

  const displayTitle = incident.triggerType
    ? humanizeEventType(incident.triggerType, t)
    : incident.title;

  const titleWithCount = count > 1 ? `${displayTitle} (×${count})` : displayTitle;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span
          className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
          title={titleWithCount}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{titleWithCount}</span>
    </div>
  );
}

function ApprovalRow({ approval, collapsed }: { approval: ActionRun; collapsed: boolean }) {
  const { t } = useLanguage();
  const strategy = approval.recovery_strategy
    ? t(`ops.recoveryStrategy.${approval.recovery_strategy}`)
    : t('ops.recoveryStrategy.unknown');
  const label = `${t('opsV2.rail.actionRequired')}: ${strategy}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className="h-2 w-2 rounded-full shrink-0 bg-warning" title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className="h-2 w-2 rounded-full shrink-0 mt-1 bg-warning" />
      <span className="text-xs font-body text-primary-ol truncate" title={label}>
        {label}
      </span>
    </div>
  );
}

function CircuitBreakerRow({
  breaker,
  index,
  collapsed,
}: {
  breaker: CircuitBreakerWithProject;
  index: number;
  collapsed: boolean;
}) {
  const isOpen = breaker.state === 'open';
  const isHalfOpen = breaker.state === 'half_open';
  const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
  const displayName = breaker.projectName || `CB #${index + 1}`;
  const label = `${displayName}: ${breaker.state}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{label}</span>
    </div>
  );
}

export function LeftRail({
  approvals,
  incidents,
  circuitBreakers,
  onFilterChange,
  forceCollapsed,
}: LeftRailProps) {
  const { t } = useLanguage();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // forceCollapsed overrides local state (used for < lg breakpoint)
  const effectivelyCollapsed = forceCollapsed ?? collapsed;

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Sync localStorage changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) {
        setCollapsed(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleSectionClick = useCallback(
    (type: string) => {
      const next = activeFilter === type ? null : type;
      setActiveFilter(next);
      onFilterChange?.(next ? { type: next } : {});
    },
    [activeFilter, onFilterChange],
  );

  const approvalItems = approvals;
  const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');

  // Group incidents by humanized trigger type (or title) to deduplicate
  const groupedIncidents = incidents.reduce<Array<{ incident: OpsIncident; count: number }>>(
    (acc, incident) => {
      const key = incident.triggerType ?? incident.title;
      const existing = acc.find((g) => (g.incident.triggerType ?? g.incident.title) === key);
      if (existing) {
        existing.count += 1;
      } else {
        acc.push({ incident, count: 1 });
      }
      return acc;
    },
    [],
  );

  return (
    <aside
      style={{
        width: effectivelyCollapsed ? 48 : 320,
        minWidth: effectivelyCollapsed ? 48 : 320,
        transition: 'width 150ms ease, min-width 150ms ease',
      }}
      className={cn(
        'relative flex flex-col h-full',
        'bg-bg-panel border-r border-[hsl(var(--border))]',
        'overflow-hidden',
      )}
    >
      {/* Toggle button — hidden when forceCollapsed is active (breakpoint manages it) */}
      {forceCollapsed === undefined && (
        <div
          className={cn(
            'shrink-0 flex items-center border-b border-[hsl(var(--border))] px-2 py-2',
            effectivelyCollapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <button
            type="button"
            onClick={toggle}
            title={effectivelyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
          >
            {effectivelyCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className={cn('p-2 space-y-4', effectivelyCollapsed && 'space-y-2')}>
          {/* Approvals section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<CheckSquare className="h-4 w-4" />}
              label={t('opsV2.rail.approvals')}
              count={approvalItems.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'approval'}
              onClick={() => handleSectionClick('approval')}
            />
            {!effectivelyCollapsed && approvalItems.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">
                {t('opsV2.empty.noPendingApprovals')}
              </p>
            )}
            {approvalItems.map((item) => (
              <ApprovalRow key={item.id} approval={item} collapsed={effectivelyCollapsed} />
            ))}
          </div>

          {/* Active Issues section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<AlertCircle className="h-4 w-4" />}
              label={t('opsV2.rail.activeIssues')}
              count={incidents.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'incident'}
              onClick={() => handleSectionClick('incident')}
            />
            {!effectivelyCollapsed && incidents.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
            )}
            {groupedIncidents.map(({ incident, count }) => (
              <IncidentRow
                key={incident.triggerType ?? incident.id}
                incident={incident}
                count={count}
                collapsed={effectivelyCollapsed}
              />
            ))}
          </div>

          {/* Circuit Breaker Status section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              label={t('opsV2.rail.circuitBreakerStatus')}
              count={openBreakers.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'circuit_breaker'}
              onClick={() => handleSectionClick('circuit_breaker')}
            />
            {!effectivelyCollapsed && openBreakers.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.allSystemsNormal')}</p>
            )}
            {openBreakers.map((cb, i) => (
              <CircuitBreakerRow
                key={cb.projectId}
                breaker={cb}
                index={i}
                collapsed={effectivelyCollapsed}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

codex
I have the target diff. Next I’m checking the supporting types and `humanizeEventType()` behavior, because most of the risk here is semantic: null handling, translation fallback, and whether the new grouping keys can merge unrelated records.
exec
/bin/bash -lc "sed -n '1,240p' web/src/components/ops/utils.ts" in /home/lee/OpenLander
exec
/bin/bash -lc "rg -n \"function humanizeEventType|const humanizeEventType|export function humanizeEventType\" web/src/components/ops -g '*.ts*'" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/components/ops/utils.ts:146:export const humanizeEventType = (type: string, t: (key: string) => string): string => {

 succeeded in 0ms:
export function relativeTime(timestamp: number, lang: 'ko' | 'en' = 'ko'): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return lang === 'ko' ? '방금 전' : 'just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return lang === 'ko' ? `${m}분 전` : `${m}m ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return lang === 'ko' ? `${h}시간 전` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86_400_000);
  return lang === 'ko' ? `${d}일 전` : `${d}d ago`;
}

export function describeCBState(
  state: string,
  failures: number,
  lang: 'ko' | 'en' = 'ko',
): { label: string; explanation: string } {
  const labels: Record<string, Record<'ko' | 'en', { label: string; explanation: string }>> = {
    open: {
      ko: {
        label: '🛑 자동 복구 중단',
        explanation: `연속 ${failures}회 복구 실패로 자동 복구가 일시 중단되었습니다`,
      },
      en: {
        label: '🛑 Recovery Paused',
        explanation: `Auto-recovery paused after ${failures} consecutive failures`,
      },
    },
    half_open: {
      ko: {
        label: '🔄 복구 재시도 중',
        explanation: `${failures}회 실패 후 복구를 다시 시도하고 있습니다`,
      },
      en: {
        label: '🔄 Testing Recovery',
        explanation: `Retrying recovery after ${failures} failures`,
      },
    },
    closed: {
      ko: { label: '✅ 정상', explanation: '자동 복구가 정상 작동 중입니다' },
      en: { label: '✅ Healthy', explanation: 'Auto-recovery is operating normally' },
    },
  };

  const key = state.toLowerCase();
  return labels[key]?.[lang] ?? { label: state, explanation: '' };
}

const KNOWN_TOOLS = [
  'rollback',
  'restart_container',
  'diagnose_crash',
  'stop_project',
  'apply_fixes',
];

export function getToolLabel(
  toolName: string,
  t: (key: string, params?: Record<string, string>) => string,
): { label: string; impact: string } {
  const normalized = toolName.toLowerCase();
  if (!KNOWN_TOOLS.includes(normalized)) {
    return { label: t('operations.approvals.toolRequest', { tool: toolName }), impact: '' };
  }
  const label = t(`operations.tools.${normalized}`);
  const impact = t(`operations.tools.${normalized}_impact`);
  return { label, impact };
}

export function getRiskTone(toolName: string | null): 'destructive' | 'diagnostic' | 'neutral' {
  if (!toolName) {
    return 'neutral';
  }

  const normalized = toolName.toLowerCase();
  if (
    normalized.includes('rollback') ||
    normalized.includes('stop') ||
    normalized.includes('delete') ||
    normalized.includes('purge') ||
    normalized.includes('remove')
  ) {
    return 'destructive';
  }

  if (
    normalized.includes('diagnose') ||
    normalized.includes('debug') ||
    normalized.includes('inspect') ||
    normalized.includes('status') ||
    normalized.includes('log')
  ) {
    return 'diagnostic';
  }

  return 'neutral';
}

export const TOOL_HUMAN_LABELS: Record<
  string,
  { ko: string; en: string; impact_ko: string; impact_en: string }
> = {
  rollback: {
    ko: '이전 버전으로 롤백',
    en: 'Rollback to previous version',
    impact_ko: '서비스 일시 중단 (~15초)',
    impact_en: 'Brief service interruption (~15s)',
  },
  restart_container: {
    ko: '컨테이너 재시작',
    en: 'Restart container',
    impact_ko: '서비스 일시 중단 (~10초)',
    impact_en: 'Brief service interruption (~10s)',
  },
  diagnose_crash: {
    ko: '크래시 원인 분석',
    en: 'Analyze crash cause',
    impact_ko: '변경 없음 (읽기 전용)',
    impact_en: 'No changes (read-only)',
  },
  stop_project: {
    ko: '프로젝트 중지',
    en: 'Stop project',
    impact_ko: '서비스 완전 중단',
    impact_en: 'Full service shutdown',
  },
  apply_fixes: {
    ko: '자동 진단결과 반영',
    en: 'Apply automated fixes',
    impact_ko: '리소스 롤아웃 및 수정 (가능성 있음)',
    impact_en: 'Resource rollout & modifications',
  },
};

export const extractEventType = (type: string | undefined): string => {
  if (!type) return 'unknown';
  if (type.startsWith('ai:')) {
    return 'ai_intervention';
  }
  return type.toLowerCase().replace(/[:\s]+/g, '_');
};

export const humanizeEventType = (type: string, t: (key: string) => string): string => {
  const normalizedKey = extractEventType(type);
  const translated = t(`operations.events.${normalizedKey}`);

  if (translated === `operations.events.${normalizedKey}`) {
    return type.replace(/[:_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return translated;
};

export const humanizeDescription = (
  incident: {
    triggerDetails?: string;
    diagnosis?: string | null;
    title?: string;
    severity?: string;
  },
  t: (key: string) => string,
): string => {
  if (incident.triggerDetails) return incident.triggerDetails;
  if (incident.diagnosis) return incident.diagnosis;
  if (incident.title && incident.title !== `${incident.severity} incident`) return incident.title;
  return t('operations.incidents.generic_error');
};

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
/bin/bash -lc 'rg -n "export interface OpsIncident|interface OpsIncident|CircuitBreakerWithProject|CircuitBreakerState" web/src/lib/api/operations.ts' in /home/lee/OpenLander
 succeeded in 0ms:
60:export interface OpsIncidentEvent {
71:export interface OpsIncident {
89:export interface CircuitBreakerState {
116:export async function fetchCircuitBreakerState(projectId: string): Promise<CircuitBreakerState> {
120:    state: (CircuitBreakerState & { project_id?: string }) | null;
188:export interface CircuitBreakerWithProject {
231:  breakers: CircuitBreakerWithProject[];
235:  return resp.json() as Promise<{ breakers: CircuitBreakerWithProject[] }>;

exec
/bin/bash -lc "git show d9eab4c:web/src/components/ops/v2/MainFeedGrid.tsx | sed -n '1,260p'" in /home/lee/OpenLander
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
        <div className="truncate text-muted-ol">{t(`opsV2.status.${event.status}`)}</div>

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities]);

  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);
  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const th of threadData) {
      initial[th.correlationId] = th.hasPendingApproval;
    }
    return initial;
  });

  const allExpanded =
    threadData.length > 0 && threadData.every((th) => !!expandedMap[th.correlationId]);

  const toggleAll = useCallback(() => {
    const next = !allExpanded;
    setExpandedMap(() => {
      const map: Record<string, boolean> = {};
      for (const th of threadData) {
        map[th.correlationId] = next;
      }
      return map;
    });
  }, [allExpanded, threadData]);


exec
/bin/bash -lc "git show d9eab4c:web/src/components/ops/v2/LeftRail.tsx | sed -n '1,340p'" in /home/lee/OpenLander
 succeeded in 0ms:
import { useState, useEffect, useCallback } from 'react';
import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { ScrollArea } from '../../ui/scroll-area.js';
import type { OpsIncident, CircuitBreakerState } from '../../../lib/api/operations.js';
import type { ActionRun } from '../../../lib/api/projects.js';

const STORAGE_KEY = 'ops-v2-rail-collapsed';

export interface LeftRailProps {
  approvals: ActionRun[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerState[];
  onFilterChange?: (filter: { type?: string; severity?: string }) => void;
  /** When true, forces icon-only collapsed mode regardless of local state */
  forceCollapsed?: boolean;
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}

function SectionHeader({ icon, label, count, collapsed, active, onClick }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150',
        'hover:bg-bg-subtle',
        active ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
        collapsed ? 'justify-center' : 'justify-start',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-xs font-semibold truncate">{label}</span>
          {count > 0 && (
            <span className="text-xs font-mono bg-bg-subtle border border-[hsl(var(--border))] px-1.5 py-0.5 rounded-full shrink-0">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function IncidentRow({ incident, collapsed }: { incident: OpsIncident; collapsed: boolean }) {
  const severityColor =
    incident.severity === 'critical'
      ? 'bg-error'
      : incident.severity === 'warning'
        ? 'bg-warning'
        : 'bg-muted-ol';

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span
          className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
          title={incident.title}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{incident.title}</span>
    </div>
  );
}

function ApprovalRow({ approval, collapsed }: { approval: ActionRun; collapsed: boolean }) {
  const { t } = useLanguage();
  const strategy = approval.recovery_strategy
    ? t(`ops.recoveryStrategy.${approval.recovery_strategy}`)
    : t('ops.recoveryStrategy.unknown');
  const label = `${t('opsV2.rail.actionRequired')}: ${strategy}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className="h-2 w-2 rounded-full shrink-0 bg-warning" title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className="h-2 w-2 rounded-full shrink-0 mt-1 bg-warning" />
      <span className="text-xs font-body text-primary-ol truncate" title={label}>
        {label}
      </span>
    </div>
  );
}

function CircuitBreakerRow({
  breaker,
  index,
  collapsed,
}: {
  breaker: CircuitBreakerState;
  index: number;
  collapsed: boolean;
}) {
  const isOpen = breaker.state === 'open';
  const isHalfOpen = breaker.state === 'half_open';
  const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
  const label = `CB #${index + 1}: ${breaker.state}`;

  if (collapsed) {
    return (
      <div className="flex justify-center py-1">
        <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} title={label} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
      <span className="text-xs font-body text-primary-ol truncate">{label}</span>
    </div>
  );
}

export function LeftRail({
  approvals,
  incidents,
  circuitBreakers,
  onFilterChange,
  forceCollapsed,
}: LeftRailProps) {
  const { t } = useLanguage();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // forceCollapsed overrides local state (used for < lg breakpoint)
  const effectivelyCollapsed = forceCollapsed ?? collapsed;

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Sync localStorage changes from other tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue !== null) {
        setCollapsed(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleSectionClick = useCallback(
    (type: string) => {
      const next = activeFilter === type ? null : type;
      setActiveFilter(next);
      onFilterChange?.(next ? { type: next } : {});
    },
    [activeFilter, onFilterChange],
  );

  const approvalItems = approvals;
  const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');

  return (
    <aside
      style={{
        width: effectivelyCollapsed ? 48 : 320,
        minWidth: effectivelyCollapsed ? 48 : 320,
        transition: 'width 150ms ease, min-width 150ms ease',
      }}
      className={cn(
        'relative flex flex-col h-full',
        'bg-bg-panel border-r border-[hsl(var(--border))]',
        'overflow-hidden',
      )}
    >
      {/* Toggle button — hidden when forceCollapsed is active (breakpoint manages it) */}
      {forceCollapsed === undefined && (
        <div
          className={cn(
            'shrink-0 flex items-center border-b border-[hsl(var(--border))] px-2 py-2',
            effectivelyCollapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <button
            type="button"
            onClick={toggle}
            title={effectivelyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
          >
            {effectivelyCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className={cn('p-2 space-y-4', effectivelyCollapsed && 'space-y-2')}>
          {/* Approvals section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<CheckSquare className="h-4 w-4" />}
              label={t('opsV2.rail.approvals')}
              count={approvalItems.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'approval'}
              onClick={() => handleSectionClick('approval')}
            />
            {!effectivelyCollapsed && approvalItems.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">
                {t('opsV2.empty.noPendingApprovals')}
              </p>
            )}
            {approvalItems.map((item) => (
              <ApprovalRow key={item.id} approval={item} collapsed={effectivelyCollapsed} />
            ))}
          </div>

          {/* Active Issues section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<AlertCircle className="h-4 w-4" />}
              label={t('opsV2.rail.activeIssues')}
              count={incidents.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'incident'}
              onClick={() => handleSectionClick('incident')}
            />
            {!effectivelyCollapsed && incidents.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
            )}
            {incidents.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} collapsed={effectivelyCollapsed} />
            ))}
          </div>

          {/* Circuit Breaker Status section */}
          <div className="space-y-0.5">
            <SectionHeader
              icon={<ShieldAlert className="h-4 w-4" />}
              label={t('opsV2.rail.circuitBreakerStatus')}
              count={openBreakers.length}
              collapsed={effectivelyCollapsed}
              active={activeFilter === 'circuit_breaker'}
              onClick={() => handleSectionClick('circuit_breaker')}
            />
            {!effectivelyCollapsed && circuitBreakers.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.allSystemsNormal')}</p>
            )}
            {circuitBreakers.map((cb, i) => (
              <CircuitBreakerRow key={i} breaker={cb} index={i} collapsed={effectivelyCollapsed} />
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

exec
/bin/bash -lc "rg -n \"triggerType|type: 'deploy|deploy:|recovery:started|circuit_breaker|activity\" src web/src -g '*.ts*'" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/pages/OpsCenter.tsx:115:                  <SelectValue placeholder={t('operations.activity.allProjects')} />
web/src/pages/OpsCenter.tsx:118:                  <SelectItem value="all">{t('operations.activity.allProjects')}</SelectItem>
src/pipeline/auto-recovery.ts:77:    eventType?: 'deploy:failed' | 'compose:failed',
src/pipeline/auto-recovery.ts:179:      unsubscribeSuccess = subscribeOnce('deploy:success', (payload) => {
src/pipeline/auto-recovery.ts:190:      unsubscribeFailed = subscribeOnce('deploy:failed', (payload) => {
src/pipeline/auto-recovery.ts:338:      await eventBus.emit('deploy:needs-user-action', {
src/pipeline/auto-recovery.ts:785:    eventType: 'deploy:failed' | 'compose:failed' = 'deploy:failed',
src/pipeline/auto-recovery.ts:804:      return eventBus.emit('deploy:needs-user-action', {
src/pipeline/auto-recovery.ts:836:      return eventBus.emit('deploy:needs-user-action', {
src/pipeline/auto-recovery.ts:875:      return eventBus.emit('deploy:needs-user-action', {
src/pipeline/preview.ts:143:      await eventBus.emit('deploy:success', {
web/src/components/ops/IncidentMap.tsx:41:      a.triggerType !== b.triggerType ||
web/src/components/ops/IncidentMap.tsx:61:      incident.triggerType ||
web/src/components/ops/IncidentMap.tsx:75:        latest.triggerType ||
web/src/hooks/use-ops-center-data.ts:11:import { type AgentActiveState } from './use-agent-activity';
web/src/hooks/use-ops-center-data.ts:94:        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
web/src/hooks/use-ops-center-data.ts:229:      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
web/src/hooks/use-ops-center-data.ts:240:      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
web/src/hooks/use-ops-center-data.ts:243:        const items = activityData.activities.slice(0, BUFFER_MAX);
src/pipeline/post-deploy-insight.ts:63: * Called after `deploy:success`. Each check is independent — a failure in
web/src/hooks/use-activity-stream.ts:35:        const resp = await fetch(`/api/activity?${params.toString()}`, {
web/src/components/ops/v2/MainFeedGrid.tsx:30:  [/^deploy:crash$/i, 'opsV2.titles.deployCrash'],
web/src/components/ops/v2/MainFeedGrid.tsx:31:  [/^deploy:failed$/i, 'opsV2.titles.deployFailed'],
web/src/components/ops/v2/MainFeedGrid.tsx:32:  [/^deploy:/i, 'opsV2.titles.deployFailed'],
web/src/components/ops/v2/MainFeedGrid.tsx:59:  triggerType?: string;
web/src/components/ops/v2/MainFeedGrid.tsx:111:    const triggerType = activeIncident?.triggerType;
web/src/components/ops/v2/MainFeedGrid.tsx:124:      triggerType,
web/src/components/ops/v2/MainFeedGrid.tsx:402:                    {thread.triggerType && (
web/src/components/ops/v2/MainFeedGrid.tsx:405:                          thread.triggerType,
web/src/components/ops/v2/ThreadApprovalActions.tsx:32: * Extract the tool name from an approval activity's title.
web/src/components/ops/v2/LeftRail.tsx:75:  const displayTitle = incident.triggerType
web/src/components/ops/v2/LeftRail.tsx:76:    ? humanizeEventType(incident.triggerType, t)
web/src/components/ops/v2/LeftRail.tsx:216:      const key = incident.triggerType ?? incident.title;
web/src/components/ops/v2/LeftRail.tsx:217:      const existing = acc.find((g) => (g.incident.triggerType ?? g.incident.title) === key);
web/src/components/ops/v2/LeftRail.tsx:301:                key={incident.triggerType ?? incident.id}
web/src/components/ops/v2/LeftRail.tsx:316:              active={activeFilter === 'circuit_breaker'}
web/src/components/ops/v2/LeftRail.tsx:317:              onClick={() => handleSectionClick('circuit_breaker')}
src/pipeline/deploy-plan/engine.ts:919:        const unsubSuccess = this.events.on('deploy:success', (payload) => {
src/pipeline/deploy-plan/engine.ts:932:        const unsubFailed = this.events.on('deploy:failed', (payload) => {
web/src/components/ops/ActivityFeed.tsx:30:import { useActivityStream } from '@/hooks/use-activity-stream';
web/src/components/ops/ActivityFeed.tsx:58:  'circuit_breaker',
web/src/components/ops/ActivityFeed.tsx:62:  'recovery:started',
web/src/components/ops/ActivityFeed.tsx:75:  if (type === 'circuit_breaker') return ShieldAlert;
web/src/components/ops/ActivityFeed.tsx:78:  if (type === 'recovery:started') return RefreshCcw;
web/src/components/ops/ActivityFeed.tsx:174:              {t('operations.activity.title')}
web/src/components/ops/ActivityFeed.tsx:201:                  {type === 'all' ? t('operations.activity.allTypes') : getTypeLabel(type, t)}
web/src/components/ops/ActivityFeed.tsx:240:          {t('operations.activity.empty')}
src/pipeline/deploy-core.ts:701:    await eventBus.emit('deploy:start', { projectId, repoUrl });
src/pipeline/deploy-core.ts:756:        ).emit('deploy:image-pull', { projectId, image: imageUrl });
src/pipeline/deploy-core.ts:768:        ).emit('deploy:image-pulled', { projectId, image: imageUrl });
src/pipeline/deploy-core.ts:908:      await eventBus.emit('deploy:failed', {
src/pipeline/deploy-core.ts:1031:    await eventBus.emit('deploy:start', {
src/pipeline/deploy-core.ts:1039:    await eventBus.emit('deploy:clone', {
src/pipeline/deploy-core.ts:1114:      await eventBus.emit('deploy:failed', {
src/pipeline/deploy-core.ts:1145:      await eventBus.emit('deploy:failed', {
src/pipeline/deploy-core.ts:1245:      await eventBus.emit('deploy:success', {
src/pipeline/deploy-core.ts:1260:      await eventBus.emit('deploy:failed', {
src/pipeline/deploy-core.ts:1472:      await eventBus.emit('deploy:start', { projectId, repoUrl: project.repo_url });
src/pipeline/deploy-core.ts:1506:      await eventBus.emit('deploy:build', {
src/pipeline/deploy-core.ts:1531:      await eventBus.emit('deploy:run', {
src/pipeline/deploy-core.ts:1597:      await eventBus.emit('deploy:success', {
src/pipeline/deploy-core.ts:1671:      await eventBus.emit('deploy:failed', {
web/src/lib/deployments.ts:97:  deploy: DeploymentViewModel,
web/src/components/ops/AgentActivityPanel.tsx:2:import { useAgentActivity } from '@/hooks/use-agent-activity';
web/src/lib/api/operations.ts:85:  triggerType?: string;
web/src/lib/api/operations.ts:150:    | 'circuit_breaker'
web/src/lib/api/operations.ts:158:    | 'recovery:started';
web/src/lib/api/operations.ts:178:  triggerType?: string;
web/src/lib/api/operations.ts:225:  const resp = await fetchWithAuth(`/api/ops/activity${query}`);
src/pipeline/deploy/monorepo-orchestrator.ts:61:  await eventBus.emit('deploy:start', {
src/pipeline/deploy/monorepo-orchestrator.ts:73:    await eventBus.emit('deploy:failed', {
src/pipeline/deploy/monorepo-orchestrator.ts:144:    await eventBus.emit('deploy:build', {
src/pipeline/deploy/monorepo-orchestrator.ts:170:    await eventBus.emit('deploy:run', {
src/pipeline/deploy/monorepo-orchestrator.ts:203:    await eventBus.emit('deploy:success', {
src/pipeline/deploy/monorepo-orchestrator.ts:239:    await eventBus.emit('deploy:failed', {
src/pipeline/deploy/tunnel.ts:6:const log = createModuleLogger('deploy:tunnel');
src/pipeline/deploy/rollback.ts:15:const log = createModuleLogger('deploy:rollback');
src/pipeline/deploy/rollback.ts:134:      await eventBus.emit('deploy:rollback', {
src/pipeline/deploy/orchestrator.ts:70:  await eventBus.emit('deploy:clone', {
src/pipeline/deploy/orchestrator.ts:99:      await eventBus.emit('deploy:diff-analyzed', {
src/pipeline/deploy/orchestrator.ts:303:        await eventBus.emit('deploy:auto-detect', {
src/pipeline/deploy/orchestrator.ts:420:  await eventBus.emit('deploy:build', {
src/pipeline/deploy/orchestrator.ts:494:  await eventBus.emit('deploy:run', {
src/pipeline/deploy/orchestrator.ts:536:    await eventBus.emit('deploy:crash', {
src/pipeline/deploy/orchestrator.ts:680:      await eventBus.emit('deploy:success', {
src/pipeline/deploy/lifecycle.ts:13:const log = createModuleLogger('deploy:lifecycle');
web/src/components/dashboard/ProjectCard.tsx:23:  onRedeploy: (event: MouseEvent, projectId: string) => Promise<void>;
src/events/index.ts:24:  | 'deploy:start'
src/events/index.ts:25:  | 'deploy:clone'
src/events/index.ts:26:  | 'deploy:build'
src/events/index.ts:27:  | 'deploy:run'
src/events/index.ts:28:  | 'deploy:auto-detect'
src/events/index.ts:29:  | 'deploy:success'
src/events/index.ts:30:  | 'deploy:failed'
src/events/index.ts:31:  | 'deploy:needs-user-action'
src/events/index.ts:32:  | 'deploy:crash'
src/events/index.ts:33:  | 'deploy:rollback'
src/events/index.ts:87:  | 'recovery:started'
src/events/index.ts:98:  | 'deploy:diff-analyzed';
src/events/index.ts:101:  'deploy:start': {
src/events/index.ts:110:  'deploy:clone': {
src/events/index.ts:120:  'deploy:build': {
src/events/index.ts:130:  'deploy:run': {
src/events/index.ts:141:  'deploy:auto-detect': { projectId: string; framework: string; type: 'dockerfile' | 'compose' };
src/events/index.ts:142:  'deploy:success': {
src/events/index.ts:153:  'deploy:failed': {
src/events/index.ts:168:  'deploy:needs-user-action': {
src/events/index.ts:175:  'deploy:crash': { projectId: string; containerId: string; error?: string; exitCode?: number };
src/events/index.ts:176:  'deploy:rollback': { projectId: string; fromImage: string; toImage: string };
src/events/index.ts:306:  'recovery:started': {
src/events/index.ts:385:  'deploy:diff-analyzed': {
src/pipeline/service-adapters/postgres-adapter.ts:75:      'SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL',
src/config/index.ts:180:  /** Days of inactivity before suggesting cleanup */
src/config/index.ts:181:  inactivityThresholdDays: number;
src/config/index.ts:330:      inactivityThresholdDays: 14,
src/monitor/activity-logger.ts:2: * ActivityLogger — persists EventBus events to the activity_log table.
src/monitor/activity-logger.ts:5: * as an activity_log row via Database.insertActivityLog().
src/monitor/activity-logger.ts:14:import { buildActivityEvent } from './activity-event-mapper.js';
src/monitor/activity-logger.ts:16:const log = createModuleLogger('activity-logger');
src/monitor/activity-logger.ts:18:/** All event types that should be persisted to activity_log. */
src/monitor/activity-logger.ts:20:  'deploy:start',
src/monitor/activity-logger.ts:21:  'deploy:clone',
src/monitor/activity-logger.ts:22:  'deploy:build',
src/monitor/activity-logger.ts:23:  'deploy:run',
src/monitor/activity-logger.ts:24:  'deploy:success',
src/monitor/activity-logger.ts:25:  'deploy:failed',
src/monitor/activity-logger.ts:26:  'deploy:crash',
src/monitor/activity-logger.ts:27:  'deploy:rollback',
src/monitor/activity-logger.ts:54:  'recovery:started',
src/monitor/activity-logger.ts:76:            const activity = buildActivityEvent(this.db, eventType, payload);
src/monitor/activity-logger.ts:77:            if (!activity) return;
src/monitor/activity-logger.ts:81:              activity.correlationId ??
src/monitor/activity-logger.ts:86:            if (activity.incidentId) metadata.incidentId = activity.incidentId;
src/monitor/activity-logger.ts:87:            if (activity.actionRunId) metadata.actionRunId = activity.actionRunId;
src/monitor/activity-logger.ts:88:            if (activity.aiMetadata) metadata.aiMetadata = activity.aiMetadata;
src/monitor/activity-logger.ts:89:            if (activity.reason) metadata.reason = activity.reason;
src/monitor/activity-logger.ts:93:              activity_type: activity.type,
src/monitor/activity-logger.ts:94:              severity: activity.severity,
src/monitor/activity-logger.ts:95:              project_id: activity.projectId,
src/monitor/activity-logger.ts:97:              title: activity.title,
src/monitor/activity-logger.ts:98:              description: activity.description,
src/monitor/activity-logger.ts:99:              status: activity.status,
src/monitor/activity-logger.ts:103:            log.error({ err, eventType }, 'Failed to persist activity event');
src/monitor/activity-logger.ts:112:      'ActivityLogger started — persisting events to activity_log',
src/db/types.ts:287:  activity_type: string;
src/monitor/alerts.ts:77:    this.unsubscribeCrash = this.events.on('deploy:failed', (payload) => {
src/app.ts:31:import { ActivityLogger } from './monitor/activity-logger.js';
src/app.ts:63:  'deploy:failed',
src/app.ts:370:  eventBus.on('deploy:start', (payload) => {
src/app.ts:374:      log.error({ error }, 'Unhandled error in deploy:start event handler');
src/app.ts:377:  eventBus.on('deploy:success', () => {
src/app.ts:381:      log.error({ error }, 'Unhandled error in deploy:success event handler');
src/app.ts:384:  eventBus.on('deploy:failed', () => {
src/app.ts:388:      log.error({ error }, 'Unhandled error in deploy:failed event handler');
src/app.ts:429:  eventBus.on('recovery:started', (payload) => {
src/app.ts:435:        log.error({ err }, 'Failed to send recovery:started notification');
src/app.ts:614:  const activityLogger = new ActivityLogger(eventBus, db);
src/app.ts:615:  activityLogger.start();
src/app.ts:616:  activeActivityLogger = activityLogger;
src/db/schema.drizzle.ts:546:  'circuit_breaker_state',
src/db/schema.drizzle.ts:558:    check('circuit_breaker_state_check', sql`${table.state} IN ('closed', 'open', 'half_open')`),
src/db/schema.drizzle.ts:601:export const activityLog = sqliteTable(
src/db/schema.drizzle.ts:602:  'activity_log',
src/db/schema.drizzle.ts:606:    activity_type: text('activity_type').notNull(),
src/db/schema.drizzle.ts:617:    index('idx_activity_log_created_at').on(table.created_at),
src/db/schema.drizzle.ts:618:    index('idx_activity_log_correlation_id').on(table.correlation_id),
src/db/schema.drizzle.ts:619:    index('idx_activity_log_project_created').on(table.project_id, table.created_at),
src/db/schema.drizzle.ts:620:    index('idx_activity_log_type_created').on(table.activity_type, table.created_at),
src/db/schema.drizzle.ts:624:export type ActivityLogRow = typeof activityLog.$inferSelect;
src/db/schema.drizzle.ts:625:export type NewActivityLog = typeof activityLog.$inferInsert;
src/db/schema.drizzle.ts:651:  activityLog,
src/web/api/project-routes.ts:481:      needsRedeploy: changed && environment.status === 'running',
src/web/api/project-routes.ts:1146:      needsRedeploy: changed && project.status === 'running',
src/monitor/rollback-watcher.ts:32:      this.events.on('deploy:success', (payload) => {
src/db/migration.ts:600:  // circuit_breaker_state table (v1.0.0-ops)
src/db/migration.ts:601:  sqlite.exec(`CREATE TABLE IF NOT EXISTS circuit_breaker_state (
src/db/migration.ts:629:  // activity_log table (ops-center-v2)
src/db/migration.ts:630:  sqlite.exec(`CREATE TABLE IF NOT EXISTS activity_log (
src/db/migration.ts:633:    activity_type TEXT NOT NULL,
src/db/migration.ts:643:  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at)');
src/db/migration.ts:645:    'CREATE INDEX IF NOT EXISTS idx_activity_log_correlation_id ON activity_log(correlation_id)',
src/db/migration.ts:648:    'CREATE INDEX IF NOT EXISTS idx_activity_log_project_created ON activity_log(project_id, created_at)',
src/db/migration.ts:651:    'CREATE INDEX IF NOT EXISTS idx_activity_log_type_created ON activity_log(activity_type, created_at)',
src/db/index.ts:31:import { ActivityLogRepo } from './repos/activity-log.repo.js';
src/db/index.ts:85:  private readonly activityLogRepo: ActivityLogRepo;
src/db/index.ts:117:    this.activityLogRepo = new ActivityLogRepo(this.db, this.sqlite);
src/db/index.ts:270:  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
src/db/index.ts:271:  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
src/db/index.ts:272:  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
src/db/index.ts:273:  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
src/db/index.ts:274:  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
src/db/index.ts:275:  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }
src/web/api/deploy-failure-handler.ts:78:    await eventBus.emit('deploy:failed', {
src/web/api/deploy-failure-handler.ts:115:    await eventBus.emit('deploy:failed', {
src/web/api/deploy-failure-handler.ts:204:    await eventBus.emit('deploy:failed', {
src/web/api/deploy-failure-handler.ts:228:      await eventBus.emit('deploy:failed', {
src/web/api/deploy-failure-handler.ts:256:        await eventBus.emit('deploy:needs-user-action', {
src/web/api/deploy-failure-handler.ts:283:  await eventBus.emit('deploy:failed', {
src/web/api/deploy-failure-handler.ts:312:        event: 'deploy:start',
src/web/api/deploy-failure-handler.ts:316:        event: 'deploy:clone',
src/web/api/deploy-failure-handler.ts:320:        event: 'deploy:build',
src/web/api/deploy-failure-handler.ts:324:        event: 'deploy:run',
src/web/api/deploy-failure-handler.ts:346:        eventBus.on('deploy:success', (payload) => {
src/web/api/deploy-failure-handler.ts:355:        eventBus.on('deploy:failed', (payload) => {
src/web/api/deploy-failure-handler.ts:364:        eventBus.on('deploy:needs-user-action', (payload) => {
src/web/api/routes.ts:9:import { type ActivityEvent, buildActivityEvent } from '../../monitor/activity-event-mapper.js';
src/web/api/routes.ts:27:  'circuit_breaker',
src/web/api/routes.ts:35:  'recovery:started',
src/web/api/routes.ts:76:function activityLogRowToEvent(row: ActivityLogRow, projectName: string): ActivityEvent {
src/web/api/routes.ts:87:    type: row.activity_type as ActivityEvent['type'],
src/web/api/routes.ts:149:    'deploy:start',
src/web/api/routes.ts:150:    'deploy:clone',
src/web/api/routes.ts:151:    'deploy:build',
src/web/api/routes.ts:152:    'deploy:run',
src/web/api/routes.ts:153:    'deploy:success',
src/web/api/routes.ts:154:    'deploy:failed',
src/web/api/routes.ts:155:    'deploy:crash',
src/web/api/routes.ts:156:    'deploy:rollback',
src/web/api/routes.ts:182:    'recovery:started',
src/web/api/routes.ts:190:  eventBus.on('deploy:success', (p) => {
src/web/api/routes.ts:193:  eventBus.on('deploy:failed', (p) => {
src/web/api/routes.ts:203:  // --- Helper: resolve project names for activity log rows ---
src/web/api/routes.ts:214:      return activityLogRowToEvent(row, name);
src/web/api/routes.ts:220:  api.get('/activity', (c) => {
src/web/api/routes.ts:231:    // Note: activity_type filter uses comma-separated types from ?types= param;
src/web/api/routes.ts:235:      activity_type?: string;
src/web/api/routes.ts:244:      dbFilters.activity_type = [...typeFilter][0];
src/web/api/routes.ts:259:              const activityEvent = buildActivityEvent(ctx.db, eventType, payload);
src/web/api/routes.ts:260:              if (!activityEvent) return;
src/web/api/routes.ts:262:                !shouldIncludeActivity(activityEvent, {
src/web/api/routes.ts:272:                liveBuffer.push(activityEvent);
src/web/api/routes.ts:274:                void s.write(JSON.stringify(activityEvent) + '\n');
src/web/api/routes.ts:306:            log.error({ err }, 'Failed to query activity_log for backfill');
src/web/api/routes.ts:328:    // --- REST mode: Query activity_log table ---
src/monitor/ops-incidents.ts:88:    log.info({ incidentId: incident.id, projectId, triggerType: trigger.type }, 'Incident opened');
src/monitor/ops-incidents.ts:138:  private inferSeverity(triggerType: string): 'critical' | 'warning' | 'info' {
src/monitor/ops-incidents.ts:140:      triggerType.includes('crash') ||
src/monitor/ops-incidents.ts:141:      triggerType.includes('missing') ||
src/monitor/ops-incidents.ts:142:      triggerType.includes('exhausted')
src/monitor/ops-incidents.ts:147:      triggerType.includes('fail') ||
src/monitor/ops-incidents.ts:148:      triggerType.includes('degrad') ||
src/monitor/ops-incidents.ts:149:      triggerType.includes('inactive')
src/db/repos/activity-log.repo.ts:3:import { activityLog } from '../schema.drizzle.js';
src/db/repos/activity-log.repo.ts:55:    activity_type: string;
src/db/repos/activity-log.repo.ts:69:      .insert(activityLog)
src/db/repos/activity-log.repo.ts:73:        activity_type: entry.activity_type,
src/db/repos/activity-log.repo.ts:85:    const created = this.db.select().from(activityLog).where(eq(activityLog.id, id)).get() as
src/db/repos/activity-log.repo.ts:89:    if (!created) throw new Error(`Failed to create activity log entry ${id}`);
src/db/repos/activity-log.repo.ts:96:      .from(activityLog)
src/db/repos/activity-log.repo.ts:97:      .where(gt(activityLog.id, lastUlid))
src/db/repos/activity-log.repo.ts:98:      .orderBy(asc(activityLog.id))
src/db/repos/activity-log.repo.ts:106:    filters?: { project_id?: string; activity_type?: string },
src/db/repos/activity-log.repo.ts:110:    const conditions = [between(activityLog.created_at, from, to)];
src/db/repos/activity-log.repo.ts:113:      conditions.push(eq(activityLog.project_id, filters.project_id));
src/db/repos/activity-log.repo.ts:115:    if (filters?.activity_type) {
src/db/repos/activity-log.repo.ts:116:      conditions.push(eq(activityLog.activity_type, filters.activity_type));
src/db/repos/activity-log.repo.ts:119:      conditions.push(gt(activityLog.id, cursor));
src/db/repos/activity-log.repo.ts:124:      .from(activityLog)
src/db/repos/activity-log.repo.ts:126:      .orderBy(asc(activityLog.id))
src/db/repos/activity-log.repo.ts:131:  /** Find recent activity log entries with optional filters (newest first). */
src/db/repos/activity-log.repo.ts:136:      activity_type?: string;
src/db/repos/activity-log.repo.ts:143:      conditions.push(eq(activityLog.project_id, filters.project_id));
src/db/repos/activity-log.repo.ts:145:    if (filters?.activity_type) {
src/db/repos/activity-log.repo.ts:146:      conditions.push(eq(activityLog.activity_type, filters.activity_type));
src/db/repos/activity-log.repo.ts:149:      conditions.push(eq(activityLog.severity, filters.severity));
src/db/repos/activity-log.repo.ts:152:      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
src/db/repos/activity-log.repo.ts:159:            .from(activityLog)
src/db/repos/activity-log.repo.ts:161:            .orderBy(desc(activityLog.id))
src/db/repos/activity-log.repo.ts:163:        : this.db.select().from(activityLog).orderBy(desc(activityLog.id)).limit(limit);
src/db/repos/activity-log.repo.ts:174:      activity_type?: string;
src/db/repos/activity-log.repo.ts:179:    const conditions = [gt(activityLog.id, lastUlid)];
src/db/repos/activity-log.repo.ts:181:      conditions.push(eq(activityLog.project_id, filters.project_id));
src/db/repos/activity-log.repo.ts:183:    if (filters?.activity_type) {
src/db/repos/activity-log.repo.ts:184:      conditions.push(eq(activityLog.activity_type, filters.activity_type));
src/db/repos/activity-log.repo.ts:187:      conditions.push(eq(activityLog.severity, filters.severity));
src/db/repos/activity-log.repo.ts:190:      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
src/db/repos/activity-log.repo.ts:195:      .from(activityLog)
src/db/repos/activity-log.repo.ts:197:      .orderBy(asc(activityLog.id))
src/db/repos/activity-log.repo.ts:203:    const result = this.db.delete(activityLog).where(lt(activityLog.created_at, isoDate)).run();
src/web/api/deploy-timeline-stream-routes.ts:205:    eventBus.on('deploy:start', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:224:    eventBus.on('deploy:clone', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:243:    eventBus.on('deploy:build', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:265:    eventBus.on('deploy:run', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:284:    eventBus.on('deploy:success', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:360:    eventBus.on('deploy:failed', (payload) => {
src/web/api/deploy-timeline-stream-routes.ts:537:        message: `Last deploy: ${trigger}${commitInfo} — ${ago}${duration ? `, took ${duration}` : ''}`,
web/src/components/project/ProjectHeader.tsx:37:  onRedeploy: () => void;
src/mcp/composite-tools.ts:18: * openlander_deploy: Deployment lifecycle & orchestration
src/mcp/composite-tools.ts:192:  openlander_deploy: DEPLOY_ACTIONS,
web/src/components/project/OperationsTab.tsx:42:      inc.triggerType ||
web/src/components/project/OperationsTab.tsx:51:      latest.triggerType ||
src/web/api/ops-routes.ts:13:  type: 'incident' | 'recovery' | 'approval' | 'circuit_breaker' | 'cleanup' | 'alert';
src/web/api/ops-routes.ts:24:  triggerType?: string;
src/web/api/ops-routes.ts:29:  triggerType?: string;
src/web/api/ops-routes.ts:71:  const triggerType = typePart?.trim();
src/web/api/ops-routes.ts:72:  if (!triggerType) return {};
src/web/api/ops-routes.ts:75:    triggerType,
src/web/api/ops-routes.ts:89:        triggerType: metadata.trigger_type,
src/web/api/ops-routes.ts:94:    if (detectedTrigger.triggerType) return detectedTrigger;
src/web/api/ops-routes.ts:105:    triggerType: trigger.triggerType,
src/web/api/ops-routes.ts:395:  api.get('/activity', (c) => {
src/web/api/ops-routes.ts:437:              triggerType: trigger.triggerType,
src/monitor/recovery-coordinator.ts:16:  | 'circuit_breaker_open'
src/monitor/recovery-coordinator.ts:103:      this.events.on('deploy:failed', async (payload) => {
src/monitor/recovery-coordinator.ts:167:      return { eligible: false, reason: 'circuit_breaker_open' };
src/monitor/recovery-coordinator.ts:247:          type: 'deploy:crash',
src/monitor/recovery-coordinator.ts:263:      await this.events.emit('recovery:started', {
src/monitor/recovery-coordinator.ts:289:          'circuit_breaker_open',
src/monitor/recovery-coordinator.ts:301:          type: 'deploy:crash',
src/monitor/recovery-coordinator.ts:316:      await this.events.emit('recovery:started', {
src/monitor/recovery-coordinator.ts:326:  private async handleDeployFailed(payload: EventPayload['deploy:failed']): Promise<void> {
src/monitor/recovery-coordinator.ts:346:      log.error({ err, projectId: payload.projectId }, 'Unhandled error in deploy:failed handler');
src/ipc/client.ts:328:      `/api/activity?limit=${String(limit)}`,
src/ipc/client.ts:334:    yield* this.streamNDJSON<ActivityEvent>('/api/activity/stream', signal);
src/monitor/ops-agent.ts:56:    this.eventHandlers.set('deploy:crash', (payload) => {
src/monitor/ops-agent.ts:57:      this.enqueue({ type: 'deploy:crash', payload, timestamp: Date.now() });
src/monitor/ops-agent.ts:81:          | 'deploy:crash'
src/monitor/ops-agent.ts:170:      case 'deploy:crash':
src/webhook/index.ts:150:    await this.events.emit('deploy:start', {
src/monitor/activity-event-mapper.ts:2: * Shared event-to-activity mapping functions.
src/monitor/activity-event-mapper.ts:4: * Extracted from src/web/api/routes.ts so that both the API activity buffer
src/monitor/activity-event-mapper.ts:9:import { ulid } from '../db/repos/activity-log.repo.js';
src/monitor/activity-event-mapper.ts:11:// ── ActivityEvent shape (matches the legacy /api/activity format) ──
src/monitor/activity-event-mapper.ts:20:    | 'circuit_breaker'
src/monitor/activity-event-mapper.ts:28:    | 'recovery:started';
src/monitor/activity-event-mapper.ts:55:  // Backward-compatibility aliases for legacy consumers of /api/activity
src/monitor/activity-event-mapper.ts:122:    eventType === 'recovery:started'
src/monitor/activity-event-mapper.ts:158:  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
src/monitor/activity-event-mapper.ts:169:    eventType === 'deploy:failed' ||
src/monitor/activity-event-mapper.ts:170:    eventType === 'deploy:crash' ||
src/monitor/activity-event-mapper.ts:192:    eventType === 'deploy:crash' ||
src/monitor/activity-event-mapper.ts:213:  if (eventType === 'deploy:failed') {
src/monitor/activity-event-mapper.ts:214:    return (payload as EventPayload['deploy:failed']).error;
src/monitor/activity-event-mapper.ts:237:  if (eventType === 'recovery:started') {
src/monitor/activity-event-mapper.ts:238:    return (payload as EventPayload['recovery:started']).trigger;
src/monitor/activity-event-mapper.ts:260:  if (eventType === 'deploy:failed') {
src/monitor/activity-event-mapper.ts:261:    const deployPayload = payload as EventPayload['deploy:failed'];
src/monitor/activity-event-mapper.ts:267:  if (eventType === 'deploy:crash') {
src/monitor/activity-event-mapper.ts:268:    const crashPayload = payload as EventPayload['deploy:crash'];
src/monitor/activity-event-mapper.ts:364:  if (eventType === 'recovery:started') {
src/monitor/activity-event-mapper.ts:365:    const startedPayload = payload as EventPayload['recovery:started'];
src/git-providers/gitlab.ts:24:  last_activity_at: string;
src/git-providers/gitlab.ts:84:      `?membership=true&order_by=last_activity_at&sort=desc&per_page=${String(perPage)}&page=${String(page)}${visibility}`;
src/git-providers/gitlab.ts:190:    updatedAt: project.last_activity_at,
web/src/components/project/ProjectDetailTabs.tsx:19:  onRedeploy: () => void;
src/tools/defs/git.ts:147:    mcpDescription: 'List repositories from the connected GitHub account by recent activity.',
src/tools/defs/deploy.ts:393:          const unsubSuccess = eventBus.on('deploy:success', (payload) => {
src/tools/defs/deploy.ts:397:          const unsubFailed = eventBus.on('deploy:failed', (payload) => {
src/tools/defs/deploy.ts:461:        const unsubSuccess = eventBus.on('deploy:success', () => {
src/tools/defs/deploy.ts:464:        const unsubFailed = eventBus.on('deploy:failed', () => {
web/src/i18n/ko.ts:189:  deploy: {
web/src/i18n/ko.ts:500:    activity: {
web/src/i18n/ko.ts:739:    waitingForRedeploy: '재배포 대기 중',
src/tools/defs/deploy-plan.ts:241:      'One-call deploy: analyzes repo, creates plan, executes, and optionally waits for completion. Combines create_deploy_plan + execute_deploy_plan + get_deploy_status into a single call. Returns final deployment result with URL when done, including internal_host, docker_host, elapsed, and on failure auto_diagnosis/build_log_tail; timeout may be returned when wait times out. If the plan needs missing env vars, returns status "needs_input" with the missing list — provide them and call again. Power users can still use the 3-step flow for finer control.',
src/tools/defs/deploy-plan.ts:243:      'One-call deploy: repo analysis → build → deploy → result. Returns immediately with status. Poll get_deploy_status to track progress. Returns URL on success, error + diagnosis guidance on failure. Use the 3-step flow (create/execute/status) for finer control.',
src/tools/defs/deploy-plan.ts:491:        const unsubSuccess = eventBus.on('deploy:success', (payload) => {
src/tools/defs/deploy-plan.ts:506:        const unsubFailed = eventBus.on('deploy:failed', (payload) => {
web/src/i18n/en.ts:190:  deploy: {
web/src/i18n/en.ts:474:    description: 'Monitor agent activity, active issues, and system health across all projects.',
web/src/i18n/en.ts:503:    activity: {
web/src/i18n/en.ts:505:      empty: 'No recent activity',
web/src/i18n/en.ts:611:      noActivity: 'No recent activity',
web/src/i18n/en.ts:743:    waitingForRedeploy: 'Waiting for redeploy',
web/src/i18n/en.ts:802:    empty: 'No activity yet',
web/src/i18n/en.ts:892:      'No build activity for over 2 minutes. The build may be stuck or the server may have restarted.',

exec
/bin/bash -lc "rg -n \"opsV2\\.titles\\.|operations\\.events\\.|eventCount\" web/src/i18n/en.ts web/src/i18n/ko.ts" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/i18n/ko.ts:566:      eventCount: '{count}개 이벤트',
web/src/i18n/ko.ts:579:        eventCount: '건수',
web/src/i18n/ko.ts:704:    eventCount: '건',
web/src/i18n/en.ts:569:      eventCount: '{count} events',
web/src/i18n/en.ts:582:        eventCount: 'Events',
web/src/i18n/en.ts:708:    eventCount: 'events',

codex
The utility/type layer confirms the likely failure modes. I’m tracing the actual activity payloads now so I can judge whether these regexes and grouping keys line up with real event shapes instead of hypothetical ones.
exec
/bin/bash -lc "sed -n '1,260p' src/monitor/activity-event-mapper.ts" in /home/lee/OpenLander
 succeeded in 0ms:
/**
 * Shared event-to-activity mapping functions.
 *
 * Extracted from src/web/api/routes.ts so that both the API activity buffer
 * and the persistence subscriber (ActivityLogger) can reuse the same logic.
 */

import type { EventType, EventPayload } from '../events/index.js';
import { ulid } from '../db/repos/activity-log.repo.js';

// ── ActivityEvent shape (matches the legacy /api/activity format) ──

export interface ActivityEvent {
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
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
  rawType: EventType;
  // Backward-compatibility aliases for legacy consumers of /api/activity
  project: string;
  user: string;
  detail?: string;
  time: string;
  reason?: string;
}

// ── Database abstraction for project resolution ──

/**
 * Minimal database interface needed by resolveProjectIdFromEvent().
 * Accepts the full Database class or any object that satisfies these methods.
 */
export interface ActivityMapperDb {
  getActionRunsByApprovalStatus(
    status: 'pending' | 'approved' | 'rejected',
    limit: number,
  ): Array<{ id: string; project_id: string }>;
  getProject(id: string): { name: string } | undefined;
}

// ── Mapping functions ──

export function formatEventName(eventType: string): string {
  return eventType.replace(/[:_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveProjectIdFromEvent<T extends EventType>(
  db: ActivityMapperDb,
  eventType: T,
  payload: EventPayload[T],
): string | undefined {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    const projectId = alertPayload.alert.details.projectId;
    return typeof projectId === 'string' ? projectId : undefined;
  }

  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    if (approvalPayload.projectId) return approvalPayload.projectId;
    const statuses: Array<'pending' | 'approved' | 'rejected'> = [
      'pending',
      'approved',
      'rejected',
    ];
    for (const status of statuses) {
      const matched = db
        .getActionRunsByApprovalStatus(status, 200)
        .find((run) => run.id === approvalPayload.actionRunId);
      if (matched) {
        return matched.project_id;
      }
    }
  }

  const projectId = (payload as { projectId?: string }).projectId;
  return typeof projectId === 'string' ? projectId : undefined;
}

export function mapActivityType(eventType: EventType): ActivityEvent['type'] {
  if (
    eventType === 'ai:invoked' ||
    eventType === 'ai:completed' ||
    eventType === 'recovery:blocked' ||
    eventType === 'recovery:stopped' ||
    eventType === 'recovery:started'
  ) {
    return eventType;
  }
  if (
    eventType === 'recovery:approval-needed' ||
    eventType === 'recovery:approval-auto-skipped' ||
    eventType === 'recovery:approval-resolved'
  ) {
    return 'approval';
  }
  if (
    eventType === 'recovery:start' ||
    eventType === 'recovery:success' ||
    eventType === 'recovery:failed' ||
    eventType === 'recovery:exhausted'
  ) {
    return 'recovery';
  }
  if (eventType.startsWith('alert:')) {
    return 'alert';
  }
  return 'incident';
}

export function mapActivityStatus<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent['status'] {
  if (eventType === 'ai:invoked') return 'ai-running';
  if (eventType === 'ai:completed') {
    const completedPayload = payload as EventPayload['ai:completed'];
    return completedPayload.success ? 'ai-completed' : 'failed';
  }
  if (eventType === 'recovery:blocked') return 'recovery-blocked';
  if (eventType === 'recovery:stopped') return 'recovery-stopped';
  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
  if (eventType === 'recovery:success') return 'resolved';
  if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
  if (eventType === 'recovery:approval-needed') return 'pending';
  if (eventType === 'recovery:approval-auto-skipped') return 'resolved';
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return approvalPayload.approved ? 'resolved' : 'failed';
  }
  if (eventType === 'alert:resolved') return 'resolved';
  if (
    eventType === 'deploy:failed' ||
    eventType === 'deploy:crash' ||
    eventType === 'compose:failed' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'failed';
  }
  return 'active';
}

export function mapActivitySeverity<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
  status: ActivityEvent['status'],
): ActivityEvent['severity'] {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return alertPayload.alert.severity === 'critical' ? 'critical' : 'warning';
  }
  if (
    eventType === 'deploy:crash' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'critical';
  }
  if (status === 'failed' || status === 'recovery-blocked' || status === 'recovery-stopped') {
    return 'warning';
  }
  if (eventType === 'recovery:approval-needed') {
    return 'warning';
  }
  return 'info';
}

export function extractEventDetail<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): string {
  if (eventType === 'deploy:failed') {
    return (payload as EventPayload['deploy:failed']).error;
  }
  if (eventType === 'tunnel:url') {
    return (payload as EventPayload['tunnel:url']).url;
  }
  if (eventType === 'compose:failed') {
    return (payload as EventPayload['compose:failed']).error;
  }
  if (eventType === 'recovery:start') {
    return (payload as EventPayload['recovery:start']).error;
  }
  if (eventType === 'recovery:failed') {
    return (payload as EventPayload['recovery:failed']).error;
  }
  if (eventType === 'recovery:exhausted') {
    return (payload as EventPayload['recovery:exhausted']).lastError;
  }
  if (eventType === 'recovery:blocked') {
    return (payload as EventPayload['recovery:blocked']).reason;
  }
  if (eventType === 'recovery:stopped') {
    return (payload as EventPayload['recovery:stopped']).reason;
  }
  if (eventType === 'recovery:started') {
    return (payload as EventPayload['recovery:started']).trigger;
  }
  if (eventType === 'alert:new') {
    return (payload as EventPayload['alert:new']).alert.message;
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return `${aiPayload.model} ${aiPayload.action}`;
  }
  if (eventType === 'ai:completed') {
    return `${String((payload as EventPayload['ai:completed']).durationMs)}ms`;
  }
  return '';
}

export function describeActivityEvent<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): Pick<
  ActivityEvent,
  'title' | 'description' | 'actionRunId' | 'aiMetadata' | 'reason' | 'incidentId'
> {
  if (eventType === 'deploy:failed') {

exec
/bin/bash -lc "sed -n '260,460p' src/monitor/activity-event-mapper.ts" in /home/lee/OpenLander
 succeeded in 0ms:
  if (eventType === 'deploy:failed') {
    const deployPayload = payload as EventPayload['deploy:failed'];
    return {
      title: `Deploy failed (${deployPayload.step})`,
      description: deployPayload.error,
    };
  }
  if (eventType === 'deploy:crash') {
    const crashPayload = payload as EventPayload['deploy:crash'];
    return {
      title: 'Deploy crashed',
      description:
        crashPayload.error ??
        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
    };
  }
  if (eventType === 'compose:failed') {
    return {
      title: 'Compose failed',
      description: (payload as EventPayload['compose:failed']).error,
    };
  }
  if (eventType === 'container:die') {
    const diePayload = payload as EventPayload['container:die'];
    return {
      title: 'Container exited',
      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
    };
  }
  if (eventType === 'container:oom') {
    const oomPayload = payload as EventPayload['container:oom'];
    return {
      title: 'Container out of memory',
      description: oomPayload.containerName,
    };
  }
  if (eventType === 'container:missing') {
    const missingPayload = payload as EventPayload['container:missing'];
    return {
      title: 'Container missing',
      description: missingPayload.suggestion,
    };
  }
  if (eventType === 'monitor:inactive') {
    const monitorPayload = payload as EventPayload['monitor:inactive'];
    return {
      title: 'Project inactive',
      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
    };
  }
  if (eventType === 'health:degraded') {
    const degradedPayload = payload as EventPayload['health:degraded'];
    return {
      title: 'Health degraded',
      description:
        degradedPayload.lastError ??
        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
    };
  }
  if (eventType === 'recovery:start') {
    const recoveryPayload = payload as EventPayload['recovery:start'];
    return {
      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:success') {
    const recoveryPayload = payload as EventPayload['recovery:success'];
    return {
      title: 'Auto-recovery succeeded',
      description:
        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
    };
  }
  if (eventType === 'recovery:failed') {
    const recoveryPayload = payload as EventPayload['recovery:failed'];
    return {
      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:exhausted') {
    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
    return {
      title: 'Auto-recovery exhausted',
      description: recoveryPayload.lastError,
    };
  }
  if (eventType === 'recovery:blocked') {
    const blockedPayload = payload as EventPayload['recovery:blocked'];
    return {
      title: 'Recovery blocked',
      description: blockedPayload.reason,
      reason: blockedPayload.reason,
    };
  }
  if (eventType === 'recovery:stopped') {
    const stoppedPayload = payload as EventPayload['recovery:stopped'];
    return {
      title: 'Recovery stopped',
      description: stoppedPayload.reason,
      reason: stoppedPayload.reason,
    };
  }
  if (eventType === 'recovery:started') {
    const startedPayload = payload as EventPayload['recovery:started'];
    return {
      title: 'Recovery started',
      description: startedPayload.trigger,
    };
  }
  if (eventType === 'recovery:approval-needed') {
    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
    return {
      title: `Approval required: ${approvalPayload.toolName}`,
      description: `Attempt #${String(approvalPayload.attempt)}`,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'recovery:approval-auto-skipped') {
    const skippedPayload = payload as EventPayload['recovery:approval-auto-skipped'];
    return {
      title: `Approval auto-skipped: ${skippedPayload.toolName}`,
      description: `Step "${skippedPayload.recoveryStep}" set to auto mode`,
      actionRunId: skippedPayload.actionRunId,
    };
  }
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return {
      title: approvalPayload.approved ? 'Approval approved' : 'Approval rejected',
      description: approvalPayload.actionRunId,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return {
      title: 'AI invoked',
      description: `${aiPayload.model} ${aiPayload.action}`,
      aiMetadata: {
        model: aiPayload.model,
      },
    };
  }
  if (eventType === 'ai:completed') {
    const aiPayload = payload as EventPayload['ai:completed'];
    return {
      title: aiPayload.success ? 'AI completed' : 'AI failed',
      description: `${aiPayload.action} (${String(aiPayload.durationMs)}ms)`,
      aiMetadata: {
        model: aiPayload.model,
        durationMs: aiPayload.durationMs,
        tokensUsed: (aiPayload.inputTokens ?? 0) + (aiPayload.outputTokens ?? 0) || undefined,
      },
    };
  }
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return {
      title: `Alert: ${alertPayload.alert.type}`,
      description: alertPayload.alert.message,
      incidentId:
        typeof alertPayload.alert.details.incidentId === 'string'
          ? alertPayload.alert.details.incidentId
          : undefined,
    };
  }

  return {
    title: formatEventName(eventType),
    description: extractEventDetail(eventType, payload),
  };
}

export function buildActivityEvent<T extends EventType>(
  db: ActivityMapperDb,
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent | null {
  const projectId = resolveProjectIdFromEvent(db, eventType, payload);
  if (!projectId) return null;

  const project = db.getProject(projectId);
  const projectName = project?.name ?? projectId;
  const timestamp = new Date().toISOString();
  const type = mapActivityType(eventType);
  const status = mapActivityStatus(eventType, payload);
  const severity = mapActivitySeverity(eventType, payload, status);
  const content = describeActivityEvent(eventType, payload);
  const id = ulid();

  return {
    id,
    timestamp,
    type,
    severity,
    projectId,
    projectName,
    title: content.title,
    description: content.description,

exec
/bin/bash -lc "sed -n '1,220p' src/web/api/ops-routes.ts" in /home/lee/OpenLander
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

exec
/bin/bash -lc "sed -n '1,140p' web/src/components/ops/IncidentMap.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { IncidentCard, type IncidentGroup } from '@/components/ops/IncidentCard';
import { humanizeDescription, humanizeEventType } from '@/components/ops/utils';
import { type OpsIncident, fetchOpsIncidents } from '@/lib/api/operations';
import { useLanguage } from '@/i18n/context';

interface IncidentMapProps {
  projectId?: string;
  projectNameById: Record<string, string>;
  refreshToken: number;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface GroupedIncident {
  projectId: string;
  projectName: string;
  group: IncidentGroup;
}

function hasSameIncidents(prev: OpsIncident[], next: OpsIncident[]): boolean {
  if (prev.length !== next.length) {
    return false;
  }

  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.severity !== b.severity ||
      a.title !== b.title ||
      a.triggerType !== b.triggerType ||
      a.created_at !== b.created_at
    ) {
      return false;
    }
  }

  return true;
}

function groupIncidents(
  incidents: OpsIncident[],
  projectNameById: Record<string, string>,
  t: (key: string) => string,
): GroupedIncident[] {
  const grouped = new Map<string, OpsIncident[]>();

  for (const incident of incidents) {
    if (!projectNameById[incident.project_id]) continue; // Skip archived projects
    const typeKey =
      incident.triggerType ||
      (incident.title || incident.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    const key = `${incident.project_id}::${incident.severity}::${typeKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(incident);
  }

  return Array.from(grouped.entries())
    .map(([key, entries]) => {
      const latest = entries[0];
      const projectId = latest.project_id;
      const typeKey =
        latest.triggerType ||
        (latest.title || latest.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
      return {
        projectId,
        projectName: projectNameById[projectId] ?? projectId.substring(0, 8),
        group: {
          key,
          severity: latest.severity,
          label: humanizeEventType(typeKey, t),
          description: humanizeDescription(latest, t),
          count: entries.length,
          firstSeen: Math.min(...entries.map((item) => new Date(item.created_at).getTime())),
          lastSeen: Math.max(...entries.map((item) => new Date(item.created_at).getTime())),
          latestIncident: latest,
          status: latest.status,
        },
      } satisfies GroupedIncident;
    })
    .sort((a, b) => {
      const aRank = SEVERITY_RANK[a.group.severity] ?? 99;
      const bRank = SEVERITY_RANK[b.group.severity] ?? 99;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return b.group.lastSeen - a.group.lastSeen;
    });
}

export function IncidentMap({ projectId, projectNameById, refreshToken }: IncidentMapProps) {
  const { t } = useLanguage();
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [loading, setLoading] = useState(true);

  const loadIncidents = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) {
        setLoading(true);
      }

      try {
        const data = await fetchOpsIncidents(projectId);
        const active = (data.incidents ?? []).filter((incident) => incident.status !== 'resolved');
        active.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setIncidents((prev) => (hasSameIncidents(prev, active) ? prev : active));
      } catch (err) {
        console.error('Failed to load incidents', err);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadIncidents(true);
  }, [loadIncidents]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void loadIncidents(false);
  }, [loadIncidents, refreshToken]);

  const groupedIncidents = useMemo(
    () => groupIncidents(incidents, projectNameById, t),
    [incidents, projectNameById, t],
  );

exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/MainFeedGrid.tsx | sed -n '1,220p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/MainFeedGrid.tsx | sed -n '360,430p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/LeftRail.tsx | sed -n '1,340p'" in /home/lee/OpenLander
 succeeded in 0ms:
   360	                isWarning && !isCritical && 'bg-warning/5',
   361	              )}
   362	            >
   363	              {/* Parent Row */}
   364	              <CollapsibleTrigger asChild>
   365	                <button
   366	                  type="button"
   367	                  role="row"
   368	                  className={cn(
   369	                    ROW_GRID_CLASSES,
   370	                    'w-full py-2 hover:bg-bg-subtle/80 transition-colors text-left outline-none focus-visible:bg-bg-subtle',
   371	                    isExpanded && 'bg-bg-subtle/40',
   372	                  )}
   373	                >
   374	                  <span role="cell" className="shrink-0 text-muted-ol">
   375	                    {isExpanded ? (
   376	                      <ChevronDown className="h-4 w-4" />
   377	                    ) : (
   378	                      <ChevronRight className="h-4 w-4" />
   379	                    )}
   380	                  </span>
   381
   382	                  <span
   383	                    role="cell"
   384	                    className="min-w-0 shrink truncate text-xs font-semibold text-primary-ol"
   385	                  >
   386	                    {thread.projectName}
   387	                  </span>
   388
   389	                  <div role="cell" className="min-w-0 flex flex-col justify-center">
   390	                    <span
   391	                      className="truncate text-xs font-medium text-secondary-ol"
   392	                      title={
   393	                        thread.title
   394	                          ? localizeTitle(thread.title, t as unknown as (key: string) => string)
   395	                          : undefined
   396	                      }
   397	                    >
   398	                      {thread.title
   399	                        ? localizeTitle(thread.title, t as unknown as (key: string) => string)
   400	                        : thread.title}
   401	                    </span>
   402	                    {thread.triggerType && (
   403	                      <span className="truncate text-[10px] font-mono text-muted-ol mt-0.5">
   404	                        {humanizeEventType(
   405	                          thread.triggerType,
   406	                          t as unknown as (key: string) => string,
   407	                        )}
   408	                      </span>
   409	                    )}
   410	                  </div>
   411
   412	                  <div role="cell">
   413	                    <SeverityBadge severity={thread.severity} />
   414	                  </div>
   415
   416	                  <div role="cell" className="flex items-center gap-2">
   417	                    <span
   418	                      className={cn(
   419	                        'truncate text-[11px] font-medium',
   420	                        thread.status === 'active' && 'text-warning',
   421	                        thread.status === 'resolved' && 'text-success',
   422	                        thread.status === 'failed' && 'text-error',
   423	                        thread.status === 'pending' && 'text-info',
   424	                        thread.status === 'recovering' && 'text-info',
   425	                        thread.status === 'ai-running' && 'text-agent',
   426	                        thread.status === 'ai-completed' && 'text-info',
   427	                        thread.status === 'recovery-blocked' && 'text-warning',
   428	                        thread.status === 'recovery-stopped' && 'text-warning',
   429	                      )}
   430	                    >

 succeeded in 0ms:
     1	import { useState, useEffect, useCallback } from 'react';
     2	import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
     3	import { cn } from '../../../lib/utils.js';
     4	import { useLanguage } from '../../../i18n/context.js';
     5	import { ScrollArea } from '../../ui/scroll-area.js';
     6	import { humanizeEventType } from '../utils.js';
     7	import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
     8	import type { ActionRun } from '../../../lib/api/projects.js';
     9
    10	const STORAGE_KEY = 'ops-v2-rail-collapsed';
    11
    12	export interface LeftRailProps {
    13	  approvals: ActionRun[];
    14	  incidents: OpsIncident[];
    15	  circuitBreakers: CircuitBreakerWithProject[];
    16	  onFilterChange?: (filter: { type?: string; severity?: string }) => void;
    17	  /** When true, forces icon-only collapsed mode regardless of local state */
    18	  forceCollapsed?: boolean;
    19	}
    20
    21	interface SectionHeaderProps {
    22	  icon: React.ReactNode;
    23	  label: string;
    24	  count: number;
    25	  collapsed: boolean;
    26	  active: boolean;
    27	  onClick: () => void;
    28	}
    29
    30	function SectionHeader({ icon, label, count, collapsed, active, onClick }: SectionHeaderProps) {
    31	  return (
    32	    <button
    33	      type="button"
    34	      onClick={onClick}
    35	      title={collapsed ? label : undefined}
    36	      className={cn(
    37	        'w-full flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors duration-150',
    38	        'hover:bg-bg-subtle',
    39	        active ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
    40	        collapsed ? 'justify-center' : 'justify-start',
    41	      )}
    42	    >
    43	      <span className="shrink-0">{icon}</span>
    44	      {!collapsed && (
    45	        <>
    46	          <span className="flex-1 text-left text-xs font-semibold truncate">{label}</span>
    47	          {count > 0 && (
    48	            <span className="text-xs font-mono bg-bg-subtle border border-[hsl(var(--border))] px-1.5 py-0.5 rounded-full shrink-0">
    49	              {count}
    50	            </span>
    51	          )}
    52	        </>
    53	      )}
    54	    </button>
    55	  );
    56	}
    57
    58	function IncidentRow({
    59	  incident,
    60	  count,
    61	  collapsed,
    62	}: {
    63	  incident: OpsIncident;
    64	  count: number;
    65	  collapsed: boolean;
    66	}) {
    67	  const { t } = useLanguage();
    68	  const severityColor =
    69	    incident.severity === 'critical'
    70	      ? 'bg-error'
    71	      : incident.severity === 'warning'
    72	        ? 'bg-warning'
    73	        : 'bg-muted-ol';
    74
    75	  const displayTitle = incident.triggerType
    76	    ? humanizeEventType(incident.triggerType, t)
    77	    : incident.title;
    78
    79	  const titleWithCount = count > 1 ? `${displayTitle} (×${count})` : displayTitle;
    80
    81	  if (collapsed) {
    82	    return (
    83	      <div className="flex justify-center py-1">
    84	        <span
    85	          className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
    86	          title={titleWithCount}
    87	        />
    88	      </div>
    89	    );
    90	  }
    91
    92	  return (
    93	    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
    94	      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
    95	      <span className="text-xs font-body text-primary-ol truncate">{titleWithCount}</span>
    96	    </div>
    97	  );
    98	}
    99
   100	function ApprovalRow({ approval, collapsed }: { approval: ActionRun; collapsed: boolean }) {
   101	  const { t } = useLanguage();
   102	  const strategy = approval.recovery_strategy
   103	    ? t(`ops.recoveryStrategy.${approval.recovery_strategy}`)
   104	    : t('ops.recoveryStrategy.unknown');
   105	  const label = `${t('opsV2.rail.actionRequired')}: ${strategy}`;
   106
   107	  if (collapsed) {
   108	    return (
   109	      <div className="flex justify-center py-1">
   110	        <span className="h-2 w-2 rounded-full shrink-0 bg-warning" title={label} />
   111	      </div>
   112	    );
   113	  }
   114
   115	  return (
   116	    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
   117	      <span className="h-2 w-2 rounded-full shrink-0 mt-1 bg-warning" />
   118	      <span className="text-xs font-body text-primary-ol truncate" title={label}>
   119	        {label}
   120	      </span>
   121	    </div>
   122	  );
   123	}
   124
   125	function CircuitBreakerRow({
   126	  breaker,
   127	  index,
   128	  collapsed,
   129	}: {
   130	  breaker: CircuitBreakerWithProject;
   131	  index: number;
   132	  collapsed: boolean;
   133	}) {
   134	  const isOpen = breaker.state === 'open';
   135	  const isHalfOpen = breaker.state === 'half_open';
   136	  const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
   137	  const displayName = breaker.projectName || `CB #${index + 1}`;
   138	  const label = `${displayName}: ${breaker.state}`;
   139
   140	  if (collapsed) {
   141	    return (
   142	      <div className="flex justify-center py-1">
   143	        <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} title={label} />
   144	      </div>
   145	    );
   146	  }
   147
   148	  return (
   149	    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
   150	      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
   151	      <span className="text-xs font-body text-primary-ol truncate">{label}</span>
   152	    </div>
   153	  );
   154	}
   155
   156	export function LeftRail({
   157	  approvals,
   158	  incidents,
   159	  circuitBreakers,
   160	  onFilterChange,
   161	  forceCollapsed,
   162	}: LeftRailProps) {
   163	  const { t } = useLanguage();
   164
   165	  const [collapsed, setCollapsed] = useState<boolean>(() => {
   166	    try {
   167	      return localStorage.getItem(STORAGE_KEY) === 'true';
   168	    } catch {
   169	      return false;
   170	    }
   171	  });
   172
   173	  // forceCollapsed overrides local state (used for < lg breakpoint)
   174	  const effectivelyCollapsed = forceCollapsed ?? collapsed;
   175
   176	  const [activeFilter, setActiveFilter] = useState<string | null>(null);
   177
   178	  const toggle = useCallback(() => {
   179	    setCollapsed((prev) => {
   180	      const next = !prev;
   181	      try {
   182	        localStorage.setItem(STORAGE_KEY, String(next));
   183	      } catch {
   184	        // ignore storage errors
   185	      }
   186	      return next;
   187	    });
   188	  }, []);
   189
   190	  // Sync localStorage changes from other tabs
   191	  useEffect(() => {
   192	    const handler = (e: StorageEvent) => {
   193	      if (e.key === STORAGE_KEY && e.newValue !== null) {
   194	        setCollapsed(e.newValue === 'true');
   195	      }
   196	    };
   197	    window.addEventListener('storage', handler);
   198	    return () => window.removeEventListener('storage', handler);
   199	  }, []);
   200
   201	  const handleSectionClick = useCallback(
   202	    (type: string) => {
   203	      const next = activeFilter === type ? null : type;
   204	      setActiveFilter(next);
   205	      onFilterChange?.(next ? { type: next } : {});
   206	    },
   207	    [activeFilter, onFilterChange],
   208	  );
   209
   210	  const approvalItems = approvals;
   211	  const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');
   212
   213	  // Group incidents by humanized trigger type (or title) to deduplicate
   214	  const groupedIncidents = incidents.reduce<Array<{ incident: OpsIncident; count: number }>>(
   215	    (acc, incident) => {
   216	      const key = incident.triggerType ?? incident.title;
   217	      const existing = acc.find((g) => (g.incident.triggerType ?? g.incident.title) === key);
   218	      if (existing) {
   219	        existing.count += 1;
   220	      } else {
   221	        acc.push({ incident, count: 1 });
   222	      }
   223	      return acc;
   224	    },
   225	    [],
   226	  );
   227
   228	  return (
   229	    <aside
   230	      style={{
   231	        width: effectivelyCollapsed ? 48 : 320,
   232	        minWidth: effectivelyCollapsed ? 48 : 320,
   233	        transition: 'width 150ms ease, min-width 150ms ease',
   234	      }}
   235	      className={cn(
   236	        'relative flex flex-col h-full',
   237	        'bg-bg-panel border-r border-[hsl(var(--border))]',
   238	        'overflow-hidden',
   239	      )}
   240	    >
   241	      {/* Toggle button — hidden when forceCollapsed is active (breakpoint manages it) */}
   242	      {forceCollapsed === undefined && (
   243	        <div
   244	          className={cn(
   245	            'shrink-0 flex items-center border-b border-[hsl(var(--border))] px-2 py-2',
   246	            effectivelyCollapsed ? 'justify-center' : 'justify-end',
   247	          )}
   248	        >
   249	          <button
   250	            type="button"
   251	            onClick={toggle}
   252	            title={effectivelyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
   253	            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
   254	          >
   255	            {effectivelyCollapsed ? (
   256	              <ChevronRight className="h-4 w-4" />
   257	            ) : (
   258	              <ChevronLeft className="h-4 w-4" />
   259	            )}
   260	          </button>
   261	        </div>
   262	      )}
   263
   264	      <ScrollArea className="flex-1">
   265	        <div className={cn('p-2 space-y-4', effectivelyCollapsed && 'space-y-2')}>
   266	          {/* Approvals section */}
   267	          <div className="space-y-0.5">
   268	            <SectionHeader
   269	              icon={<CheckSquare className="h-4 w-4" />}
   270	              label={t('opsV2.rail.approvals')}
   271	              count={approvalItems.length}
   272	              collapsed={effectivelyCollapsed}
   273	              active={activeFilter === 'approval'}
   274	              onClick={() => handleSectionClick('approval')}
   275	            />
   276	            {!effectivelyCollapsed && approvalItems.length === 0 && (
   277	              <p className="px-2 py-1 text-xs text-muted-ol">
   278	                {t('opsV2.empty.noPendingApprovals')}
   279	              </p>
   280	            )}
   281	            {approvalItems.map((item) => (
   282	              <ApprovalRow key={item.id} approval={item} collapsed={effectivelyCollapsed} />
   283	            ))}
   284	          </div>
   285
   286	          {/* Active Issues section */}
   287	          <div className="space-y-0.5">
   288	            <SectionHeader
   289	              icon={<AlertCircle className="h-4 w-4" />}
   290	              label={t('opsV2.rail.activeIssues')}
   291	              count={incidents.length}
   292	              collapsed={effectivelyCollapsed}
   293	              active={activeFilter === 'incident'}
   294	              onClick={() => handleSectionClick('incident')}
   295	            />
   296	            {!effectivelyCollapsed && incidents.length === 0 && (
   297	              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
   298	            )}
   299	            {groupedIncidents.map(({ incident, count }) => (
   300	              <IncidentRow
   301	                key={incident.triggerType ?? incident.id}
   302	                incident={incident}
   303	                count={count}
   304	                collapsed={effectivelyCollapsed}
   305	              />
   306	            ))}
   307	          </div>
   308
   309	          {/* Circuit Breaker Status section */}
   310	          <div className="space-y-0.5">
   311	            <SectionHeader
   312	              icon={<ShieldAlert className="h-4 w-4" />}
   313	              label={t('opsV2.rail.circuitBreakerStatus')}
   314	              count={openBreakers.length}
   315	              collapsed={effectivelyCollapsed}
   316	              active={activeFilter === 'circuit_breaker'}
   317	              onClick={() => handleSectionClick('circuit_breaker')}
   318	            />
   319	            {!effectivelyCollapsed && openBreakers.length === 0 && (
   320	              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.allSystemsNormal')}</p>
   321	            )}
   322	            {openBreakers.map((cb, i) => (
   323	              <CircuitBreakerRow
   324	                key={cb.projectId}
   325	                breaker={cb}
   326	                index={i}
   327	                collapsed={effectivelyCollapsed}
   328	              />
   329	            ))}
   330	          </div>
   331	        </div>
   332	      </ScrollArea>
   333	    </aside>
   334	  );
   335	}

 succeeded in 0ms:
     1	import ReactMarkdown from 'react-markdown';
     2	import remarkGfm from 'remark-gfm';
     3	import { memo, useMemo, useState, useCallback } from 'react';
     4	import { ChevronRight, ChevronDown, Clock, AlertCircle, FileText } from 'lucide-react';
     5	import { cn } from '../../../lib/utils.js';
     6	import { useLanguage } from '../../../i18n/context.js';
     7	import type { ActivityItem } from '../../../lib/api/operations.js';
     8	import { SeverityBadge } from '../SeverityBadge.js';
     9	import { relativeTime, humanizeEventType } from '../utils.js';
    10	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
    11	import { ThreadApprovalActions } from './ThreadApprovalActions.js';
    12
    13	// ---------------------------------------------------------------------------
    14	// Constants
    15	// ---------------------------------------------------------------------------
    16
    17	const THREADS_PAGE_SIZE = 40;
    18	const EVENTS_PAGE_SIZE = 20;
    19
    20	// ---------------------------------------------------------------------------
    21	// Title localisation helper
    22	// ---------------------------------------------------------------------------
    23
    24	const TITLE_PATTERNS: [RegExp, string][] = [
    25	  [/^Auto-recovery running$/i, 'opsV2.titles.autoRecoveryRunning'],
    26	  [/^Auto-recovery failed$/i, 'opsV2.titles.autoRecoveryFailed'],
    27	  [/^Auto-recovery completed$/i, 'opsV2.titles.autoRecoveryCompleted'],
    28	  [/^Incident detected$/i, 'opsV2.titles.incidentDetected'],
    29	  [/^Health check failed/i, 'opsV2.titles.healthCheckFailed'],
    30	  [/^deploy:crash$/i, 'opsV2.titles.deployCrash'],
    31	  [/^deploy:failed$/i, 'opsV2.titles.deployFailed'],
    32	  [/^deploy:/i, 'opsV2.titles.deployFailed'],
    33	];
    34
    35	function localizeTitle(title: string, t: (key: string) => string): string {
    36	  for (const [pattern, key] of TITLE_PATTERNS) {
    37	    if (pattern.test(title)) {
    38	      return t(key);
    39	    }
    40	  }
    41	  return title;
    42	}
    43
    44	// ---------------------------------------------------------------------------
    45	// Types
    46	// ---------------------------------------------------------------------------
    47
    48	export interface Thread {
    49	  correlationId: string;
    50	  projectId: string;
    51	  projectName: string;
    52	  severity: string;
    53	  status: string;
    54	  hasPendingApproval: boolean;
    55	  lastEventTime: string;
    56	  eventCount: number;
    57	  events: ActivityItem[];
    58	  isExpanded: boolean;
    59	  triggerType?: string;
    60	  title?: string;
    61	}
    62
    63	export interface MainFeedGridProps {
    64	  activities: ActivityItem[];
    65	  onThreadSelect?: (correlationId: string) => void;
    66	}
    67
    68	// ---------------------------------------------------------------------------
    69	// Grouping logic
    70	// ---------------------------------------------------------------------------
    71
    72	function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {
    73	  const threadMap = new Map<string, ActivityItem[]>();
    74	  const orderKeys: string[] = [];
    75
    76	  for (const item of items) {
    77	    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    78	    const key = item.correlationId || `${item.projectId}::${tsBucket}`;
    79
    80	    const existing = threadMap.get(key);
    81	    if (existing) {
    82	      existing.push(item);
    83	    } else {
    84	      threadMap.set(key, [item]);
    85	      orderKeys.push(key);
    86	    }
    87	  }
    88
    89	  const threads: Omit<Thread, 'isExpanded'>[] = [];
    90
    91	  for (const key of orderKeys) {
    92	    const events = threadMap.get(key)!;
    93	    // Sort events within thread: newest first
    94	    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    95
    96	    const head = events[0];
    97	    const hasPendingApproval = events.some((e) => e.type === 'approval' && e.status === 'pending');
    98
    99	    // Severity: pick the most severe across all events in the thread
   100	    const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
   101	    let maxSeverity = head.severity;
   102	    for (const e of events) {
   103	      if ((severityRank[e.severity] ?? 0) > (severityRank[maxSeverity] ?? 0)) {
   104	        maxSeverity = e.severity;
   105	      }
   106	    }
   107
   108	    // Try to find a meaningful title
   109	    const activeIncident = events.find((e) => e.type === 'incident');
   110	    const title = activeIncident?.title || head.title || humanizeEventType(head.type, (k) => k);
   111	    const triggerType = activeIncident?.triggerType;
   112
   113	    threads.push({
   114	      correlationId: key,
   115	      projectId: head.projectId,
   116	      projectName: head.projectName,
   117	      severity: maxSeverity,
   118	      status: head.status,
   119	      hasPendingApproval,
   120	      lastEventTime: head.timestamp,
   121	      eventCount: events.length,
   122	      events,
   123	      title,
   124	      triggerType,
   125	    });
   126	  }
   127
   128	  // Sort threads: newest first by most recent event
   129	  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());
   130
   131	  return threads;
   132	}
   133
   134	// ---------------------------------------------------------------------------
   135	// Layout Grid Definitions
   136	// ---------------------------------------------------------------------------
   137	// Density approach: standard table rows using CSS grid.
   138	const ROW_GRID_CLASSES =
   139	  'grid grid-cols-[24px_minmax(140px,1.8fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';
   140
   141	// ---------------------------------------------------------------------------
   142	// Sub-components
   143	// ---------------------------------------------------------------------------
   144
   145	const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event: ActivityItem }) {
   146	  const { t, language } = useLanguage();
   147	  const [detailsOpen, setDetailsOpen] = useState(false);
   148
   149	  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
   150	  const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;
   151
   152	  const rawTitle =
   153	    event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
   154	  const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);
   155
   156	  return (
   157	    <div className="flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors">
   158	      <div className={cn(ROW_GRID_CLASSES, 'py-1.5 text-[11px]')}>
   159	        {/* Empty left gap for alignment with parent chevron */}
   160	        <div className="flex justify-end">
   161	          <div
   162	            className={cn('h-1.5 w-1.5 rounded-full mr-2', isAiEvent ? 'bg-agent' : 'bg-muted-ol')}
   163	          />
   164	        </div>
   165
   166	        {/* Time */}
   167	        <div className="text-muted-ol whitespace-nowrap">
   168	          {new Date(event.timestamp).toLocaleTimeString(language, {
   169	            hour12: false,
   170	            hour: '2-digit',
   171	            minute: '2-digit',
   172	            second: '2-digit',
   173	          })}
   174	        </div>
   175
   176	        {/* Event Name & Expand Toggle */}
   177	        <div className="flex items-center gap-2 min-w-0">
   178	          <span
   179	            className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
   180	            title={titleText}
   181	          >
   182	            {titleText}
   183	          </span>
   184	          {hasDetails && (
   185	            <button
   186	              type="button"
   187	              onClick={(e) => {
   188	                e.stopPropagation();
   189	                setDetailsOpen(!detailsOpen);
   190	              }}
   191	              className="shrink-0 inline-flex items-center gap-1 bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] rounded px-1.5 py-0.5 text-[9px] text-muted-ol font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-agent"
   192	            >
   193	              <FileText className="w-3 h-3" />
   194	              {detailsOpen ? t('opsV2.timeline.detailsHide') : t('opsV2.timeline.detailsShow')}
   195	            </button>
   196	          )}
   197	        </div>
   198
   199	        {/* Severity */}
   200	        <div>
   201	          <SeverityBadge severity={event.severity} />
   202	        </div>
   203
   204	        {/* Status */}
   205	        <div className="truncate text-muted-ol">{t(`opsV2.status.${event.status}`)}</div>
   206
   207	        {/* Actions empty cell */}
   208	        <div />
   209
   210	        {/* Metadata */}
   211	        <div className="text-muted-ol text-[10px] truncate">
   212	          {event.aiMetadata?.model && <span>{event.aiMetadata.model} </span>}
   213	          {event.aiMetadata?.durationMs && (
   214	            <span>({(event.aiMetadata.durationMs / 1000).toFixed(1)}s)</span>
   215	          )}
   216	        </div>
   217	      </div>
   218
   219	      {/* Inline Details Expansion */}
   220	      {detailsOpen && hasDetails && (

exec
/bin/bash -lc "sed -n '540,620p' web/src/i18n/en.ts && printf '\\n---KO---\\n' && sed -n '540,620p' web/src/i18n/ko.ts" in /home/lee/OpenLander
 succeeded in 0ms:
      apply_fixes: 'Apply automated fixes',
      apply_fixes_impact: 'Resource rollout & modifications',
    },
  },
  opsV2: {
    page: {
      title: 'Operations Center',
      description: 'Unified timeline of all system events, active issues, and pending actions.',
    },
    statusStrip: {
      healthState: 'System Health',
      incidentCount: '{count} active issues',
      approvalCount: '{count} pending approvals',
      circuitBreakerCount: '{count} circuit breakers open',
      agentStatus: 'Agent Status',
      healthy: 'Healthy',
      degraded: 'Degraded',
      critical: 'Critical',
      unknown: 'Unknown',
    },
    rail: {
      approvals: 'Approvals',
      activeIssues: 'Active Issues',
      circuitBreakerStatus: 'Circuit Breakers',
      actionRequired: 'Action required',
      drawerLabel: 'Navigation',
    },
    timeline: {
      threadTitle: '{project} — {type}',
      eventCount: '{count} events',
      expand: 'Expand thread',
      collapse: 'Collapse thread',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      detailsShow: 'Details',
      detailsHide: 'Hide details',
      eventLog: 'Event Log',
      columns: {
        projectTarget: 'Project Target',
        detectedEvent: 'Detected Event',
        severity: 'Severity',
        state: 'State',
        eventCount: 'Events',
        latest: 'Latest',
      },
      showOlderEvents: 'Show older events',
      showMore: 'Show {count} more',
    },
    status: {
      active: 'Active',
      resolved: 'Resolved',
      failed: 'Failed',
      pending: 'Pending',
      recovering: 'Recovering',
      'ai-running': 'AI Running',
      'ai-completed': 'AI Completed',
      'recovery-blocked': 'Recovery Blocked',
      'recovery-stopped': 'Recovery Stopped',
    },
    filters: {
      density: {
        label: 'Density',
        all: 'All',
        actionsOnly: 'Actions only',
        criticalOnly: 'Critical only',
      },
      severity: 'Severity',
      project: 'Project',
      timeRange: 'Time range',
    },
    empty: {
      noActivity: 'No recent activity',
      noActiveIssues: 'No active issues',
      noPendingApprovals: 'No pending approvals',
      allSystemsNormal: 'All systems normal',
    },
    error: {
      loadFailed: 'Failed to load operations data',
      retry: 'Retry',
    },
    approvals: {

---KO---
  },
  opsV2: {
    page: {
      title: '운영 센터',
      description: '모든 시스템 이벤트, 활성 문제, 대기 중인 작업의 통합 타임라인입니다.',
    },
    statusStrip: {
      healthState: '시스템 상태',
      incidentCount: '{count}개 활성 문제',
      approvalCount: '{count}개 승인 대기',
      circuitBreakerCount: '{count}개 서킷 브레이커 개방',
      agentStatus: '에이전트 상태',
      healthy: '정상',
      degraded: '불안정',
      critical: '위험',
      unknown: '알 수 없음',
    },
    rail: {
      approvals: '승인 목록',
      activeIssues: '현재 문제',
      circuitBreakerStatus: '서킷 브레이커',
      actionRequired: '작업 필요',
      drawerLabel: '내비게이션',
    },
    timeline: {
      threadTitle: '{project} — {type}',
      eventCount: '{count}개 이벤트',
      expand: '스레드 펼치기',
      collapse: '스레드 접기',
      expandAll: '모두 펼치기',
      collapseAll: '모두 접기',
      detailsShow: '세부 정보',
      detailsHide: '세부 정보 숨기기',
      eventLog: '이벤트 로그',
      columns: {
        projectTarget: '프로젝트 대상',
        detectedEvent: '감지 이벤트',
        severity: '심각도',
        state: '상태',
        eventCount: '건수',
        latest: '최근 시각',
      },
      showOlderEvents: '이전 이벤트 보기',
      showMore: '{count}개 더 보기',
    },
    status: {
      active: '활성',
      resolved: '해결됨',
      failed: '실패',
      pending: '대기 중',
      recovering: '복구 중',
      'ai-running': 'AI 실행 중',
      'ai-completed': 'AI 완료',
      'recovery-blocked': '복구 차단됨',
      'recovery-stopped': '복구 중지됨',
    },
    filters: {
      density: {
        label: '표시 밀도',
        all: '전체',
        actionsOnly: '액션만',
        criticalOnly: '위험만',
      },
      severity: '심각도',
      project: '프로젝트',
      timeRange: '시간 범위',
    },
    empty: {
      noActivity: '최근 활동이 없습니다',
      noActiveIssues: '활성 문제가 없습니다',
      noPendingApprovals: '대기 중인 승인이 없습니다',
      allSystemsNormal: '모든 시스템 정상',
    },
    error: {
      loadFailed: '운영 데이터를 불러오지 못했습니다',
      retry: '다시 시도',
    },
    approvals: {
      approve: '승인',
      reject: '거부',
      submitting: '제출 중...',

exec
/bin/bash -lc 'rg -n "opsV2:|titles:" web/src/i18n/en.ts web/src/i18n/ko.ts' in /home/lee/OpenLander
 succeeded in 0ms:
web/src/i18n/ko.ts:541:  opsV2: {
web/src/i18n/ko.ts:659:    titles: {
web/src/i18n/en.ts:544:  opsV2: {
web/src/i18n/en.ts:663:    titles: {

exec
/bin/bash -lc "sed -n '620,760p' web/src/i18n/en.ts && printf '\\n---KO---\\n' && sed -n '620,760p' web/src/i18n/ko.ts" in /home/lee/OpenLander
 succeeded in 0ms:
    approvals: {
      approve: 'Approve',
      reject: 'Reject',
      submitting: 'Submitting...',
      timedOut: 'Approval timed out',
      confirmTitle: 'Confirm destructive action',
      confirmDescription:
        'This action ({action}) is destructive and cannot be easily undone. Are you sure you want to proceed?',
      confirmApprove: 'Yes, approve',
      confirmCancel: 'Cancel',
      approved: 'Approved',
      rejected: 'Rejected',
      error: 'Failed to submit decision',
    },
    connection: {
      connected: 'Live',
      disconnected: 'Disconnected',
      reconnecting: 'Reconnecting...',
    },
    widgets: {
      incidents: {
        title: 'Active Issues',
        bySeverity: 'By Severity',
        critical: 'Critical',
        warning: 'Warning',
        info: 'Info',
        empty: 'No active issues',
      },
      approvals: {
        title: 'Pending Approvals',
        pending: '{count} pending',
        urgent: 'Urgent',
        empty: 'No pending approvals',
      },
      circuitBreakers: {
        title: 'Circuit Breakers',
        showMore: 'Show {count} more',
        empty: 'All systems normal',
        open: 'Open',
        halfOpen: 'Half-open',
        closed: 'Closed',
      },
    },
    titles: {
      autoRecoveryRunning: 'Auto-recovery running',
      autoRecoveryFailed: 'Auto-recovery failed',
      autoRecoveryCompleted: 'Auto-recovery completed',
      incidentDetected: 'Incident detected',
      healthCheckFailed: 'Health check failed',
      deployFailed: 'Deploy failed',
      deployCrash: 'Deploy crash',
    },
  },
  ops: {
    ai: {
      invoked: 'AI Invoked',
      completed: 'AI Completed',
    },
    recovery: {
      blocked: 'Recovery Blocked',
      stopped: 'Recovery Stopped',
      started: 'Recovery Started',
    },
    status: {
      healthy: 'Healthy',
      healthyDesc: 'No active issues. Auto-recovery is enabled.',
      degraded: 'Unstable',
      degradedDesc: 'Recovery in progress. Service may be temporarily unstable.',
      broken: 'Down',
      brokenDesc: 'Service is unavailable. Recovery attempts are in progress.',
      blocked: 'Recovery Stopped',
      blockedDesc: 'Auto-recovery stopped after repeated failures. Manual action required.',
      attention: 'Needs Attention',
      attentionDesc: 'Latest deploy failed. A redeploy or fix is needed.',
    },
    issueCount: '{count} issues',
    retryRecovery: 'Retry Recovery',
    autoRecovery: 'Auto-recovery',
    featureNotReady: 'This feature is currently under development.',
    recoveryStatus: 'Recovery Status',
    acknowledge: 'Mark as Seen',
    occurrences: '{count} occurrences',
    latestTimeline: 'Recent Event History',
    connected: 'Live',
    disconnected: 'Disconnected',
    first: 'First',
    last: 'Last',
    viewTimeline: 'View Timeline',
    eventCount: 'events',
    lastFailure: 'Last failure',
    agent: {
      idle: 'Agent Idle',
      idleDesc: 'Standing by for auto-recovery or manual commands.',
      online: 'ONLINE',
      activeOn: 'Agent Active on',
      system: 'System',
      working: 'Working',
      analyzing: 'Analyzing system context...',
      elapsed: 'Elapsed',
      thoughtProcess: 'Thought Process',
    },
    recoveryStrategy: {
      llm: 'LLM diagnosis-based',
      memory: 'Past memory-based',
      recipe: 'Defined recipe rule',
      unknown: 'Unknown strategy',
    },
    diagnosisSummary: 'Diagnosis: {summary}',
    aiDiagnosisSummary: '🤖 AI Diagnosis Summary',
    recentSameEvents: 'Recent same events ({count})',
    moreMergedLogs: 'and {count} more merged logs',
    openIssues: 'Open Issues',
    noiseSuppressed: 'Noise Suppressed',
    repeatedIncidentsGrouped: 'repeated incidents grouped',
    zeroRepeatedIncidents: '0 repeated incidents',
    recoveryStatusLabel: 'Recovery Status',
    lastAlert: 'Last Alert',
    noAlertsConfigured: 'No alerts configured',
    allClear: 'All clear',
    noActiveIssuesDetected: 'No active issues detected.',
    noRuntimeIncidents: 'No runtime incidents',
    deploymentFailedEarlier: 'Deployment failed earlier. Check Deployments tab.',
    blocked: 'Blocked',
    waitingForRedeploy: 'Waiting for redeploy',
    retrying: 'Retrying',
    disabled: 'Disabled',
    idle: 'Idle',
  },
  services: {
    title: 'Services',
    createService: 'Create Service',
    subtitle:
      'Run Docker images as shared infrastructure. Multiple projects can connect to these services.',
    noServices: 'No services running',
    getStarted: 'Create a service from a template or run any Docker image.',
    templates: 'Quick Start Templates',
    customImage: 'Custom Docker Image',
    imagePlaceholder: 'ghcr.io/berriai/litellm:latest',
    orCustom: 'Or run any Docker image:',
    createdAgo: '{time} ago',
    updatedAgo: 'Updated {time} ago',

---KO---
      submitting: '제출 중...',
      timedOut: '승인 시간 초과',
      confirmTitle: '위험한 작업 확인',
      confirmDescription: '이 작업({action})은 위험하며 쉽게 되돌릴 수 없습니다. 계속하시겠습니까?',
      confirmApprove: '네, 승인합니다',
      confirmCancel: '취소',
      approved: '승인됨',
      rejected: '거부됨',
      error: '결정을 제출하지 못했습니다',
    },
    connection: {
      connected: '실시간',
      disconnected: '연결 끊김',
      reconnecting: '재연결 중...',
    },
    widgets: {
      incidents: {
        title: '활성 문제',
        bySeverity: '심각도별',
        critical: '위험',
        warning: '경고',
        info: '정보',
        empty: '활성 문제 없음',
      },
      approvals: {
        title: '승인 대기',
        pending: '{count}개 대기 중',
        urgent: '긴급',
        empty: '대기 중인 승인 없음',
      },
      circuitBreakers: {
        title: '서킷 브레이커',
        showMore: '{count}개 더 보기',
        empty: '모든 시스템 정상',
        open: '개방',
        halfOpen: '반개방',
        closed: '정상',
      },
    },
    titles: {
      autoRecoveryRunning: '자동 복구 실행 중',
      autoRecoveryFailed: '자동 복구 실패',
      autoRecoveryCompleted: '자동 복구 완료',
      incidentDetected: '장애 감지',
      healthCheckFailed: '상태 검사 실패',
      deployFailed: '배포 실패',
      deployCrash: '배포 크래시',
    },
  },
  ops: {
    ai: {
      invoked: 'AI 호출 시작',
      completed: 'AI 호출 완료',
    },
    recovery: {
      blocked: '복구 차단됨',
      stopped: '복구 중지됨',
      started: '복구 시작됨',
    },
    status: {
      healthy: '정상',
      healthyDesc: '활성 장애가 없습니다. 자동 복구가 활성화되어 있습니다.',
      degraded: '불안정',
      degradedDesc: '복구를 시도하고 있습니다. 서비스가 일시적으로 불안정할 수 있습니다.',
      broken: '장애 발생',
      brokenDesc: '서비스를 사용할 수 없습니다. 복구를 시도하고 있습니다.',
      blocked: '복구 중단',
      blockedDesc: '반복된 실패로 자동 복구가 중단되었습니다. 직접 조치가 필요합니다.',
      attention: '확인 필요',
      attentionDesc: '최근 배포가 실패했습니다. 재배포 또는 수정이 필요합니다.',
    },
    issueCount: '{count}개 문제',
    retryRecovery: '복구 재시도',
    autoRecovery: '자동 복구',
    featureNotReady: '이 기능은 현재 개발 중입니다.',
    recoveryStatus: '자동 복구 현황',
    acknowledge: '확인 완료',
    occurrences: '{count}회 발생',
    latestTimeline: '최근 발생 이력',
    connected: '실시간',
    disconnected: '연결 끊김',
    first: '처음',
    last: '마지막',
    viewTimeline: '타임라인 보기',
    eventCount: '건',
    lastFailure: '마지막 실패',
    agent: {
      idle: '에이전트 대기 중',
      idleDesc: '자동 복구 또는 수동 명령을 대기하고 있습니다.',
      online: '온라인',
      activeOn: '에이전트 활동 중:',
      system: '시스템',
      working: '작업 중',
      analyzing: '시스템 상태 분석 중...',
      elapsed: '경과 시간',
      thoughtProcess: '사고 과정',
    },
    recoveryStrategy: {
      llm: 'LLM 진단 기반',
      memory: '과거 기억 기반',
      recipe: '정의된 레시피 규칙',
      unknown: '알 수 없는 전략',
    },
    diagnosisSummary: '진단 요약: {summary}',
    aiDiagnosisSummary: '🤖 AI 진단 요약',
    recentSameEvents: '최근 동일 이벤트 ({count}건)',
    moreMergedLogs: '외 {count}건의 병합된 로그',
    openIssues: '진행 중인 문제',
    noiseSuppressed: '노이즈 억제됨',
    repeatedIncidentsGrouped: '건의 반복된 문제가 병합됨',
    zeroRepeatedIncidents: '반복된 문제 없음',
    recoveryStatusLabel: '자동복구 상태',
    lastAlert: '최근 알림',
    noAlertsConfigured: '알림 미설정',
    allClear: '문제가 없습니다',
    noActiveIssuesDetected: '모든 시스템이 정상적으로 동작 중입니다.',
    noRuntimeIncidents: '런타임 문제 없음',
    deploymentFailedEarlier: '마지막 배포가 실패했습니다. 배포 탭을 확인하세요.',
    blocked: '차단됨',
    waitingForRedeploy: '재배포 대기 중',
    retrying: '재시도 중',
    disabled: '비활성화됨',
    idle: '대기 중',
  },
  services: {
    title: '서비스',
    createService: '서비스 생성',
    subtitle:
      'Docker 이미지를 공유 인프라로 실행합니다. 여러 프로젝트가 이 서비스에 연결할 수 있습니다.',
    noServices: '실행 중인 서비스 없음',
    getStarted: '템플릿에서 서비스를 생성하거나 Docker 이미지를 직접 실행하세요.',
    templates: '빠른 시작 템플릿',
    customImage: '커스텀 Docker 이미지',
    imagePlaceholder: 'ghcr.io/berriai/litellm:latest',
    orCustom: '또는 Docker 이미지를 직접 실행:',
    createdAgo: '{time} 전',
    updatedAgo: '{time} 전에 업데이트',
    metrics: {
      health: 'Health',
      uptime: 'Uptime',
      restarts: 'Restarts',

exec
/bin/bash -lc "sed -n '1,240p' src/monitor/ops-incidents.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import type { AppContext } from '../app.js';
import type { OpsIncidentRow, OpsIncidentEventRow } from '../db/types.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ops-incidents');
const INCIDENT_FINGERPRINT_WINDOW_MS = 30 * 60 * 1000;

export interface IncidentWithTimeline {
  incident: OpsIncidentRow;
  events: OpsIncidentEventRow[];
}

export class IncidentManager {
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /** Create a new incident for a project (or return existing active one — deduplication). */
  openIncident(projectId: string, trigger: { type: string; details?: string }): OpsIncidentRow {
    const existing = this.ctx.db.getActiveOpsIncident(projectId);
    const triggerSummary = this.describeTrigger(trigger);
    const triggerFingerprint = this.generateFingerprint(triggerSummary);

    if (existing) {
      const existingFingerprint = this.generateFingerprint(existing.root_cause ?? '');
      const incidentAgeMs = Date.now() - existing.created_at;

      if (
        existingFingerprint.length > 0 &&
        existingFingerprint === triggerFingerprint &&
        incidentAgeMs <= INCIDENT_FINGERPRINT_WINDOW_MS
      ) {
        this.addEvent(existing.id, 'detected', `Recurring event: ${triggerSummary}`);
        return existing;
      }

      this.addEvent(
        existing.id,
        'cascade_detected',
        `New error pattern detected: ${triggerSummary}`,
        {
          existing_fingerprint: existingFingerprint || null,
          new_fingerprint: triggerFingerprint,
          window_ms: INCIDENT_FINGERPRINT_WINDOW_MS,
        },
      );
      return existing;
    }

    const id = this.generateIncidentId();
    const severity = this.inferSeverity(trigger.type);
    const incident = this.ctx.db.createOpsIncident({
      id,
      project_id: projectId,
      severity,
      status: 'open',
      root_cause: triggerSummary,
    });

    this.addEvent(
      incident.id,
      'detected',
      `Incident detected: ${trigger.type}${trigger.details ? ` — ${trigger.details}` : ''}`,
      {
        trigger_type: trigger.type,
        trigger_details: trigger.details,
      },
    );

    // Cascade detection: find dependent projects
    try {
      const dependents = this.ctx.db.findProjectDependents(projectId, undefined);
      if (dependents.length > 0) {
        const affectedProjectIds = dependents.map((d) => d.source_project_id);
        this.addEvent(
          incident.id,
          'cascade_detected',
          `${String(dependents.length)} dependent project(s) may be affected`,
          { affected_project_ids: affectedProjectIds },
        );
      }
    } catch {
      // cascade detection is best-effort
    }

    log.info({ incidentId: incident.id, projectId, triggerType: trigger.type }, 'Incident opened');
    return incident;
  }

  addEvent(
    incidentId: string,
    eventType: OpsIncidentEventRow['event_type'],
    description: string,
    metadata?: Record<string, unknown>,
  ): void {
    const id = `evt-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
    this.ctx.db.addOpsIncidentEvent({
      id,
      incident_id: incidentId,
      event_type: eventType,
      description,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
  }

  resolveIncident(incidentId: string, resolution?: string): void {
    this.ctx.db.updateOpsIncidentStatus(incidentId, 'resolved', { resolved_at: Date.now() });
    this.addEvent(incidentId, 'recovered', resolution ?? 'Incident resolved');
    log.info({ incidentId }, 'Incident resolved');
  }

  escalateIncident(incidentId: string, reason: string): void {
    this.ctx.db.updateOpsIncidentStatus(incidentId, 'escalated', { escalated_at: Date.now() });
    this.addEvent(incidentId, 'escalated', reason);
    log.warn({ incidentId, reason }, 'Incident escalated');
  }

  getActiveIncident(projectId: string): OpsIncidentRow | null {
    return this.ctx.db.getActiveOpsIncident(projectId) ?? null;
  }

  getIncidentWithTimeline(incidentId: string): IncidentWithTimeline | null {
    const incident = this.ctx.db.getOpsIncident(incidentId);
    if (!incident) return null;
    const events = this.ctx.db.listOpsIncidentEvents(incidentId);
    return { incident, events };
  }

  private generateIncidentId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).slice(2, 7);
    return `inc-${date}-${random}`;
  }

  private inferSeverity(triggerType: string): 'critical' | 'warning' | 'info' {
    if (
      triggerType.includes('crash') ||
      triggerType.includes('missing') ||
      triggerType.includes('exhausted')
    ) {
      return 'critical';
    }
    if (
      triggerType.includes('fail') ||
      triggerType.includes('degrad') ||
      triggerType.includes('inactive')
    ) {
      return 'warning';
    }
    return 'info';
  }

  private describeTrigger(trigger: { type: string; details?: string }): string {
    return `${trigger.type}${trigger.details ? ` — ${trigger.details}` : ''}`;
  }

  private generateFingerprint(errorMessage: string): string {
    return errorMessage
      .replace(/[0-9a-f]{8,}/gi, '<id>')
      .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}[^\s]*/gi, '<ts>')
      .replace(/:\d{4,5}/g, ':<port>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 200);
  }
}

exec
/bin/bash -lc "sed -n '240,420p' src/monitor/ops-incidents.ts" in /home/lee/OpenLander
 succeeded in 0ms:
exec
/bin/bash -lc "rg -n \"trigger:|triggerType:|type: 'deploy:crash'|type: 'deploy:failed'|type: 'container:|type: 'health:\" src/monitor src/web/api -g '*.ts'" in /home/lee/OpenLander
 succeeded in 0ms:
src/web/api/ops-routes.ts:89:        triggerType: metadata.trigger_type,
src/web/api/ops-routes.ts:105:    triggerType: trigger.triggerType,
src/web/api/ops-routes.ts:437:              triggerType: trigger.triggerType,
src/web/api/deploy-failure-handler.ts:29:  trigger: string;
src/web/api/deploy-failure-handler.ts:57:    trigger: deps.trigger,
src/monitor/ops-agent.ts:57:      this.enqueue({ type: 'deploy:crash', payload, timestamp: Date.now() });
src/web/api/deploy-stream-routes.ts:83:          trigger: 'api',
src/web/api/deploy-stream-routes.ts:95:          trigger: 'api',
src/web/api/deploy-stream-routes.ts:207:        trigger: 'api',
src/web/api/deploy-stream-routes.ts:272:      trigger: 'api',
src/monitor/recovery-coordinator.ts:247:          type: 'deploy:crash',
src/monitor/recovery-coordinator.ts:265:        trigger: 'health:degraded',
src/monitor/recovery-coordinator.ts:277:    trigger: 'container:die' | 'container:oom' | 'container:missing',
src/monitor/recovery-coordinator.ts:301:          type: 'deploy:crash',
src/monitor/ops-incidents.ts:21:  openIncident(projectId: string, trigger: { type: string; details?: string }): OpsIncidentRow {
src/monitor/ops-incidents.ts:88:    log.info({ incidentId: incident.id, projectId, triggerType: trigger.type }, 'Incident opened');
src/monitor/ops-incidents.ts:138:  private inferSeverity(triggerType: string): 'critical' | 'warning' | 'info' {
src/monitor/ops-incidents.ts:156:  private describeTrigger(trigger: { type: string; details?: string }): string {
src/web/api/project-routes.ts:643:        trigger: log.trigger,
src/web/api/project-routes.ts:667:      trigger: log.trigger,

exec
/bin/bash -lc "sed -n '200,320p' web/src/hooks/use-ops-center-data.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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
        // Track last event id (ULID) for SSE gap recovery
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
/bin/bash -lc "nl -ba src/monitor/activity-event-mapper.ts | sed -n '260,380p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba web/src/components/ops/IncidentMap.tsx | sed -n '45,95p'" in /home/lee/OpenLander
 succeeded in 0ms:
    45	    }
    46	  }
    47
    48	  return true;
    49	}
    50
    51	function groupIncidents(
    52	  incidents: OpsIncident[],
    53	  projectNameById: Record<string, string>,
    54	  t: (key: string) => string,
    55	): GroupedIncident[] {
    56	  const grouped = new Map<string, OpsIncident[]>();
    57
    58	  for (const incident of incidents) {
    59	    if (!projectNameById[incident.project_id]) continue; // Skip archived projects
    60	    const typeKey =
    61	      incident.triggerType ||
    62	      (incident.title || incident.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    63	    const key = `${incident.project_id}::${incident.severity}::${typeKey}`;
    64	    if (!grouped.has(key)) {
    65	      grouped.set(key, []);
    66	    }
    67	    grouped.get(key)?.push(incident);
    68	  }
    69
    70	  return Array.from(grouped.entries())
    71	    .map(([key, entries]) => {
    72	      const latest = entries[0];
    73	      const projectId = latest.project_id;
    74	      const typeKey =
    75	        latest.triggerType ||
    76	        (latest.title || latest.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    77	      return {
    78	        projectId,
    79	        projectName: projectNameById[projectId] ?? projectId.substring(0, 8),
    80	        group: {
    81	          key,
    82	          severity: latest.severity,
    83	          label: humanizeEventType(typeKey, t),
    84	          description: humanizeDescription(latest, t),
    85	          count: entries.length,
    86	          firstSeen: Math.min(...entries.map((item) => new Date(item.created_at).getTime())),
    87	          lastSeen: Math.max(...entries.map((item) => new Date(item.created_at).getTime())),
    88	          latestIncident: latest,
    89	          status: latest.status,
    90	        },
    91	      } satisfies GroupedIncident;
    92	    })
    93	    .sort((a, b) => {
    94	      const aRank = SEVERITY_RANK[a.group.severity] ?? 99;
    95	      const bRank = SEVERITY_RANK[b.group.severity] ?? 99;

 succeeded in 0ms:
   260	  if (eventType === 'deploy:failed') {
   261	    const deployPayload = payload as EventPayload['deploy:failed'];
   262	    return {
   263	      title: `Deploy failed (${deployPayload.step})`,
   264	      description: deployPayload.error,
   265	    };
   266	  }
   267	  if (eventType === 'deploy:crash') {
   268	    const crashPayload = payload as EventPayload['deploy:crash'];
   269	    return {
   270	      title: 'Deploy crashed',
   271	      description:
   272	        crashPayload.error ??
   273	        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
   274	    };
   275	  }
   276	  if (eventType === 'compose:failed') {
   277	    return {
   278	      title: 'Compose failed',
   279	      description: (payload as EventPayload['compose:failed']).error,
   280	    };
   281	  }
   282	  if (eventType === 'container:die') {
   283	    const diePayload = payload as EventPayload['container:die'];
   284	    return {
   285	      title: 'Container exited',
   286	      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
   287	    };
   288	  }
   289	  if (eventType === 'container:oom') {
   290	    const oomPayload = payload as EventPayload['container:oom'];
   291	    return {
   292	      title: 'Container out of memory',
   293	      description: oomPayload.containerName,
   294	    };
   295	  }
   296	  if (eventType === 'container:missing') {
   297	    const missingPayload = payload as EventPayload['container:missing'];
   298	    return {
   299	      title: 'Container missing',
   300	      description: missingPayload.suggestion,
   301	    };
   302	  }
   303	  if (eventType === 'monitor:inactive') {
   304	    const monitorPayload = payload as EventPayload['monitor:inactive'];
   305	    return {
   306	      title: 'Project inactive',
   307	      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
   308	    };
   309	  }
   310	  if (eventType === 'health:degraded') {
   311	    const degradedPayload = payload as EventPayload['health:degraded'];
   312	    return {
   313	      title: 'Health degraded',
   314	      description:
   315	        degradedPayload.lastError ??
   316	        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
   317	    };
   318	  }
   319	  if (eventType === 'recovery:start') {
   320	    const recoveryPayload = payload as EventPayload['recovery:start'];
   321	    return {
   322	      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
   323	      description: recoveryPayload.error,
   324	    };
   325	  }
   326	  if (eventType === 'recovery:success') {
   327	    const recoveryPayload = payload as EventPayload['recovery:success'];
   328	    return {
   329	      title: 'Auto-recovery succeeded',
   330	      description:
   331	        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
   332	    };
   333	  }
   334	  if (eventType === 'recovery:failed') {
   335	    const recoveryPayload = payload as EventPayload['recovery:failed'];
   336	    return {
   337	      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
   338	      description: recoveryPayload.error,
   339	    };
   340	  }
   341	  if (eventType === 'recovery:exhausted') {
   342	    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
   343	    return {
   344	      title: 'Auto-recovery exhausted',
   345	      description: recoveryPayload.lastError,
   346	    };
   347	  }
   348	  if (eventType === 'recovery:blocked') {
   349	    const blockedPayload = payload as EventPayload['recovery:blocked'];
   350	    return {
   351	      title: 'Recovery blocked',
   352	      description: blockedPayload.reason,
   353	      reason: blockedPayload.reason,
   354	    };
   355	  }
   356	  if (eventType === 'recovery:stopped') {
   357	    const stoppedPayload = payload as EventPayload['recovery:stopped'];
   358	    return {
   359	      title: 'Recovery stopped',
   360	      description: stoppedPayload.reason,
   361	      reason: stoppedPayload.reason,
   362	    };
   363	  }
   364	  if (eventType === 'recovery:started') {
   365	    const startedPayload = payload as EventPayload['recovery:started'];
   366	    return {
   367	      title: 'Recovery started',
   368	      description: startedPayload.trigger,
   369	    };
   370	  }
   371	  if (eventType === 'recovery:approval-needed') {
   372	    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
   373	    return {
   374	      title: `Approval required: ${approvalPayload.toolName}`,
   375	      description: `Attempt #${String(approvalPayload.attempt)}`,
   376	      actionRunId: approvalPayload.actionRunId,
   377	    };
   378	  }
   379	  if (eventType === 'recovery:approval-auto-skipped') {
   380	    const skippedPayload = payload as EventPayload['recovery:approval-auto-skipped'];

exec
/bin/bash -lc "sed -n '460,560p' src/monitor/activity-event-mapper.ts" in /home/lee/OpenLander
 succeeded in 0ms:
    description: content.description,
    status,
    incidentId: content.incidentId,
    actionRunId: content.actionRunId,
    correlationId: content.actionRunId,
    aiMetadata: content.aiMetadata,
    rawType: eventType,
    project: projectName,
    user: 'system',
    detail: content.description || undefined,
    time: timestamp,
    reason: content.reason,
  };
}

exec
/bin/bash -lc 'rg -n "correlationId|correlation_id" src/monitor/activity-event-mapper.ts src/monitor/activity-logger.ts src/web/api/routes.ts src/web/api/ops-routes.ts src/events/index.ts' in /home/lee/OpenLander
 succeeded in 0ms:
src/events/index.ts:279:    correlationId?: string;
src/events/index.ts:290:    correlationId?: string;
src/events/index.ts:304:    correlationId?: string;
src/events/index.ts:309:    correlationId?: string;
src/events/index.ts:317:    correlationId?: string;
src/events/index.ts:328:    correlationId?: string;
src/events/index.ts:336:    correlationId?: string;
src/events/index.ts:344:    correlationId?: string;
src/events/index.ts:353:    correlationId?: string;
src/events/index.ts:360:    correlationId?: string;
src/events/index.ts:366:    correlationId?: string;
src/web/api/routes.ts:96:    correlationId: row.correlation_id ?? undefined,
src/web/api/routes.ts:226:    const correlationIdFilter = c.req.query('correlationId') ?? undefined;
src/web/api/routes.ts:237:      correlation_id?: string;
src/web/api/routes.ts:241:    if (correlationIdFilter) dbFilters.correlation_id = correlationIdFilter;
src/monitor/activity-logger.ts:79:            // Extract correlationId from payload when available
src/monitor/activity-logger.ts:80:            const correlationId =
src/monitor/activity-logger.ts:81:              activity.correlationId ??
src/monitor/activity-logger.ts:82:              (payload as { correlationId?: string }).correlationId ??
src/monitor/activity-logger.ts:96:              correlation_id: correlationId ?? null,
src/web/api/ops-routes.ts:22:  correlationId?: string;
src/web/api/ops-routes.ts:505:            correlationId: run.correlation_id ?? undefined,
src/monitor/activity-event-mapper.ts:46:  correlationId?: string;
src/monitor/activity-event-mapper.ts:464:    correlationId: content.actionRunId,

codex
**CRITICAL**

None.

**MAJOR**

1. [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L76) groups every non-correlated event for a project into a single 5-minute bucket because `type` was removed from the fallback key. Most activity items do not carry a real `correlationId`; the mapper only sets it from `actionRunId` for approval-related entries ([activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L464)). That means an incident, a recovery event, and an unrelated deploy failure from the same project inside 5 minutes now collapse into one thread. The row then inherits one `title`, one `status`, one `triggerType`, and one severity summary for mixed events, so the feed can present the wrong problem as a single thread.

2. [LeftRail.tsx](/home/lee/OpenLander/web/src/components/ops/v2/LeftRail.tsx#L214) deduplicates incidents only by `triggerType ?? title`, ignoring `project_id` and `severity`. In the global ops view that merges unrelated incidents across different projects into one row, and the displayed severity dot comes from whichever incident hit the accumulator first. That is a real behavioral regression compared with the existing incident grouping logic in [IncidentMap.tsx](/home/lee/OpenLander/web/src/components/ops/IncidentMap.tsx#L63), which keys by project and severity as well.

3. [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L24) `localizeTitle()` is not aligned with the actual title strings produced by the backend. The mapper emits titles like `Deploy failed (build)` and `Deploy crashed` ([activity-event-mapper.ts](/home/lee/OpenLander/src/monitor/activity-event-mapper.ts#L260)), but the new regexes only recognize `deploy:failed`, `deploy:crash`, or any generic `deploy:` prefix. Result:
   - many real deploy titles never localize at all;
   - incident titles like `deploy:crash — Exit code 1` will miss the exact crash regex and then fall through to the generic `^deploy:` rule, incorrectly rendering as "Deploy failed".

**MINOR**

1. [LeftRail.tsx](/home/lee/OpenLander/web/src/components/ops/v2/LeftRail.tsx#L291) still shows the section badge count as `incidents.length` while the list renders `groupedIncidents`. After deduplication the badge and visible row count diverge, which is confusing even if the grouping logic is fixed.

2. `triggerType` null handling is safe in both files. Unknown patterns also fall back safely to the original string or `humanizeEventType()`. The regressions here are not crashers; they are incorrect grouping and mislabeling.
tokens used
67,972

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
