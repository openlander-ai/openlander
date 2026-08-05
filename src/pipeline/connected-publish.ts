import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { deleteProviderToken, getValidToken } from '../auth/token-store.js';
import { getDataDir, DOCKER_LABELS, type CloudflareConfig } from '../config/index.js';
import type {
  CloudflareConnectionRow,
  Database,
  DomainMappingRow,
  ProjectPublicAccessRow,
  ProjectRow,
  ServiceRow,
} from '../db/index.js';
import { decrypt, encrypt } from '../env/crypto.js';
import type { EventBus } from '../events/index.js';
import {
  CloudflareNotConnectedError,
  OpenLanderError,
  ProjectNotFoundError,
  PublicAccessBusyError,
  PublicAccessNotEligibleError,
  ServiceNotFoundError,
  ServiceSelectionRequiredError,
} from '../errors.js';
import { resolveComposeTrafficTargetId } from '../health/compose-runtime.js';
import { createModuleLogger } from '../lib/logger.js';
import { loadComposeTrafficService } from './config-snapshot.js';
import {
  CloudflareApiClient,
  type CloudflareAccount,
  type CloudflareDnsRecord,
  type CloudflareTunnel,
  type CloudflareZone,
} from './cloudflare-api.js';
import type { RuntimeBackend } from './runtime/backend.js';

const log = createModuleLogger('connected-publish');
const CLOUDFLARED_IMAGE = 'cloudflare/cloudflared:2026.7.2';
const CLOUDFLARED_CONTAINER = 'cloudflared-ol';
const CLOUDFLARED_TOKEN_DIR = '/run/secrets/openlander-cloudflare';
const CLOUDFLARED_TOKEN_PATH = `${CLOUDFLARED_TOKEN_DIR}/tunnel-token`;
const CONTAINERIZED_TOKEN_DIR = '/run/openlander/cloudflare';
const DEFAULT_CONTAINERIZED_DATA_VOLUME = 'openlander-data';
const TRAEFIK_ORIGIN = 'http://traefik-ol:80';
const MAX_HOSTNAME_ATTEMPTS = 10;

type ApiFactory = (accessToken: string) => CloudflareApiClient;

export interface ConnectedPublishOptions {
  runtime?: RuntimeBackend;
  instanceId?: string;
  networkName?: string;
  apiFactory?: ApiFactory;
  connectorImage?: string;
}

export interface CloudflareConnectionView {
  configured: boolean;
  oauthAvailable: boolean;
  status: 'disconnected' | 'connected' | 'error';
  account?: { id: string; name: string | null };
  zone?: { id: string; name: string };
  tunnel?: { id: string; name: string };
  connector?: { status: 'running' | 'stopped' | 'unavailable' };
  error?: { code: string | null; message: string | null };
}

export interface PublicAccessView {
  project_id: string;
  service_id: string | null;
  status: 'private' | 'provisioning' | 'public' | 'unpublishing' | 'error';
  public_url: string | null;
  hostname: string | null;
  error: { code: string | null; message: string | null } | null;
}

interface PublishTarget {
  project: ProjectRow;
  service: ServiceRow;
}

function publicAccessView(projectId: string, row: ProjectPublicAccessRow | null): PublicAccessView {
  return {
    project_id: projectId,
    service_id: row?.service_id ?? null,
    status: row?.status ?? 'private',
    public_url: row?.status === 'public' ? `https://${row.hostname}` : null,
    hostname: row?.hostname ?? null,
    error:
      row?.last_error_code || row?.last_error_message
        ? { code: row.last_error_code, message: row.last_error_message }
        : null,
  };
}

function errorCode(error: unknown): string {
  return error instanceof OpenLanderError ? error.code : 'PUBLIC_ACCESS_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Public access operation failed';
}

function normalizeLabel(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'app';
}

function boundedLabel(base: string, suffix = ''): string {
  const maxBaseLength = Math.max(1, 63 - suffix.length);
  return `${base.slice(0, maxBaseLength).replace(/-+$/g, '') || 'app'}${suffix}`;
}

