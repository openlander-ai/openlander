# Installation

## Requirements

| Requirement       | Version   | Notes                                                    |
| ----------------- | --------- | -------------------------------------------------------- |
| **Linux server**  | root/sudo | Required for the one-command installer                   |
| **Docker Engine** | >= 24     | Installed by the installer if missing                    |
| **Compose V2**    | latest    | Installed by the installer if missing                    |
| **Node.js**       | >= 22     | Development only; the Docker runtime image includes Node |
| **Git**           | >= 2.x    | Development only; the Docker runtime image includes git  |
| **Firewall**      | inbound   | TCP `80` for apps, TCP `10114` for dashboard/MCP         |

**Platforms**: Linux (primary), macOS. Windows not supported (WSL2 works).

---

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh | sudo bash
```

Want to inspect it first? Download
[`install.sh`](https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh)
and read it before running with `sudo bash`.

This installer:

- Installs Docker if it is missing
- Installs the Docker Compose v2 plugin if it is missing
- Creates `/opt/openlander`
- Downloads `docker-compose.runtime.yml`
- Creates `/opt/openlander/.env` with a generated Postgres password
- Starts OpenLander and Postgres

`OPENLANDER_VERSION=latest` resolves the latest published GitHub Release for
the compose file. It does not pull `main` branch compose content.

`0.1.0` is the first public Postgres migration baseline. Pre-public dogfood
databases are not upgraded in place; use a fresh Postgres volume or manually
export/import data.

Open the printed dashboard URL, usually `http://<server-ip>:10114`, and create
the admin password.

On cloud providers such as AWS, also allow inbound TCP `80` and `10114` in the
instance security group. Port `80` serves deployed app routes through Traefik;
port `10114` serves the OpenLander dashboard and MCP endpoint.

If deployed app URLs should advertise a specific host, set it during install:

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_PUBLIC_HOST=apps.example.com bash
```

Despite the environment variable name, this does not have to be an internet
public IP. Use a domain such as `apps.example.com` for internet-facing installs,
or a LAN IP such as `192.168.1.50` for internal-only installs. IP values are
advertised through `sslip.io`.

### Install A Specific Version

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh \
  | sudo env OPENLANDER_VERSION=v0.1.0 bash
```

### Update

```bash
curl -fsSL https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh | sudo bash -s update
```

---

## Manual Docker Compose Install

Use this if you prefer to install Docker and Compose yourself.

```bash
mkdir openlander
cd openlander
curl -fsSLO https://raw.githubusercontent.com/openlander-ai/openlander/v0.1.0/docker-compose.runtime.yml
docker compose -f docker-compose.runtime.yml up -d
```

The runtime Compose file pulls the published OpenLander image from GHCR and runs
it with Postgres:

`docker-compose.runtime.yml` defaults to
`ghcr.io/openlander-ai/openlander:latest`, so updates do not require editing
the image URL. Pin a release by setting
`OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0` in `.env`.

Manual updates:

```bash
docker compose -f docker-compose.runtime.yml pull
docker compose -f docker-compose.runtime.yml up -d
```

---

## Development Runtime

```bash
# Build from local source and start OpenLander plus Postgres
docker compose up -d --build
```

This starts:

- `openlander` — the web UI, API, MCP server, deploy pipeline, and passive monitors
- `openlander-db` — Postgres 16 for OpenLander runtime state
- `openlander-data` and `openlander-postgres` Docker volumes for persisted data

### Low-Memory Local Runtime Image

If the host kills `docker compose up --build` while the image is compiling
TypeScript or the web UI, build the app artifacts on the host first and override
the runtime image:

```bash
npm install
npm run docker:build:runtime
OPENLANDER_IMAGE=openlander:local docker compose -f docker-compose.runtime.yml up -d
```

`npm run docker:build:runtime` disables declaration-file and sourcemap output for
the deploy image, then builds `${OPENLANDER_IMAGE:-openlander:local}` from the
existing `dist/` and `web/dist/` directories.

### Direct CLI Runtime

Running `openlander` directly is supported for development or custom process
supervisors only. You must provide a Postgres URL:

```bash
OPENLANDER_DATABASE_URL='postgres://user:password@host:5432/openlander' openlander start
```

### Options

