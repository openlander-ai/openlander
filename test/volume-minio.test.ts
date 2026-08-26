import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServiceManagerLogger } = vi.hoisted(() => ({
  mockServiceManagerLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => mockServiceManagerLogger),
}));

import type { AppContext } from '../src/app.js';
import type { Database, ServiceRow } from '../src/db/index.js';
import {
  AVAILABLE_VERSIONS,
  SERVICE_TEMPLATES,
  ServiceManager,
} from '../src/pipeline/service-manager.js';
import {
  addVolumeSchema,
  createBucketSchema,
  removeVolumeSchema,
} from '../src/tools/defs/schemas.js';
import { serviceToolDefs } from '../src/tools/defs/service.js';
import type { ToolDef } from '../src/tools/defs/types.js';
import { volumeToolDefs } from '../src/tools/defs/volume.js';
import { createMockDockerHarness } from './helpers/docker-mocks.js';

function createService(partial: Partial<ServiceRow>): ServiceRow {
  const legacyType = partial.type ?? 'postgresql';
  // Map legacy type to canonical kind so production code (which reads kind ?? 'unknown')
  // resolves the correct adapter instead of falling back to 'unknown'.
  const typeToKind: Record<string, ServiceRow['kind']> = {
    postgresql: 'postgres',
    postgres: 'postgres',
    mysql: 'mysql',
    redis: 'redis',
    mongo: 'mongo',
    minio: 'minio',
  };
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-pg',
    type: legacyType,
    image: partial.image ?? 'postgres:16-alpine',
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'svc-1-container',
    container_name: partial.container_name ?? 'ol-svc-shared-pg',
    port: partial.port ?? 5432,
    env_vars: partial.env_vars ?? null,
    credentials:
      partial.credentials ??
      JSON.stringify({
        user: 'openlander',
        password: 'rootpw',
        database: 'openlander',
      }),
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
    kind: partial.kind ?? typeToKind[legacyType] ?? 'postgres',
    image_url: partial.image_url ?? partial.image ?? 'postgres:16-alpine',
    assigned_port: partial.assigned_port ?? partial.port ?? 5432,
  };
}

function createDbMock(services: ServiceRow[], projectEnv: Record<string, string> = {}): Database {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return {
    getService: vi.fn((id: string) => byId.get(id) ?? null),
    listServices: vi.fn(() => Array.from(byId.values())),
    getEnvVars: vi.fn(() => projectEnv),
    getEnvVarsForService: vi.fn(() => ({})),
    getDeployablesByGroup: vi.fn(() => []),
    updateService: vi.fn(),
  } as unknown as Database;
}

function createMockContext(services: ServiceRow[] = []) {
  type BucketInfo = { name: string; createdAt: string };

  const serviceManager = {
    list: vi.fn(async () => services),
    listBuckets: vi.fn<() => Promise<BucketInfo[]>>(async () => []),
    createBucket: vi.fn(async () => undefined),
    deleteBucket: vi.fn(async () => undefined),
  };

  const inspectVolume = vi.fn<(name: string) => Promise<Record<string, unknown>>>(
    async (name: string) => {
      throw new Error(`No such volume: ${name}`);
    },
  );
  const listVolumes = vi.fn<() => Promise<unknown[]>>(async () => []);
  const createVolumeMock = vi.fn(async () => undefined);
  const removeVolume = vi.fn(async () => undefined);
  const getDiskUsage = vi.fn(async () => ({ Images: [], Containers: [], Volumes: [] }));

  const docker = {
    inspectVolume,
    listVolumes,
    createVolume: createVolumeMock,
    removeVolume,
    getDiskUsage,
  };

  const ctx = {
    serviceManager,
    docker,
  } as unknown as AppContext;

  return {
    ctx,
    serviceManager,
    docker: {
      inspectVolume,
      listVolumes,
      createVolume: createVolumeMock,
      removeVolume,
      getDiskUsage,
    },
  };
}

function getMcpTool(ctx: AppContext, name: string) {
  const defs: ToolDef[] = [...serviceToolDefs, ...volumeToolDefs];
  const def = defs.find(
    (entry) => entry.name === name && (!entry.targets || entry.targets.includes('mcp')),
  );
  expect(def).toBeDefined();
  return {
    inputSchema: def!.inputSchema,
    execute: (args: Record<string, unknown>) => def!.execute(args, { target: 'mcp', appCtx: ctx }),
  };
}

