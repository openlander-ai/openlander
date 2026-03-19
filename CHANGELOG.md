# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Non-blocking `execute_deploy_plan` — calls `startDeploy()` instead of blocking `deploy()`, returns immediately with `{ status: "building", estimated_seconds }` so agents can poll via `get_deploy_status`
- Deep repo analysis in `create_deploy_plan` — parses docker-compose.yml services (name, dockerfile, port), scans multiple Dockerfiles, detects env vars from `.env.example`/`.env.sample`/`.env.template`/Dockerfile `ARG` with source attribution, warns on missing volume mount files
- Full plan details in `create_deploy_plan` response — exposes `build` (method, compose_services, dockerfiles_found), `services[]`, `env.detected[]` with source info instead of thin summary
- `dockerfile_path` and `docker_target` parameters for `create_deploy_plan` — supports monorepo and multi-stage Dockerfile builds
- `estimated_seconds` in `execute_deploy_plan` response — based on previous deploy `duration_ms` from DB, defaults to 60s
- Event-driven plan status completion — `deploy:success`/`deploy:failed` listeners automatically transition plan status after async deploy finishes

### Fixed

- Pre-existing compose test failures — `--progress=plain` flag assertion mismatch (5 tests)
- Pre-existing `remove_service` test failure — `warning` field strict equality (1 test)

## [0.6.3] - Port Stability & API Fix

### Added

- Port preservation on redeploy — `allocatePort()` now accepts `preferredPort` option, and `redeploy()` passes the previous port so projects keep the same port across redeploys
- `getUsedPorts()` now queries both `projects` and `environments` tables, preventing UNIQUE constraint collisions from orphaned environment port records

### Fixed

- Project detail API (`GET /api/projects/:id`) now returns `publicUrl` and `repoUrl` in camelCase — previously returned raw snake_case (`public_url`, `repo_url`) causing the web UI to lose public URL on browser refresh
- `remove_project` tool description now warns that port assignment is lost on removal, guiding AI agents to use `restart_project` instead

## [0.6.2] - Compose, Env Escaping, Traefik HTTP Provider

### Added

- `compose_services` parameter for `deploy_project` — deploy specific docker-compose services (e.g., `["backend"]`) instead of all
- Secret file mounting for compose containers via docker-compose.override.yml volume binds
- Global secrets now passed to compose deploys via `deploy_compose` tool
- Verbose Docker build output for preview and blue-green deployments (onProgress callback)
- `--progress=plain` flag for compose builds — full Docker build output in logs
- Traefik HTTP Provider — dynamic routing config served via API endpoint instead of file watching, fixing custom domain routing on macOS Docker Desktop and Windows WSL where bind mount inotify doesn't propagate
- Redeploy port collision fix — environment `assigned_port` now reset alongside project during redeploy
- Build failure responses include `buildLogTail` (last 30 lines) for immediate error diagnosis

### Fixed

- Env var escaping in `.env` files — newlines, `$`, backticks, quotes, and backslashes now properly escaped for both compose and env-inject paths
- Compose containers now receive uploaded secret files (previously only regular Docker deploys did)
- Redeploy no longer fails with `UNIQUE constraint failed: environments.assigned_port` — environment port is now reset alongside project port during redeploy
- Build failure responses now include `buildLogTail` (last 30 lines) so error cause is visible without calling `get_build_log`
- Traefik migrated from File Provider to HTTP Provider — eliminates file watching issues on macOS/Windows Docker Desktop where inotify doesn't propagate through bind mounts
- Quick-share tunnel routing now served via HTTP Provider API instead of YAML files

## [0.6.1] - Bugfix

### Fixed

- `set_env_vars` now merges with existing variables instead of replacing them — previously, calling `set_env_vars` with new keys would delete all previously set variables
- `deploy_project` env_vars now merge with existing project variables instead of replacing — variables from both `deploy_project` and `set_env_vars` are preserved across redeploys
- `provision_database` env vars (DATABASE_URL, etc.) now merge with existing project variables instead of replacing
- Health monitor no longer marks non-HTTP workers (e.g., arq, Celery) as unhealthy — falls back to Docker container state check when HTTP health check fails

