import type { EnvManager } from './env.js';
import { filterBuildTimeVars } from './build-args.js';

export interface ResolveEnvParams {
  projectId: string;
  serviceId?: string;
  environmentId?: string;
  inlineEnvVars?: Record<string, string>;
  autoEnvVars?: Record<string, string>;
  serviceEnvVars?: Record<string, string>;
}

/**
 * Resolves environment variables using explicit 7-layer precedence.
 *
 * Lowest to highest:
 * 1) autoEnvVars
 * 2) global secrets
 * 3) service env vars when serviceId is provided; otherwise group compatibility env vars
 * 4) production env vars (when environmentId is provided)
 * 5) target environment env vars (when environmentId is provided)
 * 6) serviceEnvVars
 * 7) inlineEnvVars
 */
export async function resolveEnvVars(
  params: ResolveEnvParams,
  deps: { env: EnvManager },
): Promise<Record<string, string>> {
  const autoEnvVars = params.autoEnvVars ?? {};
  const globalSecrets = await deps.env.getGlobalSecrets();
  const storedEnvVars = params.serviceId
    ? await deps.env.getAllForService(params.projectId, params.serviceId)
    : await deps.env.getAll(params.projectId);

  let productionEnvVars: Record<string, string> = {};
  let targetEnvironmentEnvVars: Record<string, string> = {};

  if (params.environmentId !== undefined) {
    const productionEnvironmentId = `${params.projectId}-production`;
    productionEnvVars = await deps.env.getAll(params.projectId, productionEnvironmentId);
    targetEnvironmentEnvVars = await deps.env.getAll(params.projectId, params.environmentId);
  }

  const serviceEnvVars = params.serviceEnvVars ?? {};
  const inlineEnvVars = params.inlineEnvVars ?? {};

  return {
    ...autoEnvVars,
    ...globalSecrets,
    ...storedEnvVars,
    ...productionEnvVars,
    ...targetEnvironmentEnvVars,
    ...serviceEnvVars,
    ...inlineEnvVars,
  };
}

/**
 * Resolves env vars, then keeps only build-time variables.
 */
export async function resolveEnvVarsForBuild(
  params: ResolveEnvParams,
  deps: { env: EnvManager },
): Promise<Record<string, string>> {
  return filterBuildTimeVars(await resolveEnvVars(params, deps));
}
