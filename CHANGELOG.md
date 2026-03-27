# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0-rc.5] - 2026-03-27

### Added

- **Environment segment control**: Replaces dropdown in ProjectHeader for faster environment switching
- **DomainUrlDisplay component**: Shows environment-specific URLs with priority ordering and popover details
- **Environment-specific API URLs**: API returns dev-prefixed URLs for development environment
- **set_env_vars MCP tool enhancement**: Supports optional `environment_name` parameter for environment-specific variables
- **Traefik label-based environment detection**: Auto-detects environment from container labels and generates dev routes
- **Sidebar project dot aggregation**: Status dot aggregates environment statuses (all green/any red/any yellow)
- **Environment switch opacity fade**: 150ms fade animation on environment switch for visual feedback
- **env-status aggregation utility**: Helper function with 13 comprehensive tests for environment status logic

### Changed

- **Dead traefik-ol-dev config removed**: Cleaned up obsolete Traefik configuration

## [1.0.0-rc.3] - 2026-03-26

### Added

- **Shared `openlander` network with service-name DNS aliases**: All containers now connect to a shared Docker network enabling service-to-service communication via container names
- **`service_connections` table with CRUD API**: Database schema and REST endpoints for managing service interconnections
- **Auto env injection on service connect/disconnect**: Environment variables automatically updated when services are connected or disconnected
- **Connected Services writable UI**: Web dashboard panel for adding and removing service connections
- **Env vars plaintext by default**: Environment variables displayed in plaintext in the UI (with secure storage in database)
- **Runtime incidents system with LLM diagnosis**: Automatic detection and AI-powered analysis of runtime failures
- **Deploy connectivity check (DNS+TCP)**: Preflight validation ensuring services can reach their dependencies before deployment
- **Service health monitoring**: Continuous health checks for all deployed services with status reporting
- **MCP session incident briefing**: AI agents receive incident context in MCP tool responses for better recovery guidance

## [1.0.0-rc.2] - 2026-03-25

### Added

- **Authentication system**: Single-user password login with bcrypt hashing (salt rounds=10), session cookies (HttpOnly, SameSite=Strict, 7-day TTL), Bearer token auth for MCP HTTP
- **API token management**: Auto-generated `ol_`-prefixed tokens with AES-256-GCM encryption, token show/copy/regenerate in Settings Security tab
- **Settings Security tab**: API token management + password change in web dashboard
- **CLI `openlander config reset-password`**: Password recovery without server restart
- **Onboarding 6-step flow**: Language → Password (required) → Infrastructure → LLM (required) → GitHub → MCP Guide
- **MCP connection guide**: Setup wizard step showing URL + token for AI coding tool integration
- **WebSocket terminal auth**: Session cookie validation on WebSocket upgrade

### Changed

- **LLM API Key now required** during onboarding (was optional); enables AI auto-recovery
- **Setup completion condition** now requires password to be set (in addition to Docker)
- **MCP HTTP transport** now requires Bearer token when password is configured

## [1.0.0-rc.1] - 2026-03-25

### Added

- **E2E quality gate test suite**: 20 tests across 10 spec files validating core deployment scenarios
- **7 test repositories**: Dedicated test repos for deploy pipeline verification (Node.js, Python, Ruby, Java, PHP, .NET, Go)
- **Event sequence golden path verification**: Q-2 quality gate ensuring deterministic event ordering in deploy lifecycle
- **Quality gate coverage mapping**: Documentation of test coverage across all deployment paths and failure scenarios

### Fixed

- **Orphaned chat artifacts cleanup**: Removed stale chat session artifacts from previous web agent mode
- **LSP error fixes**: Resolved TypeScript strict mode violations and type safety issues

## [0.9.18] - 2026-03-25

### Added

- **Docker network isolation**: Production and development containers now run on separate Docker networks (`openlander-prod` / `openlander-dev`). Traefik auto-joins both networks at startup.
- **Per-container `traefik.docker.network` label**: Tells Traefik which network to use for reaching each container, enabling correct routing across isolated networks.
- **Multi-network Traefik**: `ensureAllNetworks()` creates both networks at startup; `connectToNetwork()` joins Traefik to the secondary network (idempotent).
- **Service dual-network**: Shared services (PostgreSQL, Redis, etc.) are automatically connected to both networks after creation, ensuring accessibility from either environment.
- **MCP environment parameter**: `deploy_compose` and `deploy_blue_green` tools now accept optional `environment` parameter for network-aware deployments.

### Changed

- **run-step.ts**: `ContainerRunner.run()` passes `getPolicy(envType).networkName` to `docker.runContainer()`.
- **compose.ts**: `ComposeDeployConfig` accepts `environmentType`; port allocation, Traefik labels, and compose service networks are all environment-driven.
- **rollback.ts / blue-green.ts**: Container creation uses environment-specific network.
- **Blue-green API**: `POST /projects/:id/blue-green` now accepts `?environment=development` (previously production-only).
- **orchestrator.ts / deploy-core.ts**: `buildProject()` propagates `environmentType` to compose pipeline.