### Added

- `list_env_vars` tool — list all environment variables for a project with masked values for security
- `mergeEnvVars()` database method for additive env var updates without deleting existing keys

## [1.0.0] - First Stable Release

### Added

- Auto-Dockerfile templates for Ruby on Rails (multi-stage, non-root, guarded asset precompile)
- Auto-Dockerfile templates for Spring Boot and plain Java (Maven and Gradle, Temurin JDK/JRE multi-stage)
- Auto-Dockerfile templates for Laravel and plain PHP (Composer, non-root, socket-based healthcheck)
- Auto-Dockerfile templates for ASP.NET and plain .NET (SDK/runtime multi-stage, first-sorted csproj)
- Build failure recipes for Ruby/Rails (Bundler resolution, native extension compile, asset precompile)
- Build failure recipes for Java/Spring (Maven/Gradle dependency resolution, unsupported class file version)
- Build failure recipes for PHP/Laravel (Composer platform requirements, missing extensions, package conflicts)
- Build failure recipes for .NET (SDK version mismatch, NuGet restore failure)
- Preflight warning check for `.env.example` completeness — surfaces unconfigured keys before deploy
- Preflight warning check for Dockerfile syntax sanity (`FROM`, `CMD`/`ENTRYPOINT`, scratch-copy guard)
- `PreflightOptions` (`projectPath`, `dockerfilePath`, `configuredEnvVars`) for deterministic preflight testing
- Vitest coverage configuration with `v8` provider and per-metric thresholds (lines 60%, branches 55%, functions 55%)
- `npm run test:coverage` script for CI coverage gate enforcement
- MCP `agent_execute_goal` tool — external clients (Cursor, VS Code) can delegate multi-step goals to the AI agent
- Channel streaming with real-time message editing (Slack `chat.update`, Discord `PATCH`, Telegram `editMessageText`)
- Channel interactive components for agent questions (Slack blocks, Discord ActionRow+Button, Telegram InlineKeyboard)
- QuestionBridge wiring for channels with 5min timeout and rate-limited message editing (1.5s)

### Changed

- Removed TUI runtime entirely (`src/tui/`, `--tui` CLI flag, `OPENLANDER_TUI` env var, SolidJS/OpenTUI build plugins)
- Removed TUI-only ESLint override and dead TUI/IPC legacy test files (2,451 lines)
- Preflight warning checks are advisory-only (`pass: true`) and do not block deployment
- Module loggers added to `service-manager`, `orchestrator`, `setup-routes`, and `domain-routes` for consistent diagnostics

### Fixed

- Bare catch blocks across pipeline and web modules now log at `debug` level instead of silently swallowing errors
- CLI commands standardized to use project logger instead of `console.error`
- Duplicate unreachable `return` statements removed from `readPackageJson` and `readTextIfExists` catch blocks in `dockerfile-gen.ts`
- questionBridge not passed on hot-reload Agent creation (setup-routes, auth-routes, mcp/server)
- scanTool.execute type safety in MCP server's scan_dockerfiles handler

## [0.5.2] - Bugfix

### Fixed

- Dockerode CJS/ESM import crash — `require('dockerode').default` was `undefined`, causing `TypeError: DockerodeClass is not a constructor` on startup

### Added

- Release automation with `release-it` and `@release-it/keep-a-changelog`
- Git tags for all historical releases (v0.1.0 through v0.5.1)

### Changed

- Synced `web/package.json` version with root package
- Restructured CHANGELOG.md: moved `[Unreleased]` section to top, added missing `[0.5.1]` section

## [0.5.1] - Multi-Environment Support

### Added

- Environment schema and multi-environment database support
- Environment injection and scanning in deploy pipeline
- Environment-aware deploy orchestration integration
- Environment management REST API routes
- Environment support in webhook processing
- Web UI: environment selector, inheritance display, select component
- TUI: environment context and UI updates
- E2E and unit tests for environment support

