# OpenLander 1.0.0 — GA Release

**Launch date:** May 1, 2026

OpenLander 1.0 is the first stable release of the self-hosted deployment platform. It targets developers who run their own infrastructure and need a unified surface for deployments, auto-recovery, and operational alerts without external SaaS dependencies. This release closes the eight rc.9 audit blockers, lands a dokploy-inspired UI pass, and hardens the security posture for LAN/remote-access deployments.

Upgrading from an earlier release: back up `~/.openlander/openlander.db` before running the new binary. No schema migrations ship in this release, but the backup lets you roll back to the prior version cleanly if needed.

## What's new in 1.0

**UI redesign** — Dokploy-inspired clean layout with unified structure across all major surfaces. Six top-level pages now share the `PageHeader` primitive (Dashboard, Projects, ProjectDetail, OpsCenter, SettingsPage, Services). Navigation uses a vertical sub-sidebar pattern on ProjectDetail and OpsCenter, matching SettingsPage. Empty-state surfaces standardized via `PageEmptyState` primitive. All Badge variants tuned for WCAG contrast ratios in both light and dark modes.

**Terminology refresh** — Operators are more familiar with "Alerts" than "Incidents", and "Alert Reports" than "Postmortems". User-facing labels changed across all pages (OpsCenter tabs, menu links, empty states, detail headers). Internal API names and database fields preserved for backward compatibility; the change is strictly UI i18n.

**Operational improvements** — Deploy-lock TTL aligned across in-memory and DB layers at 15 min (`0be8f22`), then widened to 30 min (`e43cf15`) after soak tests showed Rails / Next.js cold first-builds exceeding 15 min. Per-project in-memory lock now guards all state-changing routes (`/rollback`, `/stop`, `/archive`, `/purge`, `DELETE /projects/:id`), closing the BUG-002-class race that let a deploy-in-flight on a "running" project bypass the policy gate. Recovery-blocked events now emit explicit typed errors. `LLMUnreachableError` distinguishes network failures from provider-side degradation so the cooldown path no longer false-positives. Watchdog reconciliation handles stuck `recovering` containers.

**QA validation** — 24-hour soak test runner and metrics collector added pre-launch. Full e2e coverage on Recovery/Rollback/Blue-Green operations, Danger Actions (stop/archive/purge), OpsCenter live feed, and cross-project deploy lock contention. All major user paths verified on live infrastructure.

## Security & compliance

**SSRF hardening** — Both git clone (`src/lib/git.ts`) and MCP server URL test surfaces (`/setup/mcp/servers/:id/test`) now validate URLs against a blocklist before outbound fetch. Rejected: non-http(s)/ssh schemes, localhost/127.0.0.1/0.0.0.0/::1, link-local 169.254.0.0/16 (AWS/cloud metadata), RFC1918 ranges (10/8, 172.16/12, 192.168/16), and .local mDNS hostnames. Prevents token exfiltration via metadata service redirects or internal network scanning (`6d721c4`).

**Pre-auth response trimming** — `/api/info` now returns only `{ name: 'OpenLander' }` to unauthenticated callers; VERSION and mode available only to authenticated sessions. `/api/setup/status` collapses to `{ ready: true }` once a password is set, hiding GitHub username, LLM provider/model, and language from anonymous probes (`0b76786`).

**Password/token redaction** — All Pino logger output redacts credential field names at the stream layer: `*.password`, `*.token`, `*.api_key`, `*.auth_token`, `*.secret`, `*.access_token`, `*.refresh_token`, plus standard HTTP headers (Authorization, Cookie). Terminal logs and persisted JSON log files no longer expose secrets via stray `log.info({ user })` or `log.error({ err })` calls (`23505cf`).

**Response security headers** — Every response sets X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: no-referrer, frame-ancestors 'none', and Content-Security-Policy with strict default-src 'self'. CSP carve-outs for img/style/script/connect match the actual UI bundle. Data: URL fonts allowed for Fontsource rendering. HSTS intentionally omitted—HTTP-only deployments should let the HTTPS terminator add it (`5883df4`).

## UI redesign

- **Unified PageHeader** on Dashboard, Projects, ProjectDetail, OpsCenter, SettingsPage, Services pages
- **Vertical sub-sidebar** pattern on ProjectDetail and OpsCenter replacing left-rail layout
- **Badge semantic variants** with WCAG-tuned light/dark tokens for status indicators
- **PageEmptyState primitive** standardizing no-data and no-results surfaces across all pages
- **CircuitBreakerWidget banner** persists across all OpsCenter tabs (Live, Approvals, Alert Reports, Patterns, Usage) — previously only visible on the Live tab
- **Tab deep-linking** on SettingsPage now respects the `?tab=` query parameter, fixing broken in-app "go to Operations" links and bookmark/share flows
- **Full-width main content** — removed the misapplied `max-w-8xl mx-auto` that pinched content on wide monitors; tables and feeds now use the full available width
- **Dark-mode contrast** audited on all semantic color tokens and Badge variants

## Data model alignment (1.0 routing fix; follow-ups in 1.1+)

OpenLander's design vocabulary (per `docs/design/v1.0/GUIDE-01-IA-principles.md` §4) treats **Project** as a group/container and **Service** as the deployable unit (Application / Compose / Database). The v1 backend uses a single `projects` table for both deployable rows and compose parents, with a separate `services` table for managed databases. The vocabulary mismatch leaks into URLs and a few backend route names today.

1.0 ships a **frontend routing fix only**:

- New `/managed-services` (list) and `/managed-services/:id` (detail) routes for Postgres / MySQL / Redis / Mongo and the like — split off from `/services/:id`, which kept landing managed-service clicks on the deployable-detail view because no `?project=` query was attached. Old `/services` URLs redirect for bookmark continuity.
- No schema changes, no MCP tool renames, no REST endpoint changes. The MCP composite vocabulary (`openlander_project`, `openlander_service`) stays exactly as it was.

