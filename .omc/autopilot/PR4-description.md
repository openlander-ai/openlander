# PR4 — InfraMap React Flow + AppLayout takeover + LogViewer cleanup + best-effort wire-up

## Summary

Four parallel mini-PRs delivered in one autopilot run, building on PR1+PR2+PR3 (all uncommitted on `ui-redesign-1.0`):

- **A. InfraMap React Flow rewrite** — fixes the crooked-edge issue. Custom SVG-bezier impl replaced with `@xyflow/react` + `@dagrejs/dagre`.
- **B. AppLayout takeover** — drops the parallel-shell setup. Single `<AppShell />` for all 13 authenticated routes.
- **C. LogViewer cleanup** — split 787-line file into 3, drop fixed-height clipping, BACKFILLING in Kill gate, phase-filter for fixture.
- **D. Best-effort backend wire-up** — Sidebar Projects badge + Home status bar now show real project counts via existing `useProjects()` hook with mock fallback.

## Files added (5)

| Path                                           | Purpose                                                        |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `web/src/components/Shell/InfraMapNode.tsx`    | Custom React Flow node — health colors, agent Bot badge, glyph |
| `web/src/components/Shell/LogViewerHeader.tsx` | Extracted HeaderPill / FsmBadge / HeaderActionButton / Dot     |
| `web/src/lib/logAnsi.tsx`                      | Extracted parseAnsi + LogPayload renderer                      |
| `web/src/lib/projectMappers.ts`                | Backend `Project` → V2 `ProjectSummary` shape mapper           |
| `web/src/i18n/PATCH-PR4.md`                    | Proposed i18n keys (manual merge)                              |

## Files modified (8)

- `web/src/components/Shell/InfraMap.tsx` — REWRITTEN with React Flow + dagre auto-layout. Empty/lonely/standard/dense decision tree preserved.
- `web/src/components/Shell/InfraMap.css` — slimmed to ~85 lines (was 215). Only SVG-specific + crashed-pulse + edge-flow animations.
- `web/src/components/Shell/LogViewer.tsx` — 787 → ~590 lines after split. `minHeight: ROW_LINE_HEIGHT` not `height` (no clipping). BACKFILLING in Kill button gate.
- `web/src/components/Shell/AppShell.tsx` — full takeover: CommandPalette + ApprovalDialog + AgentPanel + AgentPanelContext + Alt+J + mobile sheet.
- `web/src/components/Shell/Sidebar.tsx` — `useProjects()` for real Projects badge count.
- `web/src/pages/Home.tsx` — `useProjects()` for real total project count + crashed-project rollup.
- `web/src/lib/logScripts.ts` — `LOG_SCRIPT_FAIL` clone fixture via phase filter (replaces brittle `slice(0, 6)` magic-number).
- `web/src/App.tsx` — single AppShell, all 13 routes nested under it. Legacy redirects (`/projects-v1/:id`, `/services-v1/:id`, `/projects-v2/:id`) dropped. Default redirect changed to `/home`.

## Files deleted (6)

- `web/src/components/layout/AppLayout.tsx`
- `web/src/components/layout/Sidebar.tsx` (legacy)
- `web/src/components/layout/Header.tsx`
- `web/src/components/layout/__tests__/Header.test.tsx`
- `web/src/pages/ProjectDetail.tsx` (V2 took over `/projects/:id` in PR3)
- `web/src/pages/ServiceDetail.tsx` (V2 took over `/services/:id` in PR3)

## Files NOT touched (still PR5+ work)

- **Backend** (`src/`) — parallel session.
- **i18n** (`web/src/i18n/{en,ko}.ts`) — patch file only.
- **6 orphan files** in `web/src/components/layout/` — `ActivityPulse.tsx`, `NotificationCenter.tsx`, `ThemeSelector.tsx`, `ProjectCard.tsx` (layout/), `DeployDialog.tsx`, `ShareDialog.tsx`. They had Header as their only consumer and are now dead code. PR5 cleanup ticket.

## Verification

