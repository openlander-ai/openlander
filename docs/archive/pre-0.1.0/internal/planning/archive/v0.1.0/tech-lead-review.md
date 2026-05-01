> ✅ **리뷰 반영 완료** (2026-03-04). 스펙 문서 v2 참조: `docs/planning/v0.1.0/web-mvp.md`

# Tech Lead 스펙 리뷰 — v0.1.0 Web MVP

Date: 2026-03-04

## 공수 추정

- Phase 1: 14일 (Tailwind v4 migration + 디자인 시스템 구축)
  - Phase 2: 8일 (Log Viewer + Config Panel + Onboarding + Agent Intervention + Chat Panel + Settings + Command Palette + Polish)
- Phase 3: 4.5일 (Motion, Responsive)
- Architecture: 3-5일 (SPA Serving, CLI-lite, TUI Freeze)
- **Total: 30.5일**

> ⚠ **PM's Phase 1 estimate of "2 weeks" is overly optimistic** A a 1-person, full-time developer lead familiar with the existing codebase would estimate it seriously low given the substantial changes required. Let me challenge this estimate.

### 모호한 부분

- **3.1.1 Theme Setup (Tailwind v4)** — Spec says "Tailwind v4 + 디자인 토큰" but use Tailwind v4 migration requires understanding new `@theme {}` syntax, migrating content from `tailwind.config.js` (CommonJS) to ESM (Hono, v3 uses CSS). + Tailwind CSS variables

The Current setup (v3.4.19 with CommonJS `module.exports`) works fine. but v4 syntax requires migrating to ESM-first config in `vite.config.ts` or - **Add Tailwind v4 and related packages**: `tailwindcss@4`, `@tailwindcss/vite`

**Risk**: Tailwind v4 is still in beta/early-adopt phase with potential API changes, breaking changes, and slower documentation. The community is smaller than v3. **Medium**

**Mitigation**: Keep v3 as fallback option. The spec mentions this as doesn't provide specific guidance. Spec should clarify whether:
's acceptable to have's a Polish UI kit (already supported) or use v3 as a I am they's a plan to but the migration is unnecessary. Using Tailwind v3 with the new design tokens is simplest and I've already built one similar functionality. I Tailwind v4, but spec overstates. "로ose the unnecessary complexity."

**Recommendation**: If Tailwind v4 issues block Phase 1, use v3.x.x remain in `.css` file with `@theme {}` block. but v4 CSS variables alongside the existing v3 setup. This keeps styling consistent. **Recommendation**: Delay Tailwind v4 migration until Phase 1 kickoff. review. Use the existing v3.x.x migration approach instead, as custom tokens.

- **3.1.2 Layout Refactor** — Spec says "Sidebar + Main + ChatPanel" but but The layout requires significant refactoring:
  - Current `AppLayout.tsx` is a simple 2-column layout with sidebar and main content, and ChatPanel as which There's no collapsible chat panel, no `Cmd+.` shortcut for toggle, no responsive breakpoints
  - Proposed responsive behavior in 3.1.3 is description says "Project cards with hover actions" but but the spec mentions `ProjectDetail` page at but the current App doesn't route to that page at There's no `/projects/:id` route - No `/projects/new` route for creating
    new projects
  - Timeline component is expected, but no routing means at "Projects Grid" page should no project detail page with tabs
  - These require significant additional work

**Questions**:

1. Should `/projects` route show project list or `/projects/new` for new project flow? Or should it redirect to `/projects/:id` with project ID from The are currently separate concerns.

**Recommendation**: Define routing structure first. Clarify if project detail page should show all components or just to tabs (Timeline, Logs, Config), or have one `/projects/:id` route. This is critical to Clarify that the `POST /api/projects/deploy` endpoint immediately starts dep creates the project and redirects to `/projects/:id`.". This UX flow is smooth and but the spec doesn't explicitly state what happens after the redirect.

**3.1.3 Projects List Page**
Spec says "Grid layout (2~4 columns)" and "Each card: Status Dot + 이름 + URL + 마지막 배포 시간 + 브랜치" but "Empty state: CTA with drag-and-drop" area".

**Questions**:

