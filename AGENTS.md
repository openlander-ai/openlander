# Agent Instructions

> OpenLander — Self-hosted deployment platform with MCP-native agent workflows.
> TypeScript (strict ESM), Node.js >= 22, Hono backend, React 19 frontend, Docker + Traefik.

## Architecture Overview

```
CLI (Commander)  →  AppContext  →  Hono HTTP Server
                        ↓
        ┌───────────────┼───────────────┐
        │               │               │
    Pipeline        Tools/MCP        Web API
    (deploy,        (ToolDefs,       (routes,
     docker,         MCP adapters)    middleware,
     traefik)                         WebSocket)
        │               │               │
        └───────┬───────┘               │
                ↓                       │
            Database                    │
         (Drizzle ORM +                 │
          Postgres + Repos)             │
                │                       │
         Passive Monitoring             │
         (health, logs, alerts)         │
                                        │
                              React 19 Frontend
                           (Vite + Tailwind + Radix)
```

**Key principle**: Execution is deterministic (rule-based). In 0.1, built-in LLM
provider setup, web-agent chat, token usage tracking, and automatic AI
remediation are disabled. External MCP agents read logs/status and explicitly
call deploy/service/config actions.

**V0.2_REENABLE guardrail**: do not start `RecoveryCoordinator`, `OpsAgent`,
LLM provider health checks, or built-in agent/chat routes unless the 0.2 product
surface, docs, and regression tests are restored together.

## Documentation Planning Rules

Use these rules whenever creating, moving, or retiring development-planning docs.

- Public-facing documentation lives under `docs/wiki/`, `docs/guides/`, and
  release/process docs under `docs/release/`.
- Internal planning notes, dogfood QA notes, competitive analysis, local-machine
  paths, and agent scratch files must not be committed to the public repository.
- If maintainers need long-form implementation plans, keep them in a private
  workspace or private repository and summarize only public-safe decisions in
  public docs.
- Cross-check docs are temporary coordination artifacts. Before deleting one,
  absorb public-safe decisions into the relevant public docs.
- For frontend implementation docs, i18n work means updating
  `web/src/i18n/en.ts` and `web/src/i18n/ko.ts` together unless the user
  explicitly asks for patch text only.

### Entry Points

| Entry       | File                | Purpose                          |
| ----------- | ------------------- | -------------------------------- |
| CLI         | `src/cli/index.ts`  | `openlander` command (Commander) |
| HTTP Server | `src/web/server.ts` | Hono server (TCP + Unix socket)  |
| MCP Server  | `src/mcp/server.ts` | MCP protocol (stdio + HTTP)      |
| Library     | `src/index.ts`      | Programmatic exports             |

### Dependency Injection: AppContext

`src/app.ts` defines `AppContext` — the single interface that wires all modules. It's passed to every route handler, CLI command, and tool executor.

```typescript
// Pattern: All services accessed via ctx
function createProjectRoutes(ctx: AppContext): Hono { ... }
```

## Directory Structure