## [0.5.0] - Agent Enhancement & Pipeline Orchestration

### Added

- `DeployOrchestrator` integration for `deployMonorepo()` with topology-ordered execution and automatic rollback on child failure
- `DeployOrchestrator` integration for `deployCompose()` with per-service `--no-deps` deployment, strict health gating for dependents, and rollback via `compose stop/rm`
- Backend stream-boundary sanitizer that recursively masks env-style objects and secret-like fields in `agent_tool_result` NDJSON payloads before they reach the browser
- Collapsible tool-call arguments display in timeline items, reusing the existing `sanitizeToolArguments` pipeline
- Structured tool-result card renderers (`ToolResultCard`) for `deploy_project`, `list_projects`, `get_logs`, `get_system_stats`, `set_env_vars`, and a JSON fallback viewer
- HTTP-level regression test proving masked tool-result output in the deploy stream
- Timeline item rendering tests for collapsed/expanded argument blocks

### Changed

- `deployMonorepo()` now enforces dependency ordering and rollback semantics through the orchestrator instead of raw `Promise.all`
- `deployCompose()` now routes service startup through orchestrator topology with health-gate progression instead of a single `docker compose up -d --build`
- Compose health checks now treat `stopped` dependencies as blockers only when they have dependents, preserving backward compatibility for leaf/one-shot services

## [0.4.1] - Console Log Readability

### Added

- Shared console state contract with typed `ConsoleStreamState` model
- Console fixture builders for deterministic testing
- Terminal availability state machine for clearer show/hide/unavailable states

### Changed

- Console tab now defaults to log-first view with an explicit terminal toggle
- Console log viewer UX improved with localized state copy and expanded stream model
- ANSI text handling normalized across console components

## [0.4.0] - Deployments UX & Time Normalization

### Added

- Deployments status filters for `all`, `failed`, `success`, and `in_progress`
- Shared deployments helper layer and polling hook for row/detail formatting and tab data loading
- Regression coverage for normalized timestamp handling in both frontend utilities and web API routes

### Changed

- Deployments list now surfaces richer metadata including status pills, branch fallback, duration, and inline failure summaries
- Deployment detail now shows stronger top-level metadata with precise absolute time context
- Browser-side time formatting now safely parses normalized API timestamps and legacy SQLite-style values

### Fixed

- Project and deployment API responses now normalize exposed timestamps to ISO UTC strings at the API boundary
- Deployments loading failures now present a recoverable retry state instead of a dead-end empty view

## [0.3.1] - UI Polish & Terminal Fallback

### Added

- Terminal shell fallback regression tests covering bash success, sh fallback, and distroless no-shell handling

### Changed

- Overview now shows summary dashboard cards for stable states and reserves timeline/log preview for `building` and `error` states
- Console now prioritizes logs with terminal hidden behind an explicit toggle by default

### Fixed

- Terminal shell detection now probes `/bin/bash` and `/bin/sh` before opening an interactive exec session, preventing garbled OCI errors on Alpine/slim images
- Missing postmortem responses now return `204 No Content`, removing noisy browser console 404s when no report exists

## [0.3.0] - Developer Experience

### Added

- Real-time Docker build output streaming via SSE (`build:output` event with 50ms throttle)
- ANSI escape sequence rendering as colored HTML in LogViewer, LogPreview, and DeploymentDetail
- Web terminal (xterm.js) with WebSocket connection to Docker exec for container shell access
- Terminal security: origin validation, rate limiting (100 msg/s), 30-minute idle timeout
- WebSocket infrastructure via `@hono/node-ws` with `createNodeWebSocket`
- Full Docker build output stored in `deploy_logs.build_log` (previously only 4 summary lines)
- Terminal tab in ProjectDetail with connection state management and reconnect button
- ANSI utility module (`web/src/lib/ansi.ts`) with `parseAnsiLine()` and `stripAnsi()`
- 19 new backend tests: terminal message routing, idle timeout, rate limiting, build event streaming

