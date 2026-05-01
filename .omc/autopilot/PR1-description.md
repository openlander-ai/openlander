# PR1 — Foundation + Unified Home (Round 4 design port)

## Summary

First of three chunked PRs porting the Round 4 Claude Design handoff into the real React/Vite codebase. PR1 lands the **Shell V2 foundation** (design tokens, brand constant, mock activity stream, new sidebar/topbar/outer-card primitives) and **three new pages** that establish OpenLander's agent-first identity: `/home` (Unified Activity Stream), `/activity` (full timeline), `/mcp` (MCP Server status).

The new shell coexists with the existing `AppLayout` — old routes (`/projects`, `/services`, `/settings`, `/operations`, etc.) keep their current look and behavior. Only the three new routes mount under `AppShell`. Visual mismatch when navigating between old and new is acceptable per the chunked-port plan.

## Why this design

After three rounds of Claude Design iteration plus a CCG (Codex + Gemini) cross-review, two things happened:

1. **Positioning reframe**: OpenLander is positioned as an _agent-native PaaS_ — humans observe and intervene, agents create and operate. This shifts the dominant verbs in the UI from **creation** to **observation**.

2. **Scope discipline ("심플하지 않다")**: Round 3 was visually busy (4 cards on Home: SystemStatusHero + PendingDecisions + Incidents + RecentActivity). Gemini's "냉혹한 다이어트" verdict and the user's own gut check converged on a radical simplification: drop the 4-card layout, replace with a single **Unified Activity Stream** — a thin system status bar + one big Linear-style timeline.

This PR implements that radical Home, plus the supporting Activity and MCP Server pages.

## Files added

| Path                                            | Purpose                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `web/src/styles/tokens.css`                     | OKLCH design tokens (light + dark), prefixed `--ol-*` to coexist with existing `--bg-app` etc.              |
| `web/src/lib/brand.ts`                          | `BRAND` constant — single source of truth for the product name (rename-ready).                              |
| `web/src/lib/agentActivity.ts`                  | TypeScript types + mock event stream (1.0-honest scope: deploys, config changes, crashes, MCP connections). |
| `web/src/components/Shell/OuterCard.tsx`        | Outer-card frame primitive used on every V2 page.                                                           |
| `web/src/components/Shell/Sidebar.tsx`          | New sidebar with 3 sections (Workspace 6, Infrastructure 2, Integrations 3) + account card.                 |
| `web/src/components/Shell/TopBar.tsx`           | Breadcrumb + Agent Command Center chip (right edge).                                                        |
| `web/src/components/Shell/AppShell.tsx`         | New layout wrapper for V2 routes. Coexists with `AppLayout`.                                                |
| `web/src/components/Shell/ActivityTimeline.tsx` | Shared row primitive + filter pills + time-bucket headers.                                                  |
| `web/src/pages/Home.tsx`                        | Unified Activity Stream — status bar + single timeline.                                                     |
| `web/src/pages/Activity.tsx`                    | Full timeline page with Actor/Project filters + bucketing.                                                  |
| `web/src/pages/MCPServer.tsx`                   | 4 status tiles + connected agents list + recent agent calls.                                                |
| `web/src/i18n/PATCH-PR1.md`                     | Proposed i18n keys (manual merge — do NOT directly edit `en.ts`/`ko.ts`).                                   |

## Files modified

- `web/src/index.css` — `@import './styles/tokens.css';` added near the top.
- `web/src/App.tsx` — three new routes (`/home`, `/activity`, `/mcp`) wired under `AppShell`. Existing routes untouched.

## Files NOT touched (PR1 boundary)

- **Backend** (`src/`) — parallel session is hardening it.
- **i18n** (`web/src/i18n/{en,ko}.ts`) — patch file only; user merges by hand.
- **All existing pages** — `ProjectDetail`, `ServiceDetail`, `NewProjectFlow`, `DeploymentsList`, `OpsCenterV2`, `SettingsPage`, `Overview`, `ProjectsGrid`, `ServicesPage`, `LoginPage` — unchanged.
- **Existing layout** (`web/src/components/layout/*`) — unchanged.

## Trim — what's deferred to v1.1+

Per Gemini's "냉혹한 다이어트" + user's scope discipline, these prototype features are NOT ported into 1.0:

- ❌ `PendingDecisionsCard` with auto-expire timer (no backend; UX fatigue)
- ❌ `IncidentsCard` with crash-loop classification (false positives kill trust)
- ❌ Auto-restart-with-reasoning fabricated events (manual control safer in 1.0)
- ❌ `[See agent reasoning]` collapsible paragraph expansion (one inline line is enough)
- ❌ Agent badges on InfraMap nodes (PR2 scope anyway)
- ❌ Service health states beyond `healthy / crashed` (no `degraded / restarting / starting / stopped`)

What stays as 1.0 differentiator:

- ✅ Activity timeline as the central observation surface
- ✅ MCP Server page (identity statement)
- ✅ Inline one-line reasoning text on agent events
- ✅ Bot icon on `actor=mcp` events only

## What's deferred to PR2 / PR3

**PR2** (next chunked port, ~2-3 days):

- TopologyHeader InfraMap on Project view
- Project view tabs (Services + Activity) split
- Tooltip-driven node popovers
- CommandPalette / AgentPanel integration into AppShell

**PR3** (largest, ~3-4 days):

- Service Detail rewrite (tabs a11y, runtime variant, monitoring 2x2)
- LogViewer rewrite (FSM split + virtualization + terminal cards visibility)
- Settings page split into 5 separate sub-pages
- Mobile responsive polish
- AppShell takes over from AppLayout for all routes (drops legacy shell)

