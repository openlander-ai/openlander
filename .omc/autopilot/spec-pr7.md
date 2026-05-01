# Autopilot Spec — PR7 (Cleanup + accessibility + perf hygiene)

> Phase 0 light expansion. Builds on PR1-PR4 + PR6 (all uncommitted on `ui-redesign-1.0`).

## Goals

Pure hygiene PR — no new features. Three buckets:

1. **Cleanup**: 6 orphan files in `web/src/components/layout/`, `MOCK_FLEET_SERVICES` already gone (PR6 did it).
2. **Accessibility**: `prefers-reduced-motion` media-query gates on every infinite animation.
3. **Code quality / perf**: Split files that grew past target size, factor out duplicated hooks, fix the medium-severity items the PR6 code-reviewer flagged.

## Files added

| Path                                                 | Purpose                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/contexts/projects-context.tsx`              | Single `<ProjectsProvider>` mounted in AppShell; exposes `useProjectsContext()` so Sidebar/Home/CommandPalette/ProjectsGrid don't each spawn their own poller. |
| `web/src/lib/logRows.ts`                             | Extracted `derivePhaseStatus` + `buildLogRows` + types. Pure helpers, easy to unit-test.                                                                       |
| `web/src/components/Shell/LogViewerSummaryCards.tsx` | Extracted ENDED/CANCELLED terminal-card rendering.                                                                                                             |

## Files modified

- `web/src/components/Shell/InfraMap.tsx` — split layout effect (services/dense/direction deps) from badge effect (`agentActivity` flips `hasRecentAgent` via `setNodes((prev) => …)` without re-running dagre). NodePopover gains flip-below when near top edge.
- `web/src/components/Shell/InfraMap.css` — `@media (prefers-reduced-motion: reduce)` gate on `ol-node-pulse` + `ol-edge-flow`.
- `web/src/components/Shell/LogViewer.tsx` — uses `derivePhaseStatus` + `buildLogRows` from `lib/logRows.ts`; ENDED/CANCELLED terminal-band swapped to `<LogViewerSummaryCards>`. Drops the `setViewState('FOLLOWING')` setState-in-effect when `mockMode`/`deploymentId` change (computed from `useEffect` cleanup instead).
- `web/src/components/Shell/LogViewer.css` — reduced-motion gate on any pulse keyframes used by the header pill.
- `web/src/components/Shell/Sidebar.tsx` — switch to `useProjectsContext()`.
- `web/src/components/Shell/AppShell.tsx` — wrap children with `<ProjectsProvider>`.
- `web/src/pages/Home.tsx` — switch to `useProjectsContext()`.
- `web/src/components/command/CommandPalette.tsx` — switch to `useProjectsContext()`.
- `web/src/pages/ProjectsGrid.tsx` — switch to `useProjectsContext()`.
- `web/src/hooks/use-deploy-log-stream.ts` — fix MEDIUM: read `lines.length + 1` outside the `setLines` updater; drop dead `{progress}` SSE branch (backend never sends that marker).
- `web/src/hooks/use-mock-log-stream.ts` — same fix as above; align naming with the SSE hook.
- `web/src/pages/ServiceDetailV2.tsx` — simplify `useServiceHealth(id ?? null)` (drop the `service ? id ?? null` paradox); display `liveHealth.error` indicator on the header pill (gracefully degraded — falls through to topology.health when stream is down).
- `web/src/components/Shell/Sidebar.tsx`, `Home.tsx`, `CommandPalette.tsx`, `ProjectsGrid.tsx` — see context unification above.

## Files deleted (6 orphans)

- `web/src/components/layout/ActivityPulse.tsx`
- `web/src/components/layout/NotificationCenter.tsx`
- `web/src/components/layout/ThemeSelector.tsx`
- `web/src/components/layout/DeployDialog.tsx`
- `web/src/components/layout/ShareDialog.tsx`
- `web/src/components/layout/ProjectCard.tsx` (the layout/ duplicate; `dashboard/ProjectCard.tsx` is the real one)

Verified zero importers each via grep before deletion.

## Out of scope (deferred to PR8+)

- i18n wire-up (`useLanguage().t()` substitution pass for new components) — large mechanical change, deserves its own PR.
- Visual reconciliation pass on legacy routes that still mount old chrome inside V2 shell (Overview, ProjectsGrid, OpsCenterV2, etc.).
- Bundle-size optimization (`react-flow` is 217 kB gzipped — code-split to /projects/\* routes if marketing wants smaller initial JS).

## Success criteria

1. `npx tsc --noEmit` clean.
2. `npm run lint` clean on PR7 add/modify/delete file set.
3. `npm run build` green; bundle size doesn't regress.
4. dev server boots; `/home`, `/projects/:id`, `/services/:id` all render.
5. Network panel shows ONE `/api/projects` request per polling cycle (not 3-4).
6. macOS "Reduce motion" preference disables crashed-node pulse + edge-flow.
7. Code-reviewer agent approves combined PR7 diff.