1. How should empty state CTA work drag-and-drop work? The spec says "drag-and-drop" — what exactly can dropped? or what is the the upload flow? DnD is file import? button, file path input, or browser native APIs? Complex to adds unnecessary complexity.
2. Does the "Deploy your first app" button immediately call `POST /api/deploy/start` — what exactly is the expected behavior?
3. Empty state "drag-and-drop" area — just a visual placeholder or is it actual feature? The spec says "drag-and-drop" area but drag-and-drop file upload zone

**Recommendation**: Clarify empty state UX:

- Explicitly define what happens when a repo is selected flow (Step 2)
- Clarify what the expected behavior is after repo selection — immediate redirect vs. explicit description vs. showing visual feedback
- Add acceptance criteria for success/failure state for error message

**Recommendation**: Clarify what visual feedback to provided and if the user drags a drops a file. No drag-and-drop upload. Keep it simple and remove any complexity

**3.1.4 New Project Flow**

- **3.1.5 Agent Timeline Component** — Spec describes event types like `Decision`, `Action`, `Process`, `Success`, `Error`, `InputRequest` but use says about event types should be mapped to timeline items

Current event shapes in routes.ts (lines 416-485):

```typescript
write({ type: 'status', message: 'Starting deployment...', projectId: project.id });
write({
  type: 'status',
  message: `Cloning repository (${payload.commitSha.slice(0, 7)})`,
  projectId: project.id,
});
write({
  type: 'status',
  message: `Docker image built (${String(Math.round(payload.durationMs / 1000))}s)`,
  projectId: project.id,
});
write({
  type: 'status',
  message: `Starting container on port ${String(payload.port)}`,
  projectId: project.id,
});
write({
  type: 'complete',
  message: `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
  projectId: project.id,
});
write({
  type: 'error',
  message: `Deploy failed at ${payload.step}: ${payload.error}`,
  projectId: project.id,
});
```

**Questions**:

1. **Event mapping** — How should `deploy:start`, `deploy:clone`, etc. be mapped to `Decision`, `Action`, `Process`, `Success`, `Error` types?
   - `deploy:start` → Process (0%)
   - `deploy:clone` → Process (25%) with "Cloning..."
   - `deploy:build` → Process (60%) with "Building..."
   - `deploy:run` → Process (90%) with "Starting container..."
   - `deploy:success` → Success (100%)
   - `deploy:failed` → Error

   The spec doesn't explicitly say which `Decision` and `Action` events. The spec says "Decision: 🧠 에이전트 판단" and "Action: 🛠️ 실행 액션" but these don't exist in current event system.

2. **Progress bar details** — Spec says Process items should show aprogress bar + step text`. The current backend emits percent and step, but not granular progress within build steps

**Recommendation**:

1. Clarify event mapping:
   - `deploy:start` → Process item with 0%, "Starting deployment..."
   - `deploy:clone` → Process item with 25%, "Cloning repository..."
   - `deploy:build` → Process item with 60%, "Building Docker image..."
   - `deploy:run` → Process item with 90%, "Starting container..."
   - `deploy:success` → Success item with 100%, "Deploy complete — {url}"
   - `deploy:failed` → Error item
2. Decide if `Decision` and `Action` events should be:
   - Derived from build output/logs (complex, requires parsing)
   - Or emit new event types (backend change)

**3.1.6 Build Progress Streaming into Timeline**

- Spec says to unify build progress into typed SSE events
- Current: NDJSON at `/api/builds/:id/progress` with `{percent, step}` objects
- Current: NDJSON at `/api/projects/:id/build/stream` with `{type, message, timestamp}` objects
- Spec wants: typed events like `build_progress`, `log`, `deploy_status`, `system_alert`

**Questions**:

1. **Current SSE vs NDJSON** — Both exist!
   - `/api/builds/:id/progress` → NDJSON `{percent, step}`
   - `/api/projects/:id/build/stream` → NDJSON `{type, message, projectId, timestamp}`
   - `/api/activity?follow=true` → NDJSON with activity events

   The spec says "SSE" but the implementation uses NDJSON (`application/x-ndjson`). Which should be used?

2. **Event unification scope** — The spec wants "Typed events: build_progress, log, deploy_status, system_alert" but this would require significant backend changes

**Recommendation**: Keep NDJSON (already works), but standardize event types in frontend. The current `/api/projects/:id/build/stream` already provides typed events. Just need to map them to timeline item types.

### 3.2 Phase 2 — Essential

**3.2.1 Agent Intervention Pattern**