describe('MinIO getSuggestedEnv', () => {
  it('returns provider-neutral object storage keys for the first MinIO service', async () => {
    const service = createService({
      id: 'svc-minio-1',
      name: 'storage',
      type: 'minio',
      credentials: JSON.stringify({
        user: 'openlander',
        password: 'abc123',
        host: 'ol-svc-storage',
        port: 9000,
        connectionString: 'http://ol-svc-storage:9000',
      }),
    });

    const manager = new ServiceManager(createMockDockerHarness().docker, createDbMock([service]));
    await expect(manager.getSuggestedEnv(service, { targetProjectId: 'proj-1' })).resolves.toEqual([
      { key: 'OBJECT_STORAGE_ENDPOINT', value: 'http://ol-svc-storage:9000' },
      { key: 'OBJECT_STORAGE_ACCESS_KEY', value: 'openlander' },
      { key: 'OBJECT_STORAGE_SECRET_KEY', value: 'abc123' },
      { key: 'OBJECT_STORAGE_PROVIDER', value: 'minio' },
    ]);
  });

  it('prefixes keys for duplicate minio services', async () => {
    const first = createService({
      id: 'svc-minio-1',
      name: 'storage',
      type: 'minio',
      credentials: JSON.stringify({
        user: 'openlander',
        password: 'abc123',
        host: 'ol-svc-storage',
        port: 9000,
        connectionString: 'http://ol-svc-storage:9000',
      }),
    });
    const second = createService({
      id: 'svc-minio-2',
      name: 'uploads-store',
      type: 'minio',
      credentials: JSON.stringify({
        user: 'another-user',
        password: 'pw456',
        host: 'ol-svc-uploads-store',
        port: 9000,
        connectionString: 'http://ol-svc-uploads-store:9000',
      }),
    });

    const manager = new ServiceManager(
      createMockDockerHarness().docker,
      createDbMock([first, second]),
    );
    await expect(manager.getSuggestedEnv(second)).resolves.toEqual([
      {
        key: 'UPLOADS_STORE_OBJECT_STORAGE_ENDPOINT',
        value: 'http://ol-svc-uploads-store:9000',
      },
      { key: 'UPLOADS_STORE_OBJECT_STORAGE_ACCESS_KEY', value: 'another-user' },
      { key: 'UPLOADS_STORE_OBJECT_STORAGE_SECRET_KEY', value: 'pw456' },
      { key: 'UPLOADS_STORE_OBJECT_STORAGE_PROVIDER', value: 'minio' },
    ]);
  });

  it('does not treat stored legacy S3/AWS keys as a neutral-key collision', async () => {
    const service = createService({
      id: 'svc-minio-new',
      name: 'storage',
      type: 'minio',
      credentials: JSON.stringify({
        user: 'new-user',
        password: 'new-password',
        connectionString: 'http://ol-svc-storage:9000',
      }),
    });
    const legacyEnv = {
      S3_ENDPOINT: 'http://ol-svc-legacy-storage:9000',
      AWS_ACCESS_KEY_ID: 'legacy-user',
      AWS_SECRET_ACCESS_KEY: 'legacy-password',
    };
    const db = createDbMock([service], legacyEnv);
    const manager = new ServiceManager(createMockDockerHarness().docker, db);

    await expect(manager.getSuggestedEnv(service, { targetProjectId: 'proj-1' })).resolves.toEqual([
      { key: 'OBJECT_STORAGE_ENDPOINT', value: 'http://ol-svc-storage:9000' },
      { key: 'OBJECT_STORAGE_ACCESS_KEY', value: 'new-user' },
      { key: 'OBJECT_STORAGE_SECRET_KEY', value: 'new-password' },
      { key: 'OBJECT_STORAGE_PROVIDER', value: 'minio' },
    ]);
    expect(legacyEnv).toEqual({
      S3_ENDPOINT: 'http://ol-svc-legacy-storage:9000',
      AWS_ACCESS_KEY_ID: 'legacy-user',
      AWS_SECRET_ACCESS_KEY: 'legacy-password',
    });
  });
});

describe('MinIO SERVICE_TEMPLATES', () => {
  it('has correct image, port, cmd', () => {
    expect(SERVICE_TEMPLATES.minio).toBeDefined();
    expect(SERVICE_TEMPLATES.minio.type).toBe('minio');
    expect(SERVICE_TEMPLATES.minio.port).toBe(9000);
    expect(SERVICE_TEMPLATES.minio.cmd).toEqual(['server', '/data', '--console-address', ':9001']);
  });

  it('generates correct env vars', () => {
    const env = SERVICE_TEMPLATES.minio.env({ user: 'u', password: 'p', database: '' });
    expect(env).toContain('MINIO_ROOT_USER=u');
    expect(env).toContain('MINIO_ROOT_PASSWORD=p');
  });

  it('has healthcheck configured', () => {
    expect(SERVICE_TEMPLATES.minio.healthcheck).toBeDefined();
    expect(SERVICE_TEMPLATES.minio.healthcheck!.test).toContain(
      'http://localhost:9000/minio/health/live',
    );
  });
});

