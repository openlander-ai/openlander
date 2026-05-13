# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Hardened the installer update path so `update` preserves the existing Compose
  project name, pulls only the OpenLander runtime image, and recreates only the
  app container instead of disturbing the Postgres sidecar.
- Added `OPENLANDER_PUBLIC_HOST` support for advertised app URLs, avoiding
  container-private bridge IPs in Docker installs.
- Added `preferred_url` to project/deploy responses so agents can use the
  canonical app URL without interpreting the full `urls` array.
- Made `deploy_app` the MCP app-deploy front door: it creates new apps when
  `repo_url`/`image` is provided, and routes existing app targets to redeploy
  when `service_id`, `service_name`, or a single-service project `name` is
  provided.
- Removed `archive_service` and `unarchive_service` from the default MCP
  composite surface; archive/restore remains available through the web/API
  lifecycle.

### Fixed

- Made `deploy_app` report `readiness` and return `status: "unhealthy"` when a
  running container's Docker healthcheck is failing instead of treating it as a
  successful deploy.
- Stopped GitHub repo discovery MCP responses from returning credentialed clone
  URLs; private repo credentials are now kept internal to clone time.
- Reduced infrastructure analyzer false positives by no longer treating generic
  ORM packages as PostgreSQL, and by reading Prisma datasource providers and
  `DATABASE_URL` schemes instead.
- Removed `postgresql://localhost` deploy-plan placeholders; planned or reused
  managed services now satisfy required env vars and inject real connection
  strings at execution time.
- Normalized MCP targeting for logs, stats, diagnostics, deploy history, build
  logs, host probes, action status, and managed-service status/credentials.
- Allowed deployable-service MCP actions to resolve `service_name` as the
  project group name when that group has exactly one deployable service.
- Extended the same single-deployable project-name fallback to deployable env
  variable actions.
- Added `deploy_id`/`job_id` lookup to `get_deploy_status` so completed deploys
  and unknown ids are distinguishable.
- Improved `diagnose_service` HTTP probes for apps mounted under a base path
  such as `NEXT_PUBLIC_BASE_PATH=/admin`.
- Accepted `health_check_path` as an alias for `diagnose_service.path`.
- Kept deployable app/worker services out of managed-service MCP responses and
  return explicit guidance when a managed-service action receives one.
- Increased Docker disk-usage timeout to avoid false cleanup preflight failures
  on slower hosts.

## [0.1.1-rc.6] — 2026-05-13

### Fixed

- Preserved explicit MCP-provided database/cache env vars during deploy planning
  so external `DATABASE_URL`/`REDIS_URL`-style values do not trigger managed
  service provisioning or credential overwrite.
- Accepted MCP env var inputs as either objects or JSON-stringified objects for
  deploy planning and `set_env_vars`.
- Fixed managed service creation on fresh Postgres installs by ensuring the
  synthetic managed-service group exists before inserting service rows.
- Rolled back managed service containers and volumes if service persistence
  fails after Docker resources have already been created.
- Added a Linux `/proc/net/tcp{,6}` fallback for port scanning when `ss` is not
  installed.
- Surfaced deployable service identifiers in MCP `list_projects` output so
  agents can chain directly into `openlander_service` actions.
- Stored freshly created managed services with canonical `source='image'`.

## [0.1.1-rc.5] — 2026-05-13

Release candidate with onboarding and MCP token setup polish, plus the
post-rc.4 UI and CI follow-ups that were missed in the previous cut.

### Changed

- Moved language selection out of the setup wizard and into the login/account
  chrome so first boot focuses on account and MCP setup.
- Made MCP token issuance explicit during setup so users understand when a
  token is created and where to copy it.
- Tightened GitHub Actions concurrency and trigger scopes to reduce duplicate
  workflow runs.

### Fixed

- Straightened the `/login` to `/setup` handoff and clamped setup wizard steps
  to the live setup status.
- Added a development-loud SetupGuard fail-open path for easier local QA when
  setup state and route state drift.
- Aligned the Service Detail Domains tab with shared form and card primitives.

## [0.1.1-rc.4] — 2026-05-13

Release candidate with MCP diagnostic sanitization hardening and follow-up UI
polish for confirmation/setup surfaces.

### Fixed

- Hardened `openlander_monitor.diagnose_service` sanitization for additional
  secret-like tokens, including cloud-provider credentials in log tails and
  diagnostic errors.
