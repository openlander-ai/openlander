# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
