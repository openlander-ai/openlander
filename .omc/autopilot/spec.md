# Autopilot Spec — OpenLander Round 4 Design Port (PR1)

> Generated 2026-04-26 from accumulated chat context + handoff bundle. Phase 0 expansion was lightweight because the brief is already detailed and concrete.

## Goal

Port the Round 4 Claude Design handoff (the agent-first reframed prototype) into the real React/Vite codebase as the first of three chunked PRs. PR1 focuses on **Foundation + Unified Home page** so the agent-first identity becomes visible without breaking existing pages.

## Source materials

- Handoff bundle: `/Users/idongbin/project/OpenLander/.omc/analysis/openlander-design-v4/test/`
- Design intent (Round 3 strategy): `<bundle>/project/notes/round3-strategy.md`
- Prototype source: `<bundle>/project/src/*.jsx` (15 files), `<bundle>/project/styles.css` (2614 lines)
- Spec docs: `docs/design/v1.0/GUIDE-00..05`
- Prior decisions: `~/.claude/projects/-Users-idongbin-project-OpenLander/memory/MEMORY.md` and linked `project_*.md`

## Target codebase

`/Users/idongbin/project/OpenLander/web/`

- React 19 + Vite + Tailwind 3.4 + Radix UI + lucide-react + @tanstack/react-virtual + xterm
- Existing AppLayout (`Header` + `Sidebar` + `Outlet` + `AgentPanel` + `CommandPalette`) at `src/components/layout/`
- 11 existing pages — all stay intact in PR1

## Scope (PR1 only)

### Files to add

| Path                                     | Purpose                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `web/src/styles/tokens.css`              | oklch color tokens, light + dark, additive layer                    |
| `web/src/lib/brand.ts`                   | rename-ready brand constants                                        |
| `web/src/lib/agentActivity.ts`           | TypeScript types + mock event stream (1.0-honest scope)             |
| `web/src/components/Shell/OuterCard.tsx` | title + subtitle + actions slot primitive                           |
| `web/src/components/Shell/Sidebar.tsx`   | new sidebar V2 (3 sections, agent-first IA)                         |
| `web/src/components/Shell/TopBar.tsx`    | new topbar with breadcrumb + Agent Command Center chip              |
| `web/src/components/Shell/AppShell.tsx`  | new AppLayout-equivalent wrapper for V2 routes                      |
| `web/src/pages/Home.tsx`                 | Unified Activity Stream — Gemini's radical simplification           |
| `web/src/pages/Activity.tsx`             | global timeline with Actor/Project filters + bucketing              |
| `web/src/pages/MCPServer.tsx`            | connection status + connected agents + recent calls                 |
| `web/src/i18n/PATCH-PR1.md`              | proposed i18n keys (manual merge — never directly edit en.ts/ko.ts) |

### Files to modify

| Path                | Why                                         |
| ------------------- | ------------------------------------------- |
| `web/src/index.css` | `@import './styles/tokens.css'` at top      |
| `web/src/App.tsx`   | add new routes under AppShell route element |

### Files NOT touched (PR1 boundary)

- `src/` (backend) — parallel session hardening
- `web/src/i18n/{en,ko}.ts` — patch file only
- All existing pages and `web/src/components/layout/*` — coexistence pattern
- Routes that MCP tools deep-link to (`/projects/:id`, `/services/:id`, `/operations`, etc.) — preserved

## Key design decisions (synthesized from chat + Gemini review)

### Trim list (per "심플하지 않다" feedback + Gemini "냉혹한 다이어트")

**KEEP in 1.0** — agent-first differentiators:

- Activity timeline as central observation surface
- MCP Server page (identity statement)
- Inline one-line reasoning text on agent events (NOT collapsible expansion)
- Bot icon ONLY on actor=mcp events

**DEFER to v1.1+** — features without backend support:

- PendingDecisionsCard with auto-expire timer
- IncidentsCard with crash-loop classification
- Auto-restart-with-reasoning fabricated events
- [See agent reasoning] paragraph expansion
- Agent badges on InfraMap nodes (PR2 scope anyway)

### Home page — Gemini's "Unified Activity Stream"

Drop the 4-card layout. Two elements only:

1. Thin system status bar at top: "All N services running across M projects" or "X of N services need attention"
2. Big timeline below: all events (mcp + human + webhook + system) flowing like Linear's issue stream

No PendingDecisions card. No Incidents card. No project grid. (Project navigation lives in sidebar.)

### Brand

"OpenLander" stays. Routed through single `BRAND` constant in `web/src/lib/brand.ts` for future rename ease.

### CSS strategy

Hybrid: `tokens.css` adds new oklch CSS variables alongside existing `index.css` HSL variables. Tailwind theme already reads `--bg-app` etc. New tokens are additive — won't conflict.

### Coexistence pattern

- New pages render under new `AppShell` (uses Shell V2 components)
- Old pages remain under existing `AppLayout` (untouched)
- Sidebar V2 links to BOTH old and new pages — single global navigation
- Visual mismatch when navigating between old and new is acceptable per brief

## Success criteria

1. `npm run typecheck` clean on web/
2. `npm run build` clean on web/
3. `npm run lint` clean (or document deltas)
4. `npm run dev` boots; visiting `/home`, `/activity`, `/mcp` renders new pages with mock data
5. Existing pages (`/projects`, `/services/:id`, etc.) still work unchanged
6. Code-reviewer agent (separate context) approves the diff
7. PR description drafted; user manually opens PR

## Out of scope (deferred to PR2/PR3)

- Service Detail / Log Viewer rewrite (PR3)
- TopologyHeader InfraMap on Project view (PR2)
- Project view tabs (Services + Activity) split (PR2)
- Settings page split into 5 (PR3)
- Real backend wire-up replacing mock data (PR3+)
- Mobile responsive polish (PR3)
- Print-stack / hero screenshot generation (PR3)

## Risks

- **R1 — Tailwind theme conflicts**: existing `tailwind.config.js` already maps `bg-app` → `var(--bg-app)`. New tokens.css must use _different_ var names (e.g., `--ol-bg-app`) OR override compatibly. Decision: use new vars prefixed `--ol-*` to avoid clobbering.
- **R2 — i18n key inflation**: new pages need ~15-20 new keys. Patch file proposes them; user merges manually.
- **R3 — Sidebar UX double**: PR1 ships TWO sidebars (old AppLayout one + new AppShell one). User may be confused. Mitigation: only NEW routes use AppShell; existing routes use the unchanged old shell. Documented in PR description.
- **R4 — Mock data drift**: backend session may emit different shapes for activity events. Mitigation: types in `agentActivity.ts` documented as "speculative until backend lands".
