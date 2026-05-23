# Web Dashboard

The OpenLander web dashboard provides a visual interface for managing deployments, monitoring projects, and configuring the platform.

**Access**: `http://your-server:10114` (default port)

---

## Pages

### Login (`/login`)

Password authentication. Set during the setup wizard.

### Setup Wizard (`/setup`)

First-time onboarding with 5 steps:

1. **Language** — English or Korean
2. **Password** — Create admin password
3. **Infrastructure** — Docker + Traefik readiness
4. **GitHub** — Connect via Personal Access Token
5. **MCP** — Guide for connecting external coding agents

---

### Overview Dashboard (`/overview`, also the `/` redirect)

The main page after login.

**Features**:

- KPI cards for deploys, services, alerts, and host health
- **Live Activity** feed — recent deploy / config / alert events
- **Needs Attention** panel — highlights error-state projects and unhealthy services

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

In the 0.1 data model:

| Noun        | Meaning                                                            |
| ----------- | ------------------------------------------------------------------ |
| **Project** | Workspace/group: shared env vars, settings, service list           |
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

Detailed view for a project group and its services.

**Actions** (header):

- Share (public URL)
- Delete

**Tabs** (5 — access via URL tab state like `?tab=recovery`):

| Tab             | Features                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Overview**    | Latest deployment summary, quick actions, service health, live timeline excerpt              |
| **Deployments** | History list with filters (all / success / failed / building), commit SHA, duration, trigger |
| **Recovery**    | Historical incident/status information when available                                        |
| **Runtime**     | Service logs + web terminal (xterm.js), ANSI colors, runtime state                           |
| **Settings**    | Project metadata and danger actions. Deployable config lives on service detail pages.        |

> **Note**: OpenLander's model is service-first for deployable configuration. Activity,
> deployments, domains, env vars, and resource limits belong to service detail pages rather
> than Project Settings.

---

### Deployment Detail (`/projects/:id/deployments/:deployId`)

Detailed view for a specific deployment.

**Features**:

- Status, trigger, timestamp, duration metadata
- Build log viewer (real-time streaming with ANSI colors)
- Runtime log viewer (last 500 lines)
- Build log and runtime log sections for external agent/manual diagnosis

---

### Infrastructure Services

Infrastructure services are shown inside each project, alongside deployable
services. Open a project and use the Services tab to inspect project-scoped
databases, caches, and storage containers wired to that project.

There is no global `/managed-services` web page in v0.1. Infrastructure service
creation stays on the MCP/agent path; the web UI is for visibility and
operations on services already connected to a project.

---

### Service Detail

> **0.1 routing**: deployable service detail is `/projects/:p/services/:s`.
> Infrastructure service detail is `/projects/:p/infrastructure/:s`.

**Actions**: Deploy (header button), Delete (typed-confirm flow inside Overview).

**Tabs (observability-first per the v0.1 spec)**:

| Tab             | Features                                                                      |
| --------------- | ----------------------------------------------------------------------------- |
| **Overview**    | General details, resource limits, health, danger zone (typed-confirm delete). |
| **Logs**        | Live runtime container logs.                                                  |
| **Deployments** | Per-service deployment history with deploy-in-place log streaming.            |
| **Monitoring**  | CPU / memory time-series and request-side health.                             |
| **Environment** | Service env vars (read/write).                                                |
| **Domains**     | Host/path routes registered for the service. DNS/TLS remain external in v0.1. |

Deployable services use the full service detail surface. Infrastructure services
use a narrower project-scoped detail surface with Overview, Logs, and
Connections. Lifecycle and danger actions live in Overview to match deployable
service detail. Project detail shows connected project-scoped infrastructure
services in the Services tab; cross-project shared resources and external TCP
endpoints are deferred.

---

### Web Server (`/settings/web-server`)

Read-only observability page for the routing layer. Shows the proxy detection result + status (Traefik / external / none / Docker unavailable), the route table mapped to services, host port allocations, and external (non-OpenLander) containers running on the host. v0.2 adds inline route editing.

### Git Providers (`/settings/git-providers`)

GitHub identity card (octocat + `@login` + tri-state status pip), action menu (Manage on GitHub / Re-authorize / Refresh / Disconnect), and a stat block (Repos linked / Last sync / Connected on / OAuth scopes). GitLab and Bitbucket rows are reserved as v0.2 placeholders.

The legacy multi-tab `/settings` host (System / Security / Proxy / GitHub / MCP) was retired for v0.1: Global Secrets are backend-only, Security folded into the AccountPopover, Proxy moved to Web Server, MCP moved to Your Agent (`/mcp-server`), and `/settings` itself is now a narrow GitHub device-flow handoff that the Git Providers Re-authorize and Connect buttons land on.

---

## Navigation

### Sidebar

- **Search** (⌘K): open command palette to jump to projects / pages, plus quick-links for Web Server + Git Providers.
- **Workspace**: Home, Your Agent, Projects, Activity, Deployments, Monitoring, Web Server.
- **Settings**: Git Providers.
- **Account footer**: admin avatar with Change Password / Sign Out popover.

## UI Features

- **Real-time streaming** — Build logs stream as they happen
- **ANSI colors** — Docker output renders with proper colors
- **Dark mode** — Default theme
- **i18n** — Korean and English (switchable in settings)
- **Responsive** — Works on desktop and tablet