## [0.9.17] - 2026-03-24

### Added

- **Deploy-level environment policies**: `getPolicy(envType)` returns per-environment config (network name, port range, Traefik settings). Production: ports 10001-10999, Development: ports 20001-20999.
- **MCP environment parameter**: `deploy`, `create_deploy_plan`, `redeploy_project`, `stop_project`, `restart_project` tools now accept optional `environment` parameter (`production`|`development`).
- **Environment validation**: `isValidEnvironment()` prevents arbitrary strings from being used as environment types.
- **Docker network override infrastructure**: `runContainer()` accepts optional `network` parameter (ready for future per-env network isolation).

### Changed

- **Hardcoded values removed**: All references to `'web'` network, `'openlander-traefik'` container name, and fixed port range `10001-10999` replaced with policy-driven values.
- **allocatePort environment-aware**: All callers now pass environment type for correct port range selection.
- **TraefikManager config-driven**: Container name, network, and ports driven by constructor options instead of module constants.
- **redeploy() environment routing**: Correctly routes development environment redeploys to the right container/environment.

## [0.9.16] - 2026-03-24

### Added

- **Docker image deployment**: Deploy pre-built Docker images directly without git clone/build. Supports image URL, port, command override via API, MCP, and web UI.
- **Deploy Dialog image toggle**: Git/Image source selector in deploy dialog with conditional fields (image URL, port, command).
- **ProjectCard Docker badge**: Container icon and image URL display for image-source projects.
- **OverviewTab image info**: Shows image URL, port, command for image-source projects instead of git-specific info.
- **ProjectHeader "Pull & Restart"**: Image projects show "Pull & Restart" instead of "Redeploy" button.
- **Settings image fields**: Editable image URL, port, command in project settings with PATCH API.
- **MCP image deployment schema**: Extended `create_deploy_plan` schema with source/image/cmd/port params.
- **Image URL validation**: `parseImageUrl()`, `getImageExposedPort()`, `mapPullError()` utilities.
- **Pipeline tests**: 7 pipeline tests + 10 MCP schema tests + 3 E2E integration tests for image deployment.

## [0.9.15] - 2026-03-24

### Added

- **Runtime log snapshots**: Captures last 500 lines of container logs before redeploy, stored in deploy history. Viewable in DeploymentDetail page under "Runtime Logs" section.
- **Docker log rotation**: All containers created by OpenLander now have `json-file` log driver with 10MB×3 rotation, preventing unbounded disk growth.
- **`cleanup_docker` MCP tool**: Three-level Docker cleanup (soft/standard/aggressive) with per-phase status reporting and build-safety guards.
- **Deploy terminal phase rail**: Phase indicators now update correctly during builds with pulse animation on active step.

### Fixed

- **Build log propagation**: Blue-green, preview, and monorepo deploy paths now preserve Docker build output on failure.
- **Phase rail not updating**: Backend SSE events were missing `stepName` field — all deploy lifecycle events now include it.
- **Docker cleanup during builds**: Health monitor and cleanup_docker MCP tool now skip aggressive cleanup when projects are building.

### Removed

- **`provision_database` tool**: Replaced by `create_service(template="postgres")` which uses Docker named volumes for data persistence. The legacy tool created containers without volumes — data was lost on container removal.
- **`deploy_monorepo` tool**: Deprecated in favor of `orchestrate_deploy` which supports dependency ordering and atomic rollback.
- **`/auth/pkce.ts`**: Unused PKCE utilities (CLI has its own implementation).

## [0.9.14] - 2026-03-23

### Added

- **Dashboard VPN URL display**: Project list, detail, card, and table views now show VPN (Tailscale/WireGuard) URLs alongside LAN URLs with purple VPN badge. API returns `urls: ProjectUrl[]` field.

### Fixed

