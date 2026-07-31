import { randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { Database } from '../db/index.js';
import {
  PlatformUpdateBusyError,
  PlatformUpdateExecutionError,
  PlatformUpdateTargetError,
  PlatformUpdateUnsupportedError,
  PlatformUpdateValidationError,
} from '../errors.js';
import type { Docker } from '../pipeline/docker.js';
import type { DeployQueue } from '../pipeline/deploy-queue.js';
import type { JobManager } from '../pipeline/job-manager.js';
import { sleep } from '../lib/sleep.js';
import { compareSemVer, inferReleaseChannel, parseSemVer } from './semver.js';
import { detectComposeInstallation } from './install-detector.js';
import { PlatformReleaseChecker } from './release-checker.js';
import { PlatformUpdateStateStore } from './state-store.js';
import type {
  ComposeInstallation,
  PlatformReleaseSummary,
  PlatformUpdateOperation,
  PlatformUpdateRunnerInput,
  PlatformUpdateStatus,
} from './types.js';

const MANUAL_UPDATE_URL =
  'https://github.com/openlander-ai/openlander/blob/main/docs/guides/updating.md';
const MINIMUM_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const ACTIVE_PHASES = new Set([
  'preparing',
  'backing_up',
  'pulling',
  'restarting',
  'verifying',
  'rolling_back',
]);
const RUNNER_RECONCILE_GRACE_MS = 15_000;
const FILE_OWNERSHIP_REPAIR_TIMEOUT_MS = 15_000;
const FILE_OWNERSHIP_REPAIR_MOUNT = '/openlander-installation';
const FILE_OWNERSHIP_REPAIR_SCRIPT = `
const { chmodSync, chownSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const directory = ${JSON.stringify('/openlander-installation')};
const owner = statSync(directory);
for (const name of ['.env', 'docker-compose.runtime.yml']) {
  const path = join(directory, name);
  if (!existsSync(path)) continue;
  const file = statSync(path);
  if (file.uid !== owner.uid || file.gid !== owner.gid) {
    chownSync(path, owner.uid, owner.gid);
  }
  chmodSync(path, file.mode & 0o777);
}
`;

type UpdaterDocker = Pick<
  Docker,
  'inspectContainer' | 'listAllContainers' | 'runUtilityContainer' | 'safeRemoveContainer'
>;
type UpdaterDatabase = Pick<Database, 'listProjects'>;
type UpdaterDeployQueue = Pick<DeployQueue, 'isRunning'>;
type UpdaterJobManager = Pick<JobManager, 'getActiveJobs'>;

export interface PlatformUpdaterOptions {
  docker: UpdaterDocker;
  db: UpdaterDatabase;
  deployQueue: UpdaterDeployQueue;
  jobManager: UpdaterJobManager;
  currentVersion: string;
  dataDir: string;
  releaseChecker?: PlatformReleaseChecker;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
  checkDiskSpace?: () => Promise<boolean>;
}

interface PreflightResult {
  checks: PlatformUpdateStatus['checks'];
  databaseContainerId: string | null;
  deployActive: boolean;
  projectLocked: boolean;
  diskSpaceOk: boolean;
  composeEnvironmentReady: boolean;
}

const SAFE_COMPOSE_ENVIRONMENT_VALUE = /^[A-Za-z0-9_./:@%+=,-]*$/;

interface RunnerComposeEnvironment {
  OPENLANDER_POSTGRES_PASSWORD: string;
  OPENLANDER_PORT: string;
  OPENLANDER_PUBLIC_HOST: string;
  OPENLANDER_DATA_VOLUME: string;
}

const RUNNER_COMPOSE_ENVIRONMENT_KEYS = [
  'OPENLANDER_POSTGRES_PASSWORD',
  'OPENLANDER_PORT',
  'OPENLANDER_PUBLIC_HOST',
  'OPENLANDER_DATA_VOLUME',
] as const satisfies readonly (keyof RunnerComposeEnvironment)[];

function containerEnvironmentValue(
  inspection: Awaited<ReturnType<UpdaterDocker['inspectContainer']>>,
  key: string,
): string | null {
  const prefix = `${key}=`;
  const entry = inspection.Config.Env.find((value) => value.startsWith(prefix));
  return entry?.slice(prefix.length) ?? null;
}

function assertSafeComposeEnvironment(environment: RunnerComposeEnvironment): void {
  for (const key of RUNNER_COMPOSE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (!SAFE_COMPOSE_ENVIRONMENT_VALUE.test(value)) {
      throw new PlatformUpdateValidationError(
        'The current Compose environment cannot be persisted safely for the platform update.',
        { key },
      );
    }
  }
}

function isActiveOperation(
  operation: PlatformUpdateOperation | null,
): operation is PlatformUpdateOperation {
  return operation !== null && ACTIVE_PHASES.has(operation.phase);
}

function isNewerVersion(currentVersion: string, release: PlatformReleaseSummary | null): boolean {
  if (!release) return false;
  const current = parseSemVer(currentVersion);
  const target = parseSemVer(release.version);
  return Boolean(current && target && compareSemVer(target, current) > 0);
}

export class PlatformUpdater {
  private readonly docker: UpdaterDocker;
  private readonly db: UpdaterDatabase;
  private readonly deployQueue: UpdaterDeployQueue;
  private readonly jobManager: UpdaterJobManager;
  private readonly currentVersion: string;
  private readonly dataDir: string;
  private readonly releaseChecker: PlatformReleaseChecker;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly store: PlatformUpdateStateStore;
  private readonly checkDiskSpace: () => Promise<boolean>;
  private starting = false;

  constructor(options: PlatformUpdaterOptions) {
    this.docker = options.docker;
    this.db = options.db;
    this.deployQueue = options.deployQueue;
    this.jobManager = options.jobManager;
    this.currentVersion = options.currentVersion;
    this.dataDir = options.dataDir;
    this.releaseChecker =
      options.releaseChecker ??
      new PlatformReleaseChecker({ currentVersion: options.currentVersion });
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? (() => new Date());
    this.store = new PlatformUpdateStateStore(options.dataDir);
    this.checkDiskSpace =
      options.checkDiskSpace ??
      (async () => {
        const stats = await statfs(this.dataDir);
        return stats.bavail * stats.bsize >= MINIMUM_FREE_BYTES;
      });
  }

  async repairActiveUpdateFileOwnership(): Promise<void> {
    const operation = await this.store.readOperation();
    if (!isActiveOperation(operation) || operation.targetVersion !== this.currentVersion) return;

    const input = await this.store.readRunnerInput(operation.id);
    const installation = await detectComposeInstallation(this.docker, this.environment);
    if (
      installation.mode !== 'compose' ||
      !installation.imageId ||
      installation.workingDirectory !== input.workingDirectory ||
      installation.composeFiles.length !== 1 ||
      installation.composeFiles[0] !== input.composeFiles[0]
    ) {
      throw new PlatformUpdateValidationError(
        'The active update installation metadata changed before startup validation.',
      );
    }

    const helperId = await this.docker.runUtilityContainer({
      image: installation.imageId,
      name: `openlander-update-permissions-${operation.id.slice(0, 12)}`,
      command: ['node', '--input-type=commonjs', '--eval', FILE_OWNERSHIP_REPAIR_SCRIPT],
      binds: [`${input.workingDirectory}:${FILE_OWNERSHIP_REPAIR_MOUNT}`],
      network: 'none',
      autoRemove: false,
    });
    try {
      const deadline = Date.now() + FILE_OWNERSHIP_REPAIR_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const helper = await this.docker.inspectContainer(helperId);
        if (!helper.State.Running) {
          if (helper.State.ExitCode === 0) return;
          throw new PlatformUpdateValidationError(
            'The updated process could not restore Compose file ownership.',
            { exitCode: helper.State.ExitCode },
          );
        }
        await sleep(100);
      }
      throw new PlatformUpdateValidationError(
        'The updated process timed out while restoring Compose file ownership.',
      );
    } finally {
      await this.docker.safeRemoveContainer(helperId);
    }
  }

  async getStatus(options: { refreshRelease?: boolean } = {}): Promise<PlatformUpdateStatus> {
    const [releaseResult, installation, persistedOperation] = await Promise.all([
      this.releaseChecker.check({ refresh: options.refreshRelease }),
      detectComposeInstallation(this.docker, this.environment),
      this.store.readOperation(),
    ]);
    const operation = await this.reconcileOperation(persistedOperation);
    const updateAvailable = isNewerVersion(this.currentVersion, releaseResult.release);
    const preflight = await this.preflight(installation, releaseResult.release);
    const manifestReady = Boolean(
      releaseResult.release?.manifest && !releaseResult.release.oneClickBlockReason,
    );
    const canUpdate = Boolean(
      updateAvailable &&
      manifestReady &&
      installation.mode === 'compose' &&
      !isActiveOperation(operation) &&
      !preflight.deployActive &&
      !preflight.projectLocked &&
      preflight.diskSpaceOk &&
      preflight.composeEnvironmentReady &&
      preflight.databaseContainerId,
    );
    return {
      currentVersion: this.currentVersion,
      channel: inferReleaseChannel(this.currentVersion),
      updateAvailable,
      canUpdate,
      release: releaseResult.release,
      support: {
        mode: installation.mode,
        reason: installation.reason,
        manualUpdateUrl: MANUAL_UPDATE_URL,
      },
      checks: preflight.checks,
      operation,
      releaseCheckStale: releaseResult.stale,
      releaseCheckedAt: new Date(releaseResult.checkedAt).toISOString(),
    };
  }

  async startUpdate(targetVersion: string): Promise<PlatformUpdateOperation> {
    if (this.starting) throw new PlatformUpdateBusyError('update_in_progress');
    this.starting = true;
    try {
      const status = await this.getStatus();
      if (!status.release || status.release.version !== targetVersion) {
        throw new PlatformUpdateTargetError(targetVersion);
      }
      if (isActiveOperation(status.operation)) {
        throw new PlatformUpdateBusyError('update_in_progress');
      }
      if (this.deployQueue.isRunning() || this.jobManager.getActiveJobs().length > 0) {
        throw new PlatformUpdateBusyError('deploy_in_progress');
      }
      const projects = await this.db.listProjects(undefined, { includeArchived: false });
      if (projects.some((project) => Boolean(project.deploy_lock_session))) {
        throw new PlatformUpdateBusyError('project_locked');
      }
      if (status.support.mode !== 'compose') {
        throw new PlatformUpdateUnsupportedError(status.support.reason ?? 'unsupported');
      }
      const manifest = status.release.manifest;
      if (!manifest || status.release.oneClickBlockReason) {
        throw new PlatformUpdateValidationError(
          'The release is not eligible for one-click update.',
          {
            reason: status.release.oneClickBlockReason ?? 'manifest_missing',
          },
        );
      }
      if (!status.canUpdate) {
        throw new PlatformUpdateValidationError('One or more update preflight checks failed.');
      }
      const installation = await detectComposeInstallation(this.docker, this.environment);
      const databaseContainerId = await this.findDatabaseContainer(installation);
      if (!databaseContainerId) {
        throw new PlatformUpdateValidationError(
          'The OpenLander database container is not running.',
        );
      }
      const composeEnvironment = await this.resolveRunnerComposeEnvironment(
        installation,
        databaseContainerId,
      );
      const input = this.createRunnerInput(installation, databaseContainerId, manifest);
      const timestamp = this.now().toISOString();
      let operation: PlatformUpdateOperation = {
        id: input.operationId,
        sourceVersion: this.currentVersion,
        targetVersion,
        phase: 'preparing',
        startedAt: timestamp,
        updatedAt: timestamp,
        message: null,
        errorCode: null,
        runnerContainerId: null,
      };
      await this.store.writeRunnerInput(input);
      await this.store.writeOperation(operation);
      try {
        const runnerContainerId = await this.docker.runUtilityContainer({
          image: input.runnerImageId,
          name: `openlander-update-${operation.id.slice(0, 12)}`,
          command: [
            'node',
            'dist/cli/index.js',
            'platform-update-runner',
            '--operation-id',
            operation.id,
          ],
          envVars: {
            OPENLANDER_DATA_DIR: '/root/.openlander',
            ...composeEnvironment,
          },
          binds: [
            `${input.dataVolumeName}:/root/.openlander`,
            `${installation.dockerSocketPath ?? '/var/run/docker.sock'}:/var/run/docker.sock`,
            `${input.workingDirectory}:${input.workingDirectory}`,
          ],
          network: input.networkNames[0] ?? 'bridge',
          labels: {
            'openlander.update.id': operation.id,
            'openlander.update.target': targetVersion,
          },
          autoRemove: true,
        });
        const latestOperation = await this.store.readOperation();
        operation = {
          ...(latestOperation?.id === operation.id ? latestOperation : operation),
          runnerContainerId,
          updatedAt: this.now().toISOString(),
        };
        await this.store.writeOperation(operation);
        return operation;
      } catch (error) {
        operation = {
          ...operation,
          phase: 'failed',
          updatedAt: this.now().toISOString(),
          message: 'The update runner could not be started.',
          errorCode: 'RUNNER_START_FAILED',
        };
        await this.store.writeOperation(operation);
        throw new PlatformUpdateExecutionError('The update runner could not be started.', {
          cause: error instanceof Error ? error.name : 'unknown',
        });
      }
    } finally {
      this.starting = false;
    }
  }

  private createRunnerInput(
    installation: ComposeInstallation,
    databaseContainerId: string,
    manifest: NonNullable<PlatformReleaseSummary['manifest']>,
  ): PlatformUpdateRunnerInput {
    if (
      !installation.image ||
      !installation.imageId ||
      !installation.composeProject ||
      !installation.composeService ||
      !installation.workingDirectory ||
      !installation.dataVolumeName
    ) {
      throw new PlatformUpdateUnsupportedError('compose_metadata_incomplete');
    }
    return {
      operationId: randomUUID(),
      sourceVersion: this.currentVersion,
      targetVersion: manifest.version,
      targetImage: manifest.image,
      targetDigest: manifest.image_digest,
      targetComposeSha256: manifest.compose_sha256,
      sourceImage: installation.image,
      runnerImageId: installation.imageId,
      composeProject: installation.composeProject,
      composeService: installation.composeService,
      workingDirectory: installation.workingDirectory,
      composeFiles: installation.composeFiles,
      dataVolumeName: installation.dataVolumeName,
      databaseContainerId,
      networkNames: installation.networkNames,
    };
  }

  private async preflight(
    installation: ComposeInstallation,
    release: PlatformReleaseSummary | null,
  ): Promise<PreflightResult> {
    const projects = await this.db.listProjects(undefined, { includeArchived: false });
    const deployActive = this.deployQueue.isRunning() || this.jobManager.getActiveJobs().length > 0;
    const projectLocked = projects.some((project) => Boolean(project.deploy_lock_session));
    const databaseContainerId = await this.findDatabaseContainer(installation);
    let composeEnvironmentReady = false;
    if (databaseContainerId) {
      try {
        await this.resolveRunnerComposeEnvironment(installation, databaseContainerId);
        composeEnvironmentReady = true;
      } catch {
        composeEnvironmentReady = false;
      }
    }
    let diskSpaceOk = false;
    try {
      diskSpaceOk = await this.checkDiskSpace();
    } catch {
      diskSpaceOk = false;
    }
    const manifestOk = Boolean(release?.manifest && !release.oneClickBlockReason);
    return {
      deployActive,
      projectLocked,
      databaseContainerId,
      diskSpaceOk,
      composeEnvironmentReady,
      checks: [
        {
          id: 'official_compose',
          ok: installation.mode === 'compose',
          message:
            installation.mode === 'compose'
              ? 'Official Docker Compose installation detected.'
              : 'One-click update is unavailable for this installation method.',
        },
        {
          id: 'release_manifest',
          ok: manifestOk,
          message: manifestOk
            ? 'The official release metadata passed validation.'
            : 'The release metadata is missing or does not meet update safety requirements.',
        },
        {
          id: 'active_operations',
          ok: !deployActive && !projectLocked,
          message:
            !deployActive && !projectLocked
              ? 'No deployment or project lock is active.'
              : 'Wait for active deployments and project operations to finish.',
        },
        {
          id: 'compose_environment',
          ok: composeEnvironmentReady,
          message: composeEnvironmentReady
            ? 'The current Compose environment can be preserved safely.'
            : 'One-click update cannot safely preserve the current Compose environment. Use the manual update guide.',
        },
        {
          id: 'database',
          ok: Boolean(databaseContainerId),
          message: databaseContainerId
            ? 'The OpenLander database container is running.'
            : 'The OpenLander database container is not running.',
        },
        {
          id: 'disk_space',
          ok: diskSpaceOk,
          message: diskSpaceOk
            ? 'At least 2 GiB is available for the backup and image.'
            : 'At least 2 GiB of free space is required.',
        },
      ],
    };
  }

  private async findDatabaseContainer(installation: ComposeInstallation): Promise<string | null> {
    if (!installation.composeProject) return null;
    const containers = await this.docker.listAllContainers();
    return (
      containers.find(
        (container) =>
          container.state === 'running' &&
          container.labels['com.docker.compose.project'] === installation.composeProject &&
          container.labels['com.docker.compose.service'] === 'openlander-db',
      )?.id ?? null
    );
  }

  private async resolveRunnerComposeEnvironment(
    installation: ComposeInstallation,
    databaseContainerId: string,
  ): Promise<RunnerComposeEnvironment> {
    if (!installation.containerId || !installation.dataVolumeName) {
      throw new PlatformUpdateUnsupportedError('compose_metadata_incomplete');
    }
    const [application, database] = await Promise.all([
      this.docker.inspectContainer(installation.containerId),
      this.docker.inspectContainer(databaseContainerId),
    ]);
    const password = containerEnvironmentValue(database, 'POSTGRES_PASSWORD');
    const hostBindings = application.NetworkSettings.Ports['10114/tcp'];
    const port = hostBindings?.find((binding) => Boolean(binding.HostPort))?.HostPort ?? null;
    if (!password || !port) {
      throw new PlatformUpdateValidationError(
        'The current Compose environment cannot be reconstructed from the running containers.',
      );
    }
    const environment: RunnerComposeEnvironment = {
      OPENLANDER_POSTGRES_PASSWORD: password,
      OPENLANDER_PORT: port,
      OPENLANDER_PUBLIC_HOST:
        containerEnvironmentValue(application, 'OPENLANDER_PUBLIC_HOST') ?? '',
      OPENLANDER_DATA_VOLUME: installation.dataVolumeName,
    };
    assertSafeComposeEnvironment(environment);
    return environment;
  }

  private async reconcileOperation(
    operation: PlatformUpdateOperation | null,
  ): Promise<PlatformUpdateOperation | null> {
    if (!isActiveOperation(operation)) return operation;
    const ageMs = this.now().getTime() - Date.parse(operation.updatedAt);
    if (!Number.isFinite(ageMs) || ageMs < RUNNER_RECONCILE_GRACE_MS) return operation;
    let runnerStopped = !operation.runnerContainerId;
    if (operation.runnerContainerId) {
      try {
        const runner = await this.docker.inspectContainer(operation.runnerContainerId);
        runnerStopped = !runner.State.Running;
      } catch {
        runnerStopped = true;
      }
    }
    if (runnerStopped) {
      const recoveredRunner = (await this.docker.listAllContainers()).find(
        (container) =>
          container.state === 'running' &&
          container.labels['openlander.update.id'] === operation.id,
      );
      if (recoveredRunner) {
        const recoveredOperation: PlatformUpdateOperation = {
          ...operation,
          runnerContainerId: recoveredRunner.id,
          updatedAt: this.now().toISOString(),
        };
        await this.store.writeOperation(recoveredOperation);
        return recoveredOperation;
      }
    }
    if (!runnerStopped) return operation;

    const latestOperation = await this.store.readOperation();
    if (!latestOperation || !isActiveOperation(latestOperation)) return latestOperation;
    const failedOperation: PlatformUpdateOperation = {
      ...latestOperation,
      phase: 'failed',
      updatedAt: this.now().toISOString(),
      message: 'The update runner stopped before it recorded a final result.',
      errorCode: 'UPDATE_RUNNER_STOPPED',
    };
    await this.store.writeOperation(failedOperation);
    return failedOperation;
  }
}
