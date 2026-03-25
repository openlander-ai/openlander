import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('docker');

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getDataDir, getPolicy } from '../config/index.js';
import type Dockerode from 'dockerode';

import { DockerNotRunningError, DockerBuildError, ContainerNotFoundError } from '../errors.js';

export type DockerStatus =
  | { state: 'running' }
  | { state: 'not_installed' }
  | { state: 'not_running' }
  | { state: 'permission_denied'; groupFixed?: boolean };

export interface SecretFileMount {
  filename: string;
  content: string;
  mountPath: string;
}

export interface RunContainerOptions {
  imageTag: string;
  name: string;
  /** Host port for external access. */
  port: number;
  /** Container-internal port the app listens on (default: same as port). */
  containerPort?: number;
  envVars: Record<string, string>;
  cmd?: string[];
  traefikLabels: Record<string, string>;
  network?: string;
  secretFiles?: SecretFileMount[];
}

export interface RunComposeServiceOptions {
  imageTag: string;
  name: string;
  port: number;
  containerPort?: number;
  envVars: Record<string, string>;
  traefikLabels: Record<string, string>;
  secretFiles?: SecretFileMount[];
  command?: string | string[];
  entrypoint?: string | string[];
  restart?: string;
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  network?: string;
  networks?: string[];
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  port?: number;
  imageTag?: string;
  labels?: Record<string, string>;
}

export interface PortInfo {
  IP?: string;
  PrivatePort?: number;
  PublicPort?: number;
  Type?: string;
}

/** Extended container info for all containers (including non-OpenLander managed). */
export interface AllContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: PortInfo[];
  labels: Record<string, string>;
  managedByOpenLander: boolean;
  composeProject: string | null;
  created: number;
}

export interface BuildImageOptions {
  noCache?: boolean;
  buildArgs?: Record<string, string>;
  target?: string;
  dockerfile?: string;
  onProgress?: (event: { stream?: string; error?: string }) => void;
}

export interface BuildComposeServiceOptions {
  contextPath: string;
  dockerfile?: string;
  tag: string;
  buildArgs?: Record<string, string>;
  target?: string;
  noCache?: boolean;
  cacheFrom?: string[];
  onProgress?: (event: { stream?: string; error?: string }) => void;
}

/** Health check result from post-deploy container monitoring. */
export interface WaitForHealthyResult {
  healthy: boolean;
  exitCode?: number;
  error?: string;
}

function stripDockerStreamHeaders(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  const firstByte = buffer[0];
  if (firstByte !== 0 && firstByte !== 1 && firstByte !== 2) {
    return buffer.toString('utf8');
  }

  const HEADER_SIZE = 8;
  const chunks: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + HEADER_SIZE > buffer.length) {
      chunks.push(buffer.subarray(offset).toString('utf8'));
      break;
    }

    const payloadSize = buffer.readUInt32BE(offset + 4);
    const payloadStart = offset + HEADER_SIZE;
    const payloadEnd = payloadStart + payloadSize;

    if (payloadEnd > buffer.length) {
      chunks.push(buffer.subarray(payloadStart).toString('utf8'));
      break;
    }

    chunks.push(buffer.subarray(payloadStart, payloadEnd).toString('utf8'));
    offset = payloadEnd;
  }

  return chunks.join('');
}

/**
 * Docker control layer using dockerode.
 *
 * Wraps all Docker operations with proper error handling
 * and user-friendly error messages.
 */
export class Docker {
  private readonly client: Dockerode;
  private readonly networkName: string;

