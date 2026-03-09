# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.7] - Pre-build Diff Analysis

### Added

- Pre-build diff analysis: on redeployments, analyze git diff to identify build-impacting file changes (Dockerfile, dependencies, env templates, runtime configs)
- `deploy:diff-analyzed` event with structured payload (changed files, impact flags, commit range)
- Build failure diagnosis now includes recent changes context — AI correlates errors with specific file changes
- Agent prompt section `## Build Diff Analysis` guides AI to use diff context during auto-recovery
- `formatDiffForPrompt()` formats diff analysis for human-readable agent context injection
- 14 unit tests for diff-analysis module (BUILD_IMPACT_PATTERNS, analyzeBuildDiff, formatDiffForPrompt)

## [Unreleased]

### Added

- MCP `agent_execute_goal` tool — external clients (Cursor, VS Code) can delegate multi-step goals to the AI agent
- Channel streaming with real-time message editing (Slack `chat.update`, Discord `PATCH`, Telegram `editMessageText`)
- Channel interactive components for agent questions (Slack blocks, Discord ActionRow+Button, Telegram InlineKeyboard)
- QuestionBridge wiring for channels with 5min timeout and rate-limited message editing (1.5s)
- `DeployOrchestrator` class with Kahn's topological sort for dependency-ordered multi-service deploys
- Atomic rollback on orchestration failure (tears down completed services)
- `orchestrate_deploy` agent tool with topology validation (port conflicts, cycle detection)
- Orchestration events: `orchestration:plan`, `service-start`, `service-healthy`, `service-failed`, `complete`
- 8 orchestrator tests (topo sort, parallel groups, cycles, port conflicts, rollback)

### Fixed

- questionBridge not passed on hot-reload Agent creation (setup-routes, auth-routes, mcp/server)
- scanTool.execute type safety in MCP server's scan_dockerfiles handler

### Changed

- Test suite: 37 files (535 tests) → 38 files (531 tests) after channel test restructuring + orchestrator tests

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
