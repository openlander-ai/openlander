import type { EnvironmentRow } from '../db/types.js';
import { EnvironmentNotFoundError, OpenLanderError } from '../errors.js';

export const ENVIRONMENT_KEYS = ['production', 'staging', 'development'] as const;
export type EnvironmentKey = (typeof ENVIRONMENT_KEYS)[number];

export type EnvironmentKeyParseResult =
  | { ok: true; environmentKey: EnvironmentKey }
  | { ok: false; error: 'MISSING_FIELD' | 'INVALID_FIELD'; message: string };

type EnvironmentLookup = {
  getEnvironmentsByProject(projectId: string): Promise<EnvironmentRow[]>;
};

const ENVIRONMENT_KEY_SET = new Set<string>(ENVIRONMENT_KEYS);

export function environmentKeyDescription(): string {
  return ENVIRONMENT_KEYS.join(', ');
}

export function parseEnvironmentKey(raw: unknown): EnvironmentKeyParseResult {
  if (raw === undefined) {
    return {
      ok: false,
      error: 'MISSING_FIELD',
      message: 'environment_key is required for environment-scoped env vars',
    };
  }

  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: 'INVALID_FIELD',
      message: `environment_key must be one of: ${environmentKeyDescription()}`,
    };
  }

  const normalized = raw.trim().toLowerCase();
  if (!ENVIRONMENT_KEY_SET.has(normalized)) {
    return {
      ok: false,
      error: 'INVALID_FIELD',
      message: `environment_key must be one of: ${environmentKeyDescription()}`,
    };
  }

  return { ok: true, environmentKey: normalized as EnvironmentKey };
}

export function parseEnvironmentKeyOrThrow(raw: unknown): EnvironmentKey {
  const parsed = parseEnvironmentKey(raw);
  if (parsed.ok) return parsed.environmentKey;

  throw new OpenLanderError(parsed.message, parsed.error, 400, {
    allowed: ENVIRONMENT_KEYS,
  });
}

export async function resolveEnvironmentByKey(
  db: EnvironmentLookup,
  projectId: string,
  environmentKey: EnvironmentKey,
): Promise<EnvironmentRow | undefined> {
  const environments = await db.getEnvironmentsByProject(projectId);
  return environments.find((environment) => environment.type === environmentKey);
}

export async function resolveEnvironmentByKeyOrThrow(
  db: EnvironmentLookup,
  projectId: string,
  environmentKey: EnvironmentKey,
): Promise<EnvironmentRow> {
  const environment = await resolveEnvironmentByKey(db, projectId, environmentKey);
  if (!environment) {
    throw new EnvironmentNotFoundError(`${projectId}:${environmentKey}`);
  }
  return environment;
}
