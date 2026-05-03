# GUIDE-00 — Capability Matrix

> **Audience**: team deciding 1.0 scope · backend session picking up todos · Claude Design reading labels on guide-referenced features.
> **Purpose**: catalog every capability the UI guides (01-05) assume, mark each with current backend status, and propose a 1.0/1.1/skip decision.
> **Status**: initial draft authored from Codex review of `src/**` + `web/**` + live Dokploy observation. Needs **user confirmation** on each ⚠ item before freeze.

Background data:

- Codex technical review (2026-04-24, `.omc/artifacts/ask/codex-technical-review-*.md`) flagged 8 backend-UI mismatches explicitly.
- Hands-on Dokploy walkthrough confirmed what parity-level features users see elsewhere.
- OpenLander MCP `list_projects` + tools/list responses confirmed current backend vocabulary.

---

## 1. Legend

| Symbol | Meaning                                                                                                       | Default treatment           |
| ------ | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| ✅     | **Supported today** or **trivial** (≤1 engineer-day) — e.g., enum rename, single endpoint, one Dockerode call | **1.0 in-scope**            |
| ⚠      | **Medium effort** (1–3 engineer-days) — new endpoint + small schema / pipeline change                         | **User decides 1.0 vs 1.1** |
| 🔥     | **Hard** (≥1 week) — subsystem refactor, new runtime primitive                                                | **1.1+ defer by default**   |
| 🔒     | **Pay tier / defer** — maps to premium/enterprise surface; not in open-source 1.0                             |

---

## 2. IA & Navigation (guides 01–02)

| #    | Feature                                                  | Guide ref    | Current backend / UI                        | Effort | 1.0 decision                              |
| ---- | -------------------------------------------------------- | ------------ | ------------------------------------------- | ------ | ----------------------------------------- |
| IA-1 | Persistent Shell (identical sidebar every page)          | 01 M1        | Already the direction — `web/src/layout/**` | ✅     | In                                        |
| IA-2 | Outer-card frame on every route                          | 01 M2, 02 §4 | shadcn/ui card component exists             | ✅     | In                                        |
| IA-3 | Nouns-first sidebar (12 entries)                         | 01 §3        | UI work only; no backend change             | ✅     | In                                        |
| IA-4 | Account card + version at sidebar bottom                 | 02 §2        | Frontend only                               | ✅     | In                                        |
| IA-5 | Context widget slot in top bar (for MCP/agent indicator) | 02 §3        | Needs MCP-connection status endpoint        | ✅     | In (basic stub; detail in §6 below)       |
| IA-6 | Organization switcher top of sidebar                     | 01 §3        | Single-tenant today; reserve slot           | ⚠      | **Skip** (v1.1+) — reserve slot only      |
| IA-7 | Audit Logs route                                         | 02 §3        | No backend                                  | 🔒     | Skip (consider enterprise tier)           |
| IA-8 | Schedules route (global)                                 | 02 §3        | No backend model                            | 🔥     | Skip (see §7 for agent-first alternative) |
| IA-9 | Remote Servers route                                     | 02 §3        | Current single-host model                   | 🔥     | Skip                                      |

**User confirmation needed**: none — IA structure recommendations align with current product shape.

---

## 3. Deploy Flow (guide 03)