```
src/
├── app.ts                   # AppContext interface & factory
├── errors.ts                # Error class hierarchy (20+ classes)
├── index.ts                 # Library entry
├── version.ts               # Version constant
├── cli/                     # CLI (Commander)
├── web/                     # HTTP layer (Hono)
│   ├── server.ts            #   Server startup
│   ├── api/                 #   Route modules (factory functions)
│   │   ├── routes.ts        #   Main router + activity stream
│   │   ├── project-routes.ts
│   │   ├── overview-routes.ts   #   Overview/summary routes
│   │   ├── deploy-stream-routes.ts
│   │   ├── deploy-timeline-stream-routes.ts
│   │   ├── deploy-failure-handler.ts #   Deploy failure event handler
│   │   ├── terminal-routes.ts
│   │   ├── chat-routes.ts      #   Disabled in 0.1 (410 FEATURE_DISABLED)
│   │   ├── auth-routes.ts
│   │   ├── setup-routes.ts
│   │   ├── system-routes.ts     #   System status routes
│   │   ├── ai-usage-routes.ts   #   Disabled in 0.1 (410 FEATURE_DISABLED)
│   │   ├── approval-routes.ts   #   Disabled in 0.1 (410 FEATURE_DISABLED)
│   │   ├── llm-routes.ts        #   Disabled in 0.1 (410 FEATURE_DISABLED)
│   │   ├── ops-routes.ts        #   Passive activity/incidents; AI Ops mutations disabled in 0.1
│   │   ├── domain-routes.ts     #   Domain management
│   │   ├── webhook-routes.ts    #   Git-provider auto-deploy webhooks disabled in 0.1 (410 FEATURE_DISABLED)
│   │   ├── helpers/             #   Route helper utilities
│   │   └── setup/               #   Setup flow handlers
│   └── middleware/
│       └── auth.ts          #   Auth middleware
├── pipeline/                # Core deployment logic
│   ├── deploy-core.ts       #   DeployPipeline class
│   ├── docker.ts            #   Docker entry point (re-exports from docker/)
│   ├── docker/              #   Docker abstraction layer (modular)
│   │   ├── facade.ts        #   Public API (single import point for all Docker ops)
│   │   ├── container.ts     #   Container lifecycle (run, stop, start, remove, inspect)
│   │   ├── image.ts         #   Image operations (build, pull, remove)
│   │   ├── exec.ts          #   Container command execution
│   │   ├── network.ts       #   Network management
│   │   ├── volume.ts        #   Volume management
│   │   ├── stream.ts        #   Log and event streaming
│   │   ├── infra.ts         #   Infrastructure operations
│   │   ├── context.ts       #   DockerContext creation (dockerode init)
│   │   ├── helpers.ts       #   Utilities (socket path, cleanup)
│   │   └── types.ts         #   Docker type definitions
│   ├── traefik.ts           #   Traefik manager
│   ├── compose.ts           #   Docker Compose pipeline
│   ├── deploy-plan/         #   Plan engine (create → update → execute)
│   ├── deploy/              #   Sub-steps (orchestrator, build, run, rollback)
│   ├── service-manager.ts   #   Infrastructure services
│   └── service-adapters/    #   DB adapters (postgres, mysql, redis)
├── tools/                   # MCP Tool System
│   ├── defs/                #   ToolDef definitions (internal; MCP surface is 5 composites + 13 opt-in platform tools)
│   │   ├── types.ts         #   ToolDef interface
│   │   └── index.ts         #   Registry exports
│   └── adapters/            #   Protocol adapters
│       ├── mcp.ts           #   MCP protocol adapter
│       └── ai-sdk.ts        #   Vercel AI SDK adapter
├── db/                      # Database layer
│   ├── index.ts             #   Database class (aggregates repos)
│   ├── drizzle.ts           #   Drizzle ORM setup
│   ├── schema.drizzle.ts    #   Schema definitions
│   ├── migration.ts         #   Auto-migration
│   └── repos/               #   Repository classes (one per table)
├── llm/                     # LLM integration (Vercel AI SDK)
│   ├── agent.ts             #   Chat agent (streaming + tool calling)
│   ├── agent-pool.ts        #   AgentPool (session isolation, MAX_POOL_SIZE=5)
│   ├── context-assembler.ts #   Structured context for recovery (project state, server stats)
│   ├── model-registry.ts    #   ModelRegistry (multi-provider, per-feature routing)
│   ├── model-proxy.ts       #   Provider-specific model creation
│   ├── transparency.ts      #   Token tracking, cost calculation (PRICING_TABLE)
│   ├── providers.ts         #   Provider definitions
│   └── ...
├── events/                  # EventBus (decoupled communication)
├── monitor/                 # Health monitoring, recovery & operations
│   ├── activity-event-mapper.ts #   Maps EventBus events to activity_log schema
│   ├── activity-logger.ts   #   Persists EventBus events to activity_log table
│   ├── alerts.ts            #   Alert aggregation coordinator
│   ├── container-alert-handler.ts #   Handles container events (die, oom, missing)
│   ├── container-state-reconciler.ts #   Reconciles Docker state vs database
│   ├── docker-events.ts     #   Real-time Docker event stream listener
│   ├── incident-reporter.ts #   Multi-channel incident notification
│   ├── infrastructure-alerter.ts #   Disk, inactive, restart loop checks
│   ├── llm-diagnosis.ts     #   LLM-based crash root cause analysis
│   ├── ops-agent.ts         #   Event-driven operations agent
│   ├── ops-alerting.ts      #   OpsAgent alerting subsystem
│   ├── ops-cascade.ts       #   Multi-project cascade failure detector
│   ├── ops-config-resolver.ts #   Resolves recovery automation policy
│   ├── ops-digest.ts        #   Daily/weekly incident digest generator
│   ├── ops-drift.ts         #   Config drift detection
│   ├── ops-incidents.ts     #   Incident lifecycle manager
│   ├── ops-recovery.ts      #   Recovery pipeline executor
│   ├── ops-types.ts         #   OpsAgent type definitions
│   ├── postmortem.ts        #   Post-recovery analysis generator
│   ├── project-health-monitor.ts #   Probe-based project health checking
│   ├── recovery-coordinator.ts #   Single-owner recovery (7-condition eligibility gate)
│   ├── rollback-watcher.ts  #   Monitors rollback operations
│   ├── service-health-monitor.ts #   Shared infrastructure service health
│   ├── stats.ts             #   System statistics collection
│   └── system-maintenance-monitor.ts #   Periodic system cleanup
├── mcp/                     # MCP server (stdio + HTTP)
├── auth/                    # Authentication service
├── config/                  # Config management (~/.openlander/)
├── channels/                # Notification (Slack, Discord, Telegram)
├── git-providers/           # Git provider integration
├── webhook/                 # Cold-storage git-provider webhook manager (not exposed in 0.1)
├── lib/                     # Shared utilities
├── env/                     # Encryption utilities
├── ipc/                     # Inter-process communication
└── types/                   # Shared TypeScript types

web/src/                     # React 19 Frontend
├── App.tsx                  # Router + providers (Auth, Language, ProjectsContext, AppData)
├── main.tsx                 # Entry point
├── index.css                # Tailwind + CSS variables + animations
├── pages/                   # Page components (top-level routes)
│   ├── Home.tsx             #   Dashboard (/home)
│   ├── ProjectsGrid.tsx     #   Projects list (/projects)
│   ├── ProjectView.tsx      #   Project detail (/projects/:id)
│   ├── ServiceDetailV2.tsx  #   Service detail (/projects/:p/services/:s, /managed-services/:id)
│   ├── ServicesPage.tsx     #   Managed services list (/managed-services)
│   ├── DeploymentsList.tsx  #   Cross-project deploy history (/deployments)
│   ├── DeploymentDetail.tsx #   Deploy detail (/projects/:id/deployments/:deployId)
│   ├── Activity.tsx         #   Audit log (/activity)
│   ├── MCPServer.tsx        #   MCP status + connected agents (/mcp-server)
│   ├── MonitoringPage.tsx   #   System metrics (/monitoring)
│   ├── SettingsPage.tsx     #   Settings (/settings, 7 tabs)
│   ├── settings/            #   Settings sub-pages (web-server, git-providers, ssh-keys, notifications)
│   └── LoginPage.tsx        #   Login (/login)
├── components/
│   ├── ui/                  #   shadcn/ui primitives (button, dialog, select...)
│   ├── Shell/               #   AppShell, Sidebar, TopBar, ActivityTimeline, InfraMap, LogViewer, PhaseRail, SuccessSummary
│   ├── shared/              #   Cross-page primitives (PageHeader, OuterCard, StatusTile, etc.)
│   ├── project/             #   OverviewTab, ProjectDetailTabs, deploy/recovery cards
│   ├── service/             #   Service detail tabs (overview, connection, databases, logs, settings, advanced)
│   ├── settings/            #   Settings tab content (System, Security, Proxy, GitHub, MCP)
│   ├── setup/               #   Onboarding wizard steps
│   ├── agent-guide/         #   AgentGuideDialog (prompts users to use MCP for actions)
│   ├── command/             #   Command palette
│   ├── config/              #   DomainsPanel, EnvVarsTable
│   ├── deploy-terminal/     #   Build/deploy terminal UI
│   ├── deploy/              #   Deploy flow components
│   ├── timeline/            #   ActivityRow, deploy timeline, RecoveryCard
│   ├── logs/                #   Log viewer atoms
│   ├── icons/               #   Custom icon set
│   └── ops/                 #   Legacy/follow-up cleanup area
├── contexts/                # React Context providers (no external state lib)
│   ├── auth.tsx             #   Authentication state
│   ├── projects-context.tsx #   Shared projects list with polling
│   ├── app-data-context.tsx #   Cross-page shared data
├── hooks/                   # Custom hooks (polling-based data fetching)
├── i18n/                    # i18n (context.tsx, en.ts, ko.ts) — custom lightweight, no i18next
├── lib/
│   ├── api/                 #   API layer (native fetch, no axios)
│   │   ├── auth.ts, projects.ts, services.ts, system.ts
│   │   ├── notifications.ts, topology.ts
│   │   ├── client.ts        #   fetchWithAuth wrapper
│   │   └── *-zod.ts         #   Zod schemas for response validation
│   └── utils.ts             #   cn() class merger
└── types/                   # Frontend types

test/                        # Vitest tests (separate from src/)
e2e/                         # Playwright E2E tests
docs/                        # Internal documentation
```

