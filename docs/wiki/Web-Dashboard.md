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
- **AI Ops Inbox** — latest open briefings across Projects with evidence, Open in Agent handoff,
  and after-fix verification actions

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

Create a Project first, then add Applications inside it.

In the 0.1 data model:

| Noun            | Meaning                                                 |
| --------------- | ------------------------------------------------------- |
| **Project**     | Workspace: settings and related resources               |
| **Application** | Git repo app, worker, or Docker image workload          |
| **Compose**     | Compose stack represented as one Project-level resource |
| **Database**    | PostgreSQL, MySQL, or MongoDB resource                  |
| **Cache**       | Redis resource                                          |
| **Storage**     | MinIO resource                                          |

**Flow**:

1. Click **New Project**
2. Enter a project name
3. Open the project
4. Click **Add application**
5. Ask your agent to deploy a repo/image/compose stack into that project
6. Open the Application detail to watch deployments, logs, domains, and runtime config

The legacy one-call deploy path remains available through MCP/API for convenience, but the UI uses
the group-first model so projects are not tied to a single repository.

---

### Project Detail (`/projects/:id`)

Detailed view for a Project and its resources.

**Actions** (header):

- Publish, then open/copy/stop the stable Connected Publish URL
- Add Application or resource

**Tabs** (access via URL tab state such as `?tab=ai`):

| Tab             | Features                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Overview**    | Latest deployment summary, quick actions, resource health, live timeline excerpt             |
| **Deployments** | History list with filters (all / success / failed / building), commit SHA, duration, trigger |
| **Recovery**    | Historical incident/status information when available                                        |
| **Runtime**     | Service logs + web terminal (xterm.js), ANSI colors, runtime state                           |
| **AI Ops**      | Project-level briefing feed with status filters and agent handoff actions                    |
| **Deliveries**  | Review artifacts, feedback, decisions, Gates, deployment evidence, and Receipt finalization  |
| **Settings**    | Project metadata, Receipt theme/default Gates, and danger actions                            |

The **Deliveries** tab creates a project-scoped delivery record. Its detail
page separates Overview, Artifacts, Review, Gates, Deployments, and Receipt.
External agents may submit proposed review items, but only an administrator can
confirm decisions, record customer approval evidence, acknowledge warnings,
and finalize an immutable Receipt.

Project Settings includes **AI Ops Briefing** controls. The Project **AI Ops** tab is the read
surface for recent briefings. Briefings are read-only: OpenLander can summarize deterministic
evidence and show a suggested MCP diagnostic call, but it does not restart, redeploy, roll back, or
edit env vars automatically. The briefing detail dialog includes an **Agent handoff** prompt with
the `briefing_id`, a deterministic first MCP call (`openlander_monitor.get_ai_ops_briefing`), the
suggested call, and an after-fix verification checklist. The handoff prompt also includes a
verification call that passes the same `briefing_id` to `openlander_monitor.diagnose_service`, which
returns a machine-readable `recovery_receipt` comparing the incident snapshot with current live
route/container/deploy evidence. The handoff prompt intentionally contains no token or credential.

> **Note**: OpenLander's model is resource-first for runtime configuration. Activity,
> deployments, domains, env vars, and resource limits belong to Application detail pages rather
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

### Database/Cache/Storage Resources

Database/Cache/Storage resources are shown inside each Project, alongside Applications and Compose
stacks. Open a Project and use the Resources tab to inspect project-scoped databases, caches, and
storage containers wired to that Project.

There is no global `/managed-services` web page in v0.1. Database/Cache/Storage resource
creation stays on the MCP/agent path; the web UI is for visibility and
operations on resources already connected to a Project.

---

### Application And Resource Detail

> **0.1 routing**: Application detail is `/projects/:p/services/:s`.
> Database/Cache/Storage resource detail is `/projects/:p/infrastructure/:s`.

**Actions**: Deploy (header button), Delete (typed-confirm flow inside Overview).

**Tabs (observability-first per the v0.1 spec)**:

| Tab             | Features                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| **Overview**    | General details, resource limits, health, danger zone (typed-confirm delete).     |
| **Logs**        | Live runtime container logs.                                                      |
| **Deployments** | Per-Application deployment history with deploy-in-place log streaming.            |
| **Monitoring**  | CPU / memory time-series and request-side health.                                 |
| **Environment** | Application env vars (read/write).                                                |
| **Domains**     | Host/path routes registered for the Application. DNS/TLS remain external in v0.1. |
| **AI**          | Per-Application AI Ops Briefing override plus recent briefing handoff prompts.    |

Applications use the full detail surface. Database/Cache/Storage resources
use a narrower project-scoped detail surface with Overview, Logs, and
Connections. Lifecycle and danger actions live in Overview to match Application
detail. Project detail shows connected project-scoped Database/Cache/Storage
resources in the Resources tab; cross-project shared resources and external TCP
endpoints are deferred.

---

### Web Server (`/settings/web-server`)

Routing observability plus the one-time Connected Publish setup. The page shows proxy detection,
the route table mapped to services, host port allocations, external containers, and a compact
Cloudflare card. **Connect Cloudflare** opens OAuth and then selects the account and DNS Zone used
for Project publication. A Publish-initiated connection returns to the Project and resumes the
action. The connected card's menu supports reauthorization and a confirmed disconnect; disconnect
stops all published URLs and removes only OpenLander-owned DNS, Tunnel, connector, and token
resources. Route tables and proxy diagnostics remain read-only.

### Git Providers (`/settings/git-providers`)

GitHub identity card (octocat + `@login` + tri-state status pip), action menu (Manage on GitHub / Re-authorize / Refresh / Disconnect), and a stat block (Repos linked / Last sync / Connected on / OAuth scopes). GitLab and Bitbucket rows are future placeholders; 0.2.0 keeps GitHub as the only live Git provider surface.

The legacy multi-tab `/settings` host (System / Security / Proxy / GitHub / MCP) was retired for v0.1: Global Secrets are backend-only, Security folded into the AccountPopover, Proxy moved to Web Server, MCP moved to Your Agent (`/mcp-server`), and `/settings` itself is now a narrow GitHub device-flow handoff that the Git Providers Re-authorize and Connect buttons land on.

---

## Navigation

### Sidebar

- **Search** (⌘K): open command palette to jump to projects / pages, plus quick-links for Web Server + Git Providers.
- **Workspace**: Home, Your Agent, Projects, Engagements, Activity, Monitoring, Web Server.
- **Settings**: Git Providers.
- **Account footer**: admin avatar with Change Password / Sign Out popover.

## UI Features

- **Real-time streaming** — Build logs stream as they happen
- **ANSI colors** — Docker output renders with proper colors
- **Dark mode** — Default theme
- **i18n** — Korean and English (switchable in settings)
- **Responsive** — Works on desktop and tablet
