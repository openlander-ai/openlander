import type { AppContext } from '../../../app.js';
import type { ProjectRow } from '../../../db/types.js';
import { loadServiceView } from '../../../db/views/service-view.js';
import { TunnelStartError } from '../../../errors.js';

/**
 * Tagged outcome of a tunnel-expose attempt. The two routes that drive
 * the expose flow — project-compat `POST /projects/:id/expose` and
 * service-aux `POST /projects/:p/services/:s/expose` — used to inline
 * the same try / catch / port-fallback logic and emit identical Hono
 * responses for each outcome. Centralising the orchestration here lets
 * each caller stay focused on response shaping.
 *
 * Non-`TunnelStartError` exceptions are intentionally re-thrown so the
 * existing 500-level error handler upstream keeps surfacing pipeline
 * bugs (DB outages, missing routers, etc.).
 */
export type ExposeProjectTunnelOutcome =
  | { kind: 'exposed'; publicUrl: string }
  | { kind: 'not-running' }
  | { kind: 'tunnel-failed' };

/**
 * Resolve the project's exposable port (`deployable → project` fallback)
 * and request a public tunnel for it. Behaviour preserved from the
 * pre-R4 inline blocks:
 *
 * - When no port resolves, `not-running` short-circuits before any
 *   pipeline call (callers map this to 400 `NOT_RUNNING`).
 * - On `TunnelStartError`, `tunnel-failed` collapses the error (callers
 *   map this to 503 `TUNNEL_START_FAILED`).
 * - Any other error escapes — preserving the original `throw error`
 *   re-raise so the route's outer error handler still runs.
 */
export async function exposeProjectTunnel(
  ctx: Pick<AppContext, 'db' | 'pipeline'>,
  project: ProjectRow,
): Promise<ExposeProjectTunnelOutcome> {
  // v0.2 service-first read-model, slice S1.1: source the assigned port
  // from `ServiceView` instead of the inline `deployable?.X ?? project.X`
  // fallback. `view.assignedPort` collapses to `null` when neither row
  // resolves a port, so the `!exposePort` guard short-circuits to the
  // pre-S1 `not-running` outcome unchanged.
  const view = await loadServiceView(ctx.db, project);
  const exposePort = view.assignedPort;
  if (!exposePort) {
    return { kind: 'not-running' };
  }
  try {
    const publicUrl = await ctx.pipeline.exposeTunnel(project.id, exposePort);
    return { kind: 'exposed', publicUrl };
  } catch (error) {
    if (error instanceof TunnelStartError) {
      return { kind: 'tunnel-failed' };
    }
    throw error;
  }
}
