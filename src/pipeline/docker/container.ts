import type Dockerode from 'dockerode';
import type { DockerContext } from './context.js';
import type {
  AllContainerInfo,
  ContainerInfo,
  RunComposeServiceOptions,
  RunContainerOptions,
  RunEphemeralContainerOptions,
  RunEphemeralContainerResult,
  WaitForHealthyResult,
} from './types.js';
import { chmod, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import {
  getProjectVolumeBinds,
  isContainerAlreadyRunning,
  isContainerNotRunning,
  resolveExtraHosts,
  withTimeout,
  writeSecretFiles,
} from './helpers.js';
import { createModuleLogger } from '../../lib/logger.js';
import { stripContainerPrefix } from '../helpers.js';
import { DOCKER_LABELS } from '../../config/index.js';
import { ContainerNotFoundError, ServiceConfigError, isDockerNotFoundError } from '../../errors.js';
import { sleep } from '../../lib/sleep.js';

const log = createModuleLogger('docker:container');
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 500;
const HEALTHCHECK_START_PERIOD_GRACE_MS = 500;

async function copyFilesIntoContainer(
  container: Dockerode.Container,
  fileCopies: NonNullable<RunComposeServiceOptions['fileCopies']>,
): Promise<void> {
  if (fileCopies.length === 0) return;

  const stagingRoot = await mkdtemp(join(tmpdir(), 'openlander-compose-files-'));
  let archive: ReturnType<typeof spawn> | undefined;
  try {
    for (const fileCopy of fileCopies) {
      const normalizedTarget = posix.normalize(fileCopy.targetPath);
      if (!normalizedTarget.startsWith('/') || normalizedTarget === '/') {
        throw new ServiceConfigError(`Invalid Compose file mount target: ${fileCopy.targetPath}`);
      }
      const relativeTarget = normalizedTarget.slice(1);
      const stagedPath = resolve(stagingRoot, relativeTarget);
      if (!stagedPath.startsWith(`${stagingRoot}${sep}`)) {
        throw new ServiceConfigError(`Invalid Compose file mount target: ${fileCopy.targetPath}`);
      }

      await mkdir(dirname(stagedPath), { recursive: true });
      await copyFile(fileCopy.sourcePath, stagedPath);
      const sourceMode = (await stat(fileCopy.sourcePath)).mode & 0o777;
      await chmod(stagedPath, fileCopy.readOnly ? sourceMode & ~0o222 : sourceMode);
    }

    archive = spawn('tar', ['-C', stagingRoot, '-cf', '-', '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const archiveStdout = archive.stdout;
    const archiveStderr = archive.stderr;
    if (!archiveStdout || !archiveStderr) {
      throw new ServiceConfigError('Failed to open Compose file mount archive streams');
    }
    let stderr = '';
    archiveStderr.setEncoding('utf8');
    archiveStderr.on('data', (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    const exit = new Promise<number>((resolveExit, reject) => {
      archive?.once('error', reject);
      archive?.once('close', (code) => {
        resolveExit(code ?? 1);
      });
    });
    await Promise.all([
      container.putArchive(archiveStdout, { path: '/' }),
      exit.then((code) => {
        if (code !== 0) {
          throw new ServiceConfigError(
            `Failed to prepare imported Compose file mount: ${stderr.trim() || `tar exited with code ${String(code)}`}`,
          );
        }
      }),
    ]);
  } finally {
    if (archive?.exitCode === null) archive.kill();
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function getHealthcheckStartPeriodMs(info: Dockerode.ContainerInspectInfo): number {
  const startPeriodNs = info.Config.Healthcheck?.StartPeriod;
  if (typeof startPeriodNs !== 'number' || startPeriodNs <= 0) {
    return 0;
  }
  return Math.ceil(startPeriodNs / 1_000_000);
}

function getContainerStartedAtMs(info: Dockerode.ContainerInspectInfo, fallbackMs: number): number {
  const startedAt = info.State.StartedAt;
  if (typeof startedAt !== 'string' || startedAt.length === 0) {
    return fallbackMs;
  }
  const parsed = Date.parse(startedAt);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

export class ContainerOps {
  constructor(
    private readonly ctx: DockerContext,
    private readonly deps: {
      ensureSharedNetworkAttachment: (containerId: string, alias: string) => Promise<void>;
      connectToNetworkStrict: (containerId: string, networkName: string) => Promise<void>;
    },
  ) {}

  async runContainer(options: RunContainerOptions): Promise<string> {
    const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);
    const cPort = options.containerPort ?? options.port;
    const extraHosts = await resolveExtraHosts(this.ctx.client, this.ctx.networkName);
    const secretBinds = writeSecretFiles(options.name, options.secretFiles ?? []);
    const projectName = stripContainerPrefix(options.name);
    const networkMode = options.network ?? this.ctx.networkName;
    const aliases = Array.from(new Set([projectName, ...(options.aliases ?? [])]));
    const networkingConfig = {
      EndpointsConfig: {
        [networkMode]: {
          Aliases: aliases,
        },
      },
    };
    const volumeProjectName = options.volumeProjectName ?? projectName;
    const volumeBinds = await getProjectVolumeBinds(this.ctx.client, volumeProjectName);
    const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];

    const healthcheck = options.healthcheck
      ? {
          Test:
            typeof options.healthcheck.test === 'string'
              ? ['CMD-SHELL', options.healthcheck.test]
              : options.healthcheck.test,
          ...(options.healthcheck.interval !== undefined
            ? { Interval: options.healthcheck.interval * 1_000_000_000 }
            : {}),
          ...(options.healthcheck.timeout !== undefined
            ? { Timeout: options.healthcheck.timeout * 1_000_000_000 }
            : {}),
          ...(options.healthcheck.retries !== undefined
            ? { Retries: options.healthcheck.retries }
            : {}),
          ...(options.healthcheck.start_period !== undefined
            ? { StartPeriod: options.healthcheck.start_period * 1_000_000_000 }
            : {}),
        }
      : undefined;

    const container = await this.ctx.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Env: envArray,
      Labels: {
        ...options.traefikLabels,
        ...options.labels,
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
        ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: options.cmd,
      Healthcheck: healthcheck,
      NetworkingConfig: networkingConfig,
      HostConfig: {
        PortBindings: {
          [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
        },
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: networkMode,
        RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(options.resourceLimits
          ? {
              Memory: options.resourceLimits.memoryLimitBytes,
              MemorySwap: options.resourceLimits.memorySwapBytes,
              MemoryReservation: options.resourceLimits.memoryReservationBytes,
              CpuShares: options.resourceLimits.cpuShares,
            }
          : {}),
        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      },
    });

    await container.start();

    return container.id;
  }

  async runEphemeralContainer(
    options: RunEphemeralContainerOptions,
  ): Promise<RunEphemeralContainerResult> {
    const startedAt = Date.now();
    const container = await this.ctx.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Cmd: options.command,
      WorkingDir: '/workspace',
      Tty: true,
      Env: Object.entries(options.envVars ?? {}).map(([key, value]) => `${key}=${value}`),
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: options.projectId,
        ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
        'openlander.purpose': 'delivery-quality-check',
      },
      HostConfig: {
        AutoRemove: false,
        Binds: [`${options.workspacePath}:/workspace:rw`],
        NetworkMode: 'bridge',
        RestartPolicy: { Name: 'no' },
        Memory: 2 * 1024 * 1024 * 1024,
        MemorySwap: 2 * 1024 * 1024 * 1024,
        PidsLimit: 1_024,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '1' } },
      },
    });

    let timeout: NodeJS.Timeout | undefined;
    try {
      await container.start();
      const waitForExit = async (): Promise<{ timedOut: false; exitCode: number }> => {
        const result: unknown = await container.wait();
        const statusCode =
          result &&
          typeof result === 'object' &&
          'StatusCode' in result &&
          typeof result.StatusCode === 'number'
            ? result.StatusCode
            : 1;
        return { timedOut: false, exitCode: statusCode };
      };
      const completion = await Promise.race([
        waitForExit(),
        new Promise<{ timedOut: true; exitCode: number }>((resolveTimeout) => {
          timeout = setTimeout(() => {
            resolveTimeout({ timedOut: true, exitCode: 124 });
          }, options.timeoutMs);
        }),
      ]);
      if (completion.timedOut) {
        try {
          await container.stop({ t: 1 });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!isContainerNotRunning(message) && !isDockerNotFoundError(error)) throw error;
        }
      }
      const rawLogs = await container.logs({ stdout: true, stderr: true, follow: false });
      const logs = Buffer.isBuffer(rawLogs) ? rawLogs.toString('utf8') : String(rawLogs);
      return {
        exitCode: completion.exitCode,
        durationMs: Date.now() - startedAt,
        logs: logs.slice(-1_048_576),
        timedOut: completion.timedOut,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      await container.remove({ force: true });
    }
  }

  async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const primaryMapping =
      opts.port !== undefined
        ? [{ hostPort: opts.port, containerPort: opts.containerPort ?? opts.port }]
        : [];
    const portMappings = [...primaryMapping, ...(opts.additionalPorts ?? [])];
    const exposedPorts = Array.from(
      new Set([
        ...(opts.containerPort !== undefined ? [opts.containerPort] : []),
        ...(opts.exposedPorts ?? []),
        ...portMappings.map(({ containerPort }) => containerPort),
      ]),
    );
    const extraHosts = await resolveExtraHosts(this.ctx.client, this.ctx.networkName);
    const secretBinds = writeSecretFiles(opts.name, opts.secretFiles ?? []);
    const projectName = stripContainerPrefix(opts.name);
    const volumeBinds = await getProjectVolumeBinds(this.ctx.client, projectName);
    const binds = [...secretBinds, ...volumeBinds, ...(opts.extraBinds ?? [])];
    const networkMode = opts.network ?? opts.networks?.[0] ?? this.ctx.networkName;
    const aliases = Array.from(new Set([projectName, ...(opts.aliases ?? [])]));
    const networkingConfig = {
      EndpointsConfig: {
        [networkMode]: {
          Aliases: aliases,
        },
      },
    };

    if (typeof opts.command === 'string' && /[;&|`$(){}]/.test(opts.command)) {
      throw new Error('Command contains disallowed shell metacharacters');
    }

    const command = typeof opts.command === 'string' ? ['sh', '-c', opts.command] : opts.command;
    const restartPolicyName =
      opts.restart === 'no' ||
      opts.restart === 'always' ||
      opts.restart === 'on-failure' ||
      opts.restart === 'unless-stopped'
        ? opts.restart
        : 'unless-stopped';
    const healthcheck = opts.healthcheck
      ? {
          Test:
            typeof opts.healthcheck.test === 'string'
              ? ['CMD-SHELL', opts.healthcheck.test]
              : opts.healthcheck.test,
          ...(opts.healthcheck.interval !== undefined
            ? { Interval: opts.healthcheck.interval * 1_000_000_000 }
            : {}),
          ...(opts.healthcheck.timeout !== undefined
            ? { Timeout: opts.healthcheck.timeout * 1_000_000_000 }
            : {}),
          ...(opts.healthcheck.retries !== undefined ? { Retries: opts.healthcheck.retries } : {}),
          ...(opts.healthcheck.start_period !== undefined
            ? { StartPeriod: opts.healthcheck.start_period * 1_000_000_000 }
            : {}),
        }
      : undefined;

    const container = await this.ctx.client.createContainer({
      Image: opts.imageTag,
      name: opts.name,
      Env: envArray,
      Labels: {
        ...opts.traefikLabels,
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(opts.name),
        ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
      },
      ExposedPorts:
        exposedPorts.length > 0
          ? Object.fromEntries(exposedPorts.map((port) => [`${String(port)}/tcp`, {}]))
          : undefined,
      Cmd: command,
      Entrypoint: opts.entrypoint,
      Healthcheck: healthcheck,
      NetworkingConfig: networkingConfig,
      HostConfig: {
        PortBindings:
          portMappings.length > 0
            ? Object.fromEntries(
                portMappings.map(({ hostPort, containerPort }) => [
                  `${String(containerPort)}/tcp`,
                  [{ HostPort: String(hostPort) }],
                ]),
              )
            : undefined,
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: networkMode,
        RestartPolicy: { Name: restartPolicyName },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(opts.memoryLimitBytes
          ? {
              Memory: opts.memoryLimitBytes,
              MemorySwap: opts.memoryLimitBytes,
              MemoryReservation: Math.floor(opts.memoryLimitBytes * 0.5),
            }
          : {}),
        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      },
    });

    await copyFilesIntoContainer(container, opts.fileCopies ?? []);
    await container.start();

    const additionalNetworks =
      opts.networks?.slice(1).filter((networkName, index, arr) => {
        if (arr.indexOf(networkName) !== index) return false;
        if (networkName === networkMode) return false;
        return true;
      }) ?? [];
    try {
      for (const networkName of additionalNetworks) {
        await this.deps.connectToNetworkStrict(container.id, networkName);
      }
    } catch (error) {
      try {
        await container.stop();
      } catch {
        /* best-effort */
      }

      try {
        await container.remove({ force: true });
      } catch {
        /* best-effort */
      }

      throw error;
    }

    return container.id;
  }

  async runInfraContainer(options: Dockerode.ContainerCreateOptions): Promise<string> {
    const container = await this.ctx.client.createContainer({
      ...options,
      Labels: {
        ...options.Labels,
        [DOCKER_LABELS.MANAGED]: 'true',
        ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
      },
      HostConfig: {
        ...options.HostConfig,
        Memory: 268435456,
        MemorySwap: 268435456,
      },
    });
    await container.start();
    return container.id;
  }

  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      await container.stop();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      if (!isContainerNotRunning(msg)) {
        throw error;
      }
    }
  }

  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      await container.start();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      if (!isContainerAlreadyRunning(msg)) {
        throw error;
      }
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      await container.remove({ force: true });
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  async safeRemoveContainer(containerId: string): Promise<void> {
    await this.removeContainer(containerId);

    const maxAttempts = 5;
    const intervalMs = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const container = this.ctx.client.getContainer(containerId);
        await withTimeout(container.inspect(), 10_000, 'safeRemoveContainer inspect');
        await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          isDockerNotFoundError(error) ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ENOENT')
        ) {
          return;
        }

        log.debug({ containerId, err: error }, 'Unexpected error during removal polling');
        return;
      }
    }

    log.warn({ containerId }, 'Container sandbox cleanup polling timed out — proceeding anyway');
  }

  async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      return await container.inspect({ abortSignal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      await container.restart();
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  async getContainerStats(containerId: string): Promise<unknown> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      return await container.stats({ stream: false });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  async renameContainer(containerId: string, newName: string): Promise<void> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      await container.rename({ name: newName });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
    const container = this.ctx.client.getContainer(containerId);
    return (await container.wait()) as { StatusCode: number };
  }

  async runServiceContainer(opts: {
    imageTag: string;
    name: string;
    port: number;
    containerPort?: number;
    hostPort?: number;
    envVars: Record<string, string>;
    serviceName: string;
    volumeBinds?: string[];
    memoryLimitBytes?: number;
    cpuShares?: number;
    healthcheck?: {
      test: string[];
      interval: number;
      timeout: number;
      retries: number;
      startPeriod: number;
    };
    cmd?: string[];
    network?: string;
    aliases?: string[];
  }): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const containerPort = opts.containerPort ?? opts.port;
    const hostPort = opts.hostPort ?? opts.port;
    const networkMode = opts.network ?? this.ctx.networkName;
    const aliases = Array.from(new Set([opts.serviceName, ...(opts.aliases ?? [])]));
    const networkingConfig = {
      EndpointsConfig: {
        [networkMode]: { Aliases: aliases },
      },
    };

    const container = await this.ctx.client.createContainer({
      Image: opts.imageTag,
      name: opts.name,
      Env: envArray,
      ...(opts.cmd ? { Cmd: opts.cmd } : {}),
      ...(opts.healthcheck
        ? {
            Healthcheck: {
              Test: opts.healthcheck.test,
              Interval: opts.healthcheck.interval * 1_000_000_000,
              Timeout: opts.healthcheck.timeout * 1_000_000_000,
              Retries: opts.healthcheck.retries,
              StartPeriod: opts.healthcheck.startPeriod * 1_000_000_000,
            },
          }
        : {}),
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: opts.serviceName,
        ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
      },
      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
      NetworkingConfig: networkingConfig,
      HostConfig: {
        NetworkMode: networkMode,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: opts.volumeBinds ?? [],
        PortBindings: {
          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(opts.cpuShares ? { CpuShares: opts.cpuShares } : {}),
        ...(opts.memoryLimitBytes
          ? {
              Memory: opts.memoryLimitBytes,
              MemorySwap: opts.memoryLimitBytes,
              MemoryReservation: Math.floor(opts.memoryLimitBytes * 0.5),
            }
          : {}),
      },
    });

    await container.start();
    return container.id;
  }

  async waitForHealthy(containerId: string, timeoutMs = 15000): Promise<WaitForHealthyResult> {
    const startTime = Date.now();
    let deadlineMs = startTime + timeoutMs;
    const checkInterval = DEFAULT_HEALTH_POLL_INTERVAL_MS;
    const inspectTimeoutMs = 10_000;
    // HEALTHCHECK-less containers can report Running just before the process exits.
    // Keep this shorter than Docker's common 30s start_period while still catching
    // immediate crash/restart loops before deploy success is recorded.
    const noHealthcheckStableMs = 5_000;
    let noHealthcheckStableSince: number | null = null;
    let noHealthcheckRestartCount: number | null = null;

    while (Date.now() < deadlineMs) {
      try {
        const container = this.ctx.client.getContainer(containerId);
        const info = await container.inspect({
          abortSignal: AbortSignal.timeout(inspectTimeoutMs),
        });
        const healthcheckStartPeriodMs = getHealthcheckStartPeriodMs(info);
        if (healthcheckStartPeriodMs > 0) {
          const startedAtMs = getContainerStartedAtMs(info, startTime);
          deadlineMs = Math.max(
            deadlineMs,
            startedAtMs + healthcheckStartPeriodMs + HEALTHCHECK_START_PERIOD_GRACE_MS,
          );
        }

        if (info.State.Restarting) {
          return {
            healthy: false,
            exitCode: info.State.ExitCode,
            error: `Container is in restart loop (exit code: ${String(info.State.ExitCode)})`,
          };
        }

        if (!info.State.Running && info.State.ExitCode !== 0) {
          return {
            healthy: false,
            exitCode: info.State.ExitCode,
            error: `Container exited with code ${String(info.State.ExitCode)}`,
          };
        }

        if (info.State.Running) {
          if (info.State.Health?.Status === 'healthy') {
            return { healthy: true };
          }
          if (!info.State.Health) {
            const restartCount = typeof info.RestartCount === 'number' ? info.RestartCount : null;
            if (noHealthcheckStableSince === null || noHealthcheckRestartCount !== restartCount) {
              noHealthcheckStableSince = Date.now();
              noHealthcheckRestartCount = restartCount;
            }
            if (Date.now() - noHealthcheckStableSince >= noHealthcheckStableMs) {
              return { healthy: true };
            }
          }
        } else {
          noHealthcheckStableSince = null;
          noHealthcheckRestartCount = null;
        }
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { healthy: false, error: 'Container not found' };
        }
      }

      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(checkInterval, remainingMs));
    }

    try {
      const container = this.ctx.client.getContainer(containerId);
      const info = await container.inspect({
        abortSignal: AbortSignal.timeout(inspectTimeoutMs),
      });
      if (info.State.Restarting) {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container entered restart loop (exit code: ${String(info.State.ExitCode)})`,
        };
      }
      if (info.State.Health?.Status === 'healthy') {
        return { healthy: true };
      }
      if (info.State.Health && info.State.Health.Status !== 'healthy') {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container healthcheck is ${info.State.Health.Status}`,
        };
      }
      if (info.State.Running && !info.State.Health) {
        const restartCount = typeof info.RestartCount === 'number' ? info.RestartCount : null;
        const stableForMs =
          noHealthcheckStableSince !== null && noHealthcheckRestartCount === restartCount
            ? Date.now() - noHealthcheckStableSince
            : 0;
        if (stableForMs >= noHealthcheckStableMs) {
          return { healthy: true };
        }
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container has no healthcheck and did not remain stable for ${String(
            Math.ceil(noHealthcheckStableMs / 1000),
          )}s`,
        };
      }
      return {
        healthy: info.State.Running,
        exitCode: info.State.ExitCode,
        error: info.State.Running ? undefined : 'Container did not become healthy within timeout',
      };
    } catch (_err) {
      return { healthy: false, error: 'Container check timed out' };
    }
  }

  async listManagedContainers(): Promise<ContainerInfo[]> {
    const containers = await this.ctx.client.listContainers({
      all: true,
      filters: { label: [`${DOCKER_LABELS.MANAGED}=true`] },
      abortSignal: AbortSignal.timeout(15_000),
    });

    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') ?? 'unknown',
      status: c.State,
      port: c.Ports[0]?.PublicPort,
      imageTag: c.Image,
      labels: (c.Labels as Record<string, string> | undefined) ?? {},
    }));
  }

  async listAllContainers(): Promise<AllContainerInfo[]> {
    try {
      const containers = await this.ctx.client.listContainers({
        all: true,
        abortSignal: AbortSignal.timeout(15_000),
      });

      return containers.map((c) => {
        const labels = (c.Labels as Record<string, string> | undefined) ?? {};
        return {
          id: c.Id,
          name: c.Names[0]?.replace(/^\//, '') ?? 'unknown',
          image: c.Image,
          state: c.State,
          status: c.Status,
          ports: c.Ports.map((p) => ({
            IP: p.IP,
            PrivatePort: p.PrivatePort,
            PublicPort: p.PublicPort,
            Type: p.Type,
          })),
          labels,
          managedByOpenLander: labels[DOCKER_LABELS.MANAGED] === 'true',
          composeProject: labels['com.docker.compose.project'] ?? null,
          created: c.Created,
        };
      });
    } catch (error) {
      log.warn({ error }, 'Failed to list all containers, returning empty array');
      return [];
    }
  }
}
