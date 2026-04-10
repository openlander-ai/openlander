# Agent Instructions

> OpenLander — Self-hosted deployment platform with AI auto-recovery.
> TypeScript (strict ESM), Node.js >= 22, Hono backend, React 19 frontend, Docker + Traefik.

## Architecture Overview

```
CLI (Commander)  →  AppContext  →  Hono HTTP Server
                        ↓
        ┌───────────────┼───────────────┐
        │               │               │
   Pipeline        Tools/MCP        Web API
   (deploy,        (69 ToolDefs,    (routes,
    docker,         AI SDK +         middleware,
    traefik)        MCP adapters)    WebSocket)
        │               │               │
        └───────┬───────┘               │
                ↓                       │
            Database                    │
         (Drizzle ORM +                 │
          SQLite + Repos)               │
                │                       │
         Recovery Layer                 │
         (RecoveryCoordinator,          │
          ApprovalGate,                 │
          AgentPool)                    │
                                        │
                              React 19 Frontend
                           (Vite + Tailwind + Radix)
```

**Key principle**: Execution is deterministic (rule-based). AI handles error analysis and recovery via RecoveryCoordinator — gated by 7 eligibility conditions, with approval gates for high-risk actions.

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
│   │   ├── deploy-stream-routes.ts
│   │   ├── deploy-timeline-stream-routes.ts
│   │   ├── terminal-routes.ts
│   │   ├── chat-routes.ts
│   │   ├── auth-routes.ts
│   │   ├── setup-routes.ts
│   │   ├── ai-usage-routes.ts   #   AI usage tracking API
│   │   ├── approval-routes.ts   #   Recovery approval API
│   │   ├── llm-routes.ts        #   LLM provider management API
│   │   ├── ops-routes.ts        #   Operations center API
│   │   ├── domain-routes.ts     #   Domain management
│   │   ├── webhook-routes.ts    #   Webhook management
│   │   └── ...
│   └── middleware/
│       └── auth.ts          #   Auth middleware
├── pipeline/                # Core deployment logic
│   ├── deploy-core.ts       #   DeployPipeline class
│   ├── docker.ts            #   Docker abstraction layer (single entry point for all Docker operations)
│   ├── traefik.ts           #   Traefik manager
│   ├── compose.ts           #   Docker Compose pipeline
│   ├── deploy-plan/         #   Plan engine (create → update → execute)
│   ├── deploy/              #   Sub-steps (orchestrator, build, run, rollback)
│   ├── service-manager.ts   #   Infrastructure services
│   └── service-adapters/    #   DB adapters (postgres, mysql, redis)
├── tools/                   # MCP Tool System
│   ├── defs/                #   ToolDef definitions (14 categories, 69 tools)
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
│   ├── alerts.ts            #   Container/health alert detection
│   ├── recovery-coordinator.ts #   Single-owner recovery (Eligibility Gate, 7 conditions)
│   ├── ops-recovery.ts      #   Recovery planner (recipe fast-path + LLM fallback)
│   ├── ops-agent.ts         #   Operations agent
│   ├── incident-reporter.ts #   Incident dedup (error-pattern fingerprinting)
│   ├── postmortem.ts        #   PostmortemGenerator (auto after recovery success)
│   └── ...
├── mcp/                     # MCP server (stdio + HTTP)
├── auth/                    # Authentication service
├── config/                  # Config management (~/.openlander/)
├── channels/                # Notification (Slack, Discord, Telegram)
├── git-providers/           # Git provider integration
├── webhook/                 # Webhook manager
├── lib/                     # Shared utilities
├── env/                     # Encryption utilities
├── ipc/                     # Inter-process communication
└── types/                   # Shared TypeScript types

web/src/                     # React 19 Frontend
├── App.tsx                  # Router + providers (Auth, Language, Environment)
├── main.tsx                 # Entry point
├── index.css                # Tailwind + CSS variables + animations
├── pages/                   # Page components
│   ├── ProjectsGrid.tsx     #   Dashboard
│   ├── ProjectDetail.tsx    #   Project detail
│   ├── NewProjectFlow.tsx   #   New project wizard
│   ├── SettingsPage.tsx     #   Settings
│   ├── ServicesPage.tsx     #   Services list
│   └── LoginPage.tsx        #   Login
├── components/
│   ├── ui/                  #   shadcn/ui primitives (button, dialog, select...)
│   ├── layout/              #   AppLayout, Header, Sidebar
│   ├── dashboard/           #   ProjectCard, SystemHealthCards
│   ├── project/             #   OverviewTab, DeploymentsList
│   ├── settings/            #   Settings tabs
│   ├── setup/               #   Onboarding steps
│   ├── timeline/            #   Build timeline, RecoveryCard
│   ├── logs/                #   LogViewer components
│   ├── agent/               #   AI agent panel
│   ├── config/              #   DomainsPanel, EnvVarsTable
│   └── ...
├── contexts/                # React Context providers
│   ├── auth.tsx             #   Authentication state
│   ├── environment.tsx      #   Environment selection
│   └── agent-panel.tsx      #   AI agent panel state
├── hooks/                   # Custom hooks (data fetching with polling)
├── i18n/                    # i18n (context.tsx, en.ts, ko.ts)
├── lib/
│   ├── api/                 #   API layer (native fetch, no axios)
│   │   ├── auth.ts, projects.ts, services.ts, system.ts, chat.ts
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

