import { randomBytes } from 'node:crypto';
import type { OpenLanderConfig } from '../config/index.js';
import { saveConfig } from '../config/index.js';

export interface McpInstanceContext {
  id: string;
  name: string;
  endpoint: string;
}

export interface McpInstancePublicInfo extends McpInstanceContext {
  suggestedName: string;
  host: string;
  isDefaultName: boolean;
}

export const MCP_INSTANCE_NAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$/;

const GENERIC_INSTANCE_NAMES = new Set([
  'ol',
  'ol-local',
  'ol-localhost',
  'openlander',
  'openlander-local',
  'openlander-localhost',
  'localhost',
]);

export function normalizeMcpInstanceName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().toLowerCase();
  if (!name || !MCP_INSTANCE_NAME_RE.test(name)) return null;
  return name;
}

export function isGenericMcpInstanceName(name: string): boolean {
  return GENERIC_INSTANCE_NAMES.has(name) || name.endsWith('-localhost') || name.endsWith('-local');
}

export function ensureMcpInstanceId(config: OpenLanderConfig): string {
  const existing = config.mcp.instanceId?.trim();
  if (existing) return existing;

  const instanceId = `olinst_${randomBytes(12).toString('hex')}`;
  config.mcp = { ...config.mcp, instanceId };
  saveConfig(config);
  return instanceId;
}

export function getMcpEndpointFromRequestUrl(requestUrl: string): {
  endpoint: string;
  host: string;
} {
  const url = new URL(requestUrl);
  return {
    endpoint: `${url.origin}/mcp`,
    host: url.host,
  };
}

export function getConfiguredMcpEndpoint(config: OpenLanderConfig): {
  endpoint: string;
  host: string;
} {
  const publicHost = process.env['OPENLANDER_PUBLIC_HOST']?.trim();
  if (publicHost) {
    const endpoint = endpointFromHostLike(publicHost);
    return {
      endpoint,
      host: new URL(endpoint).host,
    };
  }

  const baseUrl = config.server.baseUrl.trim() || `http://localhost:${String(config.server.port)}`;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/mcp`;
  return {
    endpoint,
    host: new URL(endpoint).host,
  };
}

export function getMcpInstancePublicInfo(
  config: OpenLanderConfig,
  options?: { endpoint?: string; host?: string },
): McpInstancePublicInfo {
  const configured = getConfiguredMcpEndpoint(config);
  const endpoint = options?.endpoint ?? configured.endpoint;
  const host = options?.host ?? configured.host;
  const suggestedName = suggestMcpInstanceName(host);
  const storedName = normalizeMcpInstanceName(config.mcp.instanceName);
  const envName = normalizeMcpInstanceName(process.env['OPENLANDER_INSTANCE_NAME']);
  const explicitName = storedName ?? envName;
  const name = explicitName ?? suggestedName;

  return {
    id: ensureMcpInstanceId(config),
    name,
    suggestedName,
    endpoint,
    host,
    isDefaultName: explicitName === null || isGenericMcpInstanceName(name),
  };
}

export function getMcpInstanceContext(config: OpenLanderConfig): McpInstanceContext {
  const info = getMcpInstancePublicInfo(config);
  return {
    id: info.id,
    name: info.name,
    endpoint: info.endpoint,
  };
}

function endpointFromHostLike(hostLike: string): string {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(hostLike) ? hostLike : `http://${hostLike}`;
  const url = new URL(withProtocol);
  return `${url.origin}/mcp`;
}

function suggestMcpInstanceName(host: string): string {
  const envName = normalizeMcpInstanceName(process.env['OPENLANDER_INSTANCE_NAME']);
  if (envName) return envName;

  const publicHost = process.env['OPENLANDER_PUBLIC_HOST']?.trim();
  if (publicHost) {
    return hostToInstanceName(new URL(endpointFromHostLike(publicHost)).host);
  }

  return hostToInstanceName(host);
}

function hostToInstanceName(host: string): string {
  const hostname = host.split(':')[0]?.trim().toLowerCase() ?? '';
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'ol-local';
  }

  const safeHost = hostname
    .replace(/^www\./, '')
    .replace(/^\[|\]$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 58);
  return normalizeMcpInstanceName(`ol-${safeHost}`) ?? 'ol-local';
}
