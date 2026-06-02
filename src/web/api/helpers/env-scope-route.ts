import type { AppContext } from '../../../app.js';
import type { EnvironmentRow } from '../../../db/types.js';
import {
  parseEnvironmentKey,
  resolveEnvironmentByKey,
  type EnvironmentKey,
} from '../../../pipeline/env-scope.js';

export type RouteEnvironmentResolution =
  | { ok: true; environmentKey: EnvironmentKey; environment: EnvironmentRow }
  | { ok: false; status: 400 | 404; error: string; message: string };

export async function resolveRouteEnvironmentByKey(
  ctx: Pick<AppContext, 'db'>,
  projectId: string,
  rawEnvironmentKey: unknown,
): Promise<RouteEnvironmentResolution> {
  const parsed = parseEnvironmentKey(rawEnvironmentKey);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error, message: parsed.message };
  }

  const environment = await resolveEnvironmentByKey(ctx.db, projectId, parsed.environmentKey);
  if (!environment) {
    return {
      ok: false,
      status: 404,
      error: 'ENVIRONMENT_NOT_FOUND',
      message: `${parsed.environmentKey} environment not found for project`,
    };
  }

  return { ok: true, environmentKey: parsed.environmentKey, environment };
}
