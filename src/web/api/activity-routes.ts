/**
 * Activity routes — v4 cross-actor audit timeline.
 *
 * Aggregates backend activity sources into the v4 ActivityEvent shape consumed by
 * Home / Activity / MCPServer pages:
 *
 *   - deploy_logs                 → deploy_completed | deploy_failed | deploy_cancelled
 *   - activity_log config rows    → config_changed
 *   - activity_log data rows      → data_access_read
 *   - runtime_incidents           → service_crashed (active) | service_recovered (resolved)
 *   - MCP session lifecycle       → mcp_connected | mcp_disconnected
 *
 * Notes on intentional gaps:
 *   - `deploy_started` is not emitted because deploy_logs only persists
 *     terminal status. Synthesizing a started-event from `created_at -
 *     duration_ms` would double the event count for marginal value.
 *   - `mcp_disconnected` is not emitted because we don't persist disconnect
 *     events; only currently-active sessions are visible via the snapshot.
 *
 * Post project/service split, deploy logs and runtime incidents are
 * service-scoped. This route maps service_id back to the owning project group
 * so dashboard rows still deep-link through project context.
 */
import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { getMcpSessionsSnapshot } from '../../mcp/server.js';
import type {
  Actor,
  ActivityKind,
  DataAccessActivitySummary,
  V4ActivityEvent,
} from '../../types/v4-activity.js';

function relativeTime(ts: number, now: number): { at: string; relTs: number } {
  const diffMs = Math.max(0, now - ts);
  const relTs = Math.floor(diffMs / 1000);
  if (relTs < 60) return { at: 'Just now', relTs };
  const m = Math.floor(relTs / 60);
  if (m < 60) return { at: `${String(m)}m ago`, relTs };
  const h = Math.floor(m / 60);
  if (h < 24) return { at: `${String(h)}h ago`, relTs };
  return { at: `${String(Math.floor(h / 24))}d ago`, relTs };
}

function deployActor(trigger: 'chat' | 'webhook' | 'api'): Actor {
  if (trigger === 'webhook') return 'webhook';
  if (trigger === 'chat') return 'mcp';
  return 'human';
}

function deployKindFromStatus(status: 'success' | 'failed' | 'cancelled'): ActivityKind {
  if (status === 'success') return 'deploy_completed';
  if (status === 'failed') return 'deploy_failed';
  return 'deploy_cancelled';
}

function shortSha(sha: string | null): string {
  if (!sha) return '';
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}

/**
 * Parse the heterogeneous timestamp shapes that reach the activity feed.
 *
 * Postgres `now()::text` (the default on every audit table) emits values
 * like `2026-05-15 04:23:11.123456+00` — a SPACE-separated body and a
 * 2-digit timezone offset. Node/V8 `Date.parse` does not accept either,
 * so the prior implementation silently dropped every deploy_log row and
 * the activity / Deployments view came up empty.
 *
 * The fix normalizes three things before handing to `Date.parse`:
 *   - replace the space with `T` so the body parses as ISO 8601
 *   - expand a 2-digit offset (`+00`) to the 4-digit form `+00:00`
 *   - keep `Z` and `±HH:MM` / `±HHMM` offsets untouched
 *   - append `Z` only when no offset is present at all (legacy rows)
 */
export function parseTimestamp(value: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let body = trimmed;
  let suffix = 'Z';

  if (/[Zz]$/.test(trimmed)) {
    suffix = trimmed.slice(-1);
    body = trimmed.slice(0, -1);
  } else {
    const tzMatch = /([+-])(\d{2})(?::?(\d{2}))?$/.exec(trimmed);
    if (tzMatch) {
      const sign = tzMatch[1] ?? '+';
      const hh = tzMatch[2] ?? '00';
      const mm = tzMatch[3] ?? '00';
      suffix = `${sign}${hh}:${mm}`;
      body = trimmed.slice(0, tzMatch.index);
    }
  }

  const withT = body.includes('T') ? body : body.replace(' ', 'T');
  const ms = Date.parse(`${withT}${suffix}`);
  return Number.isNaN(ms) ? null : ms;
}

