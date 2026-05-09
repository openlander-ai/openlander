export type EnvVariablesParseResult =
  | { ok: true; variables: Record<string, string> }
  | { ok: false; error: 'MISSING_FIELD' | 'INVALID_FIELD'; message: string };

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ENV_KEY_PATTERN_DESCRIPTION = '[A-Za-z_][A-Za-z0-9_]*';

export function parseEnvVariables(raw: unknown): EnvVariablesParseResult {
  if (raw === undefined) {
    return { ok: false, error: 'MISSING_FIELD', message: 'variables object is required' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'INVALID_FIELD', message: 'variables must be an object' };
  }

  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: 'INVALID_FIELD',
        message: `variables keys must match ${ENV_KEY_PATTERN_DESCRIPTION}`,
      };
    }
    if (typeof value !== 'string') {
      return {
        ok: false,
        error: 'INVALID_FIELD',
        message: 'variables values must be strings',
      };
    }
    variables[key] = value;
  }
  return { ok: true, variables };
}