describe('Volume schemas', () => {
  it('addVolumeSchema rejects invalid volume_name', () => {
    expect(() =>
      addVolumeSchema.parse({
        project_name: 'myapp',
        volume_name: 'BAD NAME',
        mount_path: '/app',
      }),
    ).toThrow();
  });

  it('addVolumeSchema rejects relative mount_path', () => {
    expect(() =>
      addVolumeSchema.parse({
        project_name: 'myapp',
        volume_name: 'uploads',
        mount_path: 'relative/path',
      }),
    ).toThrow();
  });

  it('addVolumeSchema accepts valid input', () => {
    const result = addVolumeSchema.parse({
      project_name: 'myapp',
      volume_name: 'uploads',
      mount_path: '/app/uploads',
    });
    expect(result.volume_name).toBe('uploads');
  });

  it('removeVolumeSchema rejects invalid volume_name', () => {
    expect(() =>
      removeVolumeSchema.parse({
        project_name: 'myapp',
        volume_name: 'BAD NAME',
      }),
    ).toThrow();
  });

  it('createBucketSchema validates S3 naming rules', () => {
    expect(() =>
      createBucketSchema.parse({ service_name: 'storage', bucket_name: 'AB' }),
    ).toThrow();
    expect(() =>
      createBucketSchema.parse({ service_name: 'storage', bucket_name: 'UPPERCASE' }),
    ).toThrow();
    const result = createBucketSchema.parse({ service_name: 'storage', bucket_name: 'my-bucket' });
    expect(result.bucket_name).toBe('my-bucket');
  });
});

describe('AVAILABLE_VERSIONS', () => {
  it('includes minio with at least one version', () => {
    expect(AVAILABLE_VERSIONS.minio).toBeDefined();
    expect(AVAILABLE_VERSIONS.minio.length).toBeGreaterThan(0);
  });
});

