# PR2 + PR3 — Round 4 design port (continued from PR1)

## Summary

Two chunked PRs delivered in one autopilot run:

- **PR2**: Live Infrastructure Map evolved (`InfraMap` with M1–M6) + new `ProjectViewV2` page with Services / Activity tabs.
- **PR3**: Service Detail rewrite (`ServiceDetailV2` with 7-tab WAI-ARIA tablist) + LogViewer (FSM split + `@tanstack/react-virtual` + terminal cards as siblings) + Settings split into 4 sub-pages + AppShell soft-takeover of `/projects/:id` and `/services/:id`.

PR1's Foundation (tokens, brand, mock activity, Sidebar/TopBar/OuterCard/AppShell, Home/Activity/MCPServer pages) is the platform; PR2 + PR3 build all the substantive UI on top.

## What changed

### Files added (22 new files · ~4,391 LOC)

**Topology + Project view (PR2)**

- `web/src/lib/projectTopology.ts` — `ServiceNode` + `ProjectSummary` + mock topologies + `recentAgentFor()` lookup.
- `web/src/components/Shell/InfraMap.tsx` — M1–M6 with `empty / lonely / standard / dense` layouts, SVG bezier edges from `dependsOn`, `Bot` badge for recent mcp activity, hover popover with health/image/cpu/mem.
- `web/src/components/Shell/InfraMap.css` — SVG path styles + crashed-node pulse + popover positioning.
- `web/src/components/Shell/ProjectTabs.tsx` — Reusable tablist primitive with arrow-key WAI-ARIA navigation. Used by both ProjectViewV2 and ServiceDetailV2.
- `web/src/pages/ProjectViewV2.tsx` — InfraMap above OuterCard + Services / Activity tabs. Honors `?tab=` deep-links.

**LogViewer + terminal cards (PR3)**

- `web/src/lib/errorClasses.ts` — 10 v1.0 error classes per GUIDE-05 §§2.1–2.10. Names match canonical taxonomy exactly. v1.1+ classes (OOM_KILLED, DOCKER_DAEMON_UNREACHABLE, etc.) intentionally excluded.
- `web/src/lib/logScripts.ts` — Mock build scripts (success + fail variants) + `buildLargeScript(n)` for 5k–20k line virtualizer demos.
- `web/src/components/Shell/PhaseRail.tsx` — Top progression bar (Clone → Pull → Build → Create → Start → Health) with status pills.
- `web/src/components/Shell/LogViewer.tsx` — Two-axis FSM (`connState × viewState`) per GUIDE-04 §2 + `@tanstack/react-virtual` (NOT homegrown) + ANSI parser supporting both real ESC and bracketed forms + 10k line cap with bulk-download notice + jump-to-latest pill on PAUSED.
- `web/src/components/Shell/LogViewer.css` — Log line + phase header + ANSI color classes + reconnect notice + jump pill positioning.
- `web/src/components/Shell/FailureSummary.tsx` — Registry-driven primitive. Reads error class def + renders fix-hint with backtick-tokens as `<code>` + 4 actions (Copy summary / Copy as Claude prompt / View compose / Re-deploy).
- `web/src/components/Shell/SuccessSummary.tsx` — Public + internal URL display.
- `web/src/components/Shell/CancelledSummary.tsx` — "Build cancelled" terminal card.
- All three terminal cards render as siblings of the LogViewer scroll area (NOT inside the virtualizer) so they're always visible regardless of scroll position.

**Service detail (PR3)**

- `web/src/lib/projectDeployments.ts` — Mock deployment history.
- `web/src/lib/deterministicSeries.ts` — Stable pseudo-random series generator for sparkline charts.
- `web/src/components/Shell/Sparkline.tsx` — Tiny SVG line chart.
- `web/src/pages/ServiceDetailV2.tsx` — 7 tabs: General / Environment / Domains / Deployments / Logs / Monitoring / Advanced. Logs tab mounts `<LogViewer variant="runtime" />`. Deployments tab opens deploys in an in-page slide-over with `<LogViewer variant="deploy" />`. Monitoring tab is a 2×2 sparkline grid with range toggle (15m/1h/6h/24h/7d) + container selector.

**Settings split (PR3)**

- `web/src/pages/settings/WebServer.tsx`
- `web/src/pages/settings/GitProviders.tsx`
- `web/src/pages/settings/SSHKeys.tsx`
- `web/src/pages/settings/Notifications.tsx` — Generic webhook URL + 5 event toggles. Discord/Slack/Email presets explicitly deferred to v1.1.