Follow-up work, no calendar commitment beyond "next minor releases":

- **1.1 — API compatibility layer.** New REST surfaces speaking the design vocabulary, layered on top of today's project-routes. `GET /api/projects/:id/topology` (already returns deployables under a `services` key) is the canonical extension point. MCP composite tools gain alias actions; legacy `*_project` actions remain with deprecation warnings for one major version.
- **1.2 — Schema split.** Separate `projects` (groups only) from `services` (deployable rows with `kind` discriminator: git / image / compose / postgres / etc.). Re-points dependent FKs via a remap manifest. The `/services/:id?project=:p` URL graduates to `/projects/:p/services/:s` at this point — bookmark redirect plan TBD with that release.

The full debt ledger lives at `.omc/plans/data-model-debt.md` (in the repo, not the OSS distribution) for future contributors who want to pick up alignment work.

## Operational reliability

- **Deploy-lock TTL aligned across memory + DB at 15 min (`0be8f22`), then widened to 30 min (`e43cf15`)** — closes the race window where the in-memory lock expired early, and prevents slow cold first-builds (Rails / Next.js) from timing out mid-deploy
- **Per-project lock on all state-changing routes** — `/rollback`, `/stop`, `/archive`, `/purge`, `DELETE /projects/:id` now guard against concurrent mutations with typed 409 responses (`DEPLOY_LOCKED` code) when locked (`0be8f22`)
- **LLM unreachable detection** — Network failures on auto-recovery `chatStream` surface as typed `LLMUnreachableError`, enabling proper cooldown logic instead of silent retries
- **Watchdog reconciliation** — `container-state-reconciler` properly detects stuck `recovering` rows and aligns them against actual container state, with a 60-min timeout (intentionally longer than the deploy-lock TTL)

## Breaking & behavior changes

None at the API level. User-facing terminology changes only:

- Incidents → Alerts (everywhere except API paths, which stay /api/ops/incidents)
- Postmortems → Alert Reports (everywhere except API paths, which stay /api/ops/postmortems)
- "Active Issues" / "Search issues" (in incident context) → "Alerts"

These are i18n-only; no code changes required from integrators or API consumers.

## Bug fixes

- **Fetch storm on Overview** — usePollingTask inline function in deps caused immediate re-fetch loop and 8,416 console errors. Fixed by removing task from effect deps and relying on taskRef closure (`431c72c`)
- **SettingsPage tab deep-linking broken** — `?tab=operations` and other query params ignored due to missing useSearchParams wiring. Now respects controlled tabs (`431c72c`)
- **"6d ago ago" duplicate suffix** — Overview activity wrapped formatRelativeTime() (which returns "6d ago") inside i18n wrapper expecting just "6d". Removed double wrapping (`431c72c`)
- **OpsCenterV2 tabs navigating to deleted "incidents" tab** — Buttons linked to `/operations?tab=incidents` which no longer exists. Re-pointed to `?tab=live` (`be94ed2`)
- **ServicesPage service-type chips bypassed Badge variants** — Hardcoded Tailwind colors had incorrect dark-mode contrast. Now uses Badge semantic variants (`b532626`)
- **CircuitBreakerWidget only visible on Live tab** — Banner was nested inside TabsContent, invisible when users switched to Approvals/Alert Reports/Patterns/Usage. Promoted to full-width persistent banner (`b532626`)

## Known limitations (1.0.x backlog)

The following were identified during final review and defer to 1.0.x updates:

- **English "Alerts" terminology may be reconsidered** — user feedback in first 30 days may warrant reverting to "Incidents" or adopting an alternative; i18n structure is ready for change
- **Dual-token bg-\* color migration** — ~400+ Tailwind utility occurrences remain unrewritten. Full codemod deferred to avoid introducing visual regressions; new code should use semantic Badge variants instead
- **formatRelativeTime Korean localization** — timestamp display ("6d ago") is English-only; Korean i18n keys exist but logic not yet wired. Affects Overview activity times and other duration displays
- **Incidents/Postmortem internal symbol cleanup** — API paths (/api/ops/incidents, /api/ops/postmortems), database columns, and prop names unchanged for backward compatibility; full migration to "alerts" terminology deferred to 2.0
- **PageEmptyState adoption gaps** — five known inline empty-state blocks remain. Primitives were introduced late; full adoption deferred to 1.0.1
- **NewProjectFlow PageHeader migration** — flow uses custom header bar; PageHeader primitive unification deferred to 1.0.1

For the full 1.0.x roadmap, see `docs/launchpad/1-0-x-backlog.md`.

## Upgrading

1. **Stop the running server** — `Ctrl-C` the foreground `openlander` process or `pm2 stop openlander` / `systemctl stop openlander` depending on your supervisor.

2. **Back up the database** — no schema migrations ship in 1.0, but the backup is cheap insurance if you need to roll back:

   ```
   cp ~/.openlander/openlander.db ~/.openlander/openlander.db.backup-1.0.0
   ```

3. **Upgrade the CLI**:

   ```
   npm install -g openlander@latest
   ```

4. **Restart and verify** — start `openlander` again, log in, and visit OpsCenter. All five tabs (Live / Approvals / Alert Reports / Patterns / Usage) should load without console errors, and the circuit-breaker banner should persist across tab switches if any breaker is currently open.

Rc.7 or older? Read `docs/migration-rc7-to-rc9.md` first — it includes a pre-upgrade SQL safety check for the `ai_usage_log.result` CHECK constraint that was added in 1.0.0-rc.9.

## Support

For issues, feature requests, or security reports, open an issue on GitHub or contact support@synergyn.kr.
