# PR2 + PR3 — Code Review Report

> Independent review by the `oh-my-claudecode:code-reviewer` agent in a
> separate context. Captured here for traceability.

## Initial verdict: REQUEST CHANGES (2 HIGH)

After fixes applied below: **APPROVE** with MEDIUM/LOW follow-ups tracked.

- 0 CRITICAL
- 2 HIGH (both fixed in this PR)
- 5 MEDIUM (2 fixed, 3 tracked)
- 8 LOW / NIT (all tracked)

TypeScript clean. ESLint 0 errors on PR2+PR3 files. Production build green.

## HIGH issues — fixed in this PR

### HIGH-1 — `parseAnsi` regex was a no-op

**File:** `web/src/components/Shell/LogViewer.tsx` (function `parseAnsi`)

**Bug**:

- Early-out: `if (!s.includes('[') && !s.includes('['))` — both branches tested U+005B `[`. Dead code (`A && A` ≡ `A`).
- Regex: `/(?:)?\[([0-9;]*)m/g`. The intent was "ESC is optional before `[…m`". `(?:)?` is a zero-width optional group, i.e. matches the empty string. Real ESC sequences (`[31m`) consumed only `[31m` while leaving the leading ESC byte in the payload as a stray character.

**Fix**: byte-precise replacement of the entire `parseAnsi` function. Now:

- Early-out checks ESC AND `[` separately: `if (!s.includes('') && !s.includes('['))`.
- Regex: `/?\[([0-9;]*)m/g` — leading ESC is genuinely optional; both real ANSI from the backend and the literal `[…m` form used in test fixtures are matched correctly.
- ESLint `no-control-regex` disabled inline with explanation.

### HIGH-2 — `/projects/:id?tab=console` deep-link broken

**File:** `web/src/components/command/CommandPalette.tsx:184–195`

**Bug**: CommandPalette's `Logs: {project.name}` item navigated to `/projects/${id}?tab=console`. After PR2-D, `/projects/:id` mounts ProjectViewV2 which has only `services` and `activity` tabs. `?tab=console` was silently ignored — user landed on the Services tab.

**Fix**:

- Palette item label changed from `Logs: {project}` to `Activity: {project}` (the closest analog in V2).
- Navigates to `/projects/${id}?tab=activity` instead.
- ProjectViewV2 now reads `?tab=` query and uses it as the initial active tab — deep-link support is live.

## MEDIUM issues — fixed in this PR

### MEDIUM-1 — `?project=` query inconsistency

**File:** `web/src/pages/ProjectViewV2.tsx:114, 130`

**Bug**: Services panel `onOpen={(sid) => navigate(\`/services/${sid}\`)}` and Activity panel `onOpenService={(_p, sid) => navigate(\`/services/${sid}\`)}`both forgot to attach`?project=`. ServiceDetailV2 then fell through to a hard-coded `'hotdeal-tracker'`default — clicking a service in`links-shortener`would render`/services/web`showing data from`hotdeal-tracker`.

**Fix**: introduced single `openService(serviceId)` helper that attaches `?project=` once. All three internal callers (InfraMap, ServicesPanel, ActivityTimeline rows) use it.

### MEDIUM-2 — ServiceDetailV2 silent project fallback

**File:** `web/src/pages/ServiceDetailV2.tsx:62, 70`

**Bug**: `searchParams.get('project') ?? 'hotdeal-tracker'` masked any "project param missing" caller bug by silently picking the wrong project.

**Fix**: when `?project=` is null, render the not-found branch with a friendly message: "Open this service from a project page so we know which project owns it. Direct links to /services/{id} need a ?project= query parameter."

## MEDIUM issues — tracked for PR4

### MEDIUM-3 — LogViewer.tsx is 787 lines

Split into `LogViewer.tsx` (FSM + virtualizer wiring) + `Shell/LogViewerHeader.tsx` (chrome, pill, badge, action buttons) + `lib/logAnsi.ts` (parseAnsi + payload renderer). Brings the main file under ~400 lines.

