import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Readable, Writable } from 'node:stream';
import type { AppContext } from '../app.js';
import { AuthService, type McpTokenIdentity } from '../auth/auth-service.js';
import { createCorsOriginPolicy } from '../web/middleware/cors-policy.js';
import { createModuleLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { registerCompositeMcpTools } from '../tools/adapters/mcp.js';
import { registerMcpPrompts } from './prompts.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployableServiceToolDefs } from '../tools/defs/deployable-service.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { deployPlanToolDefs } from '../tools/defs/deploy-plan.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { networkOperationToolDefs } from '../tools/defs/network-operations.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { deliveryToolDefs } from '../tools/defs/delivery.js';
import { engagementToolDefs } from '../tools/defs/engagement.js';
import { agentDeliveryToolDefs, projectManifestToolDefs } from '../tools/defs/agent-delivery.js';
import { releaseOperationToolDefs } from '../tools/defs/release-operations.js';
import { reportingOperationToolDefs } from '../tools/defs/reporting-operations.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import { volumeToolDefs } from '../tools/defs/volume.js';
import { platformReadToolDefs } from '../tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../tools/defs/platform-actions.js';
import type { ToolDef } from '../tools/defs/types.js';
import type { RequestIdentity } from '../types/identity.js';
import { buildIncidentBriefing } from '../llm/prompts.js';
import { createCompositeTools, type CompositeTool } from './composite-tools.js';
import { getMcpInstanceContext } from './instance-identity.js';

const log = createModuleLogger('mcp');

/**
 * Get MCP tool definitions, optionally including platform tools.
 * Platform tools are only registered when config.mcp.platformTools is true.
 */
function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
    ...deployToolDefs,
    ...deployableServiceToolDefs,
    ...deployPlanToolDefs,
    ...projectOpsToolDefs,
    ...deliveryToolDefs,
    ...engagementToolDefs,
    ...agentDeliveryToolDefs,
    ...projectManifestToolDefs,
    ...releaseOperationToolDefs,
    ...reportingOperationToolDefs,
    ...envToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
    ...infraToolDefs,
    ...gitToolDefs,
    ...monitoringToolDefs,
    ...networkOperationToolDefs,
    ...debugToolDefs,
    ...(platformToolsEnabled
      ? [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs]
      : []),
  ];
}

function getPlatformToolDefs(): ToolDef[] {
  return [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs];
}

function getCompositeTools(allToolDefs: ToolDef[]): CompositeTool[] {
  return createCompositeTools(allToolDefs);
}