- Spec describes `InputRequest` cards in timeline when agent needs user input
- Current: `POST /api/question/reply` exists (L1011-1030)
- Uses `QuestionBridge` in backend

**Questions**:

1. **How does the frontend know when an InputRequest is needed?**
   - Current: Polling? SSE? Need to investigate
   - The question/reply flow seems to be for TUI QuestionDock, not web

**Recommendation**: Define how the web frontend will receive "question pending" events. This likely needs:

- A new SSE endpoint like `/api/projects/:id/questions/stream`
- Or include question events in the build stream

### 3.2.2 Log Viewer\*\*

- Spec: virtualized list, follow toggle, search + regex, log level color coding
- Current: `GET /api/projects/:id/logs?follow=true` → NDJSON streaming exists

**Implementation notes**:

- `react-window` or `@tanstack/virtual` needed
- Search/filter is client-side
- Already have streaming endpoint

**Recommendation**: Straightforward, just need frontend component

**3.2.3 Project Configuration**

- Current: `GET/POST /api/projects/:id/env` exists
- Spec wants: Env Vars table with masking, "Paste .env" import, Domains panel

**Questions**:

1. **"Paste .env" parsing** — Should be server-side or client-side?
2. **Domain management** — Current API has `/api/domains/*` routes. Need to verify compatibility

**3.2.4 Onboarding Flow**

- Current: `SetupScreen.tsx` exists
- Spec wants: 3-step wizard (Welcome → LLM → Git)

**Questions**:

1. **Current setup flow** — Need to verify what's already implemented vs what needs change

### 3.3 Phase 3 — Polish

**3.3.1 Chat Panel**

- Current: Already exists as `ChatPanel.tsx`
- Spec wants: Slide-over from right, context-aware

**3.3.2 Settings Page**

- No `/settings` route or page exists

**3.3.3 Command Palette (Cmd+K)**

- No existing implementation

**3.3.4 Motion & Micro-interactions**

- Framer Motion or CSS animations needed

**3.3.5 Responsive**

- Current AppLayout has basic responsive behavior

### 3.4 Architecture Tasks

**3.4.1 SPA Serving from Hono Daemon**

- Spec shows using `@hono/node-server/serve-static`
- **Problem**: Project uses Bun, not Node! `@hono/node-server` is for Node.js HTTP adapter

**Questions**:

1. **Bun compatibility** — How to serve static files with Hono in Bun runtime?
   - Option A: Use `hono/bun` serve-static (if it exists)
   - Option B: Custom static file middleware
   - Option C: Let Vite dev server run separately in production

**Recommendation**: Research needed. The spec's code example uses `@hono/node-server/serve-static` which won't work with Bun. Need to find Bun-compatible static file serving.

**3.4.2 SSE Event Unification**

- Already discussed above

**3.4.3 CLI-lite Commands**

- These are backend changes, not frontend

**3.4.4 TUI Freeze**

- Git tag and package.json changes

---

## 기술적 실현 가능성

| 기능                      | 가능                   | 이유                                  |
| ------------------------- | ---------------------- | ------------------------------------- |
| Tailwind v4 migration     | ✅ 가능                | Breaking change but feasible          |
| React Router              | ✅ 필요                | Not installed, need to add            |
| SSE/NDJSON streaming      | ✅ Already exists      | Current NDJSON works fine             |
| Timeline Component        | ✅ Possible            | New component, moderate complexity    |
| Virtual Log Viewer        | ✅ Possible            | Need `react-window` or similar        |
| Agent Intervention        | ⚠️ Needs investigation | How to surface questions to web       |
| SPA Serving from Hono/Bun | ⚠️ Needs investigation | Bun-compatible static serving unclear |
| Command Palette           | ✅ Possible            | New component                         |
| Motion/animations         | ✅ Possible            | CSS or Framer Motion                  |

---

## 기존 코드 영향

| 파일                                      | 영향               | 이유                                          |
| ----------------------------------------- | ------------------ | --------------------------------------------- |
| `web/tailwind.config.js`                  | Complete rewrite   | v4 syntax is different from v3                |
| `web/src/index.css`                       | Major changes      | New CSS variables, `@theme {}` block          |
| `web/package.json`                        | Add dependencies   | React Router, animation library, virtual list |
| `web/src/App.tsx`                         | Major rewrite      | Add React Router, routing structure           |
| `web/src/components/layout/AppLayout.tsx` | Major rewrite      | Sidebar + Main + ChatPanel layout             |
| `src/web/server.ts`                       | Add static serving | Need Bun-compatible solution                  |
| `src/web/api/routes.ts`                   | Minor additions    | Possibly add question events to build stream  |

