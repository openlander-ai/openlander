import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { ComposePipeline } from '../../src/pipeline/compose.js';
import { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { clearPortScanCache, clearPortReservations } from '../../src/pipeline/port.js';
import { eventBus } from '../../src/events/index.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import * as dockerfileGen from '../../src/pipeline/dockerfile-gen.js';

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

type CapturedEvent = {
  type: string;
  payloadShape: unknown;
};

const DEPLOY_AND_COMPOSE_EVENT_TYPES = [
  'deploy:start',
  'deploy:clone',
  'deploy:diff-analyzed',
  'env:new-keys-detected',
  'secret:detected',
  'deploy:auto-detect',
  'build:output',
  'deploy:build',
  'deploy:run',
  'monitor:healthcheck',
  'deploy:crash',
  'deploy:success',
  'build:inform',
  'build:suggest',
  'deploy:failed',
  'deploy:rollback',
  'container:stop',
  'container:start',
  'container:remove',
  'tunnel:url',
  'compose:start',
  'compose:up',
  'compose:down',
  'compose:failed',
] as const;

const DEPLOY_AND_COMPOSE_EVENT_TYPE_SET = new Set<string>(DEPLOY_AND_COMPOSE_EVENT_TYPES);

function createMockDocker(): Docker {
  let runCount = 0;
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockImplementation(async () => {
      runCount += 1;
      return `container-new-${String(runCount).padStart(6, '0')}`;
    }),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
    listManagedContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    cleanupSecretFiles: vi.fn(),
    ensureProjectNetwork: vi.fn().mockResolvedValue('compose-network'),
    pullImage: vi.fn().mockResolvedValue(undefined),
    buildComposeService: vi.fn().mockResolvedValue(undefined),
    runComposeService: vi.fn().mockImplementation(async (config: { name: string }) => config.name),
    removeProjectNetwork: vi.fn().mockResolvedValue(undefined),
    getNetworkName: vi.fn().mockReturnValue('openlander-prod'),
  } as unknown as Docker;
}

function payloadShapeOf(value: unknown): unknown {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [payloadShapeOf(value[0])];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, payloadShapeOf(nested)]));
  }
  return typeof value;
}

function eventTypes(events: CapturedEvent[]): string[] {
  return events.map((event) => event.type);
}

async function capturePipelineEvents(run: () => Promise<unknown>): Promise<CapturedEvent[]> {
  const captured: CapturedEvent[] = [];
  const emitSpy = vi.spyOn(eventBus, 'emit').mockImplementation(async (type, payload) => {
    if (DEPLOY_AND_COMPOSE_EVENT_TYPE_SET.has(type)) {
      captured.push({ type, payloadShape: payloadShapeOf(payload) });
    }
  });

  try {
    await run();
    return captured;
  } finally {
    emitSpy.mockRestore();
  }
}