  constructor(socketPath?: string, networkName?: string) {
    const require = createRequire(import.meta.url);

    // docker-modem eagerly requires its SSH transport, which pulls in ssh2's
    // native crypto addon at startup. On this runtime that addon can segfault
    // during module load even though OpenLander uses Unix socket transport.
    // Stub the SSH transport module so dockerode startup stays on the socket path.
    const dockerSshModulePath = require.resolve('docker-modem/lib/ssh.js');
    if (!require.cache[dockerSshModulePath]) {
      const dockerSshStub = {
        id: dockerSshModulePath,
        filename: dockerSshModulePath,
        loaded: true,
        exports: () => {
          throw new Error('Docker SSH transport is unavailable in this runtime');
        },
      } as unknown as NodeJS.Module;
      require.cache[dockerSshModulePath] = dockerSshStub;
    }

    const dockerodeModule = require('dockerode') as
      | { default?: new (options?: unknown) => Dockerode }
      | (new (options?: unknown) => Dockerode);
    const DockerodeClass =
      typeof dockerodeModule === 'function' ? dockerodeModule : dockerodeModule.default;
    if (!DockerodeClass) {
      throw new Error('Failed to load dockerode constructor');
    }

    this.networkName = networkName ?? getPolicy('production').networkName;
    if (socketPath) {
      this.client = new DockerodeClass({ socketPath });
    } else {
      const resolved = resolveDockerSocket();
      this.client = resolved ? new DockerodeClass({ socketPath: resolved }) : new DockerodeClass();
    }
  }