| Flag                | Description                      | Default       |
| ------------------- | -------------------------------- | ------------- |
| `-p, --port <port>` | Port to listen on                | `10114`       |
| `--host <host>`     | Host to bind to                  | `0.0.0.0`     |
| `--no-open`         | Don't open browser automatically | Opens browser |

| Environment variable       | Description                        | Default                     |
| -------------------------- | ---------------------------------- | --------------------------- |
| `OPENLANDER_WORKSPACE_DIR` | Temporary git clone workspace root | OS temp dir                 |
| `OPENLANDER_DATABASE_URL`  | Postgres connection URL            | Required for direct runtime |

---

## Setup Wizard

The first time you open the Web UI, a setup wizard guides you through:

### Step 1: Language

Choose English or Korean. Applies to the web UI.

### Step 2: Admin Password

Set a password for web dashboard authentication. Required for all protected pages.

### Step 3: Infrastructure

Starts the reverse proxy for routing. Automatic in managed mode.

### Step 4: GitHub (Optional)

Connect GitHub with a Personal Access Token for private or internal GitHub
repository access. Repository listing and search return safe HTTPS clone URLs;
the token is used internally at clone time and is never returned in MCP tool
responses, logs, or deployment status payloads.

Container registry credentials are separate from GitHub repository credentials.
Private container registries are still on the roadmap.

### Step 5: MCP (Optional)

Configure MCP server for AI coding agent integration.

---

## Docker Installation For Manual Setup

The quick installer handles Docker and Compose on Linux. If you install them
yourself, verify Compose v2 is available:

```bash
docker compose version
```

### Linux / WSL2

Install Docker manually:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then:
sudo systemctl start docker
```

If `docker compose version` fails:

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
```

### macOS

```bash
brew install --cask docker
# Or download Docker Desktop: https://docker.com/products/docker-desktop/
```

---

## CLI Commands

| Command                            | Description                                         |
| ---------------------------------- | --------------------------------------------------- |
| `openlander`                       | Start web UI in foreground (default port 10114)     |
| `openlander start`                 | Alias of `openlander` — also runs in the foreground |
| `openlander stop`                  | Prints supervisor guidance (no built-in daemon)     |
| `openlander restart`               | Prints supervisor guidance (no built-in daemon)     |
| `openlander config`                | Show current config                                 |
| `openlander config reset`          | Reset config to defaults                            |
| `openlander config reset-password` | Reset admin password                                |
| `openlander mcp`                   | Start MCP server (stdio mode)                       |

> **0.1 change**: OpenLander runs in the foreground only when started directly.
> Use Docker Compose for the default background lifecycle. systemd or PM2 are
> custom direct-CLI supervisors only (see
> [Running as a Service](../../README.md#running-as-a-service) in README).

> **Single-process only**: OpenLander 0.1 must run as a single process. Do **not** enable PM2 cluster mode (`exec_mode: 'cluster'` / `instances > 1`) or run multiple `openlander` workers behind a load balancer. The OAuth PKCE verifier map and session-local state are in-process state — workers would fail to share OAuth/session state. Multi-process support is tracked for a future minor release.

---

## Configuration

Config file: `~/.openlander/config.json`

### Key Settings

| Section                             | Key     | Default      | Description                |
| ----------------------------------- | ------- | ------------ | -------------------------- |
| `server.port`                       | number  | `10114`      | Web UI port                |
| `server.host`                       | string  | `0.0.0.0`    | Bind address               |
| `docker.networkName`                | string  | `openlander` | Docker network             |
| `docker.portRangeStart`             | number  | `10001`      | Container port range start |
| `docker.portRangeEnd`               | number  | `10999`      | Container port range end   |
| `traefik.mode`                      | string  | `managed`    | `managed` or `external`    |
| `monitoring.healthcheckIntervalSec` | number  | `60`         | Health check interval      |
| `mcp.enabled`                       | boolean | `false`      | MCP server                 |

> Built-in LLM provider setup and AI Ops are disabled in OpenLander 0.1.
> Use an external MCP-capable coding agent to inspect logs and operate deployments.

---

## Updating

```bash
docker compose -f docker-compose.runtime.yml pull
docker compose -f docker-compose.runtime.yml up -d
```

## Uninstalling

```bash
docker compose -f docker-compose.runtime.yml down

# Optional: remove persisted runtime state and Postgres data
docker volume rm openlander-data openlander-postgres
```
