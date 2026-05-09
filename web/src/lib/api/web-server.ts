/**
 * Web Server (read-only) API client.
 *
 * Wraps the four read-model endpoints PR #209 added:
 *   - GET /api/web-server/summary
 *   - GET /api/web-server/routes
 *   - GET /api/web-server/ports
 *   - GET /api/web-server/external-containers
 *
 * The page surface is intentionally read-only in v0.1 — there are no
 * write helpers here. Route editing ships in v0.2 per
 * `notes/v0.1-spec.md` §Web Server.
 */
import { apiGet } from './client';

export type WebRouteStatus = 'healthy' | 'warning' | 'error' | 'inactive';
export type WebRouteSource = 'sslip' | 'domain' | 'quick_share';
export type WebRouteTlsStatus = 'ok' | 'expiring' | 'invalid' | 'absent' | 'unknown';

export interface WebRouteIssue {
  code:
    | 'service_not_running'
    | 'container_not_running'
    | 'missing_assigned_port'
    | 'missing_container_port'
    | 'domain_pending'
    | 'domain_error';
  message: string;
}

export interface WebServerRoute {
  id: string;
  source: WebRouteSource;
  host: string;
  entryPoints: string[];
  serviceId: string;
  serviceName: string;
  projectId: string;
  projectName: string;
  port: number | null;
  containerPort: number | null;
  containerName: string | null;
  tls: { enabled: boolean; status: WebRouteTlsStatus };
  status: WebRouteStatus;
  issues: WebRouteIssue[];
}

export type ProxyType = 'traefik' | 'nginx' | 'caddy' | 'haproxy' | 'none';

export type ProxyStatusCode =
  | 'docker_unavailable'
  | 'no_proxy_managed'
  | 'no_proxy_external'
  | 'traefik_managed'
  | 'traefik_external'
  | 'traefik_provider_disabled'
  | 'unsupported_proxy';

export type ProxyStatusSeverity = 'ok' | 'warning' | 'error';

export interface ProxySummary {
  type: ProxyType;
  /**
   * Legacy free-form human-readable status string. Older OpenLander
   * builds (≤ 0.1 pre-#242) only emitted this; the frontend renders
   * it verbatim as a fallback when `statusCode` is missing.
   *
   * Examples:
   *   "Traefik v3.0.4 (traefik) [managed mode]"
   *   "No reverse proxy detected (OpenLander will start Traefik)"
   *   "Nginx v1.27.0 (proxy-nginx) (not integrated)"
   */
  status: string;
  /**
   * Structured status enum from backend PR #242. Optional so the
   * frontend can talk to a stale older backend during a rolling
   * upgrade and still render *something*. New consumers should
   * prefer this over `status` for localization and pip-color
   * derivation.
   */
  statusCode?: ProxyStatusCode;
  /**
   * Severity hint for the pip color. Optional alongside
   * `statusCode`. New consumers should prefer this over
   * re-deriving from `proxy.type` + `traefikDockerProvider`.
   */
  statusSeverity?: ProxyStatusSeverity;
  mode: 'managed' | 'external';
  container: string | null;
  version: string | null;
  ports: number[];
  /** Backend `boolean | null`. Only meaningful when type === 'traefik'. */
  traefikDockerProvider: boolean | null;
}

export interface Entrypoint {
  name: string;
  port: number;
  protocol: 'http' | 'https';
}

export interface WebServerSummary {
  proxy: ProxySummary;
  routes: { total: number; healthy: number; issues: number };
  entrypoints: Entrypoint[];
  // Null until OpenLander records reload events. Render as a dash, not "now".
  lastReloadAt: string | null;
  containers: { total: number; managed: number; external: number };
  dockerUnavailable: boolean;
}

export interface WebServerRoutesResponse {
  count: number;
  issueCount: number;
  dockerUnavailable: boolean;
  routes: WebServerRoute[];
}

export type PortEnvironment = 'production' | 'development' | 'outside';

export interface PortAllocation {
  port: number;
  environment: PortEnvironment;
  source: 'service' | 'docker' | 'both';
  serviceId: string | null;
  serviceName: string | null;
  projectId: string | null;
  projectName: string | null;
  containerId: string | null;
  containerName: string | null;
  external: boolean;
}

export interface PortRange {
  portRangeStart: number;
  portRangeEnd: number;
}

export interface WebServerPortsResponse {
  ranges: { production: PortRange; development: PortRange };
  summary: {
    total: number;
    byEnvironment: { production: number; development: number; outside: number };
    [k: string]: unknown;
  };
  dockerUnavailable: boolean;
  allocations: PortAllocation[];
}

export interface ExternalContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: number[];
  rangeConflicts: { port: number; environment: PortEnvironment }[];
  composeProject: string | null;
  created: number | null;
}

export interface WebServerExternalContainersResponse {
  count: number;
  dockerUnavailable: boolean;
  containers: ExternalContainer[];
}

export async function getWebServerSummary(): Promise<WebServerSummary> {
  return apiGet<WebServerSummary>('/api/web-server/summary');
}

export async function getWebServerRoutes(): Promise<WebServerRoutesResponse> {
  return apiGet<WebServerRoutesResponse>('/api/web-server/routes');
}

export async function getWebServerPorts(): Promise<WebServerPortsResponse> {
  return apiGet<WebServerPortsResponse>('/api/web-server/ports');
}

export async function getWebServerExternalContainers(): Promise<WebServerExternalContainersResponse> {
  return apiGet<WebServerExternalContainersResponse>('/api/web-server/external-containers');
}
