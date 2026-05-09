<div align="center">

# 🛬 OpenLander

**Self-hosted deployment platform with MCP-native agent workflows.**

Paste a Git URL. It builds, deploys, and hands you a URL. If something breaks,
your external coding agent can inspect logs and redeploy through OpenLander MCP.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

</div>

---

## The Problem

AI coding tools (Cursor, Claude Code, etc.) made it so anyone can build an app. But deployment? Still painful.

You need to know Docker, reverse proxies, port mapping, SSL, DNS — or pay $10+/month per service on the cloud.

**OpenLander fixes this.** A clean web dashboard for deploying, plus MCP tools
so your coding agent can operate the platform when something goes wrong.

**Mental model**: a Project is a workspace/group. A Service is the deployable unit that owns
repository, image, branch, Dockerfile, build config, runtime state, and deploy history. The dashboard
and MCP keep a one-step "deploy this repo" wrapper for the common single-service case.

```
1. Paste a Git URL
2. Click Deploy
3. Get a URL

Build failed? Read the logs in the dashboard or through MCP.
Container crashed? OpenLander records status and logs; your agent can inspect and redeploy.
```

## Why Not Just Use Coolify / Dokploy?

Those are great tools. OpenLander takes a different approach.

|                       | Coolify / Dokploy               | OpenLander                                               |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| Interface             | Web dashboard (forms & buttons) | Web dashboard + MCP-first agent workflow                 |
| When builds fail      | You read logs, you fix it       | Dashboard/MCP exposes logs for your external agent       |
| When containers crash | You get an alert                | Health/status/logs are recorded; remediation is explicit |
| Coding agent support  | None                            | MCP protocol — deploy from Cursor, Claude Code, etc.     |
| Server awareness      | Manual configuration            | Auto-detects ports, proxies, containers before deploying |
| Install               | `docker compose`                | `docker compose` (includes Postgres)                     |