const SERVER_INSTRUCTIONS = `You are connected to OpenLander — a self-hosted deployment platform.

CRITICAL: Use ONLY the 5 composite tools below. Each tool takes an { action, params } input.
Use action="help" on any tool to list available operations and machine-readable input schemas.
NEVER call docker CLI, general localhost REST APIs, or docker compose directly — use OpenLander tools instead.
The only HTTP exception is uploading bytes with a short-lived bearer URL returned by an OpenLander upload action.
Docker may run on a remote host. Always use tools, not local commands.

## openlander_deploy
Deploy front door for new apps plus plans, validation, execution, rollbacks, previews, build logs, Git, infrastructure.
Key actions: deploy_app, create_release, promote_release, evaluate_promotion, rollback_environment, create_deploy_plan, execute_deploy_plan, get_deploy_status, rollback_service, get_build_log
All actions: action="help"

## openlander_project
Projects, shared config, Agent Delivery Runs, Delivery Workspace metadata, and Engagement portfolio summaries. A Project organizes Applications, Compose stacks, Database/Cache/Storage resources, customer feedback evidence, Gates, and Delivery Receipts; env actions route to workload targets.
Key actions: create_project, list_projects, bootstrap_engagement, link_project_to_engagement, list_engagements, get_engagement, apply_project_manifest, get_project_manifest, plan_delivery, create_evidence_upload, request_delivery_review, get_delivery_review_status, start_delivery_run, run_quality_gates, get_delivery_run, record_delivery_run_progress, resume_delivery_run, cancel_delivery_run, complete_delivery, generate_weekly_report, publish_weekly_report, get_weekly_report, get_delivery_readiness
All actions: action="help"

## openlander_service
Applications/Compose workloads: lifecycle, config, env vars, domains, and temporary public URLs. Prefer compatibility field service_id from list_projects.
Key actions: update_app, redeploy_app, restart_service, apply_route_config, list_archived_services, set_env_vars, list_env_vars, update_application_source, update_service_config, expose_public
All actions: action="help"

## openlander_managed_service
Database/Cache/Storage resources and volumes. The action names are compatibility names; create_service creates a Database/Cache/Storage resource.
Key actions: create_service, list_services, get_service_credentials, backup_service, add_volume, get_disk_usage
All actions: action="help"

## openlander_monitor
Monitoring & diagnostics: instance info, one-shot service diagnosis, host resource checks, Docker network inventory, logs, alerts, system stats, and connectivity checks.
Key actions: get_instance_info, diagnose_service, diagnose_host_resources, list_docker_networks, remove_unused_docker_network, get_logs, get_alerts, get_system_stats, get_project_stats, dismiss_alert
All actions: action="help"

## Usage
Example: openlander_deploy({ action: "deploy_app", params: { repo_url: "https://github.com/user/repo", name: "my-app" } })
Example: openlander_project({ action: "help" })
Example: openlander_project({ action: "create_project", params: { name: "my-app" } })
Example: openlander_managed_service({ action: "create_service", params: { name: "pg", template: "postgresql", project_id: "proj_..." } })
Example: openlander_service({ action: "set_env_vars", params: { service_name: "app-web", variables: '{"DATABASE_URL":"..."}' } })

## Environment Variable Changes
- Env vars belong to Applications/Compose workloads. Prefer service_id or service_name; project_name works only when the Project has exactly one workload.
- set_env_vars/delete_env_var save only by default. To apply to a running container, call update_app after the env change, or pass defer_redeploy=false for immediate apply.
- list_env_vars masks values by default; pass reveal=true only when the user explicitly needs raw values for audit or migration.
- export_env_vars returns raw .env text and should be used sparingly.

## Deploy Flow
1. For a new app, start with openlander_deploy.deploy_app or create_deploy_plan. If the plan proposes safe Database/Cache resources, approve them through execute_deploy_plan; OpenLander owns the target Project, same-project resource provisioning, and env wiring in one composite path. If the user already has a real external URL (RDS, Upstash, etc.), pass it in env_vars and skip OpenLander-managed resource creation. Do not use a placeholder DATABASE_URL just to create the project.
2. For a simple new app with no pre-created Database/Cache resources, call openlander_deploy.deploy_app directly. New apps use params.name for the Project name. Existing apps can be targeted by service_id/service_name/project_name/name.
3. openlander_deploy({ action: "get_deploy_status", params: { service_id: "..." } })  ← poll the returned status_call until done when deploy_app/update_app/redeploy_app returns building/deploying
4. openlander_project({ action: "list_projects" })  ← confirm running and use projects[].deployable_service.service_id for later workload actions
5. If anything fails, times out, or looks unhealthy, call openlander_monitor.diagnose_service with service_id before retrying.

## Networking
- New OpenLander-managed deployments use Project-scoped Docker networks by default.
- Same-project Database/Cache/Storage resources are reachable by their service DNS names on that Project network.
- Do not delete or recreate existing data volumes during migration or recovery.
- For existing Docker/PaaS workloads, treat network and volume adoption as an operator-assisted migration flow. Inspect first, back up data, then use platform recovery/diagnostic tools or an explicit human-approved runbook.
- Do not issue ad-hoc Docker network changes unless the user is explicitly performing migration or incident recovery.

## Delivery Workspace
- MCP can create and inspect Deliveries, attach evidence URLs, record raw feedback, submit proposed work-item drafts, record Gate results, link a successful Production deployment, inspect readiness, and generate a Receipt preview.
- For a local file, call create_evidence_upload first. Then PUT the raw bytes to its short-lived bearer upload_url and use the returned Artifact ID. Do not authenticate that PUT with the MCP token, and do not send MCP tokens to the general REST API.
- Use the multipart web/API route only for human web sessions or CI clients that already use its supported authentication. It is not the default MCP path.
- AI-created work items remain proposed until an administrator confirms them in the web UI.
- Receipt finalization is human UI-only. Never claim a Delivery is delivered from a preview response.

## Engagement Portfolio
- list_engagements and get_engagement provide read-only internal FDE portfolio rollups across linked Projects and require instance/org scope.
- bootstrap_engagement, update_engagement_from_brief, archive_engagement, and unarchive_engagement require instance/org scope.
- link_project_to_engagement and unlink_project_from_engagement also accept a project-scoped token only when project_id exactly matches that token. Service-scoped tokens cannot infer or mutate Engagement membership.

## Agent Delivery Run
- plan_delivery stores the objective, Definition of Done, manifest path, and manifest-defined Gates.
- start_delivery_run pins execution to an exact commit, manifest SHA-256, and runner image. One Delivery can have only one active Run.
- run_quality_gates executes only manifest-declared argv commands in disposable containers and records attempts, redacted-log hashes, reports, and Gate status.
- record_delivery_run_progress preserves concise evidence. Supplying handoff_summary pauses the Run for resume_delivery_run by another Agent.
- Commands require idempotency_key. Use get_delivery_run for status and ordered events; cancel_delivery_run preserves existing evidence.

## Human UI-only operations
Project/app hard delete and purge are intentionally NOT exposed as MCP actions. If the user asks to delete, remove, purge, or destroy a Project/Application, tell them to use the web UI: Settings → Danger zone for that Project/Application. For soft lifecycle cleanup, use archive_project/unarchive_project for a whole Project or archive_service/unarchive_service for one Application/worker; all four enter the human approval queue before executing. Follow the returned poll_call or poll mcp_action_status with action_run_id. Archive is reversible cleanup, not permanent deletion: archived Applications disappear from default active lists but remain inspectable with list_archived_services and restorable with unarchive_service/unarchive_project. Do NOT substitute remove_service or cleanup_docker — those target Database/Cache/Storage resources and Docker hosts, not Applications.`;

