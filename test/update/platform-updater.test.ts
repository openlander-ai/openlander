import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Docker } from '../../src/pipeline/docker.js';
import {
  PlatformUpdateBusyError,
  PlatformUpdateTargetError,
  PlatformUpdateUnsupportedError,
} from '../../src/errors.js';
import { PlatformUpdater } from '../../src/update/platform-updater.js';
import { PlatformReleaseChecker } from '../../src/update/release-checker.js';
import { PlatformUpdateStateStore } from '../../src/update/state-store.js';

const tempDirectories: string[] = [];
const targetVersion = '0.2.14-rc.1';
const digest = `sha256:${'d'.repeat(64)}`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function releaseChecker() {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    if (String(input).includes('/releases?')) {
      return Response.json([
        {
          tag_name: `v${targetVersion}`,
          draft: false,
          prerelease: true,
          published_at: '2026-07-30T00:00:00.000Z',
          html_url: `https://github.com/openlander-ai/openlander/releases/tag/v${targetVersion}`,
          body: '- Safe update',
          assets: [
            {
              name: 'openlander-update.json',
              browser_download_url: `https://github.com/openlander-ai/openlander/releases/download/v${targetVersion}/openlander-update.json`,
            },
          ],
        },
      ]);
    }
    return Response.json({
      schema_version: 1,
      version: targetVersion,
      minimum_source_version: '0.2.13-rc.1',
      image: `ghcr.io/openlander-ai/openlander:${targetVersion}`,
      image_digest: digest,
      compose_sha256: 'e'.repeat(64),
      rollback_safe: true,
    });
  });
  return new PlatformReleaseChecker({ currentVersion: '0.2.13-rc.7', fetchImpl });
}

function inspectInfo(): Awaited<ReturnType<Docker['inspectContainer']>> {
  return {
    Image: `sha256:${'1'.repeat(64)}`,
    Config: {
      Image: 'ghcr.io/openlander-ai/openlander:0.2.13-rc.7',
      Env: ['OPENLANDER_PUBLIC_HOST=openlander.example.com'],
      Labels: {
        'com.docker.compose.project': 'openlander',
        'com.docker.compose.service': 'openlander',
        'com.docker.compose.project.working_dir': '/opt/openlander',
        'com.docker.compose.project.config_files': '/opt/openlander/docker-compose.runtime.yml',
      },
    },
    Mounts: [
      { Type: 'volume', Name: 'openlander-data', Destination: '/root/.openlander' },
      {
        Type: 'bind',
        Source: '/var/run/docker.sock',
        Destination: '/var/run/docker.sock',
      },
    ],
    NetworkSettings: {
      Networks: { openlander_default: {} },
      Ports: { '10114/tcp': [{ HostIp: '0.0.0.0', HostPort: '10114' }] },
    },
  } as Awaited<ReturnType<Docker['inspectContainer']>>;
}

function databaseInspectInfo(
  password: string | null = 'openlander-test-password',
): Awaited<ReturnType<Docker['inspectContainer']>> {
  return {
    Config: {
      Env: password === null ? [] : [`POSTGRES_PASSWORD=${password}`],
      Labels: {},
    },
    NetworkSettings: { Networks: { openlander_default: {} }, Ports: {} },
    Mounts: [],
  } as Awaited<ReturnType<Docker['inspectContainer']>>;
}

