# Installation

## Requirements

| Requirement       | Version  | Notes                                                                       |
| ----------------- | -------- | --------------------------------------------------------------------------- |
| **Node.js**       | >= 22    | Includes npm                                                                |
| **Docker Engine** | >= 20.10 | With Compose V2 >= 2.3.0                                                    |
| **Git**           | >= 2.x   | For cloning repositories                                                    |
| **LLM API Key**   | —        | One of: Gemini (free), OpenRouter (free), Anthropic, OpenAI, Ollama (local) |

**Platforms**: Linux (primary), macOS. Windows not supported (WSL2 works).

---

## Install

```bash
npm install -g openlander
```

## Run

```bash
openlander
```

This will:

1. Check Docker (install if missing on Linux, fix permissions if needed)
2. Start the Traefik reverse proxy
3. Open the Web UI at `http://localhost:10114`
4. Walk through the setup wizard

### Options

| Flag                | Description                      | Default       |
| ------------------- | -------------------------------- | ------------- |
| `-p, --port <port>` | Port to listen on                | `10114`       |
| `--host <host>`     | Host to bind to                  | `0.0.0.0`     |
| `--no-open`         | Don't open browser automatically | Opens browser |

---

## Setup Wizard

The first time you open the Web UI, a setup wizard guides you through:

### Step 1: Language

Choose English or Korean. Applies to all UI and AI responses.

### Step 2: Admin Password

Set a password for web dashboard authentication. Required for all protected pages.

### Step 3: LLM Provider

Configure AI for error analysis and auto-recovery:

| Provider             | Free Tier         | Setup                                                                     |
| -------------------- | ----------------- | ------------------------------------------------------------------------- |
| **Google Gemini**    | Yes (Flash model) | API key from [ai.google.dev](https://ai.google.dev/)                      |
| **OpenRouter**       | Yes (some models) | OAuth or API key from [openrouter.ai](https://openrouter.ai/)             |
| **Anthropic Claude** | No                | API key from [console.anthropic.com](https://console.anthropic.com/)      |
| **OpenAI**           | No                | OAuth or API key from [platform.openai.com](https://platform.openai.com/) |
| **Ollama**           | Free (local)      | Install [Ollama](https://ollama.com/), no API key needed                  |

### Step 4: Traefik

Starts the reverse proxy for routing. Automatic in managed mode.

### Step 5: GitHub (Optional)

Connect GitHub with a Personal Access Token for private repo access.

### Step 6: MCP (Optional)

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

> **1.0 change**: OpenLander runs in the foreground only. Use systemd / pm2 / docker for background lifecycle (see the [Running as a Service](../../README.md#running-as-a-service) section in README).

---

## Configuration

Config file: `~/.openlander/config.json`

### Key Settings

| Section                             | Key     | Default            | Description                |
| ----------------------------------- | ------- | ------------------ | -------------------------- |
| `server.port`                       | number  | `10114`            | Web UI port                |
| `server.host`                       | string  | `0.0.0.0`          | Bind address               |
| `llm.provider`                      | string  | `gemini`           | AI provider                |
| `llm.model`                         | string  | `gemini-2.0-flash` | AI model                   |
| `docker.networkName`                | string  | `openlander`       | Docker network             |
| `docker.portRangeStart`             | number  | `10001`            | Container port range start |
| `docker.portRangeEnd`               | number  | `10999`            | Container port range end   |
| `traefik.mode`                      | string  | `managed`          | `managed` or `external`    |
| `monitoring.healthcheckIntervalSec` | number  | `60`               | Health check interval      |
| `ai.autoRecovery.enabled`           | boolean | `true`             | AI auto-recovery           |
| `mcp.enabled`                       | boolean | `false`            | MCP server                 |

### AI Features (all toggleable)

| Feature                    | Default | Description                 |
| -------------------------- | ------- | --------------------------- |
| `ai.autoRecovery`          | on      | Auto-fix crashed containers |
| `ai.buildDebugger`         | on      | AI build error analysis     |
| `ai.webAgent`              | on      | Web chat agent              |
| `ai.envDetection`          | on      | Auto-detect env vars        |
| `ai.secretScan`            | on      | Scan for leaked secrets     |
| `ai.rollbackSuggestion`    | on      | Suggest rollback on failure |
| `ai.operationalMonitoring` | on      | Operational insights        |

---

## Updating

```bash
npm update -g openlander
```

## Uninstalling

```bash
npm uninstall -g openlander
# Optional: remove data
rm -rf ~/.openlander
```
