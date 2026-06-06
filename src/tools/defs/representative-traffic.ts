import type { ToolContext } from './types.js';

type AppCtx = ToolContext['appCtx'];

export interface RepresentativeTrafficObservation {
  status: 'passed' | 'failed' | 'skipped';
  path: string;
  severity: 'ok' | 'warning' | 'fail';
  status_code?: number;
  attempts?: number;
  elapsed_ms?: number;
  message?: string;
}

export async function observeRepresentativeTraffic(
  appCtx: AppCtx,
  routeName: string,
  path = '/',
): Promise<RepresentativeTrafficObservation> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const configLike = appCtx.config as unknown;
  const traefikMode =
    typeof configLike === 'object' && configLike !== null && 'traefik' in configLike
      ? (configLike as { traefik?: { mode?: unknown } }).traefik?.mode
      : undefined;
  if (traefikMode !== 'managed') {
    return {
      status: 'skipped',
      path: normalizedPath,
      severity: 'warning',
      message: 'Representative traffic probe requires managed Traefik.',
    };
  }

  const result = await appCtx.pipeline.verifyManagedTraefikRoute({
    projectName: routeName,
    path: normalizedPath,
    probeTimeoutMs: 1_000,
    maxWaitMs: 2_500,
    intervalMs: 500,
    minimumSuccessAgeMs: 0,
  });

  if (result.ok) {
    return {
      status: 'passed',
      path: normalizedPath,
      severity: 'ok',
      status_code: result.status,
      attempts: result.attempts,
      elapsed_ms: result.elapsedMs,
    };
  }

  const statusCode = result.status;
  const isServerError = typeof statusCode === 'number' && statusCode >= 500;
  return {
    status: 'failed',
    path: normalizedPath,
    severity: isServerError ? 'fail' : 'warning',
    ...(statusCode ? { status_code: statusCode } : {}),
    attempts: result.attempts,
    elapsed_ms: result.elapsedMs,
    message: result.error,
  };
}

export function representativeTrafficFailed(
  value: RepresentativeTrafficObservation | null | undefined,
): boolean {
  return value?.status === 'failed' && value.severity === 'fail';
}

export function representativeTrafficWarning(
  value: RepresentativeTrafficObservation | null | undefined,
): string | undefined {
  if (!value || value.severity === 'ok') return undefined;
  return value.message ?? `Representative traffic probe ${value.status}`;
}

export function representativeTrafficToJson(value: RepresentativeTrafficObservation): string {
  return JSON.stringify(value);
}

export function parseRepresentativeTraffic(
  value: string | null | undefined,
): RepresentativeTrafficObservation | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const status = record['status'];
    const path = record['path'];
    const severity = record['severity'];
    if (
      (status !== 'passed' && status !== 'failed' && status !== 'skipped') ||
      typeof path !== 'string' ||
      (severity !== 'ok' && severity !== 'warning' && severity !== 'fail')
    ) {
      return null;
    }

    return {
      status,
      path,
      severity,
      ...(typeof record['status_code'] === 'number' ? { status_code: record['status_code'] } : {}),
      ...(typeof record['attempts'] === 'number' ? { attempts: record['attempts'] } : {}),
      ...(typeof record['elapsed_ms'] === 'number' ? { elapsed_ms: record['elapsed_ms'] } : {}),
      ...(typeof record['message'] === 'string' ? { message: record['message'] } : {}),
    };
  } catch {
    return null;
  }
}