describe('MCP volume and bucket tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes new volume and bucket MCP tools', () => {
    const names = [...serviceToolDefs, ...volumeToolDefs]
      .filter((def) => !def.targets || def.targets.includes('mcp'))
      .map((def) => def.name);

    for (const toolName of [
      'add_volume',
      'list_volumes',
      'remove_volume',
      'get_disk_usage',
      'create_bucket',
      'list_buckets',
      'delete_bucket',
    ]) {
      expect(names).toContain(toolName);
    }
  });

  it('bucket tools handle success and missing service paths', async () => {
    const services = [
      createService({ id: 'svc-minio', name: 'storage', type: 'minio', port: 9000 }),
    ];
    const { ctx, serviceManager } = createMockContext(services);

    serviceManager.listBuckets.mockResolvedValueOnce([
      { name: 'assets', createdAt: '2026-03-23T00:00:00.000Z' },
    ]);

    const listBucketsTool = getMcpTool(ctx, 'list_buckets');
    const createBucketTool = getMcpTool(ctx, 'create_bucket');
    const deleteBucketTool = getMcpTool(ctx, 'delete_bucket');

    await expect(listBucketsTool.execute({ service_name: 'storage' })).resolves.toEqual({
      service: 'storage',
      count: 1,
      buckets: [{ name: 'assets', createdAt: '2026-03-23T00:00:00.000Z' }],
    });

    await expect(
      createBucketTool.execute({ service_name: 'storage', bucket_name: 'my-bucket' }),
    ).resolves.toEqual({
      status: 'created',
      service: 'storage',
      bucket: 'my-bucket',
      _agent_guidance: {
        message:
          'The bucket was created only in this MinIO resource. OpenLander did not update application env, provision a cloud bucket, copy objects, or rewrite persisted object locations.',
        next_steps: [
          'Save OBJECT_STORAGE_BUCKET=my-bucket and an optional OBJECT_STORAGE_PREFIX on the target workload, then call update_app to apply them.',
          'For migration portability, persist an opaque object key rather than a full s3://, gs://, or provider HTTP URL.',
        ],
      },
    });
    expect(serviceManager.createBucket).toHaveBeenCalledWith('svc-minio', 'my-bucket');

    await expect(
      deleteBucketTool.execute({ service_name: 'storage', bucket_name: 'my-bucket' }),
    ).resolves.toEqual({
      status: 'deleted',
      service: 'storage',
      bucket: 'my-bucket',
      warning: 'Bucket and all its contents have been permanently deleted.',
    });
    expect(serviceManager.deleteBucket).toHaveBeenCalledWith('svc-minio', 'my-bucket');

    await expect(listBucketsTool.execute({ service_name: 'missing' })).rejects.toThrow(
      'Service not found: missing',
    );
  });

  it('add_volume returns created payload and surfaces duplicate managed volume error', async () => {
    const { ctx, docker } = createMockContext();
    const addVolumeTool = getMcpTool(ctx, 'add_volume');

    await expect(
      addVolumeTool.execute({
        project_name: 'myapp',
        volume_name: 'uploads',
        mount_path: '/app/uploads',
      }),
    ).resolves.toEqual({
      status: 'created',
      volume: 'ol-vol-myapp-uploads',
      project: 'myapp',
      mount_path: '/app/uploads',
    });

    expect(docker.createVolume).toHaveBeenCalledWith({
      name: 'ol-vol-myapp-uploads',
      labels: {
        'openlander.role': 'volume',
        'openlander.project': 'myapp',
        'openlander.volume': 'uploads',
        'openlander.mount_path': '/app/uploads',
      },
    });

    docker.inspectVolume.mockResolvedValueOnce({
      Labels: { 'openlander.managed': 'true' },
    });

    await expect(
      addVolumeTool.execute({
        project_name: 'myapp',
        volume_name: 'uploads',
        mount_path: '/app/uploads',
      }),
    ).rejects.toThrow('already exists for project "myapp"');
  });

  it('add_volume rejects duplicate mount_path within same project', async () => {
    const { ctx, docker } = createMockContext();
    const addVolumeTool = getMcpTool(ctx, 'add_volume');

    docker.listVolumes.mockResolvedValueOnce([
      {
        Name: 'ol-vol-myapp-data-a',
        Labels: {
          'openlander.managed': 'true',
          'openlander.role': 'volume',
          'openlander.project': 'myapp',
          'openlander.volume': 'data-a',
          'openlander.mount_path': '/app/data',
        },
      },
    ]);

    await expect(
      addVolumeTool.execute({
        project_name: 'myapp',
        volume_name: 'data-b',
        mount_path: '/app/data',
      }),
    ).rejects.toThrow('Mount path "/app/data" is already in use by volume "data-a"');
  });

  it('list_volumes maps labels and remove_volume rejects unmanaged then succeeds for managed volume', async () => {
    const { ctx, docker } = createMockContext();
    const listVolumesTool = getMcpTool(ctx, 'list_volumes');
    const removeVolumeTool = getMcpTool(ctx, 'remove_volume');

    docker.listVolumes.mockResolvedValueOnce([
      {
        Name: 'ol-vol-myapp-uploads',
        Labels: {
          'openlander.managed': 'true',
          'openlander.role': 'volume',
          'openlander.project': 'myapp',
          'openlander.volume': 'uploads',
          'openlander.mount_path': '/app/uploads',
        },
        UsageData: { Size: 512 },
      },
    ]);
    docker.inspectVolume.mockResolvedValueOnce({
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'volume',
        'openlander.project': 'myapp',
        'openlander.volume': 'uploads',
        'openlander.mount_path': '/app/uploads',
      },
      UsageData: { Size: 1024 },
    });

    await expect(listVolumesTool.execute({ project_name: 'myapp' })).resolves.toEqual({
      count: 1,
      volumes: [
        {
          name: 'ol-vol-myapp-uploads',
          project: 'myapp',
          volumeName: 'uploads',
          mountPath: '/app/uploads',
          sizeBytes: 1024,
        },
      ],
    });

    docker.inspectVolume.mockResolvedValueOnce({
      Labels: { 'openlander.managed': 'false' },
    });
    await expect(
      removeVolumeTool.execute({ project_name: 'myapp', volume_name: 'uploads' }),
    ).rejects.toThrow('not an OpenLander-managed volume');

    docker.inspectVolume.mockResolvedValueOnce({
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'volume',
      },
    });
    await expect(
      removeVolumeTool.execute({ project_name: 'myapp', volume_name: 'uploads' }),
    ).resolves.toEqual({
      status: 'removed',
      volume: 'ol-vol-myapp-uploads',
      warning: 'All data in this volume has been permanently deleted.',
    });
    expect(docker.removeVolume).toHaveBeenCalledWith('ol-vol-myapp-uploads');
  });

  it('get_disk_usage returns a structured unavailable payload when Docker df times out', async () => {
    const { ctx, docker } = createMockContext();
    const getDiskUsageTool = getMcpTool(ctx, 'get_disk_usage');

    docker.getDiskUsage.mockRejectedValueOnce(new Error('Docker disk usage timeout (5000ms)'));

    await expect(getDiskUsageTool.execute({})).resolves.toMatchObject({
      unavailable: true,
      error: 'DOCKER_DISK_USAGE_UNAVAILABLE',
      message: 'Docker disk usage timeout (5000ms)',
      images: { count: 0, totalSizeBytes: 0 },
      containers: { count: 0, totalSizeBytes: 0 },
      volumes: { count: 0, totalSizeBytes: 0, managed: [] },
    });
  });
});
