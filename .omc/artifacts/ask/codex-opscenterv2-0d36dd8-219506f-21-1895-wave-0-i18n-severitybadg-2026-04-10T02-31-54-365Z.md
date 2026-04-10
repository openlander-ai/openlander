# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-10T02:31:54.366Z

## Original task

OpsCenterV2 운영 메뉴 개선 구현을 리뷰해줘. 최근 커밋(0d36dd8..219506f)에서 21개 파일, +1895줄 변경됨.

핵심 변경:

- Wave 0: i18n 통일(SeverityBadge, utils.ts, MainFeedGrid), 스레드 중복 제거, LeftRail 프로젝트명/시간 추가, 에러 배너
- Wave 1: @xyflow/react 설치, API search/from/to 파라미터, keyboard shortcuts hook, CB 리셋, AI 메타데이터, 캐스케이드 그룹
- Wave 2: IncidentDetailSlideover, 시간범위 필터, DependencyGraph(React Flow), 인시던트 검색
- Wave 3: 키보드 단축키 연결, 빈 상태 UI, i18n 감사

이미 발견된 TypeScript 에러 2건:

1. MainTimeline.tsx:155 - ReactMarkdown에 className prop이 없음
2. MainFeedGrid.tsx:126 - ActivityItem에 triggerType 속성 없음

집중 포인트:

1. 타입 에러 및 런타임 버그 가능성
2. 코드 품질 (as any, ts-ignore, 불필요한 추상화)
3. 보안 이슈 (XSS, injection 등)
4. 성능 문제 (메모리 누수, 불필요한 리렌더링)
5. API 변경의 하위 호환성

주요 파일: MainFeedGrid.tsx, LeftRail.tsx, OpsCenterV2.tsx, use-ops-center-data.ts, ops-routes.ts, SeverityBadge.tsx, DependencyGraph.tsx, IncidentDetailSlideover.tsx

한국어로 답변해줘.

## Final prompt

OpsCenterV2 운영 메뉴 개선 구현을 리뷰해줘. 최근 커밋(0d36dd8..219506f)에서 21개 파일, +1895줄 변경됨.

핵심 변경:

- Wave 0: i18n 통일(SeverityBadge, utils.ts, MainFeedGrid), 스레드 중복 제거, LeftRail 프로젝트명/시간 추가, 에러 배너
- Wave 1: @xyflow/react 설치, API search/from/to 파라미터, keyboard shortcuts hook, CB 리셋, AI 메타데이터, 캐스케이드 그룹
- Wave 2: IncidentDetailSlideover, 시간범위 필터, DependencyGraph(React Flow), 인시던트 검색
- Wave 3: 키보드 단축키 연결, 빈 상태 UI, i18n 감사

이미 발견된 TypeScript 에러 2건:

1. MainTimeline.tsx:155 - ReactMarkdown에 className prop이 없음
2. MainFeedGrid.tsx:126 - ActivityItem에 triggerType 속성 없음

집중 포인트:

1. 타입 에러 및 런타임 버그 가능성
2. 코드 품질 (as any, ts-ignore, 불필요한 추상화)
3. 보안 이슈 (XSS, injection 등)
4. 성능 문제 (메모리 누수, 불필요한 리렌더링)
5. API 변경의 하위 호환성

주요 파일: MainFeedGrid.tsx, LeftRail.tsx, OpsCenterV2.tsx, use-ops-center-data.ts, ops-routes.ts, SeverityBadge.tsx, DependencyGraph.tsx, IncidentDetailSlideover.tsx

한국어로 답변해줘.

## Raw output

```text
**Findings**

- 높음: 시간 범위 필터가 실제 activity feed 전체에 일관되게 적용되지 않습니다. 클라이언트는 초기 스냅샷에서만 `from/to`를 붙이고, 이후 SSE 연결은 `/api/ops/activity?follow=true`로 열어 버립니다. 그래서 `1h` 같은 범위를 선택해도 재연결 직후 서버의 초기 backfill이 기본 범위 데이터를 다시 밀어 넣습니다. 게다가 서버는 `incident/alert`에만 `from/to`를 쓰고 `recovery/approval/ai:*`는 최근 200건을 그대로 가져오므로, 시간 필터가 UI에서 거짓말하게 됩니다. [use-ops-center-data.ts](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L124) [use-ops-center-data.ts](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L267) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L460) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L520) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L560) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L633)

- 중간: 새 키보드 단축키 구현이 현재 i18n/스레드 모델과 맞지 않습니다. `?` 단축키는 `aria-label*="Keyboard"`로 버튼을 찾는데, 한국어 라벨에서는 이 문자열이 없어서 바로 깨집니다. 그리고 `j/k` 이동 한계값은 렌더되는 thread 수가 아니라 raw `activities.length`를 사용해서, 이벤트가 많이 묶인 경우 포커스 인덱스가 실제 행 수를 넘어갑니다. [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L91) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L125) [KeyboardShortcutsHelp.tsx](/home/lee/OpenLander/web/src/components/ops/v2/KeyboardShortcutsHelp.tsx#L33) [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L369) [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L483)

- 중간: 필터 setter는 “전체 상태 교체” 방식인데 호출부는 “partial patch”처럼 쓰고 있어서 빠른 필터 액션이 오동작합니다. Circuit Breaker 위젯의 `setFilters({ density: 'actions-only' })`는 기존 `project/severity/timeRange`를 전부 날려 버리고, 반대로 빈 상태의 “clear filters”는 `density`만 `all`로 바꿔서 실제 원인이 `project/severity/timeRange`면 아무 것도 해제하지 못합니다. [FilterBar.tsx](/home/lee/OpenLander/web/src/components/ops/v2/FilterBar.tsx#L58) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L327) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L341)

- 낮음: incident 검색이 SQL `LIKE '%query%'`를 그대로 써서 `%`나 `_`가 포함된 검색어를 escape하지 않습니다. SQL injection은 아니지만, `%` 입력만으로 사실상 전체 검색이 되고 literal `%/_` 검색도 정확히 못 합니다. API 계약상 search 파라미터를 추가했으면 이 정도는 막는 편이 낫습니다. [ops-incident.repo.ts](/home/lee/OpenLander/src/db/repos/ops-incident.repo.ts#L81)

**확인 메모**

현재 워크트리 기준으로는 사용자가 적어준 두 TypeScript 에러는 재현되지 않았습니다. `npm run typecheck`와 `npm run build`는 모두 통과했습니다. 변경 파일 범위에서 `as any`, `@ts-ignore`, `@ts-expect-error`는 찾지 못했고, `react-markdown`은 raw HTML 플러그인을 쓰지 않아 눈에 띄는 XSS 경로도 보이지 않았습니다.

남는 리스크는 시간 필터/SSE 회귀와 키보드 단축키 쪽 UX 버그입니다. 이 둘은 실제 운영 화면에서 바로 체감될 가능성이 큽니다.


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
session id: 019d7537-1027-7e81-b7af-4a823701ebdc
--------
user
OpsCenterV2 운영 메뉴 개선 구현을 리뷰해줘. 최근 커밋(0d36dd8..219506f)에서 21개 파일, +1895줄 변경됨.

핵심 변경:
- Wave 0: i18n 통일(SeverityBadge, utils.ts, MainFeedGrid), 스레드 중복 제거, LeftRail 프로젝트명/시간 추가, 에러 배너
- Wave 1: @xyflow/react 설치, API search/from/to 파라미터, keyboard shortcuts hook, CB 리셋, AI 메타데이터, 캐스케이드 그룹
- Wave 2: IncidentDetailSlideover, 시간범위 필터, DependencyGraph(React Flow), 인시던트 검색
- Wave 3: 키보드 단축키 연결, 빈 상태 UI, i18n 감사

이미 발견된 TypeScript 에러 2건:
1. MainTimeline.tsx:155 - ReactMarkdown에 className prop이 없음
2. MainFeedGrid.tsx:126 - ActivityItem에 triggerType 속성 없음

집중 포인트:
1. 타입 에러 및 런타임 버그 가능성
2. 코드 품질 (as any, ts-ignore, 불필요한 추상화)
3. 보안 이슈 (XSS, injection 등)
4. 성능 문제 (메모리 누수, 불필요한 리렌더링)
5. API 변경의 하위 호환성

주요 파일: MainFeedGrid.tsx, LeftRail.tsx, OpsCenterV2.tsx, use-ops-center-data.ts, ops-routes.ts, SeverityBadge.tsx, DependencyGraph.tsx, IncidentDetailSlideover.tsx

한국어로 답변해줘.
codex
최근 커밋 범위 `0d36dd8..219506f`를 기준으로 변경 내용을 먼저 훑고, 지적하신 주요 파일과 타입 에러 지점을 중심으로 런타임/보안/성능/호환성 리스크를 확인하겠습니다.
exec
/bin/bash -lc 'git diff --name-only 0d36dd8..219506f' in /home/lee/OpenLander
 succeeded in 0ms:
src/db/index.ts
src/db/repos/ops-incident.repo.ts
src/web/api/ops-routes.ts
web/package-lock.json
web/package.json
web/src/components/ops/v2/CircuitBreakerWidget.tsx
web/src/components/ops/v2/DependencyGraph.tsx
web/src/components/ops/v2/FilterBar.tsx
web/src/components/ops/v2/IncidentDetailSlideover.tsx
web/src/components/ops/v2/KeyboardShortcutsHelp.tsx
web/src/components/ops/v2/LeftRail.tsx
web/src/components/ops/v2/MainFeedGrid.tsx
web/src/hooks/use-keyboard-shortcuts.ts
web/src/hooks/use-ops-center-data.ts
web/src/i18n/en.ts
web/src/i18n/ko.ts
web/src/lib/api/operations.ts
web/src/pages/OpsCenterV2.tsx
web/vite.config.ts

exec
/bin/bash -lc 'git status --short' in /home/lee/OpenLander
 succeeded in 0ms:
 M web/src/App.tsx
 D web/src/components/ops/ActivityFeed.tsx
 D web/src/components/ops/AgentActivityPanel.tsx
 D web/src/components/ops/ApprovalQueue.tsx
 D web/src/components/ops/CircuitBreakerMap.tsx
 D web/src/components/ops/IncidentMap.tsx
 M web/src/components/ops/v2/StatusStrip.tsx
 D web/src/hooks/use-activity-stream.ts
 M web/src/i18n/en.ts
 D web/src/pages/OpsCenter.tsx
 M web/src/pages/OpsCenterV2.tsx
?? .omc/
?? logs/

exec
/bin/bash -lc 'git diff --stat 0d36dd8..219506f' in /home/lee/OpenLander
 succeeded in 0ms:
 src/db/index.ts                                    |   2 +-
 src/db/repos/ops-incident.repo.ts                  |  33 ++-
 src/web/api/ops-routes.ts                          | 102 +++++++-
 web/package-lock.json                              | 237 +++++++++++++++++++
 web/package.json                                   |   2 +
 web/src/components/ops/v2/CircuitBreakerWidget.tsx | 114 +++++++--
 web/src/components/ops/v2/DependencyGraph.tsx      | 204 ++++++++++++++++
 web/src/components/ops/v2/FilterBar.tsx            |  13 +-
 .../components/ops/v2/IncidentDetailSlideover.tsx  | 213 +++++++++++++++++
 .../components/ops/v2/KeyboardShortcutsHelp.tsx    |  58 +++++
 web/src/components/ops/v2/LeftRail.tsx             | 259 +++++++++++++++++++--
 web/src/components/ops/v2/MainFeedGrid.tsx         | 253 ++++++++++++++++----
 web/src/hooks/use-keyboard-shortcuts.ts            |  65 ++++++
 web/src/hooks/use-ops-center-data.ts               |  73 +++++-
 web/src/i18n/en.ts                                 |  69 +++++-
 web/src/i18n/ko.ts                                 |  71 +++++-
 web/src/lib/api/operations.ts                      |  11 +
 web/src/pages/OpsCenterV2.tsx                      | 189 ++++++++++++++-
 web/vite.config.ts                                 |   1 +
 19 files changed, 1831 insertions(+), 138 deletions(-)

codex
변경 범위와 현재 워크트리 상태를 분리해서 보고 있습니다. 지금은 리뷰 대상 커밋 diff만 기준으로 주요 파일 패치와 타입 안전성, API 계약 변경을 확인하는 단계입니다.
exec
/bin/bash -lc 'git diff 0d36dd8..219506f -- src/db/repos/ops-incident.repo.ts' in /home/lee/OpenLander
exec
/bin/bash -lc 'git diff 0d36dd8..219506f -- src/web/api/ops-routes.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/db/repos/ops-incident.repo.ts b/src/db/repos/ops-incident.repo.ts
index a084d01..1321f9d 100644
--- a/src/db/repos/ops-incident.repo.ts
+++ b/src/db/repos/ops-incident.repo.ts
@@ -1,4 +1,4 @@
-import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
+import { and, desc, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
 import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
 import { opsIncidents } from '../schema.drizzle.js';
 import type { OpsIncidentRow } from '../types.js';
@@ -78,15 +78,42 @@ export class OpsIncidentRepo {
       .all() as OpsIncidentRow[];
   }

-  findByDateRange(from: number, to: number): OpsIncidentRow[] {
+  findByDateRange(from: number, to: number, searchText?: string): OpsIncidentRow[] {
+    const conditions = [gte(opsIncidents.created_at, from), lte(opsIncidents.created_at, to)];
+    if (searchText) {
+      const searchCondition = or(
+        like(opsIncidents.root_cause, `%${searchText}%`),
+        like(opsIncidents.diagnosis, `%${searchText}%`),
+      );
+      if (searchCondition) conditions.push(searchCondition);
+    }
     return this.db
       .select()
       .from(opsIncidents)
-      .where(and(gte(opsIncidents.created_at, from), lte(opsIncidents.created_at, to)))
+      .where(and(...conditions))
       .orderBy(desc(opsIncidents.created_at))
       .all() as OpsIncidentRow[];
   }

+  findBySearch(searchText: string, limit?: number): OpsIncidentRow[] {
+    const baseQuery = this.db
+      .select()
+      .from(opsIncidents)
+      .where(
+        or(
+          like(opsIncidents.root_cause, `%${searchText}%`),
+          like(opsIncidents.diagnosis, `%${searchText}%`),
+        ),
+      )
+      .orderBy(desc(opsIncidents.created_at));
+
+    if (limit) {
+      return baseQuery.limit(limit).all() as OpsIncidentRow[];
+    }
+
+    return baseQuery.all() as OpsIncidentRow[];
+  }
+
   updateStatus(
     id: string,
     status: string,

 succeeded in 0ms:
diff --git a/src/web/api/ops-routes.ts b/src/web/api/ops-routes.ts
index 5f01457..919bf84 100644
--- a/src/web/api/ops-routes.ts
+++ b/src/web/api/ops-routes.ts
@@ -10,19 +10,46 @@ import { DEFAULT_OPS_CONFIG, DEFAULT_RECOVERY_AUTOMATION } from '../../monitor/o
 interface ActivityItem {
   id: string;
   timestamp: string;
-  type: 'incident' | 'recovery' | 'approval' | 'circuit_breaker' | 'cleanup' | 'alert';
+  type:
+    | 'incident'
+    | 'recovery'
+    | 'approval'
+    | 'circuit_breaker'
+    | 'cleanup'
+    | 'alert'
+    | 'ai_diagnosis'
+    | 'ai:invoked'
+    | 'ai:completed'
+    | 'recovery:blocked'
+    | 'recovery:stopped'
+    | 'recovery:started';
   severity: 'critical' | 'warning' | 'info';
   projectId: string;
   projectName: string;
   title: string;
   description: string;
-  status: 'active' | 'resolved' | 'pending' | 'failed';
+  status:
+    | 'active'
+    | 'resolved'
+    | 'pending'
+    | 'failed'
+    | 'ai-running'
+    | 'ai-completed'
+    | 'recovery-blocked'
+    | 'recovery-stopped'
+    | 'recovering';
   incidentId?: string;
   actionRunId?: string;
   correlationId?: string;
   cascadeGroup?: string[];
   triggerType?: string;
   triggerDetails?: string;
+  aiMetadata?: {
+    model: string;
+    tokensUsed?: number;
+    durationMs?: number;
+    diagnosisSummary?: string;
+  };
 }

 interface ParsedIncidentTrigger {
@@ -96,11 +123,16 @@ function extractIncidentTrigger(
   return parseTriggerFromText(incident.root_cause);
 }

-function mapIncidentResponse(incident: OpsIncidentRow, events: OpsIncidentEventRow[]) {
+function mapIncidentResponse(
+  incident: OpsIncidentRow,
+  events: OpsIncidentEventRow[],
+  projectName?: string,
+) {
   const trigger = extractIncidentTrigger(incident, events);
   const title = incident.root_cause ?? 'Incident detected';
   return {
     ...incident,
+    projectName,
     title,
     triggerType: trigger.triggerType,
     triggerDetails: trigger.triggerDetails,
@@ -123,6 +155,9 @@ export function createOpsRoutes(ctx: AppContext): Hono {
   api.get('/incidents', (c) => {
     const projectId = c.req.query('projectId');
     const status = c.req.query('status');
+    const search = c.req.query('search');
+    const fromParam = c.req.query('from');
+    const toParam = c.req.query('to');
     const limit = Number(c.req.query('limit') ?? 50);

     try {
@@ -130,8 +165,9 @@ export function createOpsRoutes(ctx: AppContext): Hono {
       if (projectId) {
         incidents = ctx.db.listOpsIncidentsByProject(projectId, limit);
       } else {
-        const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
-        incidents = ctx.db.listOpsIncidentsByDateRange(from, Date.now());
+        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
+        const to = toParam ? Number(toParam) : Date.now();
+        incidents = ctx.db.listOpsIncidentsByDateRange(from, to, search);
       }

       if (status) {
@@ -141,9 +177,17 @@ export function createOpsRoutes(ctx: AppContext): Hono {
       const page = incidents.slice(0, limit);
       const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
       const eventsByIncidentId = groupEventsByIncidentId(events);
+
+      const projects = ctx.db.listProjects();
+      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
+
       return c.json({
         incidents: page.map((incident) =>
-          mapIncidentResponse(incident, eventsByIncidentId.get(incident.id) ?? []),
+          mapIncidentResponse(
+            incident,
+            eventsByIncidentId.get(incident.id) ?? [],
+            projectMap.get(incident.project_id) ?? incident.project_id,
+          ),
         ),
       });
     } catch {
@@ -160,9 +204,12 @@ export function createOpsRoutes(ctx: AppContext): Hono {
         return c.json({ error: 'Incident not found' }, 404);
       }

+      const project = ctx.db.getProject(incident.project_id);
+      const projectName = project?.name ?? incident.project_id;
+
       const events = ctx.db.listOpsIncidentEvents(id);
       return c.json({
-        incident: mapIncidentResponse(incident, events),
+        incident: mapIncidentResponse(incident, events, projectName),
         events: events.map(mapIncidentEventResponse),
       });
     } catch {
@@ -403,6 +450,8 @@ export function createOpsRoutes(ctx: AppContext): Hono {
       const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
       const before = c.req.query('before');
       const since = sinceParam || c.req.query('since');
+      const fromParam = c.req.query('from');
+      const toParam = c.req.query('to');

       const projects = ctx.db.listProjects();
       const projectMap = new Map(projects.map((p) => [p.id, p.name]));
@@ -410,10 +459,11 @@ export function createOpsRoutes(ctx: AppContext): Hono {

       // Incidents
       if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
-        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
+        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
+        const to = toParam ? Number(toParam) : Date.now();
         const incidents = projectId
           ? ctx.db.listOpsIncidentsByProject(projectId, 100)
-          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
+          : ctx.db.listOpsIncidentsByDateRange(from, to);
         const eventsByIncidentId = groupEventsByIncidentId(
           ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
         );
@@ -507,6 +557,40 @@ export function createOpsRoutes(ctx: AppContext): Hono {
         }
       }

+      // AI Events
+      if (types.length === 0 || types.includes('ai:invoked') || types.includes('ai:completed')) {
+        const aiTypes = ['ai:invoked', 'ai:completed'];
+        for (const aiType of aiTypes) {
+          if (types.length > 0 && !types.includes(aiType)) continue;
+          const aiRows = ctx.db.findActivityLogRecent(200, {
+            project_id: projectId,
+            activity_type: aiType,
+          });
+          for (const row of aiRows) {
+            let metadata: Record<string, unknown> = {};
+            try {
+              metadata = JSON.parse(row.metadata) as Record<string, unknown>;
+            } catch {
+              // ignore
+            }
+
+            activities.push({
+              id: row.id,
+              timestamp: row.created_at,
+              type: row.activity_type as ActivityItem['type'],
+              severity: row.severity as ActivityItem['severity'],
+              projectId: row.project_id,
+              projectName: projectMap.get(row.project_id) ?? row.project_id,
+              title: row.title,
+              description: row.description,
+              status: row.status as ActivityItem['status'],
+              correlationId: row.correlation_id ?? undefined,
+              aiMetadata: metadata.aiMetadata as ActivityItem['aiMetadata'],
+            });
+          }
+        }
+      }
+
       let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
       if (severity) sorted = sorted.filter((a) => a.severity === severity);
       if (before) sorted = sorted.filter((a) => a.timestamp < before);

exec
/bin/bash -lc 'git diff 0d36dd8..219506f -- web/src/hooks/use-ops-center-data.ts web/src/lib/api/operations.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/src/hooks/use-ops-center-data.ts b/web/src/hooks/use-ops-center-data.ts
index b5aa00a..c8bf566 100644
--- a/web/src/hooks/use-ops-center-data.ts
+++ b/web/src/hooks/use-ops-center-data.ts
@@ -23,6 +23,12 @@ const BASE_RETRY_DELAY = 3_000; // ms
 // Public interface
 // ---------------------------------------------------------------------------

+export interface OpsCenterError {
+  type: 'connection_lost' | 'api_error' | 'timeout';
+  message: string;
+  retryCount?: number;
+}
+
 export interface OpsCenterData {
   activities: ActivityItem[];
   incidents: OpsIncident[];
@@ -32,7 +38,7 @@ export interface OpsCenterData {
   isConnected: boolean;
   isReconnecting: boolean;
   isLoading: boolean;
-  error: string | null;
+  error: OpsCenterError | null;
   retry: () => void;
 }

@@ -40,7 +46,36 @@ export interface OpsCenterData {
 // Hook
 // ---------------------------------------------------------------------------

-export function useOpsCenterData(): OpsCenterData {
+function getTimeRangeParams(timeRange?: string): { from?: number; to?: number } {
+  if (!timeRange || timeRange === '_all') return {};
+
+  const now = Date.now();
+  let from: number;
+
+  switch (timeRange) {
+    case '1h':
+      from = now - 60 * 60 * 1000;
+      break;
+    case '6h':
+      from = now - 6 * 60 * 60 * 1000;
+      break;
+    case '24h':
+      from = now - 24 * 60 * 60 * 1000;
+      break;
+    case '7d':
+      from = now - 7 * 24 * 60 * 60 * 1000;
+      break;
+    case '30d':
+      from = now - 30 * 24 * 60 * 60 * 1000;
+      break;
+    default:
+      return {};
+  }
+
+  return { from, to: now };
+}
+
+export function useOpsCenterData(timeRange?: string): OpsCenterData {
   // --- Core state ---
   const [activities, setActivities] = useState<ActivityItem[]>([]);
   const [incidents, setIncidents] = useState<OpsIncident[]>([]);
@@ -50,7 +85,7 @@ export function useOpsCenterData(): OpsCenterData {
   const [isConnected, setIsConnected] = useState(false);
   const [isReconnecting, setIsReconnecting] = useState(false);
   const [isLoading, setIsLoading] = useState(true);
-  const [error, setError] = useState<string | null>(null);
+  const [error, setError] = useState<OpsCenterError | null>(null);

   // --- Refs for SSE lifecycle ---
   const abortRef = useRef<AbortController | null>(null);
@@ -98,7 +133,7 @@ export function useOpsCenterData(): OpsCenterData {

         if (!resp.ok || !resp.body) {
           if (!cancelledRef.current) {
-            setError(`Stream error: ${resp.status}`);
+            setError({ type: 'api_error', message: `Stream error: ${resp.status}` });
             setIsConnected(false);

             // Auto-retry with exponential backoff on non-OK responses
@@ -197,7 +232,12 @@ export function useOpsCenterData(): OpsCenterData {

         if (!cancelledRef.current) {
           const message = err instanceof Error ? err.message : 'Stream failed';
-          setError(message);
+          const isTimeout = err instanceof Error && err.name === 'AbortError';
+          setError({
+            type: isTimeout ? 'timeout' : 'connection_lost',
+            message,
+            retryCount: retriesRef.current,
+          });
           setIsConnected(false);

           // Auto-retry with exponential backoff
@@ -224,13 +264,20 @@ export function useOpsCenterData(): OpsCenterData {
     cancelledRef.current = false;
     setIsLoading(true);

+    const { from, to } = getTimeRangeParams(timeRange);
+    const activityParams = new URLSearchParams({ limit: '100' });
+    if (from) activityParams.set('from', String(from));
+    if (to) activityParams.set('to', String(to));
+
     // Parallel REST snapshot
     Promise.all([
-      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
-        if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
-        return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
-      }),
-      fetchOpsIncidents(undefined, 'open'),
+      fetch(`/api/ops/activity?${activityParams.toString()}`, { credentials: 'include' }).then(
+        (r) => {
+          if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
+          return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
+        },
+      ),
+      fetchOpsIncidents(undefined, 'open', undefined, from, to),
       fetchAllCircuitBreakers(),
       fetchPendingApprovals().catch(() => [] as ActionRun[]),
       fetchWithAuth('/api/ops/agent/active')
@@ -259,7 +306,9 @@ export function useOpsCenterData(): OpsCenterData {
       })
       .catch((err: unknown) => {
         if (!cancelledRef.current) {
-          setError(err instanceof Error ? err.message : String(err));
+          const message = err instanceof Error ? err.message : String(err);
+          const isTimeout = err instanceof Error && err.name === 'AbortError';
+          setError({ type: isTimeout ? 'timeout' : 'api_error', message });
         }
       })
       .finally(() => {
@@ -278,7 +327,7 @@ export function useOpsCenterData(): OpsCenterData {
       abortRef.current = null;
       dedupSetRef.current.clear();
     };
-  }, [connect]);
+  }, [connect, timeRange]);

   // ---------------------------------------------------------------------------
   // Manual retry: reset error and reconnect
diff --git a/web/src/lib/api/operations.ts b/web/src/lib/api/operations.ts
index c48dfce..40cc83c 100644
--- a/web/src/lib/api/operations.ts
+++ b/web/src/lib/api/operations.ts
@@ -71,6 +71,7 @@ export interface OpsIncidentEvent {
 export interface OpsIncident {
   id: string;
   project_id: string;
+  projectName?: string;
   title: string;
   status: string;
   severity: string;
@@ -96,10 +97,16 @@ export interface CircuitBreakerState {
 export async function fetchOpsIncidents(
   projectId?: string,
   status?: string,
+  search?: string,
+  from?: number,
+  to?: number,
 ): Promise<{ incidents: OpsIncident[] }> {
   const params = new URLSearchParams();
   if (projectId) params.set('projectId', projectId);
   if (status) params.set('status', status);
+  if (search) params.set('search', search);
+  if (from !== undefined) params.set('from', String(from));
+  if (to !== undefined) params.set('to', String(to));
   const response = await fetchWithAuth(`/api/ops/incidents?${params.toString()}`);
   if (!response.ok) throw new Error('Failed to fetch incidents');
   return response.json();
@@ -214,6 +221,8 @@ export async function fetchActivityFeed(opts?: {
   severity?: string;
   limit?: number;
   before?: string;
+  from?: number;
+  to?: number;
 }): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
   const params = new URLSearchParams();
   if (opts?.projectId) params.set('projectId', opts.projectId);
@@ -221,6 +230,8 @@ export async function fetchActivityFeed(opts?: {
   if (opts?.severity) params.set('severity', opts.severity);
   if (opts?.limit) params.set('limit', String(opts.limit));
   if (opts?.before) params.set('before', opts.before);
+  if (opts?.from !== undefined) params.set('from', String(opts.from));
+  if (opts?.to !== undefined) params.set('to', String(opts.to));
   const query = params.toString() ? `?${params.toString()}` : '';
   const resp = await fetchWithAuth(`/api/ops/activity${query}`);
   if (!resp.ok) throw new Error(`fetchActivityFeed failed: ${resp.status}`);

exec
/bin/bash -lc 'git diff 0d36dd8..219506f -- web/src/pages/OpsCenterV2.tsx web/src/components/ops/v2/MainFeedGrid.tsx web/src/components/ops/v2/LeftRail.tsx' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/src/components/ops/v2/LeftRail.tsx b/web/src/components/ops/v2/LeftRail.tsx
index 6f2ae1c..5aa0fd4 100644
--- a/web/src/components/ops/v2/LeftRail.tsx
+++ b/web/src/components/ops/v2/LeftRail.tsx
@@ -1,11 +1,33 @@
 import { useState, useEffect, useCallback } from 'react';
-import { CheckSquare, AlertCircle, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
+import {
+  CheckSquare,
+  AlertCircle,
+  ShieldAlert,
+  ChevronLeft,
+  ChevronRight,
+  RefreshCw,
+  Search,
+  Loader2,
+} from 'lucide-react';
+import { toast } from 'sonner';
 import { cn } from '../../../lib/utils.js';
 import { useLanguage } from '../../../i18n/context.js';
 import { ScrollArea } from '../../ui/scroll-area.js';
-import { humanizeEventType } from '../utils.js';
+import { humanizeEventType, relativeTime } from '../utils.js';
+import { SeverityBadge } from '../SeverityBadge.js';
+import { resetCircuitBreaker, fetchOpsIncidents } from '../../../lib/api/operations.js';
 import type { OpsIncident, CircuitBreakerWithProject } from '../../../lib/api/operations.js';
 import type { ActionRun } from '../../../lib/api/projects.js';
+import { Button } from '../../ui/button.js';
+import { Input } from '../../ui/input.js';
+import {
+  Dialog,
+  DialogContent,
+  DialogHeader,
+  DialogTitle,
+  DialogDescription,
+  DialogFooter,
+} from '../../ui/dialog.js';

 const STORAGE_KEY = 'ops-v2-rail-collapsed';

@@ -14,6 +36,7 @@ export interface LeftRailProps {
   incidents: OpsIncident[];
   circuitBreakers: CircuitBreakerWithProject[];
   onFilterChange?: (filter: { type?: string; severity?: string }) => void;
+  onIncidentSelect?: (incidentId: string) => void;
   /** When true, forces icon-only collapsed mode regardless of local state */
   forceCollapsed?: boolean;
 }
@@ -58,13 +81,17 @@ function SectionHeader({ icon, label, count, collapsed, active, onClick }: Secti
 function IncidentRow({
   incident,
   count,
+  lastEventTime,
   collapsed,
+  onClick,
 }: {
   incident: OpsIncident;
   count: number;
+  lastEventTime: number;
   collapsed: boolean;
+  onClick?: () => void;
 }) {
-  const { t } = useLanguage();
+  const { t, language } = useLanguage();
   const severityColor =
     incident.severity === 'critical'
       ? 'bg-error'
@@ -76,24 +103,59 @@ function IncidentRow({
     ? humanizeEventType(incident.triggerType, t)
     : incident.title;

-  const titleWithCount = count > 1 ? `${displayTitle} (×${count})` : displayTitle;
+  const titleWithCount =
+    count > 1
+      ? t('opsV2.rail.incidentCount', { title: displayTitle, count: String(count) })
+      : displayTitle;
+  const projectName = incident.projectName || incident.project_id;
+  const timeStr = relativeTime(lastEventTime, language as 'ko' | 'en');

   if (collapsed) {
     return (
-      <div className="flex justify-center py-1">
-        <span
-          className={cn('h-2 w-2 rounded-full shrink-0', severityColor)}
-          title={titleWithCount}
-        />
-      </div>
+      <button
+        type="button"
+        onClick={onClick}
+        className="flex justify-center py-1 w-full hover:bg-bg-subtle rounded-md transition-colors"
+        title={`${projectName}: ${titleWithCount}`}
+      >
+        <div
+          className={cn(
+            'relative flex items-center justify-center h-6 w-6 rounded-md shrink-0 border',
+            incident.severity === 'critical'
+              ? 'border-error text-error bg-error/10'
+              : incident.severity === 'warning'
+                ? 'border-warning text-warning bg-warning/10'
+                : 'border-muted-ol text-muted-ol bg-muted-ol/10',
+          )}
+        >
+          <span className="text-[10px] font-bold">{projectName.charAt(0).toUpperCase()}</span>
+          <span className={cn('absolute -top-1 -right-1 h-2 w-2 rounded-full', severityColor)} />
+        </div>
+      </button>
     );
   }

   return (
-    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
-      <span className={cn('h-2 w-2 rounded-full shrink-0 mt-1', severityColor)} />
-      <span className="text-xs font-body text-primary-ol truncate">{titleWithCount}</span>
-    </div>
+    <button
+      type="button"
+      onClick={onClick}
+      className={cn(
+        'flex flex-col gap-1 px-2 py-2 rounded-md transition-colors w-full text-left',
+        incident.severity === 'critical' ? 'bg-error/5 hover:bg-error/10' : 'hover:bg-bg-subtle',
+      )}
+    >
+      <div className="flex items-center justify-between w-full">
+        <div className="flex items-center gap-2 min-w-0">
+          <span className={cn('h-2 w-2 rounded-full shrink-0', severityColor)} />
+          <SeverityBadge severity={incident.severity} />
+          <span className="text-xs font-semibold text-primary-ol truncate">{projectName}</span>
+        </div>
+        <span className="text-[10px] text-muted-ol shrink-0 ml-2">{timeStr}</span>
+      </div>
+      <div className="pl-4 mt-0.5 w-full">
+        <span className="text-xs font-body text-secondary-ol truncate block">{titleWithCount}</span>
+      </div>
+    </button>
   );
 }

@@ -131,12 +193,29 @@ function CircuitBreakerRow({
   index: number;
   collapsed: boolean;
 }) {
+  const { t } = useLanguage();
+  const [isResetting, setIsResetting] = useState(false);
+  const [showConfirm, setShowConfirm] = useState(false);
+
   const isOpen = breaker.state === 'open';
   const isHalfOpen = breaker.state === 'half_open';
   const dotColor = isOpen ? 'bg-error' : isHalfOpen ? 'bg-warning' : 'bg-success';
   const displayName = breaker.projectName || `CB #${index + 1}`;
   const label = `${displayName}: ${breaker.state}`;