- Aligned `ConfirmDialog` styling with the OpenLander dashboard visual system.
- Fixed the invisible Connect GitHub label in setup infrastructure chrome.

## [0.1.1-rc.3] — 2026-05-12

Release candidate with MCP deploy action vocabulary cleanup and token
confirmation-dialog polish.

### Changed

- **Breaking (MCP):** renamed `openlander_deploy.deploy` to
  `openlander_deploy.deploy_app` and `openlander_service.deploy_service` to
  `openlander_service.redeploy_app`. `create_service` remains the managed
  infrastructure action for databases, caches, and storage.

### Fixed

- Replaced the browser-native token regeneration confirmation with the
  OpenLander `ConfirmDialog` so the token flow stays inside the dashboard UI.

## [0.1.1-rc.2] — 2026-05-12

Release candidate with MCP diagnostics and post-rc.1 UI copy hardening.

### Added

- `openlander_monitor.diagnose_service`, a read-only MCP diagnostic action for
  deployable services. It returns masked env key inventory, build-time env
  warnings, sanitized recent deploy/build log tails, sanitized runtime logs,
  container status, HTTP probe results, dependency probes, and suggested next
  actions.
- `deploy_service` now returns a concrete `diagnostic_call` pointing to
  `openlander_monitor.diagnose_service` for agents to use when an async redeploy
  fails or times out.

### Changed

- `openlander_deploy.deploy` guidance now more clearly distinguishes new app
  creation from existing service redeploys and points agents to
  `openlander_service.deploy_service` with a concrete service id when possible.
- Korean/English UI copy sweeps were completed across remaining navigation,
  timeline/logs, Git provider/OAuth, resources, add-service, service-delete, and
  project chrome surfaces.

### Fixed

- MCP service diagnostics scrub credentialed URLs and common secret-like
  assignments from diagnostic log tails and probe errors.
- The add-service template `Soon` label is localized in Korean.

## [0.1.1-rc.1] — 2026-05-12

Release candidate for the first 0.1 patch line. This RC focuses on custom
domain routing, MCP/onboarding polish, release automation hardening, and public
repository safety checks.

### Added

- Service-level custom domain management with database-backed mappings, path
  prefixes, optional upstream prefixes, target-port overrides, and dynamic
  Traefik config generation.
- Domains tab UI for service detail pages, including add/delete flows and
  advanced path/port controls.
- Multi-vendor MCP client setup tabs and a clearer Your Agent surface.
- Account popover language switching for Korean/English.
- Public release secret scanning with gitleaks and documented branch-naming
  policy.

### Changed

- Release publishing now supports release candidates without moving `latest`;
  prerelease tags publish immutable version images plus the moving prerelease
  channel tag.
- CI workflows were throttled to reduce duplicate release-gate and scan runs.
- Korean and English UI copy was swept across setup, navigation, project,
  service, Web Server, MCP, and account surfaces.
- Raw `npm run release` is guarded; maintainers must explicitly choose
  `npm run release:rc` or `npm run release:final`.

### Fixed

- Custom domain routing now resolves by service id rather than project id, which
  keeps multi-service project routing correct.
- v0.1 baseline migration guards now fail fast on incompatible pre-public
  dogfood databases and are covered by integration tests.
- Setup password minimum was lowered to eight characters.

## [0.1.0] — 2026-05-09

First public release.

OpenLander is a self-hosted deployment platform: paste a Git URL, get a deploy. The 0.1 release is MCP-first: Claude Code, Cursor, Codex, OpenCode, and other external agents can inspect logs/status and call deploy/service/config actions through the MCP server.

This is an early release — expect breaking changes between 0.x versions. Production use is supported but configurations and APIs may evolve based on user feedback.

### Architecture

- **Platform metadata: PostgreSQL via Docker Compose.** OpenLander now ships with a managed `postgres:16-alpine` container alongside the application; the previous embedded SQLite (`better-sqlite3`) datastore has been removed. The recommended self-hosted runtime is `docker compose up`; the npm CLI path is supported for development with a user-provided `OPENLANDER_DATABASE_URL`. Aligns with industry pattern (Coolify, Dokploy).
- **Project = group, Service = deployable.** Repository, image, build, and runtime actions are now owned by services. Projects are workspace groups only.

### Removed

