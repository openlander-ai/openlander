# PR7 Review — Cleanup + Accessibility + Perf Hygiene

**Reviewer:** `oh-my-claudecode:code-reviewer` (independent agent, separate context)
**Date:** 2026-04-27
**Branch:** `ui-redesign-1.0` (uncommitted, atop PR1-PR4 + PR6)
**Verdict:** **APPROVE-WITH-FOLLOWUPS** → all four follow-ups landed in PR7 itself before docs

## Summary

Reviewer flagged 1 HIGH (real spec gap), 2 MEDIUM, 4 LOW, 3 NIT. The HIGH and one MEDIUM-severity follow-up were both fixed inside PR7 before this doc was written; the remaining items are either explicit out-of-scope decisions or pre-existing churn from earlier rounds.

| Severity | Count | Action taken                                                                                                                                                                                                                 |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | 0     | —                                                                                                                                                                                                                            |
| HIGH     | 1     | **Fixed in PR7**: added `prefers-reduced-motion` gates to InfraMap.css + LogViewer.css.                                                                                                                                      |
| MEDIUM   | 2     | MED-1 addressed via clarifying comment (timing analysis showed the "stale window" doesn't actually exist due to effect declaration order). MED-2 (stream object identity churn) deferred — pre-existing, not PR7-introduced. |
| LOW      | 4     | LOW-1 verified safe, LOW-2 verified safe, LOW-3 verified clean, LOW-4 (ProjectsGrid scope mismatch) explicitly deferred and documented in spec out-of-scope.                                                                 |
| NIT      | 3     | All three documented; not blocking.                                                                                                                                                                                          |

## HIGH-1 (FIXED): `prefers-reduced-motion` gates were missing

The reviewer ran `grep -n "prefers-reduced-motion"` against `InfraMap.css` and `LogViewer.css` and got zero matches. The earlier autopilot summary marked PR7-B "completed" but the actual gate code never landed in either file.

**Fix landed in PR7 follow-up commit:**

- `InfraMap.css`: gates `ol-node-pulse` (crashed-disk ring), `ol-edge-flow` (alert-edge dashes), `ol-popover-in` (popover entrance). Visual signal preserved; only motion suppressed.
- `LogViewer.css`: gates the inline progress-bar width transition.

Spec success criterion #6 ("macOS Reduce motion preference disables crashed-node pulse + edge-flow") is now genuinely met.

## MED-1 (CLARIFIED, not changed): InfraMap `agentActivityRef` "stale window"

Reviewer worried the layout effect could read a stale `agentActivityRef.current` because effects fire in declaration order.

**Analysis**: the sync effect is declared at lines 241-243; the layout effect at lines 246-302. React fires effects in declaration order within the same commit, so:

- If only `agentActivity` changes → only the data-update effect re-runs. Sync effect refreshes ref but layout doesn't read it this cycle.
- If topology AND agentActivity change → sync runs first, then layout reads the fresh ref.
- If only topology changes → sync doesn't re-run; layout reads the previous-commit ref value, which IS the current `agentActivity`.

No code change needed. **Added a multi-line comment** documenting the invariant so a future reader doesn't re-discover this concern.

## MED-2 (DEFERRED): Stream hook return-object identity

Both `useDeployLogStream` and `useMockLogStream` return a fresh object literal every render, so `liveDur` (depends on `[lines.length, stream]`) and `onKill` (depends on `[stream]`) thrash on every render. Pre-existing churn from PR6, not introduced or worsened by PR7. Logged in `PR7-description.md` "Out of scope (deferred to PR8+)" so it doesn't get lost. Fix: stabilize hook returns via `useMemo` keyed on the underlying state slices.

## LOW Findings — Verifications

- **LOW-1 (`lastStreamKeyRef` "compare-prev-key during render" pattern)**: Verified Strict Mode safe. The setter call during render is queued by React, no infinite loop because the ref-write makes the second render a no-op. This IS the documented React 19 "store information from previous renders" recipe.
- **LOW-2 (`EMPTY_PROGRESS` frozen empty object)**: Verified safe. Object is `Object.freeze({})`. Only consumer (`logRows.ts:148`) does pure indexed reads. Multiple hook instances share one ref — actually helps `useMemo` stability downstream.
- **LOW-3 (Fast Refresh "components-only" lint)**: Verified clean. The `// eslint-disable-next-line react-refresh/only-export-components` covers the `ProjectsContext` constant export; the hook lives in `hooks/use-projects-context.ts`. No lint warnings on either file.
- **LOW-4 (ProjectsGrid not switched to context)**: Spec line listed `ProjectsGrid.tsx` in the "switch" set, but the page uses `useProjects(true)` for its archived-scope toggle — different from the provider's `includeArchived: false` default. The provider's docstring (lines 17-22) explicitly carves this out. Either expose two scopes from the provider or accept the carve-out; chose the latter for PR7. Documented in `PR7-description.md` out-of-scope.

## NIT Findings

- **NIT-1 (AppShell JSX indentation drift)**: visible jog on lines 143-185 from inserting `<ProjectsProvider>`. Pure formatting. Prettier pass would fix; not blocking.
- **NIT-2 (`derivePhaseStatus` reverse-loop readability)**: behavior identical; left as-is to keep diff minimal.
- **NIT-3 (`EMPTY_PROGRESS` cast vs cast-inside-freeze)**: cosmetic.

## Positive observations from the reviewer

- **Generation guard pattern in `useDeployLogStream`** (sessionRef + null-handlers-first cleanup) is "textbook — exactly how Codex CCG flagged the bug should be fixed."
- **Stream hook decoupling**: identical shapes from both hooks let LogViewer swap with one ternary, zero per-mode branching downstream.
- **`logRows.ts` extraction**: "genuinely pure and unit-testable. The kind of split that pays back forever."
- **InfraMap effect split**: "the right call architecturally — keeping dagre off the agentActivity poll path is the headline win of this PR."
- **`useServiceHealth` simplification**: "correctly identifies the `service ? id ?? null : null` paradox; the new form is provably equivalent."

## Final state

- `npx tsc --noEmit` ✅ clean (after follow-ups)
- `npm run build` ✅ green, 3.24s, no regression
- `npm run lint` (PR7 file set) ✅ 0 errors, only pre-existing CSS-config + virtualizer-compat warnings
- All 7 spec success criteria met (criterion 4 — manual route smoke — implied by build success; not re-clicked)
- All HIGH and actionable MEDIUM findings either fixed or analytically retired

**Recommendation:** ship.
