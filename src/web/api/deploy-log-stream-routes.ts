/**
 * Deploy log SSE endpoint — Phase E_NEW Task 2.
 *
 * Single SSE channel going forward (iteration-5 single-SSE consolidation
 * — see ADR-1.1 (revised) in `.omc/plans/ralplan-v4-sprint.md`). The
 * legacy project-keyed timeline route was deleted in Task 3; v4
 * consumes only `line` + `end` events here.
 *
 * Wire shape (matches `web/src/hooks/use-deploy-log-stream.ts` exactly):
 *
 *   event: line
 *   id: <line-num>
 *   data: {"phase":"...","prefix":"...","payload":"..."}
 *
 *   event: end
 *   data: {"type":"end","outcome":"success"|"fail"|"cancelled","errorClass":"..."}
 *
 * `:id` resolution (via `resolveDeploymentLogSource`):
 *   - Try `deploy_logs.id` first (post-mortem rows).
 *   - Fall back to project id for in-flight deploys (the deploy_logs
 *     row is created at deploy completion, so a freshly started deploy
 *     has no row yet).
 *
 * `Last-Event-ID` resume:
 *   The UI's `useDeployLogStream` hook captures `lastEventId`. On
 *   reconnect (EventSource auto-reconnect), the browser sends back
 *   `Last-Event-ID: <last-line-num>`; we skip the first N historical
 *   lines on replay so the client doesn't see duplicates.
 */
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import { eventBus } from '../../events/index.js';
import {
  buildLogLinesFromBlob,
  deployStatusToOutcome,
  formatSseFrame,
  parseLastEventId,
  resolveDeploymentLogSource,
  type DeployLogEndEvent,
  type DeployLogLineEvent,
} from './deploy-log-source.js';

export function registerDeployLogStreamRoutes(api: Hono, ctx: AppContext): void {
  api.get('/deployments/:id/log/stream', (c) => {
    const id = c.req.param('id');
    const resolved = resolveDeploymentLogSource(ctx, id);
    if (!resolved) {
      return c.json({ error: 'NOT_FOUND', message: 'Deployment not found' }, 404);
    }

    const { project, deployLog } = resolved;
    const lastEventId = parseLastEventId(c.req.header('Last-Event-ID'));

    return stream(c, async (s) => {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache, no-transform');
      c.header('Connection', 'keep-alive');
      c.header('X-Accel-Buffering', 'no');

      let lineCounter = 0;
      let terminated = false;
      const unsubscribers: Array<() => void> = [];

      const emitLine = async (event: DeployLogLineEvent): Promise<void> => {
        if (terminated) return;
        lineCounter += 1;
        if (lineCounter <= lastEventId) {
          // Resume path: skip lines the client has already seen.
          return;
        }
        await s.write(formatSseFrame('line', event, lineCounter));
      };

      const emitEnd = async (event: DeployLogEndEvent): Promise<void> => {
        if (terminated) return;
        terminated = true;
        await s.write(formatSseFrame('end', event));
        for (const unsub of unsubscribers) unsub();
        await s.close();
      };

      // 1. Replay any persisted build_log content first so the client
      //    sees historical context before live tail. Honours
      //    Last-Event-ID by counting through the same line counter.
      if (deployLog?.build_log) {
        for (const line of buildLogLinesFromBlob(deployLog.build_log)) {
          await emitLine(line);
        }
      }

      // 2. If the deployment has a terminal `deploy_logs` row,
      //    `:id` resolved to a completed deploy — emit the terminal
      //    end event from the persisted status and close. No live
      //    subscription needed; the deploy has already finished.
      if (deployLog) {
        await emitEnd({
          type: 'end',
          outcome: deployStatusToOutcome(deployLog.status),
        });
        return;
      }

      // 3. In-flight deploy: subscribe to project-keyed events and
      //    forward as line/end frames. Each handler captures the
      //    project id so cross-project events are dropped.
      unsubscribers.push(
        eventBus.on('build:output', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitLine({
            phase: payload.phase ?? 'build',
            prefix: payload.scope ?? 'build',
            payload: payload.logChunk ?? payload.line,
          });
        }),
      );

      // Surface high-level lifecycle events as log lines so the user
      // sees clone/build/run banners even when the underlying tooling
      // doesn't emit a `build:output` event for them.
      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitLine({
            phase: 'clone',
            prefix: 'clone',
            payload: payload.message ?? `Cloning repository (${payload.commitSha.slice(0, 7)})`,
          });
        }),
      );
      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitLine({
            phase: 'build',
            prefix: 'build',
            payload:
              payload.message ?? `Built image (${String(Math.round(payload.durationMs / 1000))}s)`,
          });
        }),
      );
      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitLine({
            phase: 'container_start',
            prefix: 'run',
            payload: payload.message ?? `Started container on port ${String(payload.port)}`,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitEnd({ type: 'end', outcome: 'success' });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          const end: DeployLogEndEvent = { type: 'end', outcome: 'fail' };
          if (payload.errorClass) end.errorClass = payload.errorClass;
          void emitEnd(end);
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:up', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitEnd({ type: 'end', outcome: 'success' });
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          void emitEnd({ type: 'end', outcome: 'fail' });
        }),
      );

      // Hard timeout: 30m. Beyond that the deploy is presumed dead and
      // we close the stream with a `cancelled` outcome rather than
      // leaving the client hanging forever.
      const timeoutMs = 30 * 60 * 1000;
      const timeoutHandle = setTimeout(() => {
        void emitEnd({ type: 'end', outcome: 'cancelled' });
      }, timeoutMs);

      s.onAbort(() => {
        terminated = true;
        clearTimeout(timeoutHandle);
        for (const unsub of unsubscribers) unsub();
      });

      // Keep the stream open until aborted or terminated. Hono's stream
      // helper requires an awaiting promise to keep the response alive.
      await new Promise<void>((resolve) => {
        s.onAbort(() => {
          resolve();
        });
      });
    });
  });
}
