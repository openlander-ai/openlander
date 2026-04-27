# PR4 — Code Review Report

> Independent review by `oh-my-claudecode:code-reviewer` agent in a
> separate context. Captured here for traceability.

## Verdict

**APPROVE — commit-ready for v1.0**

- 0 CRITICAL
- 0 HIGH
- 5 MEDIUM (all forward-looking, tracked for PR5)
- 4 LOW / NIT (1 fixed in this PR, 3 tracked)

Spec compliance verified end-to-end across all four mini-PRs (A/B/C/D). TypeScript clean. ESLint 0 errors. Build green. Zero orphan imports after legacy file deletion.

## Stage 1 — Spec Compliance (PASS)

| Mini-PR               | Verified                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A: InfraMap           | React Flow + dagre, smoothstep edges, alert classname on crashed target, lonely/empty/dense decision tree all wired    |
| B: AppLayout takeover | Single AppShell, 13 routes nested, legacy redirects dropped, 6 deleted files have zero remaining importers             |
| C: LogViewer split    | 787 → ~590 lines split into 3 files, `minHeight` not `height`, BACKFILLING in Kill gate, phase-filter not magic-number |
| D: Wire-up            | `useProjects()` in Sidebar + Home with mock fallback, `projectMappers` synthesizes missing prototype fields            |
| E: i18n               | `PATCH-PR4.md` only — no direct edits to `en.ts/ko.ts`                                                                 |

## LOW issue fixed in this PR (post-review)

### LOW-1 — `lastDeployFor` negative-delta guard

**File**: `web/src/lib/projectMappers.ts:55-58`

Backend timestamp from the future (or clock skew) would yield `"-3m ago"`. Added `if (diffMs <= 0) return 'Just now';` guard.

## MEDIUM tracked for PR5

### MEDIUM-1 — InfraMap layout effect re-fires on every `agentActivity` change

**File**: `web/src/components/Shell/InfraMap.tsx:197-247`

Dependency array includes `agentActivity`, but only `recentAgentFor()` consumes it inside the effect (just flips a boolean per node). Every activity update triggers full dagre re-layout.

**Fix at PR5**: Split into two effects — layout (services/dense/direction deps) + badge update via `setNodes((prev) => ...)` without re-running dagre. Or memoize `recentAgentMap` outside.

### MEDIUM-2 — Animations don't honor `prefers-reduced-motion`

**File**: `web/src/components/Shell/InfraMap.css:21-30, 37-41, 43-47`

`ol-node-pulse` and `ol-edge-flow` keyframes run forever with no media query gate. Vestibular-disorder users get an unstoppable pulse on any crashed node.

**Fix at PR5**:

```css
@media (prefers-reduced-motion: reduce) {
  .infra-map-node-disk.h-crashed::before {
    animation: none;
    opacity: 0.55;
  }
  .infra-map .react-flow__edge.alert .react-flow__edge-path {
    animation: none;
  }
}
```

### MEDIUM-3 — NodePopover clipping near container top

**File**: `web/src/components/Shell/InfraMap.tsx:393-397`

`top: y - 12, transform: translate(-50%, -100%)` always positions popover above the node. Top dagre row sits ~30-40px from container top → popover may clip. RF wraps content in `overflow: hidden` by default.

**Fix at PR5**: Detect node-near-top, flip below when `y < popoverHeight`.

### MEDIUM-4 — Triple `useProjects()` polling

**Files**: `Sidebar.tsx:162` + `Home.tsx:31` + `CommandPalette.tsx:59`

Three independent polling timers each fetch `/api/projects` every 3-10s. Acceptable for single-tenant single-user v1.0; not for production scale.

**Fix at PR5**: Hoist `useProjects` to an AppShell-mounted `<ProjectsProvider>` that owns the single fetch, exposes via context.

### MEDIUM-5 — LogViewer.tsx still ~590 lines after split

**File**: `web/src/components/Shell/LogViewer.tsx`

Two more chunks could come out:

1. `phaseStatus` + `rows` `useMemo` derivations → `lib/logRows.ts`
2. ENDED/CANCELLED terminal cards → `<LogViewerSummaryCards>` component

**Fix at PR5**: Extract → ~440 lines, hits the original ~400 target.

## LOW / NIT — tracked

### LOW-2 — `STORAGE_KEY` naming

**File**: `AppShell.tsx:36`

Currently `STORAGE_KEY` is unique within the file. If a second key ever lands, rename to `SIDEBAR_COLLAPSED_KEY` for grep-ability. Defensive nit.

### NIT-1 — eslint-disable on mobile-sheet effect

**File**: `AppShell.tsx:96-99`

The functional updater short-circuits when already closed. The eslint-disable IS justified — closing an open sheet on navigation is a legitimate side effect that can't be lifted (Sheet open state is owned by user clicks). Comment in source explains it well. Keep as-is.

### NIT-2 — `recentAgentFor` assumes events sorted desc by `relTs`

**File**: `web/src/lib/projectTopology.ts:298-304`

Returns the FIRST matching event, not the most recent. Works only because `MOCK_ACTIVITY` is hand-ordered desc. Add a JSDoc note or sort defensively.

## Reviewer's positive observations

1. **Excellent JSDoc headers** on every new file — explain WHY (the crooked-edge problem, the slice(0,6) magic-number, the eslint-disable rationale) not just WHAT.
2. **Defensive fallbacks** — Sidebar badge and Home status bar both treat `loading || error || empty` as fall-through-to-mock. UI never breaks when backend stutters.
3. **`React.memo` on InfraMapNode** — limits re-render fanout from the layout effect.
4. **Stable color hashing** in `projectMappers.colorFor` — same project always gets the same color.
5. **Phase-filter fix in logScripts.ts** — robust to BASE-script edits in a way `slice(0, 6)` was not.
6. **`fitView` belt-and-suspenders** — declarative prop + imperative call after services-change ensures viewport refits.
7. **Legacy file deletions are clean** — no broken redirects, no orphan imports.
8. **AppShell comments explaining legacy STORAGE_KEY divergence** — prevents accidental key collision.

## Specific answers to brief's logic-defect checks

- **dagre.layout for 1/2/8/12 services**: works. 1 → InfraMapLonely. 2-8 → standard LR layout. >8 → dense TB layout. nodesep/ranksep tuned reasonably.
- **fitView actually fits**: yes. Prop `fitView` + imperative call deferred via `setTimeout(0)` after node-list change.
- **Edge severity CSS hookup**: confirmed end-to-end (`InfraMap.tsx:227` adds `alert` className → `InfraMap.css:37` selects `.react-flow__edge.alert`).
- **BACKFILLING in Kill gate**: confirmed (`LogViewer.tsx:413-417`).
- **LogPayload import**: confirmed (`logAnsi.tsx` exports → `LogViewer.tsx:42` imports → `:581` renders).
- **parseAnsi regex with U+001B byte**: confirmed via xxd. Regex matches both real ANSI and bracketed test fixtures.
- **AppShell missing useNotifications/useSystemStats**: NO REGRESSION. The legacy Header rendered them as a notification dropdown; V2 chrome moves Notifications to a sidebar Integrations entry.
- **Orphan imports after deletions**: NONE. Grep on the 6 deleted symbols returns zero remaining imports.