## Key Patterns

### Route Pattern (Hono)

Every route file exports a factory function that receives `AppContext`:

```typescript
// src/web/api/xxx-routes.ts
export function createXxxRoutes(ctx: AppContext): Hono {
  const api = new Hono();
  api.get('/items', async (c) => { ... });
  return api;
}

// Registered in server.ts:
app.route('/api', createXxxRoutes(ctx));
```

### Error Handling

Custom hierarchy in `src/errors.ts`. All errors extend `OpenLanderError`:

```typescript
class OpenLanderError extends Error {
  readonly code: string; // Machine-readable (e.g. 'GIT_CLONE_FAILED')
  readonly statusCode: number; // HTTP status
  readonly details?: Record<string, unknown>;
  toJSON(): Record<string, unknown>;
}
```

30+ specific error classes covering git, docker, deploy, project lifecycle, mutation policy, and repo persistence failures. The Hono server registers a global `onError` in `src/web/server.ts` (and `routes.ts` for the `/api` sub-router) that recognizes `OpenLanderError instanceof` and serializes via `toJSON()`. Anything else falls through to a generic `INTERNAL_ERROR` 500.

**Boundary handlers (where each layer's policy lives)**

| Layer                          | Boundary                                                                              | Responsibility                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP                           | `app.onError` (`src/web/server.ts`) + `api.onError` (`src/web/api/routes.ts`)         | Serialize typed errors to JSON, log unhandled                                                                                                                                                                                    |
| Pipeline                       | `assertProjectMutable` in `src/pipeline/mutation-policy.ts`                           | Reject mutations on archived / recovering / circuit-broken projects. Called at the top of `pipeline.deploy` (existing-project branch), `pipeline.deployEnvironment`, `pipeline.redeploy`, and `pipeline.rollback`                |
| Deploy lock                    | `withDeployLock` / `acquireDeployLockOrThrow` in `src/db/repos/deploy-lock-helper.ts` | Acquire/release deploy lock; throw `DeployLockedError` on contention. Currently wraps `pipeline.redeploy` and `pipeline.rollback` only. Use the helper instead of hand-rolled `try/finally` when adding new mutation entrypoints |
| Recovery (cold storage in 0.1) | `checkRecoveryEligibility` + `withRecoveryStage` in `src/monitor/recovery-policy.ts`  | Dormant policy for future built-in AI Ops. The 0.1 runtime does not start `RecoveryCoordinator` or automatic remediation. Keep the policy centralized if re-enabled.                                                             |
| MCP / CLI tools                | `tryRejectIfNotMutable` in `src/tools/defs/helpers.ts`                                | Synchronous pre-check so fire-and-forget tools return a clear `rejected_by_policy` response instead of fake "deploying"                                                                                                          |

**Hard rules (enforced via review)**

1. **No silent swallow.** `try { …; } catch { /* nothing */ }` and `catch (e) { log.warn(…) }` followed by continuing the same logical operation are both banned. Use `withRecoveryStage` for stages with downstream consequences, or rethrow.
2. **No raw `throw new Error('…')` in domain code.** Use a named class from `src/errors.ts`. Add a new typed error if none fits.
3. **Mutating routes go through pipeline boundary.** Don't invent a new redeploy/rollback path that calls Docker directly. Add the entry to `pipeline.*` so `assertProjectMutable` is enforced. `withDeployLock` is currently wrapped around `pipeline.redeploy` / `pipeline.rollback` only — wrap any new long-running mutation entrypoint in it explicitly so concurrent deploys for the same project are rejected with `DeployLockedError`.
4. **Cross-cutting checks have one owner.** `deploy_lock_session`, `circuit_breaker_state`, `archived_at` are evaluated by `RecoveryPolicy` / `mutation-policy`. If you need the same predicate, import the helper — don't reimplement.
5. **Fire-and-forget rejections must be visible.** When you spawn a background task whose policy decision is synchronous (e.g. archived project, circuit open), check before returning success to the caller. The user has to see the rejection.
6. **If built-in recovery is re-enabled, `recovery:degraded` is the partial-failure signal.** Emit it from `withRecoveryStage` (free) or directly when a stage fails but the recovery loop continues. Listeners (`incident-reporter`, `activity-logger`) record it; missing it = invisible regression.

When in doubt, grep for the helper before adding inline logic — duplicating the policy is how Day 1-2's web-only fix had to be expanded to the full pipeline boundary in Day 5.

### Repository Pattern (Database)

Each table has a repository class in `src/db/repos/`. The `Database` class aggregates them all:

```typescript
// src/db/repos/project.repo.ts
class ProjectRepo { ... }

// src/db/index.ts — accessed via ctx.db
ctx.db.projects.findById(id)
ctx.db.deployLogs.create(data)
```

Schema defined in `src/db/schema.drizzle.ts` (Drizzle ORM + Postgres).

### ToolDef System (MCP + AI SDK)

Unified tool interface in `src/tools/defs/types.ts`:

```typescript
interface ToolDef {
  name: string; // snake_case (MCP spec requirement)
  description: string;
  mcpDescription?: string; // MCP-specific override
  inputSchema: z.ZodType; // Zod schema
  execute: (args, context: ToolContext) => unknown;
  targets?: ('agent' | 'mcp')[];
}
```

Tool definition files back the MCP tool system. The MCP adapter exposes **5 composite tools** (`openlander_deploy|_project|_service|_managed_service|_monitor`) over 64 unique default operations, plus **13 platform tools** gated by `config.mcp.platformTools`. Two adapters exist:

- Current registry snapshot: (98 ToolDefs, across 19 tool definition files).
- `src/tools/adapters/mcp.ts` — MCP protocol format (5 composite tools + gated platform tools)
- `src/tools/adapters/ai-sdk.ts` — legacy/future internal LLM adapter, not part of the 0.1 runtime surface

MCP exposes 5 composite tools, each accepting an `action` parameter (`action="help"` lists operations):

- `openlander_deploy` — deploy lifecycle (create_deploy_plan, execute_deploy_plan, etc.)
- `openlander_project` — project group management, env vars
- `openlander_service` — deployable app/worker lifecycle and config
- `openlander_managed_service` — infrastructure services, databases, volumes
- `openlander_monitor` — monitoring, alerts, automation

### Docker Abstraction Layer

`src/pipeline/docker.ts` is a thin re-export shim pointing to `src/pipeline/docker/facade.ts`. The full implementation lives in the `src/pipeline/docker/` subdirectory (11 files):

- `facade.ts` — Public API (single import point for all Docker ops)
- `container.ts` — Container lifecycle (run, stop, start, remove, inspect)
- `image.ts` — Image operations (build, pull, remove)
- `exec.ts` — Container command execution
- `network.ts` — Network management
- `volume.ts` — Volume management
- `stream.ts` — Log and event streaming
- `infra.ts` — Infrastructure operations
- `context.ts` — DockerContext creation (dockerode init)
- `helpers.ts` — Utilities (socket path, cleanup)
- `types.ts` — Docker type definitions

All new code MUST import from `docker.ts` (or `docker/facade.ts`), never raw dockerode calls. **Method categories** (now distributed across modules):

- **Container lifecycle**: `runContainer`, `safeRemoveContainer`, `restartContainer`, `stopContainer`, `startContainer`
- **Network management**: `connectContainerToNetwork`, `disconnectContainerFromNetwork`, `getNetworkInfo`
- **Execution**: `execSimple`, `execStream`
- **Inspection**: `inspectContainer`, `listContainers`, `getContainerInfo`
- **Image operations**: `buildImage`, `pullImage`, `removeImage`

**Status**: `getClient()` has been fully removed from the codebase.

**Why**: Centralizing Docker operations in one module enables:

- Consistent error handling and logging
- Easier testing (mock one module, not 24 files)
- Future Docker API changes isolated to one place
- Clear audit trail of all Docker operations

### EventBus

`src/events/index.ts` — Decouples modules. 70 event types (`deploy:start`, `deploy:success`, `container:crash`, etc.).

### Deploy Pipeline (3-Step Flow)

```
createPlan(opts)  →  updatePlan(planId, updates)  →  executePlan(planId)
     ↓                       ↓                            ↓
  DeployPlan            Fill env vars,              Non-blocking execution
  (ready or             select Dockerfile,          Returns immediately
   needs_input)         provision services          Poll get_deploy_status
```

Plan statuses: `created` → `needs_input` / `ready` → `executing` → `completed` / `failed`

Convenience tool `deploy_app` is the app deploy front door: it combines all 3
steps for new apps and routes existing app targets to redeploy.

## Frontend Conventions

### State & Data Fetching

- **No external state library** — React Context + custom hooks only
- **No data fetching library** — Native `fetch` with `fetchWithAuth()` wrapper
- **Polling-based updates** — hooks use `setInterval` (10s idle, 3s active)
- Contexts: `AuthContext`, `ProjectsContext`, `AppDataContext`, `LanguageContext` (in `i18n/context.tsx`)

### Styling

- **Tailwind CSS v3** with `cn()` class merger (`clsx` + `tailwind-merge`)
- **shadcn/ui-style** components with CVA variants in `components/ui/`
- **CSS variables** for theming in `web/src/index.css`
- Custom design tokens: `bg-app`, `bg-panel`, `bg-subtle`, `agent`, `success`, `warning`, `error`
- Fonts: Inter (display/body), Geist Mono / JetBrains Mono (code)

### i18n

Custom lightweight solution — **no i18next**:

```typescript
const { t, language } = useLanguage();
// t('projects.deploy.title') — dot-notation lookup
```

Translation files: `web/src/i18n/en.ts`, `web/src/i18n/ko.ts`. Language stored in localStorage.

**All user-facing strings must use `t()`.** Both en.ts and ko.ts must be updated together.

### API Layer

API calls organized by domain in `web/src/lib/api/`:

| File          | Domain                                       |
| ------------- | -------------------------------------------- |
| `auth.ts`     | Login, logout, verify, token                 |
| `projects.ts` | Project CRUD, deployments, env vars, domains |
| `services.ts` | Service management                           |
| `system.ts`   | System/setup status                          |
| `client.ts`   | fetchWithAuth wrapper, base fetch utilities  |
| `index.ts`    | Barrel export for all API modules            |

`fetchWithAuth()` auto-redirects to `/login` on 401.

## Development Workflow

```bash
npm install          # Install all dependencies
npm run dev          # Watch mode (tsup --watch for backend)
npm run build        # Full build: clean + tsup + vite
npm run start        # Run: node dist/cli/index.js

npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run typecheck    # tsc --noEmit

npm test             # Vitest (once)
npm run test:watch   # Vitest (watch)
npm run test:coverage # Vitest + coverage
npm run test:e2e     # Playwright E2E
```

### Build Pipeline

- **Backend**: tsup (esbuild) → `dist/` — ESM, target Node 22, sourcemaps
- **Frontend**: Vite → `web/dist/` — React 19, Tailwind, code-split

### Pre-commit Hooks (Husky + lint-staged)

Every commit auto-runs:

1. ESLint `--fix` on staged `*.ts` / `*.tsx`
2. Prettier `--write` on staged files

Commit blocked if ESLint finds unfixable errors.

## Testing

### Structure

- **Unit/Integration**: `test/` directory (Vitest) — mirrors `src/` structure
- **E2E**: `e2e/quality-gate/` (Playwright) — full deploy flow verification
- **Web tests**: `web/test/` — frontend component tests

### Vitest Config Highlights

- Setup file: `test/setup.ts` (mocks lucide-react icons)
- Path alias: `@` → `web/src`
- Coverage thresholds: 60% lines, 55% branches, 55% functions

### Test Patterns

```typescript
import { describe, expect, it } from 'vitest';
import { someFunction } from '../src/module.js'; // Note: .js extension (ESM)

describe('someFunction', () => {
  it('does the expected thing', () => {
    expect(someFunction(input)).toEqual(expected);
  });
});
```

- ESM imports with `.js` extension for relative paths
- `vi.mock()` for module mocks
- Mock contexts and LLM interactions in integration tests

## Coding Conventions

### TypeScript (Strict)

- **ESM only** — no CommonJS
- `strict: true` with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`
- `verbatimModuleSyntax: true`
- **Never** use `as any`, `@ts-ignore`, or `@ts-expect-error`
- Relative imports use `.js` extension: `import { x } from './module.js'`

### Formatting (Prettier)

```
semi: true, singleQuote: true, trailingComma: "all", printWidth: 100, tabWidth: 2
```

### Commit Convention

[Conventional Commits](https://www.conventionalcommits.org/) with scope:

```
feat(web): add Cloudflare Settings form
fix(pipeline): container conflict on redeploy
refactor(mcp): extract tool registry
test: add coverage for ServiceManager
```

Common scopes: `web`, `agent`, `pipeline`, `mcp`, `cli`, `db`

### Naming

| Context            | Convention              | Example                        |
| ------------------ | ----------------------- | ------------------------------ |
| MCP tool names     | snake_case              | `create_deploy_plan`           |
| TypeScript files   | kebab-case              | `deploy-core.ts`               |
| React components   | PascalCase              | `ProjectCard.tsx`              |
| CSS classes        | Tailwind utility        | `bg-app text-muted-foreground` |
| DB repos           | PascalCase + `.repo.ts` | `project.repo.ts`              |
| Error classes      | PascalCase + `Error`    | `DockerBuildError`             |
| Event names        | colon-separated         | `deploy:success`               |
| Container names    | `ol-{project}`          | `ol-myapp`                     |
| Service containers | `ol-svc-{name}`         | `ol-svc-postgres`              |

## Important Gotchas

### Backend

- **Hono, not Express** — The web framework is Hono, not Express. Different API.
- **AppContext is required** — All route/service/tool code receives `ctx: AppContext`. Never instantiate services directly.
- **ToolDef names are immutable** — MCP clients cache tool names. Renaming breaks compatibility.
- **Deploy is non-blocking** — `executePlan` returns immediately. Always poll `get_deploy_status`.
- **Port ranges by environment** — production: 10001-10999, development: 20001-20999.
- **Docker network** — All containers join `openlander` shared network.
- **`_agent_guidance`** — Tool responses include this field to guide AI next steps. Preserve it.

### Frontend

- **No data fetching library** — Use the existing `useState` + `useEffect` + polling pattern. Don't add react-query or SWR.
- **i18n is required** — All user-facing strings must use `t()`. Update both `en.ts` and `ko.ts`.
- **No global state library** — Use React Context. Don't add Zustand/Redux.
- **`cn()` for classes** — Always use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Radix UI for primitives** — Use existing Radix-based components in `components/ui/`.

### Testing

- **Tests in `test/`, not co-located** — Don't put test files next to source files.
- **ESM `.js` extension** — Import paths in tests use `.js` extension even for `.ts` files.

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to main:

```
npm ci → lint → typecheck → test:coverage → build
```

All four must pass. Fix locally before pushing.

## Version Bump Checklist

When bumping the version (e.g. `0.6.2` → `0.6.3`), update ALL of these:

### Automated by `npm run release:final` or `npm run release:rc` (release-it)

- `package.json` — version field
- `web/package.json` — synced via after:bump hook
- `package-lock.json` — regenerated via after:bump hook
- `web/package-lock.json` — regenerated via after:bump hook
- `CHANGELOG.md` — `[Unreleased]` section promoted to new version
- Git tag — `v{version}`

### Manual (agent must update)

- `README.md` — add row to roadmap table if the release has user-facing features

### When NOT using `npm run release:final` / `npm run release:rc` (manual bump)

All of the above must be done manually. In addition:

- Run `npm install --package-lock-only` in root AND `web/` to sync lock files
- Ensure `CHANGELOG.md` has the new version section (move items from `[Unreleased]`)