- ✅ TypeScript: `npx tsc --noEmit` clean (no new errors; pre-existing `@xyflow/react` types issue filtered).
- ✅ ESLint: 0 errors / 0 warnings on PR4 added/modified files.
- ✅ Production build: `npm run build` ✓ in 3.28s.
- ✅ Code review (independent agent context): **APPROVE — commit-ready for v1.0**. 0 CRITICAL, 0 HIGH, 5 MEDIUM (all forward-looking, not blockers), 4 LOW/NIT.

### LOW-1 fixed in this PR (post-review)

`projectMappers.lastDeployFor` returned `"-3m ago"` for clock-skewed/future timestamps. Now guards `diffMs <= 0` → `"Just now"`.

### MEDIUM tracked for PR5

1. **InfraMap layout effect re-fires on every `agentActivity` change** — split into "layout" effect (services/dense deps) + "badge update" effect using `setNodes((prev) => …)`. Acceptable today (mock-static activity); urgent once real activity stream lands.
2. **Animations don't honor `prefers-reduced-motion`** — `ol-node-pulse` + `ol-edge-flow` keyframes run forever. Add a `@media (prefers-reduced-motion: reduce)` block.
3. **NodePopover may clip when node is near top edge** — flip below when `y < popoverHeight`. Visual-QA before launch.
4. **Triple-`useProjects()` polling** — Sidebar + Home + CommandPalette each run their own polling timer (3-10s). Hoist to a context Provider mounted once in AppShell, or use SWR for request dedup.
5. **LogViewer.tsx still ~590 lines** — extractable: `phaseStatus`/`rows` derivations into `lib/logRows.ts`; terminal-card rendering into `<LogViewerSummaryCards />`. Brings the main file to ~440.

## Backend wire-up status

### Wired (real data)

- Sidebar Projects badge count (`useProjects()`)
- Home status bar `totalProjects` count + crashed-project rollup

### Still mocked (no backend endpoint)

- `MOCK_ACTIVITY` — Activity timeline events. Backend has `/api/projects/:id/timeline` but per-project, not global feed.
- `MOCK_MCP_INFO` — MCP Server page content. No `/api/mcp/status` endpoint.
- `MOCK_DEPLOYMENTS` — used by ServiceDetailV2 deployments tab. Backend `getProjectDeployments()` exists but shape differs (`DeployLogSummary` vs prototype `DeploymentRecord`). PR5 mapper.
- `MOCK_SERVICES_BY_PROJECT` — used by InfraMap topology. Backend has `getProjectConnectedServices()` but no `dependsOn[]` graph today. The 5 NEW endpoints listed in PR2-PR3 description still apply.

## Manual steps for the user

- [ ] Inspect the diff: `git status --short web/` and `git diff web/`.
- [ ] Boot dev server: `cd web && npm run dev`. Visit `/home`, `/activity`, `/mcp`, `/projects/{any}`, `/services/{any}?project={id}`. CommandPalette via ⌘K. AgentPanel via Alt+J.
- [ ] Confirm InfraMap renders cleanly (no crooked edges) on hotdeal-tracker.
- [ ] Confirm legacy routes (/overview, /projects, /deployments, /operations, /settings) still work under V2 chrome.
- [ ] Manually merge `web/src/i18n/PATCH-PR1.md`, `PATCH-PR2-PR3.md`, `PATCH-PR4.md` into `en.ts` / `ko.ts` (or defer to a PR5 i18n wire-up pass).
- [ ] Bring back the parallel session's `tools/qa/soak-test.sh` change with `git stash pop` (stashed at PR1 branch switch).
- [ ] Commit on `ui-redesign-1.0` with a message of your choosing — autopilot did NOT push or open a PR.

## Suggested PR5 scope

1. Delete 6 orphan files in `web/src/components/layout/`.
2. Apply the 5 MEDIUM follow-ups above.
3. Wire-up backend endpoints (in coordination with backend session): the 5 NEW endpoints (`/api/projects/:id/topology`, `/api/services/:id/health`, `/api/deployments/:id/log/stream`, `/api/services/:id/metrics`, `/api/settings/notifications/webhook`).
4. i18n string substitution pass: wire `useLanguage().t()` through Sidebar/TopBar/InfraMap/LogViewer/Settings sub-pages.
5. Visual QA + reconciliation pass on the 9 legacy routes that now mount under V2 chrome (ProjectsGrid, ServicesPage, OpsCenterV2, etc.) — they may need padding/background tweaks.
