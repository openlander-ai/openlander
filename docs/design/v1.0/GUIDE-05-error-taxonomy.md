# GUIDE-05 — Error Taxonomy & UI Reaction Matrix

> **Audience**: Claude Design (for defining component variants per error class) + implementer (for routing errors to the right surface).
> **Why it exists**: Users report "번잡한" UI partly because the same type of problem sometimes shows as a toast, sometimes as a banner, sometimes inline. This spec fixes the inconsistency by declaring **which error class shows up on which surface, with what content**.
> **Status**: draft — grounded in 6 real failures from `dokploy-compat` deploy session + live `active_incidents` list from OpenLander production (see `DOKPLOY_HANDSON_UX_ANALYSIS.md` §12 and MCP initialize response).

---

## 1. The 5 Error Surfaces (where errors can appear)

OpenLander has exactly **five** places an error can render. Each has a distinct visual weight and expected reading behavior. **Any given error has one primary surface and up to two optional secondary/tertiary surfaces** (Codex-reviewed rule — previous "exactly 1-2" cap was too strict; failed deploys legitimately use A+B+C).

| Surface                       | Visual weight                                              | User behavior                      | Dismissible?                      | Persisted?                      |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------------- |
| **A. Inline error line**      | One line in a stream, red background + red dot             | Reads in context                   | No (part of log)                  | Yes (in log storage)            |
| **B. Phase-end summary card** | Separator card at bottom of stream, ~5 lines               | Reads after log ends               | No (until re-deploy)              | Yes (stored with deploy record) |
| **C. Deployment card**        | Row in deployment history, red status dot + 1-line summary | Scans at a glance                  | No (audit record)                 | Yes (durable)                   |
| **D1. Toast**                 | Corner notification, auto-dismiss 5–10s                    | Peripheral glance                  | Yes (auto or click)               | No                              |
| **D2. Persistent banner**     | Full-width banner at top of all pages, no auto-dismiss     | Forced reading, blocks interaction | No (only when condition resolves) | No                              |

Why split Dokploy's conflated "toast / banner" into D1 and D2 (Codex): a Slack-style toast for "Reconnected" is fundamentally different UX from a "Daemon unreachable — deploys disabled" blocker that must remain visible until the user fixes it. Single "surface D" lumped these and caused inconsistency.

Rule of thumb: **the more durable the error's value, the more durable its surface**. A build failure is forever-valuable (A+B+C); a network blip is transient (D1); a daemon outage must block until fixed (D2).

---

## 2. Error Class Taxonomy

**17 classes total** — 10 priority for v1.0 + 7 deferred to v1.1+. Each class maps to a primary surface and optional secondary/tertiary. GUIDE-00 IDs in parens.

**v1.0 classes (§§2.1–2.10)** — heuristic detection implementable against current backend (GUIDE-00 ER-4 partial; ER-2 client-side heuristic).
**v1.1 additions (§§2.11–2.17)** — require backend refinement (GUIDE-00 ER-7).

Every error OpenLander can produce maps to one of these 10 classes. Each class has a fixed surface combination + a content template.

### 2.1 `CONFIG_MISSING`

- **Trigger**: required config absent (`DATABASE_URL undefined`, `domain not set`, `git source not configured`).
- **Detection timing**: validation-time (before deploy click) AND deploy-time (fallback).
- **Surfaces**: **D** (toast on form submit) + if deploy was attempted anyway, **A** (inline: "⛔ DATABASE_URL is required").
- **Template**:
  - Toast: `"Missing {field}. Set it in {tab} before deploying."`
  - Inline: `error ⛔ {field} is required — see /docs/env-vars`