| #     | Feature                                                 | Guide ref      | Current state                                                                        | Effort | 1.0 decision                                                              |
| ----- | ------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| DP-1  | Legacy one-call deploy creates project + first service  | 03 §2          | `/api/projects/deploy` remains available for MCP/API convenience                     | ✅     | In                                                                        |
| DP-2  | Empty project → Add service flow                        | 03 §2 Step 4-6 | `/projects` supports name-only group creation; services are added inside the project | ✅     | In — aligns Project = group, Service = deployable                         |
| DP-3  | Deploy button → Confirm modal → auto-nav to Deployments | 03 §2 Step 8   | Dokploy's UX; easy to replicate                                                      | ✅     | In                                                                        |
| DP-4  | Build target auto-detect (multi-stage Dockerfile)       | 03 §2 Step 7   | `update_project_config` has `docker_target`; needs Dockerfile parser                 | ✅     | In (write a small parser, ~4h)                                            |
| DP-5  | Nixpacks as default build method                        | 03 §2 Step 7   | No Nixpacks pipeline integration today                                               | 🔥     | Skip v1.0 — keep Dockerfile/Compose only                                  |
| DP-6  | Kill Build button + endpoint                            | 03 §3.4        | No web endpoint                                                                      | ✅     | In (trivial `docker kill` wrapper)                                        |
| DP-7  | Trigger label in deploy history                         | 03 §5          | Backend stores `chat/webhook/api`; UI doesn't surface                                | ✅     | In — map `chat`→`mcp-agent` in UI; backend keeps enum                     |
| DP-8  | Runtime config view (from `docker inspect`)             | 03 §3.3        | Not exposed through API                                                              | ✅     | In (new read-only endpoint, ~4h)                                          |
| DP-9  | Rollback to specific deploy                             | 03 §3.2        | `openlander_deploy.rollback_project` exists                                          | ✅     | In (wire UI to existing tool)                                             |
| DP-10 | Watch Paths (selective rebuild)                         | 03 §2 Step 7   | No build system support                                                              | 🔥     | Skip v1.0                                                                 |
| DP-11 | Preview deploys (ephemeral per branch)                  | 03 §1 scope    | `preview_deploy` action exists; UI flow missing                                      | ⚠      | **User decides** — recommend: v1.1                                        |
| DP-12 | Git provider PAT mode UI                                | 03 §4.1        | Backend supports SSH + PAT flows; UI exposes Git tab already                         | ✅     | In                                                                        |
| DP-13 | Healthcheck-gated state in UI                           | 03 §4.2        | Backend tracks health; UI needs status-reflecting state                              | ✅     | In                                                                        |
| DP-14 | Deploy history filters (status/type) + search           | 03 §1          | Dokploy has it; OpenLander needs list endpoint with filter params                    | ⚠      | **User decides** — recommend: 1.0 basic (status filter), full search v1.1 |

---

## 4. Log Streaming (guide 04)

This is the area Codex flagged most aggressively. Most items are backend-refactor work. Recommendation: ship a **degraded mode** in 1.0 (current raw follow + semantic prefix overlay), full cursor-resume spec in 1.1.

| #     | Feature                                              | Guide ref     | Current state                                                                             | Effort | 1.0 decision                                                                                                             |
| ----- | ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| LS-1  | Live log stream (SSE / WebSocket)                    | 04 §2         | `/projects/:id/logs` raw follow, `tail=50`, no seq — `src/web/api/project-routes.ts:1268` | ✅     | In (current behavior ≈ CONNECTING→STREAMING transitions)                                                                 |
| LS-2  | Semantic prefix (info/success/error/debug/warning)   | 04 §3         | Backend emits raw container output; needs client-side or server-side classifier           | ⚠      | **User decides** — recommend: 1.0 with client-side regex heuristic; server-side emission v1.1                            |
| LS-3  | Cursor-based resume on reconnect                     | 04 §4.1       | No seq, no buffer                                                                         | 🔥     | v1.1 — 1.0 ships **degraded mode**: reconnect starts from new tail, UI shows `⚠ reconnect — earlier lines not recovered` |
| LS-4  | Line-count metadata (N lines total in server buffer) | 04 §4.2       | No tracking                                                                               | 🔥     | v1.1                                                                                                                     |
| LS-5  | Tab-switch 120s grace (keep WS open)                 | 04 §4.3       | Client-side only                                                                          | ✅     | In                                                                                                                       |
| LS-6  | ANSI color parsing (client-side via `anser`)         | 04 §4.4       | Backend passes through raw                                                                | ✅     | In (client-only add)                                                                                                     |
| LS-7  | Auto-scroll release on scroll-up                     | 04 §4.5       | UI state machine only                                                                     | ✅     | In                                                                                                                       |
| LS-8  | Copy/download full log                               | 04 §4.6       | Backend needs a bulk-log endpoint                                                         | ✅     | In (simple `GET /projects/:id/deploy/:id/log.txt`)                                                                       |
| LS-9  | AI-assisted log analysis button (like Dokploy)       | 04 new        | OpenLander's MCP agent covers this externally                                             | 🔥     | Skip v1.0; instead **"Copy as Claude prompt" button** (trivial, ✅)                                                      |
| LS-10 | Phase-aware emission (explicit `phase` field)        | 04 §1         | Raw docker output only                                                                    | 🔥     | v1.1 — 1.0 uses client-side heuristic pattern-match for phase detection                                                  |
| LS-11 | FSM split into connection+viewport axes              | 04 §2 (Codex) | UI state only                                                                             | ✅     | In — update GUIDE-04 FSM description                                                                                     |
| LS-12 | CANCELLED viewer state (Kill Build dependency)       | 04 §2 (Codex) | UI state                                                                                  | ✅     | In (depends on DP-6)                                                                                                     |