interface ServiceActivityRef {
  projectId: string;
  serviceId: string;
  serviceName: string;
}

function legacyProjectIdFromServiceId(serviceId: string): string {
  return serviceId.endsWith('__svc') ? serviceId.slice(0, -'__svc'.length) : serviceId;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function actorFromActivityLog(metadata: Record<string, unknown>, eventType: string): Actor {
  const actor = metadata['actor'];
  if (actor === 'mcp' || actor === 'human' || actor === 'webhook' || actor === 'system') {
    return actor;
  }
  if (eventType.startsWith('webhook:')) return 'webhook';
  if (eventType.startsWith('env:')) return 'mcp';
  if (eventType.startsWith('data_access:')) return 'mcp';
  return 'system';
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function redactDataAccessPreview(value: string): string {
  return value
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, '$[redacted]$')
    .replace(/\$\$[\s\S]*?\$\$/g, '$$[redacted]$$')
    .replace(/'(?:''|[^'])*'/g, "'[redacted]'")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-token]')
    .replace(
      /\b(?:sk|pk|rk|ghp|gho|ghu|pat|xox[baprs]?)[_-][A-Za-z0-9_-]{8,}\b/gi,
      '[redacted-token]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted-token]')
    .replace(/\b\d+(?:\.\d+)?\b/g, '[number]')
    .slice(0, 180);
}

function dataAccessSummary(metadata: Record<string, unknown>): DataAccessActivitySummary {
  const preview = metadataString(metadata, 'preview');
  return {
    operation: metadataString(metadata, 'operation') ?? 'read',
    sourceKind: metadataString(metadata, 'kind'),
    rowCount: metadataNumber(metadata, 'row_count'),
    durationMs: metadataNumber(metadata, 'duration_ms'),
    truncated: metadata['truncated'] === true,
    preview: preview ? redactDataAccessPreview(preview) : undefined,
    queryHash: metadataString(metadata, 'query_hash'),
  };
}

function dataAccessDetail(
  rowDescription: string | null,
  summary: DataAccessActivitySummary,
): string {
  return rowDescription ?? `${summary.operation} read`;
}