- **Live example (hotdeal-tracker deploy #2)**: api container crashed because compose `env_file: .env.prod` didn't exist and no compose-level `environment:` block existed for api. DATABASE_URL was undefined at runtime.

### 2.2 `GIT_ACCESS_DENIED`

- **Trigger**: `git clone` fails with `Authentication failed` / `Permission denied` / `Repository not found`.
- **Detection timing**: deploy-time, phase `clone`.
- **Surfaces**: **A** (inline) + **C** (deployment card with class name).
- **Template**:
  - Inline: `error ⛔ Cannot access {repo_url}. Check SSH key or PAT in Settings → Git Providers.`
  - Card: `❌ Git access denied · {duration}`
- **Fix hint**: one link to /settings/git (in inline error).
- **Live example**: would happen if deploy key was missing before we registered via `gh api`.

### 2.3 `BUILD_CONTEXT_MISMATCH`

- **Trigger**: Dockerfile references a path that doesn't exist in its build context.
- **Detection timing**: deploy-time, phase `build`.
- **Surfaces**: **A** (inline with file:line-ish highlight) + **B** (phase-end summary).
- **Template**:
  - Inline: `error target {service}: failed to solve: "{path}": not found`
  - Summary card: `BUILD_CONTEXT_MISMATCH — Dockerfile expects "{path}" relative to {context}. Likely fix: set context: . with explicit dockerfile: {file}.`
- **Live example (hotdeal-tracker deploy #1)**: exact error on first Dokploy attempt with `context: ./apps/web` + Dockerfile using `COPY apps/web/...`.

### 2.4 `IMAGE_WRONG_STAGE`

- **Trigger**: multi-stage Dockerfile has no explicit `target`; compose picks the wrong (last) stage.
- **Detection timing**: runtime — container runs but its entrypoint is for a different role.
- **Signal**: repeating entrypoint-specific error (`SEED_SITE is required`, `Missing WORKER_QUEUE`, etc.) in container logs during healthcheck_wait phase.
- **Surfaces**: **B** (phase-end summary) + **C** (deployment card: "Unhealthy after 90s").
- **Template**:
  - Summary: `IMAGE_WRONG_STAGE — container keeps restarting with error "{first_error_line}". Dockerfile has stages: {stage_list}. Expected target: {inferred}. Set build.target: {inferred} in compose.`
- **Live example (hotdeal-tracker deploy #4)**: Dockerfile.api had stages `api`/`worker`/`seed`; compose picked `seed`; container looped "SEED_SITE is required".

### 2.5 `DEPENDENCY_UNHEALTHY`

- **Trigger**: `depends_on: {condition: service_healthy}` chain fails; downstream services never start.
- **Detection timing**: phase `healthcheck_wait`, after `start_period`.
- **Surfaces**: **A** (inline, one per failed dep) + **B** (phase-end summary).
- **Template**:
  - Inline: `error Container {dep} unhealthy — blocking {service}`
  - Summary: `DEPENDENCY_UNHEALTHY — {service} never started because {dep} failed its healthcheck. First failing service: {dep}. [View {dep} logs →]`
- **Live example (hotdeal-tracker deploy #2)**: web/worker never started because api wasn't healthy (DB missing).

### 2.6 `DB_EXTENSION_MISSING`

- **Trigger**: SQL error during migration referencing an unavailable extension.
- **Detection timing**: runtime, during alembic/flyway/prisma migration.
- **Surfaces**: **A** (inline) + **B** (phase-end summary with image swap suggestion).
- **Template**:
  - Inline: `error extension "{ext}" is not available. [SQL: CREATE EXTENSION IF NOT EXISTS {ext}]`
  - Summary: `DB_EXTENSION_MISSING — your migration requires the {ext} PostgreSQL extension. Current image: {image}. Alternatives: {suggestions}. [Switch image →]`
- **Live example (hotdeal-tracker deploy #5)**: `vector` missing on `postgres:16-alpine`; fix was `pgvector/pgvector:pg16`.

### 2.7 `PORT_CONFLICT`

- **Trigger**: `Bind for 0.0.0.0:{port} failed: port is already allocated`.
- **Detection timing**: phase `container_start` (docker daemon error before container process begins).
- **Surfaces**: **A** (inline) + **B** (phase-end summary with auto-fix CTA).
- **Template**:
  - Inline: `error Bind for 0.0.0.0:{port} failed: port is already allocated`
  - Summary: `PORT_CONFLICT — host port {port} is taken. Suggested free port: {next}. Or switch to Traefik routing (remove ports: mapping).`
- **Live example (hotdeal-tracker deploy #6)**: compose wanted host 3000, Dokploy UI already using 3000.

### 2.8 `CLI_OVERRIDE_SYNTAX`

- **Trigger**: user-provided custom command fails to parse (`unknown flag`, `expected positional argument`, etc.).
- **Detection timing**: at-save (dry-run) + deploy-time (fallback).
- **Surfaces**: **D** (toast on save with inline form highlight) + **A** (inline at deploy if save validation was skipped).
- **Template**:
  - Toast: `Invalid command: "{reason}". Default: {default_cmd}`
  - Inline: `error {first_stderr_line}`
- **Live example (hotdeal-tracker deploy #3)**: custom command `docker compose -p ...` + Dokploy auto-prepending `docker` → `docker docker compose`, producing `unknown shorthand flag: 'p' in -p`. Dokploy surfaced it as a raw log line after 2s deploy failure. **OpenLander should catch this at save time** (validate with a `--help` dry-run of the user's command).

### 2.9 `RUNTIME_CRASH`

- **Trigger**: container exits with non-zero code, or HEALTHCHECK keeps failing past start_period, in a running (not-deploying) state.
- **Detection timing**: post-deploy observation (background).
- **Surfaces**: **C** (project card status flips to "crashing" with count) + **D** (single banner when crash crosses N-crashes threshold, debouncing noise).
- **Template**:
  - Project card: `🔴 {N} crashes in 24h — last: {error_class}`
  - Banner (debounced): `{project} has crashed {N} times. [View logs →] [Auto-restart settings →]`
- **Live data (OpenLander production)**: from the MCP `initialize` instructions — multiple `runtime_crash` cases listed with exact crash counts per project (e.g., `hotdeal-worker: runtime_crash 59x`, `test-g18-stability: runtime_crash 102737x`). The massive numbers like 102k suggest the banner MUST debounce or it becomes noise.

### 2.10 `INFRA_UNAVAILABLE` (narrowed from Codex review)

- **Trigger**: OpenLander agent itself unreachable (API timeouts, health check on backend fails). Note: previously this class was too broad — Docker daemon down and disk full are now **§§2.13, 2.14** respectively.
- **Detection timing**: deploy-time (fail fast) + ambient monitoring.
- **Surfaces**: **D2** (persistent banner) + block deploy buttons globally.
- **Template**:
  - Banner: `⚠ OpenLander server is unreachable. Deploys are disabled. [Retry connection] [View status page]`

---

## v1.1 CLASSES (deferred — backend classification needed, GUIDE-00 ER-7)

### 2.11 `MIGRATION_FAILED` (generic, not just extension)

- **Trigger**: any migration tool (alembic, prisma, flyway, knex) reports a non-zero exit during container startup.
- **Detection timing**: runtime, during container `healthcheck_wait` phase — container log contains migration-tool error patterns.
- **Surfaces**: **B** (phase-end summary) + **C**.
- **Template**:
  - Summary: `MIGRATION_FAILED — {tool} reported error: "{first_error_line}". Check migration file {file:line if parsable}. Common causes: schema conflict, constraint violation, unavailable extension (see {DB_EXTENSION_MISSING}).`
- **Priority for v1.0**: only partial coverage (DB_EXTENSION_MISSING §2.6 is subset). Full migration classification deferred.

### 2.12 `OOM_KILLED`

- **Trigger**: container exit code 137 and/or `dmesg` contains `Out of memory: Killed process`.
- **Detection timing**: runtime, container exits.
- **Surfaces**: **B** + **C** + **D1** (toast for immediate visibility while user is in UI).
- **Template**:
  - Summary: `OOM_KILLED — container "{name}" killed by OOM. Memory peaked at {N}MB against limit {M}MB. Increase mem_limit OR profile memory usage before redeploy.`
- **Priority**: **1.0 priority candidate** (GUIDE-00 ER-4). Cheap heuristic (exit code 137).

### 2.13 `DISK_EXHAUSTED`

- **Trigger**: host disk usage >95% OR docker daemon returns `no space left on device`.
- **Detection timing**: ambient monitoring + deploy-time on pull/build.
- **Surfaces**: **D2** (persistent banner — must block further deploys) + **C** (for the deploy that hit it).
- **Template**:
  - Banner: `⚠ Host disk 97% full. Deploys will likely fail. [Run cleanup] [View usage]`
  - Summary (on-deploy): `DISK_EXHAUSTED — docker could not complete: no space left on device. Cleanup suggestions: prune stopped containers (~{N}GB), prune unused images (~{M}GB).`

### 2.14 `DOCKER_DAEMON_UNREACHABLE`

- **Trigger**: OpenLander's docker socket returns connection refused for ≥30s.
- **Detection timing**: ambient + deploy-time.
- **Surfaces**: **D2** (persistent banner) + block deploy buttons + **C** (for in-flight deploys that fail on this).
- **Template**:
  - Banner: `⚠ Docker daemon is not responding on this host. Start Docker or check systemctl status docker.`
- **Priority**: **1.0 priority candidate** (GUIDE-00 ER-4).

### 2.15 `NETWORK_DEPENDENCY_UNREACHABLE`

- **Trigger**: DNS timeout OR TCP-reset on an external registry, git remote, or user-configured API endpoint during a deploy.
- **Detection timing**: deploy-time, phases `clone` / `image_pull` / `build` (for base image lookups).
- **Surfaces**: **A** (inline error in stream) + **B** (summary with classification).
- **Template**:
  - Inline: `error {resolver}: Could not resolve host {hostname} (or TCP timeout)`
  - Summary: `NETWORK_DEPENDENCY_UNREACHABLE — {hostname} unreachable. If this is github.com / docker.io / ghcr.io, check host DNS or firewall. If a user-configured URL, verify the {field} setting.`

### 2.16 `HEALTHCHECK_TIMEOUT`

- **Trigger**: container healthcheck has been failing for > `start_period + (interval × retries)` without ever succeeding.
- **Detection timing**: runtime, phase `healthcheck_wait`.
- **Surfaces**: **B** (phase-end summary) + **C**.
- **Template**:
  - Summary: `HEALTHCHECK_TIMEOUT — "{service}" failed health probe for {N}s (start_period {P}s + {interval}s×{retries} retries). Probe was: {healthcheck_test}. View last N log lines to diagnose.`
- **Note**: distinct from DEPENDENCY_UNHEALTHY (§2.5) which is about _other_ services depending on this one's health. Here, the container itself never got healthy for its own reason.

### 2.17 `ROLLBACK_FAILED` / `PARTIAL_RECOVERY`

- **Trigger**: user requested rollback to a previous deploy, but the image tag is missing from the registry OR the rollback deploy itself errored.
- **Detection timing**: rollback execution.
- **Surfaces**: **B** (summary on the rollback deploy row) + **C** + **D1** (toast — because user explicitly triggered an action and needs immediate feedback).
- **Template**:
  - Summary: `ROLLBACK_FAILED — rollback to deploy #{N} failed because {reason}. Current service state: {state}. You may need to redeploy manually from commit {sha}.`
- **Recovery UX**: if rollback leaves service in partial state (e.g., container crashed between old image being stopped and new image starting), show a separate `PARTIAL_RECOVERY` banner with explicit recovery actions (`[Restart service]`, `[Force redeploy]`).

---

## 3. Surface Selection Decision Tree

Use this to route a newly-discovered or novel error to the right surface. **Rule (Codex-corrected)**: every error has ONE primary surface, plus optional secondary/tertiary. No hard cap on count — failed deploys legitimately use A + B + C. **Never** use D1 (toast) as the only surface for a durable error.

```
Is this error…
├─ blocking the whole product (daemon down, disk full, agent down)?
│   → PRIMARY: D2 (persistent banner, cannot dismiss) + disable affected actions
│   → SECONDARY: C if a specific deploy is blocked on it
│
├─ predictable-and-fixable-in-config (missing env, syntax, port conflict)?
│   → PRIMARY: A (inline at deploy time)
│   → SECONDARY: B (phase-end summary with fix hint)
│   → SAVE-TIME variant: D1 (toast) + form-field highlight (caught before deploy)
│
├─ a runtime consequence of deploy config (unhealthy dep, stage mismatch, migration fail, healthcheck timeout)?
│   → PRIMARY: B (phase-end summary — most informative)
│   → SECONDARY: A (inline for the trigger line)
│   → TERTIARY: C (deployment card for audit trail)
│
├─ a steady-state production incident (crash loop, OOM recurring)?
│   → PRIMARY: C (project card status + crash count, updated at most once per 60s per project)
│   → SECONDARY: D2 (debounced banner) only when crossing N-crash threshold
│   → NEVER: D1 toast — spam risk, user will miss it
│
├─ a user-triggered action's failure (rollback failed, env var save failed)?
│   → PRIMARY: D1 (toast) — user is actively awaiting feedback
│   → SECONDARY: B and/or C if the failure created a deploy record
│
└─ a stream infrastructure hiccup (connection drop, reconnecting)?
    → PRIMARY: D1 (toast: "Reconnecting…" / "Reconnected")
    → NEVER: A / B / C — these are for durable errors, not transient ephemera
```

**Class → primary surface quick map** (new v1.1 classes italicized):

| Class                            | Primary             | Secondary           |
| -------------------------------- | ------------------- | ------------------- |
| CONFIG_MISSING                   | D1 (save-time) or A | form highlight / B  |
| GIT_ACCESS_DENIED                | A                   | C                   |
| BUILD_CONTEXT_MISMATCH           | A                   | B                   |
| IMAGE_WRONG_STAGE                | B                   | C                   |
| DEPENDENCY_UNHEALTHY             | A                   | B                   |
| DB_EXTENSION_MISSING             | A                   | B                   |
| PORT_CONFLICT                    | A                   | B                   |
| CLI_OVERRIDE_SYNTAX              | D1 (save)           | A (deploy fallback) |
| RUNTIME_CRASH                    | C                   | D2 (debounced)      |
| INFRA_UNAVAILABLE                | D2                  | —                   |
| _MIGRATION_FAILED_               | B                   | C                   |
| _OOM_KILLED_                     | B                   | C + D1              |
| _DISK_EXHAUSTED_                 | D2                  | C                   |
| _DOCKER_DAEMON_UNREACHABLE_      | D2                  | C                   |
| _NETWORK_DEPENDENCY_UNREACHABLE_ | A                   | B                   |
| _HEALTHCHECK_TIMEOUT_            | B                   | C                   |
| _ROLLBACK_FAILED_                | B                   | C + D1              |

---

## 4. Content Rules (what goes IN the error surface)

Each surface has required fields:

### 4.1 Inline error line (surface A)

- Red dot in left margin
- Red background band across the line
- Original error text verbatim (don't rewrite)
- Optional: suffix `— [docs↗]` linking to a relevant help anchor
- MUST NOT include CTA buttons (it's a log line, not a dialog)

### 4.2 Phase-end summary card (surface B)

- Full-width card with red left border
- Title line: error class name in CAPS + dash + plain-English reason (e.g., `BUILD_CONTEXT_MISMATCH — Dockerfile expects "/apps/web" not found in build context`)
- Likely fix line: one sentence. Actionable. Specific (e.g., `set build.context: . with dockerfile: Dockerfile.web`). Never generic ("check your config").
- Up to 3 CTA buttons (maximum): `Re-deploy` / `View compose` / `Copy error summary`. Ordered by frequency of need.

### 4.3 Deployment card error summary (surface C)

- Status dot (red)
- Status word (`Error`, `Crashed`, `Degraded`)
- Error class name (compact: `BUILD_CONTEXT_MISMATCH` or `RUNTIME_CRASH`)
- Duration (`9s` / `1m 40s`)
- First-line-only summary (truncate with ellipsis)
- `View` button (opens full log)
- `Delete` button (remove from history)

### 4.4a Toast (surface D1)

- Icon on left (⚠ for warning, ⛔ for error, 🟢 for recovery, 🔵 for info)
- One short sentence (no more than 80 chars)
- Optional one action button (e.g., `Retry`)
- Auto-dismiss timer: **10s** for errors, **8s** for warnings, **5s** for info / success
- Position: top-right on desktop, bottom on mobile
- Stackable (max 3 visible; older ones fade out)
- `aria-live="polite"` for non-blocking announcements

### 4.4b Persistent banner (surface D2)

- Full-width banner at top of all pages (below top bar, above outer card frame)
- Icon on left (⚠ / ⛔)
- Descriptive copy (one or two sentences — more room than toast)
- Up to 2 action buttons inline (e.g., `[Retry connection] [View status]`)
- **Not dismissible** — persists until the underlying condition resolves
- Position: fixed top, above all route content, below top bar
- `role="alert"` + `aria-live="assertive"` — screen reader interrupts
- **Blocks affected actions**: e.g., when D2 is for `DOCKER_DAEMON_UNREACHABLE`, all `Deploy` buttons across the app become disabled until the banner resolves

**When each applies** — see §3 class→surface table. D1 is for ephemeral feedback (stream reconnect, action completion). D2 is for product-blocking infra conditions (daemon down, disk full, agent offline).

---

## 5. Anti-Patterns (observed in OpenLander today or in Dokploy)

- ❌ **Stacking toasts**: one toast per crash event when a container crash-loops 100× per minute → unreadable. Use debouncing + the project card (surface C) as primary.
- ❌ **Generic error messages**: `"something went wrong"`, `"internal error"`. Always show the original backend error text verbatim inside surface A, with OpenLander's interpretation added around it.
- ❌ **Dismissable banners for terminal errors**: if the user needs to act (e.g., daemon is down), don't let them click-away the prompt.
- ❌ **Error class names in UI copy**: show `BUILD_CONTEXT_MISMATCH` _only_ in the summary card (audit-level), never in the inline line or toast. Plain English for user-facing copy.
- ❌ **Duplicate messaging across surfaces**: if a deploy failed, the deployment card + phase-end summary + inline error are all fine (they're different detail levels), but DO NOT also fire a toast — that's the fourth surface for a user who already sees three.
- ❌ **Linking to nothing**: never `[View logs]` if there are no logs, never `[docs]` that 404s. If unsure, omit the CTA.

---

## 6. Unknown Errors — the Catch-All

If an error doesn't match the 10 classes above, route to:

- Surface **A** (inline): raw error verbatim
- Surface **B** (phase-end summary):
  ```
  UNCLASSIFIED — {short verbatim first line}
  We don't have a specific diagnosis for this yet. [📋 Copy full error]  [📝 Report this pattern]
  ```

Logging (server-side): track these with their error text and freqency. After 2+ weeks of live traffic, review top 10 unclassified patterns and either (a) add a new class to this taxonomy, or (b) confirm they're truly one-off.

---

## 7. Accessibility Notes

- Red (for errors) must have >= 4.5:1 contrast against white background. Test with WCAG AA.
- **Never rely on color alone**: use icons (red dot + ⛔ glyph + status word "Error") so colorblind users still parse correctly.
- Toast announcements use `aria-live="polite"` for warnings, `aria-live="assertive"` for errors that block interaction.
- Phase-end summary is a `<section role="alert">` when failed; keyboard-focusable; Tab cycles through the 3 CTAs.

---

## 8. Handoff to Claude Design

**What we want designed**:

- All 4 surface components with clear visual hierarchy (A < D in weight, D < C in persistence, etc.)
- The phase-end summary card is the highest-value, highest-design-load component — spend most design time here
- A color system: 1 red for errors (shared across all surfaces), 1 amber for warnings, 1 green for recovery
- Icon set: 4 at most (⛔ / ⚠ / 🟢 / 🔵 info)
- Typography rhythm for the summary card (title weight vs fix-hint weight vs CTAs)

**What we do NOT want**:

- Per-error-class illustrations or mascots
- Animated state transitions between error states (would distract from content)
- Collapsible sections inside error UI (don't hide info; keep it above the fold)

**Reference**: Sentry's error detail page is a good high-information-density benchmark. Don't copy its layout, but match the density: every pixel earns its place.

---

## 9. Acceptance

Before this guide is considered implemented:

- [ ] Every error emitted by OpenLander backend is tagged with one of the 10 class names (or `UNCLASSIFIED`).
- [ ] `UNCLASSIFIED` frequency is <5% of total errors after 2 weeks of user traffic.
- [ ] No error uses all 4 surfaces simultaneously.
- [ ] Toast surfaces (D) are only used for the 3 whitelisted cases: `CONFIG_MISSING` (save-time), `CLI_OVERRIDE_SYNTAX` (save-time), `INFRA_UNAVAILABLE`, and stream connection events.
- [ ] Each phase-end summary card has a non-generic "likely fix" line. No `check your config` — must reference the specific field or file.
- [ ] Project cards debounce crash-count updates to at most 1 update per 60s per project.
- [ ] Colorblind user testing pass with a red-green color-blind palette simulator.

If all 7 are ✓, the error UX is consistent and the "번잡" feeling is measurably reduced.

---

## Appendix A — Quick Reference Card

| Error class            | Primary surface    | Also          | Trigger                                      |
| ---------------------- | ------------------ | ------------- | -------------------------------------------- |
| CONFIG_MISSING         | D (save-time) or A | —             | Required field empty                         |
| GIT_ACCESS_DENIED      | A                  | C             | Clone fails                                  |
| BUILD_CONTEXT_MISMATCH | A                  | B             | Missing path in build                        |
| IMAGE_WRONG_STAGE      | B                  | C             | Container stuck loop w/ stage-specific error |
| DEPENDENCY_UNHEALTHY   | A                  | B             | service_healthy depend chain fails           |
| DB_EXTENSION_MISSING   | A                  | B             | SQL CREATE EXTENSION fails                   |
| PORT_CONFLICT          | A                  | B             | Bind failure                                 |
| CLI_OVERRIDE_SYNTAX    | D (save)           | A             | Invalid custom command                       |
| RUNTIME_CRASH          | C                  | D (debounced) | Container exits / HC fails post-deploy       |
| INFRA_UNAVAILABLE      | D (persistent)     | —             | Daemon / agent unreachable                   |
