import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from '../app.js';
import { createModuleLogger } from '../lib/logger.js';
import { registerMcpTools } from '../tools/adapters/mcp.js';
import { registerMcpPrompts } from './prompts.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import type { ToolDef } from '../tools/defs/types.js';

const log = createModuleLogger('mcp');

const mcpToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...debugToolDefs,
];

const SERVER_INSTRUCTIONS = `You are connected to OpenLander, a self-hosted deployment platform that builds Docker images from git repos and runs them behind Traefik.

CRITICAL: Use the MCP tools below for ALL OpenLander operations. NEVER write HTTP requests, curl commands, fetch() calls, or API client code. Every action you need is available as a tool.

## Tools by Category

### Deploy
- deploy_project — Deploy from git URL. Key params: dockerfile_path, docker_target (multi-stage), env_vars (JSON string), force (auto-clean conflicts). Returns immediately; poll with get_deploy_status.
- redeploy_project — Redeploy existing project (picks up new env vars, pulls latest code).
- rollback_project — Revert to previous Docker image.
- deploy_blue_green — Zero-downtime deploy with health check before traffic switch.
- preview_deploy / cleanup_preview / list_previews — Ephemeral branch previews.
- get_deploy_status — Poll build progress. Shows phase (queued/cloning/building/starting/done/failed) and elapsed time.

### Services (Databases & Caches)
- create_service — Create PostgreSQL/MySQL/Redis/MongoDB via template, or any Docker image. Returns suggested_env with the recommended env var key and connection string for auto-linking.
- list_services / get_service_status — See running services.
- get_service_credentials — Get connection string, host, port, user, password.
- start_service / stop_service / remove_service — Lifecycle management.
- create_service_database — Create a new database in PostgreSQL/MySQL service.
- create_service_user — Create a user with optional database grants.

### Environment & Config
- set_env_vars — Set env vars on a project (JSON string of key-value pairs). Requires redeploy to take effect.
- set_global_secret / list_global_secrets — Encrypted secrets shared across all projects.
- expose_public / unexpose_public — Toggle public URL via Cloudflare tunnel.

### Monitoring & Debug
- get_logs — Container runtime logs.
- get_system_stats — Disk, memory, CPU, container count.
- get_build_log — Raw Docker build output (essential for debugging).
- debug_build_error — AI-powered build error analysis.

### Project Management
- list_projects — All projects with status.
- stop_project / restart_project / remove_project — Lifecycle control.
- scan_project — Detect framework, Dockerfiles, env requirements from repo.
- scan_dockerfiles — Find all Dockerfiles in a monorepo.

### Domains & Infrastructure
- map_domain / list_domains — Custom domain management.
- analyze_infrastructure — Detect frameworks, services, deployment strategy from repo.

### Git Integration
- list_github_repos / search_github_repos — Browse connected GitHub repos.

## Typical Workflows

### First deploy with database
1. create_service({ name: "mydb", template: "postgresql" })
   → Response includes suggested_env: [{ key: "DATABASE_URL", value: "postgresql://..." }]
2. deploy_project({ repo_url: "...", env_vars: '{"DATABASE_URL": "postgresql://..."}' })
3. get_deploy_status({ project_name: "..." }) — poll until done
4. If failed: get_build_log → debug_build_error

### Add service to existing project
1. create_service({ name: "cache", template: "redis" })
   → suggested_env: [{ key: "REDIS_URL", value: "redis://ol-svc-cache:6379" }]
2. set_env_vars({ project_name: "myapp", variables: '{"REDIS_URL": "redis://ol-svc-cache:6379"}' })
3. redeploy_project({ project_name: "myapp" })

### Redeploy with stale container conflict
- deploy_project({ repo_url: "...", force: true }) — auto-removes conflicting containers

## Key Rules
- Connection strings use Docker container names (ol-svc-*) as hostnames, NEVER localhost or 127.0.0.1.
- For services running on the host machine (outside Docker), use host.docker.internal as hostname.
- env_vars in deploy_project and set_env_vars both take a JSON string: '{"KEY": "value"}'.
- set_env_vars requires redeploy_project afterward to take effect.
- deploy_project runs preflight checks automatically. Use force=true to bypass name conflicts.
- Second service of the same type gets a prefixed env key (e.g. ANALYTICS_DATABASE_URL instead of DATABASE_URL).`;

// eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
function createMcpServerInstance(ctx: AppContext): Server {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: '0.4.1' },
    { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  registerMcpTools(server, mcpToolDefs, ctx);
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
}

export function createMcpHttpRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const sessions = new Map<string, McpSession>();

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
      ],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.all('/', async (c) => {
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
        sessions.set(sid, { server, transport });
        log.info({ sessionId: sid }, 'MCP HTTP session created');
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        log.info({ sessionId: sid }, 'MCP HTTP session closed');
      },
    });

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