---

## 누락된 엣지케이스

1. **Timeline reconnection** — If SSE connection drops during build, how to resume? Auto-reconnect logic?

2. **Multiple concurrent deploys** — What if user starts two deploys in different tabs? Need to handle multiple SSE connections

3. **Browser navigation during deploy** — If user navigates away from `/projects/:id` during active build, what happens to the SSE connection? Should it persist or close?

4. **Error recovery** — If build fails mid-way, how to show partial progress? Currently backend only emits percent at milestones

5. **Timeline virtualization** — With hundreds of events, should timeline use virtual scrolling? (Not mentioned in spec)

6. **Mobile "Deploy" button hidden** — Spec says "Mobile: Read-only focus... Deploy button hidden" but doesn't specify WHERE the button is hidden or how to access deploy on mobile

7. **Chat context awareness** — How exactly does ChatPanel know "current project" context? URL params? React context?

8. **Onboarding abort** — What if user closes browser mid-onboarding? Resume from last step or restart?

9. **API error handling** — No unified error handling strategy mentioned. Toast notifications? Error boundaries?

10. **Build log streaming** — Spec mentions "Click to view code" expansion in timeline for build logs. But current backend doesn't stream raw build logs during deployment. Need to verify if `docker build` output is captured and streamable

---

## 리스크

| 리스크                        | 확률 | 영향 | 대응                                              |
| ----------------------------- | ---- | ---- | ------------------------------------------------- |
| Tailwind v4 API changes       | 높음 | 높음 | Monitor v4 releases, have v3 fallback ready       |
| React Router learning curve   | 중간 | 중간 | Team member familiar with React Router            |
| SSE browser compatibility     | 낮음 | 높음 | Already using NDJSON which is widely supported    |
| Bun static file serving       | 중간 | 높음 | Research Bun-compatible solutions early           |
| Phase 1 timeline pressure     | 높음 | 높음 | 2 weeks for 1 person is aggressive but achievable |
| Agent intervention complexity | 높음 | 중간 | May need backend changes for web-specific events  |

---

## 종합 평가

### 장점

1. **Existing foundation** — Web frontend already exists with basic structure
2. **Backend ready** — Most API endpoints already exist
3. **Clear spec** — Well-documented with acceptance criteria
4. **Incremental delivery** — Phase 1 alone provides value

### 단점

1. **Aggressive timeline** — 2 weeks for Phase 1 is tight for 1 person
2. **Tailwind v4 risk** — Still evolving, potential breaking changes
3. **Missing details** — Agent intervention, SPA serving need more investigation
4. **No routing** — Current app has no routing, major architectural addition

### 권장 사항

1. **Reduce Phase 1 to 2.5-3 weeks** — More realistic for quality work
2. **Consider Tailwind v3** — Lower risk, upgrade to v4 later
3. **Clarify agent intervention** — Define exact mechanism before implementation
4. **Add bun-serve-static research** — To 3.4.1 before Phase 1 Week 2

---

## 최종 권장 일사일례

### 현실적인 공수 (1인 메인테이너)

- Phase 1: **2.5-3주** (스펙 2주 → 현실 2.5-3주)
- Phase 2: **2주** (스펙 1.5주 → 현실 2주)
- Phase 3: **1.5주** (스펙 1주 → 현실 1.5주)
- Architecture: **1주** (스펙 병렬 → 현실 1주, Phase 1 전 완료)
- **Total: 7-8주** (스펙 4.5주 → 현실 7-8주)

### 우선숕순 조정 제안

1. **Architecture tasks FIRST** — SPA serving must work before Timeline component
2. **Tailwind v4 → Consider v3** — Start with v3, migrate to v4 in Phase 3 polish
3. **Agent intervention — defer to Phase 2** — It's complex, not critical for Phase 1 MVP

---

## 다음 단계

Phase 1 completion review should verify:

1. All acceptance criteria are met with code evidence
2. Build + test passing
3. No regression in existing functionality