+  const handleReset = async () => {
+    setIsResetting(true);
+    try {
+      await resetCircuitBreaker(breaker.projectId);
+      toast.success(t('opsV2.widgets.circuitBreakers.resetSuccess'));
+      setShowConfirm(false);
+    } catch {
+      toast.error(t('opsV2.widgets.circuitBreakers.resetError'));
+    } finally {
+      setIsResetting(false);
+    }
+  };
+
   if (collapsed) {
     return (
       <div className="flex justify-center py-1">
@@ -146,10 +225,49 @@ function CircuitBreakerRow({
   }

   return (
-    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors">
-      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
-      <span className="text-xs font-body text-primary-ol truncate">{label}</span>
-    </div>
+    <>
+      <div className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-bg-subtle transition-colors group">
+        <div className="flex items-center gap-2 min-w-0">
+          <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor)} />
+          <span className="text-xs font-body text-primary-ol truncate">{label}</span>
+        </div>
+        {isOpen && (
+          <button
+            type="button"
+            onClick={() => setShowConfirm(true)}
+            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-bg-panel rounded text-muted-ol hover:text-primary-ol"
+            title={t('opsV2.widgets.circuitBreakers.reset')}
+          >
+            <RefreshCw className="h-3 w-3" />
+          </button>
+        )}
+      </div>
+
+      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
+        <DialogContent>
+          <DialogHeader>
+            <DialogTitle>{t('opsV2.widgets.circuitBreakers.resetConfirmTitle')}</DialogTitle>
+            <DialogDescription>
+              {t('opsV2.widgets.circuitBreakers.resetConfirmDescription')}
+            </DialogDescription>
+          </DialogHeader>
+          <DialogFooter>
+            <Button
+              variant="outline"
+              size="sm"
+              onClick={() => setShowConfirm(false)}
+              disabled={isResetting}
+            >
+              {t('opsV2.approvals.confirmCancel')}
+            </Button>
+            <Button size="sm" onClick={() => void handleReset()} disabled={isResetting}>
+              {isResetting ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : null}
+              {t('opsV2.widgets.circuitBreakers.reset')}
+            </Button>
+          </DialogFooter>
+        </DialogContent>
+      </Dialog>
+    </>
   );
 }

