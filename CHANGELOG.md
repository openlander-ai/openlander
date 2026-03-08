# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Cloudflare Settings configuration form (API token input UI + backend API)

### Changed

- Removed unused @opentui/core dependency
- Simplified i18n: removed 224 short keys, hardcoded in English, kept 101 long sentence keys translated
- Fixed sidebar breakpoint (labels visible at 1024px instead of 1280px)
- Fixed Services empty-state button handler inconsistency
- Moved branding to header with SVG logo and version display
- Changed default port from 10003 to 10114

### Fixed

- Addressed Oracle code review findings: Docker network name from config, removed dead pipeline code (5 files), split routes.ts into domain modules

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
