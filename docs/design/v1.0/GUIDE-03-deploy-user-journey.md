# GUIDE-03 — Deploy User Journey

> **Audience**: Claude Design (flow brief for connected mockups) + team validating 1.0 UX.
> **Purpose**: describe the end-to-end **first-deploy** flow, aligned to the **current** OpenLander backend (Codex-reviewed). Capabilities that require backend work are tagged with **GUIDE-00** IDs.
> **Status**: v2 draft — cut from v1 per Codex review ("cut screen-by-screen screenplay; keep one happy path, one failure path, one capability matrix"). Size target 200 lines.
> **Not a screenplay**: the 10-step dramatized flow from v1 is removed. Claude Design decides screen-level choreography; this guide gives the skeleton only.

---

## 1. Persona & Scope

### Primary persona — "Jiho, indie dev"

- Deploys side projects from his GitHub to a self-hosted VPS
- Primary driver is Claude Code / Cursor (uses OpenLander via MCP most days)
- Opens the web UI to debug, configure, or show a friend
- Will bounce if the happy path exceeds ~6 clicks OR requires reading docs mid-flow

### Out of scope for v1.0

Preview deploys, rollback wizard, blue-green, multi-server, in-UI chat agent, in-UI wizards for service creation.

---

## 2. Happy Path — "I have a repo; I want it running"

Aligned with `web/src/pages/NewProjectFlow.tsx` (the existing repo-first form, not the empty-project flow v1 assumed).

### 2.1 Flow shape

```
[Projects list]
   │  click  "+ New Project"
   ▼
[New Project form]  ← single page, not a wizard
   fields:  name (slug)
            git URL       (repo-first, not optional per DP-2)
            branch        (default: main)
            build method  (auto-detected; override in Advanced)
   primary: "Create & Deploy"
   │  submit
   ▼
[Service detail · Deployments tab]         ← auto-navigated
   Running row at top of history list
   │  click "View"
   ▼
[Log viewer modal]   (GUIDE-04)
   live phases: clone → build → run → healthcheck → done/failed
   │  terminal
   ▼
[Success banner with URL]   OR   [Failure summary card]
```

Explicit **not in this flow**: service type picker (Application/Compose/Database) as a separate step. Backend detects from repo (`docker-compose.yml` → Compose, `Dockerfile*` → Application). If detection is ambiguous, a small disclosure in the form surfaces the guess and lets user override.

### 2.2 Auto-detections at `Create & Deploy` time

| Field           | Detection logic                                                                                   | GUIDE-00 ref                   |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| Build method    | Dockerfile present → Dockerfile. Compose.yml present → Compose. Neither → error message, ask user | DP-4 (multi-stage target pick) |
| Dockerfile path | Default `Dockerfile`, or `Dockerfile.{servicename}` if matches naming (hotdeal-tracker uses this) | DP-4                           |
| Build target    | If Dockerfile has multiple `AS` stages AND one named matching service → pick it. Else ask         | DP-4                           |
| Branch          | Form default from GitHub API (`default_branch`), editable                                         | DP-1                           |
| Trigger label   | `webhook` if via URL, `manual` if from form, `mcp-agent` if from MCP                              | DP-7 (UI mapping)              |

**Nixpacks is NOT offered in v1.0** (GUIDE-00 DP-5 — 🔥 defer). Message if no Dockerfile/Compose found: `OpenLander requires a Dockerfile or docker-compose.yml in the repo. [See examples →]`

### 2.3 Confirm-before-deploy dialog

`Create` triggers a confirmation modal (copied from Dokploy):

```
Create "{name}" and deploy?
This will start building and deploying from {branch} immediately.
                              [Cancel]  [Create & Deploy]
```

Two-step friction is small (<1s added), prevents accidental deploy-everything on every typo. After confirm, server creates project record, starts deploy, navigates UI to Deployments tab of the created service.

### 2.4 Success landing

Final log line renders an inline success banner inside the stream (GUIDE-04 §6.1):

```
─── Deployment succeeded · {duration} ────────────
  Your app is live at:
    https://{service}.{sslip-ip}.sslip.io   [Copy]  [Open ↗]
    http://ol-{service}:{port}   (internal, for inter-container calls)
  [View service ↗]
──────────────────────────────────────────────────
```

The sslip.io URL is automatic (OpenLander convention) — the user doesn't configure DNS. Custom domains live in service **Domains** tab (see GUIDE-01 §4.2).

### 2.5 Failure landing

Same slot, different content — phase-end summary card (GUIDE-04 §6.3 + GUIDE-05 §4.2):

```
─── Build failed · {duration} ──────────────
  Failed phase: build  (step {N}/{M} on "{service}")
  Error class: {CLASS}           ← from GUIDE-05 §2
  Likely fix: {one-sentence actionable}
  [📋 Copy summary]  [🔁 Re-deploy]  [📝 Edit source]
──────────────────────────────────────────────
```

`Edit source` jumps back to service General tab with the relevant field focused.

---

## 3. Post-first-deploy flows (Nara's power-user paths)

### 3.1 Re-deploy — **Supported today** (GUIDE-00 DP-1)

From service General tab → `[Deploy]` button; OR from Deployments row → `⋯` overflow → `Re-deploy`. Same Confirm modal, new deploy record.

### 3.2 Rollback to a previous deploy — **Supported today** (DP-9)

From Deployments row where status = Done → `⋯` overflow → `Rollback to this deploy`. Confirm dialog: `Rollback {service} to deploy #{N} (commit {sha})? This restarts the service with that deploy's image.` Backend tool `openlander_deploy.rollback_project` already exists.

