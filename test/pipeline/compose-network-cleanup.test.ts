import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SHARED_NETWORK_NAME } from '../../src/config/index.js';
import {
  ComposePipeline,
  fingerprintComposeServices,
  inferComposeRuntimeRoles,
  type ComposeDeployConfig,
} from '../../src/pipeline/compose.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { clearPortReservations, clearPortScanCache } from '../../src/pipeline/port.js';
import type { EventBus } from '../../src/events/index.js';
import type { Database, ProjectRow } from '../../src/db/index.js';

const REQUIRED_ENV_VARS = { API_KEY: 'test-api-key' };

type ProjectInput = {
  id: string;
  name: string;
  repoUrl?: string;
  branch?: string;
  parentProjectId?: string;
  dockerfilePath?: string;
  buildMethod?: string;
  runtimeRole?: 'application' | 'job' | 'resource';
};

type ProjectPatch = {
  status?: ProjectRow['status'];
  containerId?: string | null;
  containerName?: string | null;
  assignedPort?: number | null;
  containerPort?: number | null;
  imageTag?: string;
  dockerfilePath?: string;
  buildMethod?: string;
};

function createFakeDb() {
  const projects = new Map<string, ProjectRow>();
  const deployLogs: unknown[] = [];
  const deployConfigs = new Map<string, { config_json: string }>();

  return {
    createProject: vi.fn(async (input: ProjectInput) => {
      projects.set(input.id, {
        id: input.id,
        name: input.name,
        status: 'created',
        repo_url: input.repoUrl ?? '',
        branch: input.branch ?? null,
        dockerfile_path: input.dockerfilePath ?? null,
        build_method: input.buildMethod ?? null,
        container_id: null,
        assigned_port: null,
        image_tag: null,
        archived_at: null,
        parent_project_id: input.parentProjectId ?? null,
        service_id: `${input.id}__svc`,
      } as ProjectRow);
    }),
    updateProject: vi.fn(async (id: string, patch: ProjectPatch) => {
      const current = projects.get(id);
      if (!current) return;
      if (patch.status !== undefined) current.status = patch.status;
      if (patch.containerId !== undefined) current.container_id = patch.containerId;
      if (patch.containerName !== undefined) current.container_name = patch.containerName;
      if (patch.assignedPort !== undefined) current.assigned_port = patch.assignedPort;
      if (patch.containerPort !== undefined) current.container_port = patch.containerPort;
      if (patch.imageTag !== undefined) current.image_tag = patch.imageTag;
      if (patch.dockerfilePath !== undefined) current.dockerfile_path = patch.dockerfilePath;
      if (patch.buildMethod !== undefined) current.build_method = patch.buildMethod;
      if (patch.runtimeRole !== undefined) {
        (current as ProjectRow & { runtime_role: string }).runtime_role = patch.runtimeRole;
      }
    }),
    getComposeChildProjects: vi.fn(async (parentId: string) =>
      [...projects.values()].filter((project) => project.parent_project_id === parentId),
    ),
    deleteProjectDependenciesByProject: vi.fn(async () => undefined),
    createProjectDependency: vi.fn(async () => undefined),
    createDeployLog: vi.fn(async (log: unknown) => {
      deployLogs.push(log);
    }),
    getUsedPorts: vi.fn(async () => []),
    loadDeployConfigForService: vi.fn(async (serviceId: string) => deployConfigs.get(serviceId)),
    _projects: projects,
    _deployLogs: deployLogs,
    _deployConfigs: deployConfigs,
  } as unknown as Database & {
    _projects: Map<string, ProjectRow>;
    _deployLogs: unknown[];
    _deployConfigs: Map<string, { config_json: string }>;
  };
}

function createFakeDocker(overrides: Partial<Docker> = {}): Docker {
  return {
    listAllContainers: vi.fn().mockResolvedValue([]),
    ensureProjectNetwork: vi.fn().mockResolvedValue('stack-network'),
    pullImage: vi.fn().mockResolvedValue(undefined),
    buildComposeService: vi.fn().mockResolvedValue(undefined),
    runComposeService: vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    inspectContainer: vi.fn().mockResolvedValue({ State: { Running: true, ExitCode: 0 } }),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
    disconnectContainerFromNetwork: vi.fn().mockResolvedValue(undefined),
    seedVolumeFromDirectory: vi.fn().mockResolvedValue(undefined),
    getNetworkName: vi.fn().mockReturnValue(SHARED_NETWORK_NAME),
    ...overrides,
  } as unknown as Docker;
}