## [0.2.7] - Pre-build Diff Analysis

### Added

- Pre-build diff analysis: on redeployments, analyze git diff to identify build-impacting file changes (Dockerfile, dependencies, env templates, runtime configs)
- `deploy:diff-analyzed` event with structured payload (changed files, impact flags, commit range)
- Build failure diagnosis now includes recent changes context — AI correlates errors with specific file changes
- Agent prompt section `## Build Diff Analysis` guides AI to use diff context during auto-recovery
- `formatDiffForPrompt()` formats diff analysis for human-readable agent context injection
- 14 unit tests for diff-analysis module (BUILD_IMPACT_PATTERNS, analyzeBuildDiff, formatDiffForPrompt)

## [0.2.6] - Shared Mode & PR Preview

### Added

- Traefik File Provider for dynamic routing (Docker labels + file-based YAML configs)
- Quick Share via Traefik reverse proxy (replaces direct container port exposure)
- Shared Mode with access codes for authenticated public sharing
- PR Preview deployments with TTL-based auto-cleanup
- Production custom domain YAML generation via Traefik File Provider
- Project status sync: container crash → error status, 3 consecutive health failures → error status
- UI reactivity: DomainsPanel and DeploymentsList re-fetch on project status change
- AI co-pilot features — 7 backend modules + inline frontend integration
  - Auto incident report: recovery events → Slack/Discord/Telegram channel broadcast
  - Rollback watcher: 60s post-deploy health monitoring → rollback suggestion on 3 consecutive failures
  - Env var change detection: .env.example scan on redeploy → prompt for new key values
  - Auto postmortem generation: markdown report after recovery (success or exhausted)
  - Secret scanning: hardcoded API keys/credentials detection after git clone
  - Enhanced success insight: build time comparison against 20% historical threshold
  - Inline AI analysis: build failure → AI analysis in same timeline flow (no separate panel)
- PostmortemCard UI component with expand/collapse markdown viewer
- Cloudflare 2-step connect flow (TryCloudflare + Cloudflare Tunnel per-project expose)
- Cloudflare Settings configuration form (API token input UI + backend API)
- Comprehensive tests for AI co-pilot modules — 50+ new tests (secret-scan, postmortem, rollback-watcher)
- Shared test helpers: `test/helpers/docker-mocks.ts`, `test/helpers/web-route-mocks.ts`

### Changed

- Removed unused @opentui/core dependency
- Removed redundant @types/bcryptjs — bcryptjs@3.0.3 bundles its own type declarations
- Simplified i18n: removed 224 short keys, hardcoded in English, kept 101 long sentence keys translated
- Renamed "인터넷에 공개" → "Publish" per i18n policy (short labels stay in English)
- Removed 11 dead TUI/IPC legacy test files (2,451 lines) — TUI is `--tui` legacy mode only
- Extracted shared mock factories from traefik, preflight, and web-routes tests to reduce duplication
- Test suite: 48 files (783 tests) → 37 files (535 tests) after dead test removal

### Fixed

