# RALPLAN — OpenLander v4 Design Migration

> **Mode:** ralplan consensus plan · DELIBERATE
> **Iteration:** 5 (single-SSE consolidation, user course correction)
> **Branch:** `feat/v4-design` (cut from `develop@db063a7`)
> **Source of truth:** `/tmp/ol-design-v4-backup/test/` (chat1.md + 15 jsx + styles.css)
> **Reference screens:** `/tmp/ol-design-v4-backup/test/project/screens/r3-*.png`
> **Carry-over (structural reuse):** PR1+PR2-3+PR4+PR6+PR7 (commit `962bf1d`) and PR8a/PR8b (`fc0fc06`, `6866c33`) on `origin/ui-redesign-1.0`
> **PR backup docs:** `/tmp/ol-autopilot-backup/` (PR1-PR8 acceptance criteria, contracts, test notes)
> **Phase 0/1 status:** SKIP — this is a consensus-gated plan; autopilot resumes at Phase 2.

This document is the steelmannable artefact for Architect → Critic review. The
headline question — *"how do we migrate `develop` to a v4-faithful UI without
re-introducing the rebase mess from the last sprint AND without ever cutting
visual fidelity to save time?"* — is resolved in the ADR at the bottom.

**Quality is the only gate.** There is no launch deadline. Every phase ships
when its Definition of Done passes — both functional correctness AND visual
parity against the v4 source. "Good enough for now" is not a state this plan
recognises.

**Iteration 2 changes (Architect-driven).** Backend lands first against the
existing PR8a hook URL contracts so UI consumes real endpoints rather than
mocks (eliminates the prior Phase F rework loop). The megacommit cherry-pick
is split into 4 logical commits to make hunk-review possible. Synthetic
metrics path is removed (Principle 4 strict reading). Visual regression
infrastructure is dropped in favour of verifier-agent screenshot review
against the 3 r3-* references. Vitest+zod replaces bash for contract tests.

**Iteration 3 changes (Critic-driven).** Three blockers and four
nice-to-haves applied: (1) Pre-mortem expanded from 3 → 6 scenarios
covering iteration-2 risk surfaces (backend-UI shape mismatch, megacommit
split build-standalone failure, dual-SSE drift over time); (2) Phase F
contract test infrastructure made concrete (`test:contract` script,
seed.sql fixture, type-zod parity assertion pattern, parallel
`*-zod.ts` files to keep zod out of prod bundle, GitHub Actions
workflow); (3) Principle 3 ↔ PageHeader contradiction resolved —
PageHeader.tsx is TRANSITIONAL through Phase A/B and DELETED in Phase C
once consumers migrate to AppShell-native chrome. Plus: concrete
`tools/qa/audit-tokens.mjs` script, full `ErrorClass` taxonomy enum
wired through Phase E_NEW backend → Phase C ErrorSurface → Phase F
contract test, `ProjectView.tsx` introduced with its FINAL name in
Commit A.2.4 (no later rename), Principle 5 reworded to acknowledge
re-derive-vs-cherry-pick is a judgment call.

**Iteration 5 changes (user course correction — single-SSE
consolidation).** The user observed that v4's UI/UX has zero consumers
of the project-keyed timeline SSE (`/api/projects/:id/build/stream`).
Verification confirmed: the only in-tree consumers (`web/src/hooks/
use-timeline.ts`, `web/src/components/project/OverviewTab.tsx`,
`web/src/components/deploy-terminal/DeployTerminalSession.tsx`, and
the V1 `ProjectDetail.tsx` page) are all already scheduled for
deletion in Phase A.2.1 / Phase B as part of the V1-shell takeover.
v4's `ActivityTimeline` is a cross-actor activity log with a different
data source (agent + human + webhook + system events), and LogViewer's
phase rail covers per-deploy progression visually. So ADR-1.1
("two coexisting SSE renderers") is OBSOLETE and is replaced with
**ADR-1.1 (revised): Single SSE renderer —
`/api/deployments/:id/log/stream`**. Phase E_NEW DELETES
`src/web/api/deploy-timeline-stream-routes.ts` and the route
registration call in `src/web/api/deploy-stream-routes.ts`. Phase B
DELETES `web/src/hooks/use-timeline.ts`,
`web/src/components/project/OverviewTab.tsx`,
`web/src/components/deploy-terminal/DeployTerminalSession.tsx`, and
`web/src/components/project/ProjectDetailTabs.tsx` (the V1 chain).
Pre-mortem Scenario 6 ("Dual SSE drift over time") is dropped.
Follow-ups #2 and #11 (the dual-SSE post-1.0 unification RFC and the
shape-parity CI gate) are removed — they are no longer applicable
with a single endpoint. The "shape parity rule between two SSE
endpoints" requirement is dropped from Phase E_NEW and Phase G DoD.
Every other iteration-4 commitment (16-key ErrorClass taxonomy,
backend-first ordering, megacommit split into A.2.1-A.2.4, PageHeader
deletion in Phase C, verifier visual review) stays unchanged.