describe('pipeline event golden snapshots', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-event-golden-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
      branch: 'main',
    });
    vi.spyOn(dockerfileGen, 'ensureDockerfile').mockReturnValue({
      generated: false,
      detection: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    clearPortReservations();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('catalogs all unique deploy.ts + compose.ts event types', () => {
    expect([...DEPLOY_AND_COMPOSE_EVENT_TYPES].sort()).toMatchSnapshot();
  });

  it('captures single deploy event sequence and payload shapes', async () => {
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    const pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    db.createProject({
      id: 'single-project',
      name: 'single-app',
      repoUrl: 'https://github.com/openlander/single-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('single-project')
      .find((entry) => entry.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const events = await capturePipelineEvents(async () => {
      const result = await pipeline.deployEnvironment('single-project', productionEnvironment!.id, {
        repoUrl: 'https://github.com/openlander/single-app',
      });
      expect(result.success).toBe(true);
    });

    expect(eventTypes(events)).toEqual([
      'deploy:start',
      'deploy:clone',
      'deploy:build',
      'deploy:run',
      'monitor:healthcheck',
      'deploy:success',
    ]);
    expect(events).toMatchSnapshot();
  });

  it('captures monorepo deploy event sequence and payload shapes', async () => {
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    const pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    mkdirSync(join(clonePath, 'frontend'), { recursive: true });
    mkdirSync(join(clonePath, 'backend'), { recursive: true });
    writeFileSync(join(clonePath, 'frontend', 'Dockerfile'), 'FROM node:20\nEXPOSE 3001\n', 'utf8');
    writeFileSync(join(clonePath, 'backend', 'Dockerfile'), 'FROM node:20\nEXPOSE 3002\n', 'utf8');

    const events = await capturePipelineEvents(async () => {
      const result = await pipeline.deployMonorepo({
        repoUrl: 'https://github.com/openlander/mono-app',
        branch: 'main',
        clonePath,
        commitSha: 'cafebabedeadbeef',
        dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      });
      expect(result.children).toHaveLength(2);
    });

    expect(eventTypes(events)).toMatchSnapshot();
    expect(events).toMatchSnapshot();
  });

  it('captures rollback event sequence and payload shapes', async () => {
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    const pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    db.createProject({
      id: 'rollback-project',
      name: 'rollback-app',
      repoUrl: 'https://github.com/openlander/rollback-app',
      branch: 'main',
    });
    db.updateProject('rollback-project', {
      status: 'running',
      containerId: 'container-live',
      imageTag: 'openlander/rollback-app:v2',
      previousImageTag: 'openlander/rollback-app:v1',
    });

    const events = await capturePipelineEvents(async () => {
      const result = await pipeline.rollback('rollback-project');
      expect(result.success).toBe(true);
    });

    expect(eventTypes(events)).toEqual(['deploy:rollback']);
    expect(events).toMatchSnapshot();
  });

  it('captures stop/start/remove event sequence and payload shapes', async () => {
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    const pipeline = new DeployPipeline(docker, db, env as never, testConfig);
    db.createProject({
      id: 'control-project',
      name: 'control-app',
      repoUrl: 'https://github.com/openlander/control-app',
      branch: 'main',
    });
    db.updateProject('control-project', {
      status: 'running',
      containerId: 'container-control',
    });

    const events = await capturePipelineEvents(async () => {
      await pipeline.stop('control-project');
      await pipeline.start('control-project');
      await pipeline.remove('control-project');
    });

    expect(eventTypes(events)).toEqual(['container:stop', 'container:start', 'container:remove']);
    expect(events).toMatchSnapshot();
  });

  it('captures compose success + down event sequence and payload shapes', async () => {
    const composePath = join(clonePath, 'docker-compose.yml');
    writeFileSync(
      composePath,
      'services:\n  web:\n    image: nginx:latest\n    ports:\n      - "18080:80"\n',
      'utf8',
    );
    const composePipeline = new ComposePipeline(docker, db, eventBus);

    const events = await capturePipelineEvents(async () => {
      const deployResult = await composePipeline.deployCompose({
        repoUrl: 'https://github.com/openlander/compose-app',
        branch: 'main',
        clonePath,
        composePath,
        name: 'compose-app',
      });
      expect(deployResult.success).toBe(true);

      await composePipeline.stopCompose(deployResult.parentProjectId);
    });

    expect(eventTypes(events)).toEqual(['compose:start', 'compose:up', 'compose:down']);
    expect(events).toMatchSnapshot();
  });

  it('captures compose failed event sequence and payload shapes', async () => {
    const composePath = join(clonePath, 'docker-compose.yml');
    writeFileSync(
      composePath,
      'services:\n  web:\n    image: nginx:latest\n    ports:\n      - "19090:80"\n',
      'utf8',
    );
    const composeDocker = {
      ...docker,
      runComposeService: vi.fn().mockRejectedValue(new Error('build failed')),
    } as unknown as Docker;
    const composePipeline = new ComposePipeline(composeDocker, db, eventBus);

    const events = await capturePipelineEvents(async () => {
      const deployResult = await composePipeline.deployCompose({
        repoUrl: 'https://github.com/openlander/compose-fail-app',
        branch: 'main',
        clonePath,
        composePath,
        name: 'compose-fail-app',
      });
      expect(deployResult.success).toBe(false);
    });

    expect(eventTypes(events)).toEqual(['compose:start', 'compose:failed']);
    expect(events).toMatchSnapshot();
  });
});
