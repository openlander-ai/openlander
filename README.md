<div align="center">

# 🛬 OpenLander

**Self-hosted deployment platform that fixes its own failures.**

Paste a Git URL. It builds, deploys, and hands you a URL — if something breaks, AI fixes it automatically.

[![npm version](https://img.shields.io/npm/v/openlander.svg)](https://www.npmjs.com/package/openlander)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## The Problem

AI coding tools (Cursor, Claude Code, etc.) made it so anyone can build an app. But deployment? Still painful.

You need to know Docker, reverse proxies, port mapping, SSL, DNS — or pay $10+/month per service on the cloud.

**OpenLander fixes this.** A clean web dashboard for deploying — with AI that kicks in when things go wrong.

```
1. Paste a Git URL
2. Click Deploy
3. Get a URL

Build failed? AI analyzes the error and retries.
Container crashed? AI detects it and fixes the Dockerfile.
```

## Why Not Just Use Coolify / Dokploy?

Those are great tools. OpenLander takes a different approach.

|                       | Coolify / Dokploy               | OpenLander                                               |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| Interface             | Web dashboard (forms & buttons) | Web dashboard + AI auto-recovery                         |
| When builds fail      | You read logs, you fix it       | AI analyzes the error and retries automatically          |
| When containers crash | You get an alert                | AI detects it, diagnoses the cause, and attempts a fix   |
| Coding agent support  | None                            | MCP protocol — deploy from Cursor, Claude Code, etc.     |
| Server awareness      | Manual configuration            | Auto-detects ports, proxies, containers before deploying |
| Install               | `docker compose`                | `npm i -g`                                               |

**Positioning**: Coolify's Docker foundation + Vercel's clean UX + AI auto-recovery.

## Cost

```
Cloud (5 services):      ~$100/month, forever
Mac Mini + OpenLander:   ~$600 once, $0/month
→ Pays for itself in 6 months
```

## Quick Start

> **Platform**: Linux (primary) and macOS. Windows is not supported (WSL2 works).

```bash
# Install
npm install -g openlander

# Run
openlander
```

> **Note**: OpenLander requires [Node.js](https://nodejs.org/) >= 22 and Docker.

1. Check Docker (install if missing, fix permissions if needed)
2. Start the Traefik reverse proxy
3. Open the Web UI at `http://localhost:10114`
4. Walk through setup: add an LLM API key (Gemini free tier works)
5. You're ready to deploy

## Features

### Web Dashboard

- **Project overview** — Status, deployment history, domains, environment variables at a glance
- **Deployment history** — Every deploy with commit SHA, duration, status, and build logs
- **Build log streaming** — Real-time build output as it happens
- **Web terminal** — xterm.js terminal for exec'ing into running containers directly from the browser
- **ANSI color rendering** — Docker build output and runtime logs render with proper colors
- **AI analysis on failure** — When a build fails or container crashes, AI analysis appears inline
- **Settings management** — AI provider, GitHub connection, global secrets
- **Multilingual (i18n)** — Korean and English. Language selection during onboarding, applies to all UI and AI responses

### AI Auto-Recovery

- **Build failure analysis** — Recipe-based fast-path + LLM analysis for build errors
- **Automatic Dockerfile fix** — AI detects the root cause and retries with a corrected Dockerfile
- **Runtime crash detection** — Container health monitoring with automatic diagnosis
- **Post-deploy insights** — Health check results, resource usage, cleanup recommendations
- **Smart defaults** — Learns from previous deployments to suggest optimal settings

### Deployment

- **Git → Docker → URL** — Clone, build, run, expose. One click.
- **Traefik auto-routing** — Each project gets its own subdomain. No port conflicts.
- **Server awareness** — Auto-detects all containers, ports, and proxies before deploying
- **Preflight check** — Validates port availability, container names, resources before build starts
- **Auto-redeploy** — Git push webhook triggers automatic redeployment
- **Rollback & blue-green** — One-click rollback, zero-downtime deploys
- **Public sharing** — Instant public URL via TryCloudflare. No domain needed.
- **Production domains** — Permanent URLs via Cloudflare Tunnel. Multi-domain mapping.

### Infrastructure

- **Auto-Dockerfile** — No Dockerfile? Auto-generates one for Next.js, FastAPI, Gradio, Streamlit, Rails, Spring Boot, Laravel, ASP.NET
- **Monorepo support** — Scan Dockerfiles, parallel builds, parent-child project model
- **Logs & monitoring** — Container logs, health checks, system resource tracking
- **Environment variables** — Global encrypted secrets shared across projects
- **DB provisioning** — PostgreSQL, MySQL, Redis containers on demand

### Integration

- **MCP server** — Deploy from Claude Code, Cursor, or any MCP client
- **Multi-channel** — Slack, Discord, Telegram bots for remote management
- **BYOK (Bring Your Own Key)** — Gemini Flash (free), Claude, OpenAI, OpenRouter, or Ollama (local)
- **OAuth login** — Sign in with OpenAI or OpenRouter account (no API key needed)
- **Private repos** — SSH key auth. Works with GitHub, GitLab, Bitbucket, Gitea.

## How It Works

```
User (Web Dashboard — deploy, monitor, configure)
    ↓
AI Agent (background — build error analysis, crash recovery, smart defaults)
    ↓
Deploy Pipeline (deterministic — rule-based execution)
    ├─ preflight check (port/name/resource/proxy validation)
    ├─ git clone
    ├─ docker build (Dockerfile or auto-generated template)
    ├─ docker run (auto port + Traefik labels)
    ├─ expose (TryCloudflare / Cloudflare Tunnel)
    └─ monitor (health checks + crash detection + auto-recovery)
    ↓
Infrastructure (Docker + Traefik + Cloudflare + SQLite)
```

**Key principle**: Execution is deterministic (rule-based). The AI only handles error analysis, recovery, and insights — never makes deployment decisions autonomously.

## External Access

| Mode           | Use Case     | Implementation                | Domain Required |
| -------------- | ------------ | ----------------------------- | --------------- |
| 🔒 Internal    | Same network | Local IP + Traefik            | No              |
| 🌐 Quick Share | Demo/review  | TryCloudflare (temp URL)      | No              |
| 🌐 Production  | Always-on    | Cloudflare Tunnel (permanent) | Yes             |

Default is **Internal** (safe). Switch to public from the dashboard.

## Tech Stack

| Area          | Technology                                                                      |
| ------------- | ------------------------------------------------------------------------------- |
| Language      | TypeScript (strict mode, ESM)                                                   |
| Runtime       | [Node.js](https://nodejs.org/) >= 22                                            |
| Build         | [tsup](https://tsup.egoist.dev) (backend) + [Vite](https://vite.dev) (frontend) |
| Install       | npm global package                                                              |
| Web UI        | React 19 + React Router + Tailwind CSS v3                                       |
| AI            | [Vercel AI SDK](https://ai-sdk.dev) — multi-provider, streaming, tool calling   |
| ORM           | [Drizzle ORM](https://orm.drizzle.team) + better-sqlite3                        |
| Docker        | dockerode                                                                       |
| Reverse Proxy | Traefik (Docker label routing)                                                  |
| Tunnel        | TryCloudflare / Cloudflare Tunnel                                               |
| Database      | SQLite (via Drizzle ORM)                                                        |
| Test          | Vitest + Node.js                                                                |

## Roadmap

| Version         | Focus                        | Status | Highlights                                                                                                                                                                    |
| --------------- | ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0**      | MVP                          | Done   | Chat-driven deployment, Docker + Traefik, MCP server (23 tools)                                                                                                               |
| **v0.2.0**      | Web Dashboard                | Done   | React SPA, Vercel-inspired UI, real-time timeline, NDJSON streaming                                                                                                           |
| **v0.2.1**      | i18n + Bugfixes              | Done   | Korean/English i18n, build error reporting, OAuth callback fix                                                                                                                |
| **v0.2.2**      | Deploy Controls              | Done   | Blue-green deploy UI, webhook settings, rollback button                                                                                                                       |
| **v0.2.3**      | Domains & Visibility         | Done   | Domain CRUD UI, server scan dashboard, public URL management                                                                                                                  |
| **v0.2.4**      | Services                     | Done   | Shared infrastructure (PostgreSQL, Redis, etc.), custom Docker images                                                                                                         |
| **v0.2.5**      | Release Preparation          | Done   | Code review fixes, Cloudflare config UI, i18n simplification                                                                                                                  |
| **v0.2.6**      | Shared Mode & Preview        | Done   | Traefik File Provider, Quick Share via Traefik, access codes (Shared mode), PR preview deploys                                                                                |
| **v0.3.0**      | Developer Experience         | Done   | Real-time Docker build log streaming, ANSI color rendering, xterm.js web terminal, WebSocket infrastructure                                                                   |
| **v0.3.1**      | UI Polish & Stability        | Done   | Terminal shell probing for Alpine/slim images, log-first console layout, overview summary dashboard                                                                           |
| **v0.4.0**      | Deployments UX               | Done   | Deployments filters, richer history rows, detail metadata cards, API UTC normalization                                                                                        |
| **v0.5.1**      | Multi-Environment            | Done   | Environment schema, multi-branch deploys, environment-aware orchestration                                                                                                     |
| **v0.6.0**      | Architecture Rebuild         | Done   | Deterministic deploy pipeline, unified ToolDef registry (40+ tools), shared infra (PostgreSQL/MySQL/Redis), deploy terminal UI, AI co-pilot (7 features), webhook tools       |
| **v0.6.1**      | Env Vars Fix                 | Done   | Env vars merge (not replace), list_env_vars tool, health monitor Docker fallback                                                                                              |
| **v0.6.2**      | Compose & Traefik            | Done   | Compose service filtering, secret file mount, env escaping, Traefik HTTP Provider, build log detail, redeploy port fix                                                        |
| **v0.6.3**      | Port Stability               | Done   | Port preservation on redeploy, environments port tracking, public URL API fix                                                                                                 |
| **v0.6.4**      | Deploy Plan v2               | Done   | Non-blocking execute, deep repo analysis (compose/Dockerfiles/env), dockerfile_path param, estimated_seconds polling hint                                                     |
| **v0.6.5**      | Deploy Plan Bugfixes         | Done   | Compose routing fix, env redaction fix, deploy_only service selection, build log in status, auto build context, version requirements                                          |
| **v0.6.9**      | MCP Bugfixes                 | Done   | Compose deploy completion, --progress version gating, DOCKER_HOST IP detection, service status reconciliation                                                                 |
| **v0.6.10**     | Deploy Bugfixes              | Done   | Dockerfile path routing fix, container conflict recipe, env var optional detection, agent/fallback race fix, BuildDebugger i18n, question event handling                      |
| **v0.6.11**     | Deploy Hardening & QA        | Done   | Monorepo routing fix, build context persistence, disk preflight, container names, service health check, env var debug, build progress                                         |
| **v0.6.15**     | Deploy UX Quick Wins         | Done   | Build step progress in status, env source tracking, deploy-plan internal URLs, MCP HTTP session cleanup, richer MCP tool descriptions                                         |
| **v0.7.0**      | Architecture Rebuild         | Done   | Compose deploy via dockerode, override hacks removed, orphan child cleanup, compose YAML extensions, project-scoped Docker networks                                           |
| **v0.7.1**      | MCP Response Guidance        | Done   | verify/action_required/recovery_hint in tool responses, remote Docker warnings, agent behavior correction for curl/docker CLI fallback                                        |
| **v0.7.2**      | MCP DX Enhancement           | Done   | mcpDescription for all 64 tools, error pattern unification, agent guidance for state-changing tools, orphan tool connections                                                  |
| **v0.7.3**      | Pipeline Refactor + Bugfixes | Done   | Deploy orchestration extraction (519→251 lines), Dockerfile.\* scan, Python infra detection, Docker log header stripping                                                      |
| **v0.8.0**      | MCP-First Web Pivot          | Done   | Web dashboard monitoring-focused, LLM optional, auto-recovery dual-mode (LLM + programmatic), RecoveryCard timeline                                                           |
| **v0.9.0**      | Web Agent Mode               | Done   | ChatGPT-style agent chat in web dashboard, NDJSON streaming, multi-session DB persistence, markdown rendering, tool call visualization                                        |
| **v0.9.6**      | UI Polish                    | Done   | Agent Chat iMessage-style bubbles, code block syntax highlighting + copy button, session Context migration, Deployments compact Vercel-style rows, AI deploy border fix       |
| **v0.9.7**      | Backend Refactor & MCP       | Done   | Service-manager adapter pattern (-42%), setup-routes domain split (-71%), project-routes dedup (-9%), MCP service external access (LAN/VPN IPs), test suite green (1462 pass) |
| **v0.9.9**      | Typography & Infrastructure  | Done   | Inter+Geist Mono self-hosted fonts, Docker image auto-cleanup, sslip.io dynamic IP, multi-deploy wait, Traefik restart survival                                               |
| **v0.9.10**     | UI Polish & Agent DX         | Done   | Deploy terminal readability, log error underline fix, container name truncation, time wrapping, xterm font consistency, no_cache timeout guidance                             |
| **v0.9.13**     | Platform Debug/Admin Tools   | Done   | Platform debug/admin MCP tools (11 tools, config-gated), generic RingBuffer, EventBus capture, Pino log ring buffer                                                           |
| **v1.0.0-rc.1** | Release Candidate            | RC     | E2E quality gate test suite (20 tests), 7 test repositories, event sequence golden path verification, quality gate coverage mapping                                           |
| **v1.0.0**      | Stable Release               | TBD    | MCP-first platform, quality hardening, web as monitoring dashboard, auto-recovery in background                                                                               |

## MCP Integration (AI Coding Agents)

OpenLander runs as an MCP server, letting AI coding agents deploy and manage projects directly.

### OpenCode

```jsonc
// opencode.json (project root or ~/.config/opencode/config.json)
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "openlander": {
      "type": "local",
      "command": ["openlander", "mcp"],
      "enabled": true,
    },
  },
}
```

For remote servers (e.g. via Tailscale/VPN):

```jsonc
{
  "mcp": {
    "openlander": {
      "type": "remote",
      "url": "http://YOUR_SERVER_IP:10114/mcp",
      "enabled": true,
    },
  },
}
```

Verify: `opencode mcp list` / `opencode mcp debug openlander`

### Claude Desktop

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "openlander": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

### Cursor

```jsonc
// .cursor/mcp.json (project root)
{
  "mcpServers": {
    "openlander": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

### Windsurf

```jsonc
// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "openlander": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

### Available Tools

Once connected, AI agents get 60+ tools including:

| Category | Tools                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Deploy   | `create_plan`, `execute_plan`, `rollback_project`, `deploy_blue_green`     |
| Services | `create_service`, `get_service_credentials`, `provision_database`          |
| Config   | `set_env_vars`, `list_env_vars`, `set_global_secret`, `upload_secret_file` |
| Monitor  | `get_deploy_status`, `get_build_log`, `debug_build_error`, `get_logs`      |
| Projects | `list_projects`, `stop_project`, `remove_project`, `scan_project`          |
| Domains  | `map_domain`, `list_domains`, `verify_domain`                              |
| Webhooks | `configure_webhook`, `enable_webhook`, `disable_webhook`, `list_webhooks`  |

## Requirements

- **Platform**: Linux or macOS (Windows is not supported, but WSL2 on Windows works)
- **[Node.js](https://nodejs.org/)** >= 22 (includes npm)
- **[Docker Engine](https://docs.docker.com/engine/)** >= 20.10 with **[Compose V2](https://docs.docker.com/compose/)** >= 2.3.0
- **Git** >= 2.x
- **LLM API key** (configured during setup) — one of:
  - [Google Gemini](https://ai.google.dev/) (free tier available)
  - [OpenRouter](https://openrouter.ai/) (free tier, no credit card)
  - [Anthropic Claude](https://console.anthropic.com/)
  - [OpenAI](https://platform.openai.com/)
  - [Ollama](https://ollama.com/) (fully local, no API key needed)

### Installing Docker

OpenLander needs Docker to build and run containers. The setup wizard will detect Docker and guide you through installation.

**Option 1: Auto-install (Linux / WSL2)**

The setup wizard will offer to install Docker automatically if it's not found.

**Option 2: Manual install**

```bash
# Linux / WSL2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then:
sudo systemctl start docker

# macOS
brew install --cask docker
# Or download Docker Desktop: https://www.docker.com/products/docker-desktop/
```

**Option 3: Ask your AI coding agent**

If you're using Claude Code, Cursor, or another AI coding tool, just tell it:

```
Install Docker on this machine and start the daemon
```

The agent will handle the installation for your platform.

## Development

```bash
# Prerequisites: Node.js >= 22, Docker

# Clone & build
git clone https://github.com/openlander-ai/OpenLander.git
cd OpenLander
npm install
npm run build

# Run
node dist/cli/index.js
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

- Bug reports and feature requests → [Issues](https://github.com/openlander-ai/OpenLander/issues)
- Security vulnerabilities → [Security Policy](SECURITY.md)

## License

[MIT](LICENSE) © OpenLander Contributors
