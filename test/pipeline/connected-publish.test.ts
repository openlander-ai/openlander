import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteProviderToken, getValidToken } from '../../src/auth/token-store.js';
import type {
  CloudflareConnectionRow,
  Database,
  DomainMappingRow,
  ProjectPublicAccessRow,
  ProjectRow,
  ServiceRow,
} from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import type {
  CloudflareApiClient,
  CloudflareDnsRecord,
} from '../../src/pipeline/cloudflare-api.js';
import {
  ConnectedPublishManager,
  type PublicRouteProbeResult,
} from '../../src/pipeline/connected-publish.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/backend.js';

vi.mock('../../src/auth/token-store.js', () => ({
  getValidToken: vi.fn().mockResolvedValue('access-token'),
  deleteProviderToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/env/crypto.js', () => ({
  decrypt: vi.fn(() => 'tunnel-token'),
  encrypt: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.mocked(getValidToken).mockResolvedValue('access-token');
  vi.unstubAllGlobals();
});

const project = {
  id: 'p1',
  name: 'Demo App',
} as ProjectRow;

const service = {
  id: 'svc-1',
  project_id: project.id,
  name: 'web',
  kind: 'application',
  source: 'repo',
  runtime_role: 'application',
  status: 'running',
  assigned_port: 10101,
  container_port: 3000,
} as ServiceRow;

const connection = {
  id: 'cloudflare',
  account_id: 'account-1',
  account_name: 'Account',
  zone_id: 'zone-1',
  zone_name: 'example.com',
  tunnel_id: 'tunnel-1',
  tunnel_name: 'openlander-instance-1',
  encrypted_tunnel_token: 'unused',
  tunnel_token_iv: 'unused',
  status: 'connected',
  connector_container_id: 'connector-1',
  last_error_code: null,
  last_error_message: null,
} as CloudflareConnectionRow;

function createHarness(
  options: {
    existingDns?: CloudflareDnsRecord[];
    existingAccess?: ProjectPublicAccessRow;
    connectorState?: string;
    serviceOverrides?: Partial<ServiceRow>;
    publicRouteProbeResults?: PublicRouteProbeResult[];
    publicRouteProbeAttempts?: number;
    useDefaultPublicRouteProbe?: boolean;
  } = {},
) {
  let connectionState: CloudflareConnectionRow | null = connection;
  let access: ProjectPublicAccessRow | null = options.existingAccess ?? null;
  let mapping: DomainMappingRow | null = null;
  let serviceState = { ...service, ...options.serviceOverrides } as ServiceRow;
  const dnsRecords = [...(options.existingDns ?? [])];

  const api = {
    listDnsRecords: vi.fn(async (_zoneId: string, hostname: string) =>
      dnsRecords.filter((record) => record.name === hostname),
    ),
    createTunnelDnsRecord: vi.fn(async (_zoneId: string, hostname: string, tunnelId: string) => {
      const created = {
        id: `dns-${String(dnsRecords.length + 1)}`,
        type: 'CNAME',
        name: hostname,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
      } satisfies CloudflareDnsRecord;
      dnsRecords.push(created);
      return created;
    }),
    updateTunnelConfiguration: vi.fn().mockResolvedValue(undefined),
    listTunnels: vi
      .fn()
      .mockResolvedValue([
        { id: connection.tunnel_id, name: connection.tunnel_name, status: 'healthy' },
      ]),
    cleanupTunnelConnections: vi.fn().mockResolvedValue(undefined),
    deleteTunnel: vi.fn().mockResolvedValue(undefined),
    deleteDnsRecord: vi.fn(async (_zoneId: string, recordId: string) => {
      const index = dnsRecords.findIndex((record) => record.id === recordId);
      if (index >= 0) dnsRecords.splice(index, 1);
    }),
  } as unknown as CloudflareApiClient;

  const db = {
    getCloudflareConnection: vi.fn(async () => connectionState),
    updateCloudflareConnection: vi.fn(async (patch: Record<string, unknown>) => {
      if (!connectionState) return null;
      connectionState = {
        ...connectionState,
        ...(patch['status'] ? { status: patch['status'] } : {}),
        ...(patch['connectorContainerId'] !== undefined
          ? { connector_container_id: patch['connectorContainerId'] }
          : {}),
        ...(patch['lastErrorCode'] !== undefined
          ? { last_error_code: patch['lastErrorCode'] }
          : {}),
        ...(patch['lastErrorMessage'] !== undefined
          ? { last_error_message: patch['lastErrorMessage'] }
          : {}),
      } as CloudflareConnectionRow;
      return connectionState;
    }),
    deleteCloudflareConnection: vi.fn(async () => {
      connectionState = null;
      return true;
    }),
    getProject: vi.fn(async (id: string) => (id === project.id ? project : null)),
    getService: vi.fn(async (id: string) => (id === service.id ? serviceState : null)),
    getDeployablesByGroup: vi.fn().mockResolvedValue([service]),
    getComposeChildren: vi.fn().mockResolvedValue([]),
    getProjectPublicAccess: vi.fn(async () => access),
    getProjectPublicAccessByHostname: vi.fn(async (hostname: string) =>
      access?.hostname === hostname ? access : null,
    ),
    listProjectPublicAccess: vi.fn(async () => (access ? [access] : [])),
    upsertProjectPublicAccess: vi.fn(async (input: Record<string, unknown>) => {
      access = {
        project_id: String(input['projectId']),
        service_id: String(input['serviceId']),
        connection_id: connection.id,
        hostname: String(input['hostname']),
        cloudflare_zone_id: String(input['cloudflareZoneId']),
        cloudflare_dns_record_id: (input['cloudflareDnsRecordId'] as string | null) ?? null,
        domain_mapping_id: (input['domainMappingId'] as string | null) ?? null,
        status: (input['status'] as ProjectPublicAccessRow['status']) ?? 'private',
        last_error_code: null,
        last_error_message: null,
        published_at: null,
      } as ProjectPublicAccessRow;
      return access;
    }),
    updateProjectPublicAccess: vi.fn(async (projectId: string, patch: Record<string, unknown>) => {
      if (!access || access.project_id !== projectId) return null;
      const fields: Record<string, keyof ProjectPublicAccessRow> = {
        serviceId: 'service_id',
        connectionId: 'connection_id',
        hostname: 'hostname',
        cloudflareZoneId: 'cloudflare_zone_id',
        cloudflareDnsRecordId: 'cloudflare_dns_record_id',
        domainMappingId: 'domain_mapping_id',
        status: 'status',
        lastErrorCode: 'last_error_code',
        lastErrorMessage: 'last_error_message',
        publishedAt: 'published_at',
      };
      const updated = { ...access } as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        const field = fields[key];
        if (field) updated[field] = value;
      }
      access = updated as ProjectPublicAccessRow;
      return access;
    }),
    deleteProjectPublicAccess: vi.fn(async () => {
      access = null;
      return true;
    }),
    findDomainMappingByHostAndPath: vi.fn(async (hostname: string) =>
      mapping?.domain === hostname ? mapping : null,
    ),
    listDomainMappingsForService: vi.fn(async () => (mapping ? [mapping] : [])),
    createDomainMappingForService: vi.fn(async (input: Record<string, unknown>) => {
      mapping = {
        id: String(input['id']),
        service_id: String(input['serviceId']),
        domain: String(input['domain']),
      } as DomainMappingRow;
      return mapping;
    }),
    deleteDomainMapping: vi.fn(async (id: string) => {
      if (mapping?.id !== id) return false;
      mapping = null;
      return true;
    }),
    updateService: vi.fn(
      async (_id: string, patch: Partial<ServiceRow> & { publicUrl?: string | null }) => {
        serviceState = {
          ...serviceState,
          ...patch,
          ...(patch.publicUrl !== undefined ? { public_url: patch.publicUrl } : {}),
        };
        return serviceState;
      },
    ),
  } as unknown as Database;

  let connectorContainer: Record<string, unknown> | null = {
    id: 'connector-1',
    name: 'cloudflared-ol',
    state: options.connectorState ?? 'running',
    status:
      options.connectorState === 'running' || options.connectorState === undefined
        ? 'Up'
        : 'Exited',
    labels: {
      'openlander.managed': 'true',
      'openlander.role': 'cloudflared',
      'openlander.instance': 'instance-1',
      'openlander.cloudflare.tunnel_id': connection.tunnel_id,
    },
  };
  const runtime = {
    listAllContainers: vi.fn(async () => (connectorContainer ? [connectorContainer] : [])),
    safeRemoveContainer: vi.fn(async () => {
      connectorContainer = null;
    }),
    pullImage: vi.fn().mockResolvedValue(undefined),
    runInfraContainer: vi.fn(async (config: Record<string, unknown>) => {
      connectorContainer = {
        id: 'connector-2',
        name: 'cloudflared-ol',
        state: 'running',
        status: 'Up',
        labels: {
          'openlander.managed': 'true',
          ...(config['Labels'] as Record<string, string>),
        },
      };
      return 'connector-2';
    }),
  } as unknown as RuntimeBackend;

  const publicRouteProbeResults = [
    ...(options.publicRouteProbeResults ?? [{ kind: 'reachable', status: 200 }]),
  ];
  const publicRouteProbe = vi.fn(async () =>
    Promise.resolve(
      publicRouteProbeResults.shift() ?? ({ kind: 'reachable', status: 200 } as const),
    ),
  );

  const manager = new ConnectedPublishManager(
    {
      apiToken: '',
      accountId: '',
      tunnelId: '',
      oauthClientId: 'client-id',
      oauthRedirectUri: 'https://openlander.example/cloudflare-oauth-callback.html',
      oauthScopes: [],
    },
    db,
    new EventBus(),
    {
      runtime,
      instanceId: 'instance-1',
      apiFactory: () => api,
      ...(options.useDefaultPublicRouteProbe ? {} : { publicRouteProbe }),
      publicRouteProbeAttempts: options.publicRouteProbeAttempts ?? 3,
      publicRouteProbeIntervalMs: 0,
    },
  );

  return {
    api,
    db,
    manager,
    publicRouteProbe,
    runtime,
    getAccess: () => access,
    getMapping: () => mapping,
    getService: () => serviceState,
  };
}

