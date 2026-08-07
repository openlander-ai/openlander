import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { nanoid } from 'nanoid';

import { hashPassword, verifyPassword } from '../auth/auth-service.js';
import type { OpenLanderConfig } from '../config/index.js';
import type { Database, ProjectRow, ServiceRow } from '../db/index.js';
import {
  OpenLanderError,
  ProjectNotFoundError,
  PublicAccessNotEligibleError,
  ServiceNotFoundError,
  ServiceSelectionRequiredError,
} from '../errors.js';
import { resolveComposeTrafficTargetId } from '../health/compose-runtime.js';
import { loadComposeTrafficService } from './config-snapshot.js';
import { containerName as projectContainerName } from './helpers.js';
import type { TraefikManager } from './traefik.js';

export const PROTECTED_SHARE_MAPPING_PREFIX = 'protected-share-';
export const PROTECTED_SHARE_COOKIE = 'ol_share';
export const PROTECTED_SHARE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROTECTED_SHARE_TLS_RESOLVER = 'openlander';
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_HOSTNAME_ATTEMPTS = 10;

export interface ProtectedPublicAccessView {
  project_id: string;
  service_id: string;
  provider: 'protected_share';
  status: 'private' | 'public';
  public_url: string | null;
  hostname: string | null;
  access_code_configured: boolean;
  access_code?: string;
  error: null;
}

export interface ProtectedShareTarget {
  project: ProjectRow;
  service: ServiceRow;
}

function serviceCandidates(services: ServiceRow[]) {
  return services.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    kind: service.kind,
    source: service.source,
  }));
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return '';
  }
}

export function normalizeProtectedSharePublicHost(value: string): string {
  const host = normalizeHost(value).replace(/^\*\./, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const valid = host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
    return valid ? host : '';
  }
  if (host.length > 253 || !host.includes('.')) return '';
  return host
    .split('.')
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
    ? host
    : '';
}

export function isValidProtectedShareAcmeEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeProtectedShareProxyError(error: unknown): OpenLanderError {
  const message = errorMessage(error);
  const mentionsHttpsPort = /(?:0\.0\.0\.0:443|\[::\]:443|port\s+443|443\/tcp)/i.test(message);
  const isBindConflict = /(?:address already in use|port is already allocated|bind failed)/i.test(
    message,
  );
  if (mentionsHttpsPort && isBindConflict) {
    return new OpenLanderError(
      'Host port 443 is already in use. Free it or use Cloudflare Tunnel.',
      'PROTECTED_SHARE_HTTPS_PORT_UNAVAILABLE',
      409,
      { port: 443, reason: 'host_port_in_use' },
    );
  }
  return new OpenLanderError(
    'Could not activate the protected sharing proxy.',
    'PROTECTED_SHARE_PROXY_APPLY_FAILED',
    500,
    { reason: 'traefik_start_failed' },
  );
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function serviceSlug(service: ServiceRow): string {
  const leafName = service.name.split('/').pop() ?? service.name;
  const slug = leafName
    .replace(/__svc$/, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);
  return slug || 'app';
}

function buildHostname(service: ServiceRow, publicHost: string): string {
  const label = `${serviceSlug(service)}-${randomBytes(3).toString('hex')}`;
  return isIpv4(publicHost)
    ? `${label}.${publicHost.replaceAll('.', '-')}.sslip.io`
    : `${label}.${publicHost}`;
}

function generateAccessCode(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(
    bytes,
    (byte) => ACCESS_CODE_ALPHABET[byte % ACCESS_CODE_ALPHABET.length],
  );
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function normalizeAccessCode(value: string): string {
  return value.trim().toUpperCase();
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export class ProtectedPublicShareManager {
  constructor(
    private readonly db: Database,
    private readonly config: OpenLanderConfig,
    private readonly traefik: TraefikManager,
    private readonly persistConfig: (config: OpenLanderConfig) => void = () => undefined,
  ) {}

  async getPublicAccess(input: {
    projectId: string;
    serviceId?: string;
  }): Promise<ProtectedPublicAccessView> {
    const { project, service } = await this.resolveTarget(input, false);
    return await this.view(project, service);
  }

  async expose(input: {
    projectId: string;
    serviceId?: string;
    rotateAccessCode?: boolean;
  }): Promise<ProtectedPublicAccessView> {
    if (this.config.traefik.mode !== 'managed') {
      throw new PublicAccessNotEligibleError(
        'Protected public sharing requires OpenLander-managed Traefik.',
        { traefikMode: this.config.traefik.mode },
      );
    }

    const publicHost = normalizeProtectedSharePublicHost(
      this.config.traefik.protectedShare.publicHost,
    );
    const acmeEmail = this.config.traefik.protectedShare.acmeEmail.trim();
    const missing = [
      ...(publicHost ? [] : ['public_host']),
      ...(isValidProtectedShareAcmeEmail(acmeEmail) ? [] : ['acme_email']),
    ];
    if (missing.length > 0) {
      throw new OpenLanderError(
        'Protected public sharing needs a public address and certificate email in Web Server settings.',
        'PROTECTED_SHARE_SETUP_REQUIRED',
        409,
        { missing, settingsPath: '/settings/web-server#public-access' },
      );
    }

    const { project, service } = await this.resolveTarget(input, true);
    const connectedPublish = await this.db.getProjectPublicAccess(project.id);
    if (
      connectedPublish &&
      connectedPublish.status !== 'private' &&
      connectedPublish.service_id === service.id
    ) {
      throw new PublicAccessNotEligibleError(
        'This Application already has an active Cloudflare Connected Publish route. Unpublish it before enabling the access-code gate.',
        { projectId: project.id, serviceId: service.id, status: connectedPublish.status },
      );
    }
    await this.ensureIngressNetworks();

    let mapping = (await this.db.listDomainMappingsForService(service.id)).find((candidate) =>
      candidate.id.startsWith(PROTECTED_SHARE_MAPPING_PREFIX),
    );
    if (!mapping) {
      for (let attempt = 0; attempt < MAX_HOSTNAME_ATTEMPTS && !mapping; attempt += 1) {
        const hostname = buildHostname(service, publicHost);
        const conflict = await this.db.findDomainMappingByHostAndPath(hostname, '/');
        if (conflict) continue;
        mapping = await this.db.createDomainMappingForService({
          id: `${PROTECTED_SHARE_MAPPING_PREFIX}${nanoid(16)}`,
          serviceId: service.id,
          domain: hostname,
          status: 'active',
          pathPrefix: '/',
          stripPrefix: false,
          targetPort: null,
          tlsEnabled: true,
          tlsResolver: PROTECTED_SHARE_TLS_RESOLVER,
        });
      }
    } else if (mapping.status !== 'active') {
      mapping = (await this.db.updateDomainMapping(mapping.id, { status: 'active' })) ?? mapping;
    }
    if (!mapping) {
      throw new PublicAccessNotEligibleError('No safe protected-share hostname is available.', {
        serviceId: service.id,
        publicHost,
      });
    }

    let accessCode: string | undefined;
    let accessCodeHash = service.access_code;
    let signingSecret = service.access_code_iv;
    if (input.rotateAccessCode || !accessCodeHash || !signingSecret) {
      accessCode = generateAccessCode();
      accessCodeHash = hashPassword(normalizeAccessCode(accessCode));
      signingSecret = randomBytes(32).toString('base64url');
    }

    const publicUrl = `https://${mapping.domain}`;
    await this.db.updateService(service.id, {
      visibility: 'shared',
      publicUrl,
      accessCode: accessCodeHash,
      accessCodeIv: signingSecret,
    });

    const updated = await this.db.getService(service.id);
    if (!updated) throw new ServiceNotFoundError(service.id);
    return {
      ...(await this.view(project, updated)),
      ...(accessCode ? { access_code: accessCode } : {}),
    };
  }

  async unexpose(input: {
    projectId: string;
    serviceId?: string;
  }): Promise<ProtectedPublicAccessView> {
    const { project, service } = await this.resolveTarget(input, false);
    const reservation = (await this.db.listDomainMappingsForService(service.id)).find((candidate) =>
      candidate.id.startsWith(PROTECTED_SHARE_MAPPING_PREFIX),
    );
    if (reservation?.status === 'active') {
      await this.db.updateDomainMapping(reservation.id, { status: 'pending' });
    }
    await this.db.updateService(service.id, {
      visibility: 'internal',
      publicUrl: null,
      accessCode: null,
      accessCodeIv: null,
    });
    const updated = await this.db.getService(service.id);
    if (!updated) throw new ServiceNotFoundError(service.id);
    return await this.view(project, updated);
  }

  async resolveActiveShareByHostname(hostname: string): Promise<ProtectedShareTarget | null> {
    const normalized = normalizeHost(hostname);
    if (!normalized) return null;
    const mapping = await this.db.findDomainMappingByHostAndPath(normalized, '/');
    if (!mapping?.id.startsWith(PROTECTED_SHARE_MAPPING_PREFIX)) return null;
    const service = await this.db.getService(mapping.service_id);
    if (
      !service ||
      service.visibility !== 'shared' ||
      !service.access_code ||
      !service.access_code_iv ||
      service.archived_at
    ) {
      return null;
    }
    const project = await this.db.getProject(service.project_id);
    return project && !project.archived_at ? { project, service } : null;
  }

  verifyAccessCode(service: ServiceRow, accessCode: string): boolean {
    if (!service.access_code || accessCode.length > 128) return false;
    return verifyPassword(normalizeAccessCode(accessCode), service.access_code);
  }

  createSessionToken(service: ServiceRow, hostname: string, now = Date.now()): string {
    if (!service.access_code_iv) throw new ServiceNotFoundError(service.id);
    const expiresAt = Math.floor(now / 1000) + PROTECTED_SHARE_SESSION_TTL_SECONDS;
    const payload = encodeBase64Url(
      JSON.stringify({ serviceId: service.id, hostname: normalizeHost(hostname), expiresAt }),
    );
    const signature = createHmac('sha256', service.access_code_iv)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  validateSessionToken(
    service: ServiceRow,
    hostname: string,
    token: string | null,
    now = Date.now(),
  ): boolean {
    if (!service.access_code_iv || !token) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return false;
    const expected = createHmac('sha256', service.access_code_iv).update(payload).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      return false;
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    try {
      const decoded = JSON.parse(decodeBase64Url(payload)) as {
        serviceId?: unknown;
        hostname?: unknown;
        expiresAt?: unknown;
      };
      const nowSeconds = Math.floor(now / 1000);
      return (
        decoded.serviceId === service.id &&
        decoded.hostname === normalizeHost(hostname) &&
        typeof decoded.expiresAt === 'number' &&
        decoded.expiresAt > nowSeconds &&
        decoded.expiresAt <= nowSeconds + PROTECTED_SHARE_SESSION_TTL_SECONDS
      );
    } catch {
      return false;
    }
  }

  private async view(project: ProjectRow, service: ServiceRow): Promise<ProtectedPublicAccessView> {
    const reservation = (await this.db.listDomainMappingsForService(service.id)).find((candidate) =>
      candidate.id.startsWith(PROTECTED_SHARE_MAPPING_PREFIX),
    );
    let hostname: string | null = reservation?.domain ?? null;
    if (!hostname && service.public_url) {
      try {
        hostname = new URL(service.public_url).hostname;
      } catch {
        hostname = null;
      }
    }
    const isPublic =
      service.visibility === 'shared' && Boolean(service.access_code && service.access_code_iv);
    return {
      project_id: project.id,
      service_id: service.id,
      provider: 'protected_share',
      status: isPublic ? 'public' : 'private',
      public_url: isPublic ? service.public_url : null,
      hostname,
      access_code_configured: Boolean(service.access_code && service.access_code_iv),
      error: null,
    };
  }

  private async resolveTarget(
    input: { projectId: string; serviceId?: string },
    requireRunning: boolean,
  ): Promise<ProtectedShareTarget> {
    const project = await this.db.getProject(input.projectId);
    if (!project) throw new ProjectNotFoundError(input.projectId);

    let service: ServiceRow | undefined;
    if (input.serviceId) {
      service = await this.db.getService(input.serviceId);
      if (!service || service.project_id !== project.id) {
        throw new ServiceNotFoundError(input.serviceId);
      }
    } else {
      const deployables = await this.db.getDeployablesByGroup(project.id);
      if (deployables.length !== 1) {
        throw new ServiceSelectionRequiredError(
          project.id,
          project.name,
          serviceCandidates(deployables),
        );
      }
      service = deployables[0];
    }
    if (!service) throw new ServiceNotFoundError(project.name);

    if (service.kind === 'compose') {
      const children = await this.db.getComposeChildren(service.id);
      const trafficService = await loadComposeTrafficService(this.db, project.id);
      const targetId = resolveComposeTrafficTargetId(children, trafficService);
      service = targetId ? children.find((child) => child.id === targetId) : undefined;
      if (!service) {
        throw new PublicAccessNotEligibleError(
          'Compose has no saved representative traffic service.',
          { projectId: project.id, trafficService },
        );
      }
    }

    if (service.runtime_role !== 'application') {
      throw new PublicAccessNotEligibleError('Only HTTP application services can be published.', {
        serviceId: service.id,
        runtimeRole: service.runtime_role,
      });
    }
    if (requireRunning && service.status !== 'running') {
      throw new PublicAccessNotEligibleError('Application is not running.', {
        serviceId: service.id,
        status: service.status,
      });
    }
    if (requireRunning && !service.assigned_port && !service.container_port) {
      throw new PublicAccessNotEligibleError('Application has no detected HTTP port.', {
        serviceId: service.id,
      });
    }
    return { project, service };
  }

  private async ensureIngressNetworks(): Promise<void> {
    const protectedShare = this.config.traefik.protectedShare;
    if (!protectedShare.enabled) {
      protectedShare.enabled = true;
      this.persistConfig(this.config);
      try {
        await this.traefik.start();
      } catch (error) {
        protectedShare.enabled = false;
        this.persistConfig(this.config);
        try {
          await this.traefik.start();
        } catch {
          throw new OpenLanderError(
            'HTTPS activation failed and the HTTP proxy could not be restored.',
            'PROTECTED_SHARE_PROXY_RECOVERY_FAILED',
            500,
            { reason: 'proxy_recovery_failed' },
          );
        }
        throw normalizeProtectedShareProxyError(error);
      }
    } else {
      try {
        await this.traefik.start();
      } catch (error) {
        throw normalizeProtectedShareProxyError(error);
      }
    }
    const [projects, services] = await Promise.all([
      this.db.listProjects(undefined, { includeArchived: false }),
      this.db.listServices(),
    ]);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const networks = new Set<string>();
    for (const service of services) {
      if (
        service.archived_at ||
        (service.status !== 'running' && !(service.status === 'building' && service.container_id))
      ) {
        continue;
      }
      const projectName = projectNames.get(service.project_id);
      if (projectName) networks.add(projectContainerName(projectName));
    }
    for (const network of networks) await this.traefik.connectToNetwork(network);
  }
}
