import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { ComposePipeline } from '../src/pipeline/compose.js';
import { Database } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';
import type { Docker } from '../src/pipeline/docker.js';

describe('ComposePipeline dockerode networking', () => {
  let tmpDir: string;
  let db: Database;
  let events: EventBus;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-network-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    events = new EventBus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('attaches compose containers to project and web networks', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  api:\n    image: nginx\n', 'utf8');

    const runComposeServiceMock = vi
      .fn()
      .mockImplementation(async (config: { name: string }) => `cid-${config.name}`);
    const docker = {
      listAllContainers: vi.fn().mockResolvedValue([]),
      ensureProjectNetwork: vi.fn().mockResolvedValue('stack-network'),
      pullImage: vi.fn().mockResolvedValue(undefined),
      buildComposeService: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      runComposeService: runComposeServiceMock,
      waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      removeProjectNetwork: vi.fn().mockResolvedValue(undefined),
      getNetworkName: vi.fn().mockReturnValue('openlander-prod'),
    } as unknown as Docker;

    const pipeline = new ComposePipeline(docker, db, events);
    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(runComposeServiceMock).toHaveBeenCalledTimes(1);
    expect(runComposeServiceMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'ol-stack-api',
      networks: ['stack-network', 'openlander-prod'],
    });
  });

  it('stops/removes child containers and project network on stopCompose', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  api:\n    image: nginx\n', 'utf8');

    const stopContainerMock = vi.fn().mockResolvedValue(undefined);
    const removeContainerMock = vi.fn().mockResolvedValue(undefined);
    const removeProjectNetworkMock = vi.fn().mockResolvedValue(undefined);
    const docker = {
      listAllContainers: vi.fn().mockResolvedValue([]),
      ensureProjectNetwork: vi.fn().mockResolvedValue('stack-network'),
      pullImage: vi.fn().mockResolvedValue(undefined),
      buildComposeService: vi.fn().mockResolvedValue(undefined),
      runComposeService: vi.fn().mockResolvedValue('cid-api'),
      waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
      stopContainer: stopContainerMock,
      removeContainer: removeContainerMock,
      removeProjectNetwork: removeProjectNetworkMock,
      getNetworkName: vi.fn().mockReturnValue('openlander-prod'),
    } as unknown as Docker;

    const pipeline = new ComposePipeline(docker, db, events);
    const deployResult = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });
    expect(deployResult.success).toBe(true);

    await pipeline.stopCompose(deployResult.parentProjectId);

    expect(stopContainerMock).toHaveBeenCalledWith('cid-api');
    expect(removeContainerMock).toHaveBeenCalledWith('cid-api');
    expect(removeProjectNetworkMock).toHaveBeenCalledWith('stack');
    const parent = db.getProject(deployResult.parentProjectId);
    expect(parent?.status).toBe('stopped');
  });
});