export function createActivityRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/activity', async (c) => {
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
    const actorFilter = c.req.query('actor');
    const projectFilter = c.req.query('project');

    const now = Date.now();
    const events: V4ActivityEvent[] = [];

    // Project/service lookup is shared across sources; populate once.
    const projects = await ctx.db.listProjects();
    const projectNameById = new Map<string, string>();
    for (const p of projects) {
      projectNameById.set(p.id, p.name);
    }
    const services = typeof ctx.db.getServices === 'function' ? await ctx.db.getServices() : [];
    const serviceById = new Map<string, ServiceActivityRef>();
    for (const svc of services) {
      serviceById.set(svc.id, {
        projectId: svc.project_id,
        serviceId: svc.id,
        serviceName: svc.name,
      });
    }

    const resolveService = (serviceId: string): ServiceActivityRef => {
      return (
        serviceById.get(serviceId) ?? {
          projectId: legacyProjectIdFromServiceId(serviceId),
          serviceId,
          serviceName: serviceId,
        }
      );
    };

    const projectScoped =
      projectFilter !== undefined && projectFilter !== '' && projectFilter !== 'all';

    // --- Source 1: deploy_logs ---
    // Cross-project recency query — iterating per-project with caps could
    // drop hot-project rows.
    const deployRows = await ctx.db.listRecentDeployLogsAcrossProjects(limit * 3);
    for (const row of deployRows) {
      const serviceRef = resolveService(row.service_id);
      if (projectScoped && serviceRef.projectId !== projectFilter) continue;
      const ms = parseTimestamp(row.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      const sha = shortSha(row.commit_sha);
      const kind = deployKindFromStatus(row.status);
      const actor = deployActor(row.trigger);
      const titleVerb =
        kind === 'deploy_completed'
          ? 'Deploy succeeded'
          : kind === 'deploy_failed'
            ? 'Deploy failed'
            : 'Deploy cancelled';
      const titleSuffix = sha ? ` · ${sha}` : '';
      const detail = row.commit_message
        ? row.commit_message.split('\n')[0]?.slice(0, 120)
        : (row.trigger_detail ?? undefined);
      events.push({
        id: `deploy-${row.id}`,
        actor,
        kind,
        at,
        relTs,
        project: serviceRef.projectId,
        service: serviceRef.serviceId,
        projectName: projectNameById.get(serviceRef.projectId) ?? null,
        serviceName: serviceRef.serviceName,
        title: `${titleVerb}${titleSuffix}`,
        detail,
      });
    }

    // --- Source 2: activity_log config rows ---
    // Environment/config MCP operations land in activity_log, not deploy_logs.
    // Pull only config rows here to avoid duplicating incident/recovery events
    // that have dedicated sources below.
    const activityRows = await ctx.db.findActivityLogRecent(limit * 3, {
      activity_type: 'config',
    });
    for (const row of activityRows) {
      const serviceRef = serviceById.get(row.project_id);
      const projectId = serviceRef?.projectId ?? row.project_id;
      if (projectScoped && projectId !== projectFilter) continue;
      const ms = parseTimestamp(row.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      const metadata = parseMetadata(row.metadata);
      const actor = actorFromActivityLog(metadata, row.event_type);
      events.push({
        id: `activity-${row.id}`,
        actor,
        kind: 'config_changed',
        at,
        relTs,
        project: projectId,
        service: serviceRef?.serviceId ?? null,
        projectName: projectNameById.get(projectId) ?? null,
        serviceName: serviceRef?.serviceName ?? null,
        title: row.title,
        detail: row.description,
        detailCode: 'config_changed',
        detailParams: {},
      });
    }

    // --- Source 2b: activity_log data-access rows ---
    // Data Inspector writes audit rows into activity_log with result values omitted.
    const dataAccessRows = await ctx.db.findActivityLogRecent(limit * 3, {
      activity_type: 'data_access',
    });
    for (const row of dataAccessRows) {
      const metadata = parseMetadata(row.metadata);
      const serviceId = typeof metadata['service_id'] === 'string' ? metadata['service_id'] : null;
      const serviceRef = serviceId ? serviceById.get(serviceId) : undefined;
      const projectId = serviceRef?.projectId ?? row.project_id;
      if (projectScoped && projectId !== projectFilter) continue;
      const ms = parseTimestamp(row.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      const actor = actorFromActivityLog(metadata, row.event_type);
      const dataAccess = dataAccessSummary(metadata);
      events.push({
        id: `activity-${row.id}`,
        actor,
        kind: 'data_access_read',
        at,
        relTs,
        project: projectId,
        service: serviceRef?.serviceId ?? null,
        projectName: projectNameById.get(projectId) ?? null,
        serviceName: serviceRef?.serviceName ?? null,
        title: `Data source read · ${dataAccess.operation}`,
        detail: dataAccessDetail(row.description, dataAccess),
        detailCode: 'data_access_read',
        detailParams: {},
        dataAccess,
      });
    }

    // --- Source 3: runtime_incidents ---
    // listUnresolved is cheap (filtered by `resolved=0`); recent resolved
    // ones come from a dedicated cross-project query for symmetry.
    const unresolved = await ctx.db.listUnresolvedRuntimeIncidents();
    for (const inc of unresolved) {
      const serviceRef = resolveService(inc.service_id);
      if (projectScoped && serviceRef.projectId !== projectFilter) continue;
      const ms = parseTimestamp(inc.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      const detailBits: string[] = [];
      if (inc.exit_code != null) detailBits.push(`exit ${String(inc.exit_code)}`);
      if (inc.category) detailBits.push(inc.category);
      if (inc.restart_count != null && inc.restart_count > 0) {
        detailBits.push(`restart ×${String(inc.restart_count)}`);
      }
      events.push({
        id: `crash-${inc.id}`,
        actor: 'system',
        kind: 'service_crashed',
        at,
        relTs,
        project: serviceRef.projectId,
        service: serviceRef.serviceId,
        projectName: projectNameById.get(serviceRef.projectId) ?? null,
        serviceName: serviceRef.serviceName,
        // Title leans on project badge in the UI; raw project name kept
        // out of the headline so the timeline stays uniform.
        title: 'Service crashed',
        detail: detailBits.length > 0 ? detailBits.join(' · ') : undefined,
        detailCode: 'service_crashed',
        detailParams: {
          exitCode: inc.exit_code ?? '—',
          restartCount: inc.restart_count ?? 0,
        },
      });
    }

    const resolved = await ctx.db.listRecentResolvedRuntimeIncidents(limit * 2);
    for (const inc of resolved) {
      const serviceRef = resolveService(inc.service_id);
      if (projectScoped && serviceRef.projectId !== projectFilter) continue;
      const ms = parseTimestamp(inc.resolved_at ?? inc.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      events.push({
        id: `recover-${inc.id}`,
        actor: 'system',
        kind: 'service_recovered',
        at,
        relTs,
        project: serviceRef.projectId,
        service: serviceRef.serviceId,
        title: 'Service recovered',
        detail: inc.category ? `from ${inc.category}` : undefined,
        detailCode: 'service_recovered',
        detailParams: {},
      });
    }

    // --- Source 4: MCP session lifecycle ---
    // Live sessions → mcp_connected (from in-memory snapshot).
    // Closed sessions → mcp_disconnected (from mcp_session_log table, ralplan
    // Phase 1 step 1). Both are suppressed when the caller asks for a specific
    // project, since these events are system-level (project=null).
    if (!projectScoped) {
      const mcpSessions = getMcpSessionsSnapshot();
      for (const s of mcpSessions) {
        const { at, relTs } = relativeTime(s.connectedAt, now);
        // Prefer the captured clientInfo.name (with version when present)
        // so the activity feed reads "Claude Code v0.5.21 connected" rather
        // than the opaque transport tag. Falls back to the legacy
        // "MCP agent connected (HTTP)" form for sessions that landed before
        // initialize completed or for clients that don't send clientInfo.
        const identity = s.clientName
          ? s.clientVersion
            ? `${s.clientName} v${s.clientVersion}`
            : s.clientName
          : `MCP agent (${s.transport.toUpperCase()})`;
        events.push({
          id: `mcp-${s.id}`,
          actor: 'mcp',
          kind: 'mcp_connected',
          at,
          relTs,
          project: null,
          service: null,
          title: `${identity} connected`,
          detail: `session ${s.id.slice(0, 8)} · ${s.transport.toUpperCase()}`,
          detailCode: 'mcp_connected',
          detailParams: {
            session: s.id.slice(0, 8),
            transport: s.transport.toUpperCase(),
          },
        });
      }

      const closedSessions = await ctx.db.listRecentClosedMcpSessions(50);
      for (const s of closedSessions) {
        const ms = s.disconnected_at;
        if (!Number.isFinite(ms)) continue;
        const { at, relTs } = relativeTime(ms, now);
        const durationSec = Math.max(0, Math.floor((s.disconnected_at - s.connected_at) / 1000));
        // mcp_session_log.client_info is the formatted "Name vX.Y.Z" string
        // captured at close time. Older rows pre-dating clientInfo
        // persistence stay null and fall back to the legacy title shape.
        const identity = s.client_info ?? `MCP agent (${s.transport.toUpperCase()})`;
        events.push({
          id: `mcp-close-${s.id}`,
          actor: 'mcp',
          kind: 'mcp_disconnected',
          at,
          relTs,
          project: null,
          service: null,
          title: `${identity} disconnected`,
          detail: `session ${s.session_id.slice(0, 8)} · ${s.transport.toUpperCase()} · lasted ${String(durationSec)}s`,
          detailCode: 'mcp_disconnected',
          detailParams: {
            session: s.session_id.slice(0, 8),
            transport: s.transport.toUpperCase(),
            duration: durationSec,
          },
        });
      }
    }

    // --- Merge sort + actor filter + slice ---
    events.sort((a, b) => a.relTs - b.relTs);
    let filtered = events;
    if (actorFilter && actorFilter !== 'all') {
      filtered = filtered.filter((e) => e.actor === actorFilter);
    }
    const sliced = filtered.slice(0, limit);

    return c.json({ activities: sliced });
  });

  return api;
}
