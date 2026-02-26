# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.0] - 2025-02-26

### Added

- OpenCode-inspired dark theme (`#0a0a0a` background, warm accent palette)
- OpenCode-style centered empty-state prompt that moves to bottom on first message
- Slash command picker overlay (arrow keys, mouse, Enter, Escape)
- Model selection overlay (`/model`)
- Git provider connection overlay (`/connect`) with token validation
- Repository browser overlay (`/repo`) with IPC deploy trigger
- Compact/summarize command (`/compact`)
- 73 unit tests (52 slash-command + 21 slash-picker)
- OpenCode comparison analysis doc and TUI UX comparison doc

### Changed

- Migrated runtime from Node.js to Bun
- Migrated TUI framework from Ink to OpenTUI + Solid.js
- Migrated ORM from raw SQLite to Drizzle ORM
- Rewrote chat layout with flex panels instead of explicit heights
- All keyboard handlers now use `KeyEvent.name` (OpenTUI standard)
- Removed Tier 3 agent-proxy slash commands (LLM bypass principle)
- Restructured planning docs into `docs/planning/` and `docs/analysis/`
- Rewrote CONTRIBUTING.md with current tech stack and conventions
- Cleaned up .gitignore (removed stale entries for moved files)

### Fixed

- Color rendering issues (use `fg=` prop, not `color=` or inline styles)
- Slash command `/` keystroke was sending as chat message instead of opening picker
- Arrow key navigation not working in slash picker overlay
- Focus management: `preventDefault()` to block textarea capturing overlay keys

## [Unreleased]

### Added

- Daemon + TUI client architecture (Unix socket IPC)
- Structured logging with pino
- CI/CD pipeline (GitHub Actions)
- CONTRIBUTING.md and GitHub issue/PR templates
- SECURITY.md for vulnerability reporting
- CHANGELOG.md

### Changed

- Replaced monolithic process with daemon + thin TUI client
- Agent chat sessions are now isolated per-client

### Fixed

- Empty catch blocks now log errors appropriately

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
