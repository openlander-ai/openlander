# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-09T07:16:20.083Z

## Original task

Review the latest commit 3c280b4 on the develop branch of OpenLander. Run: git diff ee470b2..3c280b4 to see the changes. Focus on: 1) ReactMarkdown + remark-gfm usage in IncidentCard.tsx, IncidentTimeline.tsx, MainTimeline.tsx — is it safe to render user/AI-generated markdown? XSS risk? 2) Performance: ReactMarkdown renders on every event row in MainTimeline — will this cause performance issues with 50+ events? Should it be memoized? 3) The prose class strings are very long — any maintainability concerns? 4) The t('ops.aiDiagnosisSummary') i18n key usage. Report as CRITICAL/MAJOR/MINOR.

## Final prompt

Review the latest commit 3c280b4 on the develop branch of OpenLander. Run: git diff ee470b2..3c280b4 to see the changes. Focus on: 1) ReactMarkdown + remark-gfm usage in IncidentCard.tsx, IncidentTimeline.tsx, MainTimeline.tsx — is it safe to render user/AI-generated markdown? XSS risk? 2) Performance: ReactMarkdown renders on every event row in MainTimeline — will this cause performance issues with 50+ events? Should it be memoized? 3) The prose class strings are very long — any maintainability concerns? 4) The t('ops.aiDiagnosisSummary') i18n key usage. Report as CRITICAL/MAJOR/MINOR.

## Raw output

