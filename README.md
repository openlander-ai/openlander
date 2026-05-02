<div align="center">

# 🛬 OpenLander

**Self-hosted deployment platform that fixes its own failures.**

Paste a Git URL. It builds, deploys, and hands you a URL — if something breaks, AI fixes it automatically.

[![npm version](https://img.shields.io/npm/v/openlander.svg)](https://www.npmjs.com/package/openlander)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

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
| Install               | `docker compose`                | `docker compose` (includes Postgres)                     |

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
# Start OpenLander plus its Postgres database
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose up -d --build
```

> **Note**: The supported self-hosted runtime is Docker Compose with Postgres.
> Running the CLI directly is for development or custom service managers and
> requires `OPENLANDER_DATABASE_URL` / `DATABASE_URL` to point at Postgres.

1. Check Docker (install if missing, fix permissions if needed)
2. Start the Traefik reverse proxy
3. Open the Web UI at `http://localhost:10114`
4. Walk through setup: add an LLM API key (Gemini free tier works)
   - On first boot OpenLander prints a one-time **setup secret** to the console; copy it into the setup form to claim the admin account. This prevents anyone else on the LAN from registering before you do.
5. You're ready to deploy

## Running as a Service

`openlander` runs in the foreground. Use a process supervisor for background lifecycle.

> **1.0 deployment constraints**
>
> - **Single-process only.** OpenLander 1.0 is not safe under PM2 cluster mode (or any other multi-worker supervisor). The first-boot setup secret, the OAuth PKCE verifier map, and the agent pool live in process memory — workers would each see a different secret and fail to share session state. Stick to a single instance.
> - **Single-tenant LLM pool.** The agent pool has a hard cap of 5 concurrent LLM sessions and is not partitioned per user. Concurrent operation by multiple users will surface as `429 LLM_CONCURRENCY_EXCEEDED` once the cap is hit. Per-tenant fairness is planned for v1.1.

### systemd

```ini
# /etc/systemd/system/openlander.service
[Unit]
Description=OpenLander
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=openlander
ExecStart=/usr/local/bin/openlander start --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now openlander
sudo systemctl status openlander
```

### pm2

```js
// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'openlander',
      script: 'openlander',
      args: 'start --no-open',
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### Docker

Recommended:

```bash
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose up -d --build
```

This starts OpenLander plus a dedicated Postgres container and preserves data in
Docker volumes:

- `openlander-data` — OpenLander config, cloned repos, secrets, and app data
- `openlander-postgres` — OpenLander database

Minimal one-container runtime is possible only if you provide an external Postgres URL:

```bash
docker run -d \
  --name openlander \
  --restart unless-stopped \
  -p 10114:10114 \
  -e OPENLANDER_DATABASE_URL='postgres://user:password@host:5432/openlander' \
  -v openlander-data:/root/.openlander \
  -v /var/run/docker.sock:/var/run/docker.sock \
  node:22 \
  sh -c "npm install -g openlander && openlander start --no-open --host 0.0.0.0"
```

> `openlander stop` and `openlander restart` are no-ops that point you back at the supervisor — terminating the supervised process is always the supported lifecycle path.

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
- **Rollback & blue-green** — One-click rollback, zero-downtime redeploy with health check (`strategy: 'blue-green' | 'force'`)
- **Public sharing** — Instant public URL via TryCloudflare. No domain needed.
- **Production domains** — Permanent URLs via Cloudflare Tunnel. Multi-domain mapping.

### Infrastructure

- **Auto-Dockerfile** — No Dockerfile? Auto-generates one for 28+ frameworks including Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Gradio, Streamlit, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust
- **Monorepo support** — Scan Dockerfiles, parallel builds, parent-child project model
- **Logs & monitoring** — Container logs, health checks, system resource tracking
- **Environment variables** — Project-scoped and global encrypted secrets
- **DB provisioning** — PostgreSQL, MySQL, Redis, MongoDB, MinIO containers on demand

### Integration

- **MCP server** — Deploy from Claude Code, Cursor, or any MCP client
- **Email alerts** — SMTP delivery for recovery / alert notifications (Slack / Discord / Telegram planned for 1.0.x)
- **BYOK (Bring Your Own Key)** — Gemini Flash (free), Claude, OpenAI, OpenRouter, or Ollama (local)
- **OAuth connect** — Link OpenRouter or OpenAI accounts for LLM access (no manual API key needed)
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
Infrastructure (Docker + Traefik + Cloudflare + Postgres)
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
| Install       | Docker Compose (recommended); npm CLI for direct/custom runtimes                |
| Web UI        | React 19 + React Router + Tailwind CSS v3                                       |
| AI            | [Vercel AI SDK](https://ai-sdk.dev) — multi-provider, streaming, tool calling   |
| ORM           | [Drizzle ORM](https://orm.drizzle.team) + postgres.js                           |
| Docker        | dockerode                                                                       |
| Reverse Proxy | Traefik (Docker label routing)                                                  |
| Tunnel        | TryCloudflare / Cloudflare Tunnel                                               |
| Database      | PostgreSQL 16 (Docker Compose by default)                                       |
| Test          | Vitest + Node.js                                                                |

## Roadmap

| Version    | Focus                  | Status  | Highlights                                                                                                                                                                                                                                                       |
| ---------- | ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0** | First public release   | Current | Git → Docker → URL pipeline, auto-Dockerfile (28+ frameworks), Compose support, blue-green redeploy, AI auto-recovery (RecoveryCoordinator + ApprovalGate + 10 LLM providers), 99 MCP tools across 4 composite + 11 platform, web dashboard, Korean/English i18n |
| **v0.2.x** | Post-launch refinement | TBD     | Driven by user feedback in the first 30 days. Likely: tighter MCP observability, runtime metrics snapshot, log rotation, rate limits, Operations Center revival if there is demand                                                                               |

## MCP Integration (AI Coding Agents)

OpenLander runs as an MCP server, letting AI coding agents deploy and manage projects directly.

### Transport Protocols

| Transport           | Endpoint                              | Use Case                                                    |
| ------------------- | ------------------------------------- | ----------------------------------------------------------- |
| **stdio**           | `openlander mcp`                      | Local — agent spawns the process directly                   |
| **Streamable HTTP** | `POST /mcp`                           | Remote — current MCP standard (2025-11-25)                  |
| **SSE** (legacy)    | `GET /mcp/sse` + `POST /mcp/messages` | Remote — for clients that don't support Streamable HTTP yet |

**Local**: Use stdio (all clients support it). **Remote**: Use Streamable HTTP if your client supports it, SSE otherwise.

### Client Setup

#### OpenCode

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

> If remote connection fails, try the SSE endpoint: `http://YOUR_SERVER_IP:10114/mcp/sse`

Verify: `opencode mcp list` / `opencode mcp debug openlander`

#### Claude Desktop / Claude Code

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

For remote: `claude mcp add openlander -t http http://YOUR_SERVER_IP:10114/mcp`

#### Cursor

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

For remote:

```jsonc
{
  "mcpServers": {
    "openlander": {
      "url": "http://YOUR_SERVER_IP:10114/mcp",
      "type": "http",
    },
  },
}
```

#### Windsurf

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

#### Cline

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "openlander": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

For remote, use the SSE endpoint: `http://YOUR_SERVER_IP:10114/mcp/sse`

### Remote Authentication

When a password is set, remote MCP connections require a Bearer token. Generate one from **Settings > Security** in the web dashboard, then pass it as an `Authorization` header:

```
Authorization: Bearer <your-api-token>
```

### Troubleshooting

| Symptom                                    | Cause                                                                       | Fix                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `405 Method Not Allowed` on remote connect | Client is sending `GET` to `/mcp` (SSE handshake) but server expects `POST` | Switch client URL to `/mcp/sse`, or update client to use Streamable HTTP |
| `401 Unauthorized`                         | Password is set but no token provided                                       | Add Bearer token to client config (see Remote Authentication above)      |
| Connection hangs / times out               | Firewall blocking port 10114                                                | Open port 10114, or use Tailscale/VPN for direct access                  |

### Available Tools

Once connected, AI agents see **4 composite MCP tools** that bundle **70 actions** (plus 11 optional platform tools gated by `config.mcp.platformTools`). Each composite takes `{ action, params }`:

| Composite tool       | Actions | Key actions                                                                                                                                    |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `openlander_deploy`  | 20      | `deploy`, `create_deploy_plan`, `execute_deploy_plan`, `rollback_project`, `deploy_blue_green`, `get_build_log`, `debug_build_error`           |
| `openlander_project` | 21      | `list_projects`, `redeploy_project`, `stop_project`, `archive_project`, `set_env_vars`, `set_global_secret`, `enable_webhook`, `expose_public` |
| `openlander_service` | ~17     | `create_service`, `get_service_credentials`, `create_service_database`, `backup_service`, `add_volume`, `get_disk_usage`                       |
| `openlander_monitor` | ~12     | `get_logs`, `get_alerts`, `get_system_stats`, `get_project_stats`, `dismiss_alert`, `get_deploy_status`                                        |

Run `action: "help"` on any composite to list its full action catalog.
| Infrastructure | `analyze_infrastructure`, `map_domain`, `list_domains` |
| Webhooks | `enable_webhook`, `disable_webhook`, `get_webhook_config` |

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

[AGPL-3.0](LICENSE) © OpenLander Contributors
