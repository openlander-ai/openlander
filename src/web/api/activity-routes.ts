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
  const ms = Date.parse(value);
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

    // --- Source 1: deploy_logs ---
    // The repo only exposes by-project queries today; iterate active projects
    // and merge. Capped at limit per project to bound work; outer slice
    // re-trims the merged set.
    const perProjectLimit = Math.max(20, Math.ceil(limit / Math.max(projects.length, 1)));
    for (const project of projects) {
      if (projectFilter && projectFilter !== 'all' && projectFilter !== project.id) continue;
      const rows = ctx.db.getDeployLogs(project.id, perProjectLimit);
      for (const row of rows) {
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
          project: project.id,
          service: null,
          title: `${titleVerb}${titleSuffix} · ${project.name}`,
          detail,
        });
      }
    }

    // --- Source 2: runtime_incidents ---
    // listUnresolved is cheap; resolved ones we surface via per-project fetch
    // capped to recent rows. Crashes generally outnumber recoveries so two
    // queries keep the merged list balanced.
    const unresolved = ctx.db.listUnresolvedRuntimeIncidents();
    for (const inc of unresolved) {
      const ms = parseTimestamp(inc.created_at);
      if (ms == null) continue;
      if (projectFilter && projectFilter !== 'all' && projectFilter !== inc.project_id) continue;
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
        title: `\`${projectName}\` crashed`,
        detail: detailBits.length > 0 ? detailBits.join(' · ') : undefined,
      });
    }

    // For resolved incidents, only fetch a small window per project.
    for (const project of projects) {
      if (projectFilter && projectFilter !== 'all' && projectFilter !== project.id) continue;
      const resolvedRows = ctx.db.listRuntimeIncidentsByProject(project.id, { resolved: true });
      const recentResolved = resolvedRows.slice(0, 10);
      for (const inc of recentResolved) {
        const ms = parseTimestamp(inc.resolved_at ?? inc.created_at);
        if (ms == null) continue;
        const { at, relTs } = relativeTime(ms, now);
        events.push({
          id: `recover-${inc.id}`,
          actor: 'system',
          kind: 'service_recovered',
          at,
          relTs,
          project: project.id,
          service: null,
          title: `\`${project.name}\` recovered`,
          detail: inc.category ? `from ${inc.category}` : undefined,
        });
      }
    }

    // --- Source 3: active MCP sessions (synthesized as mcp_connected) ---
    // Only currently-connected sessions surface. Disconnect history is not
    // persisted today.
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
