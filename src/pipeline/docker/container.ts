import type Dockerode from 'dockerode';
import type { DockerContext } from './context.js';
import type {
  AllContainerInfo,
  ContainerInfo,
  RunComposeServiceOptions,
  RunContainerOptions,
  WaitForHealthyResult,
} from './types.js';
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
import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../../config/index.js';
import { ContainerNotFoundError, isDockerNotFoundError } from '../../errors.js';
import { sleep } from '../../lib/sleep.js';

const log = createModuleLogger('docker:container');

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
    const networkingConfig =
      networkMode === SHARED_NETWORK_NAME
        ? {
            EndpointsConfig: {
              [SHARED_NETWORK_NAME]: {
                Aliases: [projectName],
              },
            },
          }
        : undefined;
    const volumeBinds = await getProjectVolumeBinds(this.ctx.client, projectName);
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
      Labels: options.labels ?? {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
        ...options.traefikLabels,
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

    if (networkMode !== SHARED_NETWORK_NAME) {
      await this.deps.ensureSharedNetworkAttachment(container.id, projectName);
    }

    return container.id;
  }

  async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
    // TODO v1.1.0: compose resource limits — RunComposeServiceOptions will need memoryLimitBytes/cpuShares fields added back when implemented
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const cPort = opts.containerPort ?? opts.port;
    const extraHosts = await resolveExtraHosts(this.ctx.client, this.ctx.networkName);
    const secretBinds = writeSecretFiles(opts.name, opts.secretFiles ?? []);
    const projectName = stripContainerPrefix(opts.name);
    const volumeBinds = await getProjectVolumeBinds(this.ctx.client, projectName);
    const binds = [...secretBinds, ...volumeBinds];
    const networkMode = opts.network ?? opts.networks?.[0] ?? this.ctx.networkName;
    const networkingConfig =
      networkMode === SHARED_NETWORK_NAME
        ? {
            EndpointsConfig: {
              [SHARED_NETWORK_NAME]: {
                Aliases: [projectName],
              },
            },
          }
        : undefined;

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
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(opts.name),
        ...opts.traefikLabels,
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: command,
      Entrypoint: opts.entrypoint,
      Healthcheck: healthcheck,
      NetworkingConfig: networkingConfig,
      HostConfig: {
        PortBindings: {
          [`${String(cPort)}/tcp`]: [{ HostPort: String(opts.port) }],
        },
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: networkMode,
        RestartPolicy: { Name: restartPolicyName },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      },
    });

    await container.start();

    if (networkMode !== SHARED_NETWORK_NAME) {
      await this.deps.ensureSharedNetworkAttachment(container.id, projectName);
    }

    const additionalNetworks =
      opts.networks
        ?.slice(1)
        .filter((networkName, index, arr) => arr.indexOf(networkName) === index) ?? [];
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
  }): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const containerPort = opts.containerPort ?? opts.port;
    const hostPort = opts.hostPort ?? opts.port;
    const networkingConfig = {
      EndpointsConfig: {
        [SHARED_NETWORK_NAME]: { Aliases: [opts.serviceName] },
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
      },
      ExposedPorts: { [`${String(containerPort)}/tcp`]: {} },
      NetworkingConfig: networkingConfig,
      HostConfig: {
        NetworkMode: this.ctx.networkName,
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
    const checkInterval = 2000;
    const inspectTimeoutMs = 10_000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const container = this.ctx.client.getContainer(containerId);
        const info = await container.inspect({
          abortSignal: AbortSignal.timeout(inspectTimeoutMs),
        });

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
            return { healthy: true };
          }
        }
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { healthy: false, error: 'Container not found' };
        }
      }

      await sleep(checkInterval);
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
      if (info.State.Health && info.State.Health.Status !== 'healthy') {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container healthcheck is ${info.State.Health.Status}`,
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
