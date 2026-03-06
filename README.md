<div align="center">

# 🛬 OpenLander

**AI agent that deploys your app from a chat.**

Give it a repo URL. It clones, builds, deploys, and hands you a URL.

[![npm version](https://img.shields.io/npm/v/openlander.svg)](https://www.npmjs.com/package/openlander)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚧 **Early Stage** — Under active development. Expect breaking changes.

</div>

---

## The Problem

AI coding tools (Cursor, Claude Code, etc.) made it so anyone can build an app. But deployment? Still painful.

You need to know Docker, reverse proxies, port mapping, SSL, DNS — or pay $10+/month per service on the cloud.

**OpenLander fixes this.** Tell it what to deploy, and it handles the rest.

```
You:    Deploy this repo github.com/user/my-app
Agent:  Cloning... ✅
        Dockerfile found ✅
        Building... ✅ (38s)
        Container running ✅
        🔒 http://my-app.local:10003

You:    Make it public
Agent:  ✅ https://shy-tiger-abc123.trycloudflare.com
        ⚠️ Temporary URL. Changes on restart.

You:    Show me the logs
Agent:  Last 30 lines:
        [14:32:01] Server started on port 3000
        [14:32:03] Database connected
        ...
```

## Why Not Just Use Coolify / Dokploy?

Those are great tools — for people who already understand infrastructure.

|           | Coolify / Dokploy         | OpenLander                        |
| --------- | ------------------------- | --------------------------------- |
| Analogy   | Self-service gas station  | Full-service gas station          |
| Interface | Web dashboard + chat      | Web chat (natural language)       |
| Target    | Devs with infra knowledge | Anyone who can build an app w/ AI |
| Install   | `docker compose`          | `npm i -g`                        |
| Config    | You figure it out         | Agent figures it out              |

OpenLander isn't a competitor — it's a different category.

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

# Run (requires Bun runtime)
openlander
```

> **Note**: OpenLander uses [Bun](https://bun.sh) as its runtime. If Bun is not installed, the `openlander` command will guide you through setup.

1. Check Docker (install if missing, fix permissions if needed)
2. Start the Traefik reverse proxy
3. Open the Web UI at `http://localhost:10003`
4. Walk through setup: add an LLM API key (Gemini free tier works)
5. You're ready to deploy

## Features

### Web UI

- **Chat-driven interface** — Deploy, manage, and monitor through natural conversation
- **Real-time dashboard** — Project status, system resources, deployment timeline
- **Settings management** — AI provider, GitHub connection, global secrets
- **Agent intervention** — Structured choices when the agent needs your input

### Deployment

- **Chat-driven deployment** — Describe what you want in plain English
- **Git \u2192 Docker \u2192 URL** — Clone, build, run, expose. One conversation.
- **Traefik auto-routing** — Each project gets its own subdomain. No port conflicts.
- **Public sharing** — Instant public URL via TryCloudflare. No domain needed.
- **Production domains** — Permanent URLs via Cloudflare Tunnel. Multi-domain mapping.
- **Environment variables** — Manage secrets through chat or Web UI. Global encrypted secrets shared across projects.
- **Auto-redeploy** — Git push webhook triggers automatic redeployment
- **Rollback & blue-green** — One-command rollback, zero-downtime deploys

### Infrastructure

- **Logs & monitoring** — Container logs, health checks, system resource tracking
- **Monorepo support** — Scan Dockerfiles, parallel builds, parent-child project model
- **Auto-Dockerfile** — No Dockerfile? Auto-generates one for Next.js, FastAPI, Gradio, Streamlit
- **Build debugger** — Recipe-based fast-path + LLM analysis for build errors
- **DB provisioning** — PostgreSQL, MySQL, Redis containers on demand

### Integration

- **MCP server** — Deploy from Claude Code, Cursor, or any MCP client
- **Multi-channel** — Slack, Discord, Telegram bots for remote management
- **BYOK (Bring Your Own Key)** — Gemini Flash (free), Claude, OpenAI, OpenRouter, or Ollama (local)
- **Private repos** — SSH key auth. Works with GitHub, GitLab, Bitbucket, Gitea.

## How It Works

```
User (Web UI — browser chat + dashboard)
    ↓
AI Agent (LLM — intent parsing + conversation + error explanation)
    ↓
Deploy Pipeline (deterministic — rule-based execution)
    ├─ git clone
    ├─ docker build (Dockerfile or auto-generated template)
    ├─ docker run (auto port + Traefik labels)
    ├─ expose (TryCloudflare / Cloudflare Tunnel)
    └─ monitor (health checks + resource tracking)
    ↓
Infrastructure (Docker + Traefik + Cloudflare + SQLite)
```

**Key principle**: Execution is deterministic (rule-based). The LLM only handles conversation, clarification, and error explanation — never makes deployment decisions.

## External Access

| Mode           | Use Case     | Implementation                | Domain Required |
| -------------- | ------------ | ----------------------------- | --------------- |
| 🔒 Internal    | Same network | Local IP + Traefik            | No              |
| 🌐 Quick Share | Demo/review  | TryCloudflare (temp URL)      | No              |
| 🌐 Production  | Always-on    | Cloudflare Tunnel (permanent) | Yes             |

Default is **Internal** (safe). Say "make it public" to switch.

## Tech Stack

| Area          | Technology                                                                      |
| ------------- | ------------------------------------------------------------------------------- |
| Language      | TypeScript (strict mode, ESM)                                                   |
| Runtime       | [Bun](https://bun.sh)                                                           |
| Build         | [tsup](https://tsup.egoist.dev) (backend) + [Vite](https://vite.dev) (frontend) |
| Install       | npm global package                                                              |
| Web UI        | React 19 + React Router + Tailwind CSS v3                                       |
| ORM           | [Drizzle ORM](https://orm.drizzle.team) + bun:sqlite                            |
| Docker        | dockerode                                                                       |
| Reverse Proxy | Traefik (Docker label routing)                                                  |
| Tunnel        | TryCloudflare / Cloudflare Tunnel                                               |
| AI            | BYOK — Gemini Flash / Claude / OpenAI / OpenRouter / Ollama                     |
| Database      | SQLite (via Drizzle ORM)                                                        |
| Test          | Vitest + Node.js (with bun:sqlite shim)                                         |

## Roadmap

| Version     | Focus                    | Status | Highlights                                                          |
| ----------- | ------------------------ | ------ | ------------------------------------------------------------------- |
| **v0.0.1**  | Repo → URL (MVP)         | Done   | Git clone → Docker → Traefik → URL. Chat. REST API.                 |
| **v0.0.2**  | Daily Operations         | Done   | Auto-redeploy, monitoring, production domains, Ollama               |
| **v0.0.3**  | Coding Agent Integration | Done   | MCP server (23 tools), rollback, blue-green, DB provisioning        |
| **v0.0.4**  | Multi-Channel + Advanced | Done   | Slack/Discord/Telegram, auto-Dockerfile, monorepo, parallel deploy  |
| **v0.0.9**  | Server Awareness         | Done   | Full container scan, OS port scan, proxy detection, preflight check |
| **v0.1.0**  | Web MVP                  | Done   | React SPA, real-time timeline, NDJSON streaming, TUI→Web pivot      |
| **v0.0.11** | Agent Proactivity        | Done   | Post-deploy insight, anomaly nudge, smart defaults                  |
| **v0.0.10** | Env & Secrets            | Done   | Global encrypted secrets, .env.example detection, Web settings UI   |
| **v0.0.12** | Provider OAuth           | Done   | OAuth login for OpenAI, Anthropic, OpenRouter (no API key needed)   |
| **v0.0.8**  | AI SDK Migration         | Done   | Vercel AI SDK, multi-provider streaming, unified tool API           |

## Requirements

- **Platform**: Linux or macOS (Windows is not supported, but WSL2 on Windows works)
- **[Bun](https://bun.sh)** >= 1.1 (installed automatically or via `curl -fsSL https://bun.sh/install | bash`)
- **Docker** installed and running (see below)
- **LLM API key** (configured during setup) — one of:
  - [Google Gemini](https://ai.google.dev/) (free tier available)
  - [OpenRouter](https://openrouter.ai/) (free tier, no credit card)
  - [Anthropic Claude](https://console.anthropic.com/)
  - [OpenAI](https://platform.openai.com/)
  - [Ollama](https://ollama.com/) (fully local, no API key needed)

### Installing Docker

OpenLander needs Docker to build and run containers. The `openlander onboard` command will detect Docker and guide you through installation.

**Option 1: Auto-install (Linux / WSL2)**

The `openlander onboard` command will offer to install Docker automatically if it's not found.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

- Bug reports and feature requests → [Issues](https://github.com/openlander-ai/OpenLander/issues)
- Security vulnerabilities → [Security Policy](SECURITY.md)

## License

[MIT](LICENSE) © OpenLander Contributors
