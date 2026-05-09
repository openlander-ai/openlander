# Installation

## Requirements

| Requirement       | Version  | Notes                                                                     |
| ----------------- | -------- | ------------------------------------------------------------------------- |
| **Node.js**       | >= 22    | Required for direct CLI development; Docker Compose runtime includes Node |
| **Docker Engine** | >= 20.10 | With Compose V2 >= 2.3.0                                                  |
| **Git**           | >= 2.x   | Required for direct/custom runtime; Docker Compose runtime includes git   |

**Platforms**: Linux (primary), macOS. Windows not supported (WSL2 works).

---

## Install And Run

```bash
# Start OpenLander plus its Postgres database
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose up -d --build
```

This starts:

- `openlander` — the web UI, API, MCP server, deploy pipeline, and passive monitors
- `openlander-db` — Postgres 16 for OpenLander runtime state
- `openlander-data` and `openlander-postgres` Docker volumes for persisted data

This will:

1. Start Postgres and OpenLander containers
2. Mount the Docker socket so OpenLander can build and run project containers
3. Serve the Web UI at `http://localhost:10114`
4. Preserve runtime state in `openlander-data` and `openlander-postgres`
5. Let you walk through the setup wizard on first open

### Released Runtime Image

The runtime Compose file pulls the published OpenLander image from GHCR and runs
it with Postgres:

```bash
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose -f docker-compose.runtime.yml up -d
```

`docker-compose.runtime.yml` defaults to
`ghcr.io/openlander-ai/openlander:latest`. Pin a release by setting
`OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0`.

### Low-Memory Local Runtime Image

If the host kills `docker compose up --build` while the image is compiling
TypeScript or the web UI, build the app artifacts on the host first and override
the runtime image:

```bash
npm install
npm run docker:build:runtime
OPENLANDER_IMAGE=openlander:local OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose -f docker-compose.runtime.yml up -d
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

Connect GitHub with a Personal Access Token for private repo access.

### Step 5: MCP (Optional)

Configure MCP server for AI coding agent integration.

---

## Docker Installation

### Linux / WSL2

The setup wizard can auto-install Docker. Or install manually:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in, then:
sudo systemctl start docker
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

> **Single-process only**: OpenLander 0.1 must run as a single process. Do **not** enable PM2 cluster mode (`exec_mode: 'cluster'` / `instances > 1`) or run multiple `openlander` workers behind a load balancer. The first-boot setup secret, the OAuth PKCE verifier map, and session-local state are in-process state — workers would each generate a different setup secret and fail to share OAuth/session state. Multi-process support is tracked for a future minor release.

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
OPENLANDER_POSTGRES_PASSWORD='change-me' docker compose -f docker-compose.runtime.yml up -d
```

## Uninstalling

```bash
docker compose -f docker-compose.runtime.yml down

# Optional: remove persisted runtime state and Postgres data
docker volume rm openlander-data openlander-postgres
```