@@ -158,6 +276,7 @@ export function LeftRail({
   incidents,
   circuitBreakers,
   onFilterChange,
+  onIncidentSelect,
   forceCollapsed,
 }: LeftRailProps) {
   const { t } = useLanguage();
@@ -175,6 +294,50 @@ export function LeftRail({

   const [activeFilter, setActiveFilter] = useState<string | null>(null);

+  const [searchQuery, setSearchQuery] = useState('');
+  const [debouncedSearch, setDebouncedSearch] = useState('');
+  const [searchResults, setSearchResults] = useState<OpsIncident[] | null>(null);
+  const [isSearching, setIsSearching] = useState(false);
+
+  useEffect(() => {
+    const timer = setTimeout(() => {
+      setDebouncedSearch(searchQuery);
+    }, 300);
+    return () => clearTimeout(timer);
+  }, [searchQuery]);
+
+  useEffect(() => {
+    if (!debouncedSearch) {
+      setSearchResults(null);
+      setIsSearching(false);
+      return;
+    }
+
+    let isMounted = true;
+    setIsSearching(true);
+
+    fetchOpsIncidents(undefined, 'open', debouncedSearch)
+      .then((data) => {
+        if (isMounted) {
+          setSearchResults(data.incidents);
+        }
+      })
+      .catch(() => {
+        if (isMounted) {
+          setSearchResults([]);
+        }
+      })
+      .finally(() => {
+        if (isMounted) {
+          setIsSearching(false);
+        }
+      });
+
+    return () => {
+      isMounted = false;
+    };
+  }, [debouncedSearch]);
+
   const toggle = useCallback(() => {
     setCollapsed((prev) => {
       const next = !prev;
@@ -210,16 +373,25 @@ export function LeftRail({
   const approvalItems = approvals;
   const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');

+  const displayIncidents = searchResults !== null ? searchResults : incidents;
+
   // Group incidents by project + humanized trigger type (or title) to deduplicate
-  const groupedIncidents = incidents.reduce<
-    Array<{ incident: OpsIncident; count: number; groupKey: string }>
+  const groupedIncidents = displayIncidents.reduce<
+    Array<{ incident: OpsIncident; count: number; groupKey: string; lastEventTime: number }>
   >((acc, incident) => {
     const key = `${incident.project_id}::${incident.triggerType ?? incident.title}`;
     const existing = acc.find((g) => g.groupKey === key);
+    const time =
+      typeof incident.created_at === 'string'
+        ? new Date(incident.created_at).getTime()
+        : incident.created_at;
     if (existing) {
       existing.count += 1;
+      if (time > existing.lastEventTime) {
+        existing.lastEventTime = time;
+      }
     } else {
-      acc.push({ incident, count: 1, groupKey: key });
+      acc.push({ incident, count: 1, groupKey: key, lastEventTime: time });
     }
     return acc;
   }, []);
@@ -248,7 +420,9 @@ export function LeftRail({
           <button
             type="button"
             onClick={toggle}
-            title={effectivelyCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
+            title={
+              effectivelyCollapsed ? t('opsV2.rail.expandSidebar') : t('opsV2.rail.collapseSidebar')
+            }
             className="flex items-center justify-center h-6 w-6 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle transition-colors"
           >
             {effectivelyCollapsed ? (
@@ -292,15 +466,52 @@ export function LeftRail({
               active={activeFilter === 'incident'}
               onClick={() => handleSectionClick('incident')}
             />
+
+            {!effectivelyCollapsed && (
+              <div className="px-2 py-2">
+                <div className="relative">
+                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-ol" />
+                  <Input
+                    data-testid="incident-search-input"
+                    placeholder={t('opsV2.rail.searchIncidents')}
+                    value={searchQuery}
+                    onChange={(e) => setSearchQuery(e.target.value)}
+                    className="h-7 pl-7 text-xs bg-bg-app border-[hsl(var(--border))] focus-visible:ring-1"
+                  />
+                  {isSearching && (
+                    <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-ol" />
+                  )}
+                </div>
+              </div>
+            )}
+
             {!effectivelyCollapsed && groupedIncidents.length === 0 && (
-              <p className="px-2 py-1 text-xs text-muted-ol">{t('opsV2.empty.noActiveIssues')}</p>
+              <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
+                <AlertCircle className="mb-2 h-6 w-6 text-muted-ol/50" />
+                <p className="text-xs font-medium text-primary-ol">
+                  {searchResults !== null ? (
+                    <span data-testid="incident-search-empty">
+                      {t('opsV2.empty.noSearchResults')}
+                    </span>
+                  ) : (
+                    t('opsV2.empty.noActiveIssues')
+                  )}
+                </p>
+                <p className="text-[11px] text-muted-ol mt-1">
+                  {searchResults !== null
+                    ? t('opsV2.empty.noSearchResultsDesc')
+                    : t('opsV2.empty.noActiveIssuesDesc')}
+                </p>
+              </div>
             )}
-            {groupedIncidents.map(({ incident, count, groupKey }) => (
+            {groupedIncidents.map(({ incident, count, groupKey, lastEventTime }) => (
               <IncidentRow
                 key={groupKey}
                 incident={incident}
                 count={count}
+                lastEventTime={lastEventTime}
                 collapsed={effectivelyCollapsed}
+                onClick={() => onIncidentSelect?.(incident.id)}
               />
             ))}
           </div>
diff --git a/web/src/components/ops/v2/MainFeedGrid.tsx b/web/src/components/ops/v2/MainFeedGrid.tsx
index 8a14098..204fac4 100644
--- a/web/src/components/ops/v2/MainFeedGrid.tsx
+++ b/web/src/components/ops/v2/MainFeedGrid.tsx
@@ -63,11 +63,20 @@ export interface Thread {
   isExpanded: boolean;
   triggerType?: string;
   title?: string;
+  cascadeGroup?: string[];
+  aiMetadata?: {
+    model: string;
+    tokensUsed?: number;
+    durationMs?: number;
+  };
 }

 export interface MainFeedGridProps {
   activities: ActivityItem[];
-  onThreadSelect?: (correlationId: string) => void;
+  onThreadSelect?: (correlationId: string, incidentId?: string) => void;
+  isFiltered?: boolean;
+  onClearFilters?: () => void;
+  focusedIndex?: number;
 }

 // ---------------------------------------------------------------------------
@@ -91,6 +100,17 @@ function eventCategory(type: string): string {
   return type;
 }

+function formatDurationMs(ms: number): string {
+  if (ms < 1000) return `${ms}ms`;
+  const totalSeconds = Math.floor(ms / 1000);
+  const minutes = Math.floor(totalSeconds / 60);
+  const seconds = totalSeconds % 60;
+  if (minutes > 0) {
+    return `${minutes}m ${seconds}s`;
+  }
+  return `${(ms / 1000).toFixed(1)}s`;
+}
+
 function groupIntoThreads(
   items: ActivityItem[],
   t: (key: string) => string,
@@ -135,6 +155,32 @@ function groupIntoThreads(
     const activeIncident = events.find((e) => e.type === 'incident');
     const title = activeIncident?.title || head.title || humanizeEventType(head.type, t);
     const triggerType = activeIncident?.triggerType;
+    const cascadeEvent = events.find((e) => e.cascadeGroup && e.cascadeGroup.length > 0);
+    const cascadeGroup = cascadeEvent?.cascadeGroup;
+
+    let threadAiMetadata: Thread['aiMetadata'] = undefined;
+    for (const e of events) {
+      if (e.aiMetadata?.model) {
+        if (!threadAiMetadata) {
+          threadAiMetadata = {
+            model: e.aiMetadata.model,
+            tokensUsed: e.aiMetadata.tokensUsed ?? 0,
+            durationMs: e.aiMetadata.durationMs ?? 0,
+          };
+        } else {
+          threadAiMetadata.tokensUsed =
+            (threadAiMetadata.tokensUsed ?? 0) + (e.aiMetadata.tokensUsed ?? 0);
+          threadAiMetadata.durationMs =
+            (threadAiMetadata.durationMs ?? 0) + (e.aiMetadata.durationMs ?? 0);
+        }
+      }
+    }
+    if (threadAiMetadata && threadAiMetadata.tokensUsed === 0) {
+      threadAiMetadata.tokensUsed = undefined;
+    }
+    if (threadAiMetadata && threadAiMetadata.durationMs === 0) {
+      threadAiMetadata.durationMs = undefined;
+    }

     threads.push({
       correlationId: key,
@@ -148,6 +194,8 @@ function groupIntoThreads(
       events,
       title,
       triggerType,
+      cascadeGroup,
+      aiMetadata: threadAiMetadata,
     });
   }

@@ -168,19 +216,74 @@ const ROW_GRID_CLASSES =
 // Sub-components
 // ---------------------------------------------------------------------------

-const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event: ActivityItem }) {
+function EventDetailsContent({
+  event,
+  detailsOpen,
+}: {
+  event: ActivityItem;
+  detailsOpen: boolean;
+}) {
+  const { t } = useLanguage();
+  const hasDiagnosis = !!event.aiMetadata?.diagnosisSummary;
+  const hasShortDescription = !!event.description && event.description.length < 100;
+  const hasLongDescription = !!event.description && event.description.length >= 100;
+
+  if (!hasDiagnosis && !hasShortDescription && !(detailsOpen && hasLongDescription)) {
+    return null;
+  }
+
+  return (
+    <div className="pl-[165px] pr-4 pb-2 pt-1 animate-in fade-in slide-in-from-top-1">
+      {hasDiagnosis && (
+        <div className="mt-0.5 mb-1.5 p-2 bg-agent/5 border border-agent/20 rounded-md">
+          <p className="text-[10px] font-semibold text-agent mb-1 uppercase tracking-wider">
+            {t('ops.aiDiagnosisSummary')}
+          </p>
+          <p className="text-[11px] text-primary-ol leading-relaxed">
+            {event.aiMetadata!.diagnosisSummary}
+          </p>
+        </div>
+      )}
+
+      {(hasShortDescription || (detailsOpen && hasLongDescription)) && (
+        <div className="w-full overflow-hidden mt-0.5">
+          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[11px] text-secondary-ol prose-p:text-[11px] prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-xs prose-headings:font-semibold prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-[11px] prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5">
+            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown>
+          </div>
+        </div>
+      )}
+    </div>
+  );
+}
+
+const ThreadEventDenseRow = memo(function ThreadEventDenseRow({
+  event,
+  threadTitle,
+}: {
+  event: ActivityItem;
+  threadTitle?: string;
+}) {
   const { t, language } = useLanguage();
   const [detailsOpen, setDetailsOpen] = useState(false);

   const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
-  const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;
+  const hasDiagnosis = !!event.aiMetadata?.diagnosisSummary;
+  const hasLongDescription = !!event.description && event.description.length >= 100;
+  const hasAnyDetails = hasDiagnosis || !!event.description;

   const rawTitle =
     event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
   const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);

+  const isDuplicateTitle = threadTitle && titleText === threadTitle;
+
   return (
-    <div className="flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors">
+    <div
+      className={cn(
+        'flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors',
+        hasAnyDetails && 'bg-bg-subtle/30 border-l-2 border-l-agent/50',
+      )}
+    >
       <div className={cn(ROW_GRID_CLASSES, 'py-1.5 text-[11px]')}>
         {/* Empty left gap for alignment with parent chevron */}
         <div className="flex justify-end">
@@ -201,13 +304,15 @@ const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event

         {/* Event Name & Expand Toggle */}
         <div className="flex items-center gap-2 min-w-0">
-          <span
-            className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
-            title={titleText}
-          >
-            {titleText}
-          </span>
-          {hasDetails && (
+          {!isDuplicateTitle && (
+            <span
+              className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
+              title={titleText}
+            >
+              {titleText}
+            </span>
+          )}
+          {hasLongDescription && (
             <button
               type="button"
               onClick={(e) => {
@@ -243,28 +348,7 @@ const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event
       </div>

       {/* Inline Details Expansion */}
-      {detailsOpen && hasDetails && (
-        <div className="pl-[165px] pr-4 pb-2 pt-1 animate-in fade-in slide-in-from-top-1">
-          {event.aiMetadata?.diagnosisSummary && (
-            <div className="mt-0.5 mb-1.5 p-2 bg-agent/5 border border-agent/20 rounded-md">
-              <p className="text-[10px] font-semibold text-agent mb-1 uppercase tracking-wider">
-                {t('ops.aiDiagnosisSummary')}
-              </p>
-              <p className="text-[11px] text-primary-ol leading-relaxed">
-                {event.aiMetadata.diagnosisSummary}
-              </p>
-            </div>
-          )}
-
-          {event.description && (
-            <div className="w-full overflow-hidden mt-0.5">
-              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[11px] text-secondary-ol prose-p:text-[11px] prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-xs prose-headings:font-semibold prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-[11px] prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5">
-                <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown>
-              </div>
-            </div>
-          )}
-        </div>
-      )}
+      <EventDetailsContent event={event} detailsOpen={detailsOpen} />
     </div>
   );
 });
@@ -273,7 +357,13 @@ const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event
 // Main component
 // ---------------------------------------------------------------------------

-export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps) {
+export function MainFeedGrid({
+  activities,
+  onThreadSelect,
+  isFiltered,
+  onClearFilters,
+  focusedIndex = 0,
+}: MainFeedGridProps) {
   const { t, language } = useLanguage();

   const threadData = useMemo(() => {
@@ -310,9 +400,9 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
   }, [allExpanded, threadData]);

   const toggleThread = useCallback(
-    (correlationId: string) => {
+    (correlationId: string, incidentId?: string) => {
       setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
-      onThreadSelect?.(correlationId);
+      onThreadSelect?.(correlationId, incidentId);
     },
     [onThreadSelect],
   );
@@ -325,10 +415,33 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
   }, []);

   if (activities.length === 0) {
+    if (isFiltered) {
+      return (
+        <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
+          <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
+          <h3 className="text-sm font-semibold text-primary-ol mb-1">
+            {t('opsV2.empty.filteredTitle')}
+          </h3>
+          <p className="text-sm text-muted-ol mb-4">{t('opsV2.empty.filteredDesc')}</p>
+          {onClearFilters && (
+            <button
+              onClick={onClearFilters}
+              className="text-xs font-medium text-primary-ol bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-3 py-1.5 rounded transition-colors"
+            >
+              {t('opsV2.timeline.clearFilters')}
+            </button>
+          )}
+        </div>
+      );
+    }
+
     return (
       <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
         <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
-        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivity')}</p>
+        <h3 className="text-sm font-semibold text-primary-ol mb-1">
+          {t('opsV2.empty.noActivityTitle')}
+        </h3>
+        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivityDesc')}</p>
       </div>
     );
   }
@@ -367,10 +480,11 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)

       {/* Body Rows */}
       <div className="flex flex-col bg-app border-b border-[hsl(var(--border))]" role="rowgroup">
-        {threadData.slice(0, visibleThreadCount).map((thread) => {
+        {threadData.slice(0, visibleThreadCount).map((thread, index) => {
           const isExpanded = !!expandedMap[thread.correlationId];
           const isCritical = thread.severity === 'critical';
           const isWarning = thread.severity === 'warning';
+          const isFocused = index === focusedIndex;
           const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
           const visibleEvents = thread.events.slice(0, maxVisibleEvents);
           const hiddenEventCount = thread.events.length - visibleEvents.length;
@@ -379,11 +493,20 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
             <Collapsible
               key={thread.correlationId}
               open={isExpanded}
-              onOpenChange={() => toggleThread(thread.correlationId)}
+              onOpenChange={() =>
+                toggleThread(
+                  thread.correlationId,
+                  thread.events.find((e) => e.incidentId)?.incidentId,
+                )
+              }
               className={cn(
                 'group border-b border-[hsl(var(--border))]/50 last:border-0 transition-colors',
                 isCritical && 'bg-error/5',
                 isWarning && !isCritical && 'bg-warning/5',
+                thread.cascadeGroup &&
+                  thread.cascadeGroup.length > 0 &&
+                  'border-l-2 border-l-warning',
+                isFocused && 'ring-1 ring-agent/50 ring-inset',
               )}
             >
               {/* Parent Row */}
@@ -425,14 +548,35 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
                         ? localizeTitle(thread.title, t as unknown as (key: string) => string)
                         : thread.title}
                     </span>
-                    {thread.triggerType && (
-                      <span className="truncate text-[10px] font-mono text-muted-ol mt-0.5">
-                        {humanizeEventType(
-                          thread.triggerType,
-                          t as unknown as (key: string) => string,
-                        )}
-                      </span>
-                    )}
+                    <div className="flex items-center gap-2 mt-0.5">
+                      {thread.triggerType && (
+                        <span className="truncate text-[10px] font-mono text-muted-ol">
+                          {humanizeEventType(
+                            thread.triggerType,
+                            t as unknown as (key: string) => string,
+                          )}
+                        </span>
+                      )}
+                      {thread.cascadeGroup && thread.cascadeGroup.length > 0 && (
+                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">
+                          ⚡{' '}
+                          {t('opsV2.cascade.affected', {
+                            projects: thread.cascadeGroup.join(', '),
+                          })}
+                        </span>
+                      )}
+                      {thread.aiMetadata && (
+                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-agent bg-agent/10 px-1.5 py-0.5 rounded">
+                          {thread.aiMetadata.model}
+                          {thread.aiMetadata.tokensUsed
+                            ? ` · ${thread.aiMetadata.tokensUsed.toLocaleString()} ${t('opsV2.ai.tokens')}`
+                            : ''}
+                          {thread.aiMetadata.durationMs
+                            ? ` · ${formatDurationMs(thread.aiMetadata.durationMs)}`
+                            : ''}
+                        </span>
+                      )}
+                    </div>
                   </div>

                   <div role="cell">
@@ -471,11 +615,24 @@ export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps)
                 </button>
               </CollapsibleTrigger>

+              {/* Inline details for 1-event thread */}
+              {thread.eventCount === 1 && !isExpanded && (
+                <EventDetailsContent event={thread.events[0]} detailsOpen={false} />
+              )}
+
               {/* Child Events Section */}
               <CollapsibleContent>
                 <div className="bg-bg-panel/20 shadow-inner">
                   {visibleEvents.map((event) => (
-                    <ThreadEventDenseRow key={event.id} event={event} />
+                    <ThreadEventDenseRow
+                      key={event.id}
+                      event={event}
+                      threadTitle={
+                        thread.title
+                          ? localizeTitle(thread.title, t as unknown as (key: string) => string)
+                          : undefined
+                      }
+                    />
                   ))}

                   {/* Load more within thread */}
diff --git a/web/src/pages/OpsCenterV2.tsx b/web/src/pages/OpsCenterV2.tsx
index 589395b..1d59d84 100644
--- a/web/src/pages/OpsCenterV2.tsx
+++ b/web/src/pages/OpsCenterV2.tsx
@@ -1,14 +1,20 @@
-import { useState, useEffect, useCallback, useMemo } from 'react';
-import { X } from 'lucide-react';
+import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
+import { X, AlertCircle, RefreshCw, Loader2, Activity, Network } from 'lucide-react';
 import { useLanguage } from '@/i18n/context';
 import { useOpsCenterData } from '@/hooks/use-ops-center-data';
+import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
 import { StatusStrip } from '@/components/ops/v2/StatusStrip';
 import { LeftRail } from '@/components/ops/v2/LeftRail';
 import { MainFeedGrid } from '@/components/ops/v2/MainFeedGrid';
 import { FilterBar, useFilterSearchParams } from '@/components/ops/v2/FilterBar';
+import { CircuitBreakerWidget } from '@/components/ops/v2/CircuitBreakerWidget';
+import { IncidentDetailSlideover } from '@/components/ops/v2/IncidentDetailSlideover';
+import { KeyboardShortcutsHelp } from '@/components/ops/v2/KeyboardShortcutsHelp';
 import { cn } from '@/lib/utils';
 import type { CircuitBreakerState, ActivityItem } from '@/lib/api/operations';

+const DependencyGraph = React.lazy(() => import('../components/ops/v2/DependencyGraph.js'));
+
 function deriveHealthState(
   incidents: { severity: string }[],
   circuitBreakers: CircuitBreakerState[],
@@ -38,6 +44,9 @@ function useBreakpoint(maxWidthPx: number): boolean {

 export function OpsCenterV2() {
   const { t } = useLanguage();
+  // Filter state (synced with URL search params)
+  const [filters, setFilters] = useFilterSearchParams();
+
   const {
     activities,
     incidents,
@@ -46,23 +55,81 @@ export function OpsCenterV2() {
     isConnected,
     isReconnecting,
     isLoading,
-  } = useOpsCenterData();
+    error,
+    retry,
+  } = useOpsCenterData(filters.timeRange);

   // Responsive breakpoints
   const isBelowMd = useBreakpoint(768); // < md: hide rail, show drawer trigger
   const isBelowLg = useBreakpoint(1024); // < lg: force icon-only rail

-  // Mobile drawer state
   const [drawerOpen, setDrawerOpen] = useState(false);

+  const [viewMode, setViewMode] = useState<'feed' | 'graph'>('feed');
+
+  // Incident slideover state
+  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
+
+  // Keyboard shortcuts state
+  const [currentFocusIndex, setCurrentFocusIndex] = useState(0);
+
   const openDrawer = useCallback(() => setDrawerOpen(true), []);
   const closeDrawer = useCallback(() => setDrawerOpen(false), []);

+  const handleThreadSelect = useCallback((_correlationId: string, incidentId?: string) => {
+    if (incidentId) {
+      setSelectedIncidentId(incidentId);
+    }
+  }, []);
+
   // Close drawer when resizing past md breakpoint
   useEffect(() => {
     if (!isBelowMd) setDrawerOpen(false);
   }, [isBelowMd]);

+  // Keyboard shortcuts
+  const threadCount = useMemo(() => {
+    const threads = activities.length > 0 ? activities.length : 0;
+    return threads;
+  }, [activities]);
+
+  useKeyboardShortcuts([
+    {
+      key: 'j',
+      handler: () => {
+        setCurrentFocusIndex((prev) => Math.min(prev + 1, Math.max(0, threadCount - 1)));
+      },
+    },
+    {
+      key: 'k',
+      handler: () => {
+        setCurrentFocusIndex((prev) => Math.max(prev - 1, 0));
+      },
+    },
+    {
+      key: '/',
+      handler: () => {
+        const searchInput = document.querySelector(
+          '[data-testid="incident-search-input"]',
+        ) as HTMLInputElement;
+        searchInput?.focus();
+      },
+    },
+    {
+      key: 'Escape',
+      handler: () => {
+        setSelectedIncidentId(null);
+      },
+    },
+    {
+      key: '?',
+      handler: () => {
+        const helpButton = document.querySelector('[aria-label*="Keyboard"]') as HTMLButtonElement;
+        helpButton?.click();
+      },
+    },
+  ]);
+
   const healthState = deriveHealthState(incidents, circuitBreakers);
   const trippedCount = circuitBreakers.filter((cb) => cb.state === 'open').length;
   const isAgentActive = activities.some(
@@ -75,9 +142,6 @@ export function OpsCenterV2() {
       ? 'reconnecting'
       : 'disconnected';

-  // Filter state (synced with URL search params)
-  const [filters, setFilters] = useFilterSearchParams();
-
   // Derive unique projects for filter dropdown
   const projects = useMemo(() => {
     const seen = new Map<string, string>();
@@ -127,6 +191,7 @@ export function OpsCenterV2() {
             incidents={incidents}
             circuitBreakers={circuitBreakers}
             forceCollapsed={isBelowLg ? true : undefined}
+            onIncidentSelect={setSelectedIncidentId}
           />
         </div>

@@ -172,6 +237,10 @@ export function OpsCenterV2() {
                 incidents={incidents}
                 circuitBreakers={circuitBreakers}
                 forceCollapsed={false}
+                onIncidentSelect={(id) => {
+                  setSelectedIncidentId(id);
+                  closeDrawer();
+                }}
               />
             </div>
           </>
@@ -181,22 +250,120 @@ export function OpsCenterV2() {
         <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
           <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-6">
             {/* Page header */}
-            <div>
+            <div className="flex items-center justify-between">
               <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
                 {t('opsV2.page.title')}
               </h1>
+              <div className="flex items-center gap-3">
+                <KeyboardShortcutsHelp />
+                <div className="flex items-center bg-bg-subtle rounded-lg p-1 border border-[hsl(var(--border))]">
+                  <button
+                    onClick={() => setViewMode('feed')}
+                    className={cn(
+                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
+                      viewMode === 'feed'
+                        ? 'bg-bg-panel text-primary-ol shadow-sm'
+                        : 'text-muted-ol hover:text-secondary-ol',
+                    )}
+                  >
+                    <Activity className="h-4 w-4" />
+                    {t('opsV2.graph.feedView')}
+                  </button>
+                  <button
+                    onClick={() => setViewMode('graph')}
+                    className={cn(
+                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
+                      viewMode === 'graph'
+                        ? 'bg-bg-panel text-primary-ol shadow-sm'
+                        : 'text-muted-ol hover:text-secondary-ol',
+                    )}
+                  >
+                    <Network className="h-4 w-4" />
+                    {t('opsV2.graph.graphView')}
+                  </button>
+                </div>
+              </div>
             </div>

+            {/* Error Banners */}
+            {isReconnecting && (
+              <div className="flex items-center gap-3 rounded-md bg-warning/10 border border-warning/20 px-4 py-3 text-sm text-warning">
+                <Loader2 className="h-4 w-4 animate-spin text-warning" />
+                <p>
+                  {t('opsV2.errors.retrying').replace('{count}', String(error?.retryCount ?? 1))}
+                </p>
+              </div>
+            )}
+            {error && !isReconnecting && (
+              <div className="flex items-center justify-between gap-3 rounded-md bg-error/10 border border-error/20 px-4 py-3 text-sm text-error">
+                <div className="flex items-center gap-3">
+                  <AlertCircle className="h-4 w-4 text-error" />
+                  <p>
+                    {error.type === 'connection_lost'
+                      ? t('opsV2.errors.connectionLost')
+                      : error.type === 'api_error'
+                        ? t('opsV2.errors.apiError')
+                        : error.message}
+                  </p>
+                </div>
+                <button
+                  onClick={retry}
+                  className="flex items-center gap-2 rounded bg-bg-panel px-3 py-1.5 text-xs font-medium text-primary-ol hover:bg-bg-subtle border border-[hsl(var(--border))] transition-colors"
+                >
+                  <RefreshCw className="h-3 w-3" />
+                  {t('opsV2.errors.retry')}
+                </button>
+              </div>
+            )}
+
             {/* Filters */}
-            <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />
+            {viewMode === 'feed' && (
+              <div className="flex flex-col lg:flex-row gap-6 items-start">
+                <div className="flex-1 w-full">
+                  <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />
+                </div>
+                {circuitBreakers.length > 0 && (
+                  <div className="w-full lg:w-64 shrink-0 bg-bg-subtle/30 rounded-lg border border-[hsl(var(--border))] p-3">
+                    <CircuitBreakerWidget
+                      circuitBreakers={circuitBreakers}
+                      onFilter={() => setFilters({ density: 'actions-only' })}
+                    />
+                  </div>
+                )}
+              </div>
+            )}

-            {/* Main content — feed grid */}
             <main className="min-w-0">
-              <MainFeedGrid activities={filteredActivities} />
+              {viewMode === 'feed' ? (
+                <MainFeedGrid
+                  activities={filteredActivities}
+                  isFiltered={activities.length > 0 && filteredActivities.length === 0}
+                  onClearFilters={() => setFilters({ density: 'all' })}
+                  onThreadSelect={handleThreadSelect}
+                  focusedIndex={currentFocusIndex}
+                />
+              ) : (
+                <div className="h-[600px] w-full">
+                  <Suspense
+                    fallback={
+                      <div className="flex items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))]">
+                        <Loader2 className="h-8 w-8 animate-spin text-muted-ol" />
+                      </div>
+                    }
+                  >
+                    <DependencyGraph />
+                  </Suspense>
+                </div>
+              )}
             </main>
           </div>
         </div>
       </div>
+
+      <IncidentDetailSlideover
+        incidentId={selectedIncidentId}
+        onClose={() => setSelectedIncidentId(null)}
+      />
     </div>
   );
 }

codex
지금부터는 타입 정의 흐름과 새로 추가된 UI 컴포넌트 쪽을 같이 확인합니다. 특히 `ActivityItem` 계약, React Flow/lazy 컴포넌트, 검색/시간필터가 기존 API 소비자와 충돌하는지 보고 있습니다.
exec
/bin/bash -lc "sed -n '1,280p' web/src/components/ops/v2/IncidentDetailSlideover.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SeverityBadge } from '@/components/ops/SeverityBadge';
import { IncidentTimeline } from '@/components/ops/IncidentTimeline';
import { fetchOpsIncident } from '@/lib/api/operations';
import type { OpsIncident, OpsIncidentEvent } from '@/lib/api/operations';
import { Loader2, AlertCircle, Clock } from 'lucide-react';
import { humanizeEventType } from '@/components/ops/utils';
import { cn } from '@/lib/utils';

interface IncidentDetailSlideoverProps {
  incidentId: string | null;
  onClose: () => void;
}

export function IncidentDetailSlideover({ incidentId, onClose }: IncidentDetailSlideoverProps) {
  const { t } = useLanguage();
  const [incident, setIncident] = useState<OpsIncident | null>(null);
  const [events, setEvents] = useState<OpsIncidentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) {
      setIncident(null);
      setEvents([]);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchOpsIncident(incidentId)
      .then((data) => {
        if (isMounted) {
          setIncident(data.incident);
          setEvents(data.events);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : t('opsV2.incident.loadError'));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [incidentId]);

  const isOpen = incidentId !== null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg p-0 flex flex-col bg-app border-l border-[hsl(var(--border))]"
      >
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-ol" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <AlertCircle className="h-8 w-8 text-error mb-4" />
            <p className="text-sm text-error">{error}</p>
          </div>
        ) : incident ? (
          <>
            <div className="shrink-0 border-b border-[hsl(var(--border))] p-6 bg-bg-panel">
              <SheetHeader className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <SheetTitle className="text-lg font-display font-semibold text-primary-ol">
                      {incident.title}
                    </SheetTitle>
                    <SheetDescription className="text-sm text-secondary-ol">
                      {incident.projectName || incident.project_id}
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <span
                    className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full border',
                      incident.status === 'active'
                        ? 'bg-warning/10 text-warning border-warning/20'
                        : incident.status === 'resolved'
                          ? 'bg-success/10 text-success border-success/20'
                          : 'bg-bg-subtle text-secondary-ol border-[hsl(var(--border))]',
                    )}
                  >
                    {t(`opsV2.status.${incident.status}`)}
                  </span>
                  {incident.status === 'active' && (
                    <span className="text-xs text-agent animate-pulse flex items-center gap-1.5 ml-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('opsV2.incident.recovering')}
                    </span>
                  )}
                </div>
              </SheetHeader>
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-8">
                {/* Trigger Info */}
                {incident.triggerType && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.trigger')}
                    </h3>
                    <div className="bg-bg-subtle/50 rounded-md p-3 border border-[hsl(var(--border))]">
                      <p className="text-sm text-secondary-ol font-medium">
                        {humanizeEventType(incident.triggerType ?? 'unknown', t)}
                      </p>
                      {incident.triggerDetails && (
                        <p className="text-xs text-muted-ol mt-1 font-mono break-all">
                          {incident.triggerDetails}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Diagnosis & Root Cause */}
                {(incident.diagnosis || incident.root_cause) && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.diagnosis')}
                    </h3>
                    <div className="bg-agent/5 border border-agent/20 rounded-md p-4 space-y-4">
                      {incident.root_cause && (
                        <div>
                          <h4 className="text-xs font-semibold text-agent mb-1 uppercase tracking-wider">
                            {t('opsV2.incident.rootCause')}
                          </h4>
                          <p className="text-sm text-primary-ol leading-relaxed">
                            {incident.root_cause}
                          </p>
                        </div>
                      )}
                      {incident.diagnosis && (
                        <div>
                          <h4 className="text-xs font-semibold text-agent mb-1 uppercase tracking-wider">
                            {t('opsV2.incident.diagnosis')}
                          </h4>
                          <p className="text-sm text-primary-ol leading-relaxed">
                            {incident.diagnosis}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions Taken */}
                {incident.actions_taken && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.actionsTaken')}
                    </h3>
                    <div className="bg-bg-subtle/50 rounded-md p-4 border border-[hsl(var(--border))]">
                      <p className="text-sm text-secondary-ol leading-relaxed whitespace-pre-wrap">
                        {incident.actions_taken}
                      </p>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary-ol">
                    {t('opsV2.incident.timeline')}
                  </h3>
                  {events.length > 0 ? (
                    <IncidentTimeline events={events} />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center border rounded border-dashed border-[hsl(var(--border))]">
                      <Clock className="mb-2 h-6 w-6 text-muted-ol/50" />
                      <p className="text-sm font-medium text-primary-ol">
                        {t('opsV2.incident.noEventsTitle')}
                      </p>
                      <p className="text-xs text-muted-ol mt-1">
                        {t('opsV2.incident.noEventsDesc')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

exec
/bin/bash -lc "sed -n '1,260p' web/src/components/ops/v2/DependencyGraph.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position,
  MarkerType,
} from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { fetchDependencyGraph } from '@/lib/api/operations';
import type { DependencyNode, DependencyEdge } from '@/lib/api/operations';
import { useLanguage } from '@/i18n/context';
import { Loader2, AlertCircle, Share2 } from 'lucide-react';

const nodeWidth = 200;
const nodeHeight = 60;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
    return newNode;
  });

  return { nodes: newNodes, edges };
};

export default function DependencyGraph() {
  const { t } = useLanguage();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadGraph() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchDependencyGraph();

        if (!mounted) return;

        const initialNodes: Node[] = data.nodes.map((n: DependencyNode) => {
          let bgColor = 'bg-amber-500/10';
          let borderColor = 'border-amber-500/30';
          let textColor = 'text-amber-500';

          if (n.status === 'running') {
            bgColor = 'bg-green-500/10';
            borderColor = 'border-green-500/30';
            textColor = 'text-green-500';
          } else if (n.status === 'error') {
            bgColor = 'bg-red-500/10';
            borderColor = 'border-red-500/30';
            textColor = 'text-red-500';
          }

          return {
            id: n.id,
            data: {
              label: (
                <div className="flex flex-col items-center justify-center h-full">
                  <div className="font-medium text-sm text-primary-ol truncate w-full text-center px-2">
                    {n.name}
                  </div>
                  <div className={`text-xs mt-1 ${textColor}`}>
                    {n.type === 'project'
                      ? t('opsV2.graph.nodeTypeProject')
                      : t('opsV2.graph.nodeTypeService')}
                  </div>
                </div>
              ),
            },
            position: { x: 0, y: 0 },
            className: `rounded-md border-2 ${bgColor} ${borderColor} shadow-sm`,
            style: { width: nodeWidth, height: nodeHeight },
          };
        });

        const initialEdges: Edge[] = data.edges.map((e: DependencyEdge) => ({
          id: `${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'hsl(var(--muted-foreground))',
          },
          style: { stroke: 'hsl(var(--muted-foreground))' },
        }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          initialNodes,
          initialEdges,
          'TB',
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : t('opsV2.error.loadFailed'));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadGraph();

    return () => {
      mounted = false;
    };
  }, [setNodes, setEdges]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-ol" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] text-error p-6 text-center">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>{error}</p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] text-center p-6">
        <Share2 className="mb-3 h-8 w-8 text-muted-ol/50" />
        <h3 className="text-sm font-semibold text-primary-ol mb-1">
          {t('opsV2.graph.emptyTitle')}
        </h3>
        <p className="text-sm text-muted-ol">{t('opsV2.graph.emptyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="hsl(var(--border))" gap={16} />
        <Controls className="bg-bg-panel border-[hsl(var(--border))] fill-primary-ol" />
        <MiniMap
          nodeColor={(n) => {
            if (n.className?.includes('green')) return '#22c55e';
            if (n.className?.includes('red')) return '#ef4444';
            return '#f59e0b';
          }}
          maskColor="hsl(var(--background) / 0.6)"
          className="bg-bg-panel border-[hsl(var(--border))]"
        />
      </ReactFlow>
    </div>
  );
}

exec
/bin/bash -lc "sed -n '1,260p' web/src/components/ops/v2/MainFeedGrid.tsx" in /home/lee/OpenLander
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
  [/^Auto-recovery failed/i, 'opsV2.titles.autoRecoveryFailed'],
  [/^Auto-recovery succeeded$/i, 'opsV2.titles.autoRecoveryCompleted'],
  [/^Auto-recovery attempt/i, 'opsV2.titles.autoRecoveryRunning'],
  [/^Auto-recovery exhausted$/i, 'opsV2.titles.autoRecoveryFailed'],
  [/^Incident detected$/i, 'opsV2.titles.incidentDetected'],
  [/^Health check failed/i, 'opsV2.titles.healthCheckFailed'],
  [/^Health degraded$/i, 'opsV2.titles.healthCheckFailed'],
  [/^Deploy crashed$/i, 'opsV2.titles.deployCrash'],
  [/^Deploy failed/i, 'opsV2.titles.deployFailed'],
  [/^Compose failed$/i, 'opsV2.titles.deployFailed'],
  [/^Circuit breaker open/i, 'opsV2.titles.circuitBreakerOpen'],
  [/^Circuit breaker reset/i, 'opsV2.titles.circuitBreakerReset'],
];

function localizeTitle(title: string, t: (key: string) => string): string {
  for (const [pattern, key] of TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return t(key);
    }
  }
  return humanizeEventType(title, t);
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
  cascadeGroup?: string[];
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
  };
}

export interface MainFeedGridProps {
  activities: ActivityItem[];
  onThreadSelect?: (correlationId: string, incidentId?: string) => void;
  isFiltered?: boolean;
  onClearFilters?: () => void;
  focusedIndex?: number;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

function eventCategory(type: string): string {
  if (
    type === 'recovery' ||
    type === 'approval' ||
    type === 'incident' ||
    type === 'recovery:blocked' ||
    type === 'recovery:stopped' ||
    type === 'recovery:started'
  ) {
    return 'recovery';
  }
  if (type === 'deploy' || type === 'build') {
    return 'deploy';
  }
  return type;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function groupIntoThreads(
  items: ActivityItem[],
  t: (key: string) => string,
): Omit<Thread, 'isExpanded'>[] {
  const threadMap = new Map<string, ActivityItem[]>();
  const orderKeys: string[] = [];

  for (const item of items) {
    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    const category = eventCategory(item.type);
    const key = item.correlationId || `${item.projectId}::${category}::${tsBucket}`;

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
    const title = activeIncident?.title || head.title || humanizeEventType(head.type, t);
    const triggerType = activeIncident?.triggerType;
    const cascadeEvent = events.find((e) => e.cascadeGroup && e.cascadeGroup.length > 0);
    const cascadeGroup = cascadeEvent?.cascadeGroup;

    let threadAiMetadata: Thread['aiMetadata'] = undefined;
    for (const e of events) {
      if (e.aiMetadata?.model) {
        if (!threadAiMetadata) {
          threadAiMetadata = {
            model: e.aiMetadata.model,
            tokensUsed: e.aiMetadata.tokensUsed ?? 0,
            durationMs: e.aiMetadata.durationMs ?? 0,
          };
        } else {
          threadAiMetadata.tokensUsed =
            (threadAiMetadata.tokensUsed ?? 0) + (e.aiMetadata.tokensUsed ?? 0);
          threadAiMetadata.durationMs =
            (threadAiMetadata.durationMs ?? 0) + (e.aiMetadata.durationMs ?? 0);
        }
      }
    }
    if (threadAiMetadata && threadAiMetadata.tokensUsed === 0) {
      threadAiMetadata.tokensUsed = undefined;
    }
    if (threadAiMetadata && threadAiMetadata.durationMs === 0) {
      threadAiMetadata.durationMs = undefined;
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
      title,
      triggerType,
      cascadeGroup,
      aiMetadata: threadAiMetadata,
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

function EventDetailsContent({
  event,
  detailsOpen,
}: {
  event: ActivityItem;
  detailsOpen: boolean;
}) {
  const { t } = useLanguage();
  const hasDiagnosis = !!event.aiMetadata?.diagnosisSummary;
  const hasShortDescription = !!event.description && event.description.length < 100;
  const hasLongDescription = !!event.description && event.description.length >= 100;

  if (!hasDiagnosis && !hasShortDescription && !(detailsOpen && hasLongDescription)) {
    return null;
  }

  return (
    <div className="pl-[165px] pr-4 pb-2 pt-1 animate-in fade-in slide-in-from-top-1">
      {hasDiagnosis && (
        <div className="mt-0.5 mb-1.5 p-2 bg-agent/5 border border-agent/20 rounded-md">
          <p className="text-[10px] font-semibold text-agent mb-1 uppercase tracking-wider">
            {t('ops.aiDiagnosisSummary')}
          </p>
          <p className="text-[11px] text-primary-ol leading-relaxed">
            {event.aiMetadata!.diagnosisSummary}
          </p>
        </div>
      )}

      {(hasShortDescription || (detailsOpen && hasLongDescription)) && (
        <div className="w-full overflow-hidden mt-0.5">
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[11px] text-secondary-ol prose-p:text-[11px] prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-xs prose-headings:font-semibold prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-[11px] prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

const ThreadEventDenseRow = memo(function ThreadEventDenseRow({
  event,

exec
/bin/bash -lc "rg -n \"export interface ActivityItem|interface ActivityItem|type ActivityItem\" web/src src -g '"'!dist'"'" in /home/lee/OpenLander
 succeeded in 0ms:
web/src/hooks/use-ops-center-data.ts:6:  type ActivityItem,
web/src/lib/api/operations.ts:150:export interface ActivityItem {
src/web/api/ops-routes.ts:10:interface ActivityItem {

exec
/bin/bash -lc "sed -n '130,260p' web/src/lib/api/operations.ts" in /home/lee/OpenLander
 succeeded in 0ms:
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
  from?: number;
  to?: number;
}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts?.projectId) params.set('projectId', opts.projectId);
  if (opts?.types?.length) params.set('types', opts.types.join(','));
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  if (opts?.from !== undefined) params.set('from', String(opts.from));
  if (opts?.to !== undefined) params.set('to', String(opts.to));
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

exec
/bin/bash -lc "sed -n '1,260p' web/src/hooks/use-keyboard-shortcuts.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Shortcut {
  key: string; // 'j', 'k', '/', 'Escape', '?'
  handler: () => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useKeyboardShortcuts
 *
 * Registers keyboard shortcuts with automatic disabling when focus is on
 * input, textarea, select, or contenteditable elements.
 *
 * @param shortcuts - Array of shortcut definitions
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: 'j', handler: () => console.log('next') },
 *   { key: 'k', handler: () => console.log('prev') },
 *   { key: '/', handler: () => console.log('search') },
 *   { key: 'Escape', handler: () => console.log('close') },
 *   { key: '?', handler: () => console.log('help') },
 * ]);
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if focus is on an input-like element
      const target = event.target as HTMLElement;
      const isInputLike =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.contentEditable === 'true');

      // Skip shortcuts if focused on input-like element
      if (isInputLike) {
        return;
      }

      // Find matching shortcut
      const shortcut = shortcuts.find((s) => s.key === event.key && !s.disabled);

      if (shortcut) {
        event.preventDefault();
        shortcut.handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts]);
}

exec
/bin/bash -lc "sed -n '1,260p' web/src/components/ops/v2/KeyboardShortcutsHelp.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { useLanguage } from '../../../i18n/context.js';
import { cn } from '../../../lib/utils.js';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KeyboardShortcutsHelpProps {
  className?: string;
}

export function KeyboardShortcutsHelp({ className }: KeyboardShortcutsHelpProps) {
  const { t } = useLanguage();

  const shortcuts = [
    { key: 'J', description: t('opsV2.shortcuts.nextItem') },
    { key: 'K', description: t('opsV2.shortcuts.prevItem') },
    { key: '/', description: t('opsV2.shortcuts.search') },
    { key: 'Esc', description: t('opsV2.shortcuts.close') },
    { key: '?', description: t('opsV2.shortcuts.help') },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors',
            className,
          )}
          aria-label={t('opsV2.shortcuts.helpLabel')}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-sm">{t('opsV2.shortcuts.title')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('opsV2.shortcuts.description')}</p>
          </div>
          <div className="space-y-2">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{shortcut.description}</span>
                <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-subtle rounded border border-border">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

exec
/bin/bash -lc "sed -n '1,240p' web/src/components/ops/v2/CircuitBreakerWidget.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { resetCircuitBreaker } from '../../../lib/api/operations.js';
import type { CircuitBreakerWithProject } from '../../../lib/api/operations.js';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

interface CircuitBreakerWidgetProps {
  circuitBreakers: CircuitBreakerWithProject[];
  onFilter?: () => void;
}

const MAX_VISIBLE = 3;

const STATE_STYLES: Record<'open' | 'half_open' | 'closed', { badge: string; label: string }> = {
  open: {
    badge: 'bg-destructive/15 text-destructive',
    label: 'opsV2.widgets.circuitBreakers.open',
  },
  half_open: {
    badge: 'bg-warning/15 text-warning',
    label: 'opsV2.widgets.circuitBreakers.halfOpen',
  },
  closed: {
    badge: 'bg-success/15 text-success',
    label: 'opsV2.widgets.circuitBreakers.closed',
  },
};

function CircuitBreakerItem({ cb }: { cb: CircuitBreakerWithProject }) {
  const { t } = useLanguage();
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const state = cb.state as 'open' | 'half_open' | 'closed';
  const styles = STATE_STYLES[state] ?? STATE_STYLES.closed;
  const isOpen = state === 'open';

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetCircuitBreaker(cb.projectId);
      toast.success(t('opsV2.widgets.circuitBreakers.resetSuccess'));
      setShowConfirm(false);
    } catch {
      toast.error(t('opsV2.widgets.circuitBreakers.resetError'));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-bg-subtle transition-colors group">
        <span className="min-w-0 flex-1 truncate text-foreground" title={cb.projectName}>
          {cb.projectName}
        </span>
        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-bg-panel rounded text-muted-foreground hover:text-foreground"
              title={t('opsV2.widgets.circuitBreakers.reset')}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          <span
            className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', styles.badge)}
          >
            {t(styles.label)}
          </span>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('opsV2.widgets.circuitBreakers.resetConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('opsV2.widgets.circuitBreakers.resetConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(false)}
              disabled={isResetting}
            >
              {t('opsV2.approvals.confirmCancel')}
            </Button>
            <Button size="sm" onClick={() => void handleReset()} disabled={isResetting}>
              {isResetting ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : null}
              {t('opsV2.widgets.circuitBreakers.reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CircuitBreakerWidget({ circuitBreakers, onFilter }: CircuitBreakerWidgetProps) {
  const { t } = useLanguage();

  const visible = circuitBreakers.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, circuitBreakers.length - MAX_VISIBLE);
  const hasAny = circuitBreakers.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldAlert className="h-3 w-3" />
        <span>{t('opsV2.widgets.circuitBreakers.title')}</span>
      </div>

      {!hasAny && (
        <p className="px-1 text-xs text-muted-foreground">
          {t('opsV2.widgets.circuitBreakers.empty')}
        </p>
      )}

      {hasAny && (
        <div className="flex flex-col gap-0.5">
          {visible.map((cb) => (
            <CircuitBreakerItem key={cb.projectId} cb={cb} />
          ))}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onFilter}
              disabled={!onFilter}
              className={cn(
                'rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground',
                onFilter ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              {t('opsV2.widgets.circuitBreakers.showMore', { count: hiddenCount })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

codex
타입체커 기준의 실제 실패 지점을 확인해 두는 게 중요해서 현재 HEAD 상태로 `typecheck`도 한 번 돌려보겠습니다. 리뷰는 커밋 diff 기준으로 하되, 실제 깨지는 지점은 명확히 잡아두겠습니다.
exec
/bin/bash -lc 'npm run typecheck' in /home/lee/OpenLander
 succeeded in 4377ms:
exec
/bin/bash -lc "sed -n '1,260p' src/db/index.ts" in /home/lee/OpenLander
 succeeded in 0ms:
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isNotNull } from 'drizzle-orm';
import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from './drizzle.js';
import { initializeDatabase } from './migration.js';
import { environments, projects } from './schema.drizzle.js';
import { ProjectRepo } from './repos/project.repo.js';
import { EnvironmentRepo } from './repos/environment.repo.js';
import { EnvVarRepo } from './repos/env-var.repo.js';
import { GlobalSecretRepo } from './repos/global-secret.repo.js';
import { SecretFileRepo } from './repos/secret-file.repo.js';
import { ServiceRepo } from './repos/service.repo.js';
import { ServiceConnectionRepo } from './repos/service-connection.repo.js';
import { RuntimeIncidentRepo } from './repos/runtime-incident.repo.js';
import { DeployLogRepo } from './repos/deploy-log.repo.js';
import { TimelineRepo } from './repos/timeline.repo.js';
import { DomainMappingRepo } from './repos/domain-mapping.repo.js';
import { OAuthRepo } from './repos/oauth.repo.js';
import { WebhookRepo } from './repos/webhook.repo.js';
import { DeployPlanRepo } from './repos/deploy-plan.repo.js';
import { DeployConfigRepo } from './repos/deploy-config.repo.js';
import { AuthRepo } from './repos/auth.repo.js';
import { AiUsageLogRepo } from './repos/ai-usage-log.repo.js';
import { ActionRunRepo } from './repos/action-run.repo.js';
import { DeploymentPatternRepo } from './repos/deployment-pattern.repo.js';
import { OpsIncidentRepo } from './repos/ops-incident.repo.js';
import { OpsIncidentEventRepo } from './repos/ops-incident-event.repo.js';
import { CircuitBreakerRepo } from './repos/circuit-breaker.repo.js';
import { ProjectDependencyRepo } from './repos/project-dependency.repo.js';
import { ProjectOpsOverrideRepo } from './repos/project-ops-override.repo.js';
import { ActivityLogRepo } from './repos/activity-log.repo.js';
import type { ProjectRow } from './types.js';
import type { AuthDatabase } from '../auth/auth-service.js';
import type { ProjectOpsOverride } from '../monitor/ops-types.js';

export type {
  EnvironmentType,
  ProjectRow,
  EnvironmentRow,
  DeployLogRow,
  TimelineEventRow,
  DomainMappingRow,
  OAuthTokenRow,
  WebhookConfigRow,
  ServiceRow,
  ServiceConnectionRow,
  RuntimeIncidentRow,
  PendingFixRow,
  DeployPlanRow,
  AuthRow,
  OpsIncidentRow,
  OpsIncidentEventRow,
  CircuitBreakerRow,
  ActivityLogRow,
} from './types.js';

// prettier-ignore
export class Database implements AuthDatabase {
  private sqlite: SqliteDatabase;
  private db: DrizzleClient;
  private readonly projectRepo: ProjectRepo;
  private readonly environmentRepo: EnvironmentRepo;
  private readonly envVarRepo: EnvVarRepo;
  private readonly globalSecretRepo: GlobalSecretRepo;
  private readonly secretFileRepo: SecretFileRepo;
  private readonly serviceRepo: ServiceRepo;
  private readonly serviceConnectionRepo: ServiceConnectionRepo;
  private readonly runtimeIncidentRepo: RuntimeIncidentRepo;
  private readonly deployLogRepo: DeployLogRepo;
  private readonly timelineRepo: TimelineRepo;
  private readonly domainMappingRepo: DomainMappingRepo;
  private readonly oauthRepo: OAuthRepo;
  private readonly webhookRepo: WebhookRepo;
  private readonly deployPlanRepo: DeployPlanRepo;
  private readonly deployConfigRepo: DeployConfigRepo;
  private readonly authRepo: AuthRepo;
  private readonly aiUsageLogRepo: AiUsageLogRepo;
  private readonly actionRunRepo: ActionRunRepo;
  private readonly deploymentPatternRepo: DeploymentPatternRepo;
  private readonly opsIncidentRepo: OpsIncidentRepo;
  private readonly opsIncidentEventRepo: OpsIncidentEventRepo;
  private readonly circuitBreakerRepo: CircuitBreakerRepo;
  private readonly projectDependencyRepo: ProjectDependencyRepo;
  private readonly projectOpsOverrideRepo: ProjectOpsOverrideRepo;
  private readonly activityLogRepo: ActivityLogRepo;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const { sqlite, db } = createDrizzleDatabase(dbPath);
    this.sqlite = sqlite;
    this.db = db;
    initializeDatabase(this.sqlite);
    this.projectRepo = new ProjectRepo(this.db, this.sqlite);
    this.environmentRepo = new EnvironmentRepo(this.db, this.sqlite);
    this.envVarRepo = new EnvVarRepo(this.db, this.sqlite);
    this.globalSecretRepo = new GlobalSecretRepo(this.db, this.sqlite);
    this.secretFileRepo = new SecretFileRepo(this.db, this.sqlite);
    this.serviceRepo = new ServiceRepo(this.db, this.sqlite);
    this.serviceConnectionRepo = new ServiceConnectionRepo(this.db, this.sqlite);
    this.runtimeIncidentRepo = new RuntimeIncidentRepo(this.db, this.sqlite);
    this.deployLogRepo = new DeployLogRepo(this.db, this.sqlite);
    this.timelineRepo = new TimelineRepo(this.db, this.sqlite);
    this.domainMappingRepo = new DomainMappingRepo(this.db, this.sqlite);
    this.oauthRepo = new OAuthRepo(this.db, this.sqlite);
    this.webhookRepo = new WebhookRepo(this.db, this.sqlite);
    this.deployPlanRepo = new DeployPlanRepo(this.db, this.sqlite);
    this.deployConfigRepo = new DeployConfigRepo(this.db, this.sqlite);
    this.authRepo = new AuthRepo(this.db);
    this.aiUsageLogRepo = new AiUsageLogRepo(this.db, this.sqlite);
    this.actionRunRepo = new ActionRunRepo(this.db, this.sqlite);
    this.deploymentPatternRepo = new DeploymentPatternRepo(this.db, this.sqlite);
    this.opsIncidentRepo = new OpsIncidentRepo(this.db, this.sqlite);
    this.opsIncidentEventRepo = new OpsIncidentEventRepo(this.db, this.sqlite);
    this.circuitBreakerRepo = new CircuitBreakerRepo(this.db, this.sqlite);
    this.projectDependencyRepo = new ProjectDependencyRepo(this.db, this.sqlite);
    this.projectOpsOverrideRepo = new ProjectOpsOverrideRepo(this.db, this.sqlite);
    this.activityLogRepo = new ActivityLogRepo(this.db, this.sqlite);
    this.actionRunRepo.markStaleAsFailedOnStartup();
  }

  createProject(project: Parameters<ProjectRepo['createProject']>[0]): ProjectRow { const created = this.projectRepo.createProject(project); this.environmentRepo.createEnvironment({ id: `${project.id}-production`, projectId: created.id, type: 'production', branch: project.branch ?? 'main' }); return created; }
  getProject(id: string) { return this.projectRepo.getProject(id); }
  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
  listProjects(status?: ProjectRow['status'], opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
  archiveProject(id: string) { this.projectRepo.archiveProject(id); }
  unarchiveProject(id: string) { this.projectRepo.unarchiveProject(id); }
  listArchivedProjects() { return this.projectRepo.listArchivedProjects(); }
  isArchived(id: string) { return this.projectRepo.isArchived(id); }
  updateProject(id: string, updates: Parameters<ProjectRepo['updateProject']>[1]) { this.projectRepo.updateProject(id, updates); }
  setPendingFix(projectId: string, pendingFix: Parameters<ProjectRepo['setPendingFix']>[1]) { this.projectRepo.setPendingFix(projectId, pendingFix); }
  consumePendingFix(projectId: string) { return this.projectRepo.consumePendingFix(projectId); }
  deleteProject(id: string) { this.projectRepo.deleteProject(id); }
  getChildProjects(parentId: string) { return this.projectRepo.getChildProjects(parentId); }
  getPreviewProjects(parentProjectId: string) { return this.projectRepo.getPreviewProjects(parentProjectId); }
  isParentProject(id: string) { return this.projectRepo.isParentProject(id); }
  acquireDeployLock(projectId: string, sessionId: string) { return this.projectRepo.acquireDeployLock(projectId, sessionId); }
  releaseDeployLock(projectId: string) { this.projectRepo.releaseDeployLock(projectId); }
  getDeployLockInfo(projectId: string) { return this.projectRepo.getDeployLockInfo(projectId); }
  cleanExpiredDeployLocks(timeoutMinutes = 10) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
  createEnvironment(environment: Parameters<EnvironmentRepo['createEnvironment']>[0]) { return this.environmentRepo.createEnvironment(environment); }
  getEnvironment(id: string) { return this.environmentRepo.getEnvironment(id); }
  getEnvironmentsByProject(projectId: string) { return this.environmentRepo.getEnvironmentsByProject(projectId); }
  updateEnvironment(id: string, updates: Parameters<EnvironmentRepo['updateEnvironment']>[1]) { this.environmentRepo.updateEnvironment(id, updates); }
  deleteEnvironment(id: string) { this.environmentRepo.deleteEnvironment(id); }
  getEnvVars(projectId: string, environmentId?: string) { return this.envVarRepo.getEnvVars(projectId, environmentId); }
  setEnvVar(projectId: string, key: string, value: string, environmentId?: string) { this.envVarRepo.setEnvVar(projectId, key, value, environmentId); }
  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.setEnvVarsBulk(projectId, vars, environmentId); }
  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.mergeEnvVars(projectId, vars, environmentId); }
  deleteEnvVar(projectId: string, key: string, environmentId?: string) { this.envVarRepo.deleteEnvVar(projectId, key, environmentId); }
  findProjectsByEnvKey(key: string) { return this.envVarRepo.findProjectsByEnvKey(key); }
  getGlobalSecrets() { return this.globalSecretRepo.getGlobalSecrets(); }
  getGlobalSecret(key: string) { return this.globalSecretRepo.getGlobalSecret(key); }
  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string) { this.globalSecretRepo.setGlobalSecret(key, encryptedValue, iv, description); }
  deleteGlobalSecret(key: string) { return this.globalSecretRepo.deleteGlobalSecret(key); }
  getSecretFiles(projectId: string | null) { return this.secretFileRepo.getSecretFiles(projectId); }
  getSecretFilesForDeploy(projectId: string) { return this.secretFileRepo.getSecretFilesForDeploy(projectId); }
  upsertSecretFile(projectId: string | null, filename: string, encryptedContent: string, iv: string, mountPath: string = '/run/secrets') { this.secretFileRepo.upsertSecretFile(projectId, filename, encryptedContent, iv, mountPath); }
  deleteSecretFile(projectId: string | null, filename: string) { return this.secretFileRepo.deleteSecretFile(projectId, filename); }
  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
  getService(id: string) { return this.serviceRepo.getService(id); }
  listServices() { return this.serviceRepo.listServices(); }
  updateService(id: string, updates: Parameters<ServiceRepo['updateService']>[1]) { this.serviceRepo.updateService(id, updates); }
  deleteService(id: string) { this.serviceRepo.deleteService(id); }
  createServiceConnection(opts: Parameters<ServiceConnectionRepo['createConnection']>[0]) { return this.serviceConnectionRepo.createConnection(opts); }
  getServiceConnection(id: string) { return this.serviceConnectionRepo.getConnection(id); }
  getServiceConnectionByProjectAndService(projectId: string, serviceId: string) { return this.serviceConnectionRepo.getConnectionByProjectAndService(projectId, serviceId); }
  listServiceConnectionsByProject(projectId: string, environmentId?: string) { return this.serviceConnectionRepo.listConnectionsByProject(projectId, environmentId); }
  listServiceConnectionsByService(serviceId: string) { return this.serviceConnectionRepo.listConnectionsByService(serviceId); }
  updateServiceConnection(id: string, updates: Parameters<ServiceConnectionRepo['updateConnection']>[1]) { this.serviceConnectionRepo.updateConnection(id, updates); }
  deleteServiceConnection(id: string) { this.serviceConnectionRepo.deleteConnection(id); }
  deleteServiceConnectionByProjectAndService(projectId: string, serviceId: string) { this.serviceConnectionRepo.deleteConnectionByProjectAndService(projectId, serviceId); }
  createRuntimeIncident(opts: Parameters<RuntimeIncidentRepo['createIncident']>[0]) { return this.runtimeIncidentRepo.createIncident(opts); }
  getRuntimeIncident(id: string) { return this.runtimeIncidentRepo.getIncident(id); }
  listRuntimeIncidentsByProject(projectId: string, opts?: Parameters<RuntimeIncidentRepo['listByProject']>[1]) { return this.runtimeIncidentRepo.listByProject(projectId, opts); }
  listUnresolvedRuntimeIncidents() { return this.runtimeIncidentRepo.listUnresolved(); }
  resolveRuntimeIncident(id: string) { this.runtimeIncidentRepo.resolveIncident(id); }
  updateRuntimeIncidentDiagnosis(id: string, diagnosis: string) { this.runtimeIncidentRepo.updateDiagnosis(id, diagnosis); }
  createDeployLog(log: Parameters<DeployLogRepo['createDeployLog']>[0]) { this.deployLogRepo.createDeployLog(log); }
  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
  updateRuntimeLog(deployId: string, runtimeLog: string) { this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
  createTimelineEvent(event: Parameters<TimelineRepo['createTimelineEvent']>[0]) { this.timelineRepo.createTimelineEvent(event); }
  getTimelineEvents(projectId: string, limit = 200) { return this.timelineRepo.getTimelineEvents(projectId, limit); }
  deleteTimelineEvents(projectId: string) { this.timelineRepo.deleteTimelineEvents(projectId); }
  createDomainMapping(mapping: Parameters<DomainMappingRepo['createDomainMapping']>[0]) { this.domainMappingRepo.createDomainMapping(mapping); }
  getDomainMappings(projectId: string) { return this.domainMappingRepo.getDomainMappings(projectId); }
  listDomainMappings() { return this.domainMappingRepo.listDomainMappings(); }
  deleteDomainMapping(id: string) { this.domainMappingRepo.deleteDomainMapping(id); }
  getOAuthTokens(provider: string) { return this.oauthRepo.getOAuthTokens(provider); }
  upsertOAuthTokens(token: Parameters<OAuthRepo['upsertOAuthTokens']>[0]) { this.oauthRepo.upsertOAuthTokens(token); }
  deleteOAuthTokens(provider: string) { this.oauthRepo.deleteOAuthTokens(provider); }
  getWebhookConfig(projectId: string, source: Parameters<WebhookRepo['getWebhookConfig']>[1]) { return this.webhookRepo.getWebhookConfig(projectId, source); }
  setWebhookConfig(config: Parameters<WebhookRepo['setWebhookConfig']>[0]) { this.webhookRepo.setWebhookConfig(config); }
  setWebhookEnabled(id: string, enabled: boolean) { this.webhookRepo.setWebhookEnabled(id, enabled); }
  getWebhookConfigs(projectId: string) { return this.webhookRepo.getWebhookConfigs(projectId); }
  deleteWebhookConfig(projectId: string, source: Parameters<WebhookRepo['deleteWebhookConfig']>[1]) { this.webhookRepo.deleteWebhookConfig(projectId, source); }
  createDeployPlan(plan: Parameters<DeployPlanRepo['createDeployPlan']>[0]) { return this.deployPlanRepo.createDeployPlan(plan); }
  getDeployPlan(planId: string) { return this.deployPlanRepo.getDeployPlan(planId); }
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
  getRecentActionRuns(limit: number) { return this.actionRunRepo.findRecent(limit); }
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
   listOpsIncidentsByDateRange(from: number, to: number, searchText?: string) { return this.opsIncidentRepo.findByDateRange(from, to, searchText); }
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

exec
/bin/bash -lc "sed -n '320,700p' src/web/api/ops-routes.ts" in /home/lee/OpenLander
exec
/bin/bash -lc "sed -n '1,320p' src/web/api/ops-routes.ts" in /home/lee/OpenLander
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

function mapIncidentResponse(
  incident: OpsIncidentRow,
  events: OpsIncidentEventRow[],
  projectName?: string,
) {
  const trigger = extractIncidentTrigger(incident, events);
  const title = incident.root_cause ?? 'Incident detected';
  return {
    ...incident,
    projectName,
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
    const search = c.req.query('search');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');
    const limit = Number(c.req.query('limit') ?? 50);

    try {
      let incidents;
      if (projectId) {
        incidents = ctx.db.listOpsIncidentsByProject(projectId, limit);
      } else {
        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
        const to = toParam ? Number(toParam) : Date.now();
        incidents = ctx.db.listOpsIncidentsByDateRange(from, to, search);
      }

      if (status) {
        incidents = incidents.filter((i) => i.status === status);
      }

      const page = incidents.slice(0, limit);
      const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
      const eventsByIncidentId = groupEventsByIncidentId(events);

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));

      return c.json({
        incidents: page.map((incident) =>
          mapIncidentResponse(
            incident,
            eventsByIncidentId.get(incident.id) ?? [],
            projectMap.get(incident.project_id) ?? incident.project_id,
          ),
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

      const project = ctx.db.getProject(incident.project_id);
      const projectName = project?.name ?? incident.project_id;

      const events = ctx.db.listOpsIncidentEvents(id);
      return c.json({
        incident: mapIncidentResponse(incident, events, projectName),
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

 succeeded in 0ms:
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
      const fromParam = c.req.query('from');
      const toParam = c.req.query('to');

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
        const to = toParam ? Number(toParam) : Date.now();
        const incidents = projectId
          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
          : ctx.db.listOpsIncidentsByDateRange(from, to);
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
          : ctx.db.getRecentActionRuns(200);
        const runs = candidateRuns;
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

      // AI Events
      if (types.length === 0 || types.includes('ai:invoked') || types.includes('ai:completed')) {
        const aiTypes = ['ai:invoked', 'ai:completed'];
        for (const aiType of aiTypes) {
          if (types.length > 0 && !types.includes(aiType)) continue;
          const aiRows = ctx.db.findActivityLogRecent(200, {
            project_id: projectId,
            activity_type: aiType,
          });
          for (const row of aiRows) {
            let metadata: Record<string, unknown> = {};
            try {
              metadata = JSON.parse(row.metadata) as Record<string, unknown>;
            } catch {
              // ignore
            }

            activities.push({
              id: row.id,
              timestamp: row.created_at,
              type: row.activity_type as ActivityItem['type'],
              severity: row.severity as ActivityItem['severity'],
              projectId: row.project_id,
              projectName: projectMap.get(row.project_id) ?? row.project_id,
              title: row.title,
              description: row.description,
              status: row.status as ActivityItem['status'],
              correlationId: row.correlation_id ?? undefined,
              aiMetadata: metadata.aiMetadata as ActivityItem['aiMetadata'],
            });
          }
        }
      }

      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (severity) sorted = sorted.filter((a) => a.severity === severity);
      if (before) sorted = sorted.filter((a) => a.timestamp < before);
      if (since) sorted = sorted.filter((a) => a.id > since);
      const page = sorted.slice(0, limit);
      return {
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    };

    if (isFollow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');
        let lastReportedId = c.req.query('since') || '';
        let flushInProgress = false;

        const sendUpdates = async (): Promise<void> => {
          if (flushInProgress) return;
          flushInProgress = true;
          try {
            const page = fetchActivities(lastReportedId || undefined);
            if (page.activities.length > 0) {
              const forward = [...page.activities].reverse();
              for (const act of forward) {
                await s.write(JSON.stringify(act) + '\n');
              }
              const lastActivity = forward[forward.length - 1];
              if (lastActivity) {
                lastReportedId = lastActivity.id;
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

exec
/bin/bash -lc 'rg -n "as any|@ts-ignore|@ts-expect-error" web/src/components/ops/v2 web/src/hooks/use-ops-center-data.ts src/web/api/ops-routes.ts src/db/repos/ops-incident.repo.ts web/src/lib/api/operations.ts' in /home/lee/OpenLander
 exited 1 in 0ms:
exec
/bin/bash -lc "sed -n '1,280p' web/src/components/ops/v2/FilterBar.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DensityMode = 'all' | 'actions-only' | 'critical-only';

export interface FilterState {
  density: DensityMode;
  severity?: string;
  projectId?: string;
  timeRange?: string;
}

export interface FilterBarProps {
  filters: FilterState;
  projects: { id: string; name: string }[];
  onFilterChange: (filters: FilterState) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DENSITY_OPTIONS: { value: DensityMode; labelKey: keyof typeof DENSITY_LABELS }[] = [
  { value: 'all', labelKey: 'all' },
  { value: 'actions-only', labelKey: 'actionsOnly' },
  { value: 'critical-only', labelKey: 'criticalOnly' },
];

const DENSITY_LABELS = {
  all: 'opsV2.filters.density.all',
  actionsOnly: 'opsV2.filters.density.actionsOnly',
  criticalOnly: 'opsV2.filters.density.criticalOnly',
} as const;

const SEVERITY_OPTIONS = ['critical', 'warning', 'info'] as const;

const TIME_RANGE_OPTIONS = ['1h', '6h', '24h', '7d', '30d'] as const;

// Map URL param names to filter state keys
const PARAM_KEYS = {
  density: 'density',
  severity: 'severity',
  projectId: 'project',
  timeRange: 'timeRange',
} as const;

// ---------------------------------------------------------------------------
// Hook: sync filters with URL search params
// ---------------------------------------------------------------------------

export function useFilterSearchParams(): [FilterState, (next: FilterState) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: FilterState = {
    density: (searchParams.get(PARAM_KEYS.density) as DensityMode | null) ?? 'all',
    severity: searchParams.get(PARAM_KEYS.severity) ?? undefined,
    projectId: searchParams.get(PARAM_KEYS.projectId) ?? undefined,
    timeRange: searchParams.get(PARAM_KEYS.timeRange) ?? undefined,
  };

  const setFilters = useCallback(
    (next: FilterState) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);

          if (next.density && next.density !== 'all') {
            params.set(PARAM_KEYS.density, next.density);
          } else {
            params.delete(PARAM_KEYS.density);
          }

          if (next.severity) {
            params.set(PARAM_KEYS.severity, next.severity);
          } else {
            params.delete(PARAM_KEYS.severity);
          }

          if (next.projectId) {
            params.set(PARAM_KEYS.projectId, next.projectId);
          } else {
            params.delete(PARAM_KEYS.projectId);
          }

          if (next.timeRange) {
            params.set(PARAM_KEYS.timeRange, next.timeRange);
          } else {
            params.delete(PARAM_KEYS.timeRange);
          }

          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilters];
}

// ---------------------------------------------------------------------------
// FilterBar component
// ---------------------------------------------------------------------------

export function FilterBar({ filters, projects, onFilterChange }: FilterBarProps) {
  const { t } = useLanguage();

  const handleDensityChange = (value: string) => {
    onFilterChange({ ...filters, density: value as DensityMode });
  };

  const handleSeverityChange = (value: string) => {
    onFilterChange({ ...filters, severity: value === '_all' ? undefined : value });
  };

  const handleProjectChange = (value: string) => {
    onFilterChange({ ...filters, projectId: value === '_all' ? undefined : value });
  };

  const handleTimeRangeChange = (value: string) => {
    onFilterChange({ ...filters, timeRange: value === '_all' ? undefined : value });
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-2 overflow-x-auto',
        'border rounded-md border-[hsl(var(--border))]',
        'bg-bg-panel text-xs',
      )}
    >
      {/* Density */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-ol whitespace-nowrap">{t('opsV2.filters.density.label')}</span>
        <Select value={filters.density} onValueChange={handleDensityChange}>
          <SelectTrigger className="h-7 min-w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DENSITY_OPTIONS.map(({ value, labelKey }) => (
              <SelectItem key={value} value={value} className="text-xs">
                {t(DENSITY_LABELS[labelKey])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Severity */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-ol whitespace-nowrap">{t('opsV2.filters.severity')}</span>
        <Select value={filters.severity ?? '_all'} onValueChange={handleSeverityChange}>
          <SelectTrigger className="h-7 min-w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {SEVERITY_OPTIONS.map((sev) => (
              <SelectItem key={sev} value={sev} className="text-xs capitalize">
                {sev}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-ol whitespace-nowrap">{t('opsV2.filters.project')}</span>
        <Select value={filters.projectId ?? '_all'} onValueChange={handleProjectChange}>
          <SelectTrigger className="h-7 min-w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {projects.map((proj) => (
              <SelectItem key={proj.id} value={proj.id} className="text-xs">
                {proj.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Time range */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-muted-ol whitespace-nowrap">{t('opsV2.filters.timeRange')}</span>
        <Select value={filters.timeRange ?? '_all'} onValueChange={handleTimeRangeChange}>
          <SelectTrigger className="h-7 min-w-[110px] text-xs" data-testid="time-range-trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all" className="text-xs" data-testid="time-range-option-_all">
              {t('opsV2.filters.density.all')}
            </SelectItem>
            {TIME_RANGE_OPTIONS.map((range) => (
              <SelectItem
                key={range}
                value={range}
                className="text-xs"
                data-testid={`time-range-option-${range}`}
              >
                {t(`opsV2.filters.timeRangeOptions.${range}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

exec
/bin/bash -lc "sed -n '260,520p' web/src/components/ops/v2/MainFeedGrid.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
  event,
  threadTitle,
}: {
  event: ActivityItem;
  threadTitle?: string;
}) {
  const { t, language } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
  const hasDiagnosis = !!event.aiMetadata?.diagnosisSummary;
  const hasLongDescription = !!event.description && event.description.length >= 100;
  const hasAnyDetails = hasDiagnosis || !!event.description;

  const rawTitle =
    event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
  const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);

  const isDuplicateTitle = threadTitle && titleText === threadTitle;

  return (
    <div
      className={cn(
        'flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors',
        hasAnyDetails && 'bg-bg-subtle/30 border-l-2 border-l-agent/50',
      )}
    >
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
          {!isDuplicateTitle && (
            <span
              className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
              title={titleText}
            >
              {titleText}
            </span>
          )}
          {hasLongDescription && (
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
      <EventDetailsContent event={event} detailsOpen={detailsOpen} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainFeedGrid({
  activities,
  onThreadSelect,
  isFiltered,
  onClearFilters,
  focusedIndex = 0,
}: MainFeedGridProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities, t as unknown as (key: string) => string);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities, t]);

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

  const toggleThread = useCallback(
    (correlationId: string, incidentId?: string) => {
      setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
      onThreadSelect?.(correlationId, incidentId);
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
    if (isFiltered) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
          <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
          <h3 className="text-sm font-semibold text-primary-ol mb-1">
            {t('opsV2.empty.filteredTitle')}
          </h3>
          <p className="text-sm text-muted-ol mb-4">{t('opsV2.empty.filteredDesc')}</p>
          {onClearFilters && (
            <button
              onClick={onClearFilters}
              className="text-xs font-medium text-primary-ol bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-3 py-1.5 rounded transition-colors"
            >
              {t('opsV2.timeline.clearFilters')}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
        <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
        <h3 className="text-sm font-semibold text-primary-ol mb-1">
          {t('opsV2.empty.noActivityTitle')}
        </h3>
        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivityDesc')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" role="table" aria-label={t('opsV2.timeline.eventLog')}>
      {/* List Header */}
      <div className="flex justify-between items-center mb-2 px-1">
        <h2 className="text-sm font-semibold text-primary-ol">{t('opsV2.timeline.eventLog')}</h2>
        <button
          type="button"
          onClick={toggleAll}
          className="text-[11px] bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-2 py-1 flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-agent text-secondary-ol font-medium transition-colors rounded shadow-sm"
        >
          {allExpanded ? t('opsV2.timeline.collapseAll') : t('opsV2.timeline.expandAll')}
        </button>
      </div>

      {/* Grid Table Header */}
      <div
        role="row"
        className={cn(
          ROW_GRID_CLASSES,
          'bg-bg-panel border-y border-[hsl(var(--border))] py-2',
          'text-[10px] font-mono tracking-wider uppercase font-semibold text-muted-ol',
        )}
      >
        <div role="columnheader" /> {/* expander col */}
        <div role="columnheader">{t('opsV2.timeline.columns.projectTarget')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.detectedEvent')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.severity')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.state')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.eventCount')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.latest')}</div>
      </div>

      {/* Body Rows */}
      <div className="flex flex-col bg-app border-b border-[hsl(var(--border))]" role="rowgroup">
        {threadData.slice(0, visibleThreadCount).map((thread, index) => {
          const isExpanded = !!expandedMap[thread.correlationId];
          const isCritical = thread.severity === 'critical';
          const isWarning = thread.severity === 'warning';
          const isFocused = index === focusedIndex;
          const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
          const visibleEvents = thread.events.slice(0, maxVisibleEvents);
          const hiddenEventCount = thread.events.length - visibleEvents.length;

          return (
            <Collapsible
              key={thread.correlationId}
              open={isExpanded}
              onOpenChange={() =>
                toggleThread(
                  thread.correlationId,
                  thread.events.find((e) => e.incidentId)?.incidentId,
                )
              }
              className={cn(
                'group border-b border-[hsl(var(--border))]/50 last:border-0 transition-colors',
                isCritical && 'bg-error/5',
                isWarning && !isCritical && 'bg-warning/5',
                thread.cascadeGroup &&
                  thread.cascadeGroup.length > 0 &&
                  'border-l-2 border-l-warning',
                isFocused && 'ring-1 ring-agent/50 ring-inset',
              )}
            >
              {/* Parent Row */}
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  role="row"
                  className={cn(
                    ROW_GRID_CLASSES,
                    'w-full py-2 hover:bg-bg-subtle/80 transition-colors text-left outline-none focus-visible:bg-bg-subtle',
                    isExpanded && 'bg-bg-subtle/40',

exec
/bin/bash -lc "sed -n '1,260p' web/src/components/ops/SeverityBadge.tsx" in /home/lee/OpenLander
 succeeded in 0ms:
import { Badge } from '../ui/badge.js';
import { cn } from '../../lib/utils.js';
import { useLanguage } from '../../i18n/context.js';

interface SeverityBadgeProps {
  severity: string;
  count?: number;
  className?: string;
}

export function SeverityBadge({ severity, count, className }: SeverityBadgeProps) {
  const { t } = useLanguage();
  const isCritical = severity === 'critical';
  const isWarning = severity === 'warning';
  const isInfo = severity === 'info';

  if (isCritical) {
    return (
      <Badge variant="destructive" className={cn('h-5 px-1.5 text-[10px]', className)}>
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.critical')}
      </Badge>
    );
  }

  if (isWarning) {
    return (
      <Badge
        variant="outline"
        className={cn('h-5 px-1.5 text-[10px] text-warning border-warning/50', className)}
      >
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.warning')}
      </Badge>
    );
  }

  if (isInfo) {
    return (
      <Badge
        variant="outline"
        className={cn('h-5 px-1.5 text-[10px] text-info border-info/50', className)}
      >
        {count !== undefined ? `${count} ` : ''}
        {t('opsV2.severity.info')}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] capitalize', className)}>
      {count !== undefined ? `${count} ` : ''}
      {severity}
    </Badge>
  );
}

exec
/bin/bash -lc "sed -n '1,240p' web/src/components/ops/utils.ts" in /home/lee/OpenLander
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

  if (!translated || translated === `operations.events.${normalizedKey}`) {
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

codex
핵심 리스크 후보가 몇 개 좁혀졌습니다. 특히 시간 범위 필터가 새로 들어왔는데, 서버가 모든 activity 타입에 동일하게 적용하지 않고 있어 기능/회귀 관점에서 가장 먼저 지적할 만합니다.
exec
/bin/bash -lc "nl -ba web/src/pages/OpsCenterV2.tsx | sed -n '70,180p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba src/web/api/ops-routes.ts | sed -n '430,610p'" in /home/lee/OpenLander
 succeeded in 0ms:
    70	  // Incident slideover state
    71	  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
    72
    73	  // Keyboard shortcuts state
    74	  const [currentFocusIndex, setCurrentFocusIndex] = useState(0);
    75
    76	  const openDrawer = useCallback(() => setDrawerOpen(true), []);
    77	  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
    78
    79	  const handleThreadSelect = useCallback((_correlationId: string, incidentId?: string) => {
    80	    if (incidentId) {
    81	      setSelectedIncidentId(incidentId);
    82	    }
    83	  }, []);
    84
    85	  // Close drawer when resizing past md breakpoint
    86	  useEffect(() => {
    87	    if (!isBelowMd) setDrawerOpen(false);
    88	  }, [isBelowMd]);
    89
    90	  // Keyboard shortcuts
    91	  const threadCount = useMemo(() => {
    92	    const threads = activities.length > 0 ? activities.length : 0;
    93	    return threads;
    94	  }, [activities]);
    95
    96	  useKeyboardShortcuts([
    97	    {
    98	      key: 'j',
    99	      handler: () => {
   100	        setCurrentFocusIndex((prev) => Math.min(prev + 1, Math.max(0, threadCount - 1)));
   101	      },
   102	    },
   103	    {
   104	      key: 'k',
   105	      handler: () => {
   106	        setCurrentFocusIndex((prev) => Math.max(prev - 1, 0));
   107	      },
   108	    },
   109	    {
   110	      key: '/',
   111	      handler: () => {
   112	        const searchInput = document.querySelector(
   113	          '[data-testid="incident-search-input"]',
   114	        ) as HTMLInputElement;
   115	        searchInput?.focus();
   116	      },
   117	    },
   118	    {
   119	      key: 'Escape',
   120	      handler: () => {
   121	        setSelectedIncidentId(null);
   122	      },
   123	    },
   124	    {
   125	      key: '?',
   126	      handler: () => {
   127	        const helpButton = document.querySelector('[aria-label*="Keyboard"]') as HTMLButtonElement;
   128	        helpButton?.click();
   129	      },
   130	    },
   131	  ]);
   132
   133	  const healthState = deriveHealthState(incidents, circuitBreakers);
   134	  const trippedCount = circuitBreakers.filter((cb) => cb.state === 'open').length;
   135	  const isAgentActive = activities.some(
   136	    (a) => a.type === 'ai:invoked' && a.status === 'ai-running',
   137	  );
   138
   139	  const connectionStatus = isConnected
   140	    ? 'connected'
   141	    : isReconnecting
   142	      ? 'reconnecting'
   143	      : 'disconnected';
   144
   145	  // Derive unique projects for filter dropdown
   146	  const projects = useMemo(() => {
   147	    const seen = new Map<string, string>();
   148	    for (const a of activities) {
   149	      if (a.projectId && !seen.has(a.projectId)) {
   150	        seen.set(a.projectId, a.projectName ?? a.projectId);
   151	      }
   152	    }
   153	    return Array.from(seen, ([id, name]) => ({ id, name }));
   154	  }, [activities]);
   155
   156	  // Apply filters to activities
   157	  const filteredActivities = useMemo(() => {
   158	    let result: ActivityItem[] = activities;
   159	    if (filters.severity) {
   160	      result = result.filter((a) => a.severity === filters.severity);
   161	    }
   162	    if (filters.projectId) {
   163	      result = result.filter((a) => a.projectId === filters.projectId);
   164	    }
   165	    if (filters.density === 'actions-only') {
   166	      result = result.filter((a) => a.status === 'pending' || a.type === 'recovery');
   167	    } else if (filters.density === 'critical-only') {
   168	      result = result.filter((a) => a.severity === 'critical');
   169	    }
   170	    return result;
   171	  }, [activities, filters]);
   172
   173	  return (
   174	    <div className="flex flex-col flex-1 min-h-0 bg-app">
   175	      <StatusStrip
   176	        healthState={isLoading ? 'unknown' : healthState}
   177	        activeIncidentCount={incidents.length}
   178	        pendingApprovalCount={approvals.length}
   179	        trippedCircuitBreakerCount={trippedCount}
   180	        isAgentActive={isAgentActive}

 succeeded in 0ms:
   430	      isAutopilot: policy ? isAutopilot(policy) : false,
   431	    });
   432	  });
   433
   434	  api.delete('/projects/:projectId/automation', (c) => {
   435	    const projectId = c.req.param('projectId');
   436	    ctx.db.deleteProjectOpsOverride(projectId);
   437	    return c.json({ deleted: true });
   438	  });
   439
   440	  // --- Unified Activity Feed ---
   441
   442	  api.get('/activity', (c) => {
   443	    const isFollow = c.req.query('follow') === 'true';
   444
   445	    const fetchActivities = (sinceParam?: string) => {
   446	      const projectId = c.req.query('projectId');
   447	      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
   448	      const severity = c.req.query('severity');
   449	      const limitParam = c.req.query('limit');
   450	      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
   451	      const before = c.req.query('before');
   452	      const since = sinceParam || c.req.query('since');
   453	      const fromParam = c.req.query('from');
   454	      const toParam = c.req.query('to');
   455
   456	      const projects = ctx.db.listProjects();
   457	      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
   458	      const activities: ActivityItem[] = [];
   459
   460	      // Incidents
   461	      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
   462	        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
   463	        const to = toParam ? Number(toParam) : Date.now();
   464	        const incidents = projectId
   465	          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
   466	          : ctx.db.listOpsIncidentsByDateRange(from, to);
   467	        const eventsByIncidentId = groupEventsByIncidentId(
   468	          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
   469	        );
   470
   471	        for (const inc of incidents) {
   472	          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];
   473	          const trigger = extractIncidentTrigger(inc, incidentEvents);
   474
   475	          if (types.length === 0 || types.includes('incident')) {
   476	            activities.push({
   477	              id: inc.id,
   478	              timestamp: new Date(inc.created_at).toISOString(),
   479	              type: 'incident',
   480	              severity: inc.severity,
   481	              projectId: inc.project_id,
   482	              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
   483	              title: inc.root_cause ?? 'Incident detected',
   484	              description: inc.diagnosis ?? '',
   485	              status: inc.status === 'resolved' ? 'resolved' : 'active',
   486	              incidentId: inc.id,
   487	              triggerType: trigger.triggerType,
   488	              triggerDetails: trigger.triggerDetails,
   489	            });
   490	          }
   491	          if (types.length === 0 || types.includes('alert')) {
   492	            for (const ev of incidentEvents.filter(
   493	              (e) => (e.event_type as string) === 'cascade_detected',
   494	            )) {
   495	              let cascadeGroup: string[] = [];
   496	              try {
   497	                cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
   498	              } catch {
   499	                // ignore parsing error
   500	              }
   501	              activities.push({
   502	                id: ev.id,
   503	                timestamp: new Date(ev.created_at).toISOString(),
   504	                type: 'alert',
   505	                severity: 'warning',
   506	                projectId: inc.project_id,
   507	                projectName: projectMap.get(inc.project_id) ?? inc.project_id,
   508	                title: 'Cascade detected',
   509	                description: ev.description,
   510	                status: 'active',
   511	                incidentId: inc.id,
   512	                cascadeGroup,
   513	              });
   514	            }
   515	          }
   516	        }
   517	      }
   518
   519	      // Action runs
   520	      if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
   521	        const candidateRuns = projectId
   522	          ? ctx.db.getActionRunsByProject(projectId, 100)
   523	          : ctx.db.getRecentActionRuns(200);
   524	        const runs = candidateRuns;
   525	        for (const run of runs) {
   526	          if (
   527	            run.trigger_source !== 'auto_recovery' &&
   528	            (run.status as string) !== 'pending_approval'
   529	          )
   530	            continue;
   531	          const itemType: ActivityItem['type'] =
   532	            (run.status as string) === 'pending_approval' ? 'approval' : 'recovery';
   533	          if (types.length > 0 && !types.includes(itemType)) continue;
   534	          activities.push({
   535	            id: run.id,
   536	            timestamp: run.created_at,
   537	            type: itemType,
   538	            severity: run.status === 'failed' ? 'warning' : 'info',
   539	            projectId: run.project_id,
   540	            projectName: projectMap.get(run.project_id) ?? run.project_id,
   541	            title:
   542	              itemType === 'approval'
   543	                ? `Approval required: ${run.approval_tool ?? 'action'}`
   544	                : `Auto-recovery ${run.status}`,
   545	            description: run.error_message ?? run.plan ?? '',
   546	            status:
   547	              run.status === 'succeeded'
   548	                ? 'resolved'
   549	                : run.status === 'failed'
   550	                  ? 'failed'
   551	                  : (run.status as string) === 'pending_approval'
   552	                    ? 'pending'
   553	                    : 'active',
   554	            actionRunId: run.id,
   555	            correlationId: run.correlation_id ?? undefined,
   556	          });
   557	        }
   558	      }
   559
   560	      // AI Events
   561	      if (types.length === 0 || types.includes('ai:invoked') || types.includes('ai:completed')) {
   562	        const aiTypes = ['ai:invoked', 'ai:completed'];
   563	        for (const aiType of aiTypes) {
   564	          if (types.length > 0 && !types.includes(aiType)) continue;
   565	          const aiRows = ctx.db.findActivityLogRecent(200, {
   566	            project_id: projectId,
   567	            activity_type: aiType,
   568	          });
   569	          for (const row of aiRows) {
   570	            let metadata: Record<string, unknown> = {};
   571	            try {
   572	              metadata = JSON.parse(row.metadata) as Record<string, unknown>;
   573	            } catch {
   574	              // ignore
   575	            }
   576
   577	            activities.push({
   578	              id: row.id,
   579	              timestamp: row.created_at,
   580	              type: row.activity_type as ActivityItem['type'],
   581	              severity: row.severity as ActivityItem['severity'],
   582	              projectId: row.project_id,
   583	              projectName: projectMap.get(row.project_id) ?? row.project_id,
   584	              title: row.title,
   585	              description: row.description,
   586	              status: row.status as ActivityItem['status'],
   587	              correlationId: row.correlation_id ?? undefined,
   588	              aiMetadata: metadata.aiMetadata as ActivityItem['aiMetadata'],
   589	            });
   590	          }
   591	        }
   592	      }
   593
   594	      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
   595	      if (severity) sorted = sorted.filter((a) => a.severity === severity);
   596	      if (before) sorted = sorted.filter((a) => a.timestamp < before);
   597	      if (since) sorted = sorted.filter((a) => a.id > since);
   598	      const page = sorted.slice(0, limit);
   599	      return {
   600	        activities: page,
   601	        nextCursor: page.length === limit ? (page[page.length - 1]?.id ?? null) : null,
   602	      };
   603	    };
   604
   605	    if (isFollow) {
   606	      return stream(c, async (s) => {
   607	        c.header('Content-Type', 'application/x-ndjson');
   608	        let lastReportedId = c.req.query('since') || '';
   609	        let flushInProgress = false;
   610

exec
/bin/bash -lc "nl -ba web/src/hooks/use-keyboard-shortcuts.ts | sed -n '1,220p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { useEffect } from 'react';
     2
     3	// ---------------------------------------------------------------------------
     4	// Types
     5	// ---------------------------------------------------------------------------
     6
     7	export interface Shortcut {
     8	  key: string; // 'j', 'k', '/', 'Escape', '?'
     9	  handler: () => void;
    10	  disabled?: boolean;
    11	}
    12
    13	// ---------------------------------------------------------------------------
    14	// Hook
    15	// ---------------------------------------------------------------------------
    16
    17	/**
    18	 * useKeyboardShortcuts
    19	 *
    20	 * Registers keyboard shortcuts with automatic disabling when focus is on
    21	 * input, textarea, select, or contenteditable elements.
    22	 *
    23	 * @param shortcuts - Array of shortcut definitions
    24	 *
    25	 * @example
    26	 * useKeyboardShortcuts([
    27	 *   { key: 'j', handler: () => console.log('next') },
    28	 *   { key: 'k', handler: () => console.log('prev') },
    29	 *   { key: '/', handler: () => console.log('search') },
    30	 *   { key: 'Escape', handler: () => console.log('close') },
    31	 *   { key: '?', handler: () => console.log('help') },
    32	 * ]);
    33	 */
    34	export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
    35	  useEffect(() => {
    36	    const handleKeyDown = (event: KeyboardEvent) => {
    37	      // Check if focus is on an input-like element
    38	      const target = event.target as HTMLElement;
    39	      const isInputLike =
    40	        target instanceof HTMLInputElement ||
    41	        target instanceof HTMLTextAreaElement ||
    42	        target instanceof HTMLSelectElement ||
    43	        (target instanceof HTMLElement && target.contentEditable === 'true');
    44
    45	      // Skip shortcuts if focused on input-like element
    46	      if (isInputLike) {
    47	        return;
    48	      }
    49
    50	      // Find matching shortcut
    51	      const shortcut = shortcuts.find((s) => s.key === event.key && !s.disabled);
    52
    53	      if (shortcut) {
    54	        event.preventDefault();
    55	        shortcut.handler();
    56	      }
    57	    };
    58
    59	    window.addEventListener('keydown', handleKeyDown);
    60
    61	    return () => {
    62	      window.removeEventListener('keydown', handleKeyDown);
    63	    };
    64	  }, [shortcuts]);
    65	}

exec
/bin/bash -lc "nl -ba src/db/repos/ops-incident.repo.ts | sed -n '75,130p'" in /home/lee/OpenLander
 succeeded in 0ms:
    75	      .from(opsIncidents)
    76	      .where(inArray(opsIncidents.status, ['open', 'active']))
    77	      .orderBy(desc(opsIncidents.created_at))
    78	      .all() as OpsIncidentRow[];
    79	  }
    80
    81	  findByDateRange(from: number, to: number, searchText?: string): OpsIncidentRow[] {
    82	    const conditions = [gte(opsIncidents.created_at, from), lte(opsIncidents.created_at, to)];
    83	    if (searchText) {
    84	      const searchCondition = or(
    85	        like(opsIncidents.root_cause, `%${searchText}%`),
    86	        like(opsIncidents.diagnosis, `%${searchText}%`),
    87	      );
    88	      if (searchCondition) conditions.push(searchCondition);
    89	    }
    90	    return this.db
    91	      .select()
    92	      .from(opsIncidents)
    93	      .where(and(...conditions))
    94	      .orderBy(desc(opsIncidents.created_at))
    95	      .all() as OpsIncidentRow[];
    96	  }
    97
    98	  findBySearch(searchText: string, limit?: number): OpsIncidentRow[] {
    99	    const baseQuery = this.db
   100	      .select()
   101	      .from(opsIncidents)
   102	      .where(
   103	        or(
   104	          like(opsIncidents.root_cause, `%${searchText}%`),
   105	          like(opsIncidents.diagnosis, `%${searchText}%`),
   106	        ),
   107	      )
   108	      .orderBy(desc(opsIncidents.created_at));
   109
   110	    if (limit) {
   111	      return baseQuery.limit(limit).all() as OpsIncidentRow[];
   112	    }
   113
   114	    return baseQuery.all() as OpsIncidentRow[];
   115	  }
   116
   117	  updateStatus(
   118	    id: string,
   119	    status: string,
   120	    extra?: { resolved_at?: number; escalated_at?: number },
   121	  ): void {
   122	    const setValues: Record<string, unknown> = {
   123	      status: status as 'open' | 'active' | 'resolved' | 'escalated',
   124	    };
   125	    if (extra?.resolved_at !== undefined) {
   126	      setValues.resolved_at = extra.resolved_at;
   127	    }
   128	    if (extra?.escalated_at !== undefined) {
   129	      setValues.escalated_at = extra.escalated_at;
   130	    }

exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/LeftRail.tsx | sed -n '290,390p'" in /home/lee/OpenLander
 succeeded in 0ms:
   290	  });
   291
   292	  // forceCollapsed overrides local state (used for < lg breakpoint)
   293	  const effectivelyCollapsed = forceCollapsed ?? collapsed;
   294
   295	  const [activeFilter, setActiveFilter] = useState<string | null>(null);
   296
   297	  const [searchQuery, setSearchQuery] = useState('');
   298	  const [debouncedSearch, setDebouncedSearch] = useState('');
   299	  const [searchResults, setSearchResults] = useState<OpsIncident[] | null>(null);
   300	  const [isSearching, setIsSearching] = useState(false);
   301
   302	  useEffect(() => {
   303	    const timer = setTimeout(() => {
   304	      setDebouncedSearch(searchQuery);
   305	    }, 300);
   306	    return () => clearTimeout(timer);
   307	  }, [searchQuery]);
   308
   309	  useEffect(() => {
   310	    if (!debouncedSearch) {
   311	      setSearchResults(null);
   312	      setIsSearching(false);
   313	      return;
   314	    }
   315
   316	    let isMounted = true;
   317	    setIsSearching(true);
   318
   319	    fetchOpsIncidents(undefined, 'open', debouncedSearch)
   320	      .then((data) => {
   321	        if (isMounted) {
   322	          setSearchResults(data.incidents);
   323	        }
   324	      })
   325	      .catch(() => {
   326	        if (isMounted) {
   327	          setSearchResults([]);
   328	        }
   329	      })
   330	      .finally(() => {
   331	        if (isMounted) {
   332	          setIsSearching(false);
   333	        }
   334	      });
   335
   336	    return () => {
   337	      isMounted = false;
   338	    };
   339	  }, [debouncedSearch]);
   340
   341	  const toggle = useCallback(() => {
   342	    setCollapsed((prev) => {
   343	      const next = !prev;
   344	      try {
   345	        localStorage.setItem(STORAGE_KEY, String(next));
   346	      } catch {
   347	        // ignore storage errors
   348	      }
   349	      return next;
   350	    });
   351	  }, []);
   352
   353	  // Sync localStorage changes from other tabs
   354	  useEffect(() => {
   355	    const handler = (e: StorageEvent) => {
   356	      if (e.key === STORAGE_KEY && e.newValue !== null) {
   357	        setCollapsed(e.newValue === 'true');
   358	      }
   359	    };
   360	    window.addEventListener('storage', handler);
   361	    return () => window.removeEventListener('storage', handler);
   362	  }, []);
   363
   364	  const handleSectionClick = useCallback(
   365	    (type: string) => {
   366	      const next = activeFilter === type ? null : type;
   367	      setActiveFilter(next);
   368	      onFilterChange?.(next ? { type: next } : {});
   369	    },
   370	    [activeFilter, onFilterChange],
   371	  );
   372
   373	  const approvalItems = approvals;
   374	  const openBreakers = circuitBreakers.filter((cb) => cb.state !== 'closed');
   375
   376	  const displayIncidents = searchResults !== null ? searchResults : incidents;
   377
   378	  // Group incidents by project + humanized trigger type (or title) to deduplicate
   379	  const groupedIncidents = displayIncidents.reduce<
   380	    Array<{ incident: OpsIncident; count: number; groupKey: string; lastEventTime: number }>
   381	  >((acc, incident) => {
   382	    const key = `${incident.project_id}::${incident.triggerType ?? incident.title}`;
   383	    const existing = acc.find((g) => g.groupKey === key);
   384	    const time =
   385	      typeof incident.created_at === 'string'
   386	        ? new Date(incident.created_at).getTime()
   387	        : incident.created_at;
   388	    if (existing) {
   389	      existing.count += 1;
   390	      if (time > existing.lastEventTime) {

exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/KeyboardShortcutsHelp.tsx | sed -n '1,220p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/MainFeedGrid.tsx | sed -n '360,560p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { HelpCircle } from 'lucide-react';
     2	import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
     3	import { useLanguage } from '../../../i18n/context.js';
     4	import { cn } from '../../../lib/utils.js';
     5
     6	// ---------------------------------------------------------------------------
     7	// Component
     8	// ---------------------------------------------------------------------------
     9
    10	export interface KeyboardShortcutsHelpProps {
    11	  className?: string;
    12	}
    13
    14	export function KeyboardShortcutsHelp({ className }: KeyboardShortcutsHelpProps) {
    15	  const { t } = useLanguage();
    16
    17	  const shortcuts = [
    18	    { key: 'J', description: t('opsV2.shortcuts.nextItem') },
    19	    { key: 'K', description: t('opsV2.shortcuts.prevItem') },
    20	    { key: '/', description: t('opsV2.shortcuts.search') },
    21	    { key: 'Esc', description: t('opsV2.shortcuts.close') },
    22	    { key: '?', description: t('opsV2.shortcuts.help') },
    23	  ];
    24
    25	  return (
    26	    <Popover>
    27	      <PopoverTrigger asChild>
    28	        <button
    29	          className={cn(
    30	            'inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-subtle hover:text-foreground transition-colors',
    31	            className,
    32	          )}
    33	          aria-label={t('opsV2.shortcuts.helpLabel')}
    34	        >
    35	          <HelpCircle className="h-4 w-4" />
    36	        </button>
    37	      </PopoverTrigger>
    38	      <PopoverContent align="end" className="w-64">
    39	        <div className="space-y-4">
    40	          <div>
    41	            <h3 className="font-semibold text-sm">{t('opsV2.shortcuts.title')}</h3>
    42	            <p className="text-xs text-muted-foreground mt-1">{t('opsV2.shortcuts.description')}</p>
    43	          </div>
    44	          <div className="space-y-2">
    45	            {shortcuts.map((shortcut) => (
    46	              <div key={shortcut.key} className="flex items-center justify-between gap-2">
    47	                <span className="text-xs text-muted-foreground">{shortcut.description}</span>
    48	                <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-subtle rounded border border-border">
    49	                  {shortcut.key}
    50	                </kbd>
    51	              </div>
    52	            ))}
    53	          </div>
    54	        </div>
    55	      </PopoverContent>
    56	    </Popover>
    57	  );
    58	}

 succeeded in 0ms:
   360	export function MainFeedGrid({
   361	  activities,
   362	  onThreadSelect,
   363	  isFiltered,
   364	  onClearFilters,
   365	  focusedIndex = 0,
   366	}: MainFeedGridProps) {
   367	  const { t, language } = useLanguage();
   368
   369	  const threadData = useMemo(() => {
   370	    const threads = groupIntoThreads(activities, t as unknown as (key: string) => string);
   371	    // Pin threads with pending approvals to the top
   372	    return [
   373	      ...threads.filter((th) => th.hasPendingApproval),
   374	      ...threads.filter((th) => !th.hasPendingApproval),
   375	    ];
   376	  }, [activities, t]);
   377
   378	  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);
   379	  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});
   380	  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
   381	    const initial: Record<string, boolean> = {};
   382	    for (const th of threadData) {
   383	      initial[th.correlationId] = th.hasPendingApproval;
   384	    }
   385	    return initial;
   386	  });
   387
   388	  const allExpanded =
   389	    threadData.length > 0 && threadData.every((th) => !!expandedMap[th.correlationId]);
   390
   391	  const toggleAll = useCallback(() => {
   392	    const next = !allExpanded;
   393	    setExpandedMap(() => {
   394	      const map: Record<string, boolean> = {};
   395	      for (const th of threadData) {
   396	        map[th.correlationId] = next;
   397	      }
   398	      return map;
   399	    });
   400	  }, [allExpanded, threadData]);
   401
   402	  const toggleThread = useCallback(
   403	    (correlationId: string, incidentId?: string) => {
   404	      setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
   405	      onThreadSelect?.(correlationId, incidentId);
   406	    },
   407	    [onThreadSelect],
   408	  );
   409
   410	  const showMoreEvents = useCallback((correlationId: string) => {
   411	    setExpandedEventsMap((prev) => ({
   412	      ...prev,
   413	      [correlationId]: (prev[correlationId] ?? EVENTS_PAGE_SIZE) + EVENTS_PAGE_SIZE,
   414	    }));
   415	  }, []);
   416
   417	  if (activities.length === 0) {
   418	    if (isFiltered) {
   419	      return (
   420	        <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
   421	          <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
   422	          <h3 className="text-sm font-semibold text-primary-ol mb-1">
   423	            {t('opsV2.empty.filteredTitle')}
   424	          </h3>
   425	          <p className="text-sm text-muted-ol mb-4">{t('opsV2.empty.filteredDesc')}</p>
   426	          {onClearFilters && (
   427	            <button
   428	              onClick={onClearFilters}
   429	              className="text-xs font-medium text-primary-ol bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-3 py-1.5 rounded transition-colors"
   430	            >
   431	              {t('opsV2.timeline.clearFilters')}
   432	            </button>
   433	          )}
   434	        </div>
   435	      );
   436	    }
   437
   438	    return (
   439	      <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
   440	        <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
   441	        <h3 className="text-sm font-semibold text-primary-ol mb-1">
   442	          {t('opsV2.empty.noActivityTitle')}
   443	        </h3>
   444	        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivityDesc')}</p>
   445	      </div>
   446	    );
   447	  }
   448
   449	  return (
   450	    <div className="flex flex-col" role="table" aria-label={t('opsV2.timeline.eventLog')}>
   451	      {/* List Header */}
   452	      <div className="flex justify-between items-center mb-2 px-1">
   453	        <h2 className="text-sm font-semibold text-primary-ol">{t('opsV2.timeline.eventLog')}</h2>
   454	        <button
   455	          type="button"
   456	          onClick={toggleAll}
   457	          className="text-[11px] bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-2 py-1 flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-agent text-secondary-ol font-medium transition-colors rounded shadow-sm"
   458	        >
   459	          {allExpanded ? t('opsV2.timeline.collapseAll') : t('opsV2.timeline.expandAll')}
   460	        </button>
   461	      </div>
   462
   463	      {/* Grid Table Header */}
   464	      <div
   465	        role="row"
   466	        className={cn(
   467	          ROW_GRID_CLASSES,
   468	          'bg-bg-panel border-y border-[hsl(var(--border))] py-2',
   469	          'text-[10px] font-mono tracking-wider uppercase font-semibold text-muted-ol',
   470	        )}
   471	      >
   472	        <div role="columnheader" /> {/* expander col */}
   473	        <div role="columnheader">{t('opsV2.timeline.columns.projectTarget')}</div>
   474	        <div role="columnheader">{t('opsV2.timeline.columns.detectedEvent')}</div>
   475	        <div role="columnheader">{t('opsV2.timeline.columns.severity')}</div>
   476	        <div role="columnheader">{t('opsV2.timeline.columns.state')}</div>
   477	        <div role="columnheader">{t('opsV2.timeline.columns.eventCount')}</div>
   478	        <div role="columnheader">{t('opsV2.timeline.columns.latest')}</div>
   479	      </div>
   480
   481	      {/* Body Rows */}
   482	      <div className="flex flex-col bg-app border-b border-[hsl(var(--border))]" role="rowgroup">
   483	        {threadData.slice(0, visibleThreadCount).map((thread, index) => {
   484	          const isExpanded = !!expandedMap[thread.correlationId];
   485	          const isCritical = thread.severity === 'critical';
   486	          const isWarning = thread.severity === 'warning';
   487	          const isFocused = index === focusedIndex;
   488	          const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
   489	          const visibleEvents = thread.events.slice(0, maxVisibleEvents);
   490	          const hiddenEventCount = thread.events.length - visibleEvents.length;
   491
   492	          return (
   493	            <Collapsible
   494	              key={thread.correlationId}
   495	              open={isExpanded}
   496	              onOpenChange={() =>
   497	                toggleThread(
   498	                  thread.correlationId,
   499	                  thread.events.find((e) => e.incidentId)?.incidentId,
   500	                )
   501	              }
   502	              className={cn(
   503	                'group border-b border-[hsl(var(--border))]/50 last:border-0 transition-colors',
   504	                isCritical && 'bg-error/5',
   505	                isWarning && !isCritical && 'bg-warning/5',
   506	                thread.cascadeGroup &&
   507	                  thread.cascadeGroup.length > 0 &&
   508	                  'border-l-2 border-l-warning',
   509	                isFocused && 'ring-1 ring-agent/50 ring-inset',
   510	              )}
   511	            >
   512	              {/* Parent Row */}
   513	              <CollapsibleTrigger asChild>
   514	                <button
   515	                  type="button"
   516	                  role="row"
   517	                  className={cn(
   518	                    ROW_GRID_CLASSES,
   519	                    'w-full py-2 hover:bg-bg-subtle/80 transition-colors text-left outline-none focus-visible:bg-bg-subtle',
   520	                    isExpanded && 'bg-bg-subtle/40',
   521	                  )}
   522	                >
   523	                  <span role="cell" className="shrink-0 text-muted-ol">
   524	                    {isExpanded ? (
   525	                      <ChevronDown className="h-4 w-4" />
   526	                    ) : (
   527	                      <ChevronRight className="h-4 w-4" />
   528	                    )}
   529	                  </span>
   530
   531	                  <span
   532	                    role="cell"
   533	                    className="min-w-0 shrink truncate text-xs font-semibold text-primary-ol"
   534	                  >
   535	                    {thread.projectName}
   536	                  </span>
   537
   538	                  <div role="cell" className="min-w-0 flex flex-col justify-center">
   539	                    <span
   540	                      className="truncate text-xs font-medium text-secondary-ol"
   541	                      title={
   542	                        thread.title
   543	                          ? localizeTitle(thread.title, t as unknown as (key: string) => string)
   544	                          : undefined
   545	                      }
   546	                    >
   547	                      {thread.title
   548	                        ? localizeTitle(thread.title, t as unknown as (key: string) => string)
   549	                        : thread.title}
   550	                    </span>
   551	                    <div className="flex items-center gap-2 mt-0.5">
   552	                      {thread.triggerType && (
   553	                        <span className="truncate text-[10px] font-mono text-muted-ol">
   554	                          {humanizeEventType(
   555	                            thread.triggerType,
   556	                            t as unknown as (key: string) => string,
   557	                          )}
   558	                        </span>
   559	                      )}
   560	                      {thread.cascadeGroup && thread.cascadeGroup.length > 0 && (

exec
/bin/bash -lc "nl -ba web/src/hooks/use-ops-center-data.ts | sed -n '240,340p'" in /home/lee/OpenLander
 succeeded in 0ms:
   240	          });
   241	          setIsConnected(false);
   242
   243	          // Auto-retry with exponential backoff
   244	          if (retriesRef.current < MAX_RETRIES) {
   245	            retriesRef.current += 1;
   246	            setIsReconnecting(true);
   247	            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   248	            setTimeout(() => {
   249	              if (!cancelledRef.current) {
   250	                setIsReconnecting(false);
   251	                connect();
   252	              }
   253	            }, delay);
   254	          }
   255	        }
   256	      }
   257	    })();
   258	  }, [dedup]);
   259
   260	  // ---------------------------------------------------------------------------
   261	  // Initial parallel REST snapshot + SSE connect
   262	  // ---------------------------------------------------------------------------
   263	  useEffect(() => {
   264	    cancelledRef.current = false;
   265	    setIsLoading(true);
   266
   267	    const { from, to } = getTimeRangeParams(timeRange);
   268	    const activityParams = new URLSearchParams({ limit: '100' });
   269	    if (from) activityParams.set('from', String(from));
   270	    if (to) activityParams.set('to', String(to));
   271
   272	    // Parallel REST snapshot
   273	    Promise.all([
   274	      fetch(`/api/ops/activity?${activityParams.toString()}`, { credentials: 'include' }).then(
   275	        (r) => {
   276	          if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
   277	          return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
   278	        },
   279	      ),
   280	      fetchOpsIncidents(undefined, 'open', undefined, from, to),
   281	      fetchAllCircuitBreakers(),
   282	      fetchPendingApprovals().catch(() => [] as ActionRun[]),
   283	      fetchWithAuth('/api/ops/agent/active')
   284	        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
   285	        .catch(() => ({ isActive: false }) as AgentActiveState),
   286	    ])
   287	      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
   288	        if (cancelledRef.current) return;
   289
   290	        const items = activityData.activities.slice(0, BUFFER_MAX);
   291	        // Seed dedup set with initial snapshot IDs
   292	        for (const item of items) {
   293	          dedupSetRef.current.add(item.id);
   294	        }
   295	        // Track last event id (ULID) for SSE gap recovery
   296	        if (items.length > 0) {
   297	          lastEventIdRef.current = items[0].id;
   298	        }
   299
   300	        setActivities(items);
   301	        setIncidents(incidentData.incidents ?? []);
   302	        setCircuitBreakers(cbData.breakers ?? []);
   303	        setApprovals(approvalData);
   304	        setAgentStatus(agentData as AgentActiveState);
   305	        setError(null);
   306	      })
   307	      .catch((err: unknown) => {
   308	        if (!cancelledRef.current) {
   309	          const message = err instanceof Error ? err.message : String(err);
   310	          const isTimeout = err instanceof Error && err.name === 'AbortError';
   311	          setError({ type: isTimeout ? 'timeout' : 'api_error', message });
   312	        }
   313	      })
   314	      .finally(() => {
   315	        if (!cancelledRef.current) setIsLoading(false);
   316
   317	        // Open SSE after snapshot
   318	        if (!cancelledRef.current) {
   319	          retriesRef.current = 0;
   320	          connect();
   321	        }
   322	      });
   323
   324	    return () => {
   325	      cancelledRef.current = true;
   326	      abortRef.current?.abort();
   327	      abortRef.current = null;
   328	      dedupSetRef.current.clear();
   329	    };
   330	  }, [connect, timeRange]);
   331
   332	  // ---------------------------------------------------------------------------
   333	  // Manual retry: reset error and reconnect
   334	  // ---------------------------------------------------------------------------
   335	  const retry = useCallback(() => {
   336	    setError(null);
   337	    setIsLoading(true);
   338	    retriesRef.current = 0;
   339	    connect();
   340	  }, [connect]);

exec
/bin/bash -lc "sed -n '1,240p' web/src/hooks/use-ops-center-data.ts" in /home/lee/OpenLander
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

export interface OpsCenterError {
  type: 'connection_lost' | 'api_error' | 'timeout';
  message: string;
  retryCount?: number;
}

export interface OpsCenterData {
  activities: ActivityItem[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  approvals: ActionRun[];
  agentStatus: AgentActiveState;
  isConnected: boolean;
  isReconnecting: boolean;
  isLoading: boolean;
  error: OpsCenterError | null;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function getTimeRangeParams(timeRange?: string): { from?: number; to?: number } {
  if (!timeRange || timeRange === '_all') return {};

  const now = Date.now();
  let from: number;

  switch (timeRange) {
    case '1h':
      from = now - 60 * 60 * 1000;
      break;
    case '6h':
      from = now - 6 * 60 * 60 * 1000;
      break;
    case '24h':
      from = now - 24 * 60 * 60 * 1000;
      break;
    case '7d':
      from = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      from = now - 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      return {};
  }

  return { from, to: now };
}

export function useOpsCenterData(timeRange?: string): OpsCenterData {
  // --- Core state ---
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerWithProject[]>([]);
  const [approvals, setApprovals] = useState<ActionRun[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentActiveState>({ isActive: false });
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<OpsCenterError | null>(null);

  // --- Refs for SSE lifecycle ---
  const abortRef = useRef<AbortController | null>(null);
  const retriesRef = useRef(0);
  const lastEventIdRef = useRef<string | null>(null);
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
        if (lastEventIdRef.current) {
          params.set('since', lastEventIdRef.current);
        }

        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include',
        });

        if (!resp.ok || !resp.body) {
          if (!cancelledRef.current) {
            setError({ type: 'api_error', message: `Stream error: ${resp.status}` });
            setIsConnected(false);

            // Auto-retry with exponential backoff on non-OK responses
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
        let reconnectBatch: ActivityItem[] = [];

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

              // Handle backfill-complete sentinel: batch-apply all buffered items
              if (parsed.type === 'backfill-complete') {
                if (reconnectBatch.length > 0) {
                  const batch = reconnectBatch;
                  reconnectBatch = [];
                  setActivities((prev) => {
                    const merged = [...batch, ...prev];
                    return merged.slice(0, BUFFER_MAX);
                  });
                }
                continue;
              }

              const item = parsed as unknown as ActivityItem;
              if (!item.id) continue;

              // Track last event id (ULID) for gap recovery
              lastEventIdRef.current = item.id;

              if (!dedup(item.id)) continue;

              // Buffer items until backfill-complete, then apply as batch
              reconnectBatch.push(item);
            } catch {
              // Ignore malformed NDJSON lines
            }
          }

          // Flush any unbatched items (live incremental updates after backfill-complete)
          if (reconnectBatch.length > 0) {
            const batch = reconnectBatch;
            reconnectBatch = [];
            setActivities((prev) => [...batch, ...prev].slice(0, BUFFER_MAX));
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
          const isTimeout = err instanceof Error && err.name === 'AbortError';
          setError({
            type: isTimeout ? 'timeout' : 'connection_lost',
            message,
            retryCount: retriesRef.current,
          });

exec
/bin/bash -lc "nl -ba web/src/hooks/use-ops-center-data.ts | sed -n '100,180p'" in /home/lee/OpenLander
exec
/bin/bash -lc "sed -n '1,220p' web/package.json" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba src/web/api/ops-routes.ts | sed -n '605,650p'" in /home/lee/OpenLander
 succeeded in 0ms:
{
  "name": "web",
  "private": true,
  "version": "1.0.0-rc.7",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@dagrejs/dagre": "^3.0.0",
    "@fontsource-variable/geist-mono": "^5.2.7",
    "@fontsource-variable/inter": "^5.2.8",
    "@fontsource-variable/jetbrains-mono": "^5.2.8",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-tabs": "^1.1.13",
    "@tailwindcss/typography": "^0.5.19",
    "@tanstack/react-virtual": "^3.13.19",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-web-links": "^0.12.0",
    "@xterm/xterm": "^6.0.0",
    "@xyflow/react": "^12.10.2",
    "ansi-to-html": "^0.7.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "highlight.js": "^11.11.1",
    "lucide-react": "^0.574.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.13.1",
    "rehype-highlight": "^7.0.2",
    "remark-gfm": "^4.0.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@types/node": "^24.10.13",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.24",
    "eslint": "^9.39.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "globals": "^16.5.0",
    "postcss": "^8.5.6",
    "sass-embedded": "^1.98.0",
    "tailwindcss": "^3.4.19",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.48.0",
    "vite": "^5.4.21"
  }
}

 succeeded in 0ms:
   100	  const dedup = useCallback((id: string): boolean => {
   101	    const s = dedupSetRef.current;
   102	    if (s.has(id)) return false;
   103	    s.add(id);
   104	    // Prune when set exceeds 2x buffer to bound memory
   105	    if (s.size > BUFFER_MAX * 2) {
   106	      const arr = [...s];
   107	      dedupSetRef.current = new Set(arr.slice(arr.length - BUFFER_MAX));
   108	    }
   109	    return true;
   110	  }, []);
   111
   112	  // ---------------------------------------------------------------------------
   113	  // SSE connect with backfill + exponential backoff reconnect
   114	  // ---------------------------------------------------------------------------
   115	  const connect = useCallback(() => {
   116	    if (cancelledRef.current) return;
   117
   118	    abortRef.current?.abort();
   119	    const controller = new AbortController();
   120	    abortRef.current = controller;
   121
   122	    void (async () => {
   123	      try {
   124	        const params = new URLSearchParams({ follow: 'true' });
   125	        if (lastEventIdRef.current) {
   126	          params.set('since', lastEventIdRef.current);
   127	        }
   128
   129	        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
   130	          signal: controller.signal,
   131	          credentials: 'include',
   132	        });
   133
   134	        if (!resp.ok || !resp.body) {
   135	          if (!cancelledRef.current) {
   136	            setError({ type: 'api_error', message: `Stream error: ${resp.status}` });
   137	            setIsConnected(false);
   138
   139	            // Auto-retry with exponential backoff on non-OK responses
   140	            if (retriesRef.current < MAX_RETRIES) {
   141	              retriesRef.current += 1;
   142	              setIsReconnecting(true);
   143	              const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
   144	              setTimeout(() => {
   145	                if (!cancelledRef.current) {
   146	                  setIsReconnecting(false);
   147	                  connect();
   148	                }
   149	              }, delay);
   150	            }
   151	          }
   152	          return;
   153	        }
   154
   155	        if (!cancelledRef.current) {
   156	          setIsConnected(true);
   157	          setIsReconnecting(false);
   158	          retriesRef.current = 0; // reset on successful connection
   159	        }
   160
   161	        const reader = resp.body.getReader();
   162	        const decoder = new TextDecoder();
   163	        let buf = '';
   164	        let reconnectBatch: ActivityItem[] = [];
   165
   166	        for (;;) {
   167	          const { value, done } = await reader.read();
   168	          if (done || cancelledRef.current) break;
   169
   170	          buf += decoder.decode(value, { stream: true });
   171	          const lines = buf.split('\n');
   172	          buf = lines.pop() ?? '';
   173
   174	          for (const line of lines) {
   175	            const trimmed = line.trim();
   176	            if (!trimmed) continue;
   177
   178	            try {
   179	              const parsed = JSON.parse(trimmed) as Record<string, unknown>;
   180

 succeeded in 0ms:
   605	    if (isFollow) {
   606	      return stream(c, async (s) => {
   607	        c.header('Content-Type', 'application/x-ndjson');
   608	        let lastReportedId = c.req.query('since') || '';
   609	        let flushInProgress = false;
   610
   611	        const sendUpdates = async (): Promise<void> => {
   612	          if (flushInProgress) return;
   613	          flushInProgress = true;
   614	          try {
   615	            const page = fetchActivities(lastReportedId || undefined);
   616	            if (page.activities.length > 0) {
   617	              const forward = [...page.activities].reverse();
   618	              for (const act of forward) {
   619	                await s.write(JSON.stringify(act) + '\n');
   620	              }
   621	              const lastActivity = forward[forward.length - 1];
   622	              if (lastActivity) {
   623	                lastReportedId = lastActivity.id;
   624	              }
   625	            }
   626	          } catch (err) {
   627	            console.error('Unified feed streaming error:', err);
   628	          } finally {
   629	            flushInProgress = false;
   630	          }
   631	        };
   632
   633	        // Initial backfill
   634	        await sendUpdates();
   635	        await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
   636
   637	        const interval = setInterval(() => {
   638	          void sendUpdates();
   639	        }, 2000);
   640
   641	        await new Promise<void>((resolve) => {
   642	          s.onAbort(() => {
   643	            clearInterval(interval);
   644	            resolve();
   645	          });
   646	        });
   647	      });
   648	    }
   649
   650	    try {

exec
/bin/bash -lc 'git diff 0d36dd8..219506f -- web/package.json web/vite.config.ts' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/web/package.json b/web/package.json
index 5fe3227..b3730fd 100644
--- a/web/package.json
+++ b/web/package.json
@@ -10,6 +10,7 @@
     "preview": "vite preview"
   },
   "dependencies": {
+    "@dagrejs/dagre": "^3.0.0",
     "@fontsource-variable/geist-mono": "^5.2.7",
     "@fontsource-variable/inter": "^5.2.8",
     "@fontsource-variable/jetbrains-mono": "^5.2.8",
@@ -28,6 +29,7 @@
     "@xterm/addon-fit": "^0.11.0",
     "@xterm/addon-web-links": "^0.12.0",
     "@xterm/xterm": "^6.0.0",
+    "@xyflow/react": "^12.10.2",
     "ansi-to-html": "^0.7.2",
     "class-variance-authority": "^0.7.1",
     "clsx": "^2.1.1",
diff --git a/web/vite.config.ts b/web/vite.config.ts
index 59cc350..8f14f6d 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -21,6 +21,7 @@ export default defineConfig({
         manualChunks: {
           vendor: ['react', 'react-dom', 'react-router-dom'],
           ui: ['lucide-react'],
+          'react-flow': ['@xyflow/react', '@dagrejs/dagre'],
         },
       },
     },

codex
타입 체크는 현재 HEAD에서 통과했습니다. 번들 단계에서만 드러나는 이슈가 있는지 `build`도 확인하겠습니다.
exec
/bin/bash -lc 'npm run build' in /home/lee/OpenLander
 succeeded in 65276ms:

> openlander@1.0.0-rc.7 build
> npm run clean && tsup && npm run build:web


> openlander@1.0.0-rc.7 clean
> rm -rf dist

CLI Building entry: {"cli/index":"src/cli/index.ts"}
CLI Using tsconfig: tsconfig.json
CLI Building entry: {"index":"src/index.ts"}
CLI Using tsconfig: tsconfig.json
CLI tsup v8.5.1
CLI Using tsup config: /home/lee/OpenLander/tsup.config.ts
CLI tsup v8.5.1
CLI Using tsup config: /home/lee/OpenLander/tsup.config.ts
CLI Target: node22
ESM Build start
CLI Target: node22
ESM Build start
ESM dist/client-AYARULIZ.js             11.45 KB
ESM dist/client-manager-RIHLQYGH.js     292.00 B
ESM dist/cli/index.js                   14.13 KB
ESM dist/platform-read-VJNF2TOT.js      393.00 B
ESM dist/tools-IR3XI7FG.js              1.05 KB
ESM dist/server-ZTBEWLQV.js             824.00 B
ESM dist/recover-JZES3CLV.js            9.10 KB
ESM dist/auth-service-CCBBDQND.js       758.00 B
ESM dist/chunk-BKNCL7BG.js              4.91 KB
ESM dist/chunk-7IUYWAQF.js              87.61 KB
ESM dist/chunk-BBFAHMSM.js              81.60 KB
ESM dist/chunk-7W7SMQ5E.js              63.17 KB
ESM dist/chunk-ARAQZNUU.js              53.15 KB
ESM dist/chunk-UPVCYJUX.js              8.48 KB
ESM dist/chunk-IGSHITU6.js              31.85 KB
ESM dist/chunk-5ITTGAZI.js              22.43 KB
ESM dist/chunk-URF2PKFL.js              4.10 KB
ESM dist/chunk-E4HSRYHZ.js              2.67 KB
ESM dist/chunk-Y3OO3IMF.js              3.75 KB
ESM dist/chunk-INLPJDAO.js              14.10 KB
ESM dist/chunk-76ZT7G3P.js              153.00 B
ESM dist/config-QACVDNUH.js             602.00 B
ESM dist/server-4ZZEXPEX.js             299.20 KB
ESM dist/onboard-5GRNWICQ.js            6.10 KB
ESM dist/chunk-SS76QCHE.js              187.00 B
ESM dist/chunk-OLIBAMHN.js              1.75 KB
ESM dist/db-KSLLAZNU.js                 222.00 B
ESM dist/chunk-SCETZ5ZS.js              27.10 KB
ESM dist/app-L6557IMO.js                306.26 KB
ESM dist/git-GIDUKZVU.js                325.00 B
ESM dist/chunk-R6QCEY5U.js              27.17 KB
ESM dist/chunk-PDCGCLZK.js              5.19 KB
ESM dist/stats-OJ5PGB3Y.js              281.00 B
ESM dist/chunk-A36NJ7ML.js              6.16 KB
ESM dist/cleanup-N4FI43ZN.js            557.00 B
ESM dist/chunk-65LHFTWT.js              3.94 KB
ESM dist/chunk-22NJIM2C.js              4.44 KB
ESM dist/build-debugger-HWN3TRVX.js     340.00 B
ESM dist/chunk-KMKT3TY5.js              3.39 KB
ESM dist/chunk-22QUSAZW.js              17.80 KB
ESM dist/chunk-INP3EH3W.js              1.53 KB
ESM dist/chunk-JOMXMVEC.js              2.89 KB
ESM dist/chunk-2H7UOFLK.js              253.00 B
ESM dist/chunk-HU4IKSX7.js              227.60 KB
ESM dist/chunk-N5KWZQMB.js              12.94 KB
ESM dist/chunk-VNN5BNI4.js              108.66 KB
ESM dist/chunk-72HK7TOH.js              6.58 KB
ESM dist/client-manager-RIHLQYGH.js.map 71.00 B
ESM dist/client-AYARULIZ.js.map         23.20 KB
ESM dist/platform-read-VJNF2TOT.js.map  71.00 B
ESM dist/cli/index.js.map               27.37 KB
ESM dist/server-ZTBEWLQV.js.map         71.00 B
ESM dist/tools-IR3XI7FG.js.map          71.00 B
ESM dist/auth-service-CCBBDQND.js.map   71.00 B
ESM dist/recover-JZES3CLV.js.map        17.95 KB
ESM dist/chunk-BKNCL7BG.js.map          9.52 KB
ESM dist/chunk-IGSHITU6.js.map          37.96 KB
ESM dist/chunk-7IUYWAQF.js.map          171.08 KB
ESM dist/chunk-BBFAHMSM.js.map          150.36 KB
ESM dist/chunk-UPVCYJUX.js.map          14.64 KB
ESM dist/chunk-7W7SMQ5E.js.map          119.59 KB
ESM dist/chunk-ARAQZNUU.js.map          84.82 KB
ESM dist/chunk-E4HSRYHZ.js.map          5.61 KB
ESM dist/chunk-URF2PKFL.js.map          9.55 KB
ESM dist/chunk-5ITTGAZI.js.map          38.46 KB
ESM dist/chunk-Y3OO3IMF.js.map          9.73 KB
ESM dist/chunk-76ZT7G3P.js.map          499.00 B
ESM dist/config-QACVDNUH.js.map         71.00 B
ESM dist/chunk-OLIBAMHN.js.map          3.14 KB
ESM dist/onboard-5GRNWICQ.js.map        10.75 KB
ESM dist/chunk-INLPJDAO.js.map          31.65 KB
ESM dist/db-KSLLAZNU.js.map             71.00 B
ESM dist/chunk-SS76QCHE.js.map          291.00 B
ESM dist/git-GIDUKZVU.js.map            71.00 B
ESM dist/chunk-SCETZ5ZS.js.map          53.33 KB
ESM dist/stats-OJ5PGB3Y.js.map          71.00 B
ESM dist/chunk-PDCGCLZK.js.map          10.24 KB
ESM dist/cleanup-N4FI43ZN.js.map        71.00 B
ESM dist/chunk-A36NJ7ML.js.map          22.17 KB
ESM dist/chunk-65LHFTWT.js.map          8.14 KB
ESM dist/chunk-R6QCEY5U.js.map          49.30 KB
ESM dist/build-debugger-HWN3TRVX.js.map 71.00 B
ESM dist/chunk-KMKT3TY5.js.map          7.23 KB
ESM dist/chunk-JOMXMVEC.js.map          6.29 KB
ESM dist/chunk-INP3EH3W.js.map          3.14 KB
ESM dist/chunk-22QUSAZW.js.map          32.52 KB
ESM dist/chunk-2H7UOFLK.js.map          71.00 B
ESM dist/chunk-22NJIM2C.js.map          7.50 KB
ESM dist/chunk-N5KWZQMB.js.map          17.26 KB
ESM dist/chunk-VNN5BNI4.js.map          206.84 KB
ESM dist/chunk-HU4IKSX7.js.map          395.69 KB
ESM dist/chunk-72HK7TOH.js.map          12.89 KB
ESM dist/server-4ZZEXPEX.js.map         581.55 KB
ESM dist/app-L6557IMO.js.map            572.42 KB
ESM ⚡️ Build success in 211ms
ESM dist/stats-MMTBA7CF.js              231.00 B
ESM dist/git-Z54LVSJ6.js                245.00 B
ESM dist/chunk-AZWXNLI3.js              5.13 KB
ESM dist/cleanup-OG2GMEME.js            507.00 B
ESM dist/build-debugger-XRDPOBPD.js     230.00 B
ESM dist/chunk-IJ2NL5JJ.js              3.92 KB
ESM dist/chunk-34YIJ77J.js              4.42 KB
ESM dist/platform-read-LDWUQB4G.js      283.00 B
ESM dist/recover-XCRFJN5S.js            8.92 KB
ESM dist/chunk-JQRAVUIO.js              30.61 KB
ESM dist/chunk-Y5XUQMOJ.js              33.83 KB
ESM dist/chunk-J63RNTJ7.js              12.30 KB
ESM dist/chunk-Q2BFC2RA.js              1.51 KB
ESM dist/chunk-MSWEB3FI.js              1.73 KB
ESM dist/chunk-EFZEIF2B.js              3.04 KB
ESM dist/chunk-X3G35D7C.js              80.61 KB
ESM dist/index.js                       1.22 MB
ESM dist/stats-MMTBA7CF.js.map          71.00 B
ESM dist/git-Z54LVSJ6.js.map            71.00 B
ESM dist/chunk-AZWXNLI3.js.map          10.23 KB
ESM dist/cleanup-OG2GMEME.js.map        71.00 B
ESM dist/build-debugger-XRDPOBPD.js.map 71.00 B
ESM dist/chunk-IJ2NL5JJ.js.map          8.14 KB
ESM dist/platform-read-LDWUQB4G.js.map  71.00 B
ESM dist/recover-XCRFJN5S.js.map        17.94 KB
ESM dist/chunk-34YIJ77J.js.map          7.50 KB
ESM dist/chunk-JQRAVUIO.js.map          53.44 KB
ESM dist/chunk-J63RNTJ7.js.map          34.79 KB
ESM dist/chunk-Q2BFC2RA.js.map          3.13 KB
ESM dist/chunk-Y5XUQMOJ.js.map          56.87 KB
ESM dist/chunk-MSWEB3FI.js.map          3.14 KB
ESM dist/chunk-EFZEIF2B.js.map          6.30 KB
ESM dist/chunk-X3G35D7C.js.map          161.40 KB
ESM dist/index.js.map                   2.28 MB
ESM ⚡️ Build success in 212ms
DTS Build start
DTS Build start
DTS ⚡️ Build success in 4622ms
DTS dist/cli/index.d.ts 13.00 B
DTS ⚡️ Build success in 5010ms
DTS dist/index.d.ts 134.03 KB

> openlander@1.0.0-rc.7 build:web
> cd web && npm install && npx vite build


up to date, audited 501 packages in 776ms

166 packages are looking for funding
  run `npm fund` for details

5 vulnerabilities (3 moderate, 2 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
vite v5.4.21 building for production...
transforming...
✓ 2686 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                                       0.79 kB │ gzip:   0.43 kB
dist/assets/jetbrains-mono-vietnamese-wght-normal-Bt-aOZkq.woff2      7.50 kB
dist/assets/jetbrains-mono-greek-wght-normal-Bw9x6K1M.woff2           9.00 kB
dist/assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2              10.25 kB
dist/assets/inter-greek-ext-wght-normal-DlzME5K_.woff2               11.23 kB
dist/assets/jetbrains-mono-cyrillic-wght-normal-D73BlboJ.woff2       12.11 kB
dist/assets/geist-mono-cyrillic-wght-normal-BZdD_g9V.woff2           12.62 kB
dist/assets/geist-mono-latin-ext-wght-normal-b6lpi8_2.woff2          13.04 kB
dist/assets/jetbrains-mono-latin-ext-wght-normal-DBQx-q_a.woff2      15.20 kB
dist/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2                18.75 kB
dist/assets/inter-greek-wght-normal-CkhJZR-_.woff2                   19.00 kB
dist/assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2            25.96 kB
dist/assets/geist-mono-latin-wght-normal-Cjtb1TV-.woff2              31.37 kB
dist/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2          40.40 kB
dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2                   48.26 kB
dist/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2               85.07 kB
dist/assets/DependencyGraph-BZV40eAE.css                             15.85 kB │ gzip:   2.66 kB
dist/assets/index-DUwA5C9t.css                                      107.95 kB │ gzip:  21.53 kB
dist/assets/DependencyGraph-CCmXISb2.js                               3.43 kB │ gzip:   1.48 kB
dist/assets/ui-qXJYcYi4.js                                           42.77 kB │ gzip:   8.94 kB
dist/assets/vendor-D25e9Rxc.js                                       49.65 kB │ gzip:  17.41 kB
dist/assets/react-flow-DjBYssIv.js                                  217.94 kB │ gzip:  72.16 kB
dist/assets/index-BgiauF_7.js                                     1,668.14 kB │ gzip: 470.83 kB

(!) Some chunks are larger than 512 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.86s

exec
/bin/bash -lc "nl -ba web/src/pages/OpsCenterV2.tsx | sed -n '250,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
   250	        <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
   251	          <div className="mx-auto w-full min-w-0 max-w-[1500px] space-y-6">
   252	            {/* Page header */}
   253	            <div className="flex items-center justify-between">
   254	              <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
   255	                {t('opsV2.page.title')}
   256	              </h1>
   257	              <div className="flex items-center gap-3">
   258	                <KeyboardShortcutsHelp />
   259	                <div className="flex items-center bg-bg-subtle rounded-lg p-1 border border-[hsl(var(--border))]">
   260	                  <button
   261	                    onClick={() => setViewMode('feed')}
   262	                    className={cn(
   263	                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
   264	                      viewMode === 'feed'
   265	                        ? 'bg-bg-panel text-primary-ol shadow-sm'
   266	                        : 'text-muted-ol hover:text-secondary-ol',
   267	                    )}
   268	                  >
   269	                    <Activity className="h-4 w-4" />
   270	                    {t('opsV2.graph.feedView')}
   271	                  </button>
   272	                  <button
   273	                    onClick={() => setViewMode('graph')}
   274	                    className={cn(
   275	                      'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
   276	                      viewMode === 'graph'
   277	                        ? 'bg-bg-panel text-primary-ol shadow-sm'
   278	                        : 'text-muted-ol hover:text-secondary-ol',
   279	                    )}
   280	                  >
   281	                    <Network className="h-4 w-4" />
   282	                    {t('opsV2.graph.graphView')}
   283	                  </button>
   284	                </div>
   285	              </div>
   286	            </div>
   287
   288	            {/* Error Banners */}
   289	            {isReconnecting && (
   290	              <div className="flex items-center gap-3 rounded-md bg-warning/10 border border-warning/20 px-4 py-3 text-sm text-warning">
   291	                <Loader2 className="h-4 w-4 animate-spin text-warning" />
   292	                <p>
   293	                  {t('opsV2.errors.retrying').replace('{count}', String(error?.retryCount ?? 1))}
   294	                </p>
   295	              </div>
   296	            )}
   297	            {error && !isReconnecting && (
   298	              <div className="flex items-center justify-between gap-3 rounded-md bg-error/10 border border-error/20 px-4 py-3 text-sm text-error">
   299	                <div className="flex items-center gap-3">
   300	                  <AlertCircle className="h-4 w-4 text-error" />
   301	                  <p>
   302	                    {error.type === 'connection_lost'
   303	                      ? t('opsV2.errors.connectionLost')
   304	                      : error.type === 'api_error'
   305	                        ? t('opsV2.errors.apiError')
   306	                        : error.message}
   307	                  </p>
   308	                </div>
   309	                <button
   310	                  onClick={retry}
   311	                  className="flex items-center gap-2 rounded bg-bg-panel px-3 py-1.5 text-xs font-medium text-primary-ol hover:bg-bg-subtle border border-[hsl(var(--border))] transition-colors"
   312	                >
   313	                  <RefreshCw className="h-3 w-3" />
   314	                  {t('opsV2.errors.retry')}
   315	                </button>
   316	              </div>
   317	            )}
   318
   319	            {/* Filters */}
   320	            {viewMode === 'feed' && (

exec
/bin/bash -lc "nl -ba web/src/pages/OpsCenterV2.tsx | sed -n '320,380p'" in /home/lee/OpenLander
 succeeded in 0ms:
   320	            {viewMode === 'feed' && (
   321	              <div className="flex flex-col lg:flex-row gap-6 items-start">
   322	                <div className="flex-1 w-full">
   323	                  <FilterBar filters={filters} projects={projects} onFilterChange={setFilters} />
   324	                </div>
   325	                {circuitBreakers.length > 0 && (
   326	                  <div className="w-full lg:w-64 shrink-0 bg-bg-subtle/30 rounded-lg border border-[hsl(var(--border))] p-3">
   327	                    <CircuitBreakerWidget
   328	                      circuitBreakers={circuitBreakers}
   329	                      onFilter={() => setFilters({ density: 'actions-only' })}
   330	                    />
   331	                  </div>
   332	                )}
   333	              </div>
   334	            )}
   335
   336	            <main className="min-w-0">
   337	              {viewMode === 'feed' ? (
   338	                <MainFeedGrid
   339	                  activities={filteredActivities}
   340	                  isFiltered={activities.length > 0 && filteredActivities.length === 0}
   341	                  onClearFilters={() => setFilters({ density: 'all' })}
   342	                  onThreadSelect={handleThreadSelect}
   343	                  focusedIndex={currentFocusIndex}
   344	                />
   345	              ) : (
   346	                <div className="h-[600px] w-full">
   347	                  <Suspense
   348	                    fallback={
   349	                      <div className="flex items-center justify-center h-full w-full bg-bg-panel rounded-lg border border-[hsl(var(--border))]">
   350	                        <Loader2 className="h-8 w-8 animate-spin text-muted-ol" />
   351	                      </div>
   352	                    }
   353	                  >
   354	                    <DependencyGraph />
   355	                  </Suspense>
   356	                </div>
   357	              )}
   358	            </main>
   359	          </div>
   360	        </div>
   361	      </div>
   362
   363	      <IncidentDetailSlideover
   364	        incidentId={selectedIncidentId}
   365	        onClose={() => setSelectedIncidentId(null)}
   366	      />
   367	    </div>
   368	  );
   369	}

exec
/bin/bash -lc "nl -ba web/src/components/ops/v2/FilterBar.tsx | sed -n '50,110p'" in /home/lee/OpenLander
 succeeded in 0ms:
    50	  projectId: 'project',
    51	  timeRange: 'timeRange',
    52	} as const;
    53
    54	// ---------------------------------------------------------------------------
    55	// Hook: sync filters with URL search params
    56	// ---------------------------------------------------------------------------
    57
    58	export function useFilterSearchParams(): [FilterState, (next: FilterState) => void] {
    59	  const [searchParams, setSearchParams] = useSearchParams();
    60
    61	  const filters: FilterState = {
    62	    density: (searchParams.get(PARAM_KEYS.density) as DensityMode | null) ?? 'all',
    63	    severity: searchParams.get(PARAM_KEYS.severity) ?? undefined,
    64	    projectId: searchParams.get(PARAM_KEYS.projectId) ?? undefined,
    65	    timeRange: searchParams.get(PARAM_KEYS.timeRange) ?? undefined,
    66	  };
    67
    68	  const setFilters = useCallback(
    69	    (next: FilterState) => {
    70	      setSearchParams(
    71	        (prev) => {
    72	          const params = new URLSearchParams(prev);
    73
    74	          if (next.density && next.density !== 'all') {
    75	            params.set(PARAM_KEYS.density, next.density);
    76	          } else {
    77	            params.delete(PARAM_KEYS.density);
    78	          }
    79
    80	          if (next.severity) {
    81	            params.set(PARAM_KEYS.severity, next.severity);
    82	          } else {
    83	            params.delete(PARAM_KEYS.severity);
    84	          }
    85
    86	          if (next.projectId) {
    87	            params.set(PARAM_KEYS.projectId, next.projectId);
    88	          } else {
    89	            params.delete(PARAM_KEYS.projectId);
    90	          }
    91
    92	          if (next.timeRange) {
    93	            params.set(PARAM_KEYS.timeRange, next.timeRange);
    94	          } else {
    95	            params.delete(PARAM_KEYS.timeRange);
    96	          }
    97
    98	          return params;
    99	        },
   100	        { replace: true },
   101	      );
   102	    },
   103	    [setSearchParams],
   104	  );
   105
   106	  return [filters, setFilters];
   107	}
   108
   109	// ---------------------------------------------------------------------------
   110	// FilterBar component

codex
**Findings**

- 높음: 시간 범위 필터가 실제 activity feed 전체에 일관되게 적용되지 않습니다. 클라이언트는 초기 스냅샷에서만 `from/to`를 붙이고, 이후 SSE 연결은 `/api/ops/activity?follow=true`로 열어 버립니다. 그래서 `1h` 같은 범위를 선택해도 재연결 직후 서버의 초기 backfill이 기본 범위 데이터를 다시 밀어 넣습니다. 게다가 서버는 `incident/alert`에만 `from/to`를 쓰고 `recovery/approval/ai:*`는 최근 200건을 그대로 가져오므로, 시간 필터가 UI에서 거짓말하게 됩니다. [use-ops-center-data.ts](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L124) [use-ops-center-data.ts](/home/lee/OpenLander/web/src/hooks/use-ops-center-data.ts#L267) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L460) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L520) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L560) [ops-routes.ts](/home/lee/OpenLander/src/web/api/ops-routes.ts#L633)

- 중간: 새 키보드 단축키 구현이 현재 i18n/스레드 모델과 맞지 않습니다. `?` 단축키는 `aria-label*="Keyboard"`로 버튼을 찾는데, 한국어 라벨에서는 이 문자열이 없어서 바로 깨집니다. 그리고 `j/k` 이동 한계값은 렌더되는 thread 수가 아니라 raw `activities.length`를 사용해서, 이벤트가 많이 묶인 경우 포커스 인덱스가 실제 행 수를 넘어갑니다. [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L91) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L125) [KeyboardShortcutsHelp.tsx](/home/lee/OpenLander/web/src/components/ops/v2/KeyboardShortcutsHelp.tsx#L33) [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L369) [MainFeedGrid.tsx](/home/lee/OpenLander/web/src/components/ops/v2/MainFeedGrid.tsx#L483)

- 중간: 필터 setter는 “전체 상태 교체” 방식인데 호출부는 “partial patch”처럼 쓰고 있어서 빠른 필터 액션이 오동작합니다. Circuit Breaker 위젯의 `setFilters({ density: 'actions-only' })`는 기존 `project/severity/timeRange`를 전부 날려 버리고, 반대로 빈 상태의 “clear filters”는 `density`만 `all`로 바꿔서 실제 원인이 `project/severity/timeRange`면 아무 것도 해제하지 못합니다. [FilterBar.tsx](/home/lee/OpenLander/web/src/components/ops/v2/FilterBar.tsx#L58) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L327) [OpsCenterV2.tsx](/home/lee/OpenLander/web/src/pages/OpsCenterV2.tsx#L341)

- 낮음: incident 검색이 SQL `LIKE '%query%'`를 그대로 써서 `%`나 `_`가 포함된 검색어를 escape하지 않습니다. SQL injection은 아니지만, `%` 입력만으로 사실상 전체 검색이 되고 literal `%/_` 검색도 정확히 못 합니다. API 계약상 search 파라미터를 추가했으면 이 정도는 막는 편이 낫습니다. [ops-incident.repo.ts](/home/lee/OpenLander/src/db/repos/ops-incident.repo.ts#L81)

**확인 메모**

현재 워크트리 기준으로는 사용자가 적어준 두 TypeScript 에러는 재현되지 않았습니다. `npm run typecheck`와 `npm run build`는 모두 통과했습니다. 변경 파일 범위에서 `as any`, `@ts-ignore`, `@ts-expect-error`는 찾지 못했고, `react-markdown`은 raw HTML 플러그인을 쓰지 않아 눈에 띄는 XSS 경로도 보이지 않았습니다.

남는 리스크는 시간 필터/SSE 회귀와 키보드 단축키 쪽 UX 버그입니다. 이 둘은 실제 운영 화면에서 바로 체감될 가능성이 큽니다.
tokens used
149,682

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
