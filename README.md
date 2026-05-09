# OpenLander

**Self-hosted deployment platform for AI coding agents.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

---

## Quickstart

```bash
mkdir openlander
cd openlander
curl -fsSLO https://raw.githubusercontent.com/openlander-ai/openlander/v0.1.0/docker-compose.runtime.yml
docker compose -f docker-compose.runtime.yml up -d
```

This pulls the published OpenLander runtime image plus a Postgres sidecar; no
source checkout or local build is required. Open the dashboard at
`http://localhost:10114`.

By default the compose file uses `ghcr.io/openlander-ai/openlander:latest`.
Update later with `docker compose -f docker-compose.runtime.yml pull` followed
by `docker compose -f docker-compose.runtime.yml up -d`. If you want a pinned
install, set `OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0` in a
local `.env` file.

Follow the setup flow in the browser to create the admin password. Complete
this before exposing the host to the public internet. After setup, copy the
MCP token into your coding agent's MCP config. See
[MCP Tools Reference](docs/wiki/MCP-Tools-Reference.md).

---

## Why OpenLander?

AI coding agents made building software faster, but deployment is still a
bottleneck. Cloud platforms get expensive; self-hosting is cheaper, but most
deploy tools assume a human is clicking the dashboard. Agents can hit a REST
API, but they often don't get the context they need to debug a failed build,
inspect runtime state, or recover safely.

OpenLander is a self-hosted control plane designed around MCP. It exposes
deploys, logs, services, approvals, and recovery state in a shape coding
agents can read, with risky actions held behind explicit human approval.

---

## Agents operate. You intervene.

Most deploy platforms assume a human sits in front of the dashboard, reads the
form, and clicks the button. OpenLander is built the other way around.

**Agents do the work.** Cursor, Claude Code, OpenCode, Cline, Windsurf, and
Codex drive deploys, redeploys, log inspection, and recovery through the MCP
protocol. No bespoke integration — if your coding agent speaks MCP, it can
operate OpenLander.

**You set the rules.** What agents are allowed to do. What needs human
approval. When to override the agent. The dashboard surfaces every action
the agent took, what's pending, and what's blocked — so you stay in the loop
without staying at the keyboard.

It's not a dashboard with an API bolted on. It's a control plane built for
agentic operation; the dashboard is the human surface on top.

---

## Mental model

- A **Project** is a workspace / group.
- A **Service** is the deployable unit. It owns repository or image, branch,
  Dockerfile, build config, runtime state, and deploy history.

The dashboard and MCP both expose a one-step "deploy this repo" path for the
common single-service case.

---

## Features

**Deployment**

- Git → Docker → URL pipeline. Auto-detects ports, proxies, and containers
  before deploying.
- Deploy from Git repos, public container images, or OpenLander-managed
  service templates (Postgres, MySQL, Redis, MongoDB, MinIO). Private registry support is on the
  roadmap.
- Cancel a stuck build mid-flight. The cancel goes through the same SSE log
  channel agents are watching.

**Observability**

- Live SSE log stream with phase markers (`clone`, `image_pull`, `build`,
  `container_start`, `healthcheck_wait`).
- Service health status (`running` / `stopped` / `crashed`) with last-seen
  timestamps.
- Activity timeline filterable by actor (MCP / human / system).

**Agent control**

- MCP server bundled in. Org-scoped tokens, per-project audit trail, hold
  queue for destructive actions.
- High-risk MCP actions either require dashboard approval or are blocked
  until a human uses the UI. Irreversible operations (delete project, drop
  volumes) always block; reversible-but-risky operations (env overwrite,
  force restart) wait for human approval.

**Self-hosted**

- One `docker compose up` covers the runtime. Postgres ships in the same
  compose file; no external database required.
- Traefik handles routing for deployed services. TLS depends on your domain
  / proxy setup.

---

## MCP setup

OpenLander runs an MCP server out of the box. Endpoints:

```
HTTP  http://<host>:10114/mcp
SSE   http://<host>:10114/mcp/sse
```

Per-client snippets (Cursor, Claude Desktop, Claude Code, OpenCode, Cline,
Windsurf, Codex) live in
[docs/wiki/MCP-Tools-Reference.md](docs/wiki/MCP-Tools-Reference.md).

---

## Roadmap

The shape of v0.2 is driven by what makes agentic operation more reliable.

**Current (v0.1)**

- Git-to-URL deploy pipeline.
- MCP server with deploy / inspect / operate tools.
- Dashboard for human oversight + intervention.
- Managed service templates for Postgres, MySQL, Redis, MongoDB, and MinIO.

**Next**

- **AI Ops** — agent-driven incident response inside a sandboxed policy you
  set. Today the platform records failures and surfaces them; the next step
  is letting the agent remediate.
- **Private container registries** — AWS ECR, Google Artifact Registry, and
  any OCI registry behind cloud-provider auth.
- **Service templates** — beyond Postgres / Redis. Object storage, message
  queues, search, vector DBs.
- **Environments** — first-class `prod` / `staging` / `dev` per project,
  with environment-scoped env vars and approvals.
- **Notifications** — Slack and Discord webhooks for deploy / health /
  approval events.

If a roadmap item matters to you, opening an issue moves it up the queue
more than waiting for it does.

---

## Requirements

- Docker and Docker Compose
- ~1 GB free RAM for OpenLander + the bundled Postgres
- A host that can expose port `10114` (or whatever you map)
- Node.js 22+ for development; runtime ships in the Docker image

OpenLander has been used on Linux servers, homelab machines, Apple Silicon,
and inside Tailscale-only networks. Published runtime images support
`linux/amd64` and `linux/arm64`.

### Installing Docker

```bash
# Linux / WSL2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
docker run --rm hello-world

# macOS
brew install --cask docker
```

---

## Development

```bash
git clone https://github.com/openlander-ai/openlander
cd openlander
npm install
cd web && npm install && cd ..
npm run build
npm test
```

Run the dev server (builds from `Dockerfile`, no GHCR pull):

```bash
docker compose up -d
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch conventions, test policy,
and PR layout.

---

## Contributing & License

Issues and PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a PR. Security
reports go through [SECURITY.md](SECURITY.md), not public issues.

[AGPL-3.0](LICENSE). Third-party notices live in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
