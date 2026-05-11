/**
 * Domain routing API client (v0.1).
 *
 * Service-scoped CRUD against the manual-DNS + OpenLander-managed
 * Traefik route model. ACME / wildcard / DNS provider automation are
 * deferred to v0.2 per the locked v0.1 plan.
 *
 * Endpoints:
 *   - GET    /api/projects/:p/services/:s/domains
 *   - POST   /api/projects/:p/services/:s/domains
 *   - DELETE /api/projects/:p/services/:s/domains/:idOrDomain
 *
 * Backend error codes surfaced as `DomainApiError.code`:
 *   - DOMAIN_ROUTING_DISABLED    (409, explicit `proxy.mode = external`)
 *   - DOMAIN_ROUTE_EXISTS        (409, duplicate `(domain, path_prefix)`)
 *   - MISSING_FIELD              (400, required field missing)
 *   - INVALID_FIELD              (400, validation; message carries detail)
 *   - INVALID_SERVICE_KIND       (400, attached to non-deployable)
 *   - NOT_FOUND                  (404)
 *   - SERVICE_NOT_FOUND          (404, project-scoped, zero deployables)
 *   - SERVICE_SELECTION_REQUIRED (400, project-scoped, multiple deployables)
 *
 * v0.1 does NOT include `INVALID_HOST` / `INVALID_PATH` / `INVALID_PORT`
 * / `SERVICE_PORT_REQUIRED` — the frontend should validate format
 * client-side and fall back to `INVALID_FIELD` message for the rest.
 */
import { fetchWithAuth } from './auth.js';

export type DomainStatus = 'active' | 'pending' | 'error';
export type DomainTlsStatus = 'absent' | 'unknown';
export type DomainLegacyWarning = 'legacy_cloudflare_metadata_present' | null;

export interface DomainTlsInfo {
  enabled: boolean;
  resolver: string | null;
  status: DomainTlsStatus;
}

export interface DomainMapping {
  id: string;
  domain: string;
  /** Compatibility alias for `domain`. Same value, kept until v0.2. */
  hostname: string;
  serviceId: string;
  projectId?: string;
  status: DomainStatus;
  pathPrefix: string;
  stripPrefix: boolean;
  upstreamPathPrefix: string | null;
  targetPort: number | null;
  tls: DomainTlsInfo;
  legacyWarning: DomainLegacyWarning;
  createdAt: string;
  updatedAt: string | null;
}

export interface ServiceDomainsResponse {
  projectId: string;
  serviceId: string;
  count: number;
  domains: DomainMapping[];
}

export interface CreateDomainBody {
  domain: string;
  pathPrefix?: string;
  stripPrefix?: boolean;
  upstreamPathPrefix?: string | null;
  targetPort?: number | null;
}

export interface CreateDomainResponse {
  status: 'mapped';
  projectId: string;
  serviceId: string;
  domain: DomainMapping;
  totalDomains: number;
}

export interface DeleteDomainResponse {
  status: 'unmapped';
  projectId: string;
  serviceId: string;
  domain: DomainMapping;
  usedLegacyFallback: boolean;
  totalDomains: number;
}

export type DomainErrorCode =
  | 'DOMAIN_ROUTING_DISABLED'
  | 'DOMAIN_ROUTE_EXISTS'
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'INVALID_SERVICE_KIND'
  | 'NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'SERVICE_SELECTION_REQUIRED'
  | 'UNKNOWN';

export class DomainApiError extends Error {
  readonly code: DomainErrorCode | string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DomainApiError';
    this.code = code;
    this.status = status;
  }
}

async function raise(res: Response, fallback: string): Promise<never> {
  let payload: { error?: string; message?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // body wasn't JSON; fall back to plain text/HTTP semantics
  }
  throw new DomainApiError(payload.error ?? 'UNKNOWN', payload.message ?? fallback, res.status);
}

export async function getServiceDomains(
  projectId: string,
  serviceId: string,
): Promise<ServiceDomainsResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/services/${serviceId}/domains`);
  if (!res.ok) await raise(res, 'Failed to load domains');
  return (await res.json()) as ServiceDomainsResponse;
}

export async function createServiceDomain(
  projectId: string,
  serviceId: string,
  body: CreateDomainBody,
): Promise<CreateDomainResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/services/${serviceId}/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await raise(res, 'Failed to create domain');
  return (await res.json()) as CreateDomainResponse;
}

export async function deleteServiceDomain(
  projectId: string,
  serviceId: string,
  idOrDomain: string,
): Promise<DeleteDomainResponse> {
  const res = await fetchWithAuth(
    `/api/projects/${projectId}/services/${serviceId}/domains/${encodeURIComponent(idOrDomain)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) await raise(res, 'Failed to delete domain');
  return (await res.json()) as DeleteDomainResponse;
}

/**
 * Build a display URL for a domain mapping. v0.1 is HTTP-only; HTTPS
 * support arrives with the v0.2 ACME contract.
 */
export function buildDomainUrl(domain: DomainMapping): string {
  const path = domain.pathPrefix === '/' ? '' : domain.pathPrefix;
  return `http://${domain.domain}${path}`;
}
