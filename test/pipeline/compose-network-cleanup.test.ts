import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    disconnectContainerFromNetwork: vi.fn().mockResolvedValue(undefined),
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
        networks: ['stack-network', SHARED_NETWORK_NAME],
        aliases: ['web'],
      }),
    );
  });

  it('retries once after Docker reports a stale network endpoint conflict', async () => {
    const runComposeService = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '(HTTP code 403) unexpected - endpoint with name ol-stack-web already exists in network openlander',
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
    expect(docker.disconnectContainerFromNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
      SHARED_NETWORK_NAME,
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
    expect(docker.disconnectContainerFromNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
      SHARED_NETWORK_NAME,
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-stack-web',
    );
  });
});