  /** Verify Docker daemon is accessible. */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      log.debug({ err }, 'Docker ping failed');
      return false;
    }
  }

  /** Detailed Docker status: not_installed / not_running / permission_denied / running. */
  async status(): Promise<DockerStatus> {
    // 1. Check if docker binary exists
    try {
      execSync('docker --version', { stdio: 'pipe' });
    } catch (err) {
      log.debug({ err }, 'Docker binary check failed');
      return { state: 'not_installed' };
    }

    // 2. Try dockerode ping (works if current process has docker group)
    try {
      await this.client.ping();
      return { state: 'running' };
    } catch (err) {
      log.debug({ err }, 'Dockerode ping failed — trying sg docker');
      // fall through
    }

    // 3. Try `sg docker` — Linux only (macOS Docker Desktop doesn't use groups)
    if (process.platform !== 'darwin') {
      try {
        execSync('sg docker -c "docker info"', { stdio: 'pipe', timeout: 5000 });
        return { state: 'running' };
      } catch (err) {
        log.debug({ err }, 'sg docker check failed');
      }
    }

    // 4. Determine permission vs daemon-not-running
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000, encoding: 'utf8' });
      return { state: 'running' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
      const combined = msg + stderr;
      if (
        combined.includes('permission denied') ||
        combined.includes('Permission denied') ||
        combined.includes('EACCES')
      ) {
        const groupFixed = isUserInDockerGroup();
        return { state: 'permission_denied', groupFixed };
      }
    }

    return { state: 'not_running' };
  }

  /** Verify Docker is running, throw typed error if not. */
  async ensureRunning(): Promise<void> {
    const ok = await this.ping();
    if (!ok) {
      throw new DockerNotRunningError();
    }
  }

  /** Build a Docker image from a directory containing a Dockerfile. */
  async buildImage(contextPath: string, tag: string, options?: BuildImageOptions): Promise<void> {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.buildImage(
        { context: contextPath, src: ['.'] },
        {
          t: tag,
          nocache: options?.noCache === true,
          buildargs: options?.buildArgs,
          target: options?.target,
          dockerfile: options?.dockerfile,
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        tag,
        `Build failed for ${tag} (context: ${contextPath}): ${errMsg}`,
      );
    }

    // Collect build log and wait for completion
    let buildLog = '';
    let buildError = '';
    await new Promise<void>((resolve, reject) => {
      this.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                tag,
                `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
              ),
            );
          } else if (buildError) {
            const reason = [buildLog, buildError].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                tag,
                `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
              ),
            );
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) buildLog += event.stream;
          if (event.error) {
            buildError += event.error + '\n';
            buildLog += `ERROR: ${event.error}\n`;
          }
          options?.onProgress?.(event);
        },
      );
    });
  }

  async buildComposeService(opts: BuildComposeServiceOptions): Promise<void> {
    const dockerfile = opts.dockerfile ?? 'Dockerfile';

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.buildImage(
        { context: opts.contextPath, src: ['.'] },
        {
          t: opts.tag,
          dockerfile,
          buildargs: opts.buildArgs,
          target: opts.target,
          nocache: opts.noCache === true,
          ...(opts.cacheFrom &&
            opts.cacheFrom.length > 0 && { cachefrom: JSON.stringify(opts.cacheFrom) }),
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        opts.tag,
        `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${errMsg}`,
      );
    }

    let buildLog = '';
    let buildError = '';
    await new Promise<void>((resolve, reject) => {
      this.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else if (buildError) {
            const reason = [buildLog, buildError].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) buildLog += event.stream;
          if (event.error) {
            buildError += event.error + '\n';
            buildLog += `ERROR: ${event.error}\n`;
          }
          opts.onProgress?.(event);
        },
      );
    });
  }

  /** Create and start a container. */
  async runContainer(options: RunContainerOptions): Promise<string> {
    const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);
    const cPort = options.containerPort ?? options.port;
    const extraHosts = await this.resolveExtraHosts();
    const secretBinds = this.writeSecretFiles(options.name, options.secretFiles ?? []);
    const projectName = options.name.replace(/^ol-/, '');
    const volumeBinds = await this.getProjectVolumeBinds(projectName);
    const binds = [...secretBinds, ...volumeBinds];

    const container = await this.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Env: envArray,
      Labels: {
        'openlander.managed': 'true',
        'openlander.project': options.name.replace(/^ol-/, ''),
        ...options.traefikLabels,
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: options.cmd,
      HostConfig: {
        PortBindings: {
          [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
        },
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: options.network ?? this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      },
    });

    await container.start();
    return container.id;
  }

  async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const cPort = opts.containerPort ?? opts.port;
    const extraHosts = await this.resolveExtraHosts();
    const secretBinds = this.writeSecretFiles(opts.name, opts.secretFiles ?? []);
    const projectName = opts.name.replace(/^ol-/, '');
    const volumeBinds = await this.getProjectVolumeBinds(projectName);
    const binds = [...secretBinds, ...volumeBinds];
    const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;

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

    const container = await this.client.createContainer({
      Image: opts.imageTag,
      name: opts.name,
      Env: envArray,
      Labels: {
        'openlander.managed': 'true',
        'openlander.project': opts.name.replace(/^ol-/, ''),
        ...opts.traefikLabels,
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: command,
      Entrypoint: opts.entrypoint,
      Healthcheck: healthcheck,
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

    const additionalNetworks =
      opts.networks
        ?.slice(1)
        .filter((networkName, index, arr) => arr.indexOf(networkName) === index) ?? [];
    try {
      for (const networkName of additionalNetworks) {
        await this.client.getNetwork(networkName).connect({ Container: container.id });
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

  private writeSecretFiles(containerName: string, files: SecretFileMount[]): string[] {
    if (files.length === 0) return [];

    const secretsDir = join(getDataDir(), 'container-secrets', containerName);
    mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

    const binds: string[] = [];
    for (const file of files) {
      const hostPath = join(secretsDir, file.filename);
      writeFileSync(hostPath, file.content, { mode: 0o600 });
      binds.push(`${hostPath}:${file.mountPath}:ro`);
    }
    return binds;
  }

  private async getProjectVolumeBinds(projectName: string): Promise<string[]> {
    try {
      const result = await this.client.listVolumes({
        filters: {
          label: [
            'openlander.managed=true',
            'openlander.role=volume',
            `openlander.project=${projectName}`,
          ],
        },
      });
      const volumes = Array.isArray(result.Volumes) ? result.Volumes : [];
      const volumeBinds: string[] = [];
      for (const vol of volumes) {
        const name = vol.Name;
        const labels = vol.Labels as Record<string, string> | undefined;
        if (!labels) continue;
        const mountPath = labels['openlander.mount_path'];
        if (typeof mountPath === 'string' && mountPath.startsWith('/')) {
          volumeBinds.push(`${name}:${mountPath}:rw`);
        }
      }
      return volumeBinds;
    } catch {
      return [];
    }
  }

  cleanupSecretFiles(containerName: string): void {
    const secretsDir = join(getDataDir(), 'container-secrets', containerName);
    try {
      rmSync(secretsDir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort */
    }
  }

  private async resolveExtraHosts(): Promise<string[]> {
    try {
      const info = (await this.client.info()) as {
        OperatingSystem?: string;
      };

      if (info.OperatingSystem?.includes('Docker Desktop')) {
        return [];
      }
    } catch {
      return [];
    }

    // Prefer concrete gateway IP — host-gateway relies on daemon resolution
    // which fails on some configurations (Podman, misconfigured daemons, WSL)
    try {
      const network = (await this.client.getNetwork(this.networkName).inspect()) as {
        IPAM?: { Config?: Array<{ Gateway?: string }> };
      };
      const gateway = network.IPAM?.Config?.[0]?.Gateway;
      if (gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
        return [`host.docker.internal:${gateway}`];
      }
    } catch (_) {
      /* network inspect may fail */
    }

    return [];
  }

  /** Get the first EXPOSE port from a Docker image. Returns undefined if none found. */
  async getImageExposedPort(imageTag: string): Promise<number | undefined> {
    try {
      const image = this.client.getImage(imageTag);
      const info = await image.inspect();
      const keys = Object.keys(info.Config.ExposedPorts);
      const first = keys[0]; // e.g. "80/tcp"
      if (!first) return undefined;
      const portStr = first.split('/')[0];
      if (!portStr) return undefined;
      const port = parseInt(portStr, 10);
      return isNaN(port) ? undefined : port;
    } catch (_err) {
      return undefined;
    }
  }

  /** Stop a running container. */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.stop();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        throw new ContainerNotFoundError(containerId);
      }
      // Already stopped is not an error
      if (!msg.includes('is not running')) {
        throw error;
      }
    }
  }

  /** Start a stopped container. */
  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.start();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        throw new ContainerNotFoundError(containerId);
      }
      // Already running is not an error
      if (!msg.includes('is already running') && !msg.includes('already started')) {
        throw error;
      }
    }
  }

  /** Remove a container (force removes even if running). */
  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.remove({ force: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        // Already removed — not an error
        return;
      }
      throw error;
    }
  }

  async ensureProjectNetwork(projectName: string): Promise<string> {
    const networkName = `ol-${projectName}`;

    try {
      await this.client.getNetwork(networkName).inspect();
      return networkName;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found') && !msg.includes('No such network')) {
        throw error;
      }
    }

    try {
      await this.client.createNetwork({ Name: networkName, Driver: 'bridge' });
      return networkName;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return networkName;
      }
      throw error;
    }
  }

  async removeProjectNetwork(projectName: string): Promise<void> {
    const networkName = `ol-${projectName}`;

    try {
      await this.client.getNetwork(networkName).remove();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such network')) {
        return;
      }
      if (msg.includes('active endpoints')) {
        log.warn(
          { projectName, networkName, error: msg },
          'Cannot remove project network with active endpoints',
        );
        return;
      }
      throw error;
    }
  }

  /** Get container logs as a string. */
  async getLogs(containerId: string, tail = 100): Promise<string> {
    try {
      const container = this.client.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        follow: false,
      });
      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as string);
      return stripDockerStreamHeaders(buffer);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  /**
   * Wait for a container to stabilize after starting.
   * Detects crash loops (container restarts) and immediate exits.
   * Returns healthy=false if the container crashes within the timeout window.
   */
  async waitForHealthy(containerId: string, timeoutMs = 15000): Promise<WaitForHealthyResult> {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const container = this.client.getContainer(containerId);
        const info = await container.inspect();

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
          // If health check is defined, wait for healthy status
          if (info.State.Health?.Status === 'healthy') {
            return { healthy: true };
          }
          // No health check defined — running is good enough
          if (!info.State.Health) {
            return { healthy: true };
          }
          // Health check exists but not yet healthy — keep waiting
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('not found') || msg.includes('No such container')) {
          return { healthy: false, error: 'Container not found' };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    // Timeout — do a final check
    try {
      const container = this.client.getContainer(containerId);
      const info = await container.inspect();
      if (info.State.Restarting) {
        return {
          healthy: false,
          exitCode: info.State.ExitCode,
          error: `Container entered restart loop (exit code: ${String(info.State.ExitCode)})`,
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

  /** List all OpenLander-managed containers. */
  async listManagedContainers(): Promise<ContainerInfo[]> {
    const containers = await this.client.listContainers({
      all: true,
      filters: { label: ['openlander.managed=true'] },
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

  /** List all containers on the server (including non-OpenLander managed). */
  async listAllContainers(): Promise<AllContainerInfo[]> {
    try {
      const containers = await this.client.listContainers({ all: true });

      return containers.map((c) => {
        // Labels may be undefined at runtime despite dockerode types
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
          managedByOpenLander: labels['openlander.managed'] === 'true',
          composeProject: labels['com.docker.compose.project'] ?? null,
          created: c.Created,
        };
      });
    } catch (error) {
      // Docker daemon not running or connection error
      log.warn({ error }, 'Failed to list all containers, returning empty array');
      return [];
    }
  }
  /**
   * Pull a Docker image from registry.
   * Silently succeeds if the image already exists locally and pull fails
   * (e.g. no network).
   */
  async pullImage(imageTag: string): Promise<void> {
    try {
      const stream = await this.client.pull(imageTag);
      await new Promise<void>((resolve, reject) => {
        this.client.modem.followProgress(stream, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      // Check if image exists locally — if so, swallow the pull error
      try {
        await this.client.getImage(imageTag).inspect();
        log.debug({ err, imageTag }, 'Image pull failed but image exists locally');
      } catch (_inspectErr) {
        throw new Error(
          `Failed to pull image "${imageTag}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  getNetworkName(): string {
    return this.networkName;
  }

  getClient(): Dockerode {
    return this.client;
  }
}

/** Check if current user is in the docker group (reads /etc/group). */
function isUserInDockerGroup(): boolean {
  try {
    const user = execSync('whoami', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const groups = execSync(`groups ${user}`, { encoding: 'utf8', stdio: 'pipe' });
    return groups.includes('docker');
  } catch (err) {
    log.debug({ err }, 'Failed to check docker group membership');
    return false;
  }
}

/**
 * Resolve the Docker socket path for the current platform.
 * Priority: DOCKER_HOST env → common paths → docker context inspect
 */
export function resolveDockerSocket(): string | undefined {
  // 1. DOCKER_HOST env var (set by Colima, Docker Desktop, etc.)
  const dockerHost = process.env['DOCKER_HOST'];
  if (dockerHost?.startsWith('unix://')) {
    return dockerHost.replace('unix://', '');
  }

  // 2. Common socket file paths
  const candidates = [
    '/var/run/docker.sock',
    `${homedir()}/.docker/run/docker.sock`,
    `${homedir()}/.colima/default/docker.sock`,
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  // 3. Fallback: ask docker CLI for the active context socket
  try {
    const host = execSync('docker context inspect --format "{{.Endpoints.docker.Host}}"', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
    if (host.startsWith('unix://')) {
      const sockPath = host.replace('unix://', '');
      if (existsSync(sockPath)) return sockPath;
      // Socket file might not pass existsSync on some runtimes (Bun),
      // but docker CLI confirmed it — trust it.
      return sockPath;
    }
  } catch (_err) {
    // docker CLI not available or context not configured
  }

  return undefined;
}

export function getDockerHostType(): 'local' | 'remote' {
  const dockerHost = process.env['DOCKER_HOST'];
  if (!dockerHost) return 'local';
  try {
    const url = new URL(dockerHost);
    if (url.protocol === 'unix:') return 'local';
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
    return 'remote';
  } catch {
    return 'local';
  }
}