20+ specific error classes: `GitCloneError`, `DockerBuildError`, `ProjectNotFoundError`, etc. Global error handler in `routes.ts` catches and serializes these.

### Repository Pattern (Database)

Each table has a repository class in `src/db/repos/`. The `Database` class aggregates them all:

```typescript
// src/db/repos/project.repo.ts
class ProjectRepo { ... }

// src/db/index.ts — accessed via ctx.db
ctx.db.projects.findById(id)
ctx.db.deployLogs.create(data)
```

Schema defined in `src/db/schema.drizzle.ts` (Drizzle ORM + SQLite).

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

14 tool categories, 69 tools. Two adapters convert ToolDefs to:

- `src/tools/adapters/mcp.ts` — MCP protocol format (4 composite tools)
- `src/tools/adapters/ai-sdk.ts` — Vercel AI SDK format

MCP exposes 4 composite tools, each accepting an `action` parameter (`action="help"` lists operations):

- `openlander_deploy` — deploy lifecycle (create_deploy_plan, execute_deploy_plan, etc.)
- `openlander_project` — project management, env vars
- `openlander_service` — infrastructure services, volumes
- `openlander_monitor` — monitoring, alerts, automation

### Docker Abstraction Layer

`src/pipeline/docker.ts` is the **single entry point** for all Docker operations. All new code MUST use docker.ts methods, never raw `getClient()` calls.

**Method categories**:

- **Container lifecycle**: `runContainer`, `safeRemoveContainer`, `restartContainer`, `stopContainer`, `startContainer`
- **Network management**: `connectContainerToNetwork`, `disconnectContainerFromNetwork`, `getNetworkInfo`
- **Execution**: `execSimple`, `execStream`
- **Inspection**: `inspectContainer`, `listContainers`, `getContainerInfo`
- **Image operations**: `buildImage`, `pullImage`, `removeImage`

**Deprecation**: `getClient()` is deprecated and will be removed after PR2 (read-path) and PR3 (special cases) migrate all 24 remaining callers. The deprecation is signaled via `@deprecated` JSDoc to guide developers away from raw dockerode calls.

**Why**: Centralizing Docker operations in one module enables:

- Consistent error handling and logging
- Easier testing (mock one module, not 24 files)
- Future Docker API changes isolated to one place
- Clear audit trail of all Docker operations

### EventBus

`src/events/index.ts` — Decouples modules. 40+ event types (`deploy:start`, `deploy:success`, `container:crash`, etc.).

### Deploy Pipeline (3-Step Flow)

```
createPlan(opts)  →  updatePlan(planId, updates)  →  executePlan(planId)
     ↓                       ↓                            ↓
  DeployPlan            Fill env vars,              Non-blocking execution
  (ready or             select Dockerfile,          Returns immediately
   needs_input)         provision services          Poll get_deploy_status
```

Plan statuses: `created` → `needs_input` / `ready` → `executing` → `completed` / `failed`

Convenience tool `deploy` combines all 3 steps into one call.

## Frontend Conventions

### State & Data Fetching

- **No external state library** — React Context + custom hooks only
- **No data fetching library** — Native `fetch` with `fetchWithAuth()` wrapper
- **Polling-based updates** — hooks use `setInterval` (10s idle, 3s active)
- Contexts: `AuthContext`, `EnvironmentContext`, `LanguageContext`, `AgentPanelContext`

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

| File            | Domain                                       |
| --------------- | -------------------------------------------- |
| `auth.ts`       | Login, logout, verify, token                 |
| `projects.ts`   | Project CRUD, deployments, env vars, domains |
| `services.ts`   | Service management                           |
| `system.ts`     | System status                                |
| `chat.ts`       | AI agent chat                                |
| `operations.ts` | Operations center, recovery monitoring       |
| `usage.ts`      | AI usage tracking, cost summary              |

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

### Automated by `npm run release` (release-it)

- `package.json` — version field
- `web/package.json` — synced via after:bump hook
- `package-lock.json` — regenerated via after:bump hook
- `web/package-lock.json` — regenerated via after:bump hook
- `CHANGELOG.md` — `[Unreleased]` section promoted to new version
- Git tag — `v{version}`

### Manual (agent must update)

- `docs/planning/version-map.md` — add version to timeline + create section with changes
- `README.md` — add row to roadmap table if the release has user-facing features

### When NOT using `npm run release` (manual bump)

All of the above must be done manually. In addition:

- Run `npm install --package-lock-only` in root AND `web/` to sync lock files
- Ensure `CHANGELOG.md` has the new version section (move items from `[Unreleased]`)