async function harness(
  options: {
    containerized?: boolean;
    deployActive?: boolean;
    projectLocked?: boolean;
    updateRunnerPresent?: boolean;
    composePassword?: string | null;
    ownershipRepairExitCode?: number;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), 'openlander-platform-updater-'));
  tempDirectories.push(dataDir);
  const runUtilityContainer = vi.fn(async () => 'runner-container-id');
  const docker = {
    inspectContainer: vi.fn(async (containerId: string) => {
      if (containerId === 'stopped-runner') throw new TypeError('container not found');
      if (containerId === 'runner-container-id' && options.ownershipRepairExitCode !== undefined) {
        return {
          State: { Running: false, ExitCode: options.ownershipRepairExitCode },
        } as Awaited<ReturnType<Docker['inspectContainer']>>;
      }
      if (containerId === '2'.repeat(64)) {
        return databaseInspectInfo(options.composePassword);
      }
      return inspectInfo();
    }),
    listAllContainers: vi.fn(async () => [
      {
        id: '2'.repeat(64),
        name: 'openlander-db',
        image: 'postgres:16-alpine',
        state: 'running',
        status: 'Up',
        ports: [],
        labels: {
          'com.docker.compose.project': 'openlander',
          'com.docker.compose.service': 'openlander-db',
        },
        managedByOpenLander: false,
        composeProject: 'openlander',
        created: 1,
      },
      ...(options.updateRunnerPresent
        ? [
            {
              id: '3'.repeat(64),
              name: 'openlander-update-persisted',
              image: 'openlander:source',
              state: 'running',
              status: 'Up',
              ports: [],
              labels: { 'openlander.update.id': 'persisted-update' },
              managedByOpenLander: true,
              composeProject: null,
              created: 2,
            },
          ]
        : []),
    ]),
    runUtilityContainer,
    safeRemoveContainer: vi.fn(async () => undefined),
  };
  const updater = new PlatformUpdater({
    docker,
    db: {
      listProjects: vi.fn(async () => [
        { deploy_lock_session: options.projectLocked ? 'locked' : null },
      ]),
    } as never,
    deployQueue: { isRunning: vi.fn(() => options.deployActive ?? false) },
    jobManager: { getActiveJobs: vi.fn(() => []) },
    currentVersion: '0.2.13-rc.7',
    dataDir,
    releaseChecker: releaseChecker(),
    environment: {
      OPENLANDER_CONTAINERIZED: options.containerized === false ? 'false' : 'true',
      HOSTNAME: 'openlander-container',
    },
    checkDiskSpace: async () => true,
  });
  return { updater, docker, runUtilityContainer, dataDir };
}