- **Breaking:** removed project-level runtime MCP actions: `stop_project`, `start_project`, `restart_project`, `redeploy_project`, `rollback_project`, `archive_project`, `unarchive_project`, and `update_project_config`. Use `stop_service`, `start_service`, `restart_service`, `deploy_service`, `rollback_service`, `archive_service`, `unarchive_service`, and `update_service_config` instead.
- **Breaking:** project-level runtime HTTP routes now return `410 PROJECT_RUNTIME_ACTION_REMOVED`: `POST /api/projects/:id/start`, `/stop`, `/redeploy`, `/rollback`, and `/blue-green`. Use the canonical service runtime routes under `/api/projects/:projectId/services/:serviceId/*`.

### Highlights

**Deployment**

- Git → Docker → URL pipeline. Auto-detects ports, proxies, containers before deploying.
- Auto-Dockerfile for 28+ frameworks (Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust, etc.) when no Dockerfile is present.
- Docker Compose support — multi-service projects via `docker-compose.yml`.
- Monorepo support — scan multiple Dockerfiles, parallel builds, parent-child project model.
- Real-time build log streaming with ANSI color rendering.
- Blue-green redeploy with health check + one-click rollback.
- Per-project deploy locks prevent concurrent mutations.

**Web Dashboard**

- Project overview, deployments list, activity feed.
- Service detail with the v0.1 6-tab IA (Overview / Logs / Deployments / Monitoring / Environment / Domains).
- xterm.js web terminal for `docker exec` from the browser.
- MCP Server status page surfacing connected agents.
- Korean / English UI (toggle during onboarding).

**Built-in AI Ops**

- Built-in LLM provider setup, web-agent chat, token usage tracking, and automatic AI remediation are disabled in 0.1.
- Disabled AI endpoints return `410 FEATURE_DISABLED` instead of partially running.
- External MCP agents remain the supported automation path: read logs/status, decide what to change, and call explicit MCP actions.
- The internal AI Ops/recovery modules remain cold-storage code for a future product decision and are not started by the 0.1 runtime.

**MCP Integration**

- 64 unique default operations exposed through 5 composite MCP tools (`openlander_deploy`, `openlander_project`, `openlander_service`, `openlander_managed_service`, `openlander_monitor`) with an `action` parameter for sub-operations.
- 13 platform debugging tools available behind a config flag.
- Three transports: stdio (local), Streamable HTTP (`POST /mcp`), and SSE (`GET /mcp/sse`) for clients on the older standard.
- Bearer token auth on remote transports.

**Infrastructure**

- Postgres-backed OpenLander runtime with Docker Compose deployment and a
  dedicated persistent database volume.
- Traefik reverse proxy with auto-routing per project.
- Cloudflare Tunnel (production) and TryCloudflare (quick share) for public exposure.
- Managed services: PostgreSQL, MySQL, Redis, MongoDB, MinIO containers on demand.
- SSH key auth for private Git repos (GitHub, GitLab, Bitbucket, Gitea).
- Environment variables: project-scoped and global encrypted secrets.

**Authentication & Security**

- Password login with session cookies.
- Bearer token auth for remote MCP.
- SSRF hardening on git clone and outbound URL test surfaces.
- CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options on every response.
- Pino logger redacts credential field names (`*.password`, `*.token`, `*.api_key`, etc.) at the stream layer.

### Known limitations

- Single-tenant only. Multi-user and role-based access control are not in scope.
- No built-in AI auto-recovery or web-agent chat in 0.1. Recovery decisions are explicit MCP/user actions, not background LLM automation.
- Korean localization for relative-time strings (`6d ago`) is incomplete; affects the activity feed.
- The `0.1.0` database schema is the first public Postgres baseline. Pre-public dogfood
  databases with older OpenLander migration histories are not upgraded in place; start from a
  fresh Postgres volume or manually export/import data.
- No log rotation, rate limiting, or LLM token spend cap. Recommended for single-developer / small-team use.
- Windows is not supported. WSL2 on Windows works.

### What's next

User feedback in the first 30 days drives 0.2.x priorities. Likely candidates: tighter MCP observability (per-tool counters), runtime metrics snapshot table, Operations Center / built-in AI Ops revival if there is demand, log rotation, rate limits.

---

Earlier internal pre-release history is intentionally not enumerated here. This is OpenLander's first public release.
