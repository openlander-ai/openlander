import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import type { Database, EnvironmentRow, ProjectRow, ServiceRow } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as portPipeline from '../src/pipeline/port.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

const mockRunProbe = vi.fn();

vi.mock('../src/health/probe-runner.js', () => ({
  createLocalProbeRunner: vi.fn(() => ({
    runProbe: mockRunProbe,
  })),
  LocalProbeRunner: vi.fn(),
}));

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getAllForService: (projectId: string, serviceId: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function createProject(): ProjectRow {
  return {
    id: 'p1',
    name: 'demo-app',
    display_name: 'demo-app',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
  };
}

function createService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p1__svc',
    project_id: 'p1',
    name: 'demo-app__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10010,
    container_id: 'container-blue',
    container_name: 'ol-demo-app',
    container_port: 3000,
    image_tag: 'openlander/demo-app:old',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/openlander/demo-app',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function createEnvironment(): EnvironmentRow {
  return {
    id: 'p1-production',
    service_id: 'p1__svc',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: 10010,
    container_id: 'container-blue',
    image_tag: 'openlander/demo-app:old',
    previous_image_tag: null,
    public_url: null,
    container_port: 3000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function createMockDb(state: {
  project: ProjectRow;
  service: ServiceRow;
  environment: EnvironmentRow;
}): Database {
  const applyRuntimeUpdates = (updates: Record<string, unknown>) => {
    if ('status' in updates) state.service.status = updates.status as ServiceRow['status'];
    if ('containerId' in updates) state.service.container_id = updates.containerId as string | null;
    if ('containerName' in updates)
      state.service.container_name = updates.containerName as string | null;
    if ('assignedPort' in updates)
      state.service.assigned_port = updates.assignedPort as number | null;
    if ('containerPort' in updates)
      state.service.container_port = updates.containerPort as number | null;
    if ('imageTag' in updates) state.service.image_tag = updates.imageTag as string | null;
    if ('previousImageTag' in updates)
      state.service.previous_image_tag = updates.previousImageTag as string | null;
  };

  return {
    getProject: vi.fn(async (id: string) => (id === state.project.id ? state.project : undefined)),
    getDeployableForProject: vi.fn(async (id: string) =>
      id === state.project.id ? state.service : undefined,
    ),
    isCircuitBreakerOpen: vi.fn(async () => false),
    getEnvironmentsByProject: vi.fn(async (id: string) =>
      id === state.project.id ? [state.environment] : [],
    ),
    getEnvironment: vi.fn(async (id: string) =>
      id === state.environment.id ? state.environment : undefined,
    ),
    updateProject: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
      applyRuntimeUpdates(updates);
    }),
    updateEnvironment: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
      if ('status' in updates) state.environment.status = updates.status as EnvironmentRow['status'];
      if ('containerId' in updates)
        state.environment.container_id = updates.containerId as string | null;
      if ('assignedPort' in updates)
        state.environment.assigned_port = updates.assignedPort as number | null;
      if ('containerPort' in updates)
        state.environment.container_port = updates.containerPort as number | null;
      if ('imageTag' in updates) state.environment.image_tag = updates.imageTag as string | null;
      if ('previousImageTag' in updates)
        state.environment.previous_image_tag = updates.previousImageTag as string | null;
    }),
    createDeployLog: vi.fn(async () => undefined),
    loadDeployConfigForService: vi.fn(async () => null),
    loadDeployConfig: vi.fn(async () => null),
    acquireDeployLock: vi.fn(async () => true),
    releaseDeployLock: vi.fn(async () => undefined),
  } as unknown as Database;
}

