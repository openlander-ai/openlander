# OpenLander 0.1.0 — First Public Release

OpenLander is a self-hosted deployment platform: paste a Git URL, get a working URL back. AI auto-recovery handles build failures and runtime crashes. An MCP server lets agents like Claude Code or Cursor deploy and operate projects directly.

This is OpenLander's first public release. The codebase has been in private development through an extended pre-release cycle; cutting at 0.1.0 (rather than 1.0.0) is deliberate — early adopters should expect API and configuration changes between 0.x versions while the project incorporates real-world feedback.

## What you get

### Deploys

Paste a Git URL, OpenLander clones it, generates a Dockerfile if one isn't present (28+ frameworks supported including Next.js, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust), builds the image, and runs it behind Traefik. Multi-service projects work via `docker-compose.yml`. Monorepos are supported through Dockerfile scanning and a parent-child project model.

Build logs stream to the browser in real time with full ANSI color rendering. Blue-green redeploys provide zero-downtime updates with health checks; one-click rollback is always available. Per-project deploy locks prevent concurrent state changes.

### Web dashboard

A React 19 + Tailwind interface gives you projects, services, deployments, an audit-log activity feed, and a system metrics view. Each service has its own detail page with overview / connection / databases / logs / settings / advanced tabs. An xterm.js web terminal lets you `docker exec` into running containers from the browser.

The dashboard is bilingual (English / Korean) — the language is chosen during onboarding and persists.

### AI auto-recovery

When a build fails or a container crashes, OpenLander's `RecoveryCoordinator` evaluates seven eligibility conditions before attempting any fix. Known patterns are handled by a recipe fast-path; novel failures fall through to an LLM. High-risk actions (rollback, project removal, service deletion, database creation) require explicit user approval through an in-context dialog — they never execute silently.

You bring your own LLM keys. Supported providers: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, xAI (Grok), DeepSeek, Mistral, Groq, Together AI, Z.ai, and local Ollama. Each AI feature (build debugging, web agent, recovery, etc.) can route to a different model. Token usage and cost are tracked per call.

### MCP integration

Agents speak to OpenLander through 4 composite MCP tools (`openlander_deploy`, `openlander_project`, `openlander_service`, `openlander_monitor`), each accepting an `action` parameter that selects from 99 underlying operations. An additional 11 platform debug tools sit behind a config flag.

Three transports are supported: stdio (for local agent processes), Streamable HTTP at `POST /mcp` (current MCP standard), and SSE at `GET /mcp/sse` for older clients. Bearer-token authentication protects remote transports.

Setup snippets for OpenCode, Claude Desktop, Claude Code, Cursor, Windsurf, and Cline are in the README.

### Infrastructure

Traefik handles reverse-proxy routing automatically — each project gets its own subdomain. For public exposure: TryCloudflare for quick share (no domain needed), Cloudflare Tunnel for production (your own domain). Internal access stays on the LAN by default.

Managed services for PostgreSQL, MySQL, Redis, MongoDB, and MinIO are provisioned on demand. SSH key auth enables private repos on GitHub, GitLab, Bitbucket, and Gitea. Environment variables are encrypted at rest, with both project-scoped and global secrets.

### Authentication & security

Password login with session cookies. Bearer tokens for remote MCP. SSRF hardening on git clone and outbound URL test surfaces. Strict CSP and security headers on every response. The Pino logger redacts credential field names (`*.password`, `*.token`, `*.api_key`, etc.) at the stream layer so logs are safe to ship.

## What's not in 0.1.0

These are deliberate cuts, not bugs:

- **Multi-tenant / RBAC** — single-tenant only.
- **Top-level Operations Center page** — recovery runs in the background; the in-context approval dialog is the only user-facing surface for high-risk actions. The same primitives are reachable via MCP for agent-driven flows.
- **Log rotation, rate limiting, LLM token spend cap** — recommended for single-developer / small-team use; production-scale operators will want to add these externally.
- **Korean relative-time strings** — `6d ago` is English-only in the activity feed pending translation.
- **Windows native** — WSL2 works; native Windows does not.

## Upgrading

This is the first public release, so nothing to upgrade from. If you ran a private pre-release, back up `~/.openlander/openlander.db` before installing 0.1.0:

```bash
cp ~/.openlander/openlander.db ~/.openlander/openlander.db.pre-0.1.0
npm install -g openlander@latest
```

Existing projects and configuration carry forward.

## Feedback

This is the start. The first 30 days of feedback shape what 0.2.0 looks like — file issues on GitHub or contact support.

For the changelog format and version history, see `CHANGELOG.md`.