describe('PlatformUpdater', () => {
  it('repairs legacy runner file ownership before accepting updated startup', async () => {
    const { updater, docker, runUtilityContainer, dataDir } = await harness({
      ownershipRepairExitCode: 0,
    });
    const store = new PlatformUpdateStateStore(dataDir);
    await store.writeOperation({
      id: 'legacy-update',
      sourceVersion: '0.2.13-rc.6',
      targetVersion: '0.2.13-rc.7',
      phase: 'verifying',
      startedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:01.000Z',
      message: null,
      errorCode: null,
      runnerContainerId: 'legacy-runner',
    });
    await store.writeRunnerInput({
      operationId: 'legacy-update',
      sourceVersion: '0.2.13-rc.6',
      targetVersion: '0.2.13-rc.7',
      targetImage: 'ghcr.io/openlander-ai/openlander:0.2.13-rc.7',
      targetDigest: `sha256:${'a'.repeat(64)}`,
      targetComposeSha256: 'b'.repeat(64),
      sourceImage: 'ghcr.io/openlander-ai/openlander:0.2.13-rc.6',
      runnerImageId: `sha256:${'c'.repeat(64)}`,
      composeProject: 'openlander',
      composeService: 'openlander',
      workingDirectory: '/opt/openlander',
      composeFiles: ['/opt/openlander/docker-compose.runtime.yml'],
      dataVolumeName: 'openlander-data',
      databaseContainerId: '2'.repeat(64),
      networkNames: ['openlander_default'],
    });

    await updater.repairActiveUpdateFileOwnership();

    expect(runUtilityContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `sha256:${'1'.repeat(64)}`,
        binds: ['/opt/openlander:/openlander-installation'],
        network: 'none',
        autoRemove: false,
      }),
    );
    expect(docker.safeRemoveContainer).toHaveBeenCalledWith('runner-container-id');
  });

  it('returns the REST status contract and starts the isolated runner', async () => {
    const { updater, runUtilityContainer } = await harness();
    await expect(updater.getStatus()).resolves.toMatchObject({
      currentVersion: '0.2.13-rc.7',
      channel: 'rc',
      updateAvailable: true,
      canUpdate: true,
      release: { version: targetVersion },
      support: { mode: 'compose' },
    });

    const operation = await updater.startUpdate(targetVersion);
    expect(operation).toMatchObject({ targetVersion, phase: 'preparing' });
    expect(runUtilityContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        image: `sha256:${'1'.repeat(64)}`,
        command: expect.arrayContaining(['platform-update-runner', '--operation-id']),
        binds: expect.arrayContaining([
          'openlander-data:/root/.openlander',
          '/opt/openlander:/opt/openlander',
        ]),
        envVars: expect.objectContaining({
          OPENLANDER_POSTGRES_PASSWORD: 'openlander-test-password',
          OPENLANDER_PORT: '10114',
          OPENLANDER_DATA_VOLUME: 'openlander-data',
        }),
      }),
    );
  });

  it('shows an update but requires the manual guide outside official Compose', async () => {
    const { updater } = await harness({ containerized: false });
    await expect(updater.getStatus()).resolves.toMatchObject({
      updateAvailable: true,
      canUpdate: false,
      support: { mode: 'manual', reason: 'not_containerized' },
    });
    await expect(updater.startUpdate(targetVersion)).rejects.toBeInstanceOf(
      PlatformUpdateUnsupportedError,
    );
  });

  it('rejects non-offered targets and duplicate executions', async () => {
    const { updater } = await harness();
    await expect(updater.startUpdate('0.2.99')).rejects.toBeInstanceOf(PlatformUpdateTargetError);
    await updater.startUpdate(targetVersion);
    await expect(updater.startUpdate(targetVersion)).rejects.toBeInstanceOf(
      PlatformUpdateBusyError,
    );
  });

  it('returns typed conflicts for active deploys and project locks', async () => {
    const active = await harness({ deployActive: true });
    await expect(active.updater.startUpdate(targetVersion)).rejects.toMatchObject({
      code: 'PLATFORM_UPDATE_BUSY',
      statusCode: 409,
      details: { reason: 'deploy_in_progress' },
    });

    const locked = await harness({ projectLocked: true });
    await expect(locked.updater.startUpdate(targetVersion)).rejects.toMatchObject({
      code: 'PLATFORM_UPDATE_BUSY',
      statusCode: 409,
      details: { reason: 'project_locked' },
    });
  });

  it('blocks one-click update when the running Compose environment cannot be preserved', async () => {
    const { updater, runUtilityContainer } = await harness({ composePassword: null });
    await expect(updater.getStatus()).resolves.toMatchObject({
      canUpdate: false,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'compose_environment', ok: false }),
      ]),
    });
    await expect(updater.startUpdate(targetVersion)).rejects.toMatchObject({
      code: 'PLATFORM_UPDATE_VALIDATION_FAILED',
    });
    expect(runUtilityContainer).not.toHaveBeenCalled();
  });

  it('recovers persisted state and marks a vanished runner as failed', async () => {
    const { updater, dataDir } = await harness();
    const store = new PlatformUpdateStateStore(dataDir);
    await store.writeOperation({
      id: 'persisted-update',
      sourceVersion: '0.2.13-rc.7',
      targetVersion,
      phase: 'verifying',
      startedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:01.000Z',
      message: null,
      errorCode: null,
      runnerContainerId: 'stopped-runner',
    });
    await expect(updater.getStatus()).resolves.toMatchObject({
      operation: {
        id: 'persisted-update',
        phase: 'failed',
        errorCode: 'UPDATE_RUNNER_STOPPED',
      },
    });
  });

  it('recovers a running update runner when its container id was not persisted', async () => {
    const { updater, dataDir } = await harness({ updateRunnerPresent: true });
    const store = new PlatformUpdateStateStore(dataDir);
    await store.writeOperation({
      id: 'persisted-update',
      sourceVersion: '0.2.13-rc.7',
      targetVersion,
      phase: 'backing_up',
      startedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:01.000Z',
      message: null,
      errorCode: null,
      runnerContainerId: null,
    });
    await expect(updater.getStatus()).resolves.toMatchObject({
      operation: {
        id: 'persisted-update',
        phase: 'backing_up',
        runnerContainerId: '3'.repeat(64),
      },
    });
  });
});