function buildServerInstructions(ctx: AppContext, incidentBriefing: string): string {
  const instance = getMcpInstanceContext(ctx.config);
  const instancePrefix = `You are connected to OpenLander instance "${instance.name}" at "${instance.endpoint}". Use this instance identity when the user has multiple OpenLander MCP servers connected.`;
  const base = `${instancePrefix}\n\n${SERVER_INSTRUCTIONS}`;
  return incidentBriefing ? `${base}\n\n${incidentBriefing}` : base;
}

function toRequestIdentity(token: McpTokenIdentity | null): RequestIdentity | undefined {
  if (!token) return undefined;
  return {
    source: 'mcp',
    initiatedBy: token.name,
    mcpTokenId: token.tokenId,
    mcpTokenType: token.tokenType,
    mcpScopeKind: token.scopeKind,
    mcpScopeProjectId: token.scopeProjectId,
    mcpScopeServiceId: token.scopeServiceId,
  };
}

async function authenticateMcpRequest(
  c: Context,
  authService: AuthService,
): Promise<{ response?: Response; identity?: RequestIdentity }> {
  // Setup-only open state: before an admin password is ever set (first boot, prior to
  // the setup wizard) MCP is intentionally unauthenticated so initial wiring works. Once a
  // password exists this branch is skipped and Bearer auth is enforced below. This window is
  // not a general "auth off" switch — any future MCP producer must not rely on it staying open.
  if (!(await authService.isPasswordSet())) {
    return {};
  }

  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      response: c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
        401,
      ),
    };
  }

  const token = authHeader.slice(7);
  const identity = await authService.validateMcpBearerToken(token);
  if (!identity) {
    return {
      response: c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid token' }, id: null },
        401,
      ),
    };
  }

  return { identity: toRequestIdentity(identity) };
}

