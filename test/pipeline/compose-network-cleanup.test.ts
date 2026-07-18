import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SHARED_NETWORK_NAME } from '../../src/config/index.js';
import { ComposePipeline, type ComposeDeployConfig } from '../../src/pipeline/compose.js';
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
};

type ProjectPatch = {
  status?: ProjectRow['status'];
  containerId?: string | null;
  assignedPort?: number | null;
  imageTag?: string;
  dockerfilePath?: string;
  buildMethod?: string;
};

function createFakeDb() {
  const projects = new Map<string, ProjectRow>();
  const deployLogs: unknown[] = [];

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
      if (patch.assignedPort !== undefined) current.assigned_port = patch.assignedPort;
      if (patch.imageTag !== undefined) current.image_tag = patch.imageTag;
      if (patch.dockerfilePath !== undefined) current.dockerfile_path = patch.dockerfilePath;
      if (patch.buildMethod !== undefined) current.build_method = patch.buildMethod;
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
    _projects: projects,
    _deployLogs: deployLogs,
  } as unknown as Database & { _projects: Map<string, ProjectRow>; _deployLogs: unknown[] };
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

  it('passes original compose service names as Docker network aliases', async () => {
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
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-stack-web',
        networks: ['stack-network'],
        aliases: ['web'],
      }),
    );
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

  it('replaces published ports, interpolates env defaults, and scopes named volumes', async () => {
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
        containerPort: 5432,
        envVars: expect.objectContaining({ POSTGRES_PASSWORD: 'local-password' }),
        extraBinds: ['ol-stack-volume-pgdata:/var/lib/postgresql/data'],
      }),
    );
    const call = runComposeService.mock.calls[0]?.[0] as { port: number } | undefined;
    expect(call?.port).not.toBe(5432);
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
  });
});