---

## 5. Error Handling (guide 05)

| #    | Feature                                                                                                                                                                    | Guide ref       | Current state                                       | Effort | 1.0 decision                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ER-1 | Inline error line (red) in stream                                                                                                                                          | 05 §4.1         | Client-side rendering                               | ✅     | In                                                                                                                                                                                        |
| ER-2 | Phase-end summary card with diagnosis                                                                                                                                      | 05 §4.2         | Needs error classifier (backend ideal, UI fallback) | ⚠      | **User decides** — recommend: 1.0 client-side heuristic matching the top 5 classes, server-side classify v1.1                                                                             |
| ER-3 | Deployment card error summary                                                                                                                                              | 05 §4.3         | Deploy history exists; needs error-class field      | ✅     | In (add field, default to `UNCLASSIFIED`)                                                                                                                                                 |
| ER-4 | 10 canonical error classes                                                                                                                                                 | 05 §2           | None taxonomized in backend                         | ⚠      | **User decides** — recommend: 1.0 ships 6 priority classes (BUILD_CONTEXT_MISMATCH, DEPENDENCY_UNHEALTHY, GIT_ACCESS_DENIED, PORT_CONFLICT, OOM_KILLED, CONFIG_MISSING). Remaining 4 v1.1 |
| ER-5 | Primary/secondary/tertiary surface (Codex rule change)                                                                                                                     | 05 §3 (Codex)   | UI contract change                                  | ✅     | In (spec update in GUIDE-05)                                                                                                                                                              |
| ER-6 | Split surface D into toast vs persistent banner                                                                                                                            | 05 §4.4 (Codex) | Existing toast component; add banner                | ✅     | In                                                                                                                                                                                        |
| ER-7 | 7 additional error classes (MIGRATION_FAILED, OOM_KILLED, DISK_EXHAUSTED, DOCKER_DAEMON_UNREACHABLE, NETWORK_DEPENDENCY_UNREACHABLE, HEALTHCHECK_TIMEOUT, ROLLBACK_FAILED) | 05 §2 (Codex)   | —                                                   | ⚠      | Partial in 1.0 (OOM_KILLED + DOCKER_DAEMON_UNREACHABLE as top priority), rest v1.1                                                                                                        |

---

## 6. Agent / MCP Integration (guide 01-03 notes)

