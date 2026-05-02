# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — TBD

First public release.

OpenLander is a self-hosted deployment platform: paste a Git URL, get a deploy. AI auto-recovery kicks in when builds fail or containers crash. MCP server for use from Claude Code, Cursor, and other agents.

This is an early release — expect breaking changes between 0.x versions. Production use is supported but configurations and APIs may evolve based on user feedback.

### Architecture

- **Platform metadata: PostgreSQL via Docker Compose.** OpenLander now ships with a managed `postgres:16-alpine` container alongside the application; the previous embedded SQLite (`better-sqlite3`) datastore has been removed. The recommended self-hosted runtime is `docker compose up`; the npm CLI path is supported for development with a user-provided `OPENLANDER_DATABASE_URL`. Aligns with industry pattern (Coolify, Dokploy).

### Highlights

**Deployment**

- Git → Docker → URL pipeline. Auto-detects ports, proxies, containers before deploying.
- Auto-Dockerfile for 28+ frameworks (Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust, etc.) when no Dockerfile is present.
- Docker Compose support — multi-service projects via `docker-compose.yml`.
- Monorepo support — scan multiple Dockerfiles, parallel builds, parent-child project model.
- Real-time build log streaming with ANSI color rendering.
- Blue-green redeploy with health check + one-click rollback.
- Per-project deploy locks prevent concurrent mutations.

**Web Dashboard**

- Project overview, deployments list, activity feed.
- Service detail with overview / connection / databases / logs / settings / advanced tabs.
- xterm.js web terminal for `docker exec` from the browser.
- AI agent chat panel with tool calling and code-block rendering.
- MCP Server status page surfacing connected agents.
- Korean / English UI (toggle during onboarding).

**AI Auto-Recovery**

- `RecoveryCoordinator` with 7-condition eligibility gate decides when to auto-recover.
- Recipe fast-path for known build errors; LLM fallback for unknown ones.
- High-risk actions (rollback, project removal, service removal, database creation) require explicit user approval through an in-context dialog.
- Multi-provider LLM support: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, xAI (Grok), DeepSeek, Mistral, Groq, Together AI, Z.ai, and local Ollama.
- Per-feature provider routing: pick a different model for build debugging vs. chat vs. recovery.
- Token usage and cost tracking per call.

**MCP Integration**

- 99 internal tools exposed through 4 composite MCP tools (`openlander_deploy`, `openlander_project`, `openlander_service`, `openlander_monitor`) with an `action` parameter for sub-operations.
- 11 platform debugging tools available behind a config flag.
- Three transports: stdio (local), Streamable HTTP (`POST /mcp`), and SSE (`GET /mcp/sse`) for clients on the older standard.
- Bearer token auth on remote transports.

**Infrastructure**

- Postgres-backed OpenLander runtime with Docker Compose deployment and a
  dedicated persistent database volume.
- Traefik reverse proxy with auto-routing per project.
- Cloudflare Tunnel (production) and TryCloudflare (quick share) for public exposure.
- Managed services: PostgreSQL, MySQL, Redis, MongoDB, MinIO containers on demand.
- SSH key auth for private Git repos (GitHub, GitLab, Bitbucket, Gitea).
- Environment variables: project-scoped and global encrypted secrets.

**Authentication & Security**

- Password login with session cookies.
- Bearer token auth for remote MCP.
- SSRF hardening on git clone and outbound URL test surfaces.
- CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options on every response.
- Pino logger redacts credential field names (`*.password`, `*.token`, `*.api_key`, etc.) at the stream layer.

### Known limitations

- Single-tenant only. Multi-user and role-based access control are not in scope.
- No top-level Operations Center page — auto-recovery runs in the background and surfaces via the in-context approval dialog. The same recovery primitives are accessible through MCP for agent-driven flows.
- Korean localization for relative-time strings (`6d ago`) is incomplete; affects the activity feed.
- No log rotation, rate limiting, or LLM token spend cap. Recommended for single-developer / small-team use.
- Windows is not supported. WSL2 on Windows works.

### What's next

User feedback in the first 30 days drives 0.2.x priorities. Likely candidates: tighter MCP observability (per-tool counters), runtime metrics snapshot table, Operations Center revival if there is demand, log rotation, rate limits.

---

Earlier internal pre-release history (rc.1 through rc.8 development cycle, 2026-03 through 2026-04) is preserved in the git commit log but not enumerated here. This is OpenLander's first public release.