describe('ConnectedPublishManager', () => {
  it('repairs a stopped owned connector without requiring another OAuth roundtrip', async () => {
    const harness = createHarness({ connectorState: 'exited' });

    await expect(
      harness.manager.connect({ accountId: connection.account_id, zoneId: connection.zone_id }),
    ).resolves.toMatchObject({
      status: 'connected',
      connector: { status: 'running' },
    });

    expect(harness.runtime.safeRemoveContainer).toHaveBeenCalledWith('connector-1');
    expect(harness.runtime.pullImage).toHaveBeenCalledOnce();
    expect(harness.runtime.runInfraContainer).toHaveBeenCalledOnce();
  });

  it('records an expired OAuth token as a connection error during reconciliation', async () => {
    const harness = createHarness();
    vi.mocked(getValidToken).mockResolvedValueOnce(null);

    await expect(harness.manager.reconcile()).rejects.toMatchObject({
      code: 'CLOUDFLARE_NOT_CONNECTED',
    });
    expect(harness.db.updateCloudflareConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'error',
        lastErrorCode: 'CLOUDFLARE_NOT_CONNECTED',
      }),
    );
  });

  it('publishes asynchronously and preserves the hostname across unpublish and republish', async () => {
    const harness = createHarness();

    await expect(
      harness.manager.requestPublish({ projectId: project.id, serviceId: service.id }),
    ).resolves.toMatchObject({ status: 'provisioning', public_url: null });
    await harness.manager.waitForPendingOperations();

    const published = await harness.manager.getPublicAccess(project.id);
    expect(published).toMatchObject({
      status: 'public',
      public_url: 'https://demo-app.example.com',
      hostname: 'demo-app.example.com',
    });

    await harness.manager.requestUnpublish(project.id);
    await harness.manager.waitForPendingOperations();
    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'private',
      public_url: null,
      hostname: 'demo-app.example.com',
    });

    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();
    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'public',
      public_url: 'https://demo-app.example.com',
    });
    expect(harness.api.createTunnelDnsRecord).toHaveBeenCalledTimes(1);
  });

  it('keeps provisioning until the public route is externally reachable', async () => {
    const harness = createHarness({
      publicRouteProbeResults: [
        { kind: 'unreachable' },
        { kind: 'application_unhealthy', status: 503 },
        { kind: 'reachable', status: 200 },
      ],
    });

    await expect(
      harness.manager.requestPublish({ projectId: project.id, serviceId: service.id }),
    ).resolves.toMatchObject({ status: 'provisioning', public_url: null });
    await harness.manager.waitForPendingOperations();

    expect(harness.publicRouteProbe).toHaveBeenCalledTimes(3);
    expect(harness.publicRouteProbe).toHaveBeenCalledWith('https://demo-app.example.com');
    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'public',
      public_url: 'https://demo-app.example.com',
      error: null,
    });
  });

  it('checks the external HTTPS URL with a body-free HEAD request by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    const harness = createHarness({ useDefaultPublicRouteProbe: true });

    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo-app.example.com',
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'manual',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({ status: 'public' });
  });

  it('reports a route-specific error when the Cloudflare URL never becomes reachable', async () => {
    const harness = createHarness({
      publicRouteProbeResults: [{ kind: 'unreachable' }, { kind: 'unreachable' }],
      publicRouteProbeAttempts: 2,
    });

    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'error',
      public_url: null,
      error: { code: 'PUBLIC_ACCESS_ROUTE_UNREACHABLE' },
    });
    expect(harness.getMapping()).toBeNull();
    expect(harness.getService()).toMatchObject({ visibility: 'internal', public_url: null });
  });

  it('separates an application 5xx from a Cloudflare route failure', async () => {
    const harness = createHarness({
      publicRouteProbeResults: [
        { kind: 'application_unhealthy', status: 503 },
        { kind: 'application_unhealthy', status: 503 },
      ],
      publicRouteProbeAttempts: 2,
    });

    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'error',
      public_url: null,
      error: { code: 'PUBLIC_ACCESS_APPLICATION_UNHEALTHY' },
    });
  });

  it('rejects Cloudflare publishing while the protected access-code route is active', async () => {
    const harness = createHarness({
      serviceOverrides: {
        visibility: 'shared',
        access_code: 'bcrypt-hash',
        access_code_iv: 'session-secret',
      },
    });

    await expect(
      harness.manager.requestPublish({ projectId: project.id, serviceId: service.id }),
    ).rejects.toMatchObject({ code: 'PUBLIC_ACCESS_NOT_ELIGIBLE' });
    expect(harness.api.createTunnelDnsRecord).not.toHaveBeenCalled();
  });

  it('does not silently move an active Cloudflare route to another Application', async () => {
    const harness = createHarness({
      existingAccess: {
        project_id: project.id,
        service_id: 'svc-other',
        connection_id: connection.id,
        hostname: 'other.example.com',
        cloudflare_zone_id: connection.zone_id,
        cloudflare_dns_record_id: 'dns-other',
        domain_mapping_id: 'domain-other',
        status: 'public',
        last_error_code: null,
        last_error_message: null,
        published_at: '2026-08-07T00:00:00.000Z',
      } as ProjectPublicAccessRow,
    });

    await expect(
      harness.manager.requestPublish({ projectId: project.id, serviceId: service.id }),
    ).rejects.toMatchObject({ code: 'PUBLIC_ACCESS_NOT_ELIGIBLE' });
    expect(harness.getAccess()?.service_id).toBe('svc-other');
    expect(harness.api.createTunnelDnsRecord).not.toHaveBeenCalled();
  });

  it('never overwrites an existing DNS record and selects a safe hostname', async () => {
    const harness = createHarness({
      existingDns: [
        {
          id: 'foreign-a',
          type: 'A',
          name: 'demo-app.example.com',
          content: '203.0.113.10',
          proxied: true,
        },
      ],
    });

    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    expect(harness.getAccess()?.hostname).toBe('demo-app-p1.example.com');
    expect(harness.api.createTunnelDnsRecord).toHaveBeenCalledWith(
      connection.zone_id,
      'demo-app-p1.example.com',
      connection.tunnel_id,
    );
  });

  it('removes the local route before reporting a Cloudflare unpublish error', async () => {
    const harness = createHarness();
    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();
    expect(harness.getMapping()).not.toBeNull();

    vi.mocked(harness.api.updateTunnelConfiguration).mockRejectedValueOnce(
      new Error('Cloudflare unavailable'),
    );
    await harness.manager.requestUnpublish(project.id);
    await harness.manager.waitForPendingOperations();

    expect(harness.getMapping()).toBeNull();
    expect(harness.getService()).toMatchObject({ visibility: 'internal', public_url: null });
    expect(await harness.manager.getPublicAccess(project.id)).toMatchObject({
      status: 'error',
      public_url: null,
    });
  });

  it('deletes only its owned DNS reservation when the Project is deleted', async () => {
    const harness = createHarness();
    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    await harness.manager.deleteProjectReservation(project.id, service.id);

    expect(harness.api.deleteDnsRecord).toHaveBeenCalledWith('zone-1', 'dns-1');
    expect(harness.getAccess()).toBeNull();
    expect(harness.api.updateTunnelConfiguration).toHaveBeenLastCalledWith(
      connection.account_id,
      connection.tunnel_id,
      [{ service: 'http_status:404' }],
    );
  });

  it('disconnects by removing only OpenLander-owned Cloudflare and local resources', async () => {
    const harness = createHarness();
    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();

    await expect(harness.manager.disconnect()).resolves.toMatchObject({
      configured: false,
      status: 'disconnected',
    });

    expect(harness.getMapping()).toBeNull();
    expect(harness.getService()).toMatchObject({ visibility: 'internal', public_url: null });
    expect(harness.api.updateTunnelConfiguration).toHaveBeenLastCalledWith(
      connection.account_id,
      connection.tunnel_id,
      [{ service: 'http_status:404' }],
    );
    expect(harness.api.deleteDnsRecord).toHaveBeenCalledWith(connection.zone_id, 'dns-1');
    expect(harness.api.cleanupTunnelConnections).toHaveBeenCalledWith(
      connection.account_id,
      connection.tunnel_id,
    );
    expect(harness.api.deleteTunnel).toHaveBeenCalledWith(
      connection.account_id,
      connection.tunnel_id,
    );
    expect(
      vi.mocked(harness.api.cleanupTunnelConnections).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(harness.api.deleteTunnel).mock.invocationCallOrder[0] ?? 0);
    expect(harness.runtime.safeRemoveContainer).toHaveBeenCalledWith('connector-1');
    expect(harness.db.deleteCloudflareConnection).toHaveBeenCalledOnce();
    expect(deleteProviderToken).toHaveBeenCalledWith(harness.db, 'cloudflare');
  });

  it('refuses to delete a DNS record changed outside OpenLander', async () => {
    const harness = createHarness();
    await harness.manager.requestPublish({ projectId: project.id, serviceId: service.id });
    await harness.manager.waitForPendingOperations();
    vi.mocked(harness.api.listDnsRecords).mockResolvedValueOnce([
      {
        id: 'dns-1',
        type: 'A',
        name: 'demo-app.example.com',
        content: '203.0.113.10',
        proxied: true,
      },
    ]);

    await expect(harness.manager.disconnect()).rejects.toMatchObject({
      code: 'PUBLIC_ACCESS_NOT_ELIGIBLE',
    });
    expect(harness.api.deleteDnsRecord).not.toHaveBeenCalled();
    expect(harness.api.deleteTunnel).not.toHaveBeenCalled();
    expect(harness.db.deleteCloudflareConnection).not.toHaveBeenCalled();
  });
});
