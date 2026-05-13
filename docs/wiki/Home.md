# OpenLander Documentation

**Self-hosted deployment platform with MCP-native agent workflows.**

Paste a Git URL. It builds, deploys, and hands you a URL. If something breaks,
OpenLander keeps the logs/status and your external MCP agent can inspect and redeploy.

---

## Quick Start

```bash
# Start OpenLander plus its Postgres database
docker compose up -d --build
```

To use the published runtime image instead of building locally:

```bash
docker compose -f docker-compose.runtime.yml up -d
```

Open `http://localhost:10114` and follow the setup wizard.

**Requirements**: Docker >= 20.10 with Compose V2 >= 2.3.0, Git >= 2.x

---

## How It Works

```
User (Web Dashboard — deploy, monitor, configure)
Deploy Pipeline (deterministic — rule-based execution)
    ├─ preflight check (port/name/resource validation)
    ├─ git clone
    ├─ docker build (Dockerfile or auto-generated)
    ├─ docker run (auto port + Traefik labels)
    ├─ expose (TryCloudflare / Cloudflare Tunnel)
    └─ monitor (health checks + logs/status)
    ↓
Infrastructure (Docker + Traefik + Cloudflare + Postgres)
```

**Key principle**: Execution is deterministic (rule-based). OpenLander 0.1 does
not run an internal LLM agent or automatic remediation. External agents use MCP
to read logs, change repo/config, and call deploy/redeploy explicitly.

---

## Documentation

### Getting Started

- [[Installation]] — Install and configure OpenLander
- [[Web Dashboard]] — Navigate the web UI

### Core Features

- [[Deploy Guide]] — Deploy projects step by step
- [[Services]] — Provision databases and infrastructure
- [[Domains & Public Access]] — Custom domains and public URLs
- [[MCP Tools Reference]] — Tools external agents use to inspect and operate OpenLander

### Integration

- [[MCP Tools Reference]] — Complete tool reference for AI agents (5 composite MCP tools, 66 unique default operations)
- [[Integration Guide]] — Connect OpenClaw, Claude Code, Cursor, and more

---

## Architecture

| Component     | Technology                        |
| ------------- | --------------------------------- |
| Language      | TypeScript (strict ESM)           |
| Runtime       | Node.js >= 22                     |
| Web UI        | React 19 + Tailwind CSS v3        |
| Agent I/O     | MCP server for external agents    |
| Database      | PostgreSQL 16 (Docker Compose)    |
| Containers    | Docker + dockerode                |
| Reverse Proxy | Traefik (Docker label routing)    |
| Tunnel        | TryCloudflare / Cloudflare Tunnel |

## Supported Frameworks (Auto-Dockerfile)

Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Gradio, Streamlit, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust, and 9+ more.

## External Links

- [GitHub Repository](https://github.com/openlander-ai/openlander)