**Iteration 4 changes (Architect-re-revised).** One blocker + one
non-blocker applied: (1) **ErrorClass taxonomy correction** — the
iteration-3 7-value coarse enum (`build_failed`, `deploy_timeout`, …,
`unknown`) is REPLACED with the **16-key narrative-specific taxonomy**
copied verbatim from `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`
(`CONFIG_MISSING`, `GIT_ACCESS_DENIED`, `BUILD_CONTEXT_MISMATCH`,
`IMAGE_WRONG_STAGE`, `DEPENDENCY_UNHEALTHY`, `DB_EXTENSION_MISSING`,
`PORT_CONFLICT`, `CLI_OVERRIDE_SYNTAX`, `RUNTIME_CRASH`,
`INFRA_UNAVAILABLE`, `OOM_KILLED`, `DOCKER_DAEMON_UNREACHABLE`,
`DISK_EXHAUSTED`, `NETWORK_DEPENDENCY_UNREACHABLE`,
`HEALTHCHECK_TIMEOUT`, `BUILD_TIMEOUT`). The 16-key taxonomy is now the
source of truth for both backend classification (new
`src/pipeline/error-classifier.ts`) and the v4 ErrorSurface registry
(`web/src/lib/errorClasses.ts`). Default is `RUNTIME_CRASH` (the v4
generic), not an invented `UNKNOWN`. Rationale captured in the ADR:
collapsing v4 narrative keys (e.g., merging `OOM_KILLED` +
`DISK_EXHAUSTED` + `DOCKER_DAEMON_UNREACHABLE` into one bucket) would
strip ErrorSurface of its per-key narrative title/blame/fix-hint and
fail Phase C visual parity. (2) **Audit-tokens script body sketch**
added (5 LOC pseudo-code) to Phase A so the executor doesn't ad-lib
regex. (3) **SSE shape-parity CI gate** added as Phase G follow-up #11
(GitHub Actions step diffing the two SSE files' field declarations) —
**REMOVED in iteration 5** along with the second SSE endpoint.
Pre-mortem Scenario 4 expanded to cover `errorClass` enum
exhaustiveness via zod.

---

## A. Principles (5)

1. **Visual parity is a merge gate, not a polish task.** Every page must
   match its v4 source (`/tmp/ol-design-v4-backup/test/project/*.jsx` and
   the `screens/r3-*.png` captures) before the phase containing it is
   declared done. We do not ship a v4-skeleton and "polish later."
2. **v4 tokens are exact.** v4 uses light mode by default, accent
   `oklch(0.62 0.16 152)` (green), foreground `oklch(0.16 0.005 250)`
   (chroma 0.005, monochrome). Every token value in `web/src/styles/tokens.css`
   must match the value in `/tmp/ol-design-v4-backup/test/project/styles.css`
   to the digit. No "close enough" approximations.
3. **Single shell, single source of truth.** No coexistence pattern. The
   AppShell from PR4 is the architecture; AppLayout dies in Phase B. There is
   exactly one Sidebar, one TopBar, one OuterCard, and one set of motion
   primitives. Indigo, the v2 dark mode default, and the legacy 4-card Home
   layout are deleted from the codebase, not hidden behind feature flags.
4. **Backend changes are real, not stubs.** Phase E_NEW ships DB-backed
   implementations of every new endpoint. No `meta.synthetic` flag, no
   "synthetic forever" path. When a service has no metrics history yet, the
   endpoint returns `204 No Content` and the UI shows an explicit empty
   state ("Metrics will appear after first deploy completes"). If a new
   field requires a column or table, the migration ships in the same phase.
5. **Re-derive vs cherry-pick is a judgment call, not a slogan.**
   Every commit lands on `feat/v4-design` and every PR targets `develop`.
   No rebases of long-lived branches. No cherry-picks across multiple bases.
   We re-derive when the source branch is divergent enough that cherry-pick
   conflicts dominate; we cherry-pick when the source commits are short,
   isolated, and the conflict surface is narrow. The 962bf1d cherry-pick is
   split into 4 reviewable commits to compensate for the megacommit's
   review-opacity. Principle violation occurs when we cherry-pick AND skip
   the bisect-friendly split. PR #59 on `origin/ui-redesign-1.0` is left
   alone per user direction; we carry its content forward by cherry-pick.

---

## B. Decision Drivers (top 3)

1. **Design fidelity to v4.** The mockups in `/tmp/ol-design-v4-backup/test/`
   are the spec. Drift between shipped UI and mockup is the primary failure
   mode this plan exists to prevent. Forces: per-page visual diff against
   `screens/r3-*.png`, token-value-exact migration, and a token-drift audit
   before any merge.
2. **Public API surface stability.** Five new backend endpoints become part
   of the 1.0 contract. SSE shape, response schemas, and error semantics are
   observable to MCP-consuming agents and to plugin developers. Forces:
   explicit contract docs in Phase E_NEW, contract tests pinning response
   shape (Vitest + zod, derived from UI types), backwards-compatible
   defaults, no "TBD" decisions on endpoint shape.
3. **Cross-stack contract drift.** UI hooks were authored against a
   speculative backend contract during the prior autopilot run; backend
   never delivered. Forces: backend lands FIRST in Phase E_NEW against the
   existing UI hook URL/shape (`web/src/hooks/use-*-stream.ts`,
   `web/src/lib/api/topology.ts`, `web/src/lib/api/notifications.ts`); UI
   phases B-D consume real endpoints, not mocks; contract tests in Phase F
   pin the shape so future drift produces a type error or a zod parse
   failure, not a silent runtime mismatch.

---

## C. Viable Options

### (a) Ship the visual layer fast, polish in a follow-up — **REJECTED**

**Premise.** Land the v4 chrome (tokens, AppShell, sidebar, top bar) and the
2-3 highest-traffic pages (Home, Projects, Service detail) at v4 fidelity,
then ship the rest of the pages under v4 chrome but at v2 internal layout,
and reconcile them in a 1.0.x patch later.

**Rejected because** it directly violates Principle 1. A "v4 chrome with v2
guts" build produces:

- Indigo ghosts on legacy pages (any hardcoded `oklch(0.55 0.18 255)`,
  `bg-blue-*`, or pre-redesign HSL token references).
- Spacing/typography drift inside legacy pages — v4 uses different gutters,
  different mono font weights, different card-edge styling than v2.
- A two-product feel when navigating between pages — marketing screenshots
  and customer screen-recordings would expose the inconsistency immediately.
- The "follow-up patch" tends to never get the same care as the initial
  pass; deferred polish becomes permanent debt.

This option is the speed-over-quality trade. The user has explicitly
rejected this trade. Recording it here for completeness only.

### (b) Re-implement from scratch using v4 source as direct port

**Premise.** Treat `/tmp/ol-design-v4-backup/` as the spec. Build every file
fresh on `feat/v4-design`, mapping JSX → TSX, mock data → real-data hooks,
window globals → React imports. No cherry-pick.

- **Pros:**
  - Every commit lands clean v4. No "v2 then v4" double-touch in history.
  - Forces an honest v4 review — no v2 baggage.
  - Acceptance criteria become "matches v4 mockup" not "matches v2 plus deltas".
- **Cons:**
  - Re-implements LogViewer 2-axis FSM (787 → 590 LOC, virtualization,
    ANSI parser), InfraMap react-flow + dagre, ProjectsContext singleton,
    auth-aware fetch wrapper, deploy SSE stream parser — each one a
    multi-day exercise the prior autopilot already completed and reviewed.
  - Triple-counts the test surface: structural correctness PLUS visual
    correctness PLUS contract correctness, all from zero.
  - Discards battle-tested decisions (FSM transitions hardened by code
    review, virtualization tuned for 5k+ line logs, dagre layout
    deterministic for fixed input). Re-deriving them risks regressions
    that the original review caught.

### (c) Hybrid — cherry-pick structural commits, then v4-port the visual layer in one pass

**Premise.** Cherry-pick `962bf1d` (the megacommit) for its structural
content (AppShell, LogViewer, InfraMap, ProjectsContext, hooks, route
code-split, auth-aware fetch), then in a single follow-up phase **rewrite
the visual layer to v4**: `tokens.css` replaced wholesale with values
copied from v4 `styles.css`, Home rewritten to match `home.jsx` exactly
(R3 hero + projects grid + activity peek), all new pages added (ServiceDetail
v4, ProjectView v4, plus modals, errors, infra strip, MCP server status).

- **Pros:**
  - Captures option (b)'s clean v4-only diff in the visual layer — the
    re-tokenization happens in the same commit that introduces the
    structural file, never as a follow-up.
  - Reuses ~5,000 LOC of already-reviewed structural work — LogViewer FSM,
    InfraMap react-flow, ProjectsContext singleton — without re-derivation
    risk.
  - Phase ordering matches the dependency graph (with iteration 2 reorder):
    backend-first → structural → tokens → pages → InfraMap/LogViewer
    re-tokenize → wiring → QA. Each phase has exactly one reviewer concern.
- **Cons:**
  - Cherry-pick lands ~5k LOC at once IF taken as one commit — iteration 2
    splits the megacommit into 4 logical commits to make hunk-review possible.
  - Requires discipline: every cherry-picked file gets opened and
    re-tokenized in Phase A even if the patch passes clean. We cannot
    leave any indigo or dark-mode token in the cherry-picked files.

### Choice: **(c) Hybrid.**

Option (a) is rejected on principle (speed-over-quality is off-the-table).
Option (b) is dominated by (c) in a no-deadline world *only if* we have
discipline to re-derive correctly — and the cherry-pick + visual-port
hybrid achieves the same end-state (clean v4 history, no v2 ghosts) at
lower regression risk. Option (c) wins because:

- The structural work (LogViewer FSM, InfraMap, ProjectsContext) was
  reviewed under PR1-PR8 and survived a Codex review pass. Re-deriving
  it from JSX pseudocode loses that review value.
- The visual layer rewrite in Phase C of option (c) is itself a from-scratch
  port — we get option (b)'s visual cleanliness on the user-facing surface.
- "Quality" is not "more typing." Quality is "correct v4, reviewed code."
  Option (c) delivers more reviewed code per phase than option (b) because
  it builds on already-reviewed structural foundations.

If during execution we discover the cherry-picked structural code has v2
assumptions baked in that re-tokenization can't surface (e.g., LogViewer
has a layout assumption that fights with v4's outer-card padding), we
retreat to option (b) for those specific files only — not as a project
default.

---

## D. Phase Breakdown

> **Quality gate.** Each phase ships when its Definition of Done passes in
> full — both functional correctness AND visual parity against the v4
> source. There are no time estimates. A phase is done when it is done.
> Verifier round-trips inside a phase are expected; we iterate until pass.

> **Phase order (iteration 2 reorder, Architect blocker #1):**
>
> ```
> A (Foundation) → E_NEW (Backend, was E) → B (Single-shell takeover)
>   → C (Page rewrites) → D (InfraMap+LogViewer re-tokenize)
>   → F (Cross-stack wiring + contract tests) → G (QA)
> ```
>
> Backend lands BEFORE the UI consumer phases (B-D) so those phases consume
> real endpoints rather than mocks. Phase F retains its name (renumbering
> would lose continuity with prior review history) but its dependency
> changes — it now wires UI hooks already pointing at live endpoints to
> drop the mock fallback path entirely.

### Phase A — Foundation (lint, v4 tokens, branch hygiene, megacommit split)

**Goal.** Make `feat/v4-design` ready for substantive work — lint passes
on the existing tree, v4 tokens land at exact values, and the branch picks
up the historical structural work via cherry-pick **split into 4 logical
commits** so reviewers can bisect and hunk-review.

**Files touched (frontend only):**

- `eslint.config.js` (root) — fix the react-hooks plugin loading; the
  PR1 description noted the plugin couldn't load. Verify with
  `npm run lint -- --max-warnings 0` from repo root after.
- `web/src/styles/tokens.css` — NEW. Direct port of v4 styles.css `:root`
  block (lines 10-73 of `/tmp/ol-design-v4-backup/test/project/styles.css`).
  **Token values must match the v4 file to the digit.** Light-mode default.
  Green accent `oklch(0.62 0.16 152)`. Foreground `oklch(0.16 0.005 250)`
  (chroma 0.005). Mono is JetBrains Mono / Geist Mono. No `--ol-*` prefix
  experiments — direct token names matching v4 (`--bg`, `--panel`,
  `--text`, `--muted`, `--border`, `--primary`, `--success`, `--warning`,
  `--error`, `--log-bg`, `--log-text`, etc.).
- `web/src/index.css` — `@import './styles/tokens.css';` at the top of
  the file, ABOVE the existing tailwind layer. Remove any pre-existing
  `:root` definitions that would shadow v4 tokens.
- `web/tailwind.config.js` — extend `theme.colors` with v4 token aliases
  so Tailwind utilities resolve to v4 tokens (e.g., `bg-panel`, `text-text`,
  `border-border`, `text-primary`). This propagates v4 palette to
  legacy pages that still use Tailwind utility classes — eliminates the
  "indigo ghost on legacy routes" failure mode at the source.

**Cherry-pick procedure (Architect blocker #2 — megacommit split):**

- **Step A.1 — Safe small commits.** Cherry-pick the two isolated commits:
  ```
  git cherry-pick fc0fc06  # PR8a — auth-aware fetch + stream useMemo
  git cherry-pick 6866c33  # PR8b — code-split + ProjectsGrid context
  ```
  Each lands as one commit. Verify build between them:
  `cd web && npm run typecheck && npm run build`.

- **Step A.2 — Megacommit split.** Cherry-pick `962bf1d` with no-commit:
  ```
  git cherry-pick -n 962bf1d
  ```
  Then split the resulting working-tree change into **4 logical commits**.
  Each commit must build standalone (verify with `cd web && npm run build`
  between commits). If a commit doesn't build because deps are split
  across commits, adjust the split — but no single commit may exceed
  ~3000 LOC.

  **Build-per-commit recovery procedure (Critic blocker #1, Scenario 5
  mitigation).** If `git rebase --exec 'cd web && npm run build' <base>`
  fails on commit A.2.N, the executor moves the failing imports' source
  files into the failing commit and re-amends. **The 4-commit split is a
  target, not a constraint** — if a clean split requires 5 commits (or 6),
  ship 5/6. The hard rule is: every commit on the branch must build
  standalone, even if that means breaking the original 4-way logical
  grouping. Bisect-friendliness is the durable property; the 4-way label
  is the convenience.

  - **Commit A.2.1 — Shell takeover.**
    Adds: `web/src/components/Shell/AppShell.tsx`,
    `web/src/components/Shell/Sidebar.tsx`,
    `web/src/components/Shell/TopBar.tsx`.
    Deletes: `web/src/components/layout/AppLayout.tsx`,
    `web/src/components/layout/Header.tsx`,
    `web/src/components/layout/Sidebar.tsx` (legacy),
    `web/src/components/layout/__tests__/Header.test.tsx`,
    `web/src/components/layout/ActivityPulse.tsx`,
    `web/src/components/layout/NotificationCenter.tsx`,
    `web/src/components/layout/ThemeSelector.tsx`,
    `web/src/components/layout/DeployDialog.tsx`,
    `web/src/components/layout/ShareDialog.tsx`,
    `web/src/pages/ProjectDetail.tsx` (V1),
    `web/src/pages/ServiceDetail.tsx` (V1).
    Modifies: `web/src/App.tsx` route table (every authed route nests under
    AppShell).

  - **Commit A.2.2 — LogViewer.**
    Adds: `web/src/components/Shell/LogViewer.tsx` (FSM + virtualization),
    `web/src/components/Shell/LogViewerHeader.tsx`,
    `web/src/components/Shell/LogViewerSummaryCards.tsx`,
    `web/src/components/Shell/LogViewer.css`,
    `web/src/lib/logRows.ts`,
    `web/src/lib/__tests__/logRows.test.ts` (if present),
    Phase rail component if applicable.

  - **Commit A.2.3 — InfraMap.**
    Adds: `web/src/components/Shell/InfraMap.tsx` (react-flow + dagre),
    `web/src/components/Shell/InfraMapNode.tsx`,
    `web/src/components/Shell/InfraMap.css`,
    `web/src/lib/projectTopology.ts`,
    `web/src/hooks/use-project-topology.ts`.

  - **Commit A.2.4 — Pages + hooks + contexts (residual).**
    Adds: `web/src/pages/Home.tsx`,
    `web/src/pages/Activity.tsx`,
    `web/src/pages/MCPServer.tsx`,
    `web/src/pages/ProjectView.tsx` (Critic nice-to-have N3 — landed with
    its FINAL name in this commit, not introduced as `ProjectViewV2.tsx`
    and renamed in Phase C. Cherry-pick may bring `ProjectViewV2` from
    the megacommit; resolve during the A.2.4 commit-split by renaming
    during the commit (`git mv ProjectViewV2.tsx ProjectView.tsx`) and
    updating import sites in the same commit so this commit is bisect-
    friendly. Phase C drops the rename step; just rewrites the file
    content in-place.),
    `web/src/pages/ServiceDetailV2.tsx`,
    `web/src/pages/settings/*` (settings sub-tree from cherry-pick),
    `web/src/contexts/ProjectsContext.tsx`,
    `web/src/hooks/use-projects-context.ts`,
    `web/src/hooks/use-deploy-log-stream.ts`,
    `web/src/hooks/use-mock-log-stream.ts`,
    `web/src/lib/agentActivity.ts`,
    `web/src/lib/brand.ts`,
    `web/src/i18n/PATCH-V4-FOUNDATION.md` (proposed i18n keys for the new
    pages, per the i18n shared-file rule),
    plus any remaining `web/src/lib/*` utilities required to compile.

**Conflict-resolution matrix (resolve against develop's recent UI commits —
PageHeader unification, SettingsPage sub-nav, OpsCenterV2 vertical sub-nav,
RecoveryTab empty states):**

| File / module                          | Source     | Reason                                                                                                                     |
| -------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `OpsCenterV2.tsx`                      | develop    | Post-megacommit improvements (vertical sub-nav)                                                                            |
| `SettingsPage.tsx`                     | develop    | Post-megacommit sub-nav                                                                                                    |
| `DeploymentsList.tsx`                  | develop    | Post-megacommit improvements                                                                                               |
| `RecoveryTab` (empty states)           | develop    | Post-megacommit empty-state work                                                                                           |
| `web/src/components/layout/PageHeader.tsx` | **develop (TRANSITIONAL — kept through Phase A/B, deleted in Phase C)** | **(Architect quality #8 + Critic blocker #3)** Introduced on develop in `dd45766`; consumed by OpsCenterV2/SettingsPage/DeploymentsList which we keep from develop. The cherry-picked AppShell does not provide an equivalent — consumers will fail to import otherwise during A/B. Keep PageHeader as the chrome wrapper through Phase B; Phase C migrates every consumer to AppShell-native chrome and deletes `PageHeader.tsx`. After Phase C, Principle 3 ("single shell, single source of truth") is true at the file level — no two shell wrappers coexist. |
| `App.tsx`                              | megacommit | Megacommit-defined route table is the new chrome                                                                           |
| `Shell/AppShell.tsx`, `Shell/*`        | megacommit | These are the new chrome                                                                                                   |
| `LogViewer.tsx`, `InfraMap.tsx`        | megacommit | Reviewed structural work                                                                                                   |
| `ProjectsContext`, `useProjects*`      | megacommit | PR7 singleton                                                                                                              |
| `index.css`                            | megacommit | Token import + chrome reset                                                                                                |

**i18n note:** `web/src/i18n/en.ts`, `web/src/i18n/ko.ts` — DO NOT EDIT
(i18n shared file rule). Capture every key needed by the cherry-pick into
`web/src/i18n/PATCH-V4-FOUNDATION.md` for the user to manually merge.

**Definition of Done (functional + visual):**

- `npm run lint -- --max-warnings 0` exits 0 from repo root.
- `cd web && npm run typecheck` exits 0.
- `cd web && npm run build` exits 0.
- `git log feat/v4-design --oneline` shows: cherry-picks A.1 (fc0fc06,
  6866c33) at the bottom, then 4 split commits (A.2.1 → A.2.4), then
  foundation commit on top. Each commit builds standalone (`git rebase --exec
  'cd web && npm run build' <base>` passes for every commit in the chain).
- Token-drift audit: `grep -rn "oklch(0\.55 0\.18 255)\|#5b6bff\|hsl(228" web/src/`
  returns ZERO hits.
- **Token-presence audit (Critic nice-to-have N1 + Architect Issue 2 —
  concrete script with body sketch).**
  Run `node tools/qa/audit-tokens.mjs` and confirm exit code 0.
  - New file: `tools/qa/audit-tokens.mjs` (~30 LOC). Parses both
    `web/src/styles/tokens.css` and
    `/tmp/ol-design-v4-backup/test/project/styles.css` `:root { ... }`
    blocks via regex, emits a sorted diff of declared variable NAMES
    (not values — value diffs are intentional where v4 is the source
    of truth and we may keep a v2 hex for an ANSI palette etc.).
  - **Body sketch (5 LOC, executor may diverge if cleaner — guidance
    not lock-in):**
    ```js
    import fs from 'node:fs';
    const tokens = (path) => Array.from(fs.readFileSync(path, 'utf8').matchAll(/--[\w-]+(?=:)/g)).map(m => m[0]);
    const v4Tokens = tokens('/tmp/ol-design-v4-backup/test/project/styles.css');
    const ourTokens = tokens('web/src/styles/tokens.css');
    const missing = v4Tokens.filter(t => !ourTokens.includes(t));
    if (missing.length) { console.error('Missing v4 tokens:', missing); process.exit(1); }
    ```
  - Variable-name parity is the gate: the explicit list of tokens
    present in v4 but missing from `web/src/styles/tokens.css` MUST
    BE EMPTY. Tokens present in `web/src/styles/tokens.css` but not
    in v4 are allowed (we may have additional tokens for ANSI, log
    palette, etc.) but get logged so reviewers can confirm intent.
  - Exit non-zero if any v4-token is missing from `tokens.css`.
- `web/src/components/layout/PageHeader.tsx` is present and importable
  (consumers OpsCenterV2/SettingsPage/DeploymentsList build clean).
- Manual: `npm run dev`, hit `/`, the app loads (it may render with legacy
  layout — that's Phase B's job to remove); the page background is the v4
  light cream `oklch(0.985 0.005 250)`, NOT the v2 indigo dark.

**Visual parity proof.** None at this phase (no v4 page is rendered yet).
Token presence is the proof. Phase B is the first visual-parity phase.

**Dependencies.** None.

---

### Phase E_NEW — Backend endpoints (5 missing routes, real DB-backed implementations)

> **Iteration 2 reorder (Architect blocker #1):** This phase moved from
> after Phase D to immediately after Phase A. Backend lands first against
> the existing PR8a-era hook URL contracts so the UI phases B-D consume
> real endpoints, not mocks. Eliminates the prior Phase F rework loop where
> UI was first wired to mocks and then re-wired to real endpoints.

**Goal.** Ship the 5 missing backend endpoints with the shape the shipped
UI hooks already expect, using real persistence (no stubs, no synthetic
flag — Principle 4 strict reading per Architect quality #6). Single backend
pass with a contract document and contract tests defined in Phase F.

**SSE shape decision (iteration-5 single-SSE consolidation — replaces
iteration-2/3/4 dual-SSE):**

> See **ADR-1.1 (revised): Single SSE renderer** under Section G for
> the full rationale. Summary: ship the deployment-keyed log stream
> `GET /api/deployments/:id/log/stream` with the line-event shape
> `{ phase, prefix, payload }` + terminal `{ type:'end', outcome,
> errorClass? }` as the **only** SSE channel. The legacy project-keyed
> `/api/projects/:id/build/stream` (timeline events) and its host file
> `src/web/api/deploy-timeline-stream-routes.ts` are DELETED in this
> phase. v4 has zero consumers for project-keyed timeline events
> (verified: `web/src/hooks/use-timeline.ts`,
> `web/src/components/project/OverviewTab.tsx`, and
> `web/src/components/deploy-terminal/DeployTerminalSession.tsx` are
> all V1-only and are themselves deleted in Phase B). The LogViewer
> phase rail (`web/src/components/Shell/LogViewer.tsx` FSM) covers
> per-deploy progression visually; v4's `ActivityTimeline` is a
> separate cross-actor activity log on a different data source.

**ErrorClass taxonomy (Architect iteration-4 blocker — 16-key
narrative-specific union, source: v4 `errors.jsx`):**

The terminal `event: end` payload's optional `errorClass` field is
typed as a union of **16 string-literal SCREAMING_SNAKE keys** copied
verbatim from `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`:

```ts
export type ErrorClass =
  | 'CONFIG_MISSING'
  | 'GIT_ACCESS_DENIED'
  | 'BUILD_CONTEXT_MISMATCH'
  | 'IMAGE_WRONG_STAGE'
  | 'DEPENDENCY_UNHEALTHY'
  | 'DB_EXTENSION_MISSING'
  | 'PORT_CONFLICT'
  | 'CLI_OVERRIDE_SYNTAX'
  | 'RUNTIME_CRASH'
  | 'INFRA_UNAVAILABLE'
  | 'OOM_KILLED'
  | 'DOCKER_DAEMON_UNREACHABLE'
  | 'DISK_EXHAUSTED'
  | 'NETWORK_DEPENDENCY_UNREACHABLE'
  | 'HEALTHCHECK_TIMEOUT'
  | 'BUILD_TIMEOUT';
```

This single union is the source of truth for both backend
classification AND v4 ErrorSurface registry rendering. The type
declaration lives in a shared module that both surfaces import:
`web/src/lib/errorClasses.ts` (UI side, exports the registry data
from v4 `errors.jsx` plus the union type) and is mirrored as a
backend-local type in `src/pipeline/error-classifier.ts` (backend
cannot import from `web/`; the union is duplicated and Phase F's
contract test pins them into agreement via zod).

**Why 16, not a coarser bucket.** v4's ErrorSurface renders a
distinct title / blame-tag / explanation / suggested-action for each
key (e.g., `OOM_KILLED` → "`worker` was killed by the kernel —
exceeded its 256MB memory limit" with raise-limits-or-page-batch fix
hint; `DISK_EXHAUSTED` → "Build failed — host is out of disk" with
`docker system prune -af` hint; `DOCKER_DAEMON_UNREACHABLE` →
"Docker daemon stopped responding mid-deploy" with restart-docker
hint). Collapsing them into a coarser `infra_failed` or `unknown`
bucket strips ErrorSurface of the per-key narrative it exists to
provide and fails Phase C's visual parity gate. See ADR section G
for the full rationale.

**Backend classifier function (Architect iteration-4 blocker):**

- ADD: `src/pipeline/error-classifier.ts` exporting
  `classifyDeployError(err: unknown): ErrorClass`. The function is a
  rule-based mapper from observable error signal to one of the 16
  keys. Indicative classification map (executor extends as new
  signals surface; the rule set is data, not contract):

  | Observable signal                                                 | ErrorClass                       |
  | ----------------------------------------------------------------- | -------------------------------- |
  | Docker container exit reason `OOMKilled` / `exitCode === 137`     | `OOM_KILLED`                     |
  | Bind error `EADDRINUSE` / port-already-in-use during container_start | `PORT_CONFLICT`               |
  | git clone HTTP 401/403/404 / SSH `Permission denied (publickey)`  | `GIT_ACCESS_DENIED`              |
  | Compose `depends_on` healthcheck never succeeded within window    | `DEPENDENCY_UNHEALTHY`           |
  | Postgres `ERROR: extension "X" is not available`                  | `DB_EXTENSION_MISSING`           |
  | Docker socket `connect: connection refused` mid-deploy            | `DOCKER_DAEMON_UNREACHABLE`      |
  | Disk write fails with `ENOSPC` / `df` shows >95% used             | `DISK_EXHAUSTED`                 |
  | Image pull fails with registry timeout / DNS / `i/o timeout`      | `NETWORK_DEPENDENCY_UNREACHABLE` |
  | Healthcheck endpoint returns non-200 past `start_period + retries`| `HEALTHCHECK_TIMEOUT`            |
  | Build step exceeds configured build timeout                       | `BUILD_TIMEOUT`                  |
  | Dockerfile `COPY` references missing path / build context mismatch | `BUILD_CONTEXT_MISMATCH`        |
  | Multi-stage `target:` resolves to non-final stage at run          | `IMAGE_WRONG_STAGE`              |
  | Required env var unset detected by build (Prisma, etc.)           | `CONFIG_MISSING`                 |
  | Custom command parse failure / `docker docker compose ...`        | `CLI_OVERRIDE_SYNTAX`            |
  | Agent unreachable from console                                    | `INFRA_UNAVAILABLE`              |
  | **Default (no rule matched)**                                     | **`RUNTIME_CRASH`**              |

- The default is `RUNTIME_CRASH` (v4's most generic "something
  crashed" key — see `errors.jsx` line 96: "`worker` has crashed 12×
  in the last 24 hours"). We do NOT introduce an `UNKNOWN` key — v4
  doesn't have one and inventing one would force ErrorSurface to
  ad-lib copy for an unknown bucket, defeating the per-key narrative
  premise.

- The deploy orchestrator's catch block calls
  `classifyDeployError(err)` and emits the result on the SSE terminal
  `event: end` payload's `errorClass` field. The classifier is unit-
  tested per row in the table above (backend vitest); Phase F's
  contract test asserts the SSE terminal event's `errorClass`, when
  present, parses against a zod enum of all 16 values
  (exhaustiveness gate).

**Files touched (backend only):**

- ADD: `src/web/api/deploy-log-stream-routes.ts` — the **only** deploy
  SSE endpoint going forward. Reads from the existing log source
  (previously read by the now-deleted timeline stream). Accepts `:id`
  as `deploymentId`. Emits line events with `event: line`,
  `id: <line-num>`, and a terminal `event: end` carrying
  `outcome: 'success'|'fail'|'cancelled'` and optional `errorClass`. Honours
  `Last-Event-ID` header for resume (the UI hook captures `lastEventId`;
  wire the resume path even if the client doesn't trigger it yet — the
  contract is set). Note: any log-source helpers previously colocated
  inside `deploy-timeline-stream-routes.ts` (line-emission utilities,
  log tail readers, log-source resolver) MUST be moved into
  `deploy-log-stream-routes.ts` or a sibling
  `src/web/api/deploy-log-source.ts` BEFORE the timeline route file is
  deleted, so this endpoint stays self-contained.
- DELETE: `src/web/api/deploy-timeline-stream-routes.ts` — the entire
  file. Contains the legacy project-keyed
  `/api/projects/:id/build/stream` route plus the now-orphaned
  timeline-event emitter. v4 has zero consumers (verified —
  `web/src/hooks/use-timeline.ts`, `OverviewTab.tsx`,
  `DeployTerminalSession.tsx` are all V1-only and themselves deleted
  in Phase B). After deletion, the file does not exist.
- MODIFY: `src/web/api/deploy-stream-routes.ts` — REMOVE the
  `import { registerDeployTimelineStreamRoutes } from
  './deploy-timeline-stream-routes.js'` (currently line 17) and the
  corresponding `registerDeployTimelineStreamRoutes(api, ctx)` call
  (currently line 375). Add the import + registration call for the
  new `registerDeployLogStreamRoutes` from
  `./deploy-log-stream-routes.js` in the same place.
- MODIFY: `src/web/api/system-routes.ts`:
  - ADD `GET /api/services/:id/health` returning
    `{ health: 'healthy'|'crashed'|'running' }`. Reads from the same source
    `/api/services/:id/stats` reads, projects onto the 3-state vocabulary.
  - ADD `GET /api/services/:id/metrics?range=15m|1h|6h|24h|7d` returning
    `ServiceMetrics` (cpu/memory/requestsPerSec/errorRate arrays +
    `p95LatencyMs` + `totalRequests`). **Real DB-backed implementation**:
    if the existing `service_stats` table doesn't carry time-series
    granularity at the requested ranges, ship a schema migration in this
    phase that adds `service_metrics(service_id, recorded_at, cpu, mem, req, err)`
    and a recorder hook in the existing stats collection path.
    **No `meta.synthetic` flag (Principle 4 strict).** When a service has
    no metrics history yet (first-deploy in flight, no recorder samples
    persisted), the endpoint returns **`204 No Content`**. The UI hook
    distinguishes 204 from 200-with-empty-arrays and renders an explicit
    empty state ("Metrics will appear after first deploy completes").
    Rationale: Principle 4 forbids stubs; an empty-state UI is honest, a
    `synthetic: true` payload is a stub.
- MODIFY: `src/web/api/project-routes.ts`:
  - ADD `GET /api/projects/:id/topology` returning
    `{ services: ServiceNode[] }` where each `ServiceNode` is
    `{ id, name, kind, image, health, port, url, cpu, mem, dependsOn[] }`.
    Reuses `getProjectServices()`, joins each service's `dependsOn` from
    the compose definition (already parsed; surface it). If `dependsOn` is
    NOT actually parsed by the compose loader, ship the loader change in
    this phase — do not return an empty array as a stand-in.
- ADD: `src/web/api/notifications-routes.ts`:
  - `GET /api/settings/notifications/webhook` returning `{ url, events[] }` or 404.
  - `POST /api/settings/notifications/webhook` accepting `{ url, events[] }`.
  - `DELETE /api/settings/notifications/webhook`.
  - Persist to the `settings` table in the existing sqlite. Single row keyed
    on `'notification_webhook'`. No multi-webhook support in this phase
    (the UI manages one); a multi-webhook follow-up is captured.
- MODIFY: `src/web/api/routes.ts` — register the new route modules.
- ADD: `src/web/api/CONTRACTS.md` — single doc capturing the shape of every
  endpoint added in this phase with a one-line note: *"matches the shape
  of `web/src/lib/api/topology.ts`, `web/src/hooks/use-service-metrics.ts`,
  `web/src/hooks/use-deploy-log-stream.ts` etc. — UI types are the source
  of truth. Phase F's Vitest+zod contract tests pin this."*
- ADD: schema migration file under the existing migrations directory if
  any new column or table is introduced. Migration must be reversible.

**Definition of Done (functional):**

- `cd src && npm run lint -- --max-warnings 0` exits 0 (root strictTypeChecked tier).
- `cd src && npm run typecheck` exits 0.
- `cd src && npm test` passes.
- Migration applies cleanly on a fresh sqlite and a sqlite with existing data.
- `curl http://localhost:3000/api/services/<id>/health` returns
  `{"health":"healthy"}` (or matching state) for a real service.
- `curl http://localhost:3000/api/projects/<id>/topology | jq '.services[0].dependsOn'`
  returns an array (possibly empty), not undefined.
- `curl -i http://localhost:3000/api/services/<id-no-history>/metrics` returns
  HTTP 204 (verifies no-synthetic path).
- `curl -i http://localhost:3000/api/services/<id-with-history>/metrics`
  returns HTTP 200 with arrays populated.
- `curl -N http://localhost:3000/api/deployments/<id>/log/stream` emits
  SSE lines with `event: line\ndata: {"phase":...,"prefix":...,"payload":...}\n\n`
  and a terminal `event: end\ndata: {"type":"end","outcome":"success"}\n\n`.
- `curl http://localhost:3000/api/settings/notifications/webhook` returns
  404 on first call; 200 with the saved object after a POST; 404 again
  after a DELETE.
- `src/web/api/CONTRACTS.md` lists all 5 endpoint shapes.
- Soak: existing `tools/qa/soak-test.sh` extended (or a sibling script
  added) to exercise the new endpoints for a 1h window without 5xx — full
  24h soak runs in Phase G.
- **Single-SSE consolidation gate (iteration 5).** After the timeline
  route deletion and `deploy-stream-routes.ts` re-import lands, run
  `grep -rn "build/stream\|deploy-timeline-stream-routes\|registerDeployTimelineStreamRoutes" src/`
  — MUST return ZERO hits. The file
  `src/web/api/deploy-timeline-stream-routes.ts` MUST NOT exist
  (`test ! -f src/web/api/deploy-timeline-stream-routes.ts` exits 0).
  `cd src && npm run typecheck` MUST exit 0 after deletion (catches
  any leftover importer).
- **Shape smoke gate (Critic blocker #1, Scenario 4 mitigation —
  blocks Phase B start).** Before Phase B begins, run
  `tools/qa/smoke-endpoint-shapes.sh` (added in this phase) which hits
  each new endpoint with a seeded fixture and `JSON.stringify`s the
  response. Manually diff the field names against the corresponding UI
  type's known fields:
  - `ServiceHealth` (`web/src/lib/api/services.ts` or similar)
  - `ServiceMetrics` (200 path: cpu/memory/requestsPerSec/errorRate
    arrays + `p95LatencyMs` + `totalRequests`; 204 path: empty body)
  - `ServiceNode` (`web/src/lib/api/topology.ts`: id/name/kind/image/
    health/port/url/cpu/mem/dependsOn[])
  - Deploy log SSE event union (`DeployLineEvent` `{phase,prefix,payload}`
    + `DeployEndEvent` `{type:'end',outcome,errorClass?}`) — the
    **single** SSE shape going forward (iteration 5).
  - `NotificationWebhookConfig` (`{url,events[]}`)
  Any field-name divergence (camelCase vs snake_case, plural vs singular,
  ratio vs percent typed differently) BLOCKS Phase B start. Field-name
  parity is the gate; value semantics are validated by Phase F's
  Vitest+zod tests.

**Dependencies.** Phase A only (needs the branch + lint clean — does NOT
need any UI from B-D). Backend-first sequencing.

---

### Phase B — Single-shell takeover (legacy AppLayout dies)

> **Iteration 2 note:** Most of the deletes in this phase were already
> performed inside Commit A.2.1 (Shell takeover). Phase B becomes the
> verification + smoke test that the takeover holds across every authed
> route, plus PageHeader retention check.

**Goal.** AppShell is the only shell. Confirm legacy AppLayout, legacy
Header, legacy Sidebar, ProjectDetail (v1), ServiceDetail (v1) are
absent. Every authenticated page renders under v4 chrome.

**Files touched (frontend only):**

- VERIFY (already done in Commit A.2.1, re-assert here):
  `web/src/components/layout/AppLayout.tsx`,
  `web/src/components/layout/Header.tsx`,
  `web/src/components/layout/Sidebar.tsx` (legacy),
  `web/src/components/layout/__tests__/Header.test.tsx`,
  `web/src/components/layout/ActivityPulse.tsx`,
  `web/src/components/layout/NotificationCenter.tsx`,
  `web/src/components/layout/ThemeSelector.tsx`,
  `web/src/components/layout/DeployDialog.tsx`,
  `web/src/components/layout/ShareDialog.tsx`,
  `web/src/pages/ProjectDetail.tsx` (V1),
  `web/src/pages/ServiceDetail.tsx` (V1) — all absent.
- DELETE (iteration 5 single-SSE consolidation — V1 timeline chain):
  `web/src/hooks/use-timeline.ts`,
  `web/src/components/project/OverviewTab.tsx`,
  `web/src/components/project/ProjectDetailTabs.tsx`,
  `web/src/components/deploy-terminal/DeployTerminalSession.tsx`,
  and the entire `web/src/components/deploy-terminal/` directory if it
  is empty after `DeployTerminalSession.tsx` is removed (verify with
  `ls web/src/components/deploy-terminal/` post-delete; if any files
  remain, leave the directory). Verify importers via grep BEFORE
  deletion: `grep -rn "use-timeline\|useTimeline\|OverviewTab\|ProjectDetailTabs\|DeployTerminalSession" web/src/`
  — every match must trace back to V1 `ProjectDetail.tsx` (already
  deleted in A.2.1) or to one of the four files in this delete list.
  Any import from a v4 file (Home / ProjectView / Activity / MCP /
  ServiceDetail V2 / Shell/*) blocks the deletion and surfaces as a
  Phase B blocker for re-routing.
- KEEP (TRANSITIONAL): `web/src/components/layout/PageHeader.tsx` (from
  develop, per Phase A's conflict matrix, Architect quality #8). Confirm
  OpsCenterV2 / SettingsPage / DeploymentsList still import it cleanly.
  **This file is deleted in Phase C** once those consumers migrate to
  AppShell-native chrome (Critic blocker #3 — Principle 3 hold-true gate).
- MODIFY (if needed): `web/src/App.tsx` — every authenticated route nests
  under `<AppShell>`, default redirect points to `/home` (not `/overview`).
- VERIFY: `web/src/components/Shell/AppShell.tsx` (from cherry-pick) wraps
  with `<ProjectsProvider>` (PR7 already does this; verify).

**Definition of Done (functional + visual):**

- `grep -rn "from.*layout/AppLayout\|from.*layout/Header\|from.*layout/Sidebar" web/src/` returns ZERO hits.
- `grep -rn "from.*layout/PageHeader" web/src/` returns >= 1 hit
  (PageHeader still has importers from develop-side pages — transitional
  state, removed in Phase C per Critic blocker #3).
- **Single-SSE consolidation (iteration 5).**
  `grep -rn "build/stream\|use-timeline\|useTimeline\|DeployTerminalSession\|OverviewTab\|ProjectDetailTabs" web/src/`
  returns ZERO hits. The four V1 files
  (`web/src/hooks/use-timeline.ts`,
  `web/src/components/project/OverviewTab.tsx`,
  `web/src/components/project/ProjectDetailTabs.tsx`,
  `web/src/components/deploy-terminal/DeployTerminalSession.tsx`) are
  absent.
- `npm run typecheck` exits 0.
- `npm run lint -- --max-warnings 0` exits 0.
- `npm run build` exits 0.
- Manual smoke: `npm run dev`, hit `/`, get redirected to `/home`,
  navigate sidebar to `/projects`, `/activity`, `/mcp`, `/operations`,
  `/settings`. All render under v4 chrome (no flash of legacy header).
- Network panel: only ONE `/api/projects` request per polling cycle
  (validates `useProjectsContext()` migration is in place across consumers).

**Visual parity proof.** Open `/home` against
`/tmp/ol-design-v4-backup/test/project/screens/r3-home.png` — outer
chrome (sidebar width, top bar height, outer card radius and inset,
sidebar item spacing) must match. The page interior may still show
legacy content; that's Phase C. Chrome must be v4-exact.

**Dependencies.** Phase A (cherry-pick must be in), Phase E_NEW (backend
endpoints must be live so smoke navigation doesn't 404 on
/projects/:id, /services/:id once Phase C wires them).

---

### Phase C — Page rewrites to v4 (Home + Activity + Projects + MCP + Service detail + Project view + modals + errors)

**Goal.** Every visible page matches its v4 source mockup exactly. The 11
v4 pages — Home, Activity, Projects list, Projects empty, Projects new,
Confirm-deploy modal, Service detail tabs (General · Environment · Domains
· Deployments · Logs · Monitoring · Advanced), Log viewer success, Log
viewer fail, Error surfaces, MCP server — all render at visual parity
against their `screens/r3-*.png` captures.

**Files touched (frontend only):**

- REWRITE: `web/src/pages/Home.tsx` — match v4 `home.jsx` exactly:
  - Hero status (one-sentence rollup + last-deploy row).
  - Projects grid with service-dot list per project.
  - Activity peek (top 5).
  - Drop the legacy 4-card layout entirely (Principle 1).
- ADD: `web/src/pages/Activity.tsx` (cherry-pick should land this; v4-align
  the visual treatment — actor tags as mono labels not circles, bot icon
  ONLY on `actor==="mcp"`, FilterPills for Actor + Project, bucket headers
  Just now / Earlier today / Yesterday).
- REWRITE: `web/src/pages/ProjectsGrid.tsx` — match v4 `projects.jsx`:
  - Single-column list (not grid) with project icon + status pill.
  - Controls row: filter input + Tags + Newest first.
  - Empty state: "You don't have any projects yet" with v4-exact copy.
- ADD: `web/src/pages/MCPServer.tsx` (from cherry-pick) — verify v4 visuals:
  4 status tiles, connected agents list, recent calls.
- REWRITE: `web/src/pages/ServiceDetail.tsx` (V2 from cherry-pick) — match
  v4 `service.jsx`:
  - Tablist with keyboard nav (Left/Right/Home/End).
  - Tabs: General · Environment · Domains · Deployments · Logs · Monitoring
    · Advanced.
  - Monitoring 2x2 sparklines (CPU / Memory / Requests / Errors). When the
    metrics endpoint returns 204 (no history), render the empty state
    "Metrics will appear after first deploy completes" — NOT a synthetic
    chart (Principle 4, Architect quality #6).
  - DeployRow with TriggerChip.
- REWRITE: `web/src/pages/ProjectView.tsx` (already landed with its FINAL
  name in Commit A.2.4 per Critic nice-to-have N3 — no rename in this
  phase, just rewrite the file content in-place to match v4
  `service.jsx`'s `ProjectOverview`): services as tap-rows, deployments
  tab, environment tab, settings tab.
- ADD: `web/src/components/Shell/NewProjectModal.tsx` from v4 `modals.jsx`
  — accessible dialog (focus trap, ESC to close, `role="dialog"`,
  `aria-labelledby`, `aria-describedby`), validation for repo URL +
  project slug.
- ADD: `web/src/components/Shell/ConfirmDeployModal.tsx` from v4 `modals.jsx`
  — same accessibility primitives.
- ADD: `web/src/components/Shell/ErrorSurface.tsx` from v4 `errors.jsx`
  ERROR_CLASSES registry — wires to `LogViewer`'s `errorClass` prop.
  **ErrorClass 16-key taxonomy (Architect iteration-4 blocker — replaces
  iteration-3 7-value coarse enum).** The component imports the
  16-key registry from `web/src/lib/errorClasses.ts`, which is a 1:1
  port of `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`'s
  `ERROR_CLASSES` const. Each registry entry carries the v4 data
  fields: `title` (one-line summary), `phase` (build / clone /
  healthcheck_wait / container_start / container_create / image_pull
  / —), `step` (build step number or —), `target` (service / host /
  image label), `fixHint` (2-3 sentence actionable suggestion), and
  `codeRefs` (array of `{path, line, snippet}` for inline code
  pointers). The 16 keys (verbatim from v4):
  ```ts
  export type ErrorClass =
    | 'CONFIG_MISSING'
    | 'GIT_ACCESS_DENIED'
    | 'BUILD_CONTEXT_MISMATCH'
    | 'IMAGE_WRONG_STAGE'
    | 'DEPENDENCY_UNHEALTHY'
    | 'DB_EXTENSION_MISSING'
    | 'PORT_CONFLICT'
    | 'CLI_OVERRIDE_SYNTAX'
    | 'RUNTIME_CRASH'
    | 'INFRA_UNAVAILABLE'
    | 'OOM_KILLED'
    | 'DOCKER_DAEMON_UNREACHABLE'
    | 'DISK_EXHAUSTED'
    | 'NETWORK_DEPENDENCY_UNREACHABLE'
    | 'HEALTHCHECK_TIMEOUT'
    | 'BUILD_TIMEOUT';
  ```
  **Verify the existing PR1-PR8 cherry-pick state:**
  `grep -n ERROR_CLASSES /tmp/ol-autopilot-backup/spec.md` and inspect
  the current `web/src/lib/errorClasses.ts` on `feat/v4-design`. If
  PR1-PR8 already shipped this file with 10 keys (the original v1.0
  set without the v1.1 additions `OOM_KILLED`,
  `DOCKER_DAEMON_UNREACHABLE`, `DISK_EXHAUSTED`,
  `NETWORK_DEPENDENCY_UNREACHABLE`, `HEALTHCHECK_TIMEOUT`,
  `BUILD_TIMEOUT`), expand to all 16 in this phase by copying the
  missing entries from v4 `errors.jsx` lines 114-174. If the file
  doesn't exist yet, create it from v4 `errors.jsx` lines 12-178
  in one shot.

  **Per-key rendering contract.** ErrorSurface keys on `errorClass`
  and renders:
  - **Title** — one line, from registry `title`.
  - **Blame chip** — color-coded short tag derived from the registry
    entry's semantics: `your-config` (CONFIG_MISSING,
    BUILD_CONTEXT_MISMATCH, IMAGE_WRONG_STAGE, PORT_CONFLICT,
    CLI_OVERRIDE_SYNTAX, DB_EXTENSION_MISSING, GIT_ACCESS_DENIED) /
    `external` (NETWORK_DEPENDENCY_UNREACHABLE,
    DOCKER_DAEMON_UNREACHABLE, INFRA_UNAVAILABLE, DISK_EXHAUSTED) /
    `our-bug` (RUNTIME_CRASH, OOM_KILLED, DEPENDENCY_UNHEALTHY,
    HEALTHCHECK_TIMEOUT, BUILD_TIMEOUT). Color tokens follow v4's
    accent vocabulary: `your-config` → warning, `external` → muted,
    `our-bug` → error.
  - **Explanation** — 2-3 sentences derived from registry `phase` +
    `step` + `target` (e.g., "Failed during build step 8/12 on
    service \"api\"").
  - **Suggested action** — one actionable button or link surfaced
    from registry `fixHint`. Code refs render below as inline
    `path:line` chips per registry `codeRefs`.

  Source of truth: `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`
  ERROR_CLASSES registry. Match v4's data field names exactly so the
  migration is a near-mechanical port. Backend derivation: Phase
  E_NEW's `classifyDeployError` (in `src/pipeline/error-classifier.ts`)
  maps thrown errors → one of the 16 keys and emits it on the SSE
  terminal `event: end` payload's `errorClass` field. Default key is
  `RUNTIME_CRASH` (v4's generic "something crashed"), not an invented
  `UNKNOWN`. ErrorSurface keys on `errorClass` to look up the
  registry entry.
- DELETE: `web/src/pages/Overview.tsx` (replaced by Home).
- VISUAL RECONCILE (in this phase, not deferred): `OpsCenterV2.tsx`,
  `SettingsPage.tsx`, `DeploymentsList.tsx`, `ServicesPage.tsx`,
  `NewProjectFlow.tsx`, `DeploymentDetail.tsx` — these are not in v4
  mockups, but they must render under v4 chrome with v4 tokens (no
  hardcoded HSL, no `bg-blue-*`, no v2 spacing). Audit each one and
  re-token any palette divergence. If a page has structural divergence
  from v4 design language (e.g., uses cards where v4 uses tap-rows), file
  a "Visual reconciliation" item in `web/src/i18n/PATCH-V4-PAGES.md`'s
  open-questions section and resolve before Phase G — never after.
- **PAGEHEADER MIGRATION + DELETION (Critic blocker #3 — Principle 3
  hold-true gate).** Migrate `OpsCenterV2`, `SettingsPage`,
  `DeploymentsList`, `ServicesPage`, `NewProjectFlow`, `DeploymentDetail`
  to AppShell-native chrome: drop the `<PageHeader>` wrapper, use
  AppShell's TopBar slot for breadcrumbs/title (per AppShell's existing
  contract from the cherry-pick). Each page's title and breadcrumb path
  is hoisted into a `useTopBar({title, breadcrumb})` call (or whatever
  hook AppShell exposes — if AppShell does not yet expose a TopBar slot
  hook, add one in this phase). Then DELETE
  `web/src/components/layout/PageHeader.tsx` and verify zero importers
  via `grep -rn "from.*layout/PageHeader" web/src/` returning ZERO hits
  before Phase D starts. Phase C's DoD adds an explicit
  "PageHeader is deleted, importers = 0" assertion. Result: after Phase
  C, Principle 3 ("single shell, single source of truth") is true —
  AppShell is the only shell wrapper, no PageHeader coexistence.

**Definition of Done (functional + visual):**

- `/home` renders the v4 hero: status sentence, last-deploy row, projects
  grid, activity peek. No 4-card layout. Bot icon appears only on `mcp`
  events.
- `/projects` renders single-column list (not grid).
- `/services/:id` renders 7 tabs with keyboard arrow navigation; the
  Monitoring tab shows 2x2 sparklines OR the explicit "Metrics will appear
  after first deploy completes" empty state when the backend returns 204.
- `/activity` renders with FilterPills (Actor + Project) and bucket
  headers.
- `/mcp` renders 4 status tiles + connected agents.
- `/operations`, `/settings`, `/deployments` render under v4 chrome with
  v4 tokens (Audit: `grep -rn "bg-blue-\|text-indigo-\|bg-\\[#" web/src/pages/` returns ZERO hits).
- **PageHeader deleted (Critic blocker #3).**
  `web/src/components/layout/PageHeader.tsx` no longer exists.
  `grep -rn "from.*layout/PageHeader\|PageHeader" web/src/` returns ZERO
  hits in source files (test fixtures excluded). `OpsCenterV2`,
  `SettingsPage`, `DeploymentsList`, `ServicesPage`, `NewProjectFlow`,
  `DeploymentDetail` all build clean against AppShell's TopBar slot.
  Principle 3 holds-true at file level.
- ErrorClass enum present in shared types (Critic nice-to-have N2);
  `ErrorSurface.tsx` consumes it.
- `npm run typecheck`, `npm run lint -- --max-warnings 0`, `npm run build`
  all green.
- `web/src/i18n/PATCH-V4-PAGES.md` exists with proposed keys for the new pages.

**Verifier gate (Architect quality #5).** Spawn a `verifier` agent with:
- v4 references: `/tmp/ol-design-v4-backup/test/project/screens/r3-home.png`,
  `/tmp/ol-design-v4-backup/test/project/screens/r3-activity.png`,
  `/tmp/ol-design-v4-backup/test/project/screens/r3-hero.png` for the 3 hero
  pages (Home / Activity / hero variant).
- For pages without an r3-* mockup (Projects list, Service detail, Project
  view, MCP, modals, errors, OpsCenterV2, SettingsPage, DeploymentsList,
  ServicesPage, NewProjectFlow, DeploymentDetail): the v4 source files
  (`/tmp/ol-design-v4-backup/test/project/*.jsx` rendered into
  `/tmp/ol-design-v4-backup/test/project/openlander.html`) plus the
  structural-alignment criterion (token usage from `tokens.css`, v4
  component patterns — tap-rows, mono labels, accent restraint, sidebar/
  top-bar consistency — no v2 leftover layouts).
- The current code (live screenshots at 1440 viewport).

Verifier returns **APPROVE** or **ITERATE** with specific deltas (e.g.,
"sidebar item spacing 12px observed vs 16px in reference"). On ITERATE,
fix the deltas and re-spawn the verifier until APPROVE. Self-judgment
("looks good to me") does not satisfy this gate.

**Visual parity proof.** Verifier APPROVE verdict (above) IS the proof.
No `pixelmatch` / `odiff` infrastructure (Architect quality #7 — only 3
r3-* PNGs exist; tooling overhead is disproportionate to benefit).
Side-by-side captures the verifier examined are saved to
`.omc/plans/v4-deviations.md` along with any documented deviations and
their rationale (e.g., "data-driven content, structural parity verified").

**Dependencies.** Phase B (single shell), Phase E_NEW (backend endpoints —
Service detail's Monitoring tab needs the 204/200 distinction live).

---

### Phase D — InfraMap + LogViewer alignment to v4

**Goal.** The two structural components from the cherry-pick get fully
re-tokenized to v4 visuals: no indigo, monochrome rails, restrained
animations. Both honor `prefers-reduced-motion`.

**Files touched (frontend only):**

- MODIFY: `web/src/components/Shell/InfraMap.tsx` — edges use `var(--border)`
  not indigo; node ring uses `var(--success)` for healthy, `var(--error)`
  for crashed. Drop the 26px disk + kind glyph per chat1.md tail decision
  (use 8px status pip + mono service name — Linear inline-status style).
  Verify dagre layout determinism with a snapshot test (Phase F adds the
  contract test; this phase asserts the layout result is unchanged for a
  fixed input).
- MODIFY: `web/src/components/Shell/InfraMap.css` — token swap. Verify
  `prefers-reduced-motion` block disables transitions on edges and pulses.
- MODIFY: `web/src/components/Shell/LogViewer.tsx` — log palette uses
  `--log-bg`, `--log-text`, `--log-error`, `--log-success` from tokens.css.
  ANSI palette: `--log-cyan`, `--log-magenta`, etc.
- MODIFY: `web/src/components/Shell/LogViewer.css` — same token swap.
  `prefers-reduced-motion` disables auto-scroll smoothing and the cursor
  blink.
- MODIFY: `web/src/components/Shell/LogViewerHeader.tsx`,
  `web/src/components/Shell/LogViewerSummaryCards.tsx` — token swap.
- VERIFY: Animation system. v4 motion primitives are restrained — no easing
  longer than 200ms, no spring physics, opacity + transform only. Audit
  every `transition:` declaration in Shell components and remove any
  v2-era flourish (e.g., colour transitions, shadow pulses). Document the
  motion grammar inline in `web/src/components/Shell/motion.md` for future
  maintainers.

**Definition of Done (functional + visual):**

- `grep -rn "oklch(0\.55 0\.18 255)\|#5b6bff\|indigo" web/src/components/Shell/`
  returns ZERO hits.
- `grep -rn "var(--primary)\|var(--success)\|var(--error)" web/src/components/Shell/`
  confirms token coverage.
- Manual: `/services/:id?project=...` deploy overlay shows green primary
  button, monochrome chrome, no indigo accents anywhere.
- `prefers-reduced-motion: reduce` honoured: enable in DevTools and confirm
  InfraMap edges, LogViewer auto-scroll, and any pulse/spinner stop animating.

**Visual parity proof.** Compare InfraMap and LogViewer at full size to the
inline references in v4 source files (`infra.jsx`, `logs.jsx`, the relevant
sections of `service.jsx`). The Phase G verifier gate runs the structured
review across these two components.

**Dependencies.** Phase A (tokens), Phase C (consumers stable so token
swap doesn't cascade rework), Phase E_NEW (LogViewer SSE consumer hits the
real `/api/deployments/:id/log/stream`).

---

### Phase F — Cross-stack wiring + contract tests (drop mocks, pin shapes via Vitest+zod)

> **Iteration 2 note:** With backend now landed in Phase E_NEW before the UI
> phases, "wiring" is mostly verifying that hooks already point at real
> endpoints and that `mockMode` defaults are flipped off. The test
> infrastructure shifts from bash to Vitest + zod (Architect quality #4).

**Goal.** UI hooks consume the live endpoints from Phase E_NEW (no mock
fallback in the default path). Contract tests pin every response shape so
backend cannot drift from the UI's TS types without a Vitest type error or
zod parse failure.

**Files touched (frontend + tests):**

- MODIFY: `web/src/hooks/use-project-topology.ts` — verify it polls the new
  endpoint and that any `isMockFallback` boolean defaults to false on first
  success.
- MODIFY: `web/src/hooks/use-service-health.ts` — verify polling cadence
  (10s healthy / 3s crashed) matches backend rate-limit tolerance.
- MODIFY: `web/src/hooks/use-service-metrics.ts` — handle 204 No Content
  by surfacing an `isEmpty: true` flag (NOT `isSyntheticMetrics` — Principle
  4 strict, no synthetic path). MonitoringTab renders the empty state when
  `isEmpty` is true.
- MODIFY: `web/src/hooks/use-deploy-log-stream.ts` — verify EventSource
  opens against `/api/deployments/:id/log/stream`. This is now the
  **only** deploy SSE endpoint (iteration 5 single-SSE consolidation —
  the project-keyed `/api/projects/:id/build/stream` is deleted in
  Phase E_NEW; ADR-1.1 revised).
- MODIFY: `web/src/components/deploy-terminal/*` AND
  `web/src/components/Shell/LogViewer.tsx` — drop `mockMode={true}` on the
  deploy-overlay LogViewer call. SSE is real; the simulator is fallback only.
- MODIFY: `web/src/pages/settings/Notifications.tsx` (or whatever Settings
  tab handles notifications) — wire POST + DELETE buttons to real
  endpoints, drop the silent-404 fallback.
- MODIFY: `web/src/lib/api/notifications.ts` — wire DELETE.

**Contract tests (Architect quality #4 + Critic blocker #2 — concrete
infrastructure spec):**

Add to `web/package.json` devDependencies: `vitest`, `zod` (justified by
gate value — drift between backend response and UI type becomes a typed
parse failure, not a silent runtime mismatch).

**Required `web/package.json` script edits (Critic blocker #2):**

```json
"scripts": {
  "pretest:contract": "node tools/qa/start-test-backend.mjs",
  "test:contract": "vitest run --config vitest.contract.config.ts",
  "posttest:contract": "node tools/qa/stop-test-backend.mjs"
}
```

**Test backend lifecycle scripts (Critic blocker #2):**

- ADD: `tools/qa/start-test-backend.mjs` — boots the backend with a
  seeded sqlite at `/tmp/ol-contract-test.db`, exports
  `OPENLANDER_DB_PATH=/tmp/ol-contract-test.db` so the backend uses it,
  loads the seed fixture (see below), waits for `/api/health` to return
  HTTP 200 (poll with timeout), then writes the chosen port to
  `.test-backend-port` so vitest picks it up.
- ADD: `tools/qa/stop-test-backend.mjs` — reads the PID written by the
  start script, SIGTERMs the backend, removes
  `/tmp/ol-contract-test.db` and `.test-backend-port`.

**Seed fixture (Critic blocker #2):**

- Path: `web/tests/contract/fixtures/seed.sql` (chosen over `.json`
  because the backend uses sqlite and direct SQL is the lowest-friction
  load path; the start script runs `sqlite3 /tmp/ol-contract-test.db <
  web/tests/contract/fixtures/seed.sql`).
- Contents minimum (matches the v4 hotdeal-tracker example from the
  source design):
  - 1 project (`hotdeal-tracker` or similar).
  - 3 services attached to the project: 1 web/app service, 1 db
    service, 1 worker service. Each with `image`, `port`, `dependsOn`
    populated where applicable so topology returns a non-trivial graph.
  - 1 completed deploy with full log lines, terminal `outcome:
    'success'` event recorded.
  - 1 currently-running deploy (no terminal event yet, used by the
    SSE test).
  - NO stored notification webhook (so the GET 404 path is testable;
    the test then POSTs and re-GETs).
  - NO stored metrics history for at least one service (so the 204
    path is testable); enough metrics history for at least one other
    service (so the 200-with-arrays path is testable).

**Type → zod-schema parity assertion (Critic blocker #2 — required
pattern in EACH contract test):**

```ts
import { z } from 'zod';
import { ServiceHealthSchema } from '../../src/lib/api/services-zod';
import type { ServiceHealth } from '../../src/lib/api/services';

type _Parity = z.infer<typeof ServiceHealthSchema> extends ServiceHealth
  ? ServiceHealth extends z.infer<typeof ServiceHealthSchema> ? true : never
  : never;
const _check: _Parity = true; // compile-time fail if drift
```

The zod schemas live in **a parallel file** (`web/src/lib/api/*-zod.ts`)
NOT in the same file as the type. This keeps zod out of the production
bundle (UI types are bundled; zod schemas are test-only). Bundle audit
in Phase G verifies zod doesn't end up in the prod chunk
(`grep -rn 'zod' web/dist/assets/ | grep -v 'sourcemap'` returns zero).

**CI integration (Critic blocker #2):**

- ADD: `.github/workflows/contract-tests.yml`
  - Triggers: `on: [pull_request, push]` with `branches: [develop]`
  - Job: `cd web && npm install && npm run test:contract`
  - Job times out at 10 minutes; the start-script timeout for backend
    boot is 30 seconds.
  - The full YAML body may be deferred to a follow-up PR — the
    workflow's existence and trigger conditions ARE specified here as
    a contract test infrastructure dependency.

The 5 test files (one per missing endpoint):

- ADD: `web/tests/contract/topology.test.ts` — imports `ServiceNode` from
  `web/src/lib/api/topology.ts`, derives a zod schema from the type (or
  authors the schema parallel to the type with a compile-time assertion
  that `z.infer<typeof ServiceNodeSchema>` equals `ServiceNode`), fetches
  `/api/projects/:id/topology` from the running dev server, parses the
  response with `ServiceNodeSchema.array()`. Drift = parse failure.
- ADD: `web/tests/contract/health.test.ts` — same approach for
  `/api/services/:id/health` (`ServiceHealth` type).
- ADD: `web/tests/contract/metrics.test.ts` — same for
  `/api/services/:id/metrics` (`ServiceMetrics` type). Asserts both the
  200 path (with-history fixture) and the 204 path (no-history fixture).
- ADD: `web/tests/contract/deploy-log-sse.test.ts` — opens the SSE
  channel against a seeded deploy, consumes events, asserts the FIRST
  non-end event parses against the `DeployLineEvent` zod schema and the
  terminal event parses against the `DeployEndEvent` schema.
  **ErrorClass round-trip (Architect iteration-4 blocker — 16-key
  exhaustiveness).** Define the zod enum schema in
  `web/src/lib/api/services-zod.ts` (or a sibling `errorClasses-zod.ts`):
  ```ts
  export const ErrorClassSchema = z.enum([
    'CONFIG_MISSING', 'GIT_ACCESS_DENIED', 'BUILD_CONTEXT_MISMATCH',
    'IMAGE_WRONG_STAGE', 'DEPENDENCY_UNHEALTHY', 'DB_EXTENSION_MISSING',
    'PORT_CONFLICT', 'CLI_OVERRIDE_SYNTAX', 'RUNTIME_CRASH',
    'INFRA_UNAVAILABLE', 'OOM_KILLED', 'DOCKER_DAEMON_UNREACHABLE',
    'DISK_EXHAUSTED', 'NETWORK_DEPENDENCY_UNREACHABLE',
    'HEALTHCHECK_TIMEOUT', 'BUILD_TIMEOUT',
  ]);
  ```
  Pair the schema with the type-zod parity assertion (per Phase F's
  required pattern) so `z.infer<typeof ErrorClassSchema>` is provably
  equal to `ErrorClass` at compile time. The test asserts:
  (a) when the seeded fixture replays a deploy that hits each of the
  16 classifier rules, the SSE terminal event's `errorClass`
  round-trips through `ErrorClassSchema.parse(...)` to the expected
  key; (b) emitting any value not in the 16-key set causes
  `DeployEndEventSchema.parse` to throw — no free-form strings allowed
  on the wire. The exhaustiveness gate combined with the contract
  test guarantees no silent enum expansion (or contraction) slips
  through.
- ADD: `web/tests/contract/notifications-webhook.test.ts` — POST → GET
  roundtrip, DELETE, GET 404. Parses the GET body against the
  `NotificationWebhookConfig` zod schema.

**Definition of Done (functional + visual):**

- Manual: `/projects/<real-project>` shows InfraMap with no "Sample data"
  chip on the eyebrow.
- Manual: deploy a real project; LogViewer shows actual line events
  streaming from SSE, not mock simulation.
- Manual: Settings → Notifications, save webhook URL, reload page — the
  URL persists; DELETE clears it.
- `grep -rn "mockMode\s*=\s*{?true" web/src/` returns ZERO hits OR
  documented justified hits (e.g., print-page only).
- `npm run typecheck`, `npm run lint -- --max-warnings 0`, `npm run build`
  all green.
- All 5 Vitest contract tests run green via `cd web && npm run test:contract`
  (which auto-boots a seeded backend via `pretest:contract` and tears it
  down via `posttest:contract`). Force a contract drift (locally rename a
  backend field in test only) and confirm the corresponding test fails
  with a zod parse error.
- `.github/workflows/contract-tests.yml` exists and triggers on PR open
  + push to develop (Critic blocker #2 — CI integration).
- Bundle audit: `grep -rn 'zod' web/dist/assets/ 2>/dev/null | grep -v 'sourcemap'`
  returns ZERO hits (Critic blocker #2 — zod stays test-only).

**Dependencies.** Phase E_NEW (backend live), Phase D (UI consumers stable).

---

### Phase G — QA + accessibility + token-drift audit + verifier visual review (NON-OPTIONAL)

**Goal.** Quality pass before any merge to `develop`. Three independent
audits run, each gating the merge:

1. **Accessibility audit.** Focus order, ARIA, keyboard nav,
   `prefers-reduced-motion`, contrast.
2. **Token-drift audit.** No hardcoded oklch/hex/HSL bypassing tokens.
3. **Verifier visual review.** Manual screenshot capture compared against
   `screens/r3-*.png` for the 3 hero pages and structural review for the
   rest, executed by a `verifier` agent (Architect quality #5 + #7 — no
   `pixelmatch`/`odiff` infrastructure).

**Files touched (frontend + tests + docs):**

- AUDIT (accessibility):
  - Tab through every page: focus order is logical (sidebar → top bar →
    main content → secondary actions). Document any deviation.
  - ARIA: every `<dialog>` has `role="dialog"`, `aria-modal="true"`,
    `aria-labelledby`. Every tablist uses `role="tablist"` + `role="tab"`
    + `aria-selected`. Every status pip has `aria-label="status: <state>"`.
  - Keyboard nav: ESC closes modals; arrow keys navigate tablists; Enter
    activates focused buttons; no keyboard trap on any modal or popover.
  - `prefers-reduced-motion: reduce` verified across InfraMap, LogViewer,
    sparklines, sidebar collapse, top-bar transitions, page transitions.
  - Contrast: every `--text` on `--bg` and `--text` on `--panel` pair
    passes WCAG AA (4.5:1 for normal text, 3:1 for large). v4 monochrome
    palette should pass by construction; verify with a contrast checker.
- AUDIT (token drift):
  - `grep -rEn "oklch\([0-9]" web/src/` — every match must be either in
    `web/src/styles/tokens.css` or behind a `var(--*)` reference. Zero
    hardcoded oklch literals outside tokens.css.
  - `grep -rEn "#[0-9a-fA-F]{3,8}\b" web/src/` — every match must be in
    a comment, an SVG `fill`/`stroke` that intentionally targets a brand
    asset, or behind a token. Audit each survivor and convert or document.
  - `grep -rEn "\bhsl\(" web/src/` — same check.
  - `grep -rEn "bg-blue-|text-indigo-|border-purple-" web/src/` — ZERO hits.
- VERIFIER VISUAL REVIEW (Architect quality #5 + #7):
  - Spawn a `verifier` agent with the same brief as Phase C's gate, but
    extended to every page in the application:
    - Hero v4 references (1440 viewport): `/tmp/ol-design-v4-backup/test/project/screens/r3-home.png`,
      `/tmp/ol-design-v4-backup/test/project/screens/r3-activity.png`,
      `/tmp/ol-design-v4-backup/test/project/screens/r3-hero.png`.
    - Other pages: rendered output from
      `/tmp/ol-design-v4-backup/test/project/openlander.html` plus the
      structural-alignment criterion (token usage, v4 component patterns,
      no v2 leftovers).
    - Live captures at 1440 viewport for every page (Home, Activity,
      Projects list, Projects empty, Projects new, Confirm-deploy modal,
      Service detail × 7 tabs, Log viewer success, Log viewer fail, Error
      surfaces, MCP, OpsCenterV2, SettingsPage, DeploymentsList,
      ServicesPage, NewProjectFlow, DeploymentDetail, ProjectView).
  - Verifier returns APPROVE or ITERATE per page. ITERATE deltas get
    fixed; verifier re-spawns until every page is APPROVE.
  - Documented deviations (data-driven content, intentional layout
    decisions) get an entry in `.omc/plans/v4-deviations.md` with the
    rationale ("e.g., 'data-driven content, structural parity verified'").
  - Side-by-side capture artefacts get saved alongside the deviations doc.
- ADD: `web/src/i18n/PATCH-V4-CONSOLIDATED.md` — one merged patch with
  every key added across Phases A-F. User merges manually into
  `web/src/i18n/{en,ko}.ts` per the i18n shared-file rule.
- MODIFY: `README.md` — update screenshot reference to v4 hero;
  green-accent screenshot replaces indigo.
- ADD: `docs/RELEASE-NOTES-v4-design.md` — short note documenting the v4
  design migration: light/green palette, R3 hero, 5 new backend endpoints,
  SSE log stream is the **only** canonical channel (per ADR-1.1
  revised, the legacy project-keyed timeline stream
  `/api/projects/:id/build/stream` is REMOVED in this sprint —
  consumers must use deployment-keyed
  `/api/deployments/:id/log/stream`). Flag this prominently for any
  external ops/observability dashboards that may have been built
  against the old endpoint.
- VERIFY: `tools/qa/soak-test.sh` (modified file in working tree) — ensure
  the test still passes against the new endpoints. Extend coverage to
  `/api/services/:id/health`, `/api/services/:id/metrics`,
  `/api/projects/:id/topology` so the soak set exercises the new contract.
  Run for 24h in a staging env.
- ADD: `.omc/plans/v4-deviations.md` — the verifier's accumulated
  side-by-side captures and any rationale for documented deviations from
  the v4 source.

**Definition of Done (functional + visual + accessibility):**

- 12-page click-through (cover + 11 v4 pages) completes without console error.
- Accessibility audit checklist (focus order, ARIA, keyboard nav,
  reduced-motion, contrast) — every line ticked.
- Token-drift audit — every grep returns ZERO unexpected hits or every
  survivor is documented with rationale.
- Verifier visual review — every page returns APPROVE; the
  `.omc/plans/v4-deviations.md` artefact documents any approved
  deviations with rationale.
- i18n PATCH file lists every new key with EN+KO copy.
- README screenshot is v4-green.
- `npm run lint -- --max-warnings 0`, `npm run typecheck`, `npm run build`
  all green from both `web/` and repo root.
- 24h soak test runs without 5xx against the new endpoints.
- **Single-SSE consolidation re-assert (iteration 5).** At Phase G
  time, run `grep -rn "build/stream\|deploy-timeline-stream-routes" src/ web/src/`
  — MUST return ZERO hits. The legacy project-keyed timeline endpoint
  and its host file are gone repo-wide. Release notes
  (`docs/RELEASE-NOTES-v4-design.md`) document the removal so any
  external consumers can migrate to `/api/deployments/:id/log/stream`.

**Visual parity proof.** Verifier APPROVE across every page IS the proof
(self-judgment by the executor does not count — Architect quality #5).
The `.omc/plans/v4-deviations.md` artefact at the end of Phase G is the
durable record of v4 fidelity per page.

**Dependencies.** Phase F.

---

## E. Pre-mortem (5 scenarios — design fidelity + iteration-2 risk surfaces; iteration 5 dropped Scenario 6 with single-SSE consolidation)

### Scenario 1: Token drift produces an indigo ghost on legacy pages

**What ships broken.** Phase A's tokens.css and tailwind alias updates
land cleanly, but a handful of legacy pages (`OpsCenterV2.tsx`,
`SettingsPage.tsx`, `DeploymentsList.tsx`) use hardcoded literals — a
`bg-blue-500` here, a `text-indigo-600` there, a `style={{ color: '#5b6bff' }}`
in some inline annotation. Phase C's reconciliation pass misses one of
them. Customer screen-recording shows v4 green primary on /home, indigo
button on /operations: a two-product feel.

**Mitigation.**

- Phase A's tailwind config aliases `theme.colors.primary` to
  `var(--primary)`, so utilities resolve to v4 tokens automatically — most
  legacy hits adopt v4 palette by construction.
- Phase C explicitly audits every legacy page for hardcoded literals (not
  just running tailwind classes).
- Phase G's token-drift audit greps for hardcoded oklch / hex / HSL / named
  blue/indigo/purple utilities and fails the merge gate on any survivor
  without documented rationale.
- Phase G's verifier visual review captures every page (v4 reference or
  not) and surfaces palette inconsistency by eye.

### Scenario 2: Pages render with v4 chrome but v2 layouts inside (copy-paste fidelity miss)

**What ships broken.** Phase C rewrites Home, Projects, ServiceDetail,
ProjectView to v4 layouts. But ProjectView's "Deployments" tab is
implemented by reusing the existing `DeploymentsList` page as a child
component. `DeploymentsList` was never in v4 mockups; it has v2 spacing,
v2 card edges, v2 typography weights. The chrome wraps it in v4, but the
tab content reads as a v2 page.

**Mitigation.**

- Phase C's "Visual reconcile" sub-task explicitly covers every page that
  is NOT in v4 mockups: it gets brought into v4 design language even
  without a 1:1 reference. The tap-row / mono-label / accent-restraint
  vocabulary from chat1.md applies.
- Phase C's verifier gate (Architect quality #5) runs against pages
  without an r3-* mockup using the structural-alignment criterion. Pages
  without a v4 reference are reviewed against v4 design language, not
  given a free pass.
- Phase G's verifier visual review is exhaustive (every page, not just
  v4 hero pages).
- The phase ordering forbids "ProjectView Deployments tab punted to 1.0.x".
  If reconciliation reveals more work than expected, Phase C is not done;
  it iterates.

### Scenario 3: Animation system half-finished — some surfaces v4-restrained, some still v2-flourish

**What ships broken.** Phase D re-tokenizes InfraMap and LogViewer animation
palettes but doesn't audit other v4 components (sidebar transitions,
sparkline draw-in, modal entry/exit, tab switch transitions). The v4
mockup uses 200ms ease-out opacity + transform with no spring; the
cherry-picked code retained a v2 spring physics on modal entry. The result
is a jarring "this modal feels like a different product" moment.

**Mitigation.**

- Phase D's "Animation system" sub-task audits EVERY `transition:`
  declaration in Shell components, not just the two files explicitly
  named.
- Phase D writes `web/src/components/Shell/motion.md` documenting the v4
  motion grammar (200ms max, opacity + transform only, no spring physics).
- Phase G's accessibility audit verifies `prefers-reduced-motion` across
  every animated surface — a side effect is that any hidden animation
  (modal spring, sparkline draw-in) gets surfaced because the audit is
  exhaustive.
- Phase G's verifier captures the entry / mid / settled frames of animated
  surfaces so a visually wrong animation is caught in the structured
  review.

### Scenario 4: Backend-UI shape mismatch caught only at Phase F

**What ships broken.** Phase E_NEW lands the 5 backend endpoints against
what the implementer believes the UI types specify. Phase B begins
consuming those endpoints. By the time Phase F's Vitest+zod contract
tests run (after C and D), a field-name divergence is discovered
(`requestsPerSec` vs `reqPerSec`, `errorRate` typed as percent vs ratio,
`dependsOn` returning string IDs vs `{id,name}` objects, SSE `errorClass`
emitted as `error_class` or as a free-form string `"oom"` instead of
the canonical `OOM_KILLED`). Phase F has to choose between rewriting
hooks across B/C/D pages or patching backend serialization, and either
path re-opens phases that were already closed. Days of rework before
merge. **`errorClass`-specific failure mode (Architect iteration-4
blocker):** the backend classifier emits a key not in the 16-key v4
taxonomy (e.g., `"oom"`, `"docker-down"`, `"unknown"`), ErrorSurface's
registry lookup falls through to a default-case render with no copy,
and Phase C's verifier flags every error scenario as a missing-narrative
parity failure.

**Mitigation.**

- Phase E_NEW DoD bullet (added in iteration 3): "Before Phase B starts,
  run a smoke fetch from a temporary script (`tools/qa/smoke-endpoint-shapes.sh`
  or similar) that hits each new endpoint and JSON-stringifies the
  response. Manually diff against the corresponding UI type's known fields
  (ServiceHealth, ServiceMetrics, ServiceNode, deploy log SSE event union,
  NotificationWebhookConfig). Any field-name divergence blocks Phase B
  start." This catches the mismatch at the seam, not 4 phases later.
- Phase F's Vitest+zod contract tests pin the shape so future drift is a
  parse failure, but the smoke fetch is the front-loaded gate.
- `src/web/api/CONTRACTS.md` lists every endpoint shape against the UI
  type's fields by name, providing a single document to diff against.
- **`errorClass` enum exhaustiveness (Architect iteration-4 blocker —
  added in iteration 4).** The backend classifier (`classifyDeployError`
  in `src/pipeline/error-classifier.ts`) MUST emit one of the 16 known
  values, never a free-form string. Phase F's `deploy-log-sse.test.ts`
  asserts exhaustiveness via the `ErrorClassSchema` zod enum: any wire
  value outside the 16-key set throws on `DeployEndEventSchema.parse`.
  The classifier is unit-tested per rule (one test per row of the
  classification map in Phase E_NEW); the contract test is the
  end-to-end exhaustiveness gate. Default to `RUNTIME_CRASH` when no
  rule matches — never invent a new key without expanding the v4
  registry FIRST and updating the zod enum in the same commit.

### Scenario 5: Megacommit split commit doesn't build standalone

**What ships broken.** Phase A's Step A.2 cherry-picks `962bf1d` with
`-n` and splits into 4 commits (A.2.1 Shell takeover, A.2.2 LogViewer,
A.2.3 InfraMap, A.2.4 Pages+hooks+contexts). The split is logical but
LogViewer (A.2.2) imports a util from `web/src/lib/agentActivity.ts`
that ends up in A.2.4 — A.2.2 fails `npm run build` standalone. The
`git rebase --exec 'cd web && npm run build' <base>` gate catches it,
but the executor wastes time hand-rebalancing the split to chase a
"clean 4-way logical grouping" target.

**Mitigation.**

- Phase A explicit recovery procedure (added in iteration 3): "If
  `git rebase --exec 'cd web && npm run build' <base>` fails on commit
  A.2.N, the executor moves the failing imports' source files into the
  failing commit and re-amends. The 4-commit split is a target, not a
  constraint — if a clean split requires 5 commits (or 6), ship 5/6.
  The hard rule is: every commit on the branch must build standalone,
  even if that means breaking the original 4-way logical grouping."
- The build-per-commit gate stays as the hard guarantee; the 4-way
  split is downgraded from "constraint" to "target."
- Bisect-friendliness is preserved either way (every commit builds);
  reviewer-friendliness degrades slightly with 5/6 commits but the
  alternative — a non-building intermediate — is worse.

### Scenario 6: ~~Dual SSE drift over time~~ — DROPPED in iteration 5

**Status.** REMOVED. The dual-SSE design is gone (iteration 5 single-
SSE consolidation per user course correction). Only one SSE endpoint
exists going forward: `/api/deployments/:id/log/stream`. There is no
second contract to drift against. The shape-parity rule and the
quarterly drift audit (former follow-up #10) are deleted along with
the second endpoint.

---

## F. Test plan

### Unit tests

| Phase  | What's testable                                                      | Suite                                                          |
| ------ | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| A      | tokens.css imports cleanly, tailwind aliases resolve                 | build success + a small vitest that asserts `getComputedStyle(document.body).backgroundColor` matches `--bg` |
| A      | Each split commit (A.1, A.2.1-A.2.4) builds standalone               | `git rebase --exec 'cd web && npm run build' <base>` over the cherry-pick chain |
| E_NEW  | `getProjectTopology` joins `dependsOn` from compose                  | backend vitest                                                 |
| E_NEW  | SSE writer emits `event: line` followed by `event: end`              | backend vitest with stream consumer                            |
| E_NEW  | notifications POST → GET → DELETE roundtrip persists                 | backend vitest hits sqlite                                     |
| E_NEW  | metrics migration applies + reverts cleanly                          | backend vitest with fresh and seeded sqlite                    |
| E_NEW  | metrics endpoint returns 204 when no history exists, 200 with arrays otherwise | backend vitest                                       |
| B      | App.tsx route table mounts AppShell on every authenticated path      | vitest with React Router test harness — assert `<AppShell>` is in the rendered tree for each authed route |
| C      | `derivePhaseStatus`, `buildLogRows` from `lib/logRows.ts`            | existing vitest if cherry-pick brought it; otherwise add in Phase C |
| C      | `parseAnsi` handles 31m/32m/33m/35m/36m/0m/1m/2m sequences           | unit test `web/src/lib/__tests__/ansi.test.ts`                 |
| C      | NewProjectModal validates repo URL + slug                            | unit test                                                      |
| D      | InfraMap dagre layout deterministic for fixed input                  | snapshot test                                                  |
| D      | Animation declarations conform to v4 grammar (no `spring`, max 200ms duration) | static analysis test that scans Shell CSS and asserts each `transition:` matches the v4 grammar |

### Integration tests (contract tests — Vitest + zod, NOT bash)

All in `web/tests/contract/` (added in Phase F, Architect quality #4):

| Phase | What's testable                                                | Test                                          |
| ----- | -------------------------------------------------------------- | --------------------------------------------- |
| F     | `ServiceNode[]` shape matches UI types                         | `topology.test.ts` — boots backend with seeded fixture, calls endpoint, parses against zod schema derived from `ServiceNode` |
| F     | `ServiceHealth` shape matches UI types                         | `health.test.ts`                              |
| F     | `ServiceMetrics` 200 vs 204 paths                              | `metrics.test.ts` — both with-history and no-history fixtures |
| F     | `DeployLineEvent` + `DeployEndEvent` shape matches `useDeployLogStream` parser | `deploy-log-sse.test.ts`     |
| F     | `NotificationWebhookConfig` roundtrip                          | `notifications-webhook.test.ts`               |
| G     | full deploy → SSE log → terminal end (live)                    | manual click-through item 5                   |
| G     | 24h soak — `tools/qa/soak-test.sh` against new endpoints       | run for 24h window in staging env             |

### E2E tests (structured manual click-through)

We don't have a Playwright harness today. Adding one is captured as a
follow-up. E2E remains structured manual click-through with a documented
checklist:

1. Login → /home → see hero + projects + activity peek (no 4-card layout).
2. /projects → list view → click project → /projects/:id (Project view).
3. /projects/:id → click service → /services/:id?project=:pid.
4. /services/:id → 7 tabs work (arrow-key nav).
5. /services/:id → Deployments tab → click deploy → overlay opens →
   real SSE log streams (no "Sample data" chip on the LogViewer).
6. /services/:id → Monitoring tab → 2x2 sparklines render OR the explicit
   "Metrics will appear after first deploy completes" empty state when the
   backend returns 204 (no synthetic chart, no synthetic chip — Principle 4).
7. /activity → filter pills work, bucket headers render, bot icon only on `mcp`.
8. /mcp → 4 status tiles + connected agents + recent calls.
9. /settings/notifications → save webhook URL → reload → URL persisted →
   DELETE clears it.
10. /operations, /settings, /deployments → render under v4 chrome with v4
    palette (no indigo, no v2 spacing).
11. Console — zero errors across the click-through.
12. Network panel — exactly ONE `/api/projects` request per polling tick
    (validates ProjectsContext singleton).
13. `prefers-reduced-motion: reduce` enabled in DevTools → InfraMap edges,
    LogViewer auto-scroll, sparkline draw-in, modal transitions — all
    static.

### Verifier visual review (replaces pixel-diff infrastructure)

- **Where:** `.omc/plans/v4-deviations.md` (added in Phase G).
- **References:** `/tmp/ol-design-v4-backup/test/project/screens/r3-{home,activity,hero}.png` for the 3 pages with mockups; `/tmp/ol-design-v4-backup/test/project/openlander.html` rendered + structural-alignment criterion for the rest.
- **Tool:** `verifier` agent. No `pixelmatch` / `odiff` (Architect quality
  #7 — only 3 r3-* PNGs exist; tooling overhead disproportionate).
- **Viewport:** 1440 wide (matches v4 source captures).
- **Cadence:**
  1. End of Phase C — initial verifier round across the 11 v4 pages.
  2. End of Phase D — verifier re-runs against InfraMap + LogViewer.
  3. Phase G — full verifier round across every page, with deviations
     documented in `.omc/plans/v4-deviations.md`.
- **Approval:** verifier returns APPROVE per page; ITERATE deltas get
  fixed and the verifier re-spawns. The executor does not self-approve.

### Observability (what proves it works in production)

- Backend access log for `/api/deployments/:id/log/stream` tracks active
  deploys. SSE 404 rate is 0.
- Backend access log shows `/api/projects/:id/topology` polled ~every 10s
  per open `/projects/:id` tab. If we see legacy `/api/projects/:id/services`
  instead, Phase F regressed.
- Backend access log shows `/api/services/:id/metrics` returning 204 for
  first-deploy services, 200 for established services. If we see 200 with
  a synthetic-shaped payload, Principle 4 regressed.
- Frontend error reporting (if wired): zero errors on `/home` and
  `/projects/:id` for the first 24h post-merge.
- Soak test (`tools/qa/soak-test.sh`) runs for 24h against every new
  endpoint without 5xx; results captured to `tools/qa/soak-logs/`.

---

## G. ADR — Architectural Decision Record

**Status:** PROPOSED · iteration 5, single-SSE consolidation per user course correction, awaiting final Critic confirmation. Architect+Critic APPROVE captured at iteration 4; iteration 5 narrows scope (drops the dual-SSE design and its associated rules), every other iteration-4 commitment unchanged.

**Decision.** Adopt **Option (c) — Hybrid cherry-pick + v4 visual port** as
the strategy for the v4 design migration. Cherry-pick `fc0fc06` (PR8a) and
`6866c33` (PR8b) as discrete commits, then cherry-pick `962bf1d` with
`-n` and split the resulting working-tree change into 4 logical commits
(Shell takeover, LogViewer, InfraMap, Pages+hooks+contexts). Then
re-tokenize and rewrite the visual layer to v4 (light mode, green accent,
monochrome foreground, R3 hero Home, 11 page coverage). Backend ships 5
new endpoints **first** (Phase E_NEW, before UI consumer phases) with
real DB-backed implementations and the line-event SSE shape matching the
existing UI hook contract. A non-optional QA phase audits accessibility,
token drift, and verifier visual review before any merge.

### ADR-1.1 (revised iteration 5): Single SSE renderer — `/api/deployments/:id/log/stream`

**Decision.** Ship **one** deploy SSE channel — the deployment-keyed
line-event renderer
`GET /api/deployments/:id/log/stream` — and **delete** the legacy
project-keyed `GET /api/projects/:id/build/stream` along with its
host file `src/web/api/deploy-timeline-stream-routes.ts` and the
import + registration call in `src/web/api/deploy-stream-routes.ts`.

The kept endpoint emits `event: line\ndata: {phase, prefix, payload}`
per log line plus a terminal `event: end\ndata: {type:'end', outcome,
errorClass?}`. Consumer: the v4 LogViewer FSM
(`web/src/hooks/use-deploy-log-stream.ts` →
`web/src/components/Shell/LogViewer.tsx`), which depends on per-line
events for its 2-axis FSM, virtualization, and ANSI parser. The phase
rail rendering inside LogViewer covers per-deploy progression
visually.

**Drivers.**

1. **Zero v4 consumers for the project-keyed timeline events.** Verified
   via `grep -rn "build/stream\|use-timeline\|DeployTerminalSession\|OverviewTab" web/src/`:
   the only consumers are `web/src/hooks/use-timeline.ts`,
   `web/src/components/project/OverviewTab.tsx`, and
   `web/src/components/deploy-terminal/DeployTerminalSession.tsx` —
   all V1-only files, all themselves deleted in Phase A.2.1 / Phase B.
2. **LogViewer FSM is the only deploy-progression UI in v4.** Phase
   rail + log virtualization handles what the timeline stream used
   to feed; v4's `ActivityTimeline` is a separate cross-actor
   activity log on a different data source (agent + human + webhook
   + system events), not a deploy-progression renderer.
3. **Two endpoints would be permanent dead code.** Carrying the
   timeline stream forward would mean shipping a backend SSE route
   with no in-tree client and no way to verify it stays correct. v4
   is the inflection point to remove it.

**Alternatives considered.**

- **(a) Two coexisting SSE renderers.** REJECTED. This was the
  iteration-2/3/4 choice. It was correct **before** v4 deleted the
  V1 timeline consumers (use-timeline, OverviewTab,
  DeployTerminalSession). With those gone, the project-keyed stream
  has zero consumers in-tree. Keeping it would ship dead code into
  1.0 and force a permanent shape-parity rule, drift audit, and CI
  gate against an endpoint nothing reads.
- **(b) UI repoint to the project-keyed timeline.** REJECTED
  (already rejected in iteration 2). The v4 LogViewer FSM requires
  per-line events with phase + prefix + payload; the timeline
  stream emits coarse phase transitions only. Repointing would
  require re-writing the FSM, virtualization, and ANSI parser — a
  multi-day change that loses the reviewed structural foundation.
- **(c) Single deployment-keyed line stream.** CHOSEN. Matches the
  v4 LogViewer FSM contract exactly; eliminates the dual-channel
  drift surface; shrinks the 1.0 backend surface by one route and
  one file.

**Consequences.**

- LogViewer is fully wired to real data via the single canonical
  endpoint. `use-deploy-log-stream.ts` is the one client; phase rail
  inside LogViewer covers what the timeline used to surface.
- `web/src/hooks/use-timeline.ts` is deleted in Phase B (already V1-
  only).
- `src/web/api/deploy-timeline-stream-routes.ts` is deleted in Phase
  E_NEW. Any helper functions inside it (line emission, log tail
  reader, log-source resolver) are first migrated into
  `deploy-log-stream-routes.ts` (or a sibling
  `src/web/api/deploy-log-source.ts`) so the remaining endpoint is
  self-contained.
- The shape-parity rule, quarterly drift audit, and SSE shape-parity
  CI gate (former follow-ups #2 / #10 / #11) are removed. There is
  no second contract to drift against.
- **Ops/observability flag.** External ops dashboards or third-party
  consumers (if any) that may have been built against
  `/api/projects/:id/build/stream` lose their endpoint at this
  release. We verified zero in-tree consumers; we cannot verify
  external consumers. Phase G release notes
  (`docs/RELEASE-NOTES-v4-design.md`) document the removal
  prominently and direct external consumers to migrate to
  `/api/deployments/:id/log/stream`. Surface this for ops team
  review at Phase G.

**Hard rule.** Do not re-introduce the timeline stream as a "for
later" placeholder. If a future need surfaces (e.g., a project-level
multi-deploy dashboard), spec it as a fresh endpoint with its own
contract — do not resurrect the deleted file under the same path.

### ADR-1.2: ErrorClass taxonomy — adopt v4's 16-key registry verbatim (sub-decision, Architect iteration-4 blocker)

**Decision.** The deploy SSE terminal event's optional `errorClass`
field is typed as a union of **16 SCREAMING_SNAKE string literals**
copied verbatim from `/tmp/ol-design-v4-backup/test/project/src/errors.jsx`
(`CONFIG_MISSING`, `GIT_ACCESS_DENIED`, `BUILD_CONTEXT_MISMATCH`,
`IMAGE_WRONG_STAGE`, `DEPENDENCY_UNHEALTHY`, `DB_EXTENSION_MISSING`,
`PORT_CONFLICT`, `CLI_OVERRIDE_SYNTAX`, `RUNTIME_CRASH`,
`INFRA_UNAVAILABLE`, `OOM_KILLED`, `DOCKER_DAEMON_UNREACHABLE`,
`DISK_EXHAUSTED`, `NETWORK_DEPENDENCY_UNREACHABLE`,
`HEALTHCHECK_TIMEOUT`, `BUILD_TIMEOUT`). Backend classification lives
in `src/pipeline/error-classifier.ts` (`classifyDeployError(err) →
ErrorClass`). Frontend ErrorSurface consumes the registry from
`web/src/lib/errorClasses.ts`. Default key for the unmatched case is
`RUNTIME_CRASH` — there is no `UNKNOWN` key.

**Why 16, not a coarser bucket.** v4's `errors.jsx` defines 16
narrative-specific error keys, and ErrorSurface's purpose is per-key
narrative rendering — each key carries a distinct title, blame
classification, explanation, and suggested action (e.g., `OOM_KILLED`
→ "killed by the kernel — exceeded its 256MB memory limit" with a
raise-limits-or-page-batch fix; `DISK_EXHAUSTED` → "host is out of
disk" with a `docker system prune -af` fix; `DOCKER_DAEMON_UNREACHABLE`
→ "Docker daemon stopped responding" with a `systemctl restart docker`
fix). Any reduction (e.g., merging the three under a coarse
`infra_failed`) would degrade Phase C visual parity below the merge
gate, because ErrorSurface would have to ad-lib copy for the merged
bucket and the verifier would correctly flag it as missing v4
narrative. The taxonomy is adopted verbatim because it IS the spec.

**Hard rule.** Never invent a new `errorClass` key without expanding
v4's `errors.jsx`-derived registry FIRST and updating the
`ErrorClassSchema` zod enum in the same commit. Phase F's
`deploy-log-sse.test.ts` asserts exhaustiveness — emitting a value
outside the 16-key set throws on parse, blocking merge.

### Drivers (top 3, recap from Section B)

1. Design fidelity to v4 — mockups in `/tmp/ol-design-v4-backup/test/` are
   the spec; drift is the primary failure mode.
2. Public API surface stability — 5 new endpoints become 1.0 contract.
3. Cross-stack contract drift — UI hooks are the source of truth for
   backend implementation; backend lands first; Vitest+zod contract tests
   pin the shape.

### Alternatives considered

- **(a) Ship visual layer fast, polish in 1.0.x. REJECTED.** Speed-over-
  quality trade is off-the-table. Visual parity is a merge gate, not a
  polish task. A "v4 chrome with v2 guts" build produces token ghosts,
  spacing drift, and a two-product feel that customer screenshots and
  marketing material would expose. Deferred polish becomes permanent debt.
- **(b) Re-implement from scratch.** Rejected (not on speed, but on
  review-value): re-deriving LogViewer (787 → 590 LOC, 2-axis FSM,
  virtualization, ANSI), InfraMap (react-flow + dagre), ProjectsContext
  from JSX pseudocode loses the review value of the original PR1-PR8 +
  Codex pass. Quality is "correct, reviewed code," not "more typing."

### Why chosen

Option (c) delivers v4 visual cleanliness on the user-facing surface (the
visual port is itself a from-scratch v4 port — no v2 baggage) AND
preserves reviewed structural foundations. The phase ordering — foundation
+ split-commit cherry-pick → **backend first (Architect iteration 2
recommendation)** → shell takeover → page rewrites → InfraMap/LogViewer
re-tokenize → wiring → QA — matches the dependency graph exactly: each
phase has exactly one reviewer concern, and each phase either reduces
visible v2 surface or increases backend coverage. **Backend-first
sequencing as recommended by Architect iteration 2** eliminates the prior
plan's Phase F rework loop where UI was first wired to mocks and then
re-wired to real endpoints. The non-optional Phase G QA audit
(accessibility + token drift + verifier visual review) is the final gate
that a "skeleton" build cannot pass.

### Consequences

- Positive: ~5,000 LOC of structural work survives without re-derivation
  risk. Megacommit is split into 4 reviewable commits per Architect
  blocker #2 — bisect-friendly history.
- Positive: v4 visual layer lands as one-pass clean tokens (no indigo
  ghost in history).
- Positive: backend lands BEFORE the UI consumer phases (Architect
  blocker #1 reorder). UI phases B-D consume real endpoints from the
  start; no Phase F rework loop where mocks get torn out and replaced.
- Positive: backend phase has a clear contract (UI types) and Vitest+zod
  contract tests (Architect quality #4) pin the shape so future drift
  fails CI as a typed parse error rather than production runtime mismatch.
- Positive: Phase C and Phase G use a `verifier` agent for the visual
  approval gate (Architect quality #5). Self-judgment is excluded.
- Positive: Phase G's accessibility + token-drift + verifier-visual
  audits are merge gates — a build that passes them is by construction
  v4-faithful.
- Positive: PageHeader is retained from develop through Phase A/B as a
  TRANSITIONAL wrapper (Architect quality #8) so OpsCenterV2/SettingsPage/
  DeploymentsList build clean after the cherry-pick. **Phase C migrates
  every consumer to AppShell-native chrome and deletes
  `PageHeader.tsx`** (Critic blocker #3). After Phase C, Principle 3
  ("single shell, single source of truth") is true at the file level.
- Positive (iteration 5): **Single SSE renderer.** ADR-1.1 (revised)
  consolidates to one endpoint
  `/api/deployments/:id/log/stream`. The legacy project-keyed
  `/api/projects/:id/build/stream` and its host file
  `src/web/api/deploy-timeline-stream-routes.ts` are DELETED in Phase
  E_NEW. The V1 chain (`use-timeline.ts`, `OverviewTab.tsx`,
  `DeployTerminalSession.tsx`, `ProjectDetailTabs.tsx`) is DELETED in
  Phase B. The shape-parity rule, drift audit, and CI gate (former
  follow-ups #2 / #10 / #11) are removed — no second contract to
  drift against. v4's `ActivityTimeline` is a separate cross-actor
  activity log on a different data source.
- Negative: cherry-pick conflict resolution against develop's recent UI
  work is a real risk; Phase A's pre-mortem mitigation absorbs it.
- Negative: PR8a/PR8b on `origin/ui-redesign-1.0` remain orphaned per
  user direction. We carry their content forward via cherry-pick but the
  source PR stays open unmerged. Acceptable per user direction.
- Negative: no `meta.synthetic` path means first-deploy services with no
  metrics yet show an empty-state UI for a window (Principle 4 strict
  reading per Architect quality #6). The trade is explicit — honest
  empty state vs misleading synthetic chart. We pick honest.
- Negative: no automated visual regression infrastructure — verifier
  agent + manual screenshot review is the gate (Architect quality #7).
  Acceptable because only 3 r3-* PNGs exist; pixelmatch tuning would be
  disproportionate overhead for that surface area.

### Follow-ups (post-merge, separate work)

1. First-deploy metrics window — most services accumulate enough history
   in the first ~5 minutes to fill the metrics chart; if the empty-state
   window proves disruptive in production, evaluate a server-side
   "best-effort live sample" that backfills the chart with whatever the
   metrics recorder has captured so far (no synthetic data — only real
   samples, even if sparse).
2. ~~Evaluate whether the line-event stream can be derived from the
   timeline stream + a server-side log tail join, removing the second
   backend.~~ **REMOVED in iteration 5** — single-SSE consolidation
   landed in this sprint, no second backend to remove.
3. SSE `Last-Event-ID` resume client-side wiring (server already supports
   it after Phase E_NEW).
4. Multi-webhook notifications support (Phase E_NEW ships single-webhook
   only).
5. Mobile responsive polish — v4 mockups are desktop-only.
6. Print-stack pages (cover + 11 + screens) — v4 source has them; this
   migration ships the application UI only.
7. Playwright E2E harness — replaces the manual click-through checklist.
8. Open RFC: rename `OpenLander` codename → final 1.0 brand. Single
   `BRAND` constant in `web/src/lib/brand.ts` ready for swap (per the
   project-codename memory).
9. Open question (defer to user): does the user want a separate `--ol-*`
   token namespace for safe coexistence during migration, or is the direct
   v4-token namespace correct? Phase A assumes direct namespace.
10. ~~Quarterly dual-SSE drift audit~~ **REMOVED in iteration 5** —
    only one SSE endpoint exists; no schemas to diff.
11. ~~SSE shape-parity CI gate~~ **REMOVED in iteration 5** — single
    endpoint means no shape-parity surface to police.

---

## H. Hand-off note

This is a **ralplan consensus plan**. **Iteration 5** narrows the SSE
surface from two coexisting renderers to one. **Do not preserve the
old project-keyed timeline endpoint.** The file
`src/web/api/deploy-timeline-stream-routes.ts`, the route
`/api/projects/:id/build/stream`, and the V1 frontend chain that
consumed it (`web/src/hooks/use-timeline.ts`,
`web/src/components/project/OverviewTab.tsx`,
`web/src/components/project/ProjectDetailTabs.tsx`,
`web/src/components/deploy-terminal/DeployTerminalSession.tsx`) are
all DELETIONS, not deprecations. If the executor is tempted to leave
the timeline stream behind a flag or as "for later," that is wrong —
the user explicitly course-corrected to consolidate SSE. The single
canonical deploy SSE endpoint going forward is
`GET /api/deployments/:id/log/stream`. Any helper utilities currently
inside the timeline route file (line emission, log tail reader,
log-source resolver) must be moved into
`src/web/api/deploy-log-stream-routes.ts` or a sibling
`src/web/api/deploy-log-source.ts` BEFORE the timeline file is
deleted, so the kept endpoint stays self-contained.

The autopilot picking it up should:

- Skip Phase 0 (request expansion) and Phase 1 (planning) entirely.
- Resume at Phase 2 (execution) and walk Phase A → Phase E_NEW → Phase B
  → Phase C → Phase D → Phase F → Phase G in order (iteration 2 reorder).
- Treat each phase's "Definition of Done" as the literal verifier
  contract — every bullet (functional AND visual AND accessibility, where
  listed) must pass before moving to the next phase.
- For phases with an explicit verifier gate (Phase C and Phase G), spawn
  a `verifier` agent and iterate until APPROVE. Do NOT self-approve.
- Treat each phase's "Files touched" as advisory — the executor may add
  or modify adjacent files as needed, but every commit message should
  explicitly enumerate any deviations from the listed paths.
- **Execute every phase to completion before declaring done.** Do not
  stop early for any reason, including time pressure, sprint pressure,
  perceived diminishing returns, or "we can polish later." There is no
  launch deadline. Quality is the only gate. If a phase reveals more work
  than expected, the phase iterates; we do not skip.
- Stop and ask the user (NOT inside Phase 2 execution — surface as a
  PR-level question or commit-message note) ONLY if:
  - A cherry-pick conflict requires more than mechanical resolution AND
    the resolution fundamentally changes a structural decision (e.g.,
    AppShell vs AppLayout in a way the plan doesn't anticipate).
  - A backend endpoint reveals a fundamental data-model gap that requires
    a design choice the plan doesn't cover (e.g., `dependsOn` parsing
    semantics for compose `extends:` chains).
  - A v4 mockup reveals an interaction pattern (e.g., a new modal
    behaviour, a new keyboard shortcut) that contradicts an existing
    implementation decision in the cherry-picked code.
- Otherwise, run hands-off through Phase G and stop only at:
  - Verifier failure (iterate within the phase).
  - Phase G completion (open PR against `develop` with the verifier
    visual review artefacts + accessibility audit results in the PR
    description).

The first commit on `feat/v4-design` (atop `db063a7`) should be:

```
chore(plan): reference v4 design migration plan + design backup snapshot

Plan: .omc/plans/ralplan-v4-sprint.md (iteration 5, single-SSE consolidation)
Design source: /tmp/ol-design-v4-backup/test/ (chat1.md + 15 jsx + styles.css)
Reference screens: /tmp/ol-design-v4-backup/test/project/screens/r3-*.png
Backup PR docs: /tmp/ol-autopilot-backup/ (PR1-PR8)
Structural commits to re-port: 962bf1d (split into A.2.1-A.2.4), fc0fc06, 6866c33
ErrorClass taxonomy: 16-key registry from /tmp/ol-design-v4-backup/test/project/src/errors.jsx
SSE surface: single endpoint /api/deployments/:id/log/stream (legacy /api/projects/:id/build/stream DELETED)
```

Phase A's split cherry-pick batch follows this commit (A.1: fc0fc06 +
6866c33; A.2: 962bf1d split into 4 commits A.2.1-A.2.4). Subsequent
phases each land as their own commit (or commit pair if backend +
frontend within Phase E_NEW / F). Phase G lands the verifier visual
review artefacts (`.omc/plans/v4-deviations.md`) and the accessibility
audit results.

---

> *End of plan. Ready for Architect steelman / Critic critique.*
> *ralplan consensus plan*