async function createMcpServerInstance(
  ctx: AppContext,
  identity?: RequestIdentity,
): Promise<Server> {
  const unresolvedIncidents = await ctx.db.listUnresolvedRuntimeIncidents();
  const incidentBriefing = await buildIncidentBriefing(unresolvedIncidents, ctx.db);
  const instructions = buildServerInstructions(ctx, incidentBriefing);

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions },
  );

  const platformToolsEnabled = ctx.config.mcp.platformTools === true;
  const toolDefs = getMcpToolDefs(platformToolsEnabled);
  const compositeTools = getCompositeTools(toolDefs);
  const platformDefs = platformToolsEnabled ? getPlatformToolDefs() : [];

  registerCompositeMcpTools(server, compositeTools, platformDefs, ctx, identity);
  registerMcpPrompts(server);

  return server;
}

interface StdioMcpServer {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
  onclose?: () => void;
}

interface McpStdioServerOptions {
  input?: Readable;
  output?: Writable;
  signal?: AbortSignal;
}

/**
 * Keep a stdio MCP server alive until its transport closes.
 *
 * The SDK stdio transport does not treat stdin EOF as a close event. Without
 * this bridge, detached clients can leave the AppContext and its database
 * pool alive indefinitely.
 */
export async function runMcpStdioLifecycle(
  server: StdioMcpServer,
  transport: Transport,
  input: Readable,
  signal?: AbortSignal,
): Promise<void> {
  let closePromise: Promise<void> | null = null;
  let resolveClosed: (() => void) | null = null;
  let rejectClosed: ((error: unknown) => void) | null = null;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  const previousOnClose = server.onclose;
  server.onclose = () => {
    previousOnClose?.();
    resolveClosed?.();
  };

  const requestClose = (): void => {
    if (closePromise) return;
    closePromise = server.close();
    void closePromise.then(
      () => resolveClosed?.(),
      (error: unknown) => rejectClosed?.(error),
    );
  };

  const onInputEnd = (): void => {
    requestClose();
  };
  const onAbort = (): void => {
    requestClose();
  };

  input.once('end', onInputEnd);
  input.once('close', onInputEnd);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await server.connect(transport);
    log.info('OpenLander MCP server started on stdio transport');
    if (input.readableEnded || input.destroyed || signal?.aborted) {
      requestClose();
    }
    await closed;
  } finally {
    input.off('end', onInputEnd);
    input.off('close', onInputEnd);
    signal?.removeEventListener('abort', onAbort);
    server.onclose = previousOnClose;
  }
}

export async function startMcpServer(
  ctx: AppContext,
  options: McpStdioServerOptions = {},
): Promise<void> {
  const server = await createMcpServerInstance(ctx);
  const input = options.input ?? process.stdin;
  const transport = new StdioServerTransport(input, options.output ?? process.stdout);
  await runMcpStdioLifecycle(server, transport, input, options.signal);
}

interface McpSession {
  server: Server; // eslint-disable-line @typescript-eslint/no-deprecated
  transport: WebStandardStreamableHTTPServerTransport;
  connectedAt: number;
  lastActivity: number;
  heartbeatInterval?: ReturnType<typeof setInterval>;
  ttlTimeout?: ReturnType<typeof setTimeout>;
  /** Set when `recordMcpSessionClose` has been called for this session.
   *  Guards against the close event firing twice (initial DELETE +
   *  TTL-driven transport.close()) which would write a duplicate
   *  `mcp_session_log` row. Codex CCG HIGH. */
  closeRecorded?: boolean;
  /** clientInfo.name from the MCP initialize handshake (e.g. "Claude
   *  Code", "Cursor", "Cline"). Captured via `server.oninitialized` →
   *  `server.getClientVersion()`. Undefined if the client never sent
   *  it or initialize hasn't completed yet. */
  clientName?: string;
  clientVersion?: string;
  /** Set when `onsessionclosed` fires. The session entry stays in the
   *  map until `ttlTimeout` runs (5min later) so any in-flight close
   *  cleanup can find it, but `closed: true` lets readers like
   *  getMcpSessionsSnapshot filter it out so /api/mcp/status doesn't
   *  over-report a torn-down session as still connected. Codex MEDIUM. */
  closed?: boolean;
}

