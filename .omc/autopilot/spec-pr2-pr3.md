# Autopilot Spec — Round 4 PR2 + PR3

> Phase 0 expansion (lightweight — brief is concrete with file paths and source-of-truth references).
> Build on PR1 foundation already authored at `web/src/components/Shell/`, `web/src/lib/{brand,agentActivity}.ts`, `web/src/styles/tokens.css`, and pages `Home/Activity/MCPServer`.

## Goal

Land PR2 (Project view + InfraMap) and PR3 (Service Detail rewrite + LogViewer + Settings split + AppShell takeover) on the `ui-redesign-1.0` branch. PR1 already provides Shell V2 (Sidebar/TopBar/OuterCard/AppShell) + design tokens + brand constant + mock activity stream. PR2/3 build on top.

## Source materials

- Prototype: `/Users/idongbin/project/OpenLander/.omc/analysis/openlander-design-v4/test/project/src/{infra_map,service,log_viewer,errors,projects,modals,print}.jsx`
- Spec docs: `docs/design/v1.0/GUIDE-04-log-streaming.md` (FSM + virtualization), `GUIDE-05-error-taxonomy.md` (10 v1.0 error classes)
- Round 3 strategy notes: `<bundle>/project/notes/round3-strategy.md` (M1-M6 InfraMap evolution)
- Backend session: NO `/api/activity`, `/api/mcp/status`, `/api/system/health` endpoints exist yet (only `src/monitor/activity-event-mapper.ts` mapper). All data continues as mocks; PR3 wire-up TODO documented for next backend pass.

## Target codebase

Same as PR1 — React 19 + Vite + Tailwind 3.4 + Radix UI + lucide-react + `@tanstack/react-virtual` + xterm. PR2 uses `@radix-ui/react-tooltip` for InfraMap node popovers; already a project dep.

## PR2 — Project view + InfraMap (≈1500 LOC)

### Files to add

| Path                                       | Purpose                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `web/src/lib/projectTopology.ts`           | Service node types + project topology mock + `recentAgentFor()` lookup.                           |
| `web/src/components/Shell/InfraMap.tsx`    | M1-M6 implementations: empty / lonely / standard (≤8) / dense (>8) layouts.                       |
| `web/src/components/Shell/InfraMap.css`    | SVG edge styles + node animation that doesn't fit utility classes.                                |
| `web/src/components/Shell/ProjectTabs.tsx` | Tabs primitive shared with ServiceDetailV2 (Services / Activity for project; 7 tabs for service). |
| `web/src/pages/ProjectViewV2.tsx`          | New project page mounting InfraMap above OuterCard + ProjectTabs.                                 |

### Files to modify

- `web/src/components/Shell/Sidebar.tsx` — Workspace/Projects link → `/projects` (V2 routes once PR3 takeover lands; PR2 adds the V2 surface at `/projects-v2/:id`).
- `web/src/App.tsx` — register `/projects-v2/:id` under AppShell.

### M1 — Health states (1.0 trim)

Drop `degraded / restarting / starting / stopped` from the prototype. v1.0 health = `healthy | crashed`. Color via `--ol-success` / `--ol-error`. PR3 may add `running` synonym for service status; map both to `healthy` for InfraMap.

### M2 — Agent activity overlay

Lookup last `mcp`-actor event per service within 30 minutes. Render `<Bot />` badge anchored top-right of node disk. Tooltip surfaces title + relative time.

### M3 — Real edges from `dependsOn`

SVG bezier `path` from each service to each declared dependency. Edge severity: `alert` if dep is crashed. Compute paths after layout via `useLayoutEffect` + `ResizeObserver`.

### M4 — Dense layout (>8 services)

3-lane grouping: `entry` (caddy/nginx/edge), `app` (web/api/worker/admin/...), `data` (databases). Lane labels visible.

### M5 — Empty + lonely

`InfraMapEmpty` (no services). `InfraMapLonely` (1 service, no edges, hint to declare `dependsOn`).

### M6 — Click + hover

Click → navigate to `/services-v2/:id` (PR3) or `/services/:id` (fallback during PR2). Hover → Radix Tooltip with health/image/cpu/mem.

## PR3 — Service Detail + LogViewer + Settings + AppShell takeover (≈3000 LOC)

### Files to add

