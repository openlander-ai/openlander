import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  ComposePipeline,
  filterServicesByProfiles,
  type ComposeService,
} from '../src/pipeline/compose.js';
import type {
  ComposeDeployConfig,
  ComposePipeline as ComposePipelineType,
} from '../src/pipeline/compose.js';
import { Database } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { formatEnvValue } from '../src/pipeline/env-inject.js';

const REQUIRED_ENV_VARS = { API_KEY: 'test-api-key' };

function createMockDocker(): Docker {
  return {
    listAllContainers: vi.fn().mockResolvedValue([]),
    ensureProjectNetwork: vi.fn().mockImplementation(async (projectName: string) => projectName),
    buildComposeService: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    runComposeService: vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    removeProjectNetwork: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue(''),
    getNetworkName: vi.fn().mockReturnValue('openlander-prod'),
  } as unknown as Docker;
}

describe('ComposePipeline', () => {
  let tmpDir: string;
  let db: Database;
  let events: EventBus;
  let pipeline: ComposePipelineType;

  async function deployWithEnv(targetPipeline: ComposePipelineType, config: ComposeDeployConfig) {
    return targetPipeline.deployCompose({
      ...config,
      envVars: { ...REQUIRED_ENV_VARS, ...(config.envVars ?? {}) },
    });
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    events = new EventBus();
    pipeline = new ComposePipeline(createMockDocker(), db, events);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects compose file using priority order', () => {
    writeFileSync(join(tmpDir, 'compose.yaml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');

    const detected = pipeline.detectComposeFile(tmpDir);
    expect(detected).toBe(join(tmpDir, 'docker-compose.yml'));
  });

  it('detectComposeFile checks supported filenames in order', () => {
    writeFileSync(join(tmpDir, 'docker-compose.yaml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'compose.yml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'compose.yaml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');

    const detected = pipeline.detectComposeFile(tmpDir);

    expect(detected).toBe(join(tmpDir, 'docker-compose.yml'));
  });

  it('parses compose file with service variants', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx:latest\n    build:\n      context: ./web\n      dockerfile: Dockerfile.prod\n    ports:\n      - "3000:3000"\n    environment:\n      NODE_ENV: production\n      PORT: "3000"\n    depends_on:\n      db:\n        condition: service_started\n    volumes:\n      - ./web:/app\n  db:\n    image: postgres:16\n    environment:\n      - POSTGRES_PASSWORD=secret\n`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    expect(parsed.services).toHaveLength(2);

    const web = parsed.services.find((service) => service.name === 'web');
    expect(web?.build).toEqual({ context: './web', dockerfile: 'Dockerfile.prod' });
    expect(web?.environment).toEqual({ NODE_ENV: 'production', PORT: '3000' });
    expect(web?.dependsOn).toEqual(['db']);

    const dbService = parsed.services.find((service) => service.name === 'db');
    expect(dbService?.environment).toEqual(['POSTGRES_PASSWORD=secret']);
  });

  it('parseComposeFile parses string build, env list/map, and depends_on array', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  api:
    build: ./api
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const api = parsed.services.find((service) => service.name === 'api');
    const dbService = parsed.services.find((service) => service.name === 'db');

    expect(api?.build).toBe('./api');
    expect(api?.ports).toEqual(['8080:8080']);
    expect(api?.environment).toEqual(['NODE_ENV=production']);
    expect(api?.dependsOn).toEqual(['db']);
    expect(dbService?.environment).toEqual({ POSTGRES_DB: 'app' });
  });

  it('parseComposeFile parses service profiles from YAML', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  api:
    image: nginx
    profiles:
      - web
  db:
    image: postgres
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const api = parsed.services.find((service) => service.name === 'api');
    const dbService = parsed.services.find((service) => service.name === 'db');

    expect(api?.profiles).toEqual(['web']);
    expect(dbService?.profiles).toBeUndefined();
  });

  it('parseComposeFile keeps profiles undefined when absent', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  worker:
    image: busybox
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const worker = parsed.services.find((service) => service.name === 'worker');

    expect(worker?.profiles).toBeUndefined();
  });

  it('parseComposeFile parses multiple profiles', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  worker:
    image: busybox
    profiles:
      - jobs
      - async
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const worker = parsed.services.find((service) => service.name === 'worker');

    expect(worker?.profiles).toEqual(['jobs', 'async']);
  });

  it('filterServicesByProfiles excludes profiled services when activeProfiles is undefined', () => {
    const services: ComposeService[] = [{ name: 'api', profiles: ['app'] }, { name: 'db' }];

    const filtered = filterServicesByProfiles(services, undefined);

    expect(filtered.map((service) => service.name)).toEqual(['db']);
  });

  it('filterServicesByProfiles filters profiled services when activeProfiles is empty', () => {
    const services: ComposeService[] = [
      { name: 'api', profiles: ['app'] },
      { name: 'db' },
      { name: 'worker', profiles: ['jobs'] },
    ];

    const filtered = filterServicesByProfiles(services, []);

    expect(filtered.map((service) => service.name)).toEqual(['db']);
  });

  it('filterServicesByProfiles includes service when a profile matches', () => {
    const services: ComposeService[] = [{ name: 'api', profiles: ['app'] }, { name: 'db' }];

    const filtered = filterServicesByProfiles(services, ['app']);

    expect(filtered.map((service) => service.name)).toEqual(['api', 'db']);
  });

  it('filterServicesByProfiles applies OR matching for multi-profile services', () => {
    const services: ComposeService[] = [
      { name: 'worker', profiles: ['jobs', 'async'] },
      { name: 'db' },
    ];

    const filtered = filterServicesByProfiles(services, ['async']);

    expect(filtered.map((service) => service.name)).toEqual(['worker', 'db']);
  });

  it('filterServicesByProfiles excludes profiled services when no profile matches', () => {
    const services: ComposeService[] = [{ name: 'api', profiles: ['app'] }, { name: 'db' }];

    const filtered = filterServicesByProfiles(services, ['jobs']);

    expect(filtered.map((service) => service.name)).toEqual(['db']);
  });

  it('filterServicesByProfiles strips dependsOn entries to removed services', () => {
    const services: ComposeService[] = [
      { name: 'api', profiles: ['app'], dependsOn: ['db', 'cache'] },
      { name: 'db' },
      { name: 'cache', profiles: ['cache'] },
    ];

    const filtered = filterServicesByProfiles(services, ['app']);
    const api = filtered.find((service) => service.name === 'api');

    expect(api?.dependsOn).toEqual(['db']);
  });

  it('filterServicesByProfiles preserves dependsOn entries to kept services', () => {
    const services: ComposeService[] = [
      { name: 'api', profiles: ['app'], dependsOn: ['db'] },
      { name: 'db' },
    ];

    const filtered = filterServicesByProfiles(services, ['app']);
    const api = filtered.find((service) => service.name === 'api');

    expect(api?.dependsOn).toEqual(['db']);
  });

  it('filterServicesByProfiles is immutable for input array and dependsOn arrays', () => {
    const services: ComposeService[] = [
      { name: 'api', profiles: ['app'], dependsOn: ['db', 'cache'] },
      { name: 'db' },
      { name: 'cache', profiles: ['cache'] },
    ];

    const originalSnapshot = services.map((service) => ({
      ...service,
      profiles: service.profiles ? [...service.profiles] : undefined,
      dependsOn: service.dependsOn ? [...service.dependsOn] : undefined,
    }));

    const filtered = filterServicesByProfiles(services, ['app']);
    const api = filtered.find((service) => service.name === 'api');

    expect(services).toEqual(originalSnapshot);
    expect(api?.dependsOn).toEqual(['db']);
    expect(api?.dependsOn).not.toBe(services[0]?.dependsOn);
  });

  it('parseComposeFile handles empty and invalid compose files', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');

    writeFileSync(composePath, '', 'utf8');
    const emptyParsed = pipeline.parseComposeFile(composePath);
    expect(emptyParsed.services).toEqual([]);

    writeFileSync(composePath, 'services: [broken', 'utf8');
    expect(() => pipeline.parseComposeFile(composePath)).toThrow();
  });

  it('detects and deploys compose project via dockerode', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    ports:\n      - "3000:3000"\n  db:\n    image: postgres\n`,
      'utf8',
    );

    const docker = createMockDocker();
    pipeline = new ComposePipeline(docker, db, events);

    const detectedComposePath = pipeline.detectComposeFile(tmpDir);
    expect(detectedComposePath).toBe(composePath);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath: detectedComposePath ?? composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services).toHaveLength(2);
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web', status: 'running' }),
        expect.objectContaining({ name: 'db', status: 'running' }),
      ]),
    );

    const parent = db.getProject(result.parentProjectId);
    expect(parent?.status).toBe('running');

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.status).sort()).toEqual(['running', 'running']);
    expect((docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('deployCompose single-service build deploy calls both build and run', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    build: .\n    ports:\n      - "3000:3000"\n`,
      'utf8',
    );

    const docker = createMockDocker();
    pipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services).toEqual([expect.objectContaining({ name: 'web', status: 'running' })]);
    expect((docker.buildComposeService as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect((docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('deployCompose retries once and succeeds on port conflict', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    ports:\n      - "3000:3000"\n`,
      'utf8',
    );

    const runComposeServiceMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Bind for 0.0.0.0:3000 failed: port is already allocated'))
      .mockResolvedValueOnce('container-ol-stack-web');
    const docker = {
      ...createMockDocker(),
      runComposeService: runComposeServiceMock,
    } as unknown as Docker;
    pipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services).toEqual([expect.objectContaining({ name: 'web', status: 'running' })]);
    expect(runComposeServiceMock.mock.calls).toHaveLength(2);
  });

  it('deployCompose excludes profiled services when profiles is omitted', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n    profiles:\n      - infra\n`,
      'utf8',
    );

    const docker = createMockDocker();
    pipeline = new ComposePipeline(docker, db, events);
    const startEvents: Array<{ serviceCount: number }> = [];
    events.on('compose:start', (payload) => {
      startEvents.push({ serviceCount: payload.serviceCount });
    });

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services.map((service) => service.name)).toEqual(['web']);
    expect(startEvents).toEqual([{ serviceCount: 1 }]);

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(1);
    expect(children[0]?.name).toBe('stack/web');

    const runCalls = (docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls;
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.[0]).toMatchObject({ name: 'ol-stack-web' });
  });

  it('deployCompose includes matching profiled services', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n    profiles:\n      - infra\n`,
      'utf8',
    );

    const docker = createMockDocker();
    pipeline = new ComposePipeline(docker, db, events);
    const startEvents: Array<{ serviceCount: number }> = [];
    events.on('compose:start', (payload) => {
      startEvents.push({ serviceCount: payload.serviceCount });
    });

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      profiles: ['infra'],
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services.map((service) => service.name).sort()).toEqual(['db', 'web']);
    expect(startEvents).toEqual([{ serviceCount: 2 }]);

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.name).sort()).toEqual(['stack/db', 'stack/web']);

    const deployedServices = (docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0]?.name,
    );
    expect(deployedServices.sort()).toEqual(['ol-stack-db', 'ol-stack-web']);
  });

  it('deployCompose handles depends_on targeting filtered-out profiled services', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  api:\n    image: nginx\n    depends_on:\n      - cache\n  cache:\n    image: redis\n    profiles:\n      - infra\n`,
      'utf8',
    );

    const docker = createMockDocker();
    pipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      profiles: [],
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.services.map((service) => service.name)).toEqual(['api']);

    const deployedServices = (docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0]?.name,
    );
    expect(deployedServices).toEqual(['ol-stack-api']);
  });

  describe('orphan child project cleanup', () => {
    it('deletes orphan child project and stops/removes its container on redeploy from 3 services to 2', async () => {
      const composePath = join(tmpDir, 'docker-compose.yml');
      writeFileSync(
        composePath,
        `services:\n  web:\n    image: nginx\n  api:\n    image: node:20\n  worker:\n    image: busybox\n`,
        'utf8',
      );

      const stopContainerMock = vi.fn().mockResolvedValue(undefined);
      const removeContainerMock = vi.fn().mockResolvedValue(undefined);
      const docker = {
        ...createMockDocker(),
        stopContainer: stopContainerMock,
        removeContainer: removeContainerMock,
      } as unknown as Docker;
      pipeline = new ComposePipeline(docker, db, events);

      const orphanEvents: Array<{ projectId: string; removed: string[] }> = [];
      events.on('compose:orphans-cleaned', (payload) => {
        orphanEvents.push(payload);
      });

      const firstDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        trigger: 'chat',
      });
      expect(firstDeploy.success).toBe(true);

      const firstChildren = db.getChildProjects(firstDeploy.parentProjectId);
      expect(firstChildren).toHaveLength(3);
      const workerChild = firstChildren.find((child) => child.name === 'stack/worker');
      expect(workerChild).toBeDefined();
      expect(workerChild?.container_id).toBe('container-ol-stack-worker');

      const originalGetChildProjects = db.getChildProjects.bind(db);
      const getChildProjectsMock = vi
        .spyOn(db, 'getChildProjects')
        .mockImplementation((projectId) => originalGetChildProjects(projectId));
      const deleteProjectMock = vi.spyOn(db, 'deleteProject');

      writeFileSync(
        composePath,
        `services:\n  web:\n    image: nginx\n  api:\n    image: node:20\n`,
        'utf8',
      );
      const secondDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        _parentId: firstDeploy.parentProjectId,
        trigger: 'chat',
      });

      expect(secondDeploy.success).toBe(true);
      expect(getChildProjectsMock).toHaveBeenCalledWith(firstDeploy.parentProjectId);
      expect(deleteProjectMock).toHaveBeenCalledWith(workerChild!.id);
      expect(stopContainerMock).toHaveBeenCalledWith('container-ol-stack-worker');
      expect(removeContainerMock).toHaveBeenCalledWith('container-ol-stack-worker');
      expect(orphanEvents).toEqual([
        {
          projectId: firstDeploy.parentProjectId,
          removed: ['worker'],
        },
      ]);

      const secondChildren = db.getChildProjects(firstDeploy.parentProjectId);
      expect(secondChildren.map((child) => child.name).sort()).toEqual(['stack/api', 'stack/web']);
    });

    it('does not clean up non-selected services when deploy_only filter is used', async () => {
      const composePath = join(tmpDir, 'docker-compose.yml');
      writeFileSync(
        composePath,
        `services:\n  web:\n    image: nginx\n  api:\n    image: node:20\n  worker:\n    image: busybox\n`,
        'utf8',
      );

      const stopContainerMock = vi.fn().mockResolvedValue(undefined);
      const removeContainerMock = vi.fn().mockResolvedValue(undefined);
      const docker = {
        ...createMockDocker(),
        stopContainer: stopContainerMock,
        removeContainer: removeContainerMock,
      } as unknown as Docker;
      pipeline = new ComposePipeline(docker, db, events);

      const firstDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        trigger: 'chat',
      });
      expect(firstDeploy.success).toBe(true);

      const originalGetChildProjects = db.getChildProjects.bind(db);
      vi.spyOn(db, 'getChildProjects').mockImplementation((projectId) =>
        originalGetChildProjects(projectId),
      );
      const deleteProjectMock = vi.spyOn(db, 'deleteProject');

      const runComposeServiceMock = docker.runComposeService as ReturnType<typeof vi.fn>;
      const secondDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        _parentId: firstDeploy.parentProjectId,
        services: ['web'],
        trigger: 'chat',
      });

      expect(secondDeploy.success).toBe(true);
      expect(deleteProjectMock).not.toHaveBeenCalled();
      expect(stopContainerMock).not.toHaveBeenCalledWith('container-ol-stack-worker');
      expect(removeContainerMock).not.toHaveBeenCalledWith('container-ol-stack-worker');

      const children = db.getChildProjects(firstDeploy.parentProjectId);
      expect(children.map((child) => child.name).sort()).toEqual([
        'stack/api',
        'stack/web',
        'stack/worker',
      ]);
      const secondDeployServices = runComposeServiceMock.mock.calls
        .slice(3)
        .map((call) => call[0]?.name);
      expect(secondDeployServices).toEqual(['ol-stack-web']);
    });

    it('creates a new child project when services are added without orphan cleanup', async () => {
      const composePath = join(tmpDir, 'docker-compose.yml');
      writeFileSync(
        composePath,
        `services:\n  web:\n    image: nginx\n  api:\n    image: node:20\n`,
        'utf8',
      );

      const stopContainerMock = vi.fn().mockResolvedValue(undefined);
      const removeContainerMock = vi.fn().mockResolvedValue(undefined);
      pipeline = new ComposePipeline(
        {
          ...createMockDocker(),
          stopContainer: stopContainerMock,
          removeContainer: removeContainerMock,
        } as unknown as Docker,
        db,
        events,
      );

      const orphanEvents: Array<{ projectId: string; removed: string[] }> = [];
      events.on('compose:orphans-cleaned', (payload) => {
        orphanEvents.push(payload);
      });

      const firstDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        trigger: 'chat',
      });
      expect(firstDeploy.success).toBe(true);

      const beforeChildren = db.getChildProjects(firstDeploy.parentProjectId);
      const beforeChildIds = new Set(beforeChildren.map((child) => child.id));
      expect(beforeChildren.map((child) => child.name).sort()).toEqual(['stack/api', 'stack/web']);

      const originalGetChildProjects = db.getChildProjects.bind(db);
      vi.spyOn(db, 'getChildProjects').mockImplementation((projectId) =>
        originalGetChildProjects(projectId),
      );
      const deleteProjectMock = vi.spyOn(db, 'deleteProject');

      writeFileSync(
        composePath,
        `services:\n  web:\n    image: nginx\n  api:\n    image: node:20\n  worker:\n    image: busybox\n`,
        'utf8',
      );
      const secondDeploy = await deployWithEnv(pipeline, {
        repoUrl: 'https://github.com/example/stack',
        clonePath: tmpDir,
        composePath,
        name: 'stack',
        _parentId: firstDeploy.parentProjectId,
        trigger: 'chat',
      });

      expect(secondDeploy.success).toBe(true);
      expect(deleteProjectMock).not.toHaveBeenCalled();
      expect(stopContainerMock).not.toHaveBeenCalledWith('container-ol-stack-worker');
      expect(removeContainerMock).not.toHaveBeenCalledWith('container-ol-stack-worker');
      expect(orphanEvents).toEqual([]);

      const afterChildren = db.getChildProjects(firstDeploy.parentProjectId);
      expect(afterChildren.map((child) => child.name).sort()).toEqual([
        'stack/api',
        'stack/web',
        'stack/worker',
      ]);

      const workerChild = afterChildren.find((child) => child.name === 'stack/worker');
      expect(workerChild).toBeDefined();
      expect(workerChild && beforeChildIds.has(workerChild.id)).toBe(false);
    });
  });

  it('rolls back previously started compose services when a dependency-ordered service fails', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres\n  api:\n    image: nginx\n    depends_on:\n      - db\n`,
      'utf8',
    );

    const runComposeServiceMock = vi.fn().mockImplementation(async (config: { name: string }) => {
      if (config.name.endsWith('-api')) {
        throw new Error('api failed to start');
      }
      return 'container-ol-stack-db';
    });
    const stopContainerMock = vi.fn().mockResolvedValue(undefined);
    const removeContainerMock = vi.fn().mockResolvedValue(undefined);
    const docker = {
      ...createMockDocker(),
      runComposeService: runComposeServiceMock,
      stopContainer: stopContainerMock,
      removeContainer: removeContainerMock,
    } as unknown as Docker;
    pipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('api');

    const parent = db.getProject(result.parentProjectId);
    expect(parent?.status).toBe('error');

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.status).sort()).toEqual(['error', 'error']);

    const deployedServices = runComposeServiceMock.mock.calls.map((call) => call[0]?.name);
    expect(deployedServices).toContain('ol-stack-db');
    expect(deployedServices).toContain('ol-stack-api');
    expect(stopContainerMock).toHaveBeenCalledWith('container-ol-stack-db');
    expect(removeContainerMock).toHaveBeenCalledWith('container-ol-stack-db');
  });

  it('blocks dependent service start when dependency is stopped', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres\n  api:\n    image: nginx\n    depends_on:\n      - db\n`,
      'utf8',
    );

    const runComposeServiceMock = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `container-${config.name}`);
    const waitForHealthyMock = vi
      .fn()
      .mockResolvedValue({ healthy: false, error: 'db is stopped' });
    const docker = {
      ...createMockDocker(),
      runComposeService: runComposeServiceMock,
      waitForHealthy: waitForHealthyMock,
    } as unknown as Docker;
    pipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(pipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('db is stopped');
    expect(runComposeServiceMock.mock.calls.map((call) => call[0]?.name)).toEqual(['ol-stack-db']);
  });

  it('reads service statuses from compose child projects', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services: {}\n', 'utf8');

    db.createProject({
      id: 'parent-project',
      name: 'stack',
      repoUrl: 'https://github.com/example/stack',
      dockerfilePath: composePath,
    });

    db.createProject({
      id: 'child-api',
      name: 'stack/api',
      repoUrl: 'https://github.com/example/stack',
      parentProjectId: 'parent-project',
      dockerfilePath: composePath,
    });
    db.updateProject('child-api', {
      status: 'running',
      assignedPort: 8080,
      containerId: 'api-id',
    });

    db.createProject({
      id: 'child-worker',
      name: 'stack/worker',
      repoUrl: 'https://github.com/example/stack',
      parentProjectId: 'parent-project',
      dockerfilePath: composePath,
    });
    db.updateProject('child-worker', {
      status: 'stopped',
      assignedPort: null,
      containerId: 'worker-id',
    });

    const statuses = await pipeline.getServiceStatuses('parent-project');
    expect(statuses).toEqual([
      {
        name: 'api',
        status: 'running',
        ports: ['8080'],
        containerId: 'api-id',
      },
      {
        name: 'worker',
        status: 'stopped',
        ports: undefined,
        containerId: 'worker-id',
      },
    ]);
  });

  it('gates --progress=plain flag when compose version < 2.3.0', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    ports:\n      - "3000:3000"\n`,
      'utf8',
    );

    const docker = createMockDocker();
    const freshPipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(freshPipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect((docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('never includes --progress=plain flag (removed for compatibility)', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    ports:\n      - "3000:3000"\n`,
      'utf8',
    );

    const docker = createMockDocker();
    const freshPipeline = new ComposePipeline(docker, db, events);

    const result = await deployWithEnv(freshPipeline, {
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect((docker.runComposeService as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('parses command as string', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    command: npm start
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.command).toBe('npm start');
  });

  it('parses command as array', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    command:
      - npm
      - start
      - --port
      - "3000"
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.command).toEqual(['npm', 'start', '--port', '3000']);
  });

  it('parses entrypoint as string', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    entrypoint: /bin/sh
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.entrypoint).toBe('/bin/sh');
  });

  it('parses entrypoint as array', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    entrypoint:
      - /bin/sh
      - -c
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.entrypoint).toEqual(['/bin/sh', '-c']);
  });

  it('parses restart policy', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    restart: always
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.restart).toBe('always');
  });

  it('parses healthcheck with test as string', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    healthcheck:
      test: curl -f http://localhost:3000 || exit 1
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck?.test).toBe('curl -f http://localhost:3000 || exit 1');
  });

  it('parses healthcheck with test as array', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    healthcheck:
      test:
        - CMD
        - curl
        - -f
        - http://localhost:3000
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck?.test).toEqual(['CMD', 'curl', '-f', 'http://localhost:3000']);
  });

  it('parses healthcheck with all fields', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    healthcheck:
      test:
        - CMD
        - curl
        - -f
        - http://localhost:3000
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck).toEqual({
      test: ['CMD', 'curl', '-f', 'http://localhost:3000'],
      interval: '30s',
      timeout: '10s',
      retries: 3,
      start_period: '40s',
    });
  });

  it('parses healthcheck with retries as string number', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    healthcheck:
      test: curl -f http://localhost:3000 || exit 1
      retries: "5"
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck?.retries).toBe(5);
  });

  it('keeps command undefined when absent', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.command).toBeUndefined();
  });

  it('keeps entrypoint undefined when absent', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.entrypoint).toBeUndefined();
  });

  it('keeps restart undefined when absent', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.restart).toBeUndefined();
  });

  it('keeps healthcheck undefined when absent', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck).toBeUndefined();
  });

  it('parses multiple services with mixed new fields', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx
    restart: always
    healthcheck:
      test: curl -f http://localhost || exit 1
      interval: 30s
  api:
    image: node:20
    command: npm start
    entrypoint:
      - /bin/sh
      - -c
  worker:
    image: python:3.11
    restart: on-failure
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);

    const web = parsed.services.find((service) => service.name === 'web');
    expect(web?.restart).toBe('always');
    expect(web?.healthcheck?.test).toBe('curl -f http://localhost || exit 1');
    expect(web?.command).toBeUndefined();

    const api = parsed.services.find((service) => service.name === 'api');
    expect(api?.command).toBe('npm start');
    expect(api?.entrypoint).toEqual(['/bin/sh', '-c']);
    expect(api?.restart).toBeUndefined();

    const worker = parsed.services.find((service) => service.name === 'worker');
    expect(worker?.restart).toBe('on-failure');
    expect(worker?.command).toBeUndefined();
    expect(worker?.healthcheck).toBeUndefined();
  });

  it('parses healthcheck without test field (incomplete healthcheck)', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    healthcheck:
      interval: 30s
      timeout: 10s
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.healthcheck).toBeUndefined();
  });

  it('parses command and entrypoint together', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  app:
    image: node:20
    entrypoint: /bin/sh
    command: -c "npm start"
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const app = parsed.services.find((service) => service.name === 'app');

    expect(app?.entrypoint).toBe('/bin/sh');
    expect(app?.command).toBe('-c "npm start"');
  });

  it('backward compatibility - compose without new fields still parses correctly', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
    environment:
      - NGINX_HOST=example.com
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    depends_on:
      - web
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    expect(parsed.services).toHaveLength(2);

    const web = parsed.services.find((service) => service.name === 'web');
    expect(web?.image).toBe('nginx:latest');
    expect(web?.ports).toEqual(['80:80']);
    expect(web?.command).toBeUndefined();
    expect(web?.entrypoint).toBeUndefined();
    expect(web?.restart).toBeUndefined();
    expect(web?.healthcheck).toBeUndefined();

    const db = parsed.services.find((service) => service.name === 'db');
    expect(db?.image).toBe('postgres:16');
    expect(db?.dependsOn).toEqual(['web']);
    expect(db?.command).toBeUndefined();
    expect(db?.entrypoint).toBeUndefined();
    expect(db?.restart).toBeUndefined();
    expect(db?.healthcheck).toBeUndefined();
  });
});

describe('formatEnvValue', () => {
  it('returns plain value for simple strings', () => {
    expect(formatEnvValue('hello')).toBe('hello');
    expect(formatEnvValue('12345')).toBe('12345');
  });

  it('quotes values with whitespace', () => {
    expect(formatEnvValue('hello world')).toBe('"hello world"');
  });

  it('escapes newlines in values', () => {
    const pem = '-----BEGIN KEY-----\nMIIC...\n-----END KEY-----';
    const result = formatEnvValue(pem);
    expect(result).toContain('\\n');
    expect(result).not.toContain('\n');
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
  });

  it('escapes dollar signs to prevent shell interpolation', () => {
    expect(formatEnvValue('price=$100')).toBe('"price=\\$100"');
  });

  it('escapes backticks', () => {
    expect(formatEnvValue('cmd=`whoami`')).toBe('"cmd=\\`whoami\\`"');
  });

  it('escapes double quotes in values', () => {
    expect(formatEnvValue('{"key":"value"}')).toBe('"{\\"key\\":\\"value\\"}"');
  });

  it('returns empty string for empty input', () => {
    expect(formatEnvValue('')).toBe('');
  });
});