interface McpSseSession {
  server: Server; // eslint-disable-line @typescript-eslint/no-deprecated
  transport: SSEServerTransport; // eslint-disable-line @typescript-eslint/no-deprecated
  connectedAt: number;
  lastActivity: number;
  clientName?: string;
  clientVersion?: string;
}

// Module-scope session registries so /api/mcp/status can enumerate active
// sessions without reaching into createMcpHttpRoutes' closure. Single MCP
// instance per process (one boot of createMcpHttpRoutes), so the global
// registries are safe.
const sessions = new Map<string, McpSession>();
const sseSessions = new Map<string, McpSseSession>();

export interface McpSessionSnapshot {
  id: string;
  transport: 'http' | 'sse';
  connectedAt: number;
  lastActivityAt: number;
  /** clientInfo.name from MCP initialize handshake (e.g. "Claude Code",
   *  "Cursor"). Undefined for sessions that connected before this field
   *  shipped or for clients that don't send clientInfo. */
  clientName?: string;
  clientVersion?: string;
}

/**
 * Snapshot of currently-connected MCP sessions. Returned to /api/mcp/status
 * so the UI can show "who is connected" without leaking internal session
 * objects (Server / Transport refs).
 */
/**
 * Terminate an MCP session by id. Closes the underlying transport and
 * removes it from the in-memory map so /api/mcp/status reflects the
 * disconnect immediately. Records the close in mcp_session_log.
 *
 * Returns true when a session matched and was closed; false when the
 * id was not found in either the HTTP or SSE registries.
 */
/**
 * Format the in-memory clientInfo as a single string for the
 * mcp_session_log.client_info column. Returns null when the session
 * never received an MCP `initialize` (e.g. transport closed before the
 * client's clientInfo arrived) so the audit row stays honest.
 */
function formatClientInfoForLog(s: { clientName?: string; clientVersion?: string }): string | null {
  if (!s.clientName) return null;
  return s.clientVersion ? `${s.clientName} v${s.clientVersion}` : s.clientName;
}

export function terminateMcpSession(sid: string, ctx: AppContext): boolean {
  // The wire-side id is truncated to 12 chars by /api/mcp/status, so
  // accept either a full uuid or its 12-char prefix.
  const matchHttp = (mapKey: string) => mapKey === sid || mapKey.slice(0, 12) === sid;
  const matchSse = matchHttp;

  for (const [mapKey, session] of sessions.entries()) {
    if (!matchHttp(mapKey)) continue;
    // Record the close in mcp_session_log. The SDK's transport.close()
    // does NOT trigger our `onsessionclosed` callback (only an MCP
    // DELETE request does), so admin terminations must persist the
    // audit row themselves. Codex CCG (2026-05-01).
    if (!session.closeRecorded) {
      session.closeRecorded = true;
      void ctx.db
        .recordMcpSessionClose({
          sessionId: mapKey,
          transport: 'http',
          connectedAt: session.connectedAt,
          disconnectedAt: Date.now(),
          clientInfo: formatClientInfoForLog(session),
        })
        .catch((err: unknown) => {
          log.warn({ sessionId: mapKey, err }, 'Failed to persist MCP HTTP admin-terminate close');
        });
    }
    session.closed = true;
    if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
    if (session.ttlTimeout) clearTimeout(session.ttlTimeout);
    void session.transport.close();
    sessions.delete(mapKey);
    log.info({ sessionId: mapKey }, 'MCP HTTP session terminated by admin');
    return true;
  }
  for (const [mapKey, session] of sseSessions.entries()) {
    if (!matchSse(mapKey)) continue;
    // Same audit concern as the HTTP branch above. The SSE
    // outgoing.on('close') handler races with our delete here; record
    // first so the close row is guaranteed.
    void ctx.db
      .recordMcpSessionClose({
        sessionId: mapKey,
        transport: 'sse',
        connectedAt: session.connectedAt,
        disconnectedAt: Date.now(),
        clientInfo: formatClientInfoForLog(session),
      })
      .catch((err: unknown) => {
        log.warn({ sessionId: mapKey, err }, 'Failed to persist MCP SSE admin-terminate close');
      });
    void session.transport.close();
    sseSessions.delete(mapKey);
    log.info({ sessionId: mapKey }, 'MCP SSE session terminated by admin');
    return true;
  }
  return false;
}