function candidateHostname(project: ProjectRow, zoneName: string, attempt: number): string {
  const base = normalizeLabel(project.name);
  if (attempt === 0) return `${boundedLabel(base)}.${zoneName}`;
  const stableId = normalizeLabel(project.id).slice(0, 8) || 'project';
  const suffix = attempt === 1 ? `-${stableId}` : `-${stableId}-${String(attempt)}`;
  return `${boundedLabel(base, suffix)}.${zoneName}`;
}

function serviceCandidates(services: readonly ServiceRow[]) {
  return services.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    kind: service.kind,
    source: service.source,
  }));
}

export class ConnectedPublishManager {
  private readonly runtime?: RuntimeBackend;
  private readonly instanceId: string;
  private readonly networkName: string;
  private readonly apiFactory: ApiFactory;
  private readonly connectorImage: string;
  private operationQueue: Promise<void> = Promise.resolve();
  private disconnecting = false;

  constructor(
    private config: CloudflareConfig,
    private readonly db: Database,
    private readonly events: EventBus,
    options: ConnectedPublishOptions = {},
  ) {
    this.runtime = options.runtime;
    this.instanceId = options.instanceId ?? '';
    this.networkName = options.networkName ?? 'openlander';
    this.apiFactory = options.apiFactory ?? ((accessToken) => new CloudflareApiClient(accessToken));
    this.connectorImage = options.connectorImage ?? CLOUDFLARED_IMAGE;
  }

  reloadConfig(config: CloudflareConfig): void {
    this.config = config;
  }

  async getConnectionView(): Promise<CloudflareConnectionView> {
    const connection = await this.db.getCloudflareConnection();
    if (!connection) {
      return {
        configured: false,
        oauthAvailable: this.oauthAvailable(),
        status: 'disconnected',
      };
    }

    return {
      configured: true,
      oauthAvailable: this.oauthAvailable(),
      status: connection.status,
      account: { id: connection.account_id, name: connection.account_name },
      zone: { id: connection.zone_id, name: connection.zone_name },
      tunnel: { id: connection.tunnel_id, name: connection.tunnel_name },
      connector: { status: await this.connectorStatus(connection) },
      ...(connection.last_error_code || connection.last_error_message
        ? {
            error: {
              code: connection.last_error_code,
              message: connection.last_error_message,
            },
          }
        : {}),
    };
  }

  oauthAvailable(): boolean {
    return Boolean(this.config.oauthClientId.trim() && this.config.oauthRedirectUri.trim());
  }

  async listAccounts(): Promise<CloudflareAccount[]> {
    return (await this.getApiClient()).listAccounts();
  }

  async listZones(accountId: string): Promise<CloudflareZone[]> {
    return (await this.getApiClient()).listZones(accountId);
  }

