import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from '../app.js';
import { AuthService } from '../auth/auth-service.js';
import { createModuleLogger } from '../lib/logger.js';
import { registerMcpTools } from '../tools/adapters/mcp.js';
import { registerMcpPrompts } from './prompts.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { deployPlanToolDefs } from '../tools/defs/deploy-plan.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import { volumeToolDefs } from '../tools/defs/volume.js';
import { webhookToolDefs } from '../tools/defs/webhook.js';
import { environmentToolDefs } from '../tools/defs/environment.js';
import { platformReadToolDefs } from '../tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../tools/defs/platform-actions.js';
import type { ToolDef } from '../tools/defs/types.js';

const log = createModuleLogger('mcp');

/**
 * Get MCP tool definitions, optionally including platform tools.
 * Platform tools are only registered when config.mcp.platformTools is true.
 */
function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
    ...deployToolDefs,
    ...deployPlanToolDefs,
    ...projectOpsToolDefs,
    ...envToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
    ...infraToolDefs,
    ...gitToolDefs,
    ...monitoringToolDefs,
    ...debugToolDefs,
    ...webhookToolDefs,
    ...environmentToolDefs,
    ...(platformToolsEnabled
      ? [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs]
      : []),
  ];
}

const SERVER_INSTRUCTIONS = `You are connected to OpenLander, a self-hosted deployment platform that builds Docker images from git repos and runs them behind Traefik.

CRITICAL: Use the MCP tools below for ALL OpenLander operations. NEVER write HTTP requests, curl commands, fetch() calls, or API client code. Every action you need is available as a tool.

IMPORTANT: Docker may run on a remote host, not the MCP client machine. Do NOT use docker CLI, docker compose, or curl localhost to interact with containers. Use OpenLander tools (get_logs, get_deploy_status, restart_project, etc.) instead. Tool responses include docker_host ("local" or "remote") when relevant — check this to determine if local commands would work.

## Tools by Category

### Deploy
- create_deploy_plan — Create a deployment plan from git URL or Docker image. Key params: source ('git' or 'image'), repo_url (for git), image (for Docker image, e.g., nginx:latest), port (container port), cmd (command override), name (project name override — NOT "project_name"), dockerfile_path, docker_target (multi-stage), env_vars (JSON string), prefer_dockerfile (skip compose detection — use for monorepos), force (auto-clean conflicts), dry_run (preview plan without deploying). Returns planId immediately.
- update_deploy_plan — Update an existing deployment plan with new parameters.
- execute_deploy_plan — Execute a deployment plan. Returns immediately; poll with get_deploy_status.
- rollback_project — Revert to previous Docker image.
- deploy_blue_green — Zero-downtime deploy with health check before traffic switch. Use for production projects where downtime is unacceptable.
- preview_deploy / cleanup_preview / list_previews — Ephemeral branch previews for PR testing.
- deploy_environment — Deploy a specific environment (production/development) for a project. Returns immediately.
- get_deploy_status — Poll build progress. Shows phase (queued/cloning/building/starting/done/failed) and elapsed time. Pass wait=true to block until completion instead of polling.

### Services (Databases, Caches & Object Storage)
- create_service — Create PostgreSQL/MySQL/Redis/MongoDB/MinIO via template, or any Docker image. Data persisted in Docker named volumes. Returns suggested_env with connection string for auto-linking. For databases, use template="postgres" and set DATABASE_URL from suggested_env.
- list_services / get_service_status — See running services.
- get_service_credentials — Get connection string, host, port, user, password.
- get_service_logs — Get container logs for a service. Essential for diagnosing error-state services.
- backup_service — Snapshot a service's persistent data (DB files, etc.) BEFORE removing. Returns backupId.
- restore_service — Restore a service from a backup snapshot.
- list_service_backups — List available backups for a service.
- start_service / stop_service / remove_service — Lifecycle management. IMPORTANT: remove_service deletes ALL data. Always backup_service first.
- create_service_database — Create additional databases inside an existing PostgreSQL/MySQL service.
- create_service_user — Create a user with optional database grants and per-database access.
- create_bucket / list_buckets / delete_bucket — Manage S3 buckets inside a MinIO service. Use after creating a MinIO service to set up per-project storage buckets.

### Volumes (Persistent Storage)
- add_volume — Create a persistent Docker volume for a project. Specify mount_path (e.g. /app/uploads). Volume survives redeploys and is auto-mounted on next deploy.
- list_volumes — List volumes for a project (or all managed volumes). Shows name, mount path, and size.
- remove_volume — Delete a volume. Container must be stopped first. WARNING: permanently deletes all data.
- get_disk_usage — Docker system disk usage breakdown: images, containers, volumes with sizes.

### Environment & Config
- set_env_vars — Set env vars on a project (JSON string of key-value pairs). Requires redeploy to take effect.
- set_global_secret / list_global_secrets — Encrypted secrets shared across ALL projects automatically. Use for shared API keys, external service credentials.
- upload_secret_file — Upload a credential file (e.g. Firebase JSON, TLS cert) that mounts at /run/secrets/filename. Encrypted at rest. Omit project_name for global (all projects). Requires redeploy.
- list_secret_files — List uploaded secret files (content never returned).
- remove_secret_file — Remove a secret file. Requires redeploy.
- expose_public / unexpose_public — Toggle public URL via Cloudflare tunnel.

### Monitoring & Debug
- get_logs — Container runtime logs for projects (default 20 lines). For service logs, use get_service_logs.
- get_system_stats — Disk, memory, CPU, container count. Call before deploying to check resources.
- get_build_log — Raw Docker build output. Essential for debugging build failures.
- debug_build_error — AI-powered build error analysis with actionable fix suggestions.

### Project Management
- list_projects — All projects with status, ports, URLs.
- stop_project / restart_project / remove_project — Lifecycle control.
- scan_project — Detect framework, Dockerfiles, compose files, and env requirements from repo. ALWAYS call before first deploy.
- scan_dockerfiles — Find all Dockerfiles in a monorepo. Use with orchestrate_deploy for multi-service deployment.

### Domains & Infrastructure
- map_domain / list_domains — Custom domain management via Traefik.
- analyze_infrastructure — Deep analysis: detect frameworks, required services, deployment strategy.

### Git Integration
- list_github_repos / search_github_repos — Browse connected GitHub repos.

### Webhook Auto-Deploy
- enable_webhook — Configure a git provider (GitHub/GitLab/Bitbucket) to auto-deploy on push. Returns webhook URL and secret for git provider configuration.
- disable_webhook — Disable webhook for a provider without deleting config.
- get_webhook_config — List all webhook configs for a project.

### Environments
- create_environment — Add a development environment with a specific branch. Production is auto-created on first deploy.
- list_environments — See all environments for a project with status and branch info.
- deploy_environment — Deploy a specific environment (pulls from that environment's branch).

## Deploy Planning (ALWAYS follow for new deploys)

Before deploying any new project, run this planning sequence:

1. scan_project({ repo_url }) — Detect project type, Dockerfiles, compose files, env requirements.
2. Classify the result:
    - Single Dockerfile → create_deploy_plan + execute_deploy_plan
    - Multiple Dockerfiles (monorepo) → orchestrate_deploy for dependency-ordered deployment with atomic rollback
    - Has compose file → create_deploy_plan + execute_deploy_plan with the primary service's Dockerfile
3. Check service dependencies:
   - If app needs a database: list_services to check if one exists, or create_service to provision one
   - Map discovered env requirements to service connection strings
4. Deploy with env vars pre-configured:
    - create_deploy_plan({ repo_url, env_vars: '{"DATABASE_URL": "...", "REDIS_URL": "..."}' })
    - execute_deploy_plan({ plan_id: "..." })
5. Monitor: get_deploy_status until done or failed.
6. If deploy fails: get_deploy_history to review past deployment attempts and outcomes.

## Deploy Failure Recovery

When a deploy fails, do NOT stop. Follow this fallback chain:

1. get_build_log to get raw output → debug_build_error for AI analysis
2. get_deploy_history to check if this failure matches a previous pattern.
3. If build error (Dockerfile issue): explain the error, suggest a fix
4. If runtime crash: get_logs → check for missing env vars or config issues
5. If port/name conflict: create_deploy_plan + execute_deploy_plan with force: true
6. If all else fails: explain what went wrong, what you tried, give a clear next step

Common failure patterns:
- "Module not found" / "package not found" → Missing dependency in Dockerfile. Check build stage.
- "ECONNREFUSED 127.0.0.1" → App using localhost for a service. Needs container hostname (ol-svc-*).
- "port already in use" → Another container on the same port. Use force=true or stop the conflicting project.
- "health check failed" → App not responding on expected port. Check get_logs for startup errors.

## Network Access

Deploy responses include URLs for all detected network interfaces (LAN and VPN).
- If VPN IPs (Tailscale, ZeroTier, WireGuard) are detected, prefer VPN URLs for verification — they work from both local and remote networks.
- LAN URLs (192.168.x.x) only work within the same local network.
- When verifying a deploy, use the VPN URL if available; fall back to LAN URL only if no VPN is detected.

## Typical Workflows

### First deploy with database
1. scan_project({ repo_url: "..." }) — understand what we're deploying
2. create_service({ name: "mydb", template: "postgresql" })
   → Response includes suggested_env: [{ key: "DATABASE_URL", value: "postgresql://..." }]
3. create_deploy_plan({ repo_url: "...", env_vars: '{"DATABASE_URL": "postgresql://..."}' })
4. execute_deploy_plan({ plan_id: "..." })
5. get_deploy_status({ project_name: "..." }) — poll until done
6. If failed: get_build_log → debug_build_error

### Add database to a project
1. create_service({ name: "myapp-db", template: "postgres" })
   → Creates PostgreSQL with persistent volume, returns suggested_env with DATABASE_URL
2. set_env_vars({ project_name: "myapp", env_vars: { DATABASE_URL: "..." } })
3. Redeploy the project

### Add service to existing project
1. create_service({ name: "cache", template: "redis" })
   → suggested_env: [{ key: "REDIS_URL", value: "redis://ol-svc-cache:6379" }]
2. set_env_vars({ project_name: "myapp", variables: '{"REDIS_URL": "redis://ol-svc-cache:6379"}' })
3. create_deploy_plan({ project_name: "myapp" })
4. execute_deploy_plan({ plan_id: "..." })

### Shared database for multiple projects
1. create_service({ name: "shared-pg", template: "postgresql" }) — one database service
2. create_service_database({ service_name: "shared-pg", database_name: "app1_db" })
3. create_service_database({ service_name: "shared-pg", database_name: "app2_db" })
4. get_service_credentials({ service_name: "shared-pg" }) — get connection details
5. set_env_vars on each project with its specific database name in the connection string

### Firebase / GCP credential file
1. upload_secret_file({ project_name: "myapp", filename: "firebase-sa.json", content: '{"type":"service_account",...}' })
   → Encrypted, mounted at /run/secrets/firebase-sa.json
2. set_env_vars({ project_name: "myapp", variables: '{"GOOGLE_APPLICATION_CREDENTIALS": "/run/secrets/firebase-sa.json"}' })
3. create_deploy_plan({ project_name: "myapp" })
4. execute_deploy_plan({ plan_id: "..." })

### TLS certificate (global, all projects)
1. upload_secret_file({ filename: "ca-cert.pem", content: "-----BEGIN CERTIFICATE-----..." })
   → Global: available to all projects at /run/secrets/ca-cert.pem

### Deploy Docker image directly (no git repo)
1. create_deploy_plan({ source: "image", image: "nginx:latest", name: "my-nginx", port: 80 })
   → Returns plan_id with detected port and configuration
2. execute_deploy_plan({ plan_id: "..." })
3. get_deploy_status({ project_name: "my-nginx" }) — poll until done

### Deploy with stale container conflict
- create_deploy_plan({ repo_url: "...", force: true }) then execute_deploy_plan — auto-removes conflicting containers

### Zero-downtime production update
1. deploy_blue_green({ project_name: "production-app" })
   → Builds new version alongside old one, runs health check, then switches traffic

### Global secrets for all projects
1. set_global_secret({ key: "STRIPE_API_KEY", value: "sk_live_...", description: "Stripe production key" })
   → Automatically injected into every deploy. No need to set per-project.

### Set up auto-deploy webhook
1. enable_webhook({ project_name: "myapp", source: "github" })
   → Returns { secret, webhookPath: "/api/webhooks/PROJECT_ID/github" }
2. In GitHub repo settings → Webhooks → Add webhook:
   - URL: YOUR_OPENLANDER_HOST + webhookPath
   - Secret: the returned secret
   - Events: Push events (and optionally Pull request events for previews)
3. Now every push to main auto-triggers create_deploy_plan + execute_deploy_plan

### Deploy to multiple environments
1. create_deploy_plan({ repo_url: "...", env_vars: '...' }) then execute_deploy_plan — auto-creates production env
2. create_environment({ project_name: "myapp", type: "development", branch: "develop" })
3. deploy_environment({ project_name: "myapp", environment_type: "development" })
4. Each environment has its own container, port, and URL

## Environment Variable Handling

When a user provides env vars (pasted .env file or key=value pairs):

1. Parse the variables and classify:
   - URL values containing localhost/127.0.0.1/192.168.x.x → needs hostname replacement
   - Secret-looking values (passwords, tokens, API keys) → keep as-is
   - Regular config values → keep as-is

2. For localhost URLs, call list_services and replace with container hostnames:
    - postgresql://localhost:5432 → postgresql://ol-svc-SERVICENAME:5432
    - redis://127.0.0.1:6379 → redis://ol-svc-SERVICENAME:6379
    - http://192.168.1.100:8080 → http://host.docker.internal:8080 (host service)

3. Apply all vars in one set_env_vars call, then create_deploy_plan + execute_deploy_plan.

### Build-Time Variables (Automatic)
Environment variables with these prefixes are automatically injected as Docker build args:
- NEXT_PUBLIC_* (Next.js)
- VITE_* (Vite)
- REACT_APP_* (Create React App)
- NUXT_PUBLIC_* (Nuxt)
- PUBLIC_* (SvelteKit/general)
- GATSBY_* (Gatsby)
No extra configuration needed. Pass them via env_vars in create_deploy_plan or set_env_vars — they'll be available at both build time and runtime.

## Key Rules
- Connection strings use Docker container names (ol-svc-*) as hostnames, NEVER localhost or 127.0.0.1.
- For services running on the host machine (outside Docker), use host.docker.internal as hostname.
- env_vars in create_deploy_plan and set_env_vars both take a JSON string: '{"KEY": "value"}'.
- set_env_vars requires create_deploy_plan + execute_deploy_plan afterward to take effect.
- create_deploy_plan runs preflight checks automatically. Use force=true to bypass name conflicts.
- Second service of the same type gets a prefixed env key (e.g. ANALYTICS_DATABASE_URL instead of DATABASE_URL).
- Deploys are non-blocking — execute_deploy_plan returns immediately. ALWAYS poll get_deploy_status afterward.
- list_projects and get_deploy_status return a urls array with LAN and VPN access URLs (type: "lan" or "vpn"). Use these to tell the user how to access from other devices on the network.
- For databases, use create_service with template="postgres" (or "mysql"). Data is stored in Docker named volumes and persists across container restarts.
- scan_project before first deploy is strongly recommended — it reveals framework, required env vars, and monorepo structure.
- Global secrets (set_global_secret) are auto-injected into all deploys. Project-level env vars override them.
- Secret files (upload_secret_file) mount at /run/secrets/filename inside containers. Use for Firebase JSON, TLS certs, SSH keys — any file the app needs on disk. Set GOOGLE_APPLICATION_CREDENTIALS or similar env var pointing to the mount path.`;

// eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
function createMcpServerInstance(ctx: AppContext): Server {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: '0.4.1' },
    { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const toolDefs = getMcpToolDefs(ctx.config.mcp.platformTools === true);
  registerMcpTools(server, toolDefs, ctx);
  registerMcpPrompts(server);

  return server;
}

export async function startMcpServer(ctx: AppContext): Promise<void> {
  const server = createMcpServerInstance(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('OpenLander MCP server started on stdio transport');
}

interface McpSession {
  server: Server; // eslint-disable-line @typescript-eslint/no-deprecated
  transport: WebStandardStreamableHTTPServerTransport;
  lastActivity: number;
  heartbeatInterval?: ReturnType<typeof setInterval>;
  ttlTimeout?: ReturnType<typeof setTimeout>;
}

export function createMcpHttpRoutes(ctx: AppContext): Hono & { cleanup: () => void } {
  const app = new Hono();
  const sessions = new Map<string, McpSession>();
  const authService = new AuthService(ctx.db);

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: [
        'Content-Type',
        'Accept',
        'mcp-session-id',
        'mcp-protocol-version',
        'Last-Event-ID',
        'Authorization',
      ],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.all('/', async (c) => {
    // Bearer token auth for HTTP MCP
    if (authService.isPasswordSet()) {
      const authHeader = c.req.header('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
          401,
        );
      }
      const token = authHeader.slice(7);
      if (!authService.validateApiToken(token)) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid token' }, id: null },
          401,
        );
      }
    }

    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          404,
        );
      }
      return session.transport.handleRequest(c.req.raw);
    }

    const server = createMcpServerInstance(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        const session: McpSession = {
          server,
          transport,
          lastActivity: Date.now(),
        };

        session.heartbeatInterval = setInterval(() => {
          session.lastActivity = Date.now();
        }, 30_000);

        sessions.set(sid, session);
        log.info({ sessionId: sid }, 'MCP HTTP session created');
      },
      onsessionclosed: (sid) => {
        const session = sessions.get(sid);
        if (session) {
          if (session.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
          }

          session.ttlTimeout = setTimeout(
            () => {
              void session.transport.close();
              sessions.delete(sid);
              log.info({ sessionId: sid }, 'MCP HTTP session TTL expired, removed from map');
            },
            5 * 60 * 1000,
          );

          log.info({ sessionId: sid }, 'MCP HTTP session closed, TTL cleanup scheduled');
        }
      },
    });

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  (app as Hono & { cleanup: () => void }).cleanup = () => {
    for (const [sid, session] of sessions.entries()) {
      if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }
      if (session.ttlTimeout) {
        clearTimeout(session.ttlTimeout);
      }
      sessions.delete(sid);
    }
    log.info('MCP HTTP sessions cleanup completed');
  };

  return app as Hono & { cleanup: () => void };
}
