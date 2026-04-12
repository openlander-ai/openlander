# Web Dashboard

The OpenLander web dashboard provides a visual interface for managing deployments, monitoring projects, and configuring the platform.

**Access**: `http://your-server:10114` (default port)

---

## Pages

### Login (`/login`)

Password authentication. Set during the setup wizard.

### Setup Wizard (`/setup`)

First-time onboarding with 6 steps:

1. **Language** — English or Korean
2. **Docker + Traefik** — Auto-setup infrastructure
3. **GitHub** — Connect via Personal Access Token
4. **LLM Provider** — Gemini, OpenRouter, Anthropic, OpenAI, or Ollama
5. **Password** — Create admin password
6. **MCP** — Guide for connecting AI coding agents

---

### Projects Dashboard (`/projects`)

The main page after login.

**Features**:

- System health cards (Docker, Traefik, storage status)
- Project count summary
- Grid or table view toggle
- Each project card shows: status, URL, last deployment
- Quick redeploy action per project
- New Project button

---

### New Project (`/projects/new`)

Deploy a new project from three sources:

| Tab              | Description                                        |
| ---------------- | -------------------------------------------------- |
| **My Repos**     | Fetch from connected GitHub account (paginated)    |
| **Search**       | Search public/private repos by keyword             |
| **Docker Image** | Deploy pre-built images (image URL, port, command) |

**Flow**:

1. Select source → Choose repo/image
2. Select branch
3. Review auto-detected environment variables (from `.env.example`)
4. Click Deploy

---

### Project Detail (`/projects/:id`)

Detailed view for a single project with action buttons and tabs.

**Actions** (header):

- Redeploy
- Stop / Start
- Rollback
- Blue-Green Deploy
- Share (public URL)
- Delete

**Tabs**:

| Tab             | Features                                                           |
| --------------- | ------------------------------------------------------------------ |
| **Overview**    | Summary, quick actions, status                                     |
| **Deployments** | History list with filters, status badges, commit SHA, duration     |
| **Env Vars**    | Add, edit, delete environment variables                            |
| **Domains**     | Map custom domains                                                 |
| **Logs**        | Container log viewer with ANSI color rendering                     |
| **Terminal**    | xterm.js web terminal — exec into running container                |
| **Settings**    | Build configuration (Dockerfile path, health check, build context) |

---

### Deployment Detail (`/projects/:id/deployments/:deployId`)

Detailed view for a specific deployment.

**Features**:

- Status, trigger, timestamp, duration metadata
- Build log viewer (real-time streaming with ANSI colors)
- Runtime log viewer (last 500 lines)
- **AI Analysis** section — appears on failed deployments with error diagnosis
- Diagnose button — triggers AI error analysis on demand

---

### Services (`/services`)

Manage infrastructure services (databases, caches, etc.).

**Features**:

- Create new service from templates:
  - PostgreSQL, MySQL, Redis, MongoDB, RabbitMQ, MinIO
- Service cards: name, type, status, port, health, uptime, restarts
- Click to view service detail

---

### Service Detail (`/services/:id`)

**Actions**: Start, Stop, Delete

**Tabs**:

| Tab            | Features                                                |
| -------------- | ------------------------------------------------------- |
| **Overview**   | Service details, resource usage                         |
| **Connection** | Host, port, credentials with copy buttons               |
| **Databases**  | List/create/drop databases (PostgreSQL, MySQL, MongoDB) |
| **Logs**       | Container logs                                          |
| **Settings**   | Service configuration                                   |

---

### Settings (`/settings`)

Platform configuration organized in tabs:

| Tab            | What You Can Configure                  |
| -------------- | --------------------------------------- |
| **System**     | Server info, cleanup, restart           |
| **Security**   | Password, session settings              |
| **Proxy**      | Traefik configuration, HTTP routes      |
| **GitHub**     | OAuth status, connect/disconnect        |
| **LLM**        | Provider, API key, model selection      |
| **AI Agent**   | Auto-recovery toggle, behavior settings |
| **Operations** | Debug tools, log viewer, platform tools |
| **MCP**        | Server status, port, protocol info      |

---

## Navigation

### Sidebar

- **Mode toggle**: Dashboard vs Agent (top)
- **Search**: Project search (⌘K)
- **Project list**: Grouped by repo or compose
- **Bottom links**: New Project, Services, Settings

### Agent Mode

Toggle in sidebar opens a right-panel AI chat:

- Chat with AI agent in natural language
- Agent uses MCP tools to execute actions
- Session persistence across conversations

---

## UI Features

- **Real-time streaming** — Build logs stream as they happen
- **ANSI colors** — Docker output renders with proper colors
- **Dark mode** — Default theme
- **i18n** — Korean and English (switchable in settings)
- **Responsive** — Works on desktop and tablet