```text
No CRITICAL or MAJOR findings.

MINOR: `MainTimeline` reparses markdown for every visible event row on each parent rerender, which is avoidable work once the timeline grows. In [`MainTimeline.tsx` line 105](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L105) and [`MainTimeline.tsx` line 151](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L151), `ThreadEventRow` is a plain function component, so toggling one thread, changing pagination, polling updates, or any parent state change reruns `ReactMarkdown` for all visible rows. With the current `EVENTS_PAGE_SIZE = 20`, the default path is probably fine, but once users expand older events or multiple threads, reparsing 50+ markdown blocks repeatedly will add noticeable CPU/layout cost. I would memoize the row (`memo(ThreadEventRow)`) and/or extract a memoized `MarkdownBlock` keyed by the markdown string so unchanged event descriptions do not get reparsed on unrelated state changes.

MINOR: The prose styling is duplicated as large inline class strings, which will become brittle to maintain and easy to desynchronize. See [`IncidentCard.tsx` line 117](/home/lee/OpenLander/web/src/components/ops/IncidentCard.tsx#L117), [`IncidentTimeline.tsx` line 55](/home/lee/OpenLander/web/src/components/ops/IncidentTimeline.tsx#L55), and [`MainTimeline.tsx` line 153](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L153). There are already three slightly different variants; future tweaks to link/code/list styling will require touching each callsite. A shared constant or small wrapper like `MarkdownContent` with size variants would reduce drift and make the security/permitted-element policy explicit in one place.

On your specific questions:
- XSS: as written, this looks safe against HTML/script injection. `react-markdown` escapes raw HTML by default, and these components do not enable `rehypeRaw`, `dangerouslySetInnerHTML`, or custom HTML renderers. `remark-gfm` only adds GFM syntax support. I do not see an XSS bug in these usages. Residual note: these components still render arbitrary links from user/AI text, so product-level link handling may still matter, but that is not script execution.
- `t('ops.aiDiagnosisSummary')`: correct. The key exists in both [`en.ts` line 666](/home/lee/OpenLander/web/src/i18n/en.ts#L666) and [`ko.ts` line 663](/home/lee/OpenLander/web/src/i18n/ko.ts#L663), so there is no i18n break from this commit.

Assumptions: review is limited to commit `3c280b4` versus `ee470b2`, and I did not benchmark runtime behavior in-browser.


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
session id: 019d7118-4202-77d3-99f3-c4978080eb2d
--------
user
Review the latest commit 3c280b4 on the develop branch of OpenLander. Run: git diff ee470b2..3c280b4 to see the changes. Focus on: 1) ReactMarkdown + remark-gfm usage in IncidentCard.tsx, IncidentTimeline.tsx, MainTimeline.tsx — is it safe to render user/AI-generated markdown? XSS risk? 2) Performance: ReactMarkdown renders on every event row in MainTimeline — will this cause performance issues with 50+ events? Should it be memoized? 3) The prose class strings are very long — any maintainability concerns? 4) The t('ops.aiDiagnosisSummary') i18n key usage. Report as CRITICAL/MAJOR/MINOR.
codex
Reviewing commit `3c280b4` against `ee470b2` with the requested focus areas. I’ll inspect the diff and the affected components first, then I’ll report findings ordered by severity with file references.
exec
/bin/bash -lc 'git show 3c280b4:web/src/components/timeline/MainTimeline.tsx' in /home/lee/OpenLander
exec
/bin/bash -lc 'git show 3c280b4:web/src/components/timeline/IncidentTimeline.tsx' in /home/lee/OpenLander
 exited 128 in 0ms:
fatal: path 'web/src/components/timeline/MainTimeline.tsx' does not exist in '3c280b4'

 exited 128 in 0ms:
fatal: path 'web/src/components/timeline/IncidentTimeline.tsx' does not exist in '3c280b4'

exec
/bin/bash -lc 'git diff ee470b2..3c280b4 -- src web/src/components/timeline web/src/components/ops web/src/i18n' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/src/components/ops/IncidentCard.tsx b/web/src/components/ops/IncidentCard.tsx
index c315382..a3c8adc 100644
--- a/web/src/components/ops/IncidentCard.tsx
+++ b/web/src/components/ops/IncidentCard.tsx
@@ -14,6 +14,8 @@ import {
 import { IncidentTimeline } from './IncidentTimeline.js';
 import { relativeTime } from './utils.js';
 import { useLanguage } from '../../i18n/context.js';
+import ReactMarkdown from 'react-markdown';
+import remarkGfm from 'remark-gfm';

 export interface IncidentGroup {
   key: string;
@@ -102,18 +104,29 @@ export function IncidentCard({ group, projectName, incidentProjectId }: Incident
           >
             {isCritical ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
           </div>
-          <div className="flex-1">
+          <div className="flex-1 w-full overflow-hidden mt-1">
             <h4
               className={cn(
-                'text-lg font-semibold font-display mb-1.5',
+                'text-lg font-semibold font-display mb-2.5',
                 isCritical ? 'text-error' : 'text-warning',
               )}
             >
               {t(group.label)}
             </h4>
-            <p className="break-words whitespace-pre-wrap text-sm font-body leading-relaxed text-primary-ol">
-              {t(group.description)}
-            </p>
+            <div className="w-full">
+              <ReactMarkdown
+                remarkPlugins={[remarkGfm]}
+                className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm text-primary-ol
+                  prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-base prose-headings:font-semibold
+                  prose-a:text-agent prose-a:no-underline hover:prose-a:underline
+                  prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
+                  prose-strong:text-primary-ol prose-strong:font-semibold
+                  prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-sm
+                  prose-ul:pl-5 prose-ol:pl-5 prose-li:my-1"
+              >
+                {group.description}
+              </ReactMarkdown>
+            </div>
           </div>
         </div>

diff --git a/web/src/components/ops/IncidentTimeline.tsx b/web/src/components/ops/IncidentTimeline.tsx
index 6fcd622..9915c47 100644
--- a/web/src/components/ops/IncidentTimeline.tsx
+++ b/web/src/components/ops/IncidentTimeline.tsx
@@ -1,5 +1,7 @@
 import type { OpsIncidentEvent } from '../../lib/api/operations.js';
 import { useLanguage } from '../../i18n/context.js';
+import ReactMarkdown from 'react-markdown';
+import remarkGfm from 'remark-gfm';

 const TIMELINE_EVENT_TYPES = [
   'detected',
@@ -50,7 +52,9 @@ export function IncidentTimeline({ events }: IncidentTimelineProps) {
               </span>
             </div>
             {g.event.message && (
-              <span className="text-sm text-secondary-ol mt-1">{g.event.message}</span>
+              <div className="prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-p:text-secondary-ol prose-strong:text-secondary-ol prose-strong:font-semibold prose-a:text-ai prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0 mt-1 break-words">
+                <ReactMarkdown remarkPlugins={[remarkGfm]}>{g.event.message}</ReactMarkdown>
+              </div>
             )}
             {g.count > 1 && (
               <span className="text-xs text-muted-ol mt-2 italic">
diff --git a/web/src/components/ops/v2/MainTimeline.tsx b/web/src/components/ops/v2/MainTimeline.tsx
index 1cf03cd..98bc5e3 100644
--- a/web/src/components/ops/v2/MainTimeline.tsx
+++ b/web/src/components/ops/v2/MainTimeline.tsx
@@ -1,3 +1,5 @@
+import ReactMarkdown from 'react-markdown';
+import remarkGfm from 'remark-gfm';
 import { useMemo, useState, useCallback } from 'react';
 import { ChevronRight, ChevronDown, Clock, AlertCircle } from 'lucide-react';
 import { cn } from '../../../lib/utils.js';
@@ -103,23 +105,66 @@ function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {
 function ThreadEventRow({ event }: { event: ActivityItem }) {
   const { t, language } = useLanguage();

+  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
+
   return (
-    <div className="relative flex items-start gap-3 py-2">
-      <div className="absolute -left-[17px] top-3.5 h-1.5 w-1.5 rounded-full bg-agent" />
-      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
-        <div className="flex items-center gap-2 text-xs">
-          <span className="font-medium text-primary-ol">
-            {humanizeEventType(event.type, t as unknown as (key: string) => string)}
+    <div className="relative flex items-start gap-3 py-2.5">
+      <div
+        className={cn(
+          'absolute -left-[17px] top-4 h-1.5 w-1.5 rounded-full ring-4 ring-bg-panel',
+          isAiEvent ? 'bg-agent' : 'bg-border',
+        )}
+      />
+      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
+        <div className="flex flex-wrap items-center gap-2 text-xs">
+          <span className={cn('font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}>
+            {event.title || humanizeEventType(event.type, t as unknown as (key: string) => string)}
           </span>
           <span className="text-muted-ol">
             {relativeTime(new Date(event.timestamp).getTime(), language)}
           </span>
+          {event.aiMetadata && (
+            <div className="flex items-center gap-1.5">
+              <span className="text-muted-ol/50">·</span>
+              <span className="font-mono text-muted-ol text-[10px]">{event.aiMetadata.model}</span>
+              {event.aiMetadata.durationMs && (
+                <>
+                  <span className="text-muted-ol/50">·</span>
+                  <span className="text-muted-ol text-[10px]">
+                    {(event.aiMetadata.durationMs / 1000).toFixed(1)}s
+                  </span>
+                </>
+              )}
+            </div>
+          )}
         </div>
+
+        {event.aiMetadata?.diagnosisSummary && (
+          <div className="mt-0.5 mb-1.5 p-3 bg-agent/5 border border-agent/20 rounded-md">
+            <p className="text-xs font-semibold text-agent mb-1.5">{t('ops.aiDiagnosisSummary')}</p>
+            <p className="text-xs text-primary-ol leading-relaxed">
+              {event.aiMetadata.diagnosisSummary}
+            </p>
+          </div>
+        )}
+
         {event.description && (
-          <p className="truncate text-xs text-secondary-ol">{event.description}</p>
+          <div className="w-full overflow-hidden mt-0.5">
+            <ReactMarkdown
+              remarkPlugins={[remarkGfm]}
+              className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-xs text-secondary-ol
+                prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-sm prose-headings:font-semibold
+                prose-a:text-agent prose-a:no-underline hover:prose-a:underline
+                prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
+                prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-xs
+                prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5"
+            >
+              {event.description}
+            </ReactMarkdown>
+          </div>
         )}
       </div>
-      <SeverityBadge severity={event.severity} className="shrink-0" />
+      <SeverityBadge severity={event.severity} className="shrink-0 mt-0.5" />
     </div>
   );
 }
diff --git a/web/src/i18n/ko.ts b/web/src/i18n/ko.ts
index 5fd672d..53f1c68 100644
--- a/web/src/i18n/ko.ts
+++ b/web/src/i18n/ko.ts
@@ -527,7 +527,7 @@ export const translations = {
     },
     rail: {
       approvals: '승인 목록',
-      activeIssues: '활성 문제',
+      activeIssues: '현재 문제',
       circuitBreakerStatus: '서킷 브레이커',
       drawerLabel: '내비게이션',
     },

exec
/bin/bash -lc 'git show 3c280b4:web/src/components/project/IncidentCard.tsx' in /home/lee/OpenLander
 exited 128 in 0ms:
fatal: path 'web/src/components/project/IncidentCard.tsx' does not exist in '3c280b4'

codex
The diff confirms the markdown changes landed under `web/src/components/ops/...`, not the paths in your prompt. I’m locating the exact files and checking the relevant i18n keys and surrounding code before I write the review.
exec
/bin/bash -lc 'git show 3c280b4:web/src/components/ops/IncidentCard.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
import { useState } from 'react';
import { Card } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible.js';
import { AlertTriangle, XCircle, ChevronDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils.js';
import {
  fetchIncidentEvents,
  type OpsIncident,
  type OpsIncidentEvent,
} from '../../lib/api/operations.js';
import { IncidentTimeline } from './IncidentTimeline.js';
import { relativeTime } from './utils.js';
import { useLanguage } from '../../i18n/context.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface IncidentGroup {
  key: string;
  severity: string;
  label: string;
  description: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  latestIncident: OpsIncident;
  status: string;
}

interface IncidentCardProps {
  group: IncidentGroup;
  projectName: string;
  incidentProjectId: string;
}

export function IncidentCard({ group, projectName, incidentProjectId }: IncidentCardProps) {
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState<OpsIncidentEvent[]>(group.latestIncident.events || []);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open && (!events || events.length === 0)) {
      setLoadingEvents(true);
      try {
        const data = await fetchIncidentEvents(group.latestIncident.id);
        setEvents(data.events || []);
      } catch (err) {
        console.error('Failed to fetch events', err);
      } finally {
        setLoadingEvents(false);
      }
    }
  };

  const isCritical = group.severity === 'critical';

  return (
    <Card
      className={cn(
        'min-w-0 overflow-hidden border-[hsl(var(--border))] shadow-sm transition-colors',
        isCritical
          ? 'border-l-4 border-l-error bg-error/5'
          : 'border-l-4 border-l-warning bg-warning/5',
      )}
    >
      <div className="p-4 lg:p-5">
        <div className="mb-4 flex min-w-0 items-center gap-2.5 border-b border-border/50 pb-3">
          <Badge
            variant="outline"
            className="shrink-0 bg-bg-panel px-2 py-[2px] font-body text-xs text-secondary-ol shadow-sm"
          >
            {projectName}
          </Badge>
          <span
            className="min-w-0 flex-1 truncate border-l border-border/60 pl-1 font-mono text-[11px] text-muted-ol opacity-80"
            title={incidentProjectId}
          >
            {incidentProjectId}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'h-6 shrink-0 whitespace-nowrap px-2.5 text-[11px] capitalize',
              isCritical
                ? 'text-error border-error/50 bg-error/10'
                : 'text-warning border-warning/50 bg-warning/10',
              group.status === 'resolved' && 'text-success border-success/50 bg-success/10',
            )}
          >
            {t(group.status.replace('_', ' '))}
          </Badge>
        </div>

        <div className="flex items-start gap-4 mb-5">
          <div
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-full shrink-0 shadow-sm mt-0.5',
              isCritical ? 'bg-error/20 text-error' : 'bg-warning/20 text-warning',
            )}
          >
            {isCritical ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </div>
          <div className="flex-1 w-full overflow-hidden mt-1">
            <h4
              className={cn(
                'text-lg font-semibold font-display mb-2.5',
                isCritical ? 'text-error' : 'text-warning',
              )}
            >
              {t(group.label)}
            </h4>
            <div className="w-full">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm text-primary-ol
                  prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-base prose-headings:font-semibold
                  prose-a:text-agent prose-a:no-underline hover:prose-a:underline
                  prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
                  prose-strong:text-primary-ol prose-strong:font-semibold
                  prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-sm
                  prose-ul:pl-5 prose-ol:pl-5 prose-li:my-1"
              >
                {group.description}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        <div className="mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/50 bg-bg-app px-3 py-2 text-[11px] font-mono text-muted-ol shadow-sm sm:ml-[48px] sm:w-fit sm:max-w-[calc(100%-3rem)]">
          <span className="font-medium text-secondary-ol">
            {t('ops.occurrences', { count: String(group.count) })}
          </span>
          <span className="hidden opacity-40 sm:inline">&middot;</span>
          <span>
            {t('ops.first')}:{' '}
            {new Date(group.firstSeen).toLocaleDateString(language === 'ko' ? 'ko-KR' : undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="hidden opacity-40 sm:inline">&middot;</span>
          <span>
            {t('ops.last')}:{' '}
            <span className="text-secondary-ol">{relativeTime(group.lastSeen, language)}</span>
          </span>
        </div>

        <div className="mt-4 sm:ml-[48px]">
          <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="w-full min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-bg-panel text-xs text-secondary-ol hover:bg-bg-subtle"
                >
                  {t('ops.viewTimeline')}
                  <ChevronDown
                    className={cn('ml-2 h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
                  />
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-ol hover:text-secondary-ol"
                onClick={() => toast.info(t('ops.featureNotReady'))}
              >
                {t('ops.acknowledge')}
              </Button>
            </div>

            <CollapsibleContent className="mt-4 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
              <div className="rounded-lg border border-border bg-bg-panel/80 p-5 shadow-sm">
                <h5 className="mb-5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-ol">
                  <RefreshCw className="h-3 w-3" />
                  {t('ops.latestTimeline')}
                </h5>

                {loadingEvents ? (
                  <div className="flex items-center justify-center py-6">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-ol" />
                  </div>
                ) : (
                  <IncidentTimeline events={events} />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </Card>
  );
}

exec
/bin/bash -lc "rg --files web/src/components web/src/i18n | rg 'IncidentCard|IncidentTimeline|MainTimeline|en\\.ts|ko\\.ts'" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/i18n/ko.ts
web/src/i18n/en.ts
web/src/components/ops/v2/MainTimeline.tsx
web/src/components/ops/IncidentCard.tsx
web/src/components/ops/IncidentTimeline.tsx
web/src/components/setup/SetupScreen.tsx

exec
/bin/bash -lc 'git show 3c280b4:web/src/components/ops/IncidentTimeline.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
import type { OpsIncidentEvent } from '../../lib/api/operations.js';
import { useLanguage } from '../../i18n/context.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TIMELINE_EVENT_TYPES = [
  'detected',
  'diagnosed',
  'action_taken',
  'recovered',
  'escalated',
  'alert_sent',
  'interrupted',
  'cascade_detected',
] as const;

interface IncidentTimelineProps {
  events: OpsIncidentEvent[];
}

export function IncidentTimeline({ events }: IncidentTimelineProps) {
  const { t } = useLanguage();

  if (events.length === 0) {
    return <div className="text-xs text-muted-ol italic">{t('operations.noTimelineEvents')}</div>;
  }

  const groupedEvents: { event: OpsIncidentEvent; count: number }[] = [];
  for (const e of events) {
    const last = groupedEvents[groupedEvents.length - 1];
    if (last && last.event.type === e.type && last.event.message === e.message) {
      last.count++;
    } else {
      groupedEvents.push({ event: e, count: 1 });
    }
  }

  return (
    <div className="relative pl-4 border-l-2 border-border/50 space-y-6">
      {groupedEvents.map((g, idx) => (
        <div key={idx} className="relative">
          <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-agent border-2 border-bg-subtle" />
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-primary-ol">
                {(TIMELINE_EVENT_TYPES as readonly string[]).includes(g.event.type)
                  ? t(`operations.timelineEvents.${g.event.type}`)
                  : g.event.type.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-muted-ol">
                {new Date(g.event.created_at).toLocaleTimeString()}
              </span>
            </div>
            {g.event.message && (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-p:text-secondary-ol prose-strong:text-secondary-ol prose-strong:font-semibold prose-a:text-ai prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0 mt-1 break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{g.event.message}</ReactMarkdown>
              </div>
            )}
            {g.count > 1 && (
              <span className="text-xs text-muted-ol mt-2 italic">
                {t('operations.timelineEvents.repeatedCondition', {
                  count: String(g.count),
                })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

exec
/bin/bash -lc 'git show 3c280b4:web/src/components/ops/v2/MainTimeline.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Clock, AlertCircle } from 'lucide-react';
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

const THREADS_PAGE_SIZE = 20;
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
}

export interface MainTimelineProps {
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
    });
  }

  // Sort threads: newest first by most recent event
  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());

  return threads;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ThreadEventRow({ event }: { event: ActivityItem }) {
  const { t, language } = useLanguage();

  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';

  return (
    <div className="relative flex items-start gap-3 py-2.5">
      <div
        className={cn(
          'absolute -left-[17px] top-4 h-1.5 w-1.5 rounded-full ring-4 ring-bg-panel',
          isAiEvent ? 'bg-agent' : 'bg-border',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn('font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}>
            {event.title || humanizeEventType(event.type, t as unknown as (key: string) => string)}
          </span>
          <span className="text-muted-ol">
            {relativeTime(new Date(event.timestamp).getTime(), language)}
          </span>
          {event.aiMetadata && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-ol/50">·</span>
              <span className="font-mono text-muted-ol text-[10px]">{event.aiMetadata.model}</span>
              {event.aiMetadata.durationMs && (
                <>
                  <span className="text-muted-ol/50">·</span>
                  <span className="text-muted-ol text-[10px]">
                    {(event.aiMetadata.durationMs / 1000).toFixed(1)}s
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {event.aiMetadata?.diagnosisSummary && (
          <div className="mt-0.5 mb-1.5 p-3 bg-agent/5 border border-agent/20 rounded-md">
            <p className="text-xs font-semibold text-agent mb-1.5">{t('ops.aiDiagnosisSummary')}</p>
            <p className="text-xs text-primary-ol leading-relaxed">
              {event.aiMetadata.diagnosisSummary}
            </p>
          </div>
        )}

        {event.description && (
          <div className="w-full overflow-hidden mt-0.5">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-xs text-secondary-ol
                prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-sm prose-headings:font-semibold
                prose-a:text-agent prose-a:no-underline hover:prose-a:underline
                prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-xs
                prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5"
            >
              {event.description}
            </ReactMarkdown>
          </div>
        )}
      </div>
      <SeverityBadge severity={event.severity} className="shrink-0 mt-0.5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainTimeline({ activities, onThreadSelect }: MainTimelineProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities]);

  // Progressive disclosure: how many threads are visible
  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);

  // Per-thread event page: tracks how many events are visible per thread
  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});

  // Default: auto-expand threads with pending approvals; collapse everything else
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

  const toggleThread = useCallback(
    (correlationId: string) => {
      setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
      onThreadSelect?.(correlationId);
    },
    [onThreadSelect],
  );

  const showMoreEvents = useCallback((correlationId: string) => {
    setExpandedEventsMap((prev) => ({
      ...prev,
      [correlationId]: (prev[correlationId] ?? EVENTS_PAGE_SIZE) + EVENTS_PAGE_SIZE,
    }));
  }, []);

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="mb-3 h-8 w-8 text-muted-ol" />
        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivity')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Expand all / Collapse all */}
      <div className="flex justify-end pb-1">
        <button
          type="button"
          onClick={toggleAll}
          className={cn(
            'text-[11px] text-muted-ol hover:text-primary-ol transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent rounded',
          )}
        >
          {allExpanded ? t('opsV2.timeline.collapseAll') : t('opsV2.timeline.expandAll')}
        </button>
      </div>

      {threadData.slice(0, visibleThreadCount).map((thread) => {
        const isExpanded = !!expandedMap[thread.correlationId];
        const isCritical = thread.severity === 'critical';
        const isWarning = thread.severity === 'warning';
        const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
        const visibleEvents = thread.events.slice(0, maxVisibleEvents);
        const hiddenEventCount = thread.events.length - visibleEvents.length;

        return (
          <Collapsible
            key={thread.correlationId}
            open={isExpanded}
            onOpenChange={() => toggleThread(thread.correlationId)}
            className={cn(
              'rounded-lg border transition-colors',
              'border-[hsl(var(--border))]',
              isCritical && 'border-l-4 border-l-error',
              isWarning && !isCritical && 'border-l-4 border-l-warning',
              !isCritical && !isWarning && 'border-l-4 border-l-transparent',
            )}
          >
            {/* Thread header row — acts as the collapsible trigger */}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                  'hover:bg-bg-subtle/50 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent',
                )}
              >
                {/* Expand/collapse chevron */}
                <span className="shrink-0 text-muted-ol">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>

                {/* Project name */}
                <span className="min-w-0 shrink truncate text-xs font-medium text-primary-ol">
                  {thread.projectName}
                </span>

                {/* Severity badge */}
                <SeverityBadge severity={thread.severity} className="shrink-0" />

                {/* Status */}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                    thread.status === 'active' && 'bg-warning/10 text-warning',
                    thread.status === 'resolved' && 'bg-success/10 text-success',
                    thread.status === 'failed' && 'bg-error/10 text-error',
                    thread.status === 'pending' && 'bg-info/10 text-info',
                    thread.status === 'recovering' && 'bg-info/10 text-info',
                    thread.status === 'ai-running' && 'bg-agent/10 text-agent',
                    thread.status === 'ai-completed' && 'bg-info/10 text-info',
                    thread.status === 'recovery-blocked' && 'bg-warning/10 text-warning',
                    thread.status === 'recovery-stopped' && 'bg-warning/10 text-warning',
                  )}
                >
                  {thread.status.replace(/-/g, ' ')}
                </span>

                {/* Pending approval indicator */}
                {thread.hasPendingApproval && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-warning">
                    <AlertCircle className="h-3 w-3" />
                    {t('opsV2.statusStrip.approvalCount', { count: 1 })}
                  </span>
                )}

                {/* Spacer */}
                <span className="flex-1" />

                {/* Event count */}
                <span className="shrink-0 text-[10px] text-muted-ol">
                  {t('opsV2.timeline.eventCount', { count: String(thread.eventCount) })}
                </span>

                {/* Last event time */}
                <span className="shrink-0 text-[10px] text-muted-ol">
                  {relativeTime(new Date(thread.lastEventTime).getTime(), language)}
                </span>
              </button>
            </CollapsibleTrigger>

            {/* Expanded: event history with progressive disclosure for 50+ events */}
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
              <div className="border-t border-[hsl(var(--border))] bg-bg-panel/50 px-4 py-3">
                <div className="relative border-l-2 border-border/50 pl-4">
                  {visibleEvents.map((event) => (
                    <ThreadEventRow key={event.id} event={event} />
                  ))}
                  {hiddenEventCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        showMoreEvents(thread.correlationId);
                      }}
                      className="mt-2 text-[11px] text-muted-ol hover:text-primary-ol transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent rounded"
                    >
                      {t('opsV2.timeline.showOlderEvents')} ({hiddenEventCount})
                    </button>
                  )}
                </div>
                {thread.hasPendingApproval && <ThreadApprovalActions events={thread.events} />}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Thread-level progressive disclosure */}
      {threadData.length > visibleThreadCount && (
        <button
          type="button"
          onClick={() => setVisibleThreadCount((n) => n + THREADS_PAGE_SIZE)}
          className={cn(
            'mt-2 w-full rounded-lg border border-dashed border-[hsl(var(--border))]',
            'py-2.5 text-xs text-muted-ol hover:text-primary-ol hover:border-primary-ol/30',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent',
          )}
        >
          {t('opsV2.timeline.showOlderEvents')} ({threadData.length - visibleThreadCount})
        </button>
      )}
    </div>
  );
}

exec
/bin/bash -lc "rg -n \"aiDiagnosisSummary|ops:\\s*\\{\" web/src/i18n/en.ts web/src/i18n/ko.ts" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/i18n/ko.ts:608:  ops: {
web/src/i18n/ko.ts:663:    aiDiagnosisSummary: '🤖 AI 진단 요약',
web/src/i18n/en.ts:611:  ops: {
web/src/i18n/en.ts:666:    aiDiagnosisSummary: '🤖 AI Diagnosis Summary',

codex
I have the relevant files. Next step is checking line-level references and validating whether `react-markdown` is being used with any unsafe options or whether the current render path will reparse markdown on routine timeline updates.
exec
/bin/bash -lc "nl -ba web/src/components/ops/IncidentCard.tsx | sed -n '90,140p'" in /home/lee/OpenLander
 succeeded in 0ms:
    90	                : 'text-warning border-warning/50 bg-warning/10',
    91	              group.status === 'resolved' && 'text-success border-success/50 bg-success/10',
    92	            )}
    93	          >
    94	            {t(group.status.replace('_', ' '))}
    95	          </Badge>
    96	        </div>
    97
    98	        <div className="flex items-start gap-4 mb-5">
    99	          <div
   100	            className={cn(
   101	              'flex items-center justify-center h-8 w-8 rounded-full shrink-0 shadow-sm mt-0.5',
   102	              isCritical ? 'bg-error/20 text-error' : 'bg-warning/20 text-warning',
   103	            )}
   104	          >
   105	            {isCritical ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
   106	          </div>
   107	          <div className="flex-1 w-full overflow-hidden mt-1">
   108	            <h4
   109	              className={cn(
   110	                'text-lg font-semibold font-display mb-2.5',
   111	                isCritical ? 'text-error' : 'text-warning',
   112	              )}
   113	            >
   114	              {t(group.label)}
   115	            </h4>
   116	            <div className="w-full">
   117	              <ReactMarkdown
   118	                remarkPlugins={[remarkGfm]}
   119	                className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm text-primary-ol
   120	                  prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-base prose-headings:font-semibold
   121	                  prose-a:text-agent prose-a:no-underline hover:prose-a:underline
   122	                  prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
   123	                  prose-strong:text-primary-ol prose-strong:font-semibold
   124	                  prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-sm
   125	                  prose-ul:pl-5 prose-ol:pl-5 prose-li:my-1"
   126	              >
   127	                {group.description}
   128	              </ReactMarkdown>
   129	            </div>
   130	          </div>
   131	        </div>
   132
   133	        <div className="mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/50 bg-bg-app px-3 py-2 text-[11px] font-mono text-muted-ol shadow-sm sm:ml-[48px] sm:w-fit sm:max-w-[calc(100%-3rem)]">
   134	          <span className="font-medium text-secondary-ol">
   135	            {t('ops.occurrences', { count: String(group.count) })}
   136	          </span>
   137	          <span className="hidden opacity-40 sm:inline">&middot;</span>
   138	          <span>
   139	            {t('ops.first')}:{' '}
   140	            {new Date(group.firstSeen).toLocaleDateString(language === 'ko' ? 'ko-KR' : undefined, {

exec
/bin/bash -lc "nl -ba web/src/components/ops/IncidentTimeline.tsx | sed -n '1,120p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import type { OpsIncidentEvent } from '../../lib/api/operations.js';
     2	import { useLanguage } from '../../i18n/context.js';
     3	import ReactMarkdown from 'react-markdown';
     4	import remarkGfm from 'remark-gfm';
     5
     6	const TIMELINE_EVENT_TYPES = [
     7	  'detected',
     8	  'diagnosed',
     9	  'action_taken',
    10	  'recovered',
    11	  'escalated',
    12	  'alert_sent',
    13	  'interrupted',
    14	  'cascade_detected',
    15	] as const;
    16
    17	interface IncidentTimelineProps {
    18	  events: OpsIncidentEvent[];
    19	}
    20
    21	export function IncidentTimeline({ events }: IncidentTimelineProps) {
    22	  const { t } = useLanguage();
    23
    24	  if (events.length === 0) {
    25	    return <div className="text-xs text-muted-ol italic">{t('operations.noTimelineEvents')}</div>;
    26	  }
    27
    28	  const groupedEvents: { event: OpsIncidentEvent; count: number }[] = [];
    29	  for (const e of events) {
    30	    const last = groupedEvents[groupedEvents.length - 1];
    31	    if (last && last.event.type === e.type && last.event.message === e.message) {
    32	      last.count++;
    33	    } else {
    34	      groupedEvents.push({ event: e, count: 1 });
    35	    }
    36	  }
    37
    38	  return (
    39	    <div className="relative pl-4 border-l-2 border-border/50 space-y-6">
    40	      {groupedEvents.map((g, idx) => (
    41	        <div key={idx} className="relative">
    42	          <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-agent border-2 border-bg-subtle" />
    43	          <div className="flex flex-col">
    44	            <div className="flex items-center gap-3">
    45	              <span className="text-sm font-medium text-primary-ol">
    46	                {(TIMELINE_EVENT_TYPES as readonly string[]).includes(g.event.type)
    47	                  ? t(`operations.timelineEvents.${g.event.type}`)
    48	                  : g.event.type.replace(/_/g, ' ')}
    49	              </span>
    50	              <span className="text-xs text-muted-ol">
    51	                {new Date(g.event.created_at).toLocaleTimeString()}
    52	              </span>
    53	            </div>
    54	            {g.event.message && (
    55	              <div className="prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-p:text-secondary-ol prose-strong:text-secondary-ol prose-strong:font-semibold prose-a:text-ai prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0 mt-1 break-words">
    56	                <ReactMarkdown remarkPlugins={[remarkGfm]}>{g.event.message}</ReactMarkdown>
    57	              </div>
    58	            )}
    59	            {g.count > 1 && (
    60	              <span className="text-xs text-muted-ol mt-2 italic">
    61	                {t('operations.timelineEvents.repeatedCondition', {
    62	                  count: String(g.count),
    63	                })}
    64	              </span>
    65	            )}
    66	          </div>
    67	        </div>
    68	      ))}
    69	    </div>
    70	  );
    71	}

exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/MainTimeline.tsx | sed -n '95,175p'" in /home/lee/OpenLander
 succeeded in 0ms:
    95	  // Sort threads: newest first by most recent event
    96	  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());
    97
    98	  return threads;
    99	}
   100
   101	// ---------------------------------------------------------------------------
   102	// Sub-components
   103	// ---------------------------------------------------------------------------
   104
   105	function ThreadEventRow({ event }: { event: ActivityItem }) {
   106	  const { t, language } = useLanguage();
   107
   108	  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
   109
   110	  return (
   111	    <div className="relative flex items-start gap-3 py-2.5">
   112	      <div
   113	        className={cn(
   114	          'absolute -left-[17px] top-4 h-1.5 w-1.5 rounded-full ring-4 ring-bg-panel',
   115	          isAiEvent ? 'bg-agent' : 'bg-border',
   116	        )}
   117	      />
   118	      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
   119	        <div className="flex flex-wrap items-center gap-2 text-xs">
   120	          <span className={cn('font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}>
   121	            {event.title || humanizeEventType(event.type, t as unknown as (key: string) => string)}
   122	          </span>
   123	          <span className="text-muted-ol">
   124	            {relativeTime(new Date(event.timestamp).getTime(), language)}
   125	          </span>
   126	          {event.aiMetadata && (
   127	            <div className="flex items-center gap-1.5">
   128	              <span className="text-muted-ol/50">·</span>
   129	              <span className="font-mono text-muted-ol text-[10px]">{event.aiMetadata.model}</span>
   130	              {event.aiMetadata.durationMs && (
   131	                <>
   132	                  <span className="text-muted-ol/50">·</span>
   133	                  <span className="text-muted-ol text-[10px]">
   134	                    {(event.aiMetadata.durationMs / 1000).toFixed(1)}s
   135	                  </span>
   136	                </>
   137	              )}
   138	            </div>
   139	          )}
   140	        </div>
   141
   142	        {event.aiMetadata?.diagnosisSummary && (
   143	          <div className="mt-0.5 mb-1.5 p-3 bg-agent/5 border border-agent/20 rounded-md">
   144	            <p className="text-xs font-semibold text-agent mb-1.5">{t('ops.aiDiagnosisSummary')}</p>
   145	            <p className="text-xs text-primary-ol leading-relaxed">
   146	              {event.aiMetadata.diagnosisSummary}
   147	            </p>
   148	          </div>
   149	        )}
   150
   151	        {event.description && (
   152	          <div className="w-full overflow-hidden mt-0.5">
   153	            <ReactMarkdown
   154	              remarkPlugins={[remarkGfm]}
   155	              className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-xs text-secondary-ol
   156	                prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-sm prose-headings:font-semibold
   157	                prose-a:text-agent prose-a:no-underline hover:prose-a:underline
   158	                prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none
   159	                prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-xs
   160	                prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5"
   161	            >
   162	              {event.description}
   163	            </ReactMarkdown>
   164	          </div>
   165	        )}
   166	      </div>
   167	      <SeverityBadge severity={event.severity} className="shrink-0 mt-0.5" />
   168	    </div>
   169	  );
   170	}
   171
   172	// ---------------------------------------------------------------------------
   173	// Main component
   174	// ---------------------------------------------------------------------------
   175

exec
/bin/bash -lc "nl -ba web/src/i18n/en.ts | sed -n '655,675p'" in /home/lee/OpenLander
 succeeded in 0ms:
   655	      analyzing: 'Analyzing system context...',
   656	      elapsed: 'Elapsed',
   657	      thoughtProcess: 'Thought Process',
   658	    },
   659	    recoveryStrategy: {
   660	      llm: 'LLM diagnosis-based',
   661	      memory: 'Past memory-based',
   662	      recipe: 'Defined recipe rule',
   663	      unknown: 'Unknown strategy',
   664	    },
   665	    diagnosisSummary: 'Diagnosis: {summary}',
   666	    aiDiagnosisSummary: '🤖 AI Diagnosis Summary',
   667	    recentSameEvents: 'Recent similar events ({count})',
   668	    moreMergedLogs: '{count} more merged logs',
   669	  },
   670	  services: {
   671	    title: 'Services',
   672	    createService: 'Create Service',
   673	    subtitle:
   674	      'Run Docker images as shared infrastructure. Multiple projects can connect to these services.',
   675	    noServices: 'No services running',

exec
/bin/bash -lc "nl -ba web/src/i18n/ko.ts | sed -n '652,672p'" in /home/lee/OpenLander
 succeeded in 0ms:
   652	      analyzing: '시스템 상태 분석 중...',
   653	      elapsed: '경과 시간',
   654	      thoughtProcess: '사고 과정',
   655	    },
   656	    recoveryStrategy: {
   657	      llm: 'LLM 진단 기반',
   658	      memory: '과거 기억 기반',
   659	      recipe: '정의된 레시피 규칙',
   660	      unknown: '알 수 없는 전략',
   661	    },
   662	    diagnosisSummary: '진단 요약: {summary}',
   663	    aiDiagnosisSummary: '🤖 AI 진단 요약',
   664	    recentSameEvents: '최근 동일 이벤트 ({count}건)',
   665	    moreMergedLogs: '외 {count}건의 병합된 로그',
   666	  },
   667	  services: {
   668	    title: '서비스',
   669	    createService: '서비스 생성',
   670	    subtitle:
   671	      'Docker 이미지를 공유 인프라로 실행합니다. 여러 프로젝트가 이 서비스에 연결할 수 있습니다.',
   672	    noServices: '실행 중인 서비스 없음',

codex
No CRITICAL or MAJOR findings.

MINOR: `MainTimeline` reparses markdown for every visible event row on each parent rerender, which is avoidable work once the timeline grows. In [`MainTimeline.tsx` line 105](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L105) and [`MainTimeline.tsx` line 151](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L151), `ThreadEventRow` is a plain function component, so toggling one thread, changing pagination, polling updates, or any parent state change reruns `ReactMarkdown` for all visible rows. With the current `EVENTS_PAGE_SIZE = 20`, the default path is probably fine, but once users expand older events or multiple threads, reparsing 50+ markdown blocks repeatedly will add noticeable CPU/layout cost. I would memoize the row (`memo(ThreadEventRow)`) and/or extract a memoized `MarkdownBlock` keyed by the markdown string so unchanged event descriptions do not get reparsed on unrelated state changes.

MINOR: The prose styling is duplicated as large inline class strings, which will become brittle to maintain and easy to desynchronize. See [`IncidentCard.tsx` line 117](/home/lee/OpenLander/web/src/components/ops/IncidentCard.tsx#L117), [`IncidentTimeline.tsx` line 55](/home/lee/OpenLander/web/src/components/ops/IncidentTimeline.tsx#L55), and [`MainTimeline.tsx` line 153](/home/lee/OpenLander/web/src/components/ops/v2/MainTimeline.tsx#L153). There are already three slightly different variants; future tweaks to link/code/list styling will require touching each callsite. A shared constant or small wrapper like `MarkdownContent` with size variants would reduce drift and make the security/permitted-element policy explicit in one place.

On your specific questions:
- XSS: as written, this looks safe against HTML/script injection. `react-markdown` escapes raw HTML by default, and these components do not enable `rehypeRaw`, `dangerouslySetInnerHTML`, or custom HTML renderers. `remark-gfm` only adds GFM syntax support. I do not see an XSS bug in these usages. Residual note: these components still render arbitrary links from user/AI text, so product-level link handling may still matter, but that is not script execution.
- `t('ops.aiDiagnosisSummary')`: correct. The key exists in both [`en.ts` line 666](/home/lee/OpenLander/web/src/i18n/en.ts#L666) and [`ko.ts` line 663](/home/lee/OpenLander/web/src/i18n/ko.ts#L663), so there is no i18n break from this commit.

Assumptions: review is limited to commit `3c280b4` versus `ee470b2`, and I did not benchmark runtime behavior in-browser.
tokens used
22,506

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