  async connect(input: { accountId: string; zoneId: string }): Promise<CloudflareConnectionView> {
    if (this.disconnecting) {
      throw new PublicAccessNotEligibleError('Cloudflare disconnection is in progress.');
    }
    const current = await this.db.getCloudflareConnection();
    if (current) {
      if (current.account_id !== input.accountId || current.zone_id !== input.zoneId) {
        throw new PublicAccessNotEligibleError(
          'Disconnect the current Cloudflare Zone before selecting a different one.',
          { accountId: current.account_id, zoneId: current.zone_id },
        );
      }
      await this.ensureConnector(current);
      await this.syncIngress(await this.getApiClient(), current);
      await this.db.updateCloudflareConnection({
        status: 'connected',
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      return this.getConnectionView();
    }

    const api = await this.getApiClient();
    const [accounts, zones] = await Promise.all([
      api.listAccounts(),
      api.listZones(input.accountId),
    ]);
    const account = accounts.find((entry) => entry.id === input.accountId);
    if (!account) throw new PublicAccessNotEligibleError('Cloudflare account is not accessible.');
    const zone = zones.find((entry) => entry.id === input.zoneId);
    if (!zone) throw new PublicAccessNotEligibleError('Cloudflare DNS Zone is not accessible.');

    const tunnelName = this.tunnelName();
    const matching = (await api.listTunnels(account.id, tunnelName)).filter(
      (tunnel) => tunnel.name === tunnelName,
    );
    const tunnel: CloudflareTunnel =
      matching[0] ?? (await api.createTunnel(account.id, tunnelName));
    if (matching.length > 1) {
      throw new PublicAccessNotEligibleError(
        'Multiple Cloudflare Tunnels use this OpenLander instance name.',
        { tunnelName, tunnelIds: matching.map((entry) => entry.id) },
      );
    }
    const tunnelToken = tunnel.token ?? (await api.getTunnelToken(account.id, tunnel.id));
    const encrypted = encrypt(tunnelToken);

    let connection = await this.db.upsertCloudflareConnection({
      accountId: account.id,
      accountName: account.name,
      zoneId: zone.id,
      zoneName: zone.name,
      tunnelId: tunnel.id,
      tunnelName: tunnel.name,
      encryptedTunnelToken: encrypted.encrypted,
      tunnelTokenIv: encrypted.iv,
    });
    try {
      await this.ensureConnector(connection);
      connection = (await this.db.getCloudflareConnection()) ?? connection;
      await this.syncIngress(api, connection);
    } catch (error) {
      await this.db.updateCloudflareConnection({
        status: 'error',
        lastErrorCode: errorCode(error),
        lastErrorMessage: errorMessage(error),
      });
      throw error;
    }
    return this.getConnectionView();
  }

  async disconnect(): Promise<CloudflareConnectionView> {
    if (this.disconnecting) {
      throw new PublicAccessNotEligibleError('Cloudflare disconnection is already in progress.');
    }
    this.disconnecting = true;
    const operation = this.operationQueue.then(() => this.performDisconnect());
    this.operationQueue = operation.then(
      () => undefined,
      (error: unknown) => {
        log.error({ err: error }, 'Connected Publish disconnect failed');
      },
    );
    try {
      return await operation;
    } finally {
      this.disconnecting = false;
    }
  }

  async getPublicAccess(projectId: string): Promise<PublicAccessView> {
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    return publicAccessView(project.id, await this.db.getProjectPublicAccess(project.id));
  }

  async requestPublish(input: {
    projectId: string;
    serviceId?: string;
  }): Promise<PublicAccessView> {
    if (this.disconnecting) {
      throw new PublicAccessBusyError(input.projectId, 'disconnecting');
    }
    const connection = await this.requireConnection();
    const current = await this.db.getProjectPublicAccess(input.projectId);
    if (current?.status === 'provisioning' || current?.status === 'unpublishing') {
      throw new PublicAccessBusyError(input.projectId, current.status);
    }

    const target = await this.resolveTarget(
      input.projectId,
      input.serviceId ?? current?.service_id ?? undefined,
    );
    if (current?.status === 'public' && current.service_id === target.service.id) {
      return publicAccessView(target.project.id, current);
    }

    const hostname =
      current?.hostname ??
      (await this.availableLocalHostname(target.project, connection.zone_name));
    const row = await this.db.upsertProjectPublicAccess({
      projectId: target.project.id,
      serviceId: target.service.id,
      hostname,
      cloudflareZoneId: connection.zone_id,
      cloudflareDnsRecordId: current?.cloudflare_dns_record_id,
      domainMappingId: current?.domain_mapping_id,
      status: 'provisioning',
    });
    await this.db.updateProjectPublicAccess(target.project.id, {
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    this.enqueue(() => this.performPublish(target.project.id));
    return publicAccessView(target.project.id, row);
  }

  async requestUnpublish(projectId: string): Promise<PublicAccessView> {
    if (this.disconnecting) {
      throw new PublicAccessBusyError(projectId, 'disconnecting');
    }
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const current = await this.db.getProjectPublicAccess(project.id);
    if (!current || current.status === 'private') return publicAccessView(project.id, current);
    if (current.status === 'provisioning' || current.status === 'unpublishing') {
      throw new PublicAccessBusyError(project.id, current.status);
    }
    const row = await this.db.updateProjectPublicAccess(project.id, {
      status: 'unpublishing',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    this.enqueue(() => this.performUnpublish(project.id));
    return publicAccessView(project.id, row);
  }

  async deleteProjectReservation(projectId: string, serviceId?: string): Promise<void> {
    const access = await this.db.getProjectPublicAccess(projectId);
    if (!access || (serviceId && access.service_id !== serviceId)) return;

    const connection = await this.db.getCloudflareConnection();
    await this.db.updateProjectPublicAccess(projectId, {
      status: 'private',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    if (access.domain_mapping_id) await this.db.deleteDomainMapping(access.domain_mapping_id);
    if (access.service_id) {
      await this.db.updateService(access.service_id, { visibility: 'internal', publicUrl: null });
    }
    const api = connection ? await this.getApiClient() : null;
    if (api && connection) await this.syncIngress(api, connection);
    if (api && access.cloudflare_dns_record_id) {
      await api.deleteDnsRecord(access.cloudflare_zone_id, access.cloudflare_dns_record_id);
    }
    await this.db.deleteProjectPublicAccess(projectId);
  }

  async reconcile(): Promise<void> {
    const connection = await this.db.getCloudflareConnection();
    if (!connection) return;
    await this.ensureConnector(connection);
    const rows = await this.db.listProjectPublicAccess();
    for (const row of rows) {
      if (row.status === 'provisioning') this.enqueue(() => this.performPublish(row.project_id));
      if (row.status === 'unpublishing') this.enqueue(() => this.performUnpublish(row.project_id));
    }
    await this.syncIngress(await this.getApiClient(), connection);
  }

  waitForPendingOperations(): Promise<void> {
    return this.operationQueue;
  }

  private enqueue(operation: () => Promise<void>): void {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch((error: unknown) => {
      log.error({ err: error }, 'Connected Publish background operation failed');
    });
  }

  private async performPublish(projectId: string): Promise<void> {
    try {
      const connection = await this.requireConnection();
      const access = await this.db.getProjectPublicAccess(projectId);
      if (!access?.service_id || access.status !== 'provisioning') return;
      const target = await this.resolveTarget(projectId, access.service_id);
      const api = await this.getApiClient();
      await this.ensureConnector(connection);
      const withDns = await this.ensureDnsReservation(api, connection, target.project, access);
      const mapping = await this.ensureDomainMapping(target.service, withDns);
      await this.db.updateProjectPublicAccess(projectId, { domainMappingId: mapping.id });
      await this.syncIngress(api, connection);
      const publicUrl = `https://${withDns.hostname}`;
      await this.db.updateService(target.service.id, {
        visibility: 'production',
        publicUrl,
      });
      const completed = await this.db.updateProjectPublicAccess(projectId, {
        status: 'public',
        domainMappingId: mapping.id,
        lastErrorCode: null,
        lastErrorMessage: null,
        publishedAt: new Date().toISOString(),
      });
      if (!completed) throw new ServiceNotFoundError(target.service.id);
      await this.events.emit('tunnel:url', { projectId, url: publicUrl });
    } catch (error) {
      await this.failPublish(projectId, error);
    }
  }

  private async failPublish(projectId: string, error: unknown): Promise<void> {
    await this.db.updateProjectPublicAccess(projectId, {
      status: 'error',
      lastErrorCode: errorCode(error),
      lastErrorMessage: errorMessage(error),
    });
    const access = await this.db.getProjectPublicAccess(projectId);
    const connection = await this.db.getCloudflareConnection();
    if (access?.domain_mapping_id) {
      await this.db.deleteDomainMapping(access.domain_mapping_id);
      await this.db.updateProjectPublicAccess(projectId, { domainMappingId: null });
    }
    if (access?.service_id) {
      await this.db.updateService(access.service_id, { visibility: 'internal', publicUrl: null });
    }
    // Remove the externally reachable ingress last. Even if Cloudflare is unavailable,
    // deleting the local mapping first makes Traefik return 404 for the hostname.
    if (connection) await this.syncIngress(await this.getApiClient(), connection);
  }

  private async performUnpublish(projectId: string): Promise<void> {
    try {
      const access = await this.db.getProjectPublicAccess(projectId);
      if (!access || access.status !== 'unpublishing') return;
      if (access.domain_mapping_id) await this.db.deleteDomainMapping(access.domain_mapping_id);
      if (access.service_id) {
        await this.db.updateService(access.service_id, {
          visibility: 'internal',
          publicUrl: null,
        });
      }
      await this.db.updateProjectPublicAccess(projectId, {
        domainMappingId: null,
      });
      const connection = await this.requireConnection();
      await this.syncIngress(await this.getApiClient(), connection);
      await this.db.updateProjectPublicAccess(projectId, {
        status: 'private',
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    } catch (error) {
      await this.db.updateProjectPublicAccess(projectId, {
        status: 'error',
        lastErrorCode: errorCode(error),
        lastErrorMessage: errorMessage(error),
      });
    }
  }

  private async performDisconnect(): Promise<CloudflareConnectionView> {
    const connection = await this.db.getCloudflareConnection();
    if (!connection) {
      await this.removeTokenFile();
      await deleteProviderToken(this.db, 'cloudflare');
      return this.getConnectionView();
    }

    const accessRows = (await this.db.listProjectPublicAccess()).filter(
      (row) => row.connection_id === connection.id,
    );
    const busy = accessRows.find(
      (row) => row.status === 'provisioning' || row.status === 'unpublishing',
    );
    if (busy) throw new PublicAccessBusyError(busy.project_id, busy.status);

    const api = await this.getApiClient();
    const [matchingTunnels, connector] = await Promise.all([
      api.listTunnels(connection.account_id, connection.tunnel_name),
      this.findOwnedConnector(connection),
    ]);
    const remoteTunnel = matchingTunnels.find((tunnel) => tunnel.id === connection.tunnel_id);
    const ownedDnsRecords: Array<{
      zoneId: string;
      record: CloudflareDnsRecord;
    }> = [];
    const tunnelTarget = `${connection.tunnel_id}.cfargotunnel.com`;

    for (const access of accessRows) {
      if (!access.cloudflare_dns_record_id) continue;
      const records = await api.listDnsRecords(access.cloudflare_zone_id, access.hostname);
      const record = records.find((candidate) => candidate.id === access.cloudflare_dns_record_id);
      if (!record) continue;
      if (
        record.type.toUpperCase() !== 'CNAME' ||
        record.content.replace(/\.$/, '').toLowerCase() !== tunnelTarget.toLowerCase()
      ) {
        throw new PublicAccessNotEligibleError(
          'A reserved Cloudflare DNS record was changed outside OpenLander.',
          { hostname: access.hostname, recordId: record.id },
        );
      }
      ownedDnsRecords.push({ zoneId: access.cloudflare_zone_id, record });
    }

    if (remoteTunnel) {
      await api.updateTunnelConfiguration(connection.account_id, connection.tunnel_id, [
        { service: 'http_status:404' },
      ]);
    }

    for (const access of accessRows) {
      if (access.domain_mapping_id) await this.db.deleteDomainMapping(access.domain_mapping_id);
      if (access.service_id) {
        await this.db.updateService(access.service_id, {
          visibility: 'internal',
          publicUrl: null,
        });
      }
      await this.db.updateProjectPublicAccess(access.project_id, {
        status: 'private',
        domainMappingId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    }

    if (connector && this.runtime) await this.runtime.safeRemoveContainer(connector.id);
    for (const owned of ownedDnsRecords) {
      await api.deleteDnsRecord(owned.zoneId, owned.record.id);
    }
    if (remoteTunnel) await api.deleteTunnel(connection.account_id, connection.tunnel_id);

    await this.removeTokenFile();
    await deleteProviderToken(this.db, 'cloudflare');
    for (const access of accessRows) {
      await this.db.deleteProjectPublicAccess(access.project_id);
    }
    await this.db.deleteCloudflareConnection();
    return this.getConnectionView();
  }

  private async ensureDnsReservation(
    api: CloudflareApiClient,
    connection: CloudflareConnectionRow,
    project: ProjectRow,
    access: ProjectPublicAccessRow,
  ): Promise<ProjectPublicAccessRow> {
    const tunnelTarget = `${connection.tunnel_id}.cfargotunnel.com`;
    if (access.cloudflare_dns_record_id) {
      const records = await api.listDnsRecords(connection.zone_id, access.hostname);
      const owned = records.find((record) => record.id === access.cloudflare_dns_record_id);
      if (owned) {
        if (
          owned.type.toUpperCase() !== 'CNAME' ||
          owned.content.replace(/\.$/, '').toLowerCase() !== tunnelTarget.toLowerCase()
        ) {
          throw new PublicAccessNotEligibleError(
            'The reserved Cloudflare DNS record was changed outside OpenLander.',
            { hostname: access.hostname, recordId: owned.id },
          );
        }
        return access;
      }
      await this.db.updateProjectPublicAccess(project.id, { cloudflareDnsRecordId: null });
    }

    for (let attempt = 0; attempt < MAX_HOSTNAME_ATTEMPTS; attempt += 1) {
      const hostname =
        attempt === 0 ? access.hostname : candidateHostname(project, connection.zone_name, attempt);
      const reserved = await this.db.getProjectPublicAccessByHostname(hostname);
      if (reserved && reserved.project_id !== project.id) continue;
      if (await this.db.findDomainMappingByHostAndPath(hostname, '/')) continue;
      const records = await api.listDnsRecords(connection.zone_id, hostname);
      if (records.length > 0) continue;
      const created = await api.createTunnelDnsRecord(
        connection.zone_id,
        hostname,
        connection.tunnel_id,
      );
      const updated = await this.db.updateProjectPublicAccess(project.id, {
        hostname,
        cloudflareZoneId: connection.zone_id,
        cloudflareDnsRecordId: created.id,
      });
      if (!updated) throw new ProjectNotFoundError(project.id);
      return updated;
    }
    throw new PublicAccessNotEligibleError('No safe hostname is available in the selected Zone.', {
      zone: connection.zone_name,
    });
  }

  private async ensureDomainMapping(
    service: ServiceRow,
    access: ProjectPublicAccessRow,
  ): Promise<DomainMappingRow> {
    if (access.domain_mapping_id) {
      const existing = (await this.db.listDomainMappingsForService(service.id)).find(
        (mapping) => mapping.id === access.domain_mapping_id,
      );
      if (existing) return existing;
    }
    const conflict = await this.db.findDomainMappingByHostAndPath(access.hostname, '/');
    if (conflict) {
      throw new PublicAccessNotEligibleError(
        'The reserved hostname is already used by a manual domain route.',
        { hostname: access.hostname, mappingId: conflict.id },
      );
    }
    return this.db.createDomainMappingForService({
      id: nanoid(16),
      serviceId: service.id,
      domain: access.hostname,
      cloudflareZoneId: access.cloudflare_zone_id,
      cloudflareDnsRecordId: access.cloudflare_dns_record_id ?? undefined,
      status: 'active',
      pathPrefix: '/',
      stripPrefix: false,
      targetPort: null,
      tlsEnabled: null,
      tlsResolver: null,
    });
  }

  private async syncIngress(
    api: CloudflareApiClient,
    connection: CloudflareConnectionRow,
  ): Promise<void> {
    const routes = (await this.db.listProjectPublicAccess())
      .filter(
        (row) =>
          row.connection_id === connection.id &&
          (row.status === 'public' || row.status === 'provisioning') &&
          row.domain_mapping_id !== null,
      )
      .sort((left, right) => left.hostname.localeCompare(right.hostname))
      .map((row) => ({ hostname: row.hostname, service: TRAEFIK_ORIGIN, originRequest: {} }));
    await api.updateTunnelConfiguration(connection.account_id, connection.tunnel_id, [
      ...routes,
      { service: 'http_status:404' },
    ]);
  }

  private async resolveTarget(projectId: string, serviceId?: string): Promise<PublishTarget> {
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    let service: ServiceRow | undefined;
    if (serviceId) {
      service = await this.db.getService(serviceId);
      if (!service || service.project_id !== project.id) throw new ServiceNotFoundError(serviceId);
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
    if (service.status !== 'running') {
      throw new PublicAccessNotEligibleError('Application is not running.', {
        serviceId: service.id,
        status: service.status,
      });
    }
    if (!service.assigned_port && !service.container_port) {
      throw new PublicAccessNotEligibleError('Application has no detected HTTP port.', {
        serviceId: service.id,
      });
    }
    return { project, service };
  }

  private async availableLocalHostname(project: ProjectRow, zoneName: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_HOSTNAME_ATTEMPTS; attempt += 1) {
      const hostname = candidateHostname(project, zoneName, attempt);
      if (!(await this.db.getProjectPublicAccessByHostname(hostname))) return hostname;
    }
    throw new PublicAccessNotEligibleError('Project hostname reservation is exhausted.', {
      projectId: project.id,
      zoneName,
    });
  }

  private async requireConnection(): Promise<CloudflareConnectionRow> {
    const connection = await this.db.getCloudflareConnection();
    if (!connection) throw new CloudflareNotConnectedError();
    return connection;
  }

  private async getApiClient(): Promise<CloudflareApiClient> {
    const clientId = this.config.oauthClientId.trim();
    const token = await getValidToken(this.db, 'cloudflare', {
      clientId,
      tokenUrl: 'https://dash.cloudflare.com/oauth2/token',
    });
    if (!token) throw new CloudflareNotConnectedError();
    return this.apiFactory(token);
  }

  private tunnelName(): string {
    const suffix = normalizeLabel(this.instanceId || 'local').slice(-32);
    return `openlander-${suffix}`;
  }

  private tokenFilePath(): string {
    if (process.env['OPENLANDER_CONTAINERIZED']?.trim().toLowerCase() === 'true') {
      return join(CONTAINERIZED_TOKEN_DIR, 'tunnel-token');
    }
    return join(getDataDir(), 'cloudflare', 'tunnel-token');
  }

  private connectorTokenHostConfig(tokenPath: string) {
    if (process.env['OPENLANDER_CONTAINERIZED']?.trim().toLowerCase() === 'true') {
      const dataVolume =
        process.env['OPENLANDER_DATA_VOLUME']?.trim() || DEFAULT_CONTAINERIZED_DATA_VOLUME;
      return {
        Mounts: [
          {
            Type: 'volume' as const,
            Source: `${dataVolume}-cloudflare`,
            Target: CLOUDFLARED_TOKEN_DIR,
            ReadOnly: true,
          },
        ],
      };
    }
    return { Binds: [`${tokenPath}:${CLOUDFLARED_TOKEN_PATH}:ro`] };
  }

  private async ensureConnector(connection: CloudflareConnectionRow): Promise<void> {
    if (!this.runtime) {
      throw new PublicAccessNotEligibleError('Docker runtime is unavailable for cloudflared.');
    }
    const containers = await this.runtime.listAllContainers();
    const current = containers.find(
      (container) =>
        container.name === CLOUDFLARED_CONTAINER ||
        container.id === connection.connector_container_id,
    );
    const owned =
      current &&
      current.labels[DOCKER_LABELS.MANAGED] === 'true' &&
      current.labels[DOCKER_LABELS.ROLE] === 'cloudflared' &&
      (!this.instanceId || current.labels[DOCKER_LABELS.INSTANCE] === this.instanceId);
    const sameTunnel = current?.labels['openlander.cloudflare.tunnel_id'] === connection.tunnel_id;
    if (current && owned && sameTunnel && current.state === 'running') {
      await this.db.updateCloudflareConnection({
        status: 'connected',
        connectorContainerId: current.id,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      return;
    }
    if (current && !owned) {
      throw new PublicAccessNotEligibleError(
        `Container name '${CLOUDFLARED_CONTAINER}' is already owned outside this OpenLander instance.`,
      );
    }
    if (current) await this.runtime.safeRemoveContainer(current.id);

    const token = decrypt(connection.encrypted_tunnel_token, connection.tunnel_token_iv);
    const tokenPath = this.tokenFilePath();
    await mkdir(join(getDataDir(), 'cloudflare'), { recursive: true, mode: 0o700 });
    await writeFile(tokenPath, token, { mode: 0o600 });
    await this.runtime.pullImage(this.connectorImage);
    const containerId = await this.runtime.runInfraContainer({
      Image: this.connectorImage,
      name: CLOUDFLARED_CONTAINER,
      User: '0:0',
      Cmd: ['tunnel', '--no-autoupdate', 'run', '--token-file', CLOUDFLARED_TOKEN_PATH],
      Labels: {
        [DOCKER_LABELS.ROLE]: 'cloudflared',
        ...(this.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.instanceId } : {}),
        'openlander.cloudflare.tunnel_id': connection.tunnel_id,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [this.networkName]: { Aliases: ['cloudflared-ol'] },
        },
      },
      HostConfig: {
        AutoRemove: false,
        ...this.connectorTokenHostConfig(tokenPath),
        NetworkMode: this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });
    await this.db.updateCloudflareConnection({
      status: 'connected',
      connectorContainerId: containerId,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  }

  private async findOwnedConnector(
    connection: CloudflareConnectionRow,
  ): Promise<{ id: string } | null> {
    if (!this.runtime) {
      if (connection.connector_container_id) {
        throw new PublicAccessNotEligibleError(
          'Docker runtime is unavailable for connector cleanup.',
        );
      }
      return null;
    }
    const containers = await this.runtime.listAllContainers();
    const current = containers.find(
      (container) =>
        container.id === connection.connector_container_id ||
        container.name === CLOUDFLARED_CONTAINER,
    );
    if (!current) return null;
    const owned =
      current.labels[DOCKER_LABELS.MANAGED] === 'true' &&
      current.labels[DOCKER_LABELS.ROLE] === 'cloudflared' &&
      (!this.instanceId || current.labels[DOCKER_LABELS.INSTANCE] === this.instanceId) &&
      current.labels['openlander.cloudflare.tunnel_id'] === connection.tunnel_id;
    if (!owned) {
      throw new PublicAccessNotEligibleError(
        `Container '${CLOUDFLARED_CONTAINER}' is not owned by this OpenLander connection.`,
      );
    }
    return { id: current.id };
  }

  private async connectorStatus(
    connection: CloudflareConnectionRow,
  ): Promise<'running' | 'stopped' | 'unavailable'> {
    if (!this.runtime) return 'unavailable';
    try {
      const containers = await this.runtime.listAllContainers();
      const container = containers.find(
        (entry) =>
          entry.id === connection.connector_container_id || entry.name === CLOUDFLARED_CONTAINER,
      );
      return container?.state === 'running' ? 'running' : 'stopped';
    } catch (error) {
      log.debug({ err: error }, 'Unable to inspect the cloudflared connector');
      return 'unavailable';
    }
  }

  async removeTokenFile(): Promise<void> {
    await rm(this.tokenFilePath(), { force: true });
  }
}