- Cloudflare DNS: use PATCH instead of PUT for record updates (PUT not allowed with API tokens)
- Cloudflare DNS: handle pre-existing A/AAAA records when adding CNAME domain (upsert pattern)
- Cloudflare Tunnel: use correct `cfd_tunnel` API path (was using `tunnels/`, causing 405 errors)
- TryCloudflare: auto-retry quick tunnel on transient 500 errors (3 attempts with exponential backoff)
- TryCloudflare: show user-friendly error in ShareDialog when service is unavailable
- Traefik: auto-recreate container when config is outdated (missing File Provider)
- Traefik: ensure `traefik/dynamic` directory exists before writing YAML configs
- Stale tunnel cleanup: clear quick-share/shared tunnel state on app restart
- Added `.gitattributes` with `merge=ours` for package-lock.json (prevent cross-platform conflicts)
- Agent concurrency: serialize chatStream calls via promise chain queue
- Recovery timeout increased from 120s to 300s for long builds
- Removed agent.clearHistory() that poisoned unrelated sessions
- Added 6 secret scan patterns (sk-proj-, github_pat-, ASIA, xoxb/p/s)
- Rollback prompt parameter mismatch (projectId → project_name)
- Wrapped all fire-and-forget chatStream calls with .catch() for error handling
- Secret redaction in postmortem before sending to LLM
- Resource cleanup: stop() + unsubscribe for RollbackWatcher, IncidentReporter, PostmortemGenerator on shutdown
- Blue-Green button label hardcoded per i18n policy
- Addressed Oracle code review findings: Docker network name from config, removed dead pipeline code, split routes.ts into domain modules
- Removed unused `removeProject` mock from web-routes tests (dead code — actual method is `remove()`)

## [0.2.5] - Release Preparation

### Added

- Code review fixes from external audit

### Changed

- Simplified i18n: removed 224 short keys, hardcoded in English, kept 101 long sentence keys translated
- Fixed sidebar breakpoint (labels visible at 1024px instead of 1280px)
- Fixed Services empty-state button handler inconsistency
- Moved branding to header with SVG logo and version display
- Changed default port from 10003 to 10114

### Fixed

- Docker network name from config
- Removed dead pipeline code (5 files)
- Split routes.ts into domain modules
- Cloudflare Settings configuration form (API token input UI + backend API)

## [0.2.4] - Shared Services

### Added

- Services page with template presets (PostgreSQL, MySQL, Redis)
- Custom Docker image support for services
- ServiceManager for Docker container lifecycle
- Shared services DB schema and REST API

## [0.2.3] - Domains & Visibility

### Added

- Blue-green deploy button and webhook settings UI
- Start/stop buttons on project detail
- Rollback button with API
- Domain CRUD UI for custom domains
- Server scan dashboard with container/port detection
- Reverse Proxy status section in Settings with Cloudflare Tunnel guide

## [0.2.2] - Deploy Controls

### Added

- Blue-green deploy button and webhook settings UI
- Start/stop buttons on project detail
- Rollback button with API

## [0.2.1] - i18n + Bugfixes

### Added

- Korean/English i18n with language selection during onboarding
- Build error details in deploy failure timeline events
- Dynamic OAuth callback URL for remote access

### Fixed

- Docker socket fix for Colima on macOS

## [0.2.0] - Web Dashboard

### Added

- Complete React SPA replacing Terminal UI
- Vercel-inspired light mode design
- Real-time deployment timeline with NDJSON streaming
- Deployment history with build logs
- Settings management UI (AI model, GitHub, secrets)
- Deploy dialog with repo URL input
- Project detail with tabs (Timeline, Deployments, Logs, Config, Env Vars, Domains, Webhooks)

### Changed

- Migrated from Terminal UI to React web dashboard
- Removed TUI framework (Ink, OpenTUI, SolidJS)

## [0.1.0] - 2025-02-01

### Added

- Chat-driven deployment: give a repo URL, get a running app
- Docker container management with automatic port allocation
- Traefik reverse proxy with automatic subdomain routing
- Public sharing via TryCloudflare temporary URLs
- Production domains via Cloudflare Tunnel
- Environment variable management
- Container logs and health monitoring
- Auto-redeploy via GitHub/GitLab/Bitbucket webhooks
- Rollback and blue-green zero-downtime deployments
- Monorepo support with parallel builds
- MCP server with 23 tools for IDE integration
- Multi-channel support: Slack, Discord, Telegram bots
- Auto-Dockerfile generation for common frameworks
- Build error debugger with recipe-based fast-path + LLM analysis
- BYOK: Gemini, Claude, OpenAI, OpenRouter, Ollama support
- Private repository support with SSH key authentication
- Database provisioning (PostgreSQL, MySQL, Redis)
- Terminal UI (Ink) with dashboard, chat, and project management