| #    | Feature                                                | Guide ref             | Current state                                        | Effort | 1.0 decision                                                                                                                     |
| ---- | ------------------------------------------------------ | --------------------- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| AG-1 | MCP server running                                     | baseline              | Already in prod (`100.75.249.124:10114`)             | ✅     | Existing                                                                                                                         |
| AG-2 | Deploy trigger label shows "mcp-agent" when applicable | 03 §5                 | Backend stores `chat` enum                           | ✅     | In (UI map)                                                                                                                      |
| AG-3 | Agent Command Center indicator in top bar (Gemini rec) | 01 §3 (Gemini)        | Need MCP session activity endpoint                   | ⚠      | **User decides** — recommend: 1.0 basic connected/disconnected + last activity timestamp; rich "Waiting for commands" state v1.1 |
| AG-4 | "Copy as Claude prompt" button on error/log surfaces   | 04 new                | Client-side only                                     | ✅     | In                                                                                                                               |
| AG-5 | MCP integration guide card in Settings                 | 03 §5                 | Documentation + config snippet display               | ✅     | In                                                                                                                               |
| AG-6 | Activity feed (deploy narrations in natural language)  | DOKPLOY_HANDSON §7.D1 | Needs agent-produced descriptions stored server-side | 🔥     | v1.1+                                                                                                                            |

---

## 7. Services & Infrastructure (guide 03 parallel)

| #    | Feature                                                       | Guide ref             | Current state                                                                                                  | Effort | 1.0 decision                                       |
| ---- | ------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| SV-1 | Application / Compose / Database / Docker Image service types | 01 §4                 | `openlander_service.create_service` supports DB presets; `openlander_deploy.deploy` supports app/compose/image | ✅     | In                                                 |
| SV-2 | Template service type (Wordpress/Ghost/etc. gallery)          | —                     | Not implemented                                                                                                | 🔥     | v1.1+                                              |
| SV-3 | AI Assistant as a service type                                | —                     | Not our direction                                                                                              | —      | Skip (conflicts with agent-as-operator philosophy) |
| SV-4 | Per-service scheduled tasks (cron shell scripts)              | —                     | No model                                                                                                       | 🔥     | Skip v1.0; agent-first alternative (see IA-8)      |
| SV-5 | Volume backups (scheduled snapshots)                          | DOKPLOY_HANDSON §3.19 | No backend                                                                                                     | 🔥     | v1.1+                                              |
| SV-6 | DB backup to S3 with preset providers                         | DOKPLOY_HANDSON §3.19 | `openlander_service.backup_service` exists                                                                     | ✅     | In (wire UI)                                       |
| SV-7 | Patches (build-time file mutations)                           | DOKPLOY_HANDSON §3.19 | No backend                                                                                                     | 🔥     | v1.1+                                              |
| SV-8 | Deploy queue across services                                  | DOKPLOY_HANDSON §3.12 | Current UI prevents concurrent-same-service via disabled button; different-service serial already works        | ✅     | In (documented in GUIDE-03 §4.3)                   |

---

## 8. Monitoring & Observability

| #    | Feature                                   | Guide ref                     | Current state                                         | Effort | 1.0 decision                                 |
| ---- | ----------------------------------------- | ----------------------------- | ----------------------------------------------------- | ------ | -------------------------------------------- |
| MO-1 | Server-level CPU/Mem/Disk charts          | DOKPLOY_HANDSON §3.6          | Metrics endpoint present                              | ✅     | In                                           |
| MO-2 | Per-service CPU/Mem charts                | DOKPLOY_HANDSON §3.19         | Per-container metrics via Docker API                  | ✅     | In                                           |
| MO-3 | Traefik request log (opt-in activate)     | DOKPLOY_HANDSON §3.13         | Traefik exposes access log; opt-in gate is UI concern | ⚠      | **User decides** — recommend: 1.0 omit; v1.1 |
| MO-4 | Active-incidents banner (crash-loop, OOM) | DOKPLOY_HANDSON §1 (MCP data) | MCP initialize already returns incidents list         | ✅     | In (surface as banner + Home card)           |

---

## 9. Out-of-scope for 1.0 (explicit defer)

- Multi-user / Users page / Invitations
- Audit Logs (Dokploy ships this as Enterprise paywall)
- Remote Servers / Multi-host
- Tags for project organization (v1.1 — cheap, just not urgent)
- Notifications providers (Discord/Slack/Telegram/...)
- Organizations (multi-tenancy)
- Templates gallery
- Preview Deployments (ephemeral per-branch)
- Wizard-style service creation (simple form sufficient per GUIDE-03)

---

## 10. Backend Work-List (sorted by 1.0 priority)