| Path                                            | Purpose                                                       |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `web/src/lib/errorClasses.ts`                   | 10 v1.0 error classes per GUIDE-05 §2 (canonical names).      |
| `web/src/components/Shell/FailureSummary.tsx`   | Registry-driven failure card.                                 |
| `web/src/components/Shell/SuccessSummary.tsx`   | Public + internal URL display.                                |
| `web/src/components/Shell/CancelledSummary.tsx` | "Build cancelled" terminal card.                              |
| `web/src/components/Shell/LogViewer.tsx`        | FSM + `@tanstack/react-virtual` + ANSI parser + 10k line cap. |
| `web/src/components/Shell/LogViewer.css`        | Log line + phase rail styles.                                 |
| `web/src/components/Shell/PhaseRail.tsx`        | Top bar of phase progression.                                 |
| `web/src/components/Shell/Sparkline.tsx`        | Tiny SVG sparkline for monitoring tab.                        |
| `web/src/lib/logScripts.ts`                     | Mock build/runtime log scripts (success + fail variants).     |
| `web/src/lib/projectDeployments.ts`             | Mock deployments grouped by project/service.                  |
| `web/src/pages/ServiceDetailV2.tsx`             | 7-tab detail with arrow-key tablist.                          |
| `web/src/pages/settings/WebServer.tsx`          | Reverse proxy / Traefik settings stub.                        |
| `web/src/pages/settings/GitProviders.tsx`       | GitHub provider stub.                                         |
| `web/src/pages/settings/SSHKeys.tsx`            | SSH key list stub.                                            |
| `web/src/pages/settings/Notifications.tsx`      | Generic outbound webhook config — single URL + event toggles. |

### Files to modify

- `web/src/components/Shell/Sidebar.tsx` — Settings group entries link directly to `/settings/web-server`, `/settings/git-providers`, etc. Drop `?tab=…` query patterns.
- `web/src/App.tsx` — All routes nest under `<AppShell />`. Drop `/projects-v2` alias (now `/projects/:id` IS V2). Add legacy redirects for one PR cycle: `/projects-v1/:id → /projects/:id`.
- `web/src/components/Shell/AppShell.tsx` — Carry CommandPalette (move import) + Toaster (already in App.tsx) + AgentPanel skeleton (PR3 keeps it disabled or simple).
- `web/src/lib/agentActivity.ts` — Try real backend hook if `/api/activity` exists; otherwise leave mock + TODO.

### Mobile responsive

- Below `md` (768px): Sidebar collapses to icon-only.
- Below `md`: InfraMap forces dense layout regardless of count (improves cramped readability).
- LogViewer header: actions wrap below pill on narrow.
- Service tabs: `overflow-x-auto` + `scroll-smooth` so 7 tabs scroll horizontally.

### LogViewer FSM (per GUIDE-04 §2)

```
connState: IDLE → CONNECTING → LIVE
LIVE ⇄ RECONNECTING → BACKFILLING → LIVE
LIVE → ENDED (clean close, success or fail)
LIVE → CANCELLED (user kill)
any → ERRORED (transport failure)

viewState: FOLLOWING | PAUSED
```

Build outcome (success/fail) is a separate concept derived from the final log lines, not from `connState`.

## Out of scope (explicit defer)

- `OOM_KILLED`, `DOCKER_DAEMON_UNREACHABLE`, `DISK_EXHAUSTED`, `NETWORK_DEPENDENCY_UNREACHABLE`, `HEALTHCHECK_TIMEOUT`, `BUILD_TIMEOUT` — v1.1+ error classes.
- Pending decisions / agent reasoning paragraphs / incident classification — v1.1+.
- Cursor-based log replay; v1.0 uses degraded-mode reconnect.
- Custom domains UI mutation; v1.0 displays sslip.io URL only.

## Risks

- **R1 — Removing AppLayout in PR3 (Phase F)**: AppLayout integrates `CommandPalette`, `AgentPanel`, `ApprovalDialog`, `Header`, mobile sheet, system stats hook. AppShell currently has none of these. The takeover must port the essential parts (CommandPalette, mobile sheet, AgentPanel slot) before pulling AppLayout. Mitigation: Keep the takeover narrow — copy the 3 mounts into AppShell, leave AgentPanel slot empty (PR4 wire-up).
- **R2 — Existing `/projects/:id` route is the live page MCP tools deep-link to**: Switching to V2 risks breaking those links. Mitigation: Add `/projects-v1/:id` as a redirect alias that routes through V2 with same params. Keep alias for one PR cycle then delete.
- **R3 — `@xyflow/react` (DependencyGraph) lives under `OpsCenterV2`**: AppShell takeover must verify OpsCenterV2 still renders. Mitigation: confirm `npm install` covers, browser-test `/operations` after takeover.
- **R4 — Backend session may ship endpoints during this autopilot run**: We won't know until we check. Mitigation: Phase F includes a `grep` check for new fastify routes; document what's stubbed vs wired.

## Success criteria

1. `npm run typecheck` clean (existing pre-existing errors aside).
2. `npm run lint` clean on new + modified files.
3. `npm run build` green.
4. `npm run dev` boots; visiting `/home`, `/activity`, `/mcp`, `/projects-v2/:id` (PR2) and `/services/:id`, `/projects/:id`, `/settings/...` (PR3 post-takeover) renders correctly.
5. All 4 sub-pages of Settings reachable from sidebar.
6. Old route `/projects/:id` redirected to V2 after takeover (single redirect for compat).
7. Code-reviewer agent (separate context) approves combined PR2+PR3 diff.
8. PR description + review docs written; user manually commits and opens PR.
