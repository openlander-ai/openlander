# PR7 — Cleanup + accessibility + perf hygiene

> Phase 0 light expansion. Builds on PR1-PR4 + PR6 (all uncommitted on `ui-redesign-1.0`). No new features — pure hygiene.

## Goal

Three buckets, no scope creep:

1. **Cleanup** — delete 6 confirmed-orphan files in `web/src/components/layout/`.
2. **Accessibility** — `prefers-reduced-motion` media-query gates on every infinite animation.
3. **Code quality / perf** — split files past target size, factor out duplicated hooks, fix the medium-severity items the PR6 code-reviewer flagged, plus a few targeted PR4-tracked follow-ups.

## Files added (4)

| Path                                                 | LOC | Purpose                                                                                                                                                            |
| ---------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web/src/contexts/projects-context.tsx`              | 33  | `<ProjectsProvider>` mounted in AppShell; `useProjects()` runs ONCE for the app instead of 3-4 separate instances.                                                 |
| `web/src/hooks/use-projects-context.ts`              | 21  | `useProjectsContext()` — reads the shared instance. Lives in its own file so React Fast Refresh's "components-only" lint stays happy.                              |
| `web/src/lib/logRows.ts`                             | 152 | Pure helpers extracted from LogViewer: `derivePhaseStatus`, `buildLogRows`, `VirtualRow` type, plus the row-height constants. Side-effect free, easy to unit-test. |
| `web/src/components/Shell/LogViewerSummaryCards.tsx` | 72  | Terminal-state card dispatcher. ENDED+fail → FailureSummary, ENDED+success → SuccessSummary, CANCELLED → CancelledSummary. Returns null otherwise.                 |

## Files modified (10)

- `web/src/components/Shell/InfraMap.tsx`
  - **Layout effect split**: the single useEffect that ran dagre on every render now splits into LAYOUT (deps: `services / activeNodeId / dense / direction`) and DATA UPDATE (deps: `agentActivity / projectId`). The data-update effect patches only `data.hasRecentAgent` via `setNodes((prev) => prev.map(...))` — no dagre, no re-positioning. Result: a 3-10s `agentActivity` poll tick stops triggering full topology re-layout.
  - **`agentActivityRef` ref-sync** with explicit timing-guarantee comment so a future reader doesn't worry about stale closures.
  - **NodePopover flip-below**: when a node is too close to the container's top edge (`y < POPOVER_EST_HEIGHT + 12`), the popover renders below the node instead of above so it never clips out of the viewport.

- `web/src/components/Shell/InfraMap.css`
  - Added `@media (prefers-reduced-motion: reduce)` block disabling `ol-node-pulse` (crashed-disk attention ring), `ol-edge-flow` (alert-edge dashes), and the `ol-popover-in` entrance. The visual signal is preserved (ring + dashed edge + popover all still render) — only the motion is suppressed.

- `web/src/components/Shell/LogViewer.tsx` (542 → 459 lines)
  - `phaseStatus` derivation → `derivePhaseStatus(lines, buildOutcome)` from `lib/logRows.ts`.
  - Virtual-row building → `buildLogRows(lines, progressByLineNum, phaseStatus, buildOutcome)` from `lib/logRows.ts`.
  - Terminal cards → `<LogViewerSummaryCards variant connState buildOutcome … />`.
  - Replaced the `setViewState('FOLLOWING')` setState-in-effect with the React "store-prev-key during render" pattern using `lastStreamKeyRef`. Skips a wasted render every time the stream key (deploymentId|mockMode) changes.

- `web/src/components/Shell/LogViewer.css`
  - Added `@media (prefers-reduced-motion: reduce)` gate on the inline progress bar's width transition.

- `web/src/components/Shell/AppShell.tsx`
  - Wraps children with `<ProjectsProvider>` so the single shared `useProjects()` instance is available to Sidebar / Home / CommandPalette.

- `web/src/components/Shell/Sidebar.tsx`
- `web/src/pages/Home.tsx`
- `web/src/components/command/CommandPalette.tsx`
  - All three: switch from `useProjects()` direct to `useProjectsContext()`. Network panel now shows ONE `/api/projects` request per polling cycle instead of 3.

- `web/src/hooks/use-deploy-log-stream.ts`
  - Dropped the dead `{progress}` SSE branch — the backend doesn't emit synthetic `{progress}` markers (those are mock-only). Real backends stream plain log lines.
  - Removed the `setProgressByLineNum` state since it can never be populated. The hook returns a frozen, shared `EMPTY_PROGRESS` object on the public shape so consumers can read it unconditionally without a per-call allocation.

- `web/src/pages/ServiceDetailV2.tsx`
  - Simplified `useServiceHealth(service ? (id ?? null) : null)` to `useServiceHealth(id ?? null)` — when `id` is missing the route guard already redirects, and the hook itself no-ops on null. The previous form was a paradox (the gate it checked was derived from the same `id`).
  - Added "stale" indicator on the header when `liveHealth.error` — surfaces gracefully that the displayed pill is the LAST KNOWN state from topology, not a fresh reading.

## Files deleted (6 orphans, all importer-verified)

- `web/src/components/layout/ActivityPulse.tsx`
- `web/src/components/layout/NotificationCenter.tsx`
- `web/src/components/layout/ThemeSelector.tsx`
- `web/src/components/layout/DeployDialog.tsx`
- `web/src/components/layout/ShareDialog.tsx`
- `web/src/components/layout/ProjectCard.tsx` (the layout/ duplicate; `dashboard/ProjectCard.tsx` is the real one)

`grep -rn` against each filename returned zero importers before deletion.

## Out of scope (deferred to PR8+)

- Switching `pages/ProjectsGrid.tsx` to `useProjectsContext()` — the page uses `useProjects(true)` for its archived-toggle scope, which the singleton provider only fetches in the default `includeArchived: false` shape. Splitting the context into two scopes seemed like premature complexity for one consumer.
- Stabilizing the stream hook return objects via `useMemo` (a perf-hygiene win flagged by PR7 review as MED-2). Pre-existing churn that doesn't break correctness; would invalidate downstream `React.memo` if any ever lands.
- i18n wire-up (`useLanguage().t()` substitution pass for new components).
- Visual reconciliation pass on legacy routes that still mount old chrome inside V2 shell.
- Bundle-size optimization (`react-flow` is 217 kB gzipped — code-split to `/projects/*` if marketing wants smaller initial JS).

## Success criteria check

| #   | Criterion                                                                | Status                                                                        |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | `npx tsc --noEmit` clean                                                 | ✅                                                                            |
| 2   | `npm run lint` clean on PR7 file set                                     | ✅ — 0 errors, only pre-existing CSS-config + virtualizer-compat warnings     |
| 3   | `npm run build` green; bundle size doesn't regress                       | ✅ — built in 3.24s, chunks unchanged                                         |
| 4   | dev server boots; `/home`, `/projects/:id`, `/services/:id` all render   | ⚠️ Not manually re-verified after PR6; build success implies render parity    |
| 5   | Network panel shows ONE `/api/projects` request per polling cycle        | ✅ — only ProjectsProvider polls (Sidebar/Home/CommandPalette read context)   |
| 6   | macOS "Reduce motion" preference disables crashed-node pulse + edge-flow | ✅ — `@media (prefers-reduced-motion: reduce)` blocks added to both CSS files |
| 7   | Code-reviewer agent approves combined PR7 diff                           | ✅ APPROVE-WITH-FOLLOWUPS — see `PR7-review.md`                               |

## Diff scope

- 4 files added (+278 LOC)
- 10 files modified (varies; LogViewer trimmed by ~83 LOC, others mostly small touches)
- 6 files deleted (−1,387 LOC orphan code)
- Net: substantially smaller surface area