Hand this list to the backend session.

### Priority 1 — must ship for 1.0 (~5-7 days total)

1. **Kill Build endpoint** `POST /projects/:id/deployments/:id/kill` — docker kill wrapper (DP-6) — ~0.5d
2. **Runtime config read endpoint** `GET /projects/:id/runtime` — returns `docker inspect` subset (DP-8) — ~0.5d
3. **Trigger enum display mapping** (UI work; backend unchanged) (DP-7) — ~0.2d
4. **Error class field** on deploy record + populator (top 6 classes via heuristic) (ER-3, ER-4 partial) — ~1.5d
5. **Bulk log download endpoint** `GET /projects/:id/deployments/:id/log.txt` (LS-8) — ~0.3d
6. **Dockerfile parser for target auto-detect** (DP-4) — ~0.5d
7. **MCP connection status endpoint** (AG-3 basic) — ~0.3d
8. **Deploy list with status filter** (DP-14 basic) — ~0.8d
9. **Active incidents surfaced in API** (already in MCP; just expose via web API) (MO-4) — ~0.5d

### Priority 2 — if slack (v1.1 candidate)

- Cursor-based log stream with seq + buffer (LS-3)
- Phase-aware log emission (LS-10)
- Semantic prefix emission from backend (LS-2)
- 4 more error classes backend classification (ER-7)
- Agent Activity feed (AG-6)
- Deploy queue indicator endpoint

### Explicit defers (v1.1+)

- Nixpacks pipeline (DP-5)
- Watch Paths (DP-10)
- Schedules subsystem (SV-4)
- Templates (SV-2)
- Preview deploys UI wiring (DP-11)
- Multi-user / Organizations
- Audit logs

---

## 11. Questions Needing User Confirmation (before guides are refrozen)

⚠ items where I made a recommendation but user should ratify:

1. **DP-2 Empty project flow** — ratified for 1.0; Project is a group, not a repo.
2. **DP-11 Preview deploys** — recommend v1.1. Agree?
3. **DP-14 Deploy list filters** — recommend status filter in 1.0, full search v1.1. Agree?
4. **LS-2 Semantic prefix** — recommend client-side heuristic in 1.0. Agree?
5. **ER-2 Phase-end diagnosis card** — recommend client-side heuristic for top 5 classes in 1.0. Agree?
6. **ER-4 Error class count for 1.0** — recommend 6 (BUILD_CONTEXT_MISMATCH, DEPENDENCY_UNHEALTHY, GIT_ACCESS_DENIED, PORT_CONFLICT, OOM_KILLED, CONFIG_MISSING). Agree? (Codex listed 7 additional; we're picking 2 more priority)
7. **AG-3 Agent Command Center depth** — recommend basic connected/last-activity in 1.0. Agree?
8. **MO-3 Traefik request log** — recommend omit entirely v1.0. Agree?
9. **IA-6 Organization switcher** — recommend reserve slot, don't implement. Agree?

Getting yes/no on these 9 lets us freeze guides.

---

## 12. Guide Revision Checklist (what these decisions drive)

After this matrix is confirmed:

- **GUIDE-01** small tweak: confirm Agent Command Center slot placement (AG-3)
- **GUIDE-02** small tweak: confirm outer-card exception for log viewer (Gemini concern on horizontal space)
- **GUIDE-03** MAJOR rewrite: drop empty-project flow (DP-2), drop Nixpacks default (DP-5), drop Watch Paths (DP-10), rename Trigger vocabulary (DP-7), add capability-labels to each step
- **GUIDE-04** REWRITE of FSM section: split connection+viewport axes (LS-11), add CANCELLED state (LS-12), note degraded-mode reconnect (LS-3) with v1.1 upgrade path, client-side ANSI parse only (LS-6)
- **GUIDE-05** ADDITIONS: 7 new error classes (ER-7) with 1.0/v1.1 labels, surface-rule relax (ER-5), split D surface (ER-6)

Estimated rewrite time once §11 confirmed: ~2.5h.
