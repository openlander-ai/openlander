# OpenLander Documentation

**Self-hosted deployment platform that fixes its own failures.**

Paste a Git URL. It builds, deploys, and hands you a URL — if something breaks, AI fixes it automatically.

---

## Quick Start

```bash
# Install
npm install -g openlander

# Run
openlander
```

Open `http://localhost:10114` and follow the setup wizard.

**Requirements**: Node.js >= 22, Docker >= 20.10, Git >= 2.x

---

## How It Works

```
User (Web Dashboard — deploy, monitor, configure)
    ↓
AI Agent (background — build error analysis, crash recovery)
    ↓
Deploy Pipeline (deterministic — rule-based execution)
    ├─ preflight check (port/name/resource validation)
    ├─ git clone
    ├─ docker build (Dockerfile or auto-generated)
    ├─ docker run (auto port + Traefik labels)
    ├─ expose (TryCloudflare / Cloudflare Tunnel)
    └─ monitor (health checks + auto-recovery)
    ↓
Infrastructure (Docker + Traefik + Cloudflare + SQLite)
```

**Key principle**: Execution is deterministic (rule-based). AI handles error analysis and recovery only — never makes deployment decisions autonomously.

---

## Documentation

### Getting Started

- [[Installation]] — Install and configure OpenLander
- [[Web Dashboard]] — Navigate the web UI

### Core Features

- [[Deploy Guide]] — Deploy projects step by step
- [[Services]] — Provision databases and infrastructure
- [[Domains & Public Access]] — Custom domains and public URLs
- [[AI Auto-Recovery]] — How AI diagnoses and fixes failures

### Integration

- [[MCP Tools Reference]] — Complete tool reference for AI agents (99 tools)
- [[Integration Guide]] — Connect OpenClaw, Claude Code, Cursor, and more

---

## Architecture

| Component     | Technology                        |
| ------------- | --------------------------------- |
| Language      | TypeScript (strict ESM)           |
| Runtime       | Node.js >= 22                     |
| Web UI        | React 19 + Tailwind CSS v3        |
| AI            | Vercel AI SDK (multi-provider)    |
| Database      | SQLite (Drizzle ORM)              |
| Containers    | Docker + dockerode                |
| Reverse Proxy | Traefik (Docker label routing)    |
| Tunnel        | TryCloudflare / Cloudflare Tunnel |

## Supported Frameworks (Auto-Dockerfile)

Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Gradio, Streamlit, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust, and 9+ more.

## External Links

- [GitHub Repository](https://github.com/openlander-ai/OpenLander)
- [npm Package](https://www.npmjs.com/package/openlander)