function createEventBus(): EventBus {
  return { emit: vi.fn(async () => undefined) } as unknown as EventBus;
}

describe('compose network cleanup', () => {
  let tmpDir: string;
  let composePath: string;

  async function deployWithEnv(pipeline: ComposePipeline, config: ComposeDeployConfig) {
    return pipeline.deployCompose({
      ...config,
      envVars: { ...REQUIRED_ENV_VARS, ...(config.envVars ?? {}) },
    });
  }

  beforeEach(() => {
    clearPortReservations();
    clearPortScanCache();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-network-cleanup-test-'));
    composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, `services:\n  web:\n    image: nginx\n`, 'utf8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists routable runtime identity and passes the service name as a network alias', async () => {
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    expose:\n      - "3000"\n`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.trafficService).toBe('web');
    expect(result.trafficServiceProjectId).toBeDefined();
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-stack-web',
        networks: ['stack-network'],
        aliases: ['web'],
      }),
    );
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/web'),
    ).toMatchObject({
      container_id: 'container-ol-stack-web',
      container_name: 'ol-stack-web',
      assigned_port: expect.any(Number),
      container_port: 3000,
    });
  });

  it('uses the selected development environment port policy', async () => {
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    expose:\n      - "3000"\n`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const pipeline = new ComposePipeline(
      createFakeDocker({ runComposeService } as Partial<Docker>),
      createFakeDb(),
      createEventBus(),
    );

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      environmentType: 'development',
    });

    expect(result.success).toBe(true);
    const runConfig = runComposeService.mock.calls[0]?.[0] as { port?: number } | undefined;
    expect(runConfig?.port).toBeGreaterThanOrEqual(20_001);
    expect(runConfig?.port).toBeLessThanOrEqual(20_999);
  });

  it('requires an explicit traffic target when multiple applications expose ports', async () => {
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    expose: ["3000"]\n  api:\n    image: node:22\n    expose: ["4000"]\n`,
      'utf8',
    );
    const pipeline = new ComposePipeline(createFakeDocker(), createFakeDb(), createEventBus());

    await expect(
      deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
      }),
    ).rejects.toMatchObject({ code: 'TRAFFIC_SERVICE_REQUIRED' });
  });

  it('keeps an existing compose parent deployable when its traffic target is unresolved', async () => {
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    expose: ["3000"]\n  api:\n    image: node:22\n    expose: ["4000"]\n`,
      'utf8',
    );
    const pipeline = new ComposePipeline(createFakeDocker(), createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      _parentId: 'existing-parent',
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toContain('traffic_target_unresolved');
    expect(result.trafficService).toBeUndefined();
  });

  it('retries once after Docker reports a stale network endpoint conflict', async () => {
    const runComposeService = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '(HTTP code 403) unexpected - endpoint with name ol-stack-web already exists in network stack-network',
        ),
      )
      .mockResolvedValueOnce('container-ol-stack-web');
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledTimes(2);
    expect(docker.disconnectContainerFromNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
      'stack-network',
    );
  });

  it('cleans compose network endpoints when service startup fails', async () => {
    const runComposeService = vi.fn().mockRejectedValue(new Error('container start failed'));
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(docker.disconnectContainerFromNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
      'stack-network',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
    );
  });

  it('keeps resource ports internal, interpolates env defaults, and scopes named volumes', async () => {
    writeFileSync(
      composePath,
      `services:
  db:
    image: postgres:16
    ports:
      - "\${DB_PORT:-5432}:5432"
    environment:
      POSTGRES_PASSWORD: "\${POSTGRES_PASSWORD:-local-password}"
    volumes:
      - pgdata:/var/lib/postgresql/data
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        containerPort: 5432,
        exposedPorts: [5432],
        traefikLabels: {},
        envVars: expect.objectContaining({ POSTGRES_PASSWORD: 'local-password' }),
        extraBinds: ['ol-stack-volume-pgdata:/var/lib/postgresql/data'],
      }),
    );
    const call = runComposeService.mock.calls[0]?.[0] as
      { port?: number; additionalPorts?: unknown[] } | undefined;
    expect(call?.port).toBeUndefined();
    expect(call?.additionalPorts).toEqual([]);
    expect([...db._projects.values()].find((project) => project.name === 'stack/db')).toMatchObject(
      {
        assigned_port: null,
        container_port: 5432,
        runtime_role: 'resource',
      },
    );
  });

  it('fingerprints environment value changes without persisting the raw values', () => {
    const initial = fingerprintComposeServices([
      {
        name: 'db',
        image: 'postgres:16',
        environment: {
          POSTGRES_DB: 'app',
          POSTGRES_PASSWORD: 'do-not-store-this-secret',
        },
      },
    ]);
    const changed = fingerprintComposeServices([
      {
        name: 'db',
        image: 'postgres:16',
        environment: {
          POSTGRES_DB: 'app_v2',
          POSTGRES_PASSWORD: 'do-not-store-this-secret',
        },
      },
    ]);

    expect(changed.db).not.toBe(initial.db);
    expect(JSON.stringify(initial)).not.toContain('do-not-store-this-secret');
  });

  it('snapshots relative bind directories into managed volumes', async () => {
    const dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, 'reference.json'), '{}\n', 'utf8');
    writeFileSync(
      composePath,
      `services:
  api:
    image: app:latest
    volumes:
      - ./data:/data:ro
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const seedVolumeFromDirectory = vi.fn().mockResolvedValue(undefined);
    const docker = createFakeDocker({
      runComposeService,
      seedVolumeFromDirectory,
    } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(true);
    expect(seedVolumeFromDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-stack-bind-api-1',
        sourcePath: dataDir,
        imageTag: 'app:latest',
      }),
    );
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({ extraBinds: ['ol-stack-bind-api-1:/data:ro'] }),
    );
  });

  it('loads optional env_file values below explicit deployment variables', async () => {
    writeFileSync(join(tmpDir, '.env'), 'FROM_FILE=file-value\nOVERRIDE=file-value\n', 'utf8');
    writeFileSync(
      composePath,
      `services:
  api:
    image: app:latest
    env_file:
      - path: .env
        required: false
    environment:
      SERVICE_VALUE: service-value
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      envVars: { OVERRIDE: 'deployment-value' },
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          FROM_FILE: 'file-value',
          OVERRIDE: 'deployment-value',
          SERVICE_VALUE: 'service-value',
        }),
      }),
    );
  });

  it('publishes every Compose container port and applies mem_limit', async () => {
    writeFileSync(
      composePath,
      `services:
  auth:
    image: auth:latest
    mem_limit: 4g
    ports:
      - "3001:3001"
      - "3002:3002"
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        containerPort: 3001,
        additionalPorts: [expect.objectContaining({ containerPort: 3002 })],
        memoryLimitBytes: 4 * 1024 ** 3,
      }),
    );
    expect(result.services[0]?.ports).toHaveLength(2);
  });

  it('fails the stack when a leaf service does not become healthy', async () => {
    const docker = createFakeDocker({
      waitForHealthy: vi.fn().mockResolvedValue({ healthy: false, error: 'web is unhealthy' }),
    } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('web is unhealthy');
  });

  it('waits for successful one-shot jobs before starting dependents', async () => {
    writeFileSync(
      composePath,
      `services:
  db:
    image: postgres:16
  migrate:
    image: app:latest
    restart: "no"
    depends_on:
      db:
        condition: service_healthy
  api:
    image: app:latest
    depends_on:
      migrate:
        condition: service_completed_successfully
`,
      'utf8',
    );
    const inspectContainer = vi.fn().mockResolvedValue({
      State: { Running: false, ExitCode: 0 },
    });
    const docker = createFakeDocker({ inspectContainer } as Partial<Docker>);
    const pipeline = new ComposePipeline(docker, createFakeDb(), createEventBus());

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(true);
    expect(inspectContainer).toHaveBeenCalled();
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'migrate', status: 'stopped' }),
        expect.objectContaining({ name: 'api', status: 'running' }),
      ]),
    );
    const migrateCall = (docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls.find(
      ([options]) => options.name === 'ol-stack-migrate',
    )?.[0];
    expect(migrateCall).toMatchObject({
      restart: 'no',
      traefikLabels: {},
      additionalPorts: [],
    });
    expect(migrateCall).not.toHaveProperty('port');
  });

  it('classifies completed dependencies as jobs and database signatures as resources', () => {
    const roles = inferComposeRuntimeRoles([
      { name: 'web', image: 'nginx', dependsOn: ['api'] },
      {
        name: 'api',
        image: 'app',
        dependsOn: ['migrate', 'db'],
        dependsOnConditions: { migrate: 'service_completed_successfully' },
      },
      { name: 'migrate', image: 'app' },
      { name: 'db', image: 'pgvector/pgvector:pg17' },
    ]);

    expect(Object.fromEntries(roles)).toEqual({
      web: 'application',
      api: 'application',
      migrate: 'job',
      db: 'resource',
    });
  });

  it('replaces only web while preserving api, logto, db, and skipping migrate', async () => {
    writeFileSync(
      composePath,
      `services:
  web:
    image: web:latest
    expose: ["3000"]
    depends_on: [api, logto]
  api:
    image: api:latest
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  logto:
    image: logto:latest
    expose: ["3001"]
  migrate:
    image: api:latest
    depends_on: [db]
  db:
    image: pgvector/pgvector:pg17
`,
      'utf8',
    );
    let sequence = 0;
    const runComposeService = vi
      .fn()
      .mockImplementation(
        async (config: { name: string }) => `${config.name}-container-${String(++sequence)}`,
      );
    const docker = createFakeDocker({
      runComposeService,
      inspectContainer: vi.fn().mockImplementation(async (containerId: string) => ({
        State: {
          Running: !containerId.includes('migrate'),
          ExitCode: 0,
        },
      })),
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'web',
    });
    expect(first.success).toBe(true);
    const firstIds = Object.fromEntries(
      [...db._projects.values()]
        .filter((project) => project.parent_project_id === first.parentProjectId)
        .map((project) => [project.name, project.container_id]),
    );
    runComposeService.mockClear();

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'web',
      services: ['web'],
      _parentId: first.parentProjectId,
    });

    expect(second.success, JSON.stringify(second)).toBe(true);
    expect(runComposeService).toHaveBeenCalledTimes(1);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ol-stack-web' }),
    );
    const secondIds = Object.fromEntries(
      [...db._projects.values()]
        .filter((project) => project.parent_project_id === first.parentProjectId)
        .map((project) => [project.name, project.container_id]),
    );
    expect(secondIds['stack/web']).not.toBe(firstIds['stack/web']);
    expect(secondIds['stack/api']).toBe(firstIds['stack/api']);
    expect(secondIds['stack/logto']).toBe(firstIds['stack/logto']);
    expect(secondIds['stack/db']).toBe(firstIds['stack/db']);
    expect(secondIds['stack/migrate']).toBe(firstIds['stack/migrate']);
  });

  it('runs migrate before api and keeps the existing api when migration fails', async () => {
    writeFileSync(
      composePath,
      `services:
  api:
    image: api:latest
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  migrate:
    image: api:latest
    depends_on: [db]
  db:
    image: postgres:16
`,
      'utf8',
    );
    let sequence = 0;
    let migrationExitCode = 0;
    const callOrder: string[] = [];
    const runComposeService = vi.fn().mockImplementation(async (config: { name: string }) => {
      callOrder.push(config.name);
      return `${config.name}-container-${String(++sequence)}`;
    });
    const docker = createFakeDocker({
      runComposeService,
      inspectContainer: vi.fn().mockImplementation(async (containerId: string) => ({
        State: {
          Running: containerId.includes('migrate') ? false : true,
          ExitCode: containerId.includes('migrate') ? migrationExitCode : 0,
        },
      })),
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'api',
    });
    expect(first.success).toBe(true);
    const apiBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/api',
    )?.container_id;
    migrationExitCode = 1;
    callOrder.length = 0;
    runComposeService.mockClear();

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'api',
      services: ['api'],
      _parentId: first.parentProjectId,
    });

    expect(second.success, JSON.stringify(second)).toBe(false);
    expect(second.errorCode).toBe('COMPOSE_JOB_FAILED');
    expect(callOrder).toContain('ol-stack-migrate');
    expect(callOrder).not.toContain('ol-stack-api');
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/api')?.container_id,
    ).toBe(apiBefore);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/migrate')?.container_id,
    ).toContain('ol-stack-migrate-container');

    migrationExitCode = 0;
    callOrder.length = 0;
    runComposeService.mockClear();
    const third = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'api',
      services: ['api'],
      _parentId: first.parentProjectId,
    });

    expect(third.success, JSON.stringify(third)).toBe(true);
    expect(callOrder.indexOf('ol-stack-migrate')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('ol-stack-migrate')).toBeLessThan(callOrder.indexOf('ol-stack-api'));
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/api')?.container_id,
    ).not.toBe(apiBefore);
  });

  it('blocks before replacing a selected application when a preserved resource is unhealthy', async () => {
    writeFileSync(
      composePath,
      `services:
  api:
    image: api:latest
    expose: ["4000"]
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
`,
      'utf8',
    );
    let sequence = 0;
    let resourceHealthy = true;
    const runComposeService = vi
      .fn()
      .mockImplementation(
        async (config: { name: string }) => `${config.name}-container-${String(++sequence)}`,
      );
    const docker = createFakeDocker({
      runComposeService,
      waitForHealthy: vi.fn().mockImplementation(async (containerId: string) => ({
        healthy: resourceHealthy || !containerId.includes('db'),
        ...(resourceHealthy || !containerId.includes('db')
          ? {}
          : { error: 'db prerequisite is unhealthy' }),
      })),
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'api',
    });
    expect(first.success).toBe(true);
    const apiBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/api',
    )?.container_id;
    const dbBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/db',
    )?.container_id;

    resourceHealthy = false;
    runComposeService.mockClear();
    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'api',
      services: ['api'],
      _parentId: first.parentProjectId,
    });

    expect(second.success).toBe(false);
    expect(second.errorCode).toBe('COMPOSE_PREREQUISITE_UNHEALTHY');
    expect(runComposeService).not.toHaveBeenCalled();
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/api')?.container_id,
    ).toBe(apiBefore);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/db')?.container_id,
    ).toBe(dbBefore);
    expect([...db._projects.values()].find((project) => project.name === 'stack/db')?.status).toBe(
      'error',
    );
  });

  it('preserves unchanged resources on full deploy and blocks resource changes or removal', async () => {
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx:latest
    expose: ["3000"]
    depends_on: [db]
  db:
    image: postgres:16
`,
      'utf8',
    );
    let sequence = 0;
    const docker = createFakeDocker({
      runComposeService: vi
        .fn()
        .mockImplementation(
          async (config: { name: string }) => `${config.name}-container-${String(++sequence)}`,
        ),
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const initialConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'web',
    };

    const first = await deployWithEnv(pipeline, initialConfig);
    expect(first.success).toBe(true);
    const dbBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/db',
    )?.container_id;
    db._deployConfigs.set(`${first.parentProjectId}__svc`, {
      config_json: JSON.stringify({
        version: 2,
        snapshot: {
          composeServiceFingerprints: fingerprintComposeServices(
            pipeline.parseComposeFile(composePath).services,
          ),
        },
        savedAt: new Date().toISOString(),
      }),
    });

    const unchanged = await deployWithEnv(pipeline, {
      ...initialConfig,
      _parentId: first.parentProjectId,
    });
    expect(unchanged.success).toBe(true);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/db')?.container_id,
    ).toBe(dbBefore);

    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx:latest
    expose: ["3000"]
  db:
    image: postgres:17
`,
      'utf8',
    );
    await expect(
      deployWithEnv(pipeline, { ...initialConfig, _parentId: first.parentProjectId }),
    ).rejects.toMatchObject({ code: 'STATEFUL_SERVICE_CHANGE_BLOCKED' });

    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx:latest
    expose: ["3000"]
`,
      'utf8',
    );
    await expect(
      deployWithEnv(pipeline, { ...initialConfig, _parentId: first.parentProjectId }),
    ).rejects.toMatchObject({ code: 'STATEFUL_SERVICE_REMOVAL_BLOCKED' });
  });
});