### MEDIUM-4 — LogLine fixed-height clipping

`<div style={{ height: ROW_LINE_HEIGHT }}>` on LogLine combined with `white-space: pre-wrap` clips wrapped lines. Real-world stack traces will overflow. Either drop the fixed height (let `measureElement` compute) or commit to single-line truncation.

### MEDIUM-5 — Kill button gate excludes BACKFILLING

`(connState === 'LIVE' || connState === 'RECONNECTING' || connState === 'CONNECTING') && !isRuntime`. The brief said exactly this set; reviewer flagged that BACKFILLING is also a "stream alive, build in progress" state where killing makes sense. PR4 decision: include or exclude BACKFILLING from the gate.

## LOW / NIT — tracked for PR4

- **LOW-1** — `LOG_SCRIPT_FAIL` magic-number `slice(0, 6)` brittle to BASE edits. Replace with phase filter or extract `CLONE_FIXTURE` constant.
- **LOW-2** — `Sparkline` `Math.min(...data)` / `Math.max(...data)` spread is fine for 60-element data, blows past ~10k. Already flagged in PR2-PR3 spec; PR5 monitoring backend wire-up will reassess.
- **LOW-3** — `recentAgentFor` is O(n) per node per render. Build a `Map<string, ActivityEvent>` once at the InfraMap parent if activity stream balloons past ~500 events or fleet past ~50 services.
- **LOW-4** — NodePopover is mouse-only; `pointer-events: none` plus `role="tooltip"` means keyboard users see it but can't read links inside it. Acceptable today since the popover content is informational only — but if the popover gains interactive elements, switch to Radix Tooltip + Popover combo.
- **LOW-5** — `ProjectV1Redirect` / `ServiceV1Redirect` infinite-loop risk if anyone flips `/projects/:id` back to a redirect. Add a guard comment or cookie. Defensive.
- **NIT-1** — `useIsBelowMd` re-evaluates on every render in each consumer (3 callers today). Dedupe at a context level if the count grows.
- **NIT-2** — `SuccessSummary` fallback URL is a literal placeholder `https://${serviceName}.{sslip}.sslip.io`. Render an explicit "URL pending" message when `publicUrl` is null.
- **NIT-3** — Inline `oklch(...)` colors in LogViewer header instead of `var(--ol-*)` tokens. Intentional (LogViewer is dark-only by design) but worth a single comment explaining "LogViewer is dark-only — token vars are theme-aware so we hand-pick the dark values".

## Reviewer's positive observations

- **FSM modeling is precise**: two-axis `connState × viewState` separation maps 1:1 to GUIDE-04 §2. `phaseStatus` derivation cleanly handles the success "fill remaining phases" case.
- **Cleanup discipline excellent**: every useEffect with subscriptions/timers has a paired teardown — ResizeObserver in InfraMap, MediaQueryList in useMediaQuery, the timeouts Set + progressTimer in LogViewer, the forceConnState demo timers. Reviewer went looking for leaks and found none.
- **Tablist a11y right**: ProjectTabs does Home/End/Arrow correctly with focus management via requestAnimationFrame, proper aria-selected/aria-controls/tabIndex roving, TabPanel matching ids — common gotcha got correctly.
- **Spec compliance verified**: 10 error classes match GUIDE-05 §§2.1–2.10 exactly. v1.1+ classes excluded with comments.
- **SSR-safe hook design**: useMediaQuery reads initial state from useState initializer with typeof-window guard. First paint correct, no hydration jump.
- **Health vocabulary discipline**: ServiceHealth = 'healthy' | 'crashed' only per the v1.0 trim direction.

## Final recommendation

**APPROVE for commit** after the 4 inline fixes (HIGH-1, HIGH-2, MEDIUM-1, MEDIUM-2) which are all in this PR. The MEDIUM/LOW/NIT follow-ups are real but not blockers for PR2+PR3 merge — they belong in PR4.