function createMockDocker(options?: {
  blueRunning?: boolean;
  cleanupBlueFails?: boolean;
  managedContainers?: Array<{
    id: string;
    name: string;
    status: string;
    labels?: Record<string, string>;
  }>;
}): {
  docker: Docker;
} {
  const blueInspectMock = vi
    .fn()
    .mockResolvedValue({ State: { Running: options?.blueRunning ?? true } });
  const blueRestartMock = vi.fn().mockResolvedValue(undefined);

  const docker = {
    buildImage: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    runContainer: vi.fn().mockResolvedValue('container-green'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn(async (containerId: string) => {
      if (containerId === 'container-blue' && options?.cleanupBlueFails) {
        throw new Error('remove failed');
      }
    }),
    inspectContainer: blueInspectMock.mockImplementation(async (containerId: string) => {
      if (containerId === 'container-blue') {
        return { State: { Running: options?.blueRunning ?? true } };
      }
      return { State: { Running: true } };
    }),
    restartContainer: blueRestartMock,
    ensureProjectNetwork: vi.fn().mockResolvedValue('ol-demo-app'),
    connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
    listManagedContainers: vi.fn().mockResolvedValue(options?.managedContainers ?? []),
  } as unknown as Docker;

  return { docker };
}

describe('blue-green route target flip', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  let state: { project: ProjectRow; service: ServiceRow; environment: EnvironmentRow };
  const testConfig = {
    ai: { secretScan: { enabled: false } },
    traefik: { mode: 'managed' },
  } as OpenLanderConfig;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-blue-green-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    state = {
      project: createProject(),
      service: createService(),
      environment: createEnvironment(),
    };
    db = createMockDb(state);
    const mockDocker = createMockDocker();
    docker = mockDocker.docker;
    env = {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getAllForService: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      branch: 'main',
      commitSha: 'deadbeefcafebabe',
    });
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(12001);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
  });

  afterEach(() => {
    clearPortScanCache();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('updates the active route target before cleaning up blue', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
      readiness: 'healthy',
    });
    expect(state.service.container_id).toBe('container-green');
    expect(state.service.container_name).toMatch(/^ol-demo-app-green-/);

    const runContainerMock = docker.runContainer as ReturnType<typeof vi.fn>;
    expect(runContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^ol-demo-app-green-/),
        aliases: ['demo-app-green'],
        labels: expect.objectContaining({
          'openlander.managed': 'true',
          'openlander.project': 'demo-app',
          'openlander.blue_green.role': 'green',
          'openlander.blue_green.project_id': 'p1',
          'openlander.blue_green.service_id': 'p1__svc',
          'traefik.enable': 'false',
        }),
      }),
    );

    const updateProjectMock = db.updateProject as ReturnType<typeof vi.fn>;
    const stopContainerMock = docker.stopContainer as ReturnType<typeof vi.fn>;
    const greenUpdateCallIndex = updateProjectMock.mock.calls.findIndex(
      ([, updates]) => (updates as Record<string, unknown>).containerId === 'container-green',
    );
    const stopBlueCallIndex = stopContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-blue',
    );
    expect(greenUpdateCallIndex).toBeGreaterThanOrEqual(0);
    expect(stopBlueCallIndex).toBeGreaterThanOrEqual(0);
    expect(updateProjectMock.mock.invocationCallOrder[greenUpdateCallIndex]).toBeLessThan(
      stopContainerMock.mock.invocationCallOrder[stopBlueCallIndex],
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:80/',
      expect.objectContaining({
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
    );
  });

  it('keeps blue serving when green health fails', async () => {
    mockRunProbe.mockResolvedValue({ healthy: false, source: 'http', error: '500' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      strategy: 'blue-green',
      previous_version_still_serving: true,
      route_switched: false,
    });
    expect(state.service.container_id).toBe('container-blue');
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
  });

  it('rolls the DB target back to blue when route probe fails', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      strategy: 'blue-green',
      previous_version_still_serving: true,
      route_switched: false,
    });
    expect(state.service.container_id).toBe('container-blue');
    expect(state.service.container_name).toBe('ol-demo-app');
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
  });

  it('separates green health path from public route reachability probe', async () => {
    state.service.health_check_path = '/internal-health';
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      routeProbePath: '/',
    });

    expect(result.success).toBe(true);
    expect(mockRunProbe).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/internal-health' }),
      expect.any(Object),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:80/',
      expect.objectContaining({
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
    );
  });

  it('uses the explicit health path as the default route probe path', async () => {
    state.service.health_check_path = '/healthz';
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:80/healthz',
      expect.objectContaining({
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
    );
  });

  it('blocks blue-green when no explicit health check path exists', async () => {
    state.service.health_check_path = null;
    state.service.health_check_strategy = null;
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'BLUE_GREEN_UNSUPPORTED',
      strategy: 'blue-green',
      readiness: 'blocked',
    });
    expect(result.error).toContain('explicit health_check_path is required');
    expect(docker.runContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('redeploys image services without cloning a repository', async () => {
    state.service.kind = 'image';
    state.service.source = 'image';
    state.service.repo_url = null;
    state.service.image_url = 'nginx:alpine';
    state.service.image_tag = 'nginx:old';
    state.service.health_check_path = '/healthz';
    state.environment.image_tag = 'nginx:old';
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
    });
    expect(gitPipeline.cloneRepo).not.toHaveBeenCalled();
    expect(docker.buildImage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(docker.pullImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('nginx:alpine');
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'nginx:alpine',
      }),
    );
  });

  it('returns success with a warning when blue cleanup fails after route switch', async () => {
    const mockDocker = createMockDocker({ cleanupBlueFails: true });
    docker = mockDocker.docker;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining('failed to remove previous container'),
    ]);
    expect(state.service.container_id).toBe('container-green');
  });

  it('cleans stale green containers before starting a new promotion', async () => {
    const mockDocker = createMockDocker({
      managedContainers: [
        {
          id: 'container-blue',
          name: 'ol-demo-app-green-active',
          status: 'running',
          labels: {
            'openlander.managed': 'true',
            'openlander.blue_green.role': 'green',
            'openlander.blue_green.project_id': 'p1',
          },
        },
        {
          id: 'stale-green',
          name: 'ol-demo-app-green-old',
          status: 'running',
          labels: {
            'openlander.managed': 'true',
            'openlander.blue_green.role': 'green',
            'openlander.blue_green.project_id': 'p1',
          },
        },
      ],
    });
    docker = mockDocker.docker;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result.success).toBe(true);
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('stale-green');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'stale-green',
    );
    const stopContainerMock = docker.stopContainer as ReturnType<typeof vi.fn>;
    const runContainerMock = docker.runContainer as ReturnType<typeof vi.fn>;
    const staleStopIndex = stopContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'stale-green',
    );
    expect(staleStopIndex).toBeGreaterThanOrEqual(0);
    expect(stopContainerMock.mock.invocationCallOrder[staleStopIndex]).toBeLessThan(
      runContainerMock.mock.invocationCallOrder[0],
    );
  });

  it('blocks compose services before touching containers', async () => {
    state.service.kind = 'compose';
    state.service.build_method = 'compose';
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'BLUE_GREEN_UNSUPPORTED',
      strategy: 'blue-green',
      readiness: 'blocked',
    });
    expect(docker.runContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });
});
