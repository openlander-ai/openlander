import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
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
const mockHttpRequest = vi.hoisted(() => vi.fn());

vi.mock('node:http', () => ({
  request: mockHttpRequest,
}));

vi.mock('../src/health/probe-runner.js', () => ({
  createLocalProbeRunner: vi.fn(() => ({
    runProbe: mockRunProbe,
  })),
  LocalProbeRunner: vi.fn(),
}));

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getAllWithInheritance: (projectId: string, environmentId: string) => Record<string, string>;
  getAllForService: (projectId: string, serviceId: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function mockRouteProbeSequence(statusCodes: number[]): void {
  let index = 0;
  mockHttpRequest.mockImplementation((options, callback: (response: EventEmitter) => void) => {
    const statusCode = statusCodes[Math.min(index, statusCodes.length - 1)] ?? 200;
    index += 1;
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      resume: () => void;
    };
    response.statusCode = statusCode;
    response.resume = vi.fn();
    queueMicrotask(() => callback(response));

    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
    };
    request.end = vi.fn();
    request.destroy = vi.fn((error?: Error) => {
      if (error) request.emit('error', error);
    });
    void options;
    return request;
  });
}

function mockRouteProbe(statusCode: number): void {
  mockRouteProbeSequence([statusCode]);
}

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