**Positioning**: Coolify's Docker foundation + Vercel's clean UX + MCP-native operations.

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
> On memory-constrained hosts, use the prebuilt runtime image path in
> [Running as a Service](#running-as-a-service) instead of building inside Docker.

1. Check Docker (install if missing, fix permissions if needed)
2. Start the Traefik reverse proxy
3. Open the Web UI at `http://localhost:10114`
4. Walk through setup: language, admin password, infrastructure, GitHub, and MCP
   - On first boot OpenLander prints a one-time **setup secret** to the console; copy it into the setup form to claim the admin account. This prevents anyone else on the LAN from registering before you do.
5. You're ready to deploy

## Running as a Service

Docker Compose is the recommended background lifecycle for self-hosted installs. It runs
OpenLander plus Postgres and keeps both data volumes attached across restarts.

> **0.1 deployment constraints**
>
> - **Single-process only.** OpenLander 0.1 is not safe under PM2 cluster mode
>   (or any other multi-worker supervisor). The first-boot setup secret and OAuth
>   PKCE verifier map live in process memory. Stick to a single instance.

### Docker

Recommended:

```bash
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose up -d --build
```

Low-memory/prebuilt image path:

```bash
npm install
npm run docker:build:runtime
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose -f docker-compose.runtime.yml up -d
```

The prebuilt path compiles TypeScript and the web UI on the host, disables
Docker-image-only declaration/sourcemap output, then builds a small runtime image
from `dist/` and `web/dist/`. Use it when `docker compose up --build` is killed
by host memory pressure.

This starts OpenLander plus a dedicated Postgres container and preserves data in
Docker volumes:

- `openlander-data` — OpenLander config, secrets, and app data
- `openlander-postgres` — OpenLander database

OpenLander performs git operations from inside the control-plane container. The
runtime image includes `git` and `openssh-client` so GitHub/Git SSH deployments
work in Docker Compose mode. Repositories are cloned into temporary deployment
workspaces and passed to the Docker daemon as build contexts. Set
`OPENLANDER_WORKSPACE_DIR` to override the temporary clone workspace root; by
default OpenLander uses the OS temp directory and cleans deployment workspaces
after use.

Minimal one-container runtime is possible only if you provide an external Postgres URL.
This is an advanced deployment path; Docker Compose is the supported default.

```bash
docker run -d \
  --name openlander \
  --restart unless-stopped \
  -p 10114:10114 \
  -e OPENLANDER_DATABASE_URL='postgres://user:password@host:5432/openlander' \
  -v openlander-data:/root/.openlander \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/openlander-ai/openlander:latest
```

> `openlander stop` and `openlander restart` are no-ops that point you back at the supervisor — terminating the supervised process is always the supported lifecycle path.

### Direct CLI Runtime

`openlander` runs in the foreground when started directly. This mode is for
development or custom service managers only. You must provide an external
Postgres URL:

```bash
OPENLANDER_DATABASE_URL='postgres://user:password@host:5432/openlander' \
  openlander start --no-open
```

PM2/systemd can supervise that foreground process for custom installs, but the
default supported production path is Docker Compose.

## Features

### Web Dashboard

- **Project overview** — Status, deployment history, domains, environment variables at a glance
- **Deployment history** — Every deploy with commit SHA, duration, status, and build logs
- **Build log streaming** — Real-time build output as it happens
- **Web terminal** — xterm.js terminal for exec'ing into running containers directly from the browser
- **ANSI color rendering** — Docker build output and runtime logs render with proper colors
- **Failure visibility** — Failed deployments keep build logs and runtime logs for dashboard/MCP inspection
- **Settings management** — GitHub connection, MCP, global secrets
- **Multilingual (i18n)** — Korean and English. Language selection during onboarding applies to all UI

### Deployment

- **Git → Docker → URL** — Clone, build, run, expose. One click.
- **Traefik auto-routing** — Each project gets its own subdomain. No port conflicts.
- **Server awareness** — Auto-detects all containers, ports, and proxies before deploying
- **Preflight check** — Validates port availability, container names, resources before build starts
- **Rollback & blue-green** — One-click rollback, zero-downtime redeploy with health check (`strategy: 'blue-green' | 'force'`)
- **Public sharing** — Instant public URL via TryCloudflare. No domain needed.
- **Production domains** — Permanent URLs via Cloudflare Tunnel. Multi-domain mapping.

### Infrastructure

- **Auto-Dockerfile** — No Dockerfile? Auto-generates one for 28+ frameworks including Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Gradio, Streamlit, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust
- **Monorepo support** — Scan Dockerfiles, parallel builds, project/service grouping
- **Logs & monitoring** — Container logs, health checks, system resource tracking
- **Environment variables** — Service-scoped env vars plus global encrypted secrets
- **DB provisioning** — PostgreSQL, MySQL, Redis, MongoDB, MinIO containers on demand

### Integration

- **MCP server** — Deploy from Claude Code, Cursor, or any MCP client
- **Email alerts** — SMTP delivery for recovery / alert notifications (Slack / Discord / Telegram planned for a future 0.x release)
- **Private repos** — SSH key auth. Works with GitHub, GitLab, Bitbucket, Gitea.

## How It Works

```
User (Web Dashboard — deploy, monitor, configure)
    ↓
Deploy Pipeline (deterministic — rule-based execution)
    ├─ preflight check (port/name/resource/proxy validation)
    ├─ git clone
    ├─ docker build (Dockerfile or auto-generated template)
    ├─ docker run (auto port + Traefik labels)
    ├─ expose (TryCloudflare / Cloudflare Tunnel)
    └─ monitor (health checks + crash detection + logs)
    ↓
Infrastructure (Docker + Traefik + Cloudflare + Postgres)
```

**Key principle**: Execution is deterministic (rule-based). In 0.1, OpenLander
does not run an internal LLM agent or automatic remediation. External agents use
MCP to read logs, make repo/config changes, and call deploy/redeploy explicitly.

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
| Agent I/O     | MCP server for external coding agents                                           |
| ORM           | [Drizzle ORM](https://orm.drizzle.team) + postgres.js                           |
| Docker        | dockerode                                                                       |
| Reverse Proxy | Traefik (Docker label routing)                                                  |
| Tunnel        | TryCloudflare / Cloudflare Tunnel                                               |
| Database      | PostgreSQL 16 (Docker Compose by default)                                       |
| Test          | Vitest + Node.js                                                                |

## Roadmap

| Version    | Focus                  | Status  | Highlights                                                                                                                                                                                          |
| ---------- | ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1.0** | First public release   | Current | Git → Docker → URL pipeline, auto-Dockerfile (28+ frameworks), Compose support redeploy, 64 unique MCP operations across 5 composites + 13 gated platform tools, web dashboard, Korean/English i18n |
| **v0.2.x** | Post-launch refinement | TBD     | Driven by user feedback in the first 30 days. Likely: tighter MCP observability, runtime metrics snapshot, log rotation, rate limits, Operations Center revival if there is demand                  |

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

For remote, prefer the Streamable HTTP endpoint: `http://YOUR_SERVER_IP:10114/mcp`.
Older clients can use the SSE endpoint: `http://YOUR_SERVER_IP:10114/mcp/sse`.

### Remote Authentication

When a password is set, remote MCP connections require a Bearer token. Generate an
org-wide token from **Settings > MCP**, or a project-scoped token from a project's
**MCP** tab. Project-scoped tokens are the safer default for daily agent work because
they cannot act outside that project group.

```
Authorization: Bearer <your-api-token>
```

Destructive MCP operations are deliberately conservative in 0.1. Service deletion
is UI-only and requires typed confirmation. Bulk env/secret deletion enters a
human approval hold before execution.

### Troubleshooting

| Symptom                                    | Cause                                                                       | Fix                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `405 Method Not Allowed` on remote connect | Client is sending `GET` to `/mcp` (SSE handshake) but server expects `POST` | Switch client URL to `/mcp/sse`, or update client to use Streamable HTTP |
| `401 Unauthorized`                         | Password is set but no token provided                                       | Add Bearer token to client config (see Remote Authentication above)      |
| Connection hangs / times out               | Firewall blocking port 10114                                                | Open port 10114, or use Tailscale/VPN for direct access                  |

### Available Tools

Once connected, AI agents see **5 composite MCP tools** covering **64 unique default operations** (78 routed composite actions, plus 13 optional platform tools gated by `config.mcp.platformTools`, which defaults to `false`). Each composite takes `{ action, params }`:

| Composite tool               | Actions | Key actions                                                                                                                            |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `openlander_deploy`          | 18      | `deploy`, `create_deploy_plan`, `execute_deploy_plan`, `rollback_service`, `get_build_log`                                             |
| `openlander_project`         | 14      | Group/config operations: `list_projects`, `set_global_secret`, `upload_secret_file`, `expose_public`                                   |
| `openlander_service`         | 19      | Deployable app/worker vocabulary: `deploy_service`, `rollback_service`, `restart_service`, `set_env_vars`, `archive_service`           |
| `openlander_managed_service` | 21      | Managed infrastructure: `create_service`, `list_services`, `get_service_credentials`, `backup_service`, `add_volume`, `get_disk_usage` |
| `openlander_monitor`         | 6       | `get_logs`, `get_alerts`, `get_system_stats`, `get_project_stats`, `dismiss_alert`, `probe_host`                                       |

Run `action: "help"` on any composite to list its full action catalog.

Environment variables belong to deployable services. Prefer `service_id` or `service_name`
when using `set_env_vars`, `delete_env_var`, or `bulk_delete_env_vars`; `project_name` is
accepted only as a convenience when the group has exactly one deployable service. MCP env
changes are conservative by default and do not redeploy unless `defer_redeploy=false` is
passed. Redeploy explicitly with `deploy_service` to apply saved env changes to a running
container. Older group-shared env values are migrated to every deployable service as
independent copies; editing one service no longer updates sibling services.

## Requirements

- **Platform**: Linux or macOS (Windows is not supported, but WSL2 on Windows works)
- **[Node.js](https://nodejs.org/)** >= 22 (includes npm)
- **[Docker Engine](https://docs.docker.com/engine/)** >= 20.10 with **[Compose V2](https://docs.docker.com/compose/)** >= 2.3.0
- **Git** >= 2.x for direct/custom runtime installs. Docker Compose runtime images include git.

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