### 3.3 View runtime config — **Requires DP-8 (✅ trivial, 1.0)**

Service Advanced tab → `Runtime` sub-card. Read-only view from `docker inspect` of the live container: image tag, CMD, env vars (secrets masked), exposed ports, host port, network, volumes, resource limits, restart policy. `[📋 Copy as docker run]` button exports equivalent invocation.

**Replaces Codex-flagged Dokploy "View Docker Command"** — our version shows actual state, not what was supposed to run.

### 3.4 Cancel an in-flight deploy — **Requires DP-6 (✅ trivial, 1.0)**

From Deployments row with status = Running → inline `[Kill Build]` button (red outlined — deliberate friction). Confirm: `Kill the build? In-progress operations may leave the service partial.` On confirm, backend issues docker kill on the build container; deploy record transitions to `CANCELLED`. Log viewer connection state → `CANCELLED` (GUIDE-04 §2).

---

## 4. Edge cases (compressed)

| Case                                      | Behavior                                                                                                                                                           | Note                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Public repo, no Git provider configured   | HTTPS clone works; no auth needed                                                                                                                                  | OpenLander handles                                                       |
| Private repo, first time                  | Form shows `[Add SSH Key]` button next to repo URL; opens key generator + paste-to-GitHub instructions                                                             | DP-12                                                                    |
| Deploy click while one's running          | `Deploy` button disabled with tooltip; Re-deploy goes through Confirm modal (queues or aborts depending on backend policy, v1.0 policy: one-at-a-time per service) | Observed matches Dokploy behavior (Queue tab empty unless cross-service) |
| Deploy succeeds but health hasn't settled | Status stays `Running · waiting for health` for up to `start_period`. Success banner only on actual health pass.                                                   | DP-13                                                                    |
| Build-cache hit (every step CACHED)       | Stream header: `Built from cache · ~5s`. Pull phase skipped cleanly.                                                                                               | Handled by phase detection                                               |

---

## 5. Deploy triggers — what labels exist today, what the UI shows

Backend stores trigger enum as `chat | webhook | api`. UI maps these for clarity (GUIDE-00 DP-7):

| Backend enum | UI label    | Icon | Meaning                                                    |
| ------------ | ----------- | ---- | ---------------------------------------------------------- |
| `chat`       | `MCP agent` | 🤖   | Triggered via an MCP tool call (Claude Code, Cursor, etc.) |
| `webhook`    | `Git push`  | 🪝   | GitHub/GitLab/Bitbucket webhook fired                      |
| `api`        | `Manual`    | 🖱   | User clicked Deploy in UI                                  |

(Also rendered in deploy card row; see GUIDE-05 §4.3.)

No in-product chat UI — the MCP path leaves its trace here only. Users discover the agent integration via the Settings → MCP Integration card (GUIDE-00 AG-5) and the **Agent Command Center** indicator in the top bar (GUIDE-00 AG-3 — basic connected/disconnected state in 1.0).

---

## 6. Capability matrix cross-reference

Every interaction in this journey has a GUIDE-00 capability row. Before implementing a flow, check the matrix:

| Journey reference                     | GUIDE-00 ID                   | 1.0 status                |
| ------------------------------------- | ----------------------------- | ------------------------- |
| §2 repo-first project creation        | DP-1                          | ✅ current code           |
| §2.2 auto-detect Dockerfile/target    | DP-4                          | ✅ in (~4h backend)       |
| §2.3 Confirm-before-deploy            | DP-3                          | ✅ UI only                |
| §2.4 sslip.io auto URL                | (existing OpenLander feature) | ✅ current                |
| §2.5 failure summary with error class | ER-3 + ER-4 partial           | ✅ (6 classes), rest v1.1 |
| §3.1 Re-deploy                        | DP-1                          | ✅ current                |
| §3.2 Rollback                         | DP-9                          | ✅ current tool           |
| §3.3 Runtime config view              | DP-8                          | ✅ (~4h backend)          |
| §3.4 Kill Build                       | DP-6                          | ✅ (~0.5d backend)        |
| §5 Trigger label UI mapping           | DP-7                          | ✅ UI only                |

Anything not in GUIDE-00 is out of scope for this journey. Design can still reference deferred features for component reuse but must not expect them in 1.0 mockups.

---

## 7. Handoff to Claude Design

**Asks**:

- Clickable prototype covering §2 happy path (5 screens: Projects list → New Project form → Confirm modal → Deployments tab with log → Success banner)
- Component specs for: Confirm dialog (reused in deploy/rollback/cancel), Trigger label chips (3 variants), Runtime config sub-card (Advanced tab)
- Failure path variant of §2.5 — how the summary card inline with the stream looks

**Not asked**:

- Wizards, templates, empty-state illustrations
- Preview deploys (v1.1+)
- In-UI agent chat (never; see GUIDE-01 §7)

---

## 8. Acceptance

- [ ] New user reaches "my app is running" through the §2 happy path flow — verified with live backend
- [ ] Deploy button always routes through Confirm modal — no skip path
- [ ] Every deploy record has a trigger label from the §5 enum map
- [ ] Runtime config view reflects `docker inspect` state of the live container (not deploy spec)
- [ ] Rollback and Kill Build are accessible within 2 clicks from their respective rows
- [ ] First-time deploy works for a public repo without pre-configuring any Git provider
- [ ] Build-cache-only re-deploy (< 10s) renders cleanly without triggering error UX
- [ ] No deferred feature (Nixpacks, Watch Paths, Preview Deploys, Schedules UI) appears in the v1.0 UI