export function getMcpSessionsSnapshot(): McpSessionSnapshot[] {
  const out: McpSessionSnapshot[] = [];
  for (const [id, s] of sessions.entries()) {
    if (s.closed) continue;
    out.push({
      id,
      transport: 'http',
      connectedAt: s.connectedAt,
      lastActivityAt: s.lastActivity,
      clientName: s.clientName,
      clientVersion: s.clientVersion,
    });
  }
  for (const [id, s] of sseSessions.entries()) {
    out.push({
      id,
      transport: 'sse',
      connectedAt: s.connectedAt,
      lastActivityAt: s.lastActivity,
      clientName: s.clientName,
      clientVersion: s.clientVersion,
    });
  }
  return out.sort((a, b) => b.connectedAt - a.connectedAt);
}

export function createMcpHttpRoutes(ctx: AppContext): Hono & { cleanup: () => void } {
  const app = new Hono();
  const authService = new AuthService(ctx.db);

  app.use(
    '*',
    cors({
      origin: createCorsOriginPolicy(ctx.config.server.corsOrigin, ctx.config.server.baseUrl),
      credentials: false,
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
    const auth = await authenticateMcpRequest(c, authService);
    if (auth.response) return auth.response;

    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.closed) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          404,
        );
      }
      // Real activity: bump lastActivity here so /api/mcp/status reports
      // when the client *actually* spoke to us. The previous heartbeat-
      // driven update made every idle session look like it had just
      // called something (Codex MEDIUM, 2026-04-30).
      session.lastActivity = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }

    const server = await createMcpServerInstance(ctx, auth.identity);
    let httpSessionId: string | null = null;
    let httpClientCaptured = false;
    server.oninitialized = () => {
      // One-shot guard: the SDK's `oninitialized` can fire on duplicate
      // initialize notifications (Codex CCG 2026-05-01). The streamable
      // HTTP transport rejects re-initialize so this is mostly defense
      // in depth, but it keeps `clientName` from being stomped by a
      // racing notification mid-session.
      if (httpClientCaptured) return;
      // MCP `initialize` handshake completed — `getClientVersion()` now
      // returns the agent's `Implementation` (clientInfo.name + version).
      // Persist on the session record so /api/mcp/status can surface a
      // friendly identity instead of the opaque session UUID.
      const info = server.getClientVersion();
      if (!info || !httpSessionId) return;
      const session = sessions.get(httpSessionId);
      if (!session) return;
      session.clientName = info.name;
      session.clientVersion = info.version;
      httpClientCaptured = true;
      log.info(
        { sessionId: httpSessionId, clientName: info.name, clientVersion: info.version },
        'MCP HTTP session client identified',
      );
    };
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        httpSessionId = sid;
        const now = Date.now();
        const session: McpSession = {
          server,
          transport,
          connectedAt: now,
          lastActivity: now,
        };

        // No heartbeat: lastActivity is bumped at the actual
        // handleRequest call site so the value reflects real client
        // activity rather than the 30s polling tick.

        sessions.set(sid, session);
        log.info({ sessionId: sid }, 'MCP HTTP session created');
      },
      onsessionclosed: (sid) => {
        const session = sessions.get(sid);
        if (session) {
          // Mark closed so getMcpSessionsSnapshot filters it out of the
          // status surface. The map entry stays around until ttlTimeout
          // fires (5 min) so any re-entrant close paths can still find
          // it for cleanup. Codex MEDIUM (over-report). 2026-04-30.
          session.closed = true;

          // Audit log persistence — record the disconnect moment so the
          // /api/activity feed can synthesize mcp_disconnected events that
          // survive process restarts. Best-effort: a DB error here must not
          // break the close flow. Guarded by `closeRecorded` so re-entrant
          // close events (DELETE + TTL-driven transport.close()) write at
          // most one row per session lifetime.
          if (!session.closeRecorded) {
            session.closeRecorded = true;
            void ctx.db
              .recordMcpSessionClose({
                sessionId: sid,
                transport: 'http',
                connectedAt: session.connectedAt,
                disconnectedAt: Date.now(),
                clientInfo: formatClientInfoForLog(session),
              })
              .catch((err: unknown) => {
                log.warn({ sessionId: sid, err }, 'Failed to persist MCP HTTP session close');
              });
          }

          if (session.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
          }

          // Re-entrant close events (concurrent DELETEs) would otherwise
          // schedule multiple TTL timers. Codex CCG 2026-05-01.
          if (session.ttlTimeout) {
            clearTimeout(session.ttlTimeout);
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

  // Legacy SSE transport (protocol 2024-11-05) — needed by OpenCode, Cline for remote connections

  app.get('/sse', async (c) => {
    const auth = await authenticateMcpRequest(c, authService);
    if (auth.response) return auth.response;

    const { outgoing } = c.env as HttpBindings;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat
    const transport = new SSEServerTransport('/mcp/messages', outgoing);
    const server = await createMcpServerInstance(ctx, auth.identity);

    sseSessions.set(transport.sessionId, {
      server,
      transport,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    });

    // Capture clientInfo on initialize. See HTTP transport above.
    let sseClientCaptured = false;
    server.oninitialized = () => {
      // Legacy SSE accepts re-initialize per protocol 2024-11-05, so a
      // racing initialize notification could stomp a previously-captured
      // clientName. One-shot guard. Codex CCG 2026-05-01.
      if (sseClientCaptured) return;
      const info = server.getClientVersion();
      if (!info) return;
      const session = sseSessions.get(transport.sessionId);
      if (!session) return;
      session.clientName = info.name;
      session.clientVersion = info.version;
      sseClientCaptured = true;
      log.info(
        {
          sessionId: transport.sessionId,
          clientName: info.name,
          clientVersion: info.version,
        },
        'MCP SSE session client identified',
      );
    };

    outgoing.on('close', () => {
      const session = sseSessions.get(transport.sessionId);
      if (session) {
        void ctx.db
          .recordMcpSessionClose({
            sessionId: transport.sessionId,
            transport: 'sse',
            connectedAt: session.connectedAt,
            disconnectedAt: Date.now(),
            clientInfo: formatClientInfoForLog(session),
          })
          .catch((err: unknown) => {
            log.warn(
              { sessionId: transport.sessionId, err },
              'Failed to persist MCP SSE session close',
            );
          });
      }
      sseSessions.delete(transport.sessionId);
      log.info({ sessionId: transport.sessionId }, 'MCP SSE session closed');
    });

    await server.connect(transport);
    await transport.start();

    log.info({ sessionId: transport.sessionId }, 'MCP SSE session created');
    return RESPONSE_ALREADY_SENT;
  });

  app.post('/messages', async (c) => {
    const auth = await authenticateMcpRequest(c, authService);
    if (auth.response) return auth.response;

    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Missing sessionId query parameter' },
          id: null,
        },
        400,
      );
    }

    const session = sseSessions.get(sessionId);
    if (!session) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'SSE session not found' }, id: null },
        404,
      );
    }

    session.lastActivity = Date.now();

    const { incoming, outgoing } = c.env as HttpBindings;
    const body: unknown = await c.req.json();
    await session.transport.handlePostMessage(incoming, outgoing, body);

    return RESPONSE_ALREADY_SENT;
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
    for (const [sid, session] of sseSessions.entries()) {
      void session.transport.close();
      sseSessions.delete(sid);
    }
    log.info('MCP HTTP sessions cleanup completed');
  };

  return app as Hono & { cleanup: () => void };
}
