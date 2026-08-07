import { describe, expect, it, vi } from 'vitest';

import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Database, DomainMappingRow, ProjectRow, ServiceRow } from '../../src/db/index.js';
import {
  normalizeProtectedSharePublicHost,
  ProtectedPublicShareManager,
} from '../../src/pipeline/protected-public-share.js';
import type { TraefikManager } from '../../src/pipeline/traefik.js';

const NOW = '2026-08-07T00:00:00.000Z';

function project(): ProjectRow {
  return {
    id: 'project-1',
    name: 'demo',
    display_name: 'Demo',
    description: null,
    tags: null,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
  };
}

function service(): ServiceRow {
  return {
    id: 'service-web',
    project_id: 'project-1',
    name: 'web',
    kind: 'git',
    parent_service_id: null,
    runtime_role: 'application',
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: 'container-web',
    container_name: 'ol-demo-web',
    container_port: 3000,
    image_tag: 'demo:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/example/demo',
    git_credential_id: null,
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    recovering_started_at: null,
    credentials: null,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    server_id: 'local',
  };
}

function harness(options?: { enabled?: boolean; publicHost?: string; acmeEmail?: string }) {
  const row = service();
  const owner = project();
  const mappings: DomainMappingRow[] = [];
  const db = {
    getProject: vi.fn(async (id: string) => (id === owner.id ? owner : undefined)),
    getService: vi.fn(async (id: string) => (id === row.id ? row : undefined)),
    getDeployablesByGroup: vi.fn(async () => [row]),
    getProjectPublicAccess: vi.fn(async () => null),
    getComposeChildren: vi.fn(async () => []),
    listDomainMappingsForService: vi.fn(async () => mappings),
    findDomainMappingByHostAndPath: vi.fn(async (hostname: string) =>
      mappings.find((mapping) => mapping.domain === hostname),
    ),
    createDomainMappingForService: vi.fn(
      async (input: {
        id: string;
        serviceId: string;
        domain: string;
        tlsEnabled?: boolean;
        tlsResolver?: string | null;
      }) => {
        const mapping: DomainMappingRow = {
          id: input.id,
          service_id: input.serviceId,
          domain: input.domain,
          cloudflare_zone_id: null,
          cloudflare_dns_record_id: null,
          status: 'active',
          path_prefix: '/',
          strip_prefix: false,
          upstream_path_prefix: null,
          target_port: null,
          tls_enabled: input.tlsEnabled ?? null,
          tls_resolver: input.tlsResolver ?? null,
          created_at: NOW,
          updated_at: NOW,
        };
        mappings.push(mapping);
        return mapping;
      },
    ),
    updateDomainMapping: vi.fn(async (id: string, patch: { status?: string }) => {
      const mapping = mappings.find((candidate) => candidate.id === id);
      if (!mapping) return undefined;
      if (patch.status !== undefined) {
        mapping.status = patch.status as DomainMappingRow['status'];
      }
      return mapping;
    }),
    updateService: vi.fn(
      async (
        _id: string,
        patch: {
          visibility?: ServiceRow['visibility'];
          publicUrl?: string | null;
          accessCode?: string | null;
          accessCodeIv?: string | null;
        },
      ) => {
        if (patch.visibility !== undefined) row.visibility = patch.visibility;
        if (patch.publicUrl !== undefined) row.public_url = patch.publicUrl;
        if (patch.accessCode !== undefined) row.access_code = patch.accessCode;
        if (patch.accessCodeIv !== undefined) row.access_code_iv = patch.accessCodeIv;
      },
    ),
    listProjects: vi.fn(async () => [owner]),
    listServices: vi.fn(async () => [row]),
  } as unknown as Database;
  const traefik = {
    start: vi.fn(async () => undefined),
    connectToNetwork: vi.fn(async () => undefined),
  } as unknown as TraefikManager;
  const config = {
    traefik: {
      mode: 'managed',
      externalNetwork: undefined,
      protectedShare: {
        enabled: options?.enabled ?? false,
        publicHost: options?.publicHost ?? '34.64.12.34',
        acmeEmail: options?.acmeEmail ?? 'admin@example.com',
      },
    },
  } as OpenLanderConfig;
  const persistConfig = vi.fn();
  return {
    manager: new ProtectedPublicShareManager(db, config, traefik, persistConfig),
    row,
    mappings,
    db,
    traefik,
    config,
    persistConfig,
  };
}

