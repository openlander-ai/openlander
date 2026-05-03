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

### Overview Dashboard (`/overview`, also the `/` redirect)

The main page after login.

**Features**:

- 6 KPI cards: Active Deploys, Recoveries, Approvals, Alerts, Unhealthy Services, AI Spend
- **Live Activity** feed — recent recovery / deploy / alert events
- **Needs Attention** panel — highlights error-state projects, pending approvals, unhealthy services

### Projects (`/projects`)

Grid-view list of all projects.

**Features**:

- Project count header ("N projects monitored")
- Responsive grid (1→2→3→4 columns)
- Each project card shows: name, status dot + pill, last deployment time, default branch, primary URL
- Hover actions: Redeploy, open Settings
- Grid / table view toggle (top right)
- Show archived toggle, New Project button

---

### New Project

Create a project group first, then add deployable services inside it.

In the 1.0 data model:

| Noun        | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| **Project** | Workspace/group: shared env vars, webhooks, settings, service list |
| **Service** | Deployable unit: Git repo app, worker, Docker image, compose stack |

**Flow**:

1. Click **New Project**
2. Enter a project name
3. Open the project
4. Click **Add service**
5. Ask your agent to deploy a repo/image/compose stack into that project
6. Open the service detail to watch deployments, logs, domains, and runtime config

The legacy one-call deploy path remains available through MCP/API for convenience, but the UI uses
the group-first model so projects are not tied to a single repository.

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

**Tabs** (5 — access via URL tab state like `?tab=recovery`):

| Tab             | Features                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**    | Latest deployment summary, quick actions, service health, live timeline excerpt                                                        |
| **Deployments** | History list with filters (all / success / failed / building), commit SHA, duration, trigger                                           |
| **Recovery**    | Incident history for this project, circuit-breaker state, Alert Reports generated here                                                 |
| **Runtime**     | Container logs + web terminal (xterm.js), ANSI colors, runtime state                                                                   |
| **Settings**    | Build configuration (Dockerfile path, build context), Env Vars, Domains, Webhook, Resource Limits, Danger Actions (stop/archive/purge) |

> **Note**: domains, env vars, and webhook config live **inside the Settings tab** (sub-panels) — they are not separate top-level tabs.

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

### Managed Services (`/managed-services`)

> **1.0 routing change**: list URL is now `/managed-services`. The old
> `/services` redirects here for bookmark continuity. Detail page is
> at `/managed-services/:id`. See the "Data model alignment" section
> in `RELEASE-NOTES-1.0.md` for the why.

Manage infrastructure services (databases, caches, etc.).

**Features**:

- Create new service from templates:
  - PostgreSQL, MySQL, Redis, MongoDB, RabbitMQ, MinIO
- Service cards: name, type, status, port, health, uptime, restarts
- Click to view service detail

---

### Service Detail

> **1.0 routing**: managed-service detail at `/managed-services/:id`;
> deployable detail at `/services/:id?project=:p`. The detail URL
> graduates to `/projects/:p/services/:s` in 1.2 alongside the schema
> split. See `RELEASE-NOTES-1.0.md` "Data model alignment".

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

### Operations Center (`/operations`)

Operations-wide view of alerts, approvals, and recovery actions across all projects. Deep-linkable via `?tab=` (e.g., `/operations?tab=approvals`).

**Persistent chrome** (always visible, regardless of active tab):

- **PageHeader**: "Operations Center" + keyboard-shortcuts help (`?`)
- **StatusStrip**: System Health pill, active alerts count, pending approvals count, Live/reconnecting indicator
- **Circuit Breaker banner** (appears when any project breaker is open/half-open): lists affected projects with per-project Reset button

**Vertical sub-sidebar (5 tabs)**:

| Tab               | Features                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Live**          | Real-time activity feed with filters (severity / project / time range); j/k keyboard nav, `/` to focus search, click any activity to open Incident Slideover |
| **Approvals**     | Pending AI recovery actions awaiting user confirmation (AutomationPolicy `confirm` mode)                                                                     |
| **Alert Reports** | LLM-generated retrospectives after successful auto-recovery (stored until server restart)                                                                    |
| **Patterns**      | Recurring failure patterns detected across projects (trend analysis)                                                                                         |
| **Usage**         | LLM cost / token / call totals, per-model breakdown, recent activity log                                                                                     |

---

### Settings (`/settings`)

Platform configuration organized in 7 tabs. Deep-linkable via `?tab=` (e.g., `/settings?tab=ai`).

| Tab            | What You Can Configure                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **System**     | Global Secrets, System Resources (CPU/memory/disk), language, server restart                                                             |
| **Security**   | Password change, session settings                                                                                                        |
| **Proxy**      | Traefik configuration, HTTP routes                                                                                                       |
| **GitHub**     | Personal Access Token / OAuth status, connect/disconnect                                                                                 |
| **AI**         | LLM provider + API key + model (Gemini / OpenRouter / Anthropic / OpenAI / Ollama), auto-recovery toggle, behavior settings, usage stats |
| **Operations** | OpsConfig (auto-cleanup, drift detection, thresholds), notification channels (SMTP email), automation defaults                           |
| **MCP**        | MCP server status, port, protocol info, connection guide                                                                                 |

---

## Navigation

### Sidebar

- **Mode toggle** (top): Dashboard ↔ Agent (right-panel AI chat)
- **Search** (⌘K): open command palette to jump to projects / pages
- **Primary links**: New Project, Overview, Projects, Deployments, Services, Operations, Settings
- **Collapsible**: toggle visibility to free screen real estate

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