## Backend wire-up TODO (deferred to PR2/PR3)

The new pages currently render mock data. Wire-up tasks for the backend session:

- [ ] **`/api/activity?actor=&project=&limit=`** — paginated event stream. Shape per `ActivityEvent` in `agentActivity.ts`.
- [ ] **`/api/mcp/status`** — MCP server connection info: status, endpoint, agents[], toolsExposed, callsToday, lastCallAt.
- [ ] **`/api/mcp/agents/:id` (DELETE)** — terminate an agent session (for the Disconnect button).
- [ ] **`/api/system/health`** — cross-project health rollup: total/healthy/crashed counts (drives Home status bar).
- [ ] **i18n keys** — proposed in `web/src/i18n/PATCH-PR1.md`; merge into `en.ts`/`ko.ts`.

## Pre-existing issues NOT introduced by this PR

`tsc -b` reports 4 errors and `npm run lint` reports 26 errors, but **none of them are in files this PR adds or modifies**. They pre-exist on `ui-redesign-1.0`:

- `src/components/ops/v2/DependencyGraph.tsx` — missing types from `@xyflow/react` and `@dagrejs/dagre` (deps were committed to `package.json` in `607a5cd` but `node_modules` was stale; fixed in this PR by running `npm install`).
- `src/hooks/use-mobile.ts`, `src/hooks/use-ops-center-data.ts`, `src/i18n/context.tsx`, `src/pages/NewProjectFlow.tsx`, `src/pages/OpsCenterV2.tsx` — react-hooks lint errors and warnings (pre-existing — file the cleanup as a separate ticket).

## Verification done

- ✅ TypeScript: my new files have **zero** type errors. Run `npx tsc --noEmit` to confirm.
- ✅ Lint: my new files have **zero** lint errors. Run `npx eslint 'src/components/Shell/**' 'src/pages/{Home,Activity,MCPServer}.tsx' 'src/lib/{brand,agentActivity}.ts'` to confirm.
- ✅ Production build: green after `npm install` resolves the stale `@xyflow/react` / `@dagrejs/dagre` deps.
- ⏳ Dev server smoke test: visit `/home`, `/activity`, `/mcp` — pages render with mock data; sidebar + topbar styling correct.

## Marketing screenshot reproduction

1. Run `cd web && npm install && npm run dev`.
2. Open `http://localhost:5173/home`.
3. Captures should show: thin system status bar at top + Unified Activity Stream below with `mcp` events carrying the Bot icon.
4. Headline candidate (per Gemini): **"Your Infrastructure, Operated by Agents."** Sub-line: _"OpenLander deploys and manages itself. You watch, and approve."_

## Code review verdict

The code-reviewer agent (separate context) ran a full pass. Result: **APPROVE**.

- 0 CRITICAL · 0 HIGH · 3 MEDIUM · 4 LOW · 3 NIT
- TypeScript clean · ESLint clean (on PR1 files) · Production build clean
- Spec compliance verified against `.omc/autopilot/spec.md`

### Quick fixes already applied post-review

- **NIT-1**: Removed misleading JSDoc reference to non-existent `icon` prop on `OuterCard`. Documentation now matches the API.
- **NIT-3**: Added `aria-hidden` to the decorative `<Bot />` glyph in `TopBar.tsx`.
- **MEDIUM-3**: Upgraded `FilterPills` in `ActivityTimeline.tsx` from generic buttons to `role="radiogroup"` with `role="radio" aria-checked` per pill, plus `aria-labelledby` association — screen-reader users can now perceive selection state.

### Tracked follow-ups (NOT blocking PR1)

Tracked here so PR2/PR3 can pick them up:

- **MEDIUM-1**: Cross-shell route flicker (`/home` ↔ `/projects` transitions) caused by `.ol-shell-root` class swap in `AppShell.tsx`. Visual-QA before public 1.0; possibly resolved naturally when AppShell takes over from AppLayout in PR3.
- **MEDIUM-2**: `deriveCrumbs` in `AppShell.tsx` always returns a single non-clickable crumb — `aria-current="page"` is structurally valid but degenerate. Becomes meaningful once nested routes land in PR2.
- **LOW-1 / LOW-2**: Generic-ify `FilterPills` over its option-value type to drop the `as ActivityFilters['actor']` cast and gain compile-time project-id checking.
- **LOW-3**: When backend wires real data, sanitize `info.endpoint` before clipboard write in `MCPServer.tsx` (homograph / XSS via copy hardening).
- **LOW-4**: Extract `const project = event.project; if (!project) return null;` early in `ActivityRow` to drop the `event.project!` non-null assertion.
- **NIT-2**: Sidebar items targeting `/settings?tab=…` always render as inactive. Either match `/settings` for all four (and accept that all four highlight), or wait for PR2 to carve real `/settings/proxy`, `/settings/git-providers` routes.

The full review report is preserved at `.omc/autopilot/PR1-review.md`.

## Manual steps for the user

- [ ] Inspect the diff: `git diff develop..ui-redesign-1.0` (web/ only).
- [ ] Optionally bring back the parallel session's `tools/qa/soak-test.sh` change with `git stash pop` (it was stashed at the branch switch).
- [ ] Open `/home`, `/activity`, `/mcp` in dev to validate visual (`cd web && npm run dev`).
- [ ] Decide whether to merge PR1 standalone or batch with PR2/PR3.
- [ ] Manually merge `web/src/i18n/PATCH-PR1.md` into `en.ts` / `ko.ts` (or defer to PR2's i18n wire-up).
- [ ] Commit on `ui-redesign-1.0` with a message of your choosing — autopilot did NOT push or open a PR.