**Mobile (PR3)**

- `web/src/hooks/use-viewport.ts` — `useMediaQuery` + `useIsBelowMd` hooks. SSR-safe (initial state read in useState initializer with `typeof window` guard).

**i18n**

- `web/src/i18n/PATCH-PR2-PR3.md` — Proposed keys for the new pages (manual merge — never directly edit `en.ts/ko.ts`).

### Files modified

- `web/src/App.tsx` (+52 / −9) — `/projects/:id` and `/services/:id` moved under `<AppShell />` to render V2 pages. Settings sub-routes added under AppShell (`/settings/web-server`, `/settings/git-providers`, `/settings/ssh-keys`, `/settings/notifications`). Legacy redirects added (`/projects-v1/:id`, `/services-v1/:id`, plus `/projects-v2/:id` alias kept for compatibility one PR cycle). Default redirect changed from `/overview` → `/home`.
- `web/src/components/Shell/Sidebar.tsx` (+12 / −12) — Settings group entries link directly to `/settings/web-server`, `/settings/git-providers`, `/settings/ssh-keys`, `/settings/notifications` (was `/settings?tab=…`).
- `web/src/components/Shell/AppShell.tsx` (+8 / −2) — Auto-collapsed-below-md sidebar via `useIsBelowMd`.
- `web/src/pages/ProjectViewV2.tsx` (+24 / −10) — `?tab=` deep-link support + single `openService()` helper for consistent project-context attachment.
- `web/src/pages/ServiceDetailV2.tsx` (+16 / −4) — Strict project-id validation (no silent fallback to `'hotdeal-tracker'`); user-friendly "service not found" message when `?project=` is missing.
- `web/src/components/command/CommandPalette.tsx` (+5 / −2) — `Logs: {project}` palette item now routes to `/projects/${id}?tab=activity` (V2 has no `?tab=console`); label updated to `Activity: {project}`.

### Files NOT touched (still PR4 work)

- **Backend** (`src/`) — parallel session.
- **i18n** (`web/src/i18n/{en,ko}.ts`) — patch file only.
- `web/src/components/layout/AppLayout.tsx` — still owns `/overview`, `/projects` (list), `/projects/new`, `/services`, `/operations`, `/settings`, `/agent`, `/projects/:id/deployments/:deployId`, `/deployments`. CommandPalette/AgentPanel/ApprovalDialog still mount under it.
- Existing `ProjectDetail.tsx` and `ServiceDetail.tsx` — unused now (V2 routes took over `/projects/:id` and `/services/:id`) but **NOT deleted** so PR4 can confirm no other code still imports them before cleanup.

## Scope discipline (1.0 trim continued)

Per Gemini's "냉혹한 다이어트" + the user's "심플하지 않다" feedback:

- ✅ **Kept**: Activity timeline as the central observation surface. Inline one-line agent reasoning (the `detail` field). MCP Bot icon on `mcp`-actor events only.
- ❌ **Deferred to v1.1+**: PendingDecisionsCard with auto-expire timer. IncidentsCard with crash-loop classification. Auto-restart-with-reasoning fabricated events. `[See agent reasoning]` paragraph expansion. v1.1 error classes (OOM_KILLED, DOCKER_DAEMON_UNREACHABLE, DISK_EXHAUSTED, NETWORK_DEPENDENCY_UNREACHABLE, HEALTHCHECK_TIMEOUT, BUILD_TIMEOUT). Service health states beyond `healthy / crashed`.

## Verification

- ✅ TypeScript: `npx tsc --noEmit` clean (no new errors; only the pre-existing `@xyflow/react` types issue from earlier rounds is filtered out).
- ✅ ESLint: 0 errors / 0 warnings on all PR2+PR3 added or modified files.
- ✅ Production build: `npm run build` ✓ in 3.06s.
- ✅ Code review (independent agent context): **Initial verdict REQUEST CHANGES (2 HIGH)**, all 2 HIGH issues fixed in this PR before final commit.

### HIGH issues raised + fixed in this PR

1. **`parseAnsi` regex was a no-op** — the early-out tested the same character twice and the regex `(?:)?\[…m` made the leading ESC alternation a zero-width optional group. Fixed via byte-precise replacement: regex now `/?\[([0-9;]*)m/g` with eslint-disable for the ANSI control char, and the early-out checks ESC and `[` separately.
2. **`/projects/:id?tab=console` deep-link broken** — `CommandPalette.tsx` had a stale `?tab=console` deep-link from before PR2-D. ProjectViewV2 doesn't honor `?tab=console`. Fixed: palette item is now `Activity: {project}` and routes to `?tab=activity`. ProjectViewV2 also now reads `?tab=` and routes to the matching tab on first paint.

