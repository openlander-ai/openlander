/**
 * Activity routes — v4 cross-actor audit timeline.
 *
 * Aggregates 3 data sources into the v4 ActivityEvent shape consumed by
 * Home / Activity / MCPServer pages:
 *
 *   - deploy_logs                 → deploy_completed | deploy_failed | deploy_cancelled
 *   - runtime_incidents           → service_crashed (active) | service_recovered (resolved)
 *   - active MCP session snapshot → mcp_connected (one event per active session)
 *
 * Notes on intentional gaps:
 *   - `deploy_started` is not emitted because deploy_logs only persists
 *     terminal status. Synthesizing a started-event from `created_at -
 *     duration_ms` would double the event count for marginal value.
 *   - `config_changed` has no persistence layer today. Skipped — UI handles
 *     missing kinds gracefully.
 *   - `mcp_disconnected` is not emitted because we don't persist disconnect
 *     events; only currently-active sessions are visible via the snapshot.
 *
 * Replaces the previous orphan /api/activity (DB-backed activity_log feed)
 * which had no UI consumer in the v4 IA.
 */
import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { getMcpSessionsSnapshot } from '../../mcp/server.js';
import type { Actor, ActivityKind, V4ActivityEvent } from '../../types/v4-activity.js';

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

function parseTimestamp(value: string | number | null): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // SQLite's CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" (UTC, no offset).
  // Node's Date.parse interprets that as LOCAL time, which silently breaks
  // relative-time and sort order on non-UTC hosts. Detect the
  // no-timezone-suffix shape and append `Z` so it parses as UTC.
  const trimmed = value.trim();
  const hasTimezone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(trimmed);
  const normalized = hasTimezone
    ? trimmed
    : trimmed.includes('T')
      ? `${trimmed}Z`
      : `${trimmed.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

export function createActivityRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/activity', (c) => {
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '100', 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;
    const actorFilter = c.req.query('actor');
    const projectFilter = c.req.query('project');

    const now = Date.now();
    const events: V4ActivityEvent[] = [];

    // Project name lookup is shared across the 3 sources; populate once.
    const projects = ctx.db.listProjects();
    const projectNameById = new Map<string, string>();
    for (const p of projects) {
      projectNameById.set(p.id, p.name);
    }

    const projectScoped =
      projectFilter !== undefined && projectFilter !== '' && projectFilter !== 'all';

    // --- Source 1: deploy_logs ---
    // Cross-project recency query — iterating per-project with caps could
    // drop hot-project rows.
    const deployRows = ctx.db.listRecentDeployLogsAcrossProjects(limit * 3);
    for (const row of deployRows) {
      if (projectScoped && row.project_id !== projectFilter) continue;
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
        project: row.project_id,
        service: null,
        // Project name is intentionally omitted — ActivityRow renders the
        // project badge from `event.project`, so re-encoding it in the
        // title would duplicate.
        title: `${titleVerb}${titleSuffix}`,
        detail,
      });
    }

    // --- Source 2: runtime_incidents ---
    // listUnresolved is cheap (filtered by `resolved=0`); recent resolved
    // ones come from a dedicated cross-project query for symmetry.
    const unresolved = ctx.db.listUnresolvedRuntimeIncidents();
    for (const inc of unresolved) {
      if (projectScoped && inc.project_id !== projectFilter) continue;
      const ms = parseTimestamp(inc.created_at);
      if (ms == null) continue;
      const projectName = projectNameById.get(inc.project_id) ?? inc.project_id;
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
        project: inc.project_id,
        service: null,
        // Title leans on project badge in the UI; raw project name kept
        // out of the headline so the timeline stays uniform.
        title: 'Service crashed',
        detail: detailBits.length > 0 ? `${projectName} · ${detailBits.join(' · ')}` : projectName,
      });
    }

    const resolved = ctx.db.listRecentResolvedRuntimeIncidents(limit * 2);
    for (const inc of resolved) {
      if (projectScoped && inc.project_id !== projectFilter) continue;
      const ms = parseTimestamp(inc.resolved_at ?? inc.created_at);
      if (ms == null) continue;
      const { at, relTs } = relativeTime(ms, now);
      events.push({
        id: `recover-${inc.id}`,
        actor: 'system',
        kind: 'service_recovered',
        at,
        relTs,
        project: inc.project_id,
        service: null,
        title: 'Service recovered',
        detail: inc.category ? `from ${inc.category}` : undefined,
      });
    }

    // --- Source 3: active MCP sessions (synthesized as mcp_connected) ---
    // Only currently-connected sessions surface. Disconnect history is not
    // persisted today. Suppressed when the caller asks for a specific
    // project, since these events are system-level (project=null).
    if (!projectScoped) {
      const mcpSessions = getMcpSessionsSnapshot();
      for (const s of mcpSessions) {
        const { at, relTs } = relativeTime(s.connectedAt, now);
        events.push({
          id: `mcp-${s.id}`,
          actor: 'mcp',
          kind: 'mcp_connected',
          at,
          relTs,
          project: null,
          service: null,
          title: `MCP agent connected (${s.transport.toUpperCase()})`,
          detail: `session ${s.id.slice(0, 8)}`,
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
