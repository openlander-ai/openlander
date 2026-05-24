# OpenLander

**Self-hosted deployment control plane for coding agents.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

---

## Quickstart

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh | sudo bash
```

Want to inspect it first? Download
[`install.sh`](https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh)
and read it before running with `sudo bash`.

The installer sets up Docker/Compose if needed, starts the published
`ghcr.io/openlander-ai/openlander:latest` image with Postgres, and prints the
dashboard URL. Open it, create the admin password, then copy the MCP token into
your coding agent.

If your server has a public domain or a preferred LAN IP, set it before
installing so OpenLander advertises reachable app URLs:

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_PUBLIC_HOST=apps.example.com bash
```

The public `0.1.x` releases use a fresh Postgres baseline. If you ran a
pre-public dogfood build, start from a new Postgres volume or export/import data
manually before upgrading.

Update later with:

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh | sudo bash -s update
```

Prefer manual setup? Download
[`docker-compose.runtime.yml`](docker-compose.runtime.yml) and run
`docker compose -f docker-compose.runtime.yml up -d`.

For agent setup details, see [MCP Tools Reference](docs/wiki/MCP-Tools-Reference.md).

---

## Why OpenLander?

AI coding agents made building software faster, but deployment is still a
bottleneck. Cloud platforms get expensive; self-hosting is cheaper, but most
deploy tools assume a human is clicking the dashboard. Agents can hit a REST
API, but they often don't get the context they need to debug a failed build,
inspect runtime state, or recover safely.

OpenLander is a self-hosted control plane designed around MCP. It exposes
deploys, logs, services, approvals, and runtime state in a shape coding
agents can read, with risky actions held behind explicit human approval.

OpenLander 0.1 does not run an internal self-healing agent. It gives external
MCP-capable coding agents structured tools and context to deploy, inspect,
diagnose, and recover services explicitly. It assumes a trusted self-hosted
environment, not a multi-tenant sandbox for arbitrary untrusted code.

<p align="center">
  <img src="docs/assets/your-agent-setup.png" alt="OpenLander MCP agent setup — connect Claude, Cursor, Windsurf, and more" width="920" />
  <br />
  <sub>Connect your AI client once, then let it deploy, inspect logs, and diagnose services through MCP.</sub>
</p>

---

## Agents operate. You intervene.

Most deploy platforms assume a human sits in front of the dashboard, reads the
form, and clicks the button. OpenLander is built the other way around.

**Agents do the work.** Cursor, Claude Code, OpenCode, Cline, Windsurf, and
Codex drive deploys, redeploys, log inspection, and recovery through the MCP
protocol. No bespoke integration — if your coding agent speaks MCP, it can
operate OpenLander.

**Guardrails are built in.** Agents get org- and project-scoped tokens.
Destructive MCP actions are either blocked outright or held for human
approval. The dashboard surfaces what the agent did, what's pending, and
what's blocked — so you stay in the loop without staying at the keyboard.

OpenLander is a control plane built for agentic operation; the dashboard
is the human surface on top.

---

## Mental model

- A **Project** is a workspace / group.
- A **Service** is the deployable unit. It owns repository or image, branch,
  Dockerfile, build config, runtime state, and deploy history.
- A **Managed Service** is infrastructure such as Postgres, MySQL, Redis,
  MongoDB, or MinIO. In v0.1 these are project-scoped: they attach to the
  project that uses them and run on that project's Docker network. Cross-project
  shared managed services and external TCP exposure are deferred.

The dashboard and MCP both expose a one-step "deploy this repo" path for the
common single-service case.

---

## Features

**Deployment**

- Git → Docker → URL pipeline. Auto-detects ports, proxies, and containers
  before deploying.
- Deploy apps from Git repos or public container images. With explicit approval,
  provision project-scoped Postgres, MySQL, Redis, MongoDB, and MinIO services
  alongside them. Private registry support is on the roadmap.
- Cancel a stuck build mid-flight. The cancel goes through the same SSE log
  channel agents are watching.

**Observability**

- Live SSE log stream with phase markers (`clone`, `image_pull`, `build`,
  `container_start`, `healthcheck_wait`).
- Service health and runtime status with last-seen timestamps.
- Activity timeline filterable by actor (MCP / human / system).

**Agent control**

- MCP server bundled in. Org- and project-scoped tokens with cross-project
  scope checks. Per-project audit trail.
- Conservative built-in safety policy. Project and app archive/delete flows
  are human UI-only. Destructive MCP actions that remain exposed are either
  blocked at the MCP boundary or held in a human approval queue before
  execution.

**Self-hosted**

- The one-command installer sets up Docker/Compose if needed. Manual
  `docker compose` setup is still supported.
- Postgres ships in the same compose file; no external database required.
- Traefik handles routing for deployed services. TLS depends on your domain
  / proxy setup.

<p align="center">
  <img src="docs/assets/home-dashboard.png" alt="OpenLander dashboard — projects, deployments, and agent activity at a glance" width="920" />
  <br />
  <sub>The dashboard stays focused on what the agent did: project health, latest deploys, service topology, and audit activity.</sub>
</p>

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

- **Internal AI Ops** — optional incident response inside a policy you set.
  Today the platform records failures and exposes structured MCP diagnostics;
  external agents decide and call each remediation step explicitly.
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

- Linux server with root/sudo access for the one-command installer
- Docker Engine with the Docker Compose v2 plugin for manual installation
- ~1 GB free RAM for OpenLander + the bundled Postgres
- A host that can expose port `10114` (or whatever you map)
- Node.js 22+ for development; runtime ships in the Docker image

OpenLander has been used on Linux servers, homelab machines, Apple Silicon,
and inside Tailscale-only networks. Published runtime images support
`linux/amd64` and `linux/arm64`.

### Installing Docker

The quick installer does this for Linux servers. For manual setup:

```bash
# Linux / WSL2
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
docker run --rm hello-world

# macOS
brew install --cask docker
```

Verify Docker Compose v2 is present (most installers include it, but some
minimal Linux setups do not):

```bash
docker compose version
```

If the command is not found, install the Compose plugin:

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y docker-compose-plugin

# Other distros: https://docs.docker.com/compose/install/linux/
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