- **Build log propagation**: Blue-green, preview, and monorepo deploy paths now preserve Docker build output on failure. Previously only the main deploy path captured build logs — the other three paths discarded build output in catch blocks.
- **tsup build race condition**: Removed per-entry `clean: true` from tsup config (parallel builds could delete each other's output). Build script now runs `rm -rf dist` before tsup instead.
- **VPN URL environment guard**: VPN URLs only shown when viewing production environment, preventing production URL leakage in development views.
- **Project list API performance**: `getAllIps()` hoisted to single call per request instead of per-project in the list endpoint.

## [0.9.13] - 2026-03-23

### Added

- **Platform debug/admin MCP tools**: 11 new `platform_*` tools for diagnosing OpenLander internal state, gated behind `config.mcp.platformTools` flag (default: false).
  - **Tier 1 (read-only)**: `platform_health` (process health summary), `platform_event_log` (recent EventBus emissions), `platform_container_audit` (Docker vs DB mismatch detection), `platform_config` (redacted config viewer)
  - **Tier 2 (debug)**: `platform_logs` (OpenLander process logs), `platform_docker_inspect` (raw Docker inspect), `platform_docker_ps` (full Docker container listing), `platform_db_inspect` (structured DB table query)
  - **Tier 3 (corrective)**: `platform_cleanup_orphans` (orphan container cleanup), `platform_reconcile` (DB↔Docker state sync), `platform_force_remove` (force container removal)
- **Generic RingBuffer**: In-memory circular buffer (`src/lib/ring-buffer.ts`) with timestamp wrapping and time-filtered retrieval.
- **EventBus capture hook**: All EventBus emissions automatically captured for `platform_event_log` without per-event registration.
- **Pino log ring buffer**: Process logs captured in-memory via custom Writable stream for `platform_logs` tool.

## [0.9.12] - 2026-03-23

### Added

- **Volume auto-mount on deploy**: `runContainer()` and `runComposeService()` now query Docker for project volumes by label and auto-mount them as Binds. Volumes created via `add_volume` are automatically available inside containers on next deploy.
- **Bucket management MCP tools**: `create_bucket`, `list_buckets`, `delete_bucket` for managing S3 buckets inside MinIO services via `mc` CLI.
- **VPN sslip.io routes**: Traefik HTTP provider now generates sslip.io routes for all detected IPs (LAN + VPN). Tailscale, ZeroTier, and WireGuard users can access projects via VPN IP.
- **MCP VPN guidance**: `SERVER_INSTRUCTIONS` updated to advise agents to prefer VPN URLs when available, and document volume/MinIO/bucket tools.

### Fixed

- **Sidebar Issues section removed**: Projects with error/building status now stay in their normal group instead of a distracting separate section with warning emoji.

## [0.9.11] - 2026-03-23

### Added

- **Volume MCP tools**: `add_volume`, `list_volumes`, `remove_volume`, `get_disk_usage` for managing Docker persistent volumes per project. Includes inspect-before-create duplicate detection, ownership label verification on removal, and schema validation (regex for volume names, absolute path for mount paths).
- **MinIO service template**: `create_service(template="minio")` provisions S3-compatible object storage with auto-generated credentials. Includes health check (`/minio/health/live`), pinned version (`RELEASE.2024-11-07T00-52-20Z`), and `getSuggestedEnv` returning `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- **Bucket management MCP tools**: `create_bucket`, `list_buckets`, `delete_bucket` for managing MinIO S3 buckets via `mc` CLI inside the service container.
- **ServiceTemplate extensions**: Optional `cmd` and `healthcheck` fields on `ServiceTemplate` interface, reusable by future templates.

## [0.9.10] - 2026-03-23

### Fixed

- **Deploy terminal readability**: Bumped muted color (#555→#6b6b6b), build log uses secondary (#888) for WCAG AA contrast, timestamp opacity 50%→70%.
- **Log error/warn underline**: Border color now only applies to left indicator, not bottom underline.
- **Container name truncation**: Increased max-width from 200px to 300px in Project Info.
- **Deploy time wrapping**: Fixed `w-16` causing "58m ago" line break in both Overview and Deployments list.
- **xterm terminal font**: Unified to Geist Mono via terminalTokens instead of hardcoded system monospace.
- **no_cache timeout guidance**: redeploy/restart responses now advise `timeout=600` for full rebuilds.

## [0.9.9] - 2026-03-23

### Added

- **Typography system overhaul**: Migrated to Inter (body+display) + Geist Mono (code), self-hosted via fontsource. Established 14px body base, 12px minimum for accessibility. Typography CSS tokens (`--font-size-xs` through `--font-size-3xl`).
- **Docker image cleanup system**: Automatic cleanup module (`src/pipeline/cleanup.ts`) with dangling image prune, build cache prune, and disk-threshold-triggered aggressive cleanup (80% threshold, 10-minute cooldown). Post-deploy hook prunes dangling images after each successful deploy.

### Fixed

- **sslip.io stale IP on network change**: Added sslip.io routes to Traefik HTTP provider endpoint (`/api/traefik/config`), so IP changes are reflected within 5 seconds via polling instead of requiring container redeploy.
- **get_deploy_status wait=true for multiple deploys**: `wait=true` without `project_name` now blocks until ALL active deploys complete, instead of returning immediately. Prevents agents from falling back to `sleep`.
- **Traefik killed on restart**: Orphan container cleanup now skips infrastructure containers with `openlander.role` label, preventing Traefik from being destroyed during process restart.

## [0.9.8] - 2026-03-23

### Added

- **MCP tool `update_project_config`**: Change project's `dockerfile_path`, `docker_target`, and `build_context` stored in DB. Includes path traversal validation and at-least-one-field requirement. Use when build config is stuck from prior deploys.
- **Dockerfile mismatch warning**: When a commit modifies a Dockerfile that differs from the one used for the build, a warning is logged with `update_project_config` hint (e.g., `[warning] Commit modified apps/api/Dockerfile, but build uses Dockerfile.api`).
- **Dockerfile build log preview**: Build log now shows key RUN/CMD/EXPOSE lines from the Dockerfile being built, so users can verify the right file at a glance.
- **Dockerfile fallback in redeploy**: When DB `dockerfile_path` points to a missing file in the clone, falls back to root `Dockerfile` or single discovered candidate. Fails with actionable message when multiple Dockerfiles found.
- **Dockerfile discovery in deploy plan**: `resolveBuildConfig` now uses discovered Dockerfiles instead of auto-generating when the repo already has one.

### Changed

- **Removed RecoveryOrchestrator**: Build failures now propagate immediately to `deploy:failed` event, letting `auto-recovery.ts` route to agent instead of silently retrying with LLM-rewritten Dockerfiles (Tier 2.5). Removed `attemptTier1Fix`, `_retryCount`, `build:autofix` and `build:dockerfile-fixed` events.

## [0.9.7] - 2026-03-23

### Changed

- **Backend refactoring** — service-manager.ts (1406→817 lines, -42%): Extracted ServiceAdapter interface + 4 adapter implementations (PostgreSQL, MySQL, Redis, MongoDB), replacing type-based if/else branches with adapter factory pattern
- **Backend refactoring** — setup-routes.ts (819→234 lines, -71%): Split into domain sub-files (cloudflare, github, mcp handlers), extracted reloadAgent() and mergeToolsIfMcpEnabled() shared helpers
- **Backend refactoring** — project-routes.ts (1285→1174 lines, -9%): Extracted getProjectOrThrow, getEnvironmentByIdOrThrow, resolveEnvironmentByType shared helpers replacing 39 duplication instances

### Added

- **MCP service external access**: `list_services`, `create_service`, `get_service_status`, and `get_service_credentials` MCP tool responses now include `externalAccess` array with server LAN/VPN IPs — AI agents can now correctly guide users to connect to services from their machines instead of only seeing Docker internal hostnames
- **MCP service external connection strings**: `get_service_credentials` returns `externalConnectionStrings` with the Docker internal hostname replaced by each detected server IP

### Fixed

- **Test suite green**: Fixed 41 pre-existing test failures across vitest and bun test runners — deleted orphan tests for removed AI assistant components, updated MCP tool test expectations for `_agent_guidance` fields, fixed `vi.hoisted()` vitest compatibility, corrected stale worktree path references

## [0.9.6] - 2026-03-22

### Changed

- **Agent Chat bubble redesign**: iMessage-style rounded corners (`18px/4px` tail), `w-fit` shrink-to-fit, `shadow-sm` depth, user bubble rose-500 / AI bubble zinc-100
- **Code block overhaul**: Added `highlight.js/styles/github-dark.css` for syntax highlighting, `prose-pre:text-zinc-100` for readable text on dark background, language header bar with one-click copy-to-clipboard button via custom `CodeBlock` component
- **Chat session Context migration**: `useChatSessions` was instantiated independently in both Sidebar and AgentPage — two separate `useState` instances that never synced `sessions[]`. Migrated to `React.createContext` with `ChatSessionsProvider` in AppLayout so both components share a single session state
- **Thinking indicator redesign**: Replaced basic `animate-bounce` with Bot icon + brand color `animate-pulse` + custom `bounce-dot` keyframe (smoother scale+opacity animation)
- **Streaming indicator relocated**: Removed `● Streaming` badge from header bar — streaming state is now communicated solely through ThinkingIndicator in the message area
- **Deployments list compact redesign**: Card-style rows (`p-3 rounded-lg border`) → Vercel-style single-line rows (`py-2.5 px-4 divide-y`), ~44px row height (was ~68px), horizontal `justify-between` spread filling full tab width
- **Deployments visual hierarchy**: Trigger label promoted to `font-semibold text-[13px]` as primary scan target, status badge demoted from pill to plain text, commit SHA as plain mono, meta row pushed to right edge

### Fixed

- **AI deploy border 4-side pink leak**: `border-image: linear-gradient(...)` applied gradient to all 4 sides and broke `border-radius`. Replaced with `border-left: 2px solid #f43f5e` — left accent only, radius-compatible
- **Chat session title "New conversation" never updating**: Sidebar's `useChatSessions` had its own `sessions[]` state that was never refreshed after AgentPage's streaming completed. Context migration ensures `refreshSessions()` updates the shared state both components read from
- **Code block black-on-black text**: `prose-pre:bg-bg-terminal` (#1e1e1e) had no text color override — inherited light-mode default (black text on black background). Added `prose-pre:text-zinc-100` and `[&_pre_code]:bg-transparent` to prevent inline code background bleeding into pre blocks

## [0.9.5] - 2026-03-22

### Changed

- **Overview tab redesign**: Replaced 6 card blocks with flat progressive disclosure layout (412→160 lines)
  - Removed SummaryDashboard, Infrastructure Info card, Quick Actions card, LogPreview
  - Collapsible Deploy Pipeline (auto-expands during build)
  - Collapsible Details section (port, branch, image, environments)
  - Single-line last event instead of 5-event card

### Fixed

- **trigger_detail DB migration**: Added missing ALTER TABLE migration that caused Deployments API 500
- **Status display mismatch**: Removed independent getProject() fetch in OverviewTab causing Stopped/Running contradiction
- **Traefik detection**: Now checks container name in addition to image name
- **Settings i18n**: Moved hardcoded English labels to translation files
- **Settings tab animation**: Added fade-in/zoom-in transitions

## [0.9.4] - 2026-03-22

### Added

- **Deployment trigger detail**: Deployments now show specific trigger (Restart, Env Update, Deploy Plan) instead of generic "Agent Deploy"
- **`get_project_stats` tool**: Per-container CPU, memory, restarts, and uptime monitoring
- **Sidebar search bar**: ⌘K shortcut directly in sidebar
- **Command palette enhancements**: Groups, AI fallback, recent commands

### Fixed

- **Deploy `wait=true` single-call**: Fixed event/phase ordering bug — status resolves correctly in one call
- **Deploy error guidance**: Added "Use restart_project" suggestion when container already exists
- **Chat session titles**: Show first message instead of "New conversation"
- **Dark theme remnants**: Cleaned up 34 hardcoded dark colors across 18 files for light Rose theme
- **Terminal dot grid removed**: Cleaner VS Code-style dark terminal on light background
- **Overview layout**: Compact terminal (max 220px idle), side-by-side Infrastructure + Quick Actions
- **Sidebar layout**: New Project moved to bottom, ISSUES section separated, repo name tooltips
- **Overlay backdrops**: Lightened for clean light theme (dialog, sheet, command palette)

## [0.9.3] - 2026-03-22

### Changed

- **Light theme with Rose brand**: Switched from dark Zinc to clean light theme with Rose (#F43F5E) accent color
- Terminal/code blocks remain dark for readability
- Card shadows and hover effects optimized for light backgrounds
- Chat bubbles updated for light theme contrast

## [0.9.2] - 2026-03-22

### Added

- **`get_project_stats` tool**: Per-container CPU, memory, restarts, and uptime monitoring via Docker API
- **Command palette**: Groups, AI fallback, recent commands, keyboard hints

### Changed

- **Dark Zinc theme**: Full app conversion to dark mode with card depth, glow dots, AI identity colors
- **Chat bubbles**: Dark theme optimized markdown rendering with sender indicators
- **Terminal**: Dot grid background pattern, AI deploy gradient borders

### Fixed

- **Deploy wait=true**: Fixed event/phase ordering bug — `get_deploy_status(wait=true)` now resolves in single call
- **Deploy error message**: Added `restart_project` guidance when container already exists
- **Chat sessions**: Show first message as title instead of "New conversation"

### Refactored

- Split `api.ts` (1,066 lines) into domain modules (projects, services, system, chat)
- Split `SettingsPage.tsx` (1,139 lines) into tab components
- Split `ProjectsGrid.tsx` (545 lines) into dashboard components
- Split `ProjectDetail.tsx` (590 lines) into focused components
- Split `NewProjectFlow.tsx` (588 lines) into step components
- Merged `sidebar/` → `layout/`, `terminal/` → `deploy-terminal/`

## [0.9.1] - 2026-03-22

### Improved

- **Dashboard table view**: Card/table toggle with localStorage persistence for compact project overview
- **Console log colors**: Error lines highlighted red, warnings yellow, debug dimmed
- **Sidebar error section**: Error/building projects visually separated with "⚠️ Issues" header and informative tooltips
- **Deployment trigger labels**: Distinct icons and labels per trigger type (Agent Deploy, Webhook, API Call) instead of generic "chat Deployment"
- **System Issues dropdown**: Clickable status card showing specific issues (Traefik offline, error projects) with navigation
- **Deploy terminal**: Reduced empty space when idle, increased build log area during active builds
- **Visual polish**: Sentence case labels, filled status badges, card hover effects

## [0.9.0] - 2026-03-21

### Added

- **Web Agent Mode**: ChatGPT-style AI chat interface in the web dashboard
  - Full-screen agent mode with mode toggle in sidebar (Dashboard/Agent)
  - NDJSON streaming chat with real-time tool call visualization
  - Multi-session support with server-side DB persistence
  - Markdown rendering with code syntax highlighting (react-markdown + rehype-highlight)
  - Collapsible tool call cards showing arguments and results
  - Agent question UI with clickable option buttons
  - LLM-not-configured gate with Settings redirect
  - Empty state with suggestion chips for quick start
  - Session management: create, switch, delete sessions
  - Streaming abort (stop) button
  - Auto-scroll with "scroll to bottom" indicator
  - E2E Playwright tests for agent mode navigation

### Changed

- **Agent class**: Added session switching and async mutex for safe concurrent access
- **Database**: Added `deleteSession()` to ChatRepo, Database, and SessionStore
- **Web server**: Added 6 new API routes for chat streaming, question handling, and session management

## [0.8.0] - 2026-03-21

### Changed

- **MCP-First Web Pivot**: Transformed web dashboard from AI chat interface to monitoring-focused dashboard
- **LLM now optional**: Server starts with Docker alone; API key enables smart auto-recovery
- **Auto-recovery dual-mode**: LLM mode (agent-driven analysis) + programmatic mode (recipe matching + single retry)

### Added

- **RecoveryCard timeline component**: Displays auto-recovery events (start, success, failed, exhausted) in deploy timeline
- **System status bar**: Dashboard shows Docker, Traefik, MCP status at a glance
- **Optional API key setup**: Settings and Setup flow simplified — Docker check → GitHub (opt) → API Key (opt)

### Removed

- **AI Assistant UI**: Deleted ChatInput, ChatMessageList, ToolCallGroup, ThinkingIndicator and 8 assistant components
- **AI Timeline Cards**: Deleted ErrorAnalysisCard, InsightCard, PostmortemCard, DockerfileFixedCard, FixProposalCard
- **AI Web Routes**: Deleted chat-routes.ts (POST /agent/chat), auth-routes.ts (OpenAI/OpenRouter OAuth)
- **AI API Functions**: Removed debugBuild(), chatWithAgent(), getPostmortem() from frontend api.ts
- **src/agent/ directory**: Moved Agent class → src/llm/agent.ts, BuildDebugger → src/pipeline/build-debugger.ts, then deleted directory

## [0.7.3] - 2026-03-21

### Changed

- **Deploy pipeline refactoring**: Extracted `deployEnvironment()` orchestration sequence into `src/pipeline/deploy/orchestrator.ts` (519→251 lines). Extracted `deployMonorepo()` into `src/pipeline/deploy/monorepo-orchestrator.ts` (433→177 lines).

### Fixed

- **`scan_dockerfiles`**: Now detects `Dockerfile.*` variants (e.g., `Dockerfile.api`, `Dockerfile.web`) at any depth.
- **`analyze_infrastructure`**: Added Python dependency detection (`asyncpg`, `psycopg2`, `redis`, etc.) from `pyproject.toml` and `requirements.txt`. Added recursive subdirectory scanning for monorepo layouts.
- **`get_logs`**: Stripped Docker multiplexed stream 8-byte headers from container log output.

## [0.7.2] - 2026-03-21

### Changed

- **MCP tool descriptions**: Added `mcpDescription` to all 64 tools (was ~16). MCP clients now see concise, purpose-focused descriptions instead of verbose agent-targeted ones.
- **Error handling unification**: All tool errors now use `throw` pattern (was mixed `throw`/`return {error}`). MCP responses consistently use `isError: true` for all error cases.
- **`deploy_monorepo` deprecated**: Description and response now direct agents to `orchestrate_deploy` for monorepo deployments.

### Added

- **`_agent_guidance` for state-changing tools**: `stop_project`, `remove_project`, `rollback_project`, `deploy_blue_green`, `create_service`, `enable_webhook` now return structured next-step guidance.
- **Orphan tool connections**: `preview_deploy` → `list_previews`, `enable_webhook` → `get_webhook_config`, `map_domain` → `list_domains`, `get_deploy_status` → `get_system_stats`, `create_deploy_plan` → `provision_database` guidance chains added.
- **SERVER_INSTRUCTIONS updates**: `orchestrate_deploy` as monorepo primary path, `wait=true` for `get_deploy_status`, `get_deploy_history` in deploy planning and failure recovery sections.

## [0.7.1] - 2026-03-21

### Added

- **`_agent_guidance.next_steps[]`**: Unified guidance field in tool responses directing AI agents to the correct next action (replaces ad-hoc prose hints)
- **`docker_host` fact field**: `get_deploy_status` (done/failed) now includes `docker_host: "local" | "remote"` so agents can dynamically decide whether local docker/curl commands would work
- **`getDockerHostType()` utility**: Detects local vs remote Docker from `DOCKER_HOST` env var
- **SERVER_INSTRUCTIONS remote Docker rule**: Single authoritative "Docker may be remote" warning in MCP server instructions instead of per-tool description repetition
- **Deploy guidance**: Success → `get_logs` verification hint; Failure → `get_build_log` + `debug_build_error` recovery path
- **Post-action guidance**: `map_domain`, `set_env_vars`, `upload_secret_file`, `enable_webhook`, `expose_public` return structured next steps

## [0.7.0] - 2026-03-21

### Changed

- **Compose deploy via dockerode**: Replaced `docker compose up/down` CLI calls with direct dockerode API (buildImage, runContainer, network management). Removes child_process dependency for compose operations.
- **Override hacks removed**: Deleted `writeOverride()`, `writeSecretOverride()`, `touchMissingEnvFiles()` — env vars, secrets, and ports now injected directly via dockerode container config.
- **Compose service logs/status via dockerode**: `getServiceLogs()` and `getServiceStatuses()` now use dockerode/DB instead of `docker compose ps/logs`.

### Added

- **Orphan child project cleanup**: Redeploys that remove services now automatically detect and clean up orphan child projects (stop container, delete DB record).
- **Compose YAML parsing extensions**: `command`, `entrypoint`, `restart`, `healthcheck` fields now parsed from compose.yml and included in deploy plan responses.
- **Project-scoped Docker networks**: Each compose project creates `ol-{name}` bridge network for service DNS resolution.
- **`compose:orphans-cleaned` event**: New event emitted when orphan services are detected and removed during redeploy.

## [0.6.15] - 2026-03-21

### Added

- **Build step progress in MCP status**: `get_deploy_status` now exposes `build_step`, `build_step_total`, and `build_step_desc` during active Docker builds
- **Env var source tracking**: `list_env_vars(environment_name=...)` can now return masked values with source metadata (`global`, `project`, `production`, `environment`)
- **Deploy plan internal URLs**: `create_deploy_plan` now includes `internal_url` guidance for standard deploys and compose services

### Changed

- **MCP HTTP session lifecycle**: Added heartbeat/TTL tracking and shutdown cleanup to reduce stale MCP HTTP sessions during long-running operations
- **MCP tool descriptions**: Expanded core tool descriptions with compose support scope, internal URL guidance, env priority, and polling hints for agents

## [0.6.14] - 2026-03-20

### Fixed

- **Compose child project duplicate**: Reuse existing child projects on redeploy instead of duplicate INSERT
- **remove_project container cleanup**: Include compose child containers + upgrade log level to warn for failures
- **Compose force-recreate**: Added `--force-recreate` to `docker compose up` for hardcoded `container_name` handling
- **Compose project name**: Set deterministic `COMPOSE_PROJECT_NAME` from OpenLander project name for stable container cleanup across deploys
- **Concurrent deploy port conflict**: In-memory port reservation prevents multiple simultaneous deploys from picking the same port
- **Port binding retry**: Auto-retry with different port on "port already allocated" error
- **Port scan cache**: Invalidate after container removal to prevent stale data

## [0.6.13] - 2026-03-20

### Fixed

- **Compose restart env_file**: Create placeholder env files before validation (ordering bug — placeholders were created after validation threw)
- **Compose child project duplicate**: Reuse existing child projects on redeploy instead of duplicate INSERT (was causing "Project already exists" error)
- **remove_project container cleanup**: Include compose child containers in cleanup + upgrade log level from debug to warn for removal failures
- **Compose force-recreate**: Added `--force-recreate` flag to `docker compose up` for hardcoded `container_name` handling
- **Concurrent deploy 409**: Pre-clean existing container before `runContainer` to prevent "container name already in use" on simultaneous deploys

### Changed

- **Deprecated getMergedForDeploy cleanup**: Removed from 9 test mock objects that no longer call it

## [0.6.12] - 2026-03-20

### Added

- **deploy_configs table**: Persist deploy configuration snapshots per project for reliable redeploy/restart
- **buildDeployConfig()**: Single 3-tier config assembly function (runtime > stored snapshot > DB columns)
- **resolveEnvVars()**: Unified 7-layer env var merge function (auto < global < project < prod < env < service < inline)

### Changed

- **redeploy()**: Uses buildDeployConfig() instead of manual DB field reconstruction — restores sshKeyPath, composeServices on redeploy
- **deployEnvironment()**: All env assembly routes through resolveEnvVars() (4 inline merge sites consolidated)
- **PlanEngine.executePlan()**: Env merge now uses resolveEnvVars()
- **blue-green deploy**: Env assembly unified through resolveEnvVars()
- **formatEnvValue**: Consolidated compose and env-inject duplicated escaping functions

### Deprecated

- **EnvManager.getMergedForDeploy()**: Use resolveEnvVars() instead

## [0.6.11] - 2026-03-20

### Fixed

- **Dockerfile monorepo routing**: Specific dockerfile (e.g. `Dockerfile.api`) no longer triggers monorepo mode — prevents unwanted child projects
- **Compose --progress flag**: Removed `--progress=plain` entirely for Docker Compose compatibility
- **Restart build context**: `build_context` persisted in DB so restart/redeploy preserves Dockerfile context directory
- **Compose redeploy crash**: Child projects no longer store absolute compose path as `dockerfile_path` (caused "path must be relative" on restart)
- **Deploy resolved-failure gap**: Background deploys that resolve with `success:false` now create deploy logs (previously only `.catch()` handled)
- **Disk full preflight**: Deploys now fail preflight when disk < 0.5GB instead of proceeding with a warning

### Added

- **Container name in list_projects**: `containerName` field (`ol-{name}`) for inter-project Docker network communication
- **Service health detection**: `get_service_status` returns `health` field via Docker health check or log PANIC/ERROR/FATAL scan
- **get_env_var tool**: Single-key unmasked env var lookup for debugging connection strings
- **Build progress in status**: `get_deploy_status` shows `buildLogTail` during active builds (not just on failure)
- **DEPLOY_IN_PROGRESS status**: `get_build_log` returns informative status when build is active instead of confusing `NO_DEPLOY_LOGS`
- **Build failure log expansion**: Failure log tail increased from 30 to 100 lines

## [0.6.10] - 2026-03-20

### Fixed

- **Dockerfile path routing**: `create_deploy_plan(dockerfile_path=...)` now correctly uses Dockerfile build even when repo has a compose file (no longer silently falls back to compose mode)
- **Container name conflict**: AI error diagnosis correctly identifies container name conflicts instead of misdiagnosing as "version obsolete" warning
- **Agent/fallback race condition**: `thinking` event now prevents premature fallback; agent events suppressed after fallback triggers; no more double-deploys
- **Question event rendering**: Agent question events no longer render as plain XML text — properly handled via QuestionBridge interactive cards
- **BuildDebugger locale**: AI error analysis now respects user's language setting (Korean/English); hot-reloads on language change

### Added

- **Env var optional detection**: `env-scan` distinguishes required vs optional env vars by detecting fallback values (`|| 'default'`, `?? 'fallback'`, `os.environ.get('KEY', 'default')`)
- **Optional badge in deploy dialog**: Env vars with code defaults show "(optional)" label in the deploy UI

## [0.6.9] - 2026-03-20

### Fixed

- **Compose deploy completion**: `executePlan()` now listens to `compose:up`/`compose:failed` events — compose deployments no longer hang indefinitely
- **Compose version gating**: `--progress=plain` flag only added when Docker Compose >= 2.3.0 (older versions no longer fail)
- **Remote Docker IP**: Auto-detect host IP from `DOCKER_HOST` env var (tcp/ssh URLs) for correct service URLs
- **Service reconciliation**: Services without containers now correctly marked as 'error' status; Docker inspect failures logged at `warn` level

## [0.6.8] - 2026-03-20

### Changed

- **Database refactor**: Decomposed 1708-line God Object (`src/db/index.ts`) into 13 domain-specific Repository classes + 146-line delegation facade
  - Extracted `ProjectRepo`, `EnvironmentRepo`, `EnvVarRepo`, `GlobalSecretRepo`, `SecretFileRepo`, `ServiceRepo`, `DeployLogRepo`, `TimelineRepo`, `ChatRepo`, `DomainMappingRepo`, `OAuthRepo`, `WebhookRepo`, `DeployPlanRepo`
  - Consolidated Row types into `src/db/types.ts`
  - Extracted migration logic into `src/db/migration.ts`
  - 100% backward compatible — zero consumer file changes, zero API changes

### Fixed

- **IP override**: `HOST_IP` / `HOST_VPN_IP` env vars override detected IPs for remote Docker host setups
- **Deploy crash logging**: `startDeploy()` now creates deploy log on crash instead of silent failure (fixes NO_DEPLOY_LOGS)
- **build_method regression**: Defensive try/catch prevents deploy crash when DB column missing

## [0.6.6] - Operational Fixes & MCP Descriptions

### Added

- Docker inspect reconciliation on `list_projects` (MCP) and `GET /api/projects` (Web API)
- `build_method` column in projects DB — persists dockerfile/compose preference across redeploys
- `container:missing` event emitted when AlertMonitor detects externally removed containers
- `EnvManager.verifyRoundTrip()` — validates env var integrity after storage
- Compose containers auto-connect to Traefik `web` network after deploy
- `mcpDescription` added to 40+ MCP tools with workflow guidance and parameter hints

### Fixed

- `getLanIp()` now uses `getAllIps()` filtering — skips Docker bridge and VPN interfaces, prefers LAN IP
- Ghost state: Projects reported as "running" when containers were externally removed now show "error"
- Compose fallback: `restart_project` no longer falls back to compose mode when deployed with `prefer_dockerfile=true`
- MCP timeout: `restart_project` returns immediately (non-blocking)
- Build error details: `DockerBuildError` now includes image tag and context path
- Prune resilience: `AlertMonitor.checkContainerCrashes()` updates project status when container missing

## [0.6.5] - Deploy Plan Bugfixes

### Added

- `deploy_only` parameter for `execute_deploy_plan` — deploy specific compose services (e.g., `["backend"]`)
- `build_log_tail` in `get_deploy_status` — last 30 lines of build output included when phase is `failed`, for both single Dockerfile and compose builds
- `update_deploy_plan` now returns full plan details (build, services, env, warnings) matching `create_deploy_plan` response
- Auto-detect build context from `dockerfile_path` — `backend/Dockerfile` sets context to `backend/` instead of repo root
- `buildContext` field in `ProjectConfig` for explicit Docker build context control
- Docker Compose minimum version requirement (V2.3.0) with startup warning for older versions
- Explicit system requirements in README (Docker Engine 20.10+, Compose V2.3.0+, Git 2.x)

### Fixed

- Compose plan routing — compose plans (`build.method: "compose"`) now correctly set `preferDockerfile: false`, preventing fallback to root Dockerfile
- Env var regex — `\s*` after `=` consumed newlines across lines, causing multi-line capture; changed to `[ \t]*`
- Required env filtering — `missing[]` now only includes `required: true` vars; optional vars with defaults no longer block deployment
- Env var redaction bug — `redactPlanForStorage()` replaced env values with `[REDACTED]` in DB, then `executePlan()` passed masked values to containers; removed redaction entirely
- `deploy_environment` mode switching — now passes `dockerfile_path` and `docker_target` from project record, preventing unexpected compose/dockerfile mode changes on redeploy
- Compose `--progress=plain` compatibility — flag now requires Compose V2.3.0+; older versions skip it instead of failing

## [0.6.4] - Deploy Plan v2

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