function createOwnerProject(): ProjectRow {
  return {
    ...createProject(),
    id: 'target-group',
    name: 'hotdeal',
    display_name: 'hotdeal',
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
  ownerProject?: ProjectRow;
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
    getProject: vi.fn(async (id: string) => {
      if (id === state.project.id) return state.project;
      if (id === state.ownerProject?.id) return state.ownerProject;
      return undefined;
    }),
    getService: vi.fn(async (id: string) => (id === state.service.id ? state.service : undefined)),
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
    updateService: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
      applyRuntimeUpdates(updates);
    }),
    updateEnvironment: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
      if ('status' in updates)
        state.environment.status = updates.status as EnvironmentRow['status'];
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
    createEnvironment: vi.fn(async () => state.environment),
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
  greenInspectSequence?: Array<
    | {
        State: {
          Running: boolean;
          Restarting?: boolean;
          ExitCode?: number;
          Health?: { Status: string };
        };
        RestartCount?: number;
      }
    | Error
  >;
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
    inspectImage: vi.fn().mockResolvedValue({ Config: { ExposedPorts: { '3000/tcp': {} } } }),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    runContainer: vi.fn().mockResolvedValue('container-green'),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
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
      if (containerId === 'container-green' && options?.greenInspectSequence?.length) {
        const next =
          options.greenInspectSequence.shift() ??
          options.greenInspectSequence[options.greenInspectSequence.length - 1];
        if (next instanceof Error) {
          throw next;
        }
        return next;
      }
      return { State: { Running: true } };
    }),
    restartContainer: blueRestartMock,
    ensureProjectNetwork: vi.fn(async (projectName: string) => `ol-${projectName}`),
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
  let state: {
    project: ProjectRow;
    ownerProject?: ProjectRow;
    service: ServiceRow;
    environment: EnvironmentRow;
  };
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
      getAllWithInheritance: vi.fn().mockReturnValue({}),
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
    mockRouteProbe(200);
  });

  afterEach(() => {
    clearPortScanCache();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('updates the active route target before cleaning up blue', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
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
    expect(mockRunProbe).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ containerId: 'container-green', assignedPort: 12001 }),
    );

    const updateProjectMock = db.updateProject as ReturnType<typeof vi.fn>;
    const inspectContainerMock = docker.inspectContainer as ReturnType<typeof vi.fn>;
    const stopContainerMock = docker.stopContainer as ReturnType<typeof vi.fn>;
    const inspectGreenCallIndex = inspectContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-green',
    );
    const greenUpdateCallIndex = updateProjectMock.mock.calls.findIndex(
      ([, updates]) => (updates as Record<string, unknown>).containerId === 'container-green',
    );
    const stopBlueCallIndex = stopContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-blue',
    );
    expect(inspectGreenCallIndex).toBeGreaterThanOrEqual(0);
    expect(greenUpdateCallIndex).toBeGreaterThanOrEqual(0);
    expect(stopBlueCallIndex).toBeGreaterThanOrEqual(0);
    expect(inspectContainerMock.mock.invocationCallOrder[inspectGreenCallIndex]).toBeLessThan(
      updateProjectMock.mock.invocationCallOrder[greenUpdateCallIndex],
    );
    expect(updateProjectMock.mock.invocationCallOrder[greenUpdateCallIndex]).toBeLessThan(
      stopContainerMock.mock.invocationCallOrder[stopBlueCallIndex],
    );
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: '80',
        path: '/',
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
      expect.any(Function),
    );
  });

  it('preserves the saved image command for the green candidate', async () => {
    state.service.kind = 'image';
    state.service.source = 'image';
    state.service.repo_url = null;
    state.service.branch = null;
    state.service.image_url = 'ghcr.io/openlander-ai/openlander:rc';
    state.service.image_cmd = JSON.stringify(['node', 'server.js']);
    state.environment.branch = null;
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
    });

    expect(result).toMatchObject({ success: true, strategy: 'blue-green' });
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: ['node', 'server.js'] }),
    );
  });

  it('starts attached blue-green green containers on the owner project network', async () => {
    state.ownerProject = createOwnerProject();
    state.service.project_id = state.ownerProject.id;
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
    });
    expect(docker.ensureProjectNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'hotdeal',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^ol-demo-app-green-/),
        network: 'ol-hotdeal',
        aliases: ['demo-app-green'],
        labels: expect.objectContaining({
          'openlander.project': 'demo-app',
          'openlander.blue_green.project_id': 'p1',
          'openlander.blue_green.service_id': 'p1__svc',
        }),
      }),
    );
  });

  it('does not accept a managed route 2xx before the provider poll window elapses', async () => {
    mockRouteProbe(200);

    const result = await pipeline.verifyManagedTraefikRoute({
      projectName: 'demo-app',
      path: '/',
      probeTimeoutMs: 5,
      maxWaitMs: 60,
      intervalMs: 5,
      minimumSuccessAgeMs: 25,
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.attempts).toBeGreaterThan(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(25);
  });

  it('fails instead of accepting a pre-poll route 2xx when the deadline expires', async () => {
    mockRouteProbe(200);

    const result = await pipeline.verifyManagedTraefikRoute({
      projectName: 'demo-app',
      path: '/',
      probeTimeoutMs: 5,
      maxWaitMs: 0,
      intervalMs: 1,
      minimumSuccessAgeMs: 1_000,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('before Traefik HTTP provider poll window elapsed'),
      attempts: 1,
    });
  });

  it('returns a structured status code when a managed route probe reaches a failing backend', async () => {
    mockRouteProbe(502);

    const result = await pipeline.verifyManagedTraefikRoute({
      projectName: 'demo-app',
      path: '/',
      probeTimeoutMs: 5,
      maxWaitMs: 0,
      intervalMs: 1,
      minimumSuccessAgeMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: expect.stringContaining('HTTP 502'),
      attempts: 1,
    });
  });

  it('recreates runtime env from the same image before removing the previous container', async () => {
    (env.getAllForService as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgres://new-runtime',
    });
    const previousProbeCalls = mockHttpRequest.mock.calls.length;

    const result = await pipeline.recreateServiceRuntime('p1__svc', {
      lockSessionId: 'env-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      applyMode: 'same-image-recreate',
      readiness: 'healthy',
      route_switched: true,
      containerId: 'container-green',
      previousContainerId: 'container-blue',
    });
    expect(state.service.container_id).toBe('container-green');
    expect(state.service.container_name).toMatch(/^ol-demo-app-env-/);
    expect(state.service.assigned_port).toBe(12001);

    const runContainerMock = docker.runContainer as ReturnType<typeof vi.fn>;
    expect(runContainerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/demo-app:old',
        name: expect.stringMatching(/^ol-demo-app-env-/),
        port: 12001,
        containerPort: 3000,
        envVars: { DATABASE_URL: 'postgres://new-runtime' },
        labels: expect.objectContaining({
          'openlander.managed': 'true',
          'openlander.project': 'demo-app',
          'openlander.service': 'p1__svc',
          'traefik.enable': 'false',
        }),
        volumeProjectName: 'demo-app',
      }),
    );

    const updateServiceMock = db.updateService as ReturnType<typeof vi.fn>;
    const safeRemoveMock = docker.safeRemoveContainer as ReturnType<typeof vi.fn>;
    const greenUpdateCallIndex = updateServiceMock.mock.calls.findIndex(
      ([, updates]) => (updates as Record<string, unknown>).containerId === 'container-green',
    );
    const removeBlueCallIndex = safeRemoveMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-blue',
    );
    expect(greenUpdateCallIndex).toBeGreaterThanOrEqual(0);
    expect(removeBlueCallIndex).toBeGreaterThanOrEqual(0);
    expect(updateServiceMock.mock.invocationCallOrder[greenUpdateCallIndex]).toBeLessThan(
      safeRemoveMock.mock.invocationCallOrder[removeBlueCallIndex],
    );
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: '80',
        path: '/',
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
      expect.any(Function),
    );
    expect(updateServiceMock.mock.invocationCallOrder[greenUpdateCallIndex]).toBeLessThan(
      mockHttpRequest.mock.invocationCallOrder[previousProbeCalls],
    );
  });

  it('recreates attached runtime env on the owner project network', async () => {
    state.ownerProject = createOwnerProject();
    state.service.project_id = state.ownerProject.id;
    (env.getAllForService as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgres://new-runtime',
    });

    const result = await pipeline.recreateServiceRuntime('p1__svc', {
      lockSessionId: 'env-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      applyMode: 'same-image-recreate',
      readiness: 'healthy',
    });
    expect(docker.ensureProjectNetwork as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'hotdeal',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^ol-demo-app-env-/),
        network: 'ol-hotdeal',
        aliases: [expect.stringMatching(/^demo-app-env-/)],
        labels: expect.objectContaining({
          'openlander.project': 'demo-app',
          'openlander.service': 'p1__svc',
        }),
        volumeProjectName: 'demo-app',
      }),
    );
  });

  it('rolls runtime env recreate back when route verification does not reach the replacement', async () => {
    (env.getAllForService as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgres://new-runtime',
    });
    mockRouteProbe(502);

    const result = await pipeline.recreateServiceRuntime('p1__svc', {
      lockSessionId: 'env-lock',
      routeSwitchDelayMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'RUNTIME_ENV_ROUTE_VERIFY_FAILED',
      applyMode: 'same-image-recreate',
      readiness: 'unhealthy',
      route_switched: false,
      previous_version_still_serving: true,
    });
    expect(state.service.container_id).toBe('container-blue');
    expect(state.service.container_name).toBe('ol-demo-app');
    expect(state.service.assigned_port).toBe(10010);
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
  });

  it('polls the managed route until Traefik serves the flipped target', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbeSequence([404, 200]);
    const previousProbeCalls = mockHttpRequest.mock.calls.length;

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 50,
      routeProbeIntervalMs: 1,
      postSwitchStabilityMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
    });
    expect(mockHttpRequest.mock.calls.length - previousProbeCalls).toBeGreaterThan(2);
  });

  it('rolls back when a stale blue route passes before cleanup but disappears after blue stops', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbeSequence([200, 404]);

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
    });

    expect(result).toMatchObject({
      success: false,
      strategy: 'blue-green',
      previous_version_still_serving: true,
      route_switched: false,
    });
    expect(result.error).toContain('Route did not remain reachable after previous container stopped');
    expect(state.service.container_id).toBe('container-blue');
    expect(state.service.container_name).toBe('ol-demo-app');
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-blue');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
    expect(db.createDeployLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        buildLog: expect.stringContaining('[route] Failed after blue stop'),
      }),
    );
  });

  it('keeps blue serving when green health fails', async () => {
    mockRunProbe.mockResolvedValue({ healthy: false, source: 'http', error: '500' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      healthCheckRetries: 1,
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
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
    expect(db.createDeployLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        buildLog: expect.stringContaining('Previous version is still serving'),
      }),
    );
  });

  it('waits for Docker HEALTHCHECK starting state before promoting green', async () => {
    const previousProbeCalls = mockRunProbe.mock.calls.length;
    mockRunProbe
      .mockResolvedValueOnce({
        healthy: false,
        source: 'docker',
        error: 'Docker health status: starting',
      })
      .mockResolvedValueOnce({
        healthy: false,
        source: 'docker',
        error: 'Docker health status: starting',
      })
      .mockResolvedValueOnce({ healthy: true, source: 'docker' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      healthCheckRetries: 5,
      healthCheckIntervalMs: 1,
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      readiness: 'healthy',
      route_switched: true,
    });
    expect(mockRunProbe.mock.calls.length - previousProbeCalls).toBe(3);
    expect(db.createDeployLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        buildLog: expect.stringContaining('[health] Passed after'),
      }),
    );
  });

  it('rolls the DB target back to blue when route probe fails', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbe(502);

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
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

  it('keeps blue serving when green restarts during the pre-switch stability window', async () => {
    const mockDocker = createMockDocker({
      greenInspectSequence: [
        { State: { Running: true }, RestartCount: 0 },
        { State: { Running: true }, RestartCount: 1 },
      ],
    });
    docker = mockDocker.docker;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbe(200);
    const previousRouteProbeCalls = mockHttpRequest.mock.calls.length;

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 2,
      postSwitchStabilityPollIntervalMs: 1,
    });

    expect(result).toMatchObject({
      success: false,
      strategy: 'blue-green',
      previous_version_still_serving: true,
      route_switched: false,
      readiness: 'unhealthy',
    });
    expect(result.error).toContain('previous version still serving');
    expect(result.error).toContain('restarted 1 time');
    expect(state.service.container_id).toBe('container-blue');
    expect(state.service.container_name).toBe('ol-demo-app');
    expect(mockHttpRequest.mock.calls.length).toBe(previousRouteProbeCalls);
    expect(db.updateProject).not.toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ containerId: 'container-green' }),
    );
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
  });

  it('does not roll back for restart history that predates the stability window', async () => {
    const mockDocker = createMockDocker({
      greenInspectSequence: [
        { State: { Running: true }, RestartCount: 3 },
        { State: { Running: true }, RestartCount: 3 },
      ],
    });
    docker = mockDocker.docker;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbe(200);

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 2,
      postSwitchStabilityPollIntervalMs: 1,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
    });
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-blue');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-blue',
    );
  });

  it('does not roll back for a transient green inspect failure during the stability window', async () => {
    const mockDocker = createMockDocker({
      greenInspectSequence: [
        new Error('docker daemon busy'),
        { State: { Running: true }, RestartCount: 0 },
        { State: { Running: true }, RestartCount: 0 },
      ],
    });
    docker = mockDocker.docker;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });
    mockRouteProbe(200);

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 4,
      postSwitchStabilityPollIntervalMs: 1,
    });

    expect(result).toMatchObject({
      success: true,
      strategy: 'blue-green',
      route_switched: true,
    });
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-blue');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-blue',
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
      postSwitchStabilityMs: 0,
    });

    expect(result.success).toBe(true);
    expect(mockRunProbe).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/internal-health' }),
      expect.any(Object),
    );
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: '80',
        path: '/',
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
      expect.any(Function),
    );
  });

  it('uses the explicit health path as the default route probe path', async () => {
    state.service.health_check_path = '/healthz';
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      postSwitchStabilityMs: 0,
    });

    expect(result.success).toBe(true);
    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: '80',
        path: '/healthz',
        headers: { Host: expect.stringMatching(/^demo-app\./) },
      }),
      expect.any(Function),
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
      postSwitchStabilityMs: 0,
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
      postSwitchStabilityMs: 0,
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

  it('persists the caller trigger for blue-green deploy logs', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', {
      strategy: 'blue-green',
      lockSessionId: 'test-lock',
      routeSwitchDelayMs: 0,
      trigger: 'chat',
      postSwitchStabilityMs: 0,
    });

    expect(result.success).toBe(true);
    expect(db.createDeployLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        trigger: 'chat',
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
      postSwitchStabilityMs: 0,
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
      postSwitchStabilityMs: 0,
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
