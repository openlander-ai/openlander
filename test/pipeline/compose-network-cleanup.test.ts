import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, join } from 'node:path';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { SHARED_NETWORK_NAME } from '../../src/config/index.js';
import {
  ComposePipeline,
  inferComposeRuntimeRoles,
  type ComposeDeployConfig,
} from '../../src/pipeline/compose.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { DockerBuildError } from '../../src/errors.js';
import { clearPortReservations, clearPortScanCache } from '../../src/pipeline/port.js';
import { JobManager } from '../../src/pipeline/job-manager.js';
import type { EventBus } from '../../src/events/index.js';
import type { Database, ProjectRow } from '../../src/db/index.js';

type ProjectInput = {
  id: string;
  name: string;
  repoUrl?: string;
  branch?: string;
  parentProjectId?: string;
  dockerfilePath?: string;
  buildMethod?: string;
  runtimeRole?: 'application' | 'job' | 'resource';
  healthCheckStrategy?: 'http' | 'tcp' | 'exec' | 'none';
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
  const deployLocks = new Map<string, string>();

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
      if (patch.healthCheckStrategy !== undefined) {
        current.health_check_strategy = patch.healthCheckStrategy;
      }
    }),
    getComposeChildProjects: vi.fn(async (parentId: string) =>
      [...projects.values()].filter((project) => project.parent_project_id === parentId),
    ),
    getComposeChildren: vi.fn(async (parentServiceId: string) => {
      const parentId = parentServiceId.replace(/__svc$/, '');
      return [...projects.values()]
        .filter((project) => project.parent_project_id === parentId)
        .map((project) => ({
          id: `${project.id}__svc`,
          name: `${project.name}__svc`,
          runtime_role:
            (project as ProjectRow & { runtime_role?: 'application' | 'job' | 'resource' })
              .runtime_role ?? 'application',
        }));
    }),
    deleteProjectDependenciesByProject: vi.fn(async () => undefined),
    createProjectDependency: vi.fn(async () => undefined),
    deleteService: vi.fn(async () => undefined),
    deleteProject: vi.fn(async (id: string) => {
      projects.delete(id);
    }),
    createDeployLog: vi.fn(async (log: unknown) => {
      deployLogs.push(log);
    }),
    createDeployLogForService: vi.fn(async (log: unknown) => {
      deployLogs.push(log);
    }),
    getUsedPorts: vi.fn(async () => []),
    acquireDeployLock: vi.fn(async (projectId: string, sessionId: string) => {
      const current = deployLocks.get(projectId);
      if (current && current !== sessionId) return false;
      deployLocks.set(projectId, sessionId);
      return true;
    }),
    releaseDeployLock: vi.fn(async (projectId: string, sessionId?: string) => {
      const current = deployLocks.get(projectId);
      if (!current || (sessionId && current !== sessionId)) return false;
      deployLocks.delete(projectId);
      return true;
    }),
    getDeployLockInfo: vi.fn(async (projectId: string) => {
      const session = deployLocks.get(projectId);
      return session ? { session, lockedAt: new Date().toISOString() } : null;
    }),
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
    startContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
    disconnectContainerFromNetwork: vi.fn().mockResolvedValue(undefined),
    seedVolumeFromDirectory: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue('migration stdout\nmigration stderr'),
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
      envVars: { ...(config.envVars ?? {}) },
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

  it('replaces only the selected application and reuses dependency containers', async () => {
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres:16\n  api:\n    image: example/api\n    depends_on:\n      - db\n  web:\n    image: example/web\n    expose:\n      - "3000"\n    depends_on:\n      - api\n`,
      'utf8',
    );
    let runSequence = 0;
    const runComposeService = vi
      .fn()
      .mockImplementation(
        async (config: { name: string }) => `container-${config.name}-${String(++runSequence)}`,
      );
    const docker = createFakeDocker({ runComposeService } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    };

    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);
    const firstContainers = Object.fromEntries(
      [...db._projects.values()]
        .filter((project) => project.name.startsWith('stack/'))
        .map((project) => [project.name.slice('stack/'.length), project.container_id]),
    );

    const second = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['web'],
      previousServiceFingerprints: first.serviceFingerprints,
    });

    expect(second.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledTimes(4);
    expect(runComposeService.mock.calls[3]?.[0]).toEqual(
      expect.objectContaining({ name: 'ol-stack-web' }),
    );
    const secondContainers = Object.fromEntries(
      [...db._projects.values()]
        .filter((project) => project.name.startsWith('stack/'))
        .map((project) => [project.name.slice('stack/'.length), project.container_id]),
    );
    expect(secondContainers['db']).toBe(firstContainers['db']);
    expect(secondContainers['api']).toBe(firstContainers['api']);
    expect(secondContainers['web']).not.toBe(firstContainers['web']);
  });

  it('rebuilds every application for a new source revision and forwards no-cache', async () => {
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres:16\n  api:\n    build: ./api\n    expose: ["4000"]\n    depends_on:\n      - db\n  web:\n    build: ./web\n    expose: ["3000"]\n    depends_on:\n      - api\n`,
      'utf8',
    );
    mkdirSync(join(tmpDir, 'api'));
    mkdirSync(join(tmpDir, 'web'));
    let runSequence = 0;
    const runComposeService = vi
      .fn()
      .mockImplementation(
        async (config: { name: string }) => `container-${config.name}-${String(++runSequence)}`,
      );
    const buildComposeService = vi.fn().mockResolvedValue(undefined);
    const docker = createFakeDocker({ runComposeService, buildComposeService } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
      trafficService: 'web',
    };

    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);
    const dbContainerBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/db',
    )?.container_id;
    const apiContainerBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/api',
    )?.container_id;
    const webContainerBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/web',
    )?.container_id;
    buildComposeService.mockClear();
    runComposeService.mockClear();

    const second = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      previousServiceFingerprints: first.serviceFingerprints,
      sourceRevisionChanged: true,
      noCache: true,
    });

    expect(second.success).toBe(true);
    expect(buildComposeService).toHaveBeenCalledTimes(2);
    expect(buildComposeService).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'ol-stack-api:latest', noCache: true }),
    );
    expect(buildComposeService).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'ol-stack-web:latest', noCache: true }),
    );
    expect(runComposeService).toHaveBeenCalledTimes(2);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/db')?.container_id,
    ).toBe(dbContainerBefore);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/api')?.container_id,
    ).not.toBe(apiContainerBefore);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/web')?.container_id,
    ).not.toBe(webContainerBefore);
    expect(db._deployLogs).toContainEqual(
      expect.objectContaining({ buildLog: expect.stringContaining('[compose rebuild]') }),
    );
  });

  it('marks every queued child job failed when image preparation fails', async () => {
    writeFileSync(
      composePath,
      `services:\n  migrate:\n    image: example/migrate\n  api:\n    build: .\n    depends_on:\n      migrate:\n        condition: service_completed_successfully\n`,
      'utf8',
    );
    const completeBuildOutput = `${'#9 [4/5] RUN npm run build\n'.repeat(120)}registry request timed out\n`;
    const docker = createFakeDocker({
      buildComposeService: vi
        .fn()
        .mockRejectedValue(new DockerBuildError('example/api:latest', completeBuildOutput)),
    });
    const db = createFakeDb();
    const jobManager = new JobManager();
    const pipeline = new ComposePipeline(docker, db, createEventBus(), jobManager);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    const childProjects = [...db._projects.values()].filter(
      (project) => project.parent_project_id === result.parentProjectId,
    );
    expect(childProjects).toHaveLength(2);
    for (const child of childProjects) {
      expect(jobManager.getStatus(child.id)).toMatchObject({
        phase: 'failed',
        errorSummary: 'Docker build failed for example/api:latest',
      });
    }
    expect(jobManager.getActiveJobs()).toEqual([]);
    const apiProject = childProjects.find((project) => project.name === 'stack/api');
    expect(db._deployLogs).toContainEqual(
      expect.objectContaining({
        serviceId: `${apiProject?.id ?? ''}__svc`,
        status: 'failed',
        buildLog: expect.stringContaining(completeBuildOutput.trimEnd()),
      }),
    );
  });

  it('synchronizes metadata for existing children excluded from a selective deploy', async () => {
    writeFileSync(
      composePath,
      `services:
  db:
    image: postgres:16
  migrate:
    image: example/migrate
    depends_on:
      db:
        condition: service_healthy
  api:
    image: example/api
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  web:
    image: example/web
    expose: ["3000"]
    depends_on:
      - api
`,
      'utf8',
    );
    const inspectContainer = vi.fn().mockImplementation(async (containerRef: string) => ({
      State: {
        Running: !containerRef.includes('migrate'),
        ExitCode: 0,
      },
    }));
    const db = createFakeDb();
    const pipeline = new ComposePipeline(
      createFakeDocker({ inspectContainer } as Partial<Docker>),
      db,
      createEventBus(),
    );
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'web',
    };
    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);
    const migrate = [...db._projects.values()].find((project) => project.name === 'stack/migrate');
    expect(migrate).toBeDefined();
    Object.assign(migrate!, {
      runtime_role: 'application',
      assigned_port: 10005,
      container_port: 9000,
      health_check_strategy: 'http',
    });

    const second = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['web'],
      previousServiceFingerprints: first.serviceFingerprints,
    });

    expect(second.success).toBe(true);
    expect(migrate).toMatchObject({
      runtime_role: 'job',
      assigned_port: null,
      container_port: null,
      health_check_strategy: 'none',
    });
  });

  it('preserves a traffic target outside the selective API execution set', async () => {
    writeFileSync(
      composePath,
      `services:
  db:
    image: postgres:16
  migrate:
    image: example/api
    depends_on:
      db:
        condition: service_healthy
  api:
    image: example/api
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  web:
    image: example/web
    expose: ["3000"]
    depends_on:
      - api
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const inspectContainer = vi.fn().mockImplementation(async (containerRef: string) => ({
      State: { Running: !containerRef.includes('migrate'), ExitCode: 0 },
    }));
    const db = createFakeDb();
    const pipeline = new ComposePipeline(
      createFakeDocker({ runComposeService, inspectContainer } as Partial<Docker>),
      db,
      createEventBus(),
    );
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trafficService: 'web',
    };
    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);
    const webBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/web',
    )?.container_id;

    const second = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['api'],
      previousServiceFingerprints: first.serviceFingerprints,
    });

    expect(second.success).toBe(true);
    expect(second.trafficService).toBe('web');
    expect(second.trafficServiceProjectId).toBeDefined();
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/web')?.container_id,
    ).toBe(webBefore);
  });

  it('blocks selected replacement when a reused resource is unhealthy', async () => {
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres:16\n  web:\n    image: example/web\n    expose:\n      - "3000"\n    depends_on:\n      - db\n`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const waitForHealthy = vi.fn().mockResolvedValue({ healthy: true });
    const docker = createFakeDocker({
      runComposeService,
      waitForHealthy,
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });
    expect(first.success).toBe(true);
    const callsAfterFirstDeploy = runComposeService.mock.calls.length;
    waitForHealthy.mockResolvedValueOnce({ healthy: false, error: 'database is unhealthy' });

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
      _parentId: first.parentProjectId,
      services: ['web'],
      previousServiceFingerprints: first.serviceFingerprints,
    });

    expect(second.success).toBe(false);
    expect(second.errorCode).toBe('COMPOSE_PREREQUISITE_UNHEALTHY');
    expect(runComposeService).toHaveBeenCalledTimes(callsAfterFirstDeploy);
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-ol-stack-db',
    );
  });

  it('blocks changed and removed resource definitions without removing the container', async () => {
    const initialCompose = `services:\n  db:\n    image: postgres:16\n  web:\n    image: example/web\n    expose:\n      - "3000"\n    depends_on:\n      - db\n`;
    writeFileSync(composePath, initialCompose, 'utf8');
    const docker = createFakeDocker();
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    };
    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);

    writeFileSync(composePath, initialCompose.replace('postgres:16', 'postgres:17'), 'utf8');
    await expect(
      deployWithEnv(pipeline, {
        ...baseConfig,
        _parentId: first.parentProjectId,
        previousServiceFingerprints: first.serviceFingerprints,
      }),
    ).rejects.toMatchObject({ code: 'STATEFUL_SERVICE_CHANGE_BLOCKED' });

    const existingDb = [...db._projects.values()].find((project) => project.name === 'stack/db');
    Object.assign(existingDb!, { runtime_role: 'application' });

    writeFileSync(
      composePath,
      `services:\n  web:\n    image: example/web\n    expose:\n      - "3000"\n`,
      'utf8',
    );
    await expect(
      deployWithEnv(pipeline, {
        ...baseConfig,
        _parentId: first.parentProjectId,
        previousServiceFingerprints: first.serviceFingerprints,
      }),
    ).rejects.toMatchObject({ code: 'STATEFUL_SERVICE_REMOVAL_BLOCKED' });
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-ol-stack-db',
    );
  });

  it('builds api before migration and keeps the existing api when migration fails', async () => {
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres:16\n  migrate:\n    image: example/migrate\n    depends_on:\n      db:\n        condition: service_healthy\n  api:\n    build: ./api\n    expose:\n      - "3000"\n    depends_on:\n      migrate:\n        condition: service_completed_successfully\n      db:\n        condition: service_healthy\n`,
      'utf8',
    );
    mkdirSync(join(tmpDir, 'api'), { recursive: true });
    const actions: string[] = [];
    let runSequence = 0;
    let failMigration = false;
    let failBuild = false;
    const buildComposeService = vi.fn().mockImplementation(async (options) => {
      actions.push('build:api');
      if (failBuild) {
        throw new DockerBuildError(
          'example/api',
          'failed to download package: operation timed out',
        );
      }
      options.onProgress?.({ stream: '#6 [3/5] RUN npm ci\n#6 DONE 8.1s\n' });
    });
    const pullImage = vi.fn().mockImplementation(async (image: string) => {
      actions.push(`pull:${image}`);
    });
    const runComposeService = vi.fn().mockImplementation(async (config: { name: string }) => {
      actions.push(`run:${config.name}`);
      return `container-${config.name}-${String(++runSequence)}`;
    });
    const safeRemoveContainer = vi.fn().mockImplementation(async (containerRef: string) => {
      actions.push(`remove:${containerRef}`);
    });
    const inspectContainer = vi.fn().mockImplementation(async (containerRef: string) => ({
      State: {
        Running: containerRef.includes('migrate') ? false : true,
        ExitCode: containerRef.includes('migrate') && failMigration ? 1 : 0,
      },
    }));
    const docker = createFakeDocker({
      buildComposeService,
      pullImage,
      runComposeService,
      safeRemoveContainer,
      inspectContainer,
    } as Partial<Docker>);
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const baseConfig: ComposeDeployConfig = {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    };
    const first = await deployWithEnv(pipeline, baseConfig);
    expect(first.success).toBe(true);
    const apiBefore = [...db._projects.values()].find((project) => project.name === 'stack/api');
    expect(apiBefore?.container_id).toBeTruthy();
    expect(db._deployLogs).toContainEqual(
      expect.objectContaining({
        serviceId: `${apiBefore?.id ?? ''}__svc`,
        buildLog: expect.stringContaining('#6 [3/5] RUN npm ci\n#6 DONE 8.1s'),
      }),
    );
    const apiContainerBefore = apiBefore?.container_id;
    actions.length = 0;
    failMigration = true;

    const second = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['api'],
      previousServiceFingerprints: first.serviceFingerprints,
    });

    expect(second.success).toBe(false);
    expect(second.errorCode).toBe('COMPOSE_JOB_FAILED');
    expect(actions.indexOf('build:api')).toBeLessThan(actions.indexOf('run:ol-stack-migrate'));
    expect(actions).not.toContain('remove:ol-stack-api');
    expect(actions).not.toContain('run:ol-stack-api');
    const apiAfter = [...db._projects.values()].find((project) => project.name === 'stack/api');
    const migrationAfter = [...db._projects.values()].find(
      (project) => project.name === 'stack/migrate',
    );
    expect(apiAfter).toMatchObject({
      status: 'running',
      container_id: apiContainerBefore,
    });
    expect(migrationAfter).toMatchObject({
      status: 'error',
      container_id: expect.stringContaining('container-ol-stack-migrate-'),
    });
    expect(db._deployLogs).toContainEqual(
      expect.objectContaining({
        serviceId: `${migrationAfter?.id ?? ''}__svc`,
        status: 'failed',
        buildLog: expect.stringContaining('exit_code=1'),
        runtimeLog: expect.stringContaining(
          'exit_code=1\n--- stdout/stderr ---\nmigration stdout\nmigration stderr',
        ),
      }),
    );

    actions.length = 0;
    failMigration = false;
    const third = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['api'],
      previousServiceFingerprints: first.serviceFingerprints,
    });
    expect(third.success).toBe(true);
    expect(actions.indexOf('build:api')).toBeLessThan(actions.indexOf('run:ol-stack-migrate'));
    expect(actions.indexOf('run:ol-stack-migrate')).toBeLessThan(
      actions.indexOf('remove:ol-stack-api'),
    );
    expect(actions.indexOf('remove:ol-stack-api')).toBeLessThan(
      actions.indexOf('run:ol-stack-api'),
    );
    const apiAfterSuccess = [...db._projects.values()].find(
      (project) => project.name === 'stack/api',
    );
    expect(apiAfterSuccess?.container_id).not.toBe(apiContainerBefore);

    const apiContainerAfterSuccess = apiAfterSuccess?.container_id;
    const dbContainerBeforeBuildFailure = [...db._projects.values()].find(
      (project) => project.name === 'stack/db',
    )?.container_id;
    actions.length = 0;
    failBuild = true;
    const fourth = await deployWithEnv(pipeline, {
      ...baseConfig,
      _parentId: first.parentProjectId,
      services: ['api'],
      previousServiceFingerprints: first.serviceFingerprints,
    });
    expect(fourth.success).toBe(false);
    expect(actions).toEqual(['build:api']);
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/api'),
    ).toMatchObject({
      status: 'running',
      container_id: apiContainerAfterSuccess,
    });
    expect(db._deployLogs).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        buildLog: expect.stringContaining('failed to download package: operation timed out'),
      }),
    );
    expect([...db._projects.values()].find((project) => project.name === 'stack/db')).toMatchObject(
      {
        status: 'running',
        container_id: dbContainerBeforeBuildFailure,
      },
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

  it('cleans up an existing application when its profile becomes inactive', async () => {
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx
    expose: ["3000"]
  caddy:
    image: caddy:2
    profiles: ["edge"]
`,
      'utf8',
    );
    const docker = createFakeDocker();
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      profiles: ['edge'],
      name: 'stack',
      trigger: 'chat',
    });
    expect(first.success).toBe(true);
    const caddyBefore = [...db._projects.values()].find(
      (project) => project.name === 'stack/caddy',
    );
    expect(caddyBefore?.container_id).toBe('container-ol-stack-caddy');

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      profiles: [],
      name: 'stack',
      _parentId: first.parentProjectId,
      trigger: 'chat',
    });

    expect(second.success).toBe(true);
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-ol-stack-caddy',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-ol-stack-caddy',
    );
    expect([...db._projects.values()].some((project) => project.name === 'stack/caddy')).toBe(
      false,
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
        sourcePath: realpathSync(dataDir),
        imageTag: 'app:latest',
      }),
    );
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({ extraBinds: ['ol-stack-bind-api-1:/data:ro'] }),
    );
  });

  it('copies relative bind files into the container before startup', async () => {
    const migrationScript = join(tmpDir, 'infra', 'migrate.sh');
    mkdirSync(dirname(migrationScript), { recursive: true });
    writeFileSync(migrationScript, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(migrationScript, 0o755);
    writeFileSync(
      composePath,
      `services:
  migrate:
    image: app:latest
    volumes:
      - ./infra/migrate.sh:/app/infra/migrate.sh:ro
`,
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
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        extraBinds: [],
        fileCopies: [
          {
            sourcePath: realpathSync(migrationScript),
            targetPath: '/app/infra/migrate.sh',
            readOnly: true,
          },
        ],
      }),
    );
  });

  it('rejects relative bind files whose symlink target escapes the repository', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'openlander-compose-bind-outside-'));
    try {
      const outsideFile = join(outsideDir, 'secret.txt');
      writeFileSync(outsideFile, 'not-for-the-container\n', 'utf8');
      const linkedFile = join(tmpDir, 'linked.txt');
      symlinkSync(outsideFile, linkedFile);
      writeFileSync(
        composePath,
        `services:
  api:
    image: app:latest
    volumes:
      - ./linked.txt:/app/linked.txt:ro
`,
        'utf8',
      );
      const runComposeService = vi.fn().mockResolvedValue('container-api');
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
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('escapes the repository');
      expect(runComposeService).not.toHaveBeenCalled();
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('injects only env_file and service-declared variables into each container', async () => {
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
      envVars: { API_KEY: 'test-api-key', OVERRIDE: 'deployment-value' },
    });

    expect(result.success).toBe(true);
    expect(runComposeService).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          FROM_FILE: 'file-value',
          OVERRIDE: 'file-value',
          SERVICE_VALUE: 'service-value',
        }),
      }),
    );
    const call = runComposeService.mock.calls[0]?.[0] as
      { envVars?: Record<string, string> } | undefined;
    expect(call?.envVars).not.toHaveProperty('API_KEY');
  });

  it('blocks an existing stack with stored env when a service has no env declaration', async () => {
    const docker = createFakeDocker();
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    await expect(
      deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        _parentId: first.parentProjectId,
        envVars: { DATABASE_URL: 'postgres://stored.example/app' },
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_ENV_DECLARATION_REQUIRED',
      details: {
        serviceNames: ['web'],
        availableKeys: ['DATABASE_URL'],
      },
    });

    expect(docker.pullImage).toHaveBeenCalledTimes(1);
  });

  it('accepts environment: {} as an explicit no-injection declaration', async () => {
    const docker = createFakeDocker();
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx
    environment: {}
`,
      'utf8',
    );

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      _parentId: first.parentProjectId,
      envVars: { DATABASE_URL: 'postgres://stored.example/app' },
    });

    expect(second.success).toBe(true);
    const calls = (docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.at(-1)?.[0]).toEqual(expect.objectContaining({ envVars: {} }));
  });

  it('does not require env declarations from unselected Compose services', async () => {
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx
    environment: {}
  caddy:
    image: caddy:2-alpine
`,
      'utf8',
    );
    const docker = createFakeDocker();
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());
    const first = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    const second = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      _parentId: first.parentProjectId,
      services: ['web'],
      envVars: { DATABASE_URL: 'postgres://stored.example/app' },
    });

    expect(second.success).toBe(true);
    expect(second.services.map((service) => service.name)).toEqual(['web']);
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
    const db = createFakeDb();
    const pipeline = new ComposePipeline(docker, db, createEventBus());

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
    const migrateProject = [...db._projects.values()].find(
      (project) => project.name === 'stack/migrate',
    );
    expect(db._deployLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serviceId: migrateProject?.service_id,
          status: 'success',
          buildLog: expect.stringContaining('exit_code=0'),
        }),
      ]),
    );
  });

  it('classifies jobs and resources and keeps them off host ports and Traefik routes', async () => {
    writeFileSync(
      composePath,
      `services:
  db:
    image: pgvector/pgvector:pg17
    expose: ["5432"]
  migrate:
    image: app:latest
    expose: ["9000"]
    depends_on:
      db:
        condition: service_healthy
  api:
    image: app:latest
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
`,
      'utf8',
    );
    const runComposeService = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const inspectContainer = vi.fn().mockResolvedValue({
      State: { Running: false, ExitCode: 0 },
    });
    const db = createFakeDb();
    const pipeline = new ComposePipeline(
      createFakeDocker({ runComposeService, inspectContainer } as Partial<Docker>),
      db,
      createEventBus(),
    );

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result.success).toBe(true);
    const calls = runComposeService.mock.calls.map(([config]) => config as Record<string, unknown>);
    const dbCall = calls.find((config) => config.name === 'ol-stack-db');
    const jobCall = calls.find((config) => config.name === 'ol-stack-migrate');
    const apiCall = calls.find((config) => config.name === 'ol-stack-api');
    expect(dbCall).toMatchObject({
      containerPort: 5432,
      exposedPorts: [5432],
      traefikLabels: {},
    });
    expect(dbCall).not.toHaveProperty('port');
    expect(jobCall).toMatchObject({ restart: 'no', traefikLabels: {} });
    expect(jobCall).not.toHaveProperty('port');
    expect(jobCall).not.toHaveProperty('containerPort');
    expect(apiCall).toEqual(
      expect.objectContaining({ port: expect.any(Number), containerPort: 4000 }),
    );

    const roles = new Map(
      [...db._projects.values()].map((project) => [
        project.name,
        (project as ProjectRow & { runtime_role?: string }).runtime_role,
      ]),
    );
    expect(roles.get('stack/db')).toBe('resource');
    expect(roles.get('stack/migrate')).toBe('job');
    expect(roles.get('stack/api')).toBe('application');
    expect(
      [...db._projects.values()].find((project) => project.name === 'stack/db')?.assigned_port,
    ).toBeNull();
  });

  it('returns COMPOSE_JOB_FAILED with exit-code evidence for a failed one-shot job', async () => {
    writeFileSync(
      composePath,
      `services:
  migrate:
    image: app:latest
  api:
    image: app:latest
    expose: ["4000"]
    depends_on:
      migrate:
        condition: service_completed_successfully
`,
      'utf8',
    );
    const pipeline = new ComposePipeline(
      createFakeDocker({
        inspectContainer: vi.fn().mockResolvedValue({
          State: { Running: false, ExitCode: 1 },
        }),
      } as Partial<Docker>),
      createFakeDb(),
      createEventBus(),
    );

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'COMPOSE_JOB_FAILED',
      details: { serviceName: 'migrate', exitCode: 1 },
    });
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

  it('classifies completed dependencies before database image signatures', () => {
    const roles = inferComposeRuntimeRoles([
      { name: 'migrate', image: 'postgres:16' },
      {
        name: 'api',
        image: 'app:latest',
        dependsOn: ['migrate'],
        dependsOnConditions: { migrate: 'service_completed_successfully' },
      },
      { name: 'db', image: 'pgvector/pgvector:pg17' },
    ]);

    expect(Object.fromEntries(roles)).toEqual({
      migrate: 'job',
      api: 'application',
      db: 'resource',
    });
  });
});
