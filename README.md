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

|              | Coolify / Dokploy            | OpenLander                        |
| ------------ | ---------------------------- | --------------------------------- |
| Analogy      | Self-service gas station     | Full-service gas station          |
| Interface    | Dashboard (forms & buttons)  | Chat (natural language)           |
| Target       | Devs with infra knowledge    | Anyone who can build an app w/ AI |
| Install      | `docker compose`             | `npm i -g`                        |
| Config       | You figure it out            | Agent figures it out              |

OpenLander isn't a competitor — it's a different category.

## Cost

```
Cloud (5 services):      ~$100/month, forever
Mac Mini + OpenLander:   ~$600 once, $0/month
→ Pays for itself in 6 months
```

## Quick Start

> **Platform**: Linux (primary) and macOS. Windows is not supported.

```bash
npm install -g openlander

openlander start
# → Opens http://localhost:3000
# → Web UI guides you through setup (Docker check, LLM key, Traefik)
# → Start deploying from the chat
```

Or use the CLI wizard:

```bash
openlander onboard   # Interactive terminal setup
openlander start     # Then open the web UI
```

## Features (v0.1)

- **Chat-driven deployment** — Describe what you want in plain English
- **Git → Docker → URL** — Clone, build, run, expose. One conversation.
- **Traefik auto-routing** — Each project gets its own subdomain. No port conflicts.
- **Public sharing** — Instant public URL via TryCloudflare. No domain needed.
- **Environment variables** — Manage secrets through chat or web UI
- **Logs & monitoring** — Check container logs and system resources
- **BYOK (Bring Your Own Key)** — Works with Gemini Flash (free), Claude, OpenAI, or any OpenRouter model
- **Private repos** — SSH key auth. Works with GitHub, GitLab, Bitbucket, Gitea.

## How It Works

```
User (Web Chat UI)
    ↓
AI Agent (LLM — intent parsing + conversation + error explanation)
    ↓
Deploy Pipeline (deterministic — rule-based, sequential execution)
    ├─ git clone
    ├─ docker build (uses existing Dockerfile)
    ├─ docker run (auto port + Traefik labels)
    └─ expose (TryCloudflare / Cloudflare Tunnel)
    ↓
Infrastructure (Docker + Traefik + Cloudflare)
```

**Key principle**: Execution is deterministic (rule-based). The LLM only handles conversation, clarification, and error explanation — never makes deployment decisions.

## External Access

| Mode           | Use Case    | Implementation              | Domain Required |
| -------------- | ----------- | --------------------------- | --------------- |
| 🔒 Internal    | Same network | Local IP + Traefik          | No              |
| 🌐 Quick Share | Demo/review  | TryCloudflare (temp URL)    | No              |
| 🌐 Production  | Always-on    | Cloudflare Tunnel (permanent) | Yes           |

Default is **Internal** (safe). Say "make it public" to switch.

## Tech Stack

| Area           | Technology                         |
| -------------- | ---------------------------------- |
| Language       | TypeScript (strict mode, ESM)      |
| Runtime        | Node.js ≥ 22                       |
| Install        | npm global package                 |
| Web UI         | Chat-based (Hono)                  |
| Docker         | dockerode                          |
| Reverse Proxy  | Traefik (Docker label routing)     |
| Tunnel         | TryCloudflare / Cloudflare Tunnel  |
| AI             | BYOK — Gemini Flash / Claude / OpenAI / OpenRouter |
| Database       | SQLite                             |

## Roadmap

| Version | Focus                    | Highlights                                              |
| ------- | ------------------------ | ------------------------------------------------------- |
| **v0.1** | **Repo → URL (MVP)**   | Git clone → Docker → Traefik → URL. Chat UI. REST API.  |
| v0.2    | Daily Operations         | Auto-redeploy, monitoring, production domains, Ollama   |
| v0.3    | Coding Agent Integration | MCP server (Claude Code / Cursor), rollback, blue-green |
| v0.4    | Multi-Channel            | Slack/Discord/Telegram bots, auto-Dockerfile generation |
| v0.5    | Full Self-Hosting        | Fine-tuned model (`openlander-agent-8b`), zero API cost |

## Requirements

- **Platform**: Linux or macOS (Windows is not supported, but WSL2 on Windows works)
- **Node.js** >= 22
- **Docker** installed and running (see below)
- **LLM API key** (configured during web setup or CLI onboard) — one of:
  - [Google Gemini](https://ai.google.dev/) (free tier available)
  - [OpenRouter](https://openrouter.ai/) (free tier, no credit card)
  - [Anthropic Claude](https://console.anthropic.com/)
  - [OpenAI](https://platform.openai.com/)

### Installing Docker

OpenLander needs Docker to build and run containers. The **web setup wizard** and **`openlander onboard`** will detect Docker and guide you through installation.

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

OpenLander is in early development. Contributions welcome!

- 🐛 Bug reports and feature requests → [Issues](https://github.com/openlander/openlander/issues)
- 📖 Documentation improvements → always welcome
- 🔧 Code contributions → please open an issue first to discuss

## License

[MIT](LICENSE) © OpenLander Contributors