describe('ProtectedPublicShareManager', () => {
  it('normalizes only valid public IPv4 addresses and base domains', () => {
    expect(normalizeProtectedSharePublicHost('https://share.example.com/path')).toBe(
      'share.example.com',
    );
    expect(normalizeProtectedSharePublicHost('34.64.12.34')).toBe('34.64.12.34');
    expect(normalizeProtectedSharePublicHost('999.64.12.34')).toBe('');
    expect(normalizeProtectedSharePublicHost('localhost')).toBe('');
  });

  it('creates a stable sslip.io HTTPS route and returns the access code only once', async () => {
    const { manager, row, mappings, traefik, config, persistConfig } = harness();
    const result = await manager.expose({ projectId: row.project_id, serviceId: row.id });

    expect(result).toMatchObject({
      status: 'public',
      provider: 'protected_share',
      project_id: row.project_id,
      service_id: row.id,
      access_code_configured: true,
    });
    expect(result.access_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(result.hostname).toMatch(/^web-[a-f0-9]{6}\.34-64-12-34\.sslip\.io$/);
    expect(row.access_code).toMatch(/^\$2/);
    expect(row.access_code).not.toContain(result.access_code!);
    expect(row.access_code_iv).toBeTruthy();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ tls_enabled: true, tls_resolver: 'openlander' });
    expect(traefik.start).toHaveBeenCalledOnce();
    expect(config.traefik.protectedShare.enabled).toBe(true);
    expect(persistConfig).toHaveBeenCalledOnce();

    const repeated = await manager.expose({ projectId: row.project_id, serviceId: row.id });
    expect(repeated.access_code).toBeUndefined();
    expect(repeated.public_url).toBe(result.public_url);
    expect(mappings).toHaveLength(1);
  });

  it('binds sessions to one hostname and invalidates them after code rotation', async () => {
    const { manager, row } = harness();
    const initial = await manager.expose({ projectId: row.project_id, serviceId: row.id });
    const token = manager.createSessionToken(row, initial.hostname!);

    expect(manager.verifyAccessCode(row, initial.access_code!)).toBe(true);
    expect(manager.validateSessionToken(row, initial.hostname!, token)).toBe(true);
    expect(manager.validateSessionToken(row, `other.${initial.hostname!}`, token)).toBe(false);

    const rotated = await manager.expose({
      projectId: row.project_id,
      serviceId: row.id,
      rotateAccessCode: true,
    });
    expect(rotated.access_code).not.toBe(initial.access_code);
    expect(manager.validateSessionToken(row, initial.hostname!, token)).toBe(false);
  });

  it('keeps the hostname reservation but removes credentials and invalidates sessions on disable', async () => {
    const { manager, row, mappings } = harness();
    const exposed = await manager.expose({ projectId: row.project_id, serviceId: row.id });
    const token = manager.createSessionToken(row, exposed.hostname!);

    const disabled = await manager.unexpose({ projectId: row.project_id, serviceId: row.id });

    expect(disabled.status).toBe('private');
    expect(disabled.public_url).toBeNull();
    expect(disabled.hostname).toBe(exposed.hostname);
    expect(row.visibility).toBe('internal');
    expect(row.public_url).toBeNull();
    expect(row.access_code).toBeNull();
    expect(row.access_code_iv).toBeNull();
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.status).toBe('pending');
    expect(manager.validateSessionToken(row, exposed.hostname!, token)).toBe(false);

    const republished = await manager.expose({
      projectId: row.project_id,
      serviceId: row.id,
    });
    expect(republished.hostname).toBe(exposed.hostname);
    expect(republished.access_code).toBeDefined();
    expect(mappings[0]?.status).toBe('active');
  });

  it('rejects exposure until the global host and ACME email are configured', async () => {
    const { manager, row } = harness({ publicHost: '', acmeEmail: '' });
    await expect(
      manager.expose({ projectId: row.project_id, serviceId: row.id }),
    ).rejects.toMatchObject({
      code: 'PROTECTED_SHARE_SETUP_REQUIRED',
      details: { missing: ['public_host', 'acme_email'] },
    });
  });

  it('restores HTTP-only Traefik and keeps the service private when port 443 is occupied', async () => {
    const { manager, row, mappings, traefik, config, persistConfig } = harness();
    vi.mocked(traefik.start)
      .mockRejectedValueOnce(new Error('Bind for 0.0.0.0:443 failed: port is already allocated'))
      .mockResolvedValueOnce(undefined);

    await expect(
      manager.expose({ projectId: row.project_id, serviceId: row.id }),
    ).rejects.toMatchObject({
      code: 'PROTECTED_SHARE_HTTPS_PORT_UNAVAILABLE',
      statusCode: 409,
      details: { port: 443, reason: 'host_port_in_use' },
    });

    expect(config.traefik.protectedShare.enabled).toBe(false);
    expect(persistConfig).toHaveBeenCalledTimes(2);
    expect(traefik.start).toHaveBeenCalledTimes(2);
    expect(mappings).toHaveLength(0);
    expect(row.visibility).toBe('internal');
    expect(row.public_url).toBeNull();
  });
});
