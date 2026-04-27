/**
 * Deploy log source helpers — Phase E_NEW Task 2.
 *
 * Extracted from the legacy timeline route file (deleted in Task 3) so
 * the new `deploy-log-stream-routes.ts` SSE endpoint can subscribe to
 * live build output without depending on the legacy project-keyed
 * timeline implementation.
 *
 * The helpers are intentionally agnostic to deployment-vs-project
 * keying: they work against `(projectId, deployId?)` so the new
 * deployment-keyed log stream can resolve a `:id` parameter to either a
 * `deploy_logs` row OR an in-flight project (when no row exists yet).
 */
import type { AppContext } from '../../app.js';
import type { DeployLogRow, ProjectRow } from '../../db/types.js';

/**
 * Resolve the SSE `:id` path param into a `(project, deployLog?)` pair.
 *
 * Order of resolution:
 *   1. Look up `:id` as a deploy log row id. If found, fetch the parent
 *      project and return both.
 *   2. Fall back to treating `:id` as a projectId (in-flight deploys
 *      where the deploy_logs row hasn't landed yet — typical during
 *      the first ~seconds of a fresh deploy).
 *
 * Returns `null` when neither resolution succeeds; callers should
 * surface a 404.
 */
export function resolveDeploymentLogSource(
  ctx: AppContext,
  id: string,
): { project: ProjectRow; deployLog: DeployLogRow | null } | null {
  const deployLog = ctx.db.getDeployLog(id) ?? null;
  if (deployLog) {
    const project = ctx.db.getProject(deployLog.project_id);
    if (!project) return null;
    return { project, deployLog };
  }

  // Fallback: in-flight deploy uses projectId until the post-mortem
  // deploy_logs row is created.
  const project = ctx.db.getProject(id);
  if (!project) return null;
  return { project, deployLog: null };
}

/**
 * Per-event payload for the SSE `event: line` channel. Mirrors the UI
 * hook's `SseLineEvent` shape (web/src/hooks/use-deploy-log-stream.ts).
 */
export interface DeployLogLineEvent {
  /** Deploy phase — clone/build/run/healthcheck/etc. */
  phase: string;
  /** Short prefix like `[build]` or `[clone]` for visual grouping. */
  prefix: string;
  /** The actual log line content. */
  payload: string;
}

/**
 * Per-event payload for the SSE terminal `event: end` channel. Mirrors
 * the UI hook's `SseEndEvent` shape.
 */
export interface DeployLogEndEvent {
  type: 'end';
  outcome: 'success' | 'fail' | 'cancelled';
  errorClass?: string;
}

/**
 * Convert a stored `build_log` text blob into discrete line events.
 *
 * The legacy build-log format is plain text, one line per output line.
 * We treat each non-empty line as a separate `line` event with phase
 * `'build'` and prefix `'build'`. The detailed phase/prefix taxonomy
 * lives in the live event handlers below; the historical replay path
 * uses the broad bucket so long-completed deploys still render.
 */
export function buildLogLinesFromBlob(buildLog: string | null): DeployLogLineEvent[] {
  if (!buildLog) return [];
  return buildLog
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map(
      (line): DeployLogLineEvent => ({
        phase: 'build',
        prefix: 'build',
        payload: line,
      }),
    );
}

/**
 * Project a `deploy_logs.status` value onto the SSE end event's
 * `outcome` field.
 */
export function deployStatusToOutcome(
  status: DeployLogRow['status'],
): DeployLogEndEvent['outcome'] {
  if (status === 'success') return 'success';
  if (status === 'cancelled') return 'cancelled';
  return 'fail';
}

/**
 * SSE frame builder — emits a single named event with optional id and
 * the JSON-encoded payload.
 *
 * Output shape (per the UI hook contract):
 *   event: line
 *   id: 17
 *   data: {"phase":"build","prefix":"build","payload":"..."}
 *
 *   event: end
 *   data: {"type":"end","outcome":"success"}
 */
export function formatSseFrame(eventName: string, payload: unknown, id?: number | string): string {
  const idLine = id !== undefined ? `id: ${String(id)}\n` : '';
  return `event: ${eventName}\n${idLine}data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Parse the `Last-Event-ID` SSE resume header. EventSource sends back
 * the most recent `id:` it observed; we use it to skip the first N
 * historical lines on replay so the client doesn't see duplicates after
 * a transport blip.
 */
export function parseLastEventId(headerValue: string | null | undefined): number {
  if (!headerValue) return 0;
  const parsed = Number.parseInt(headerValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
