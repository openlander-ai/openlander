<div align="center">

# 🛬 OpenLander

**Self-hosted deployment platform that fixes its own failures.**

Paste a Git URL. It builds, deploys, and hands you a URL — if something breaks, AI fixes it automatically.

[![npm version](https://img.shields.io/npm/v/openlander.svg)](https://www.npmjs.com/package/openlander)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚧 **Early Stage** — Under active development. Expect breaking changes.

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

- **Auto-Dockerfile** — No Dockerfile? Auto-generates one for Next.js, FastAPI, Gradio, Streamlit
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

| Version    | Focus                | Status | Highlights                                                                                      |
| ---------- | -------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| **v0.1.0** | MVP                  | Done   | Chat-driven deployment, Docker + Traefik, MCP server (23 tools)                                 |
| **v0.2.0** | Web Dashboard        | Done   | React SPA, Vercel-inspired UI, real-time timeline, NDJSON streaming                             |
| **v0.2.1** | i18n + Bugfixes      | Done   | Korean/English i18n, build error reporting, OAuth callback fix                                  |
| **v0.2.2** | Deploy Controls      | Done   | Blue-green deploy UI, webhook settings, rollback button                                         |
| **v0.2.3** | Domains & Visibility | Done   | Domain CRUD UI, server scan dashboard, public URL management                                    |
| **v0.2.4** | Services             | Done   | Shared infrastructure (PostgreSQL, Redis, etc.), custom Docker images                           |
| **v0.2.5** | Release Preparation  | Done   | Code review fixes, Cloudflare config UI, i18n simplification                                    |
| **v1.0.0** | First Stable Release | Next   | AI co-pilot (7 features), inline AI analysis, secret scanning, postmortem generation, 753 tests |

## Requirements

- **Platform**: Linux or macOS (Windows is not supported, but WSL2 on Windows works)
- **[Node.js](https://nodejs.org/)** >= 22 (includes npm)
- **Docker** installed and running (see below)
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