### MEDIUM issues raised + fixed

3. **`?project=` query inconsistency** — ProjectViewV2's Services panel and Activity panel were navigating without attaching `?project=`, falling back to a hard-coded `'hotdeal-tracker'` default in ServiceDetailV2. Fixed: introduced single `openService(serviceId)` helper in ProjectViewV2; all three callers (InfraMap, ServicesPanel, ActivityTimeline rows) use it.
4. **ServiceDetailV2 silent project fallback** — would render the wrong project's services when `?project=` was missing. Fixed: render explicit "service not found" with friendly message explaining the missing query parameter.

### MEDIUM issues tracked for PR4

- LogViewer.tsx is 784 lines; can split into `LogViewer.tsx` + `LogViewerHeader.tsx` + `lib/logAnsi.ts`.
- LogLine has `style={{ height: ROW_LINE_HEIGHT }}` hard-coded; long lines visually clip. Either remove the fixed height (let virtualizer measure) or commit to ellipsis.
- Kill button hides during the brief BACKFILLING window; arguably should stay visible.
- `LOG_SCRIPT_FAIL` uses a magic-number `slice(0, 6)` for the CLONE phase fixture; should be a phase-filter or extracted constant.

### LOW issues + nits

Documented in `.omc/autopilot/PR2-PR3-review.md`. None blocking.

## Backend wire-up TODO (deferred to PR4+)

- `/api/projects/:id/topology` — graph: services + dependsOn[].
- `/api/services/:id/health` — `'healthy' | 'crashed'` (1.0 vocabulary).
- `/api/deployments/:id/log/stream` — SSE/WebSocket producing the LogEntry shape.
- `/api/services/:id/metrics?range=1h` — series for monitoring tab.
- `/api/settings/notifications/webhook` — POST URL + event-set save.
- i18n keys per `web/src/i18n/PATCH-PR2-PR3.md` merged into `en.ts/ko.ts`.

## Soft AppShell takeover

Full AppLayout deletion is **PR4** because:

- AppLayout owns CommandPalette, AgentPanel, ApprovalDialog, mobile sheet, system stats hook, notifications. Migrating those into AppShell is a separate diff.
- 9 routes still depend on AppLayout: `/overview`, `/projects` (list), `/projects/new`, `/services` (list), `/operations`, `/settings` (legacy), `/agent`, `/deployments`, `/projects/:id/deployments/:deployId`. They keep their existing chrome.

PR4 plan:

1. Move `<CommandPalette />` and `<ApprovalDialog />` mounts into AppShell (carry `<Toaster />` is already at App root, no move needed).
2. Add a soft `<AgentPanel slot />` to AppShell (PR5 wires keystrokes etc.).
3. Migrate the 9 remaining routes from AppLayout → AppShell.
4. Delete `web/src/components/layout/AppLayout.tsx` + `Sidebar.tsx` (legacy) + `Header.tsx`.
5. Drop `/projects-v1/:id`, `/services-v1/:id`, `/projects-v2/:id` redirect aliases.

## Manual steps for the user

- [ ] Inspect the diff: `git status --short web/` and `git diff web/`.
- [ ] Boot dev server: `cd web && npm run dev`. Visit:
  - `/home` — Unified Activity Stream (PR1)
  - `/activity` — Full timeline with filters (PR1)
  - `/mcp` — MCP Server status (PR1)
  - `/projects/hotdeal-tracker` — V2 Project view with InfraMap topology strip
  - `/projects/hotdeal-tracker?tab=activity` — Project Activity tab via deep-link
  - `/services/api?project=hotdeal-tracker` — V2 Service detail with 7 tabs
  - Click any service tab Logs → runtime LogViewer
  - Click Deployments tab → click View on a row → deploy LogViewer overlay
  - `/settings/web-server`, `/settings/git-providers`, `/settings/ssh-keys`, `/settings/notifications` — 4 split pages
- [ ] Manually merge `web/src/i18n/PATCH-PR1.md` and `PATCH-PR2-PR3.md` into `en.ts` / `ko.ts`.
- [ ] Bring back the parallel session's `tools/qa/soak-test.sh` change with `git stash pop` (it was stashed at the original branch switch).
- [ ] Commit on `ui-redesign-1.0` with a message of your choosing — autopilot did NOT push or open a PR.
