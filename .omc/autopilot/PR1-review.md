# PR1 — Code Review Report

> Independent review by the `oh-my-claudecode:code-reviewer` agent in a
> separate context (no prior conversation memory). Captured here for
> traceability.

## Verdict

**APPROVE**

- 0 CRITICAL
- 0 HIGH
- 3 MEDIUM
- 4 LOW
- 3 NIT

TypeScript clean (`npx tsc --noEmit` exit 0).
Spec compliance verified against `.omc/autopilot/spec.md` and `.omc/plans/autopilot-impl.md`.

## Quick fixes applied immediately after review

- **NIT-1**: Drop misleading JSDoc reference to non-existent `OuterCard.icon` prop. (`OuterCard.tsx`)
- **NIT-3**: `aria-hidden` on decorative Bot glyph in TopBar. (`TopBar.tsx:100`)
- **MEDIUM-3**: FilterPills upgraded from generic buttons to `role="radiogroup"` + `role="radio" aria-checked` + `aria-labelledby`. (`ActivityTimeline.tsx`)

## Findings tracked for follow-up

### MEDIUM-1 — Cross-shell route flicker

File: `web/src/components/Shell/AppShell.tsx:58-63`
The `useEffect` adding `.ol-shell-root` to `documentElement` runs after first paint. When navigating from a V1 route (under AppLayout) to a V2 route (under AppShell), one render frame passes before the html-level background swaps. Visual-QA before public 1.0; likely auto-resolved when AppShell takes over from AppLayout in PR3.

### MEDIUM-2 — Single-crumb breadcrumb

File: `web/src/components/Shell/AppShell.tsx:32-37`, `web/src/components/Shell/TopBar.tsx:71-77`
`deriveCrumbs` always returns one non-clickable crumb. `aria-current="page"` is structurally valid but useless without a parent crumb. Becomes meaningful when nested routes land in PR2 (e.g. `/projects/:id`).

### LOW-1 — Actor pill cast

File: `web/src/components/Shell/ActivityTimeline.tsx:183`
The `as ActivityFilters['actor']` cast is sound today but fragile to typos. Generic-ify FilterPills over `<V extends string>`.

### LOW-2 — Project pill compile-time check

File: `web/src/components/Shell/ActivityTimeline.tsx:213-220`
A typo in a project id silently filters everything out instead of a compile error. Same fix as LOW-1.

### LOW-3 — `info.endpoint` clipboard sanitization

File: `web/src/pages/MCPServer.tsx:87-93`
When backend wires the real endpoint, sanitize before display/copy (homograph attack hardening).

### LOW-4 — `event.project!` non-null assertion

File: `web/src/components/Shell/ActivityTimeline.tsx:99-106`
Stylistic — extract early-return `const project = event.project; if (!project) return null;` to drop the `!`.

### NIT-2 — Settings items always inactive

File: `web/src/components/Shell/Sidebar.tsx:108-138`
`Web Server`, `Git Providers`, `SSH Keys`, `Notifications` use `matches: () => false` so they never highlight, even on `/settings?tab=proxy`. Resolves naturally when PR2 carves real per-tab routes.

## Positive observations from the reviewer

1. **Genuinely additive design** — `--ol-*` prefix discipline, parallel `Shell/` directory, distinct localStorage key for sidebar collapse all reflect a careful "do not break existing routes" mindset.
2. **Mock data is honest** — `agentActivity.ts` explicitly enumerates what the backend can emit today vs. what was deliberately removed (auto-restart, OOM detection, multi-paragraph reasoning).
3. **i18n discipline** — `PATCH-PR1.md` was the right move: not editing `en.ts`/`ko.ts` from a parallel session, while still proposing canonical key names.
4. **Type-driven contract** — `agentActivity.ts` types are tight; the type IS the spec for the backend hook that will replace the mock.
5. **localStorage write try/catch in `AppShell.tsx`** — small but easy to forget.
6. **Brand single-source-of-truth** — `lib/brand.ts` is overkill for an 8-key constant, but proportional to the pre-1.0 rename risk.

## Issues the reviewer checked and did NOT find

- Routing under `<SetupGuard />` is correct — auth/setup checks apply to `/home`, `/activity`, `/mcp` exactly as they do for existing routes.
- `localStorage` SSR safety in `AppShell` — `useState` initializer correctly checks `typeof window === 'undefined'`.
- `color-mix(in oklch, …)` browser support — Chrome 111+, Safari 16.2+, Firefox 113+. All current evergreen.
- No hex/rgb literals in PR1 code — all colors flow through `--ol-*`.
- Tailwind utility clobber — new tokens (`--ol-bg-app`) don't overlap existing (`--bg-app`).
- localStorage key collision — `ol-shell-sidebar-collapsed` distinct from legacy `openlander-sidebar-collapsed`.
- No unused imports.
- No hardcoded secrets.
- No `any` leaks.
- Mock exports are clearly labelled stub.
- V2 pages don't call `useAgentPanel`, so absence of `AgentPanelContext.Provider` in AppShell is not a runtime hazard.

## Reviewer's UX note (relevant for the user's "ui/ux 전혀 모르거든" framing)

> "The only finding that a UX-trained reviewer would push back on is the
> FilterPills accessibility (MEDIUM #3). That's a fix-before-1.0-launch,
> not a fix-before-PR1-merge."

(MEDIUM-3 has been fixed post-review.)
