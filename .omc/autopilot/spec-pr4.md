# Autopilot Spec — PR4 (InfraMap React Flow + AppLayout takeover + LogViewer cleanup + best-effort wire-up)

> Phase 0 lightweight expansion — brief is concrete. Build on PR1+PR2+PR3 (all uncommitted on `ui-redesign-1.0`).

## Goals

1. **A. InfraMap React Flow rewrite** — current SVG-bezier impl renders crooked under flex-wrap. Library-driven edge routing solves this.
2. **B. AppLayout takeover completion** — drop legacy shell, all routes under `<AppShell />`.
3. **C. LogViewer cleanup** — split 787-line file, remove fixed-height clipping, BACKFILLING in Kill gate, drop magic-number slice.
4. **D. Best-effort backend wire-up** — `web/src/lib/api/projects.ts` already has `listProjects()` + `getProject()`. Wrap in `use-projects.ts` hook + `use-project.ts` hook + replace MOCK_PROJECTS in Home/Activity/Sidebar/ProjectViewV2.
5. **E. i18n PATCH-PR4.md** for the migrated routes.

## Backend wire-up reality

Existing endpoints we can use **today** (from `web/src/lib/api/projects.ts` + `services.ts`):

- ✅ `GET /api/projects` → `listProjects()` returns `Project[]` with optional `environments[]`
- ✅ `GET /api/projects/:id` → `getProject(id)` returns `Project` with environments
- ✅ `GET /api/projects/:id/services` → `getProjectConnectedServices()` returns DB-side services connected to project
- ✅ `GET /api/services` → `getServices()` returns standalone Services (db servers — postgres/redis/mongo)
- ✅ `GET /api/projects/:id/deployments` → `getProjectDeployments()` returns DeployLogSummary[]

5 NEW endpoints we need but DON'T have:

- ❌ `/api/projects/:id/topology` — services + dependsOn[] graph
- ❌ `/api/services/:id/health` — `'healthy' | 'crashed'`
- ❌ `/api/deployments/:id/log/stream` — SSE/WebSocket
- ❌ `/api/services/:id/metrics?range=…` — sparkline series
- ❌ `/api/settings/notifications/webhook` — POST webhook config

PR4-D scope: wire what exists. Document what doesn't.

## Mapping decisions

The backend shape ≠ prototype shape:

- Backend `Project.status` has values like `'running'`, `'stopped'`, `'error'`, `'building'` (richer than `'running' | 'partial' | 'error' | 'stopped'`)
- Backend `Service.status` is `'running' | 'stopped' | 'error'` — map to `ServiceHealth` as `error → 'crashed', running/stopped → 'healthy'`
- Backend has no `dependsOn[]` per project — InfraMap edges stay mocked
- Backend Project = 1 container + N connected DB services. Prototype assumed compose-style multi-app project.

For PR4-D:

- Home: real project count, real project list with status. Service count from environments+connected services.
- ProjectViewV2: real project header. Services list = connected DB services (real). Edges still mocked.
- Sidebar: real "Projects" badge count from `listProjects()`.
- Activity / MCP / deployments / log: stay mocked.

## Files to add / modify / delete

### Add

- `web/src/components/Shell/InfraMap.tsx` — REWRITE with React Flow + dagre.
- `web/src/components/Shell/InfraMap.css` — TRIM (most styles handled by Tailwind / RF defaults).
- `web/src/components/Shell/InfraMapNode.tsx` — Custom RF node component with health colors + agent Bot badge.
- `web/src/components/Shell/LogViewerHeader.tsx` — extracted HeaderPill / FsmBadge / HeaderActionButton.
- `web/src/lib/logAnsi.ts` — extracted parseAnsi + LogPayload.
- `web/src/hooks/use-projects.ts` — `useProjects()` hook returning `{projects, isLoading, error}`.
- `web/src/hooks/use-project.ts` — `useProject(id)` for ProjectViewV2.
- `web/src/lib/projectMappers.ts` — backend → prototype shape mappers.
- `web/src/i18n/PATCH-PR4.md`.

### Modify

- `web/src/components/Shell/LogViewer.tsx` — split out chrome and ANSI; drop fixed-height; add BACKFILLING to Kill gate.
- `web/src/components/Shell/AppShell.tsx` — mount `<CommandPalette />` + `<ApprovalDialog />` + AgentPanelContext + useSystemStats / useNotifications. Mirror AppLayout's responsibilities so 9 legacy routes mount cleanly under it.
- `web/src/App.tsx` — collapse the two-shell setup into AppShell only. Drop `/projects-v1`, `/services-v1`, `/projects-v2` redirect aliases.
- `web/src/lib/logScripts.ts` — replace `slice(0, 6)` with phase filter.
- `web/src/pages/Home.tsx` / `Activity.tsx` / `ProjectViewV2.tsx` — switch to hooks.
- `web/src/components/Shell/Sidebar.tsx` — Project badge from real count.

### Delete

- `web/src/components/layout/AppLayout.tsx`
- `web/src/components/layout/Sidebar.tsx` (legacy)
- `web/src/components/layout/Header.tsx` (legacy — Shell V2 TopBar replaces)
- `web/src/pages/ProjectDetail.tsx` (V2 took over `/projects/:id`)
- `web/src/pages/ServiceDetail.tsx` (V2 took over `/services/:id`)

## Risks

- **R1 — AppLayout has more than I can re-mount**: Beyond CommandPalette + ApprovalDialog + AgentPanel, AppLayout uses Header, useSystemStats, useNotifications, mobile sheet sidebar (Sheet from Radix), AgentPanelContext provider, agent panel keystroke (Alt+J). Mitigation: copy them ALL into AppShell. AppShell becomes ~AppLayout's size. Keep clean diff.
- **R2 — Tests reference deleted files**: `web/src/components/layout/__tests__/Header.test.tsx` exists. Delete + update to point at TopBar OR mark as PR5.
- **R3 — React Flow CSS conflicts**: Prototype uses lots of `var(--ol-*)` tokens. RF nodes accept `style` and `className` so we wrap node content in our own div with our tokens. RF's own CSS shouldn't conflict.
- **R4 — Backend wire-up shape mismatch**: real Project shape doesn't have `initials`, `color`, `description`, `lastDeploy` mock fields. Mappers need to compute or default these. Document gracefully-degraded fields.
- **R5 — Existing OLD routes break under AppShell**: Pages like ProjectsGrid, OpsCenterV2 expect AppLayout's `bg-bg-app` / agent panel etc. They'll render under V2 chrome but probably look weird. Acceptable in PR4 (visual mismatch within one shell vs two shells is similar). PR5 is for visual reconciliation.

## Success criteria

1. `npx tsc --noEmit` clean (no new errors).
2. `npm run lint` 0 errors on PR4 added/modified files.
3. `npm run build` green.
4. Visit `/home`, `/projects/hotdeal-tracker`, `/services/api?project=hotdeal-tracker`, `/overview`, `/operations`, `/settings`, `/login` — none crash.
5. InfraMap renders cleanly (no crooked edges) on hotdeal-tracker.
6. CommandPalette opens with ⌘K under V2 shell.
7. Code-reviewer approves combined PR4 diff.
