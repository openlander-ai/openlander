import type { DomainMappingRow, ServiceRow } from '../db/types.js';
import { getDeployableServiceRouteName } from '../pipeline/traefik.js';
import type { ToolContext } from './defs/types.js';

type AppCtx = ToolContext['appCtx'];

export type RouteHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';

export interface ManagedRouteProbe {
  status: 'passed' | 'failed' | 'skipped';
  severity: 'ok' | 'warning' | 'fail';
  provider: 'traefik_http';
  scope: 'traefik_direct';
  host: string;
  path: string;
  http_status?: number;
  attempts?: number;
  elapsed_ms?: number;
  message?: string;
}

export interface DomainRouteHealth {
  domain: string;
  path_prefix: string;
  mapping_status: DomainMappingRow['status'];
  direct_probe?: ManagedRouteProbe;
}

function normalizeProbePath(path: string | null | undefined): string {
  const trimmed = path?.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function summarizeRouteHealth(params: {
  service: Pick<ServiceRow, 'status'>;
  domainRoutes?: readonly DomainRouteHealth[];
}): { status: RouteHealthStatus; summary: string; custom_domain_count: number } {
  const domainRoutes = params.domainRoutes ?? [];
  if (params.service.status !== 'running') {
    return {
      status: 'warning',
      summary: `Application status is ${params.service.status ?? 'unknown'}.`,
      custom_domain_count: domainRoutes.length,
    };
  }

  if (domainRoutes.some((route) => route.mapping_status === 'error')) {
    return {
      status: 'error',
      summary: 'One or more custom domain mappings are marked error.',
      custom_domain_count: domainRoutes.length,
    };
  }

  if (domainRoutes.some((route) => route.direct_probe?.severity === 'fail')) {
    return {
      status: 'error',
      summary: 'One or more custom domain routes failed a direct Traefik probe.',
      custom_domain_count: domainRoutes.length,
    };
  }

  if (
    domainRoutes.some(
      (route) => route.mapping_status === 'pending' || route.direct_probe?.severity === 'warning',
    )
  ) {
    return {
      status: 'warning',
      summary: 'One or more custom domain routes need verification.',
      custom_domain_count: domainRoutes.length,
    };
  }

  if (domainRoutes.length > 0) {
    return {
      status: 'healthy',
      summary: 'Registered custom domain routes have no known issues.',
      custom_domain_count: domainRoutes.length,
    };
  }

  return {
    status: 'unknown',
    summary: 'No custom domain routes are registered.',
    custom_domain_count: 0,
  };
}

export async function probeManagedDomainRoute(
  appCtx: AppCtx,
  params: {
    service: Pick<ServiceRow, 'name'>;
    domain: string;
    pathPrefix?: string | null;
  },
): Promise<ManagedRouteProbe> {
  const path = normalizeProbePath(params.pathPrefix);
  if (appCtx.config.traefik.mode !== 'managed') {
    return {
      status: 'skipped',
      severity: 'warning',
      provider: 'traefik_http',
      scope: 'traefik_direct',
      host: params.domain,
      path,
      message: 'Managed Traefik route probe requires traefik.mode=managed.',
    };
  }

  const result = await appCtx.pipeline.verifyManagedTraefikRoute({
    projectName: getDeployableServiceRouteName(params.service),
    host: params.domain,
    path,
    probeTimeoutMs: 1_000,
    maxWaitMs: 2_500,
    intervalMs: 500,
    minimumSuccessAgeMs: 0,
  });

  if (result.ok) {
    return {
      status: 'passed',
      severity: 'ok',
      provider: 'traefik_http',
      scope: 'traefik_direct',
      host: params.domain,
      path,
      http_status: result.status,
      attempts: result.attempts,
      elapsed_ms: result.elapsedMs,
    };
  }

  const statusCode = result.status;
  const severity = typeof statusCode === 'number' && statusCode < 500 ? 'warning' : 'fail';
  return {
    status: 'failed',
    severity,
    provider: 'traefik_http',
    scope: 'traefik_direct',
    host: params.domain,
    path,
    ...(typeof statusCode === 'number' ? { http_status: statusCode } : {}),
    attempts: result.attempts,
    elapsed_ms: result.elapsedMs,
    message: result.error,
  };
}

export async function buildDomainRouteHealth(
  appCtx: AppCtx,
  service: Pick<ServiceRow, 'name'>,
  mappings: readonly DomainMappingRow[],
  options: { verify?: boolean } = {},
): Promise<DomainRouteHealth[]> {
  return await Promise.all(
    mappings.map(async (mapping) => ({
      domain: mapping.domain,
      path_prefix: mapping.path_prefix,
      mapping_status: mapping.status,
      ...(options.verify
        ? {
            direct_probe: await probeManagedDomainRoute(appCtx, {
              service,
              domain: mapping.domain,
              pathPrefix: mapping.path_prefix,
            }),
          }
        : {}),
    })),
  );
}

export function worstRouteHealthStatus(
  values: readonly RouteHealthStatus[],
): RouteHealthStatus | undefined {
  if (values.includes('error')) return 'error';
  if (values.includes('warning')) return 'warning';
  if (values.includes('healthy')) return 'healthy';
  if (values.includes('unknown')) return 'unknown';
  return undefined;
}

export function routeProbeShouldRollback(probe: ManagedRouteProbe): boolean {
  return probe.severity === 'fail';
}
