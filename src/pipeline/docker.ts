import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('docker');

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { getDataDir, getPolicy, SHARED_NETWORK_NAME, DOCKER_LABELS } from '../config/index.js';
import { sleep } from '../lib/sleep.js';
import { containerName, stripContainerPrefix } from './helpers.js';
import type Dockerode from 'dockerode';

import {
  DockerNotRunningError,
  DockerBuildError,
  ContainerNotFoundError,
  isDockerNotFoundError,
} from '../errors.js';

function isAlreadyConnectedError(msg: string): boolean {
  return msg.includes('already exists') || msg.includes('already connected');
}

function isContainerNotRunning(msg: string): boolean {
  return msg.includes('is not running');
}

function isContainerAlreadyRunning(msg: string): boolean {
  return msg.includes('is already running') || msg.includes('already started');
}

function isNotConnectedToNetwork(msg: string): boolean {
  return msg.includes('is not connected');
}

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
  /** Docker restart policy (default: on-failure with MaximumRetryCount: 5). */
  restartPolicy?: { Name: string; MaximumRetryCount?: number };
  /** Additional volume or bind mounts (e.g. `["vol:/data"]`). */
  extraBinds?: string[];
  /** Docker healthcheck configuration (intervals in seconds). */
  healthcheck?: {
    test: string | string[];
    interval?: number;
    timeout?: number;
    retries?: number;
    start_period?: number;
  };
  /**
   * When provided, replaces auto-generated labels entirely.
   * By default, runContainer adds MANAGED + PROJECT + traefikLabels.
   * Use this for non-project containers (e.g. services) that need different labels.
   */
  labels?: Record<string, string>;
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
  /** When provided, the build stream is tracked in activeBuilds so it can be cancelled via cancelBuild(). */
  projectId?: string;
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
  private readonly activeBuilds = new Map<string, Readable>();

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
    const trackingId = options?.projectId;

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

    if (trackingId) {
      this.activeBuilds.set(trackingId, stream as Readable);
    }

    let buildLog = '';
    let buildError = '';
    try {
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
    } finally {
      if (trackingId) {
        this.activeBuilds.delete(trackingId);
      }
    }
  }

  cancelBuild(projectId: string): boolean {
    const stream = this.activeBuilds.get(projectId);
    if (!stream) {
      return false;
    }
    stream.destroy();
    this.activeBuilds.delete(projectId);
    log.info({ projectId }, 'Build cancelled');
    return true;
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
    const projectName = stripContainerPrefix(options.name);
    const networkMode = options.network ?? this.networkName;
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
    const volumeBinds = await this.getProjectVolumeBinds(projectName);
    const binds = [...secretBinds, ...volumeBinds, ...(options.extraBinds ?? [])];

    const container = await this.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Env: envArray,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.PROJECT]: stripContainerPrefix(options.name),
        ...options.traefikLabels,
      },
      ExposedPorts: {
        [`${String(cPort)}/tcp`]: {},
      },
      Cmd: options.cmd,
      NetworkingConfig: networkingConfig,
      HostConfig: {
        PortBindings: {
          [`${String(cPort)}/tcp`]: [{ HostPort: String(options.port) }],
        },
        Binds: binds.length > 0 ? binds : undefined,
        NetworkMode: networkMode,
        RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
        ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      },
    });

    await container.start();

    if (networkMode !== SHARED_NETWORK_NAME) {
      await this.ensureSharedNetworkAttachment(container.id, projectName);
    }

    return container.id;
  }

  async runComposeService(opts: RunComposeServiceOptions): Promise<string> {
    const envArray = Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`);
    const cPort = opts.containerPort ?? opts.port;
    const extraHosts = await this.resolveExtraHosts();
    const secretBinds = this.writeSecretFiles(opts.name, opts.secretFiles ?? []);
    const projectName = stripContainerPrefix(opts.name);
    const volumeBinds = await this.getProjectVolumeBinds(projectName);
    const binds = [...secretBinds, ...volumeBinds];
    const networkMode = opts.network ?? opts.networks?.[0] ?? this.networkName;
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

    const container = await this.client.createContainer({
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
      await this.ensureSharedNetworkAttachment(container.id, projectName);
    }

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

  /**
   * Create and start an infrastructure container (e.g. Traefik).
   * Unlike runContainer, this accepts raw Dockerode options for non-project
   * containers that don't follow the standard port/Traefik-label pattern.
   */
  async runInfraContainer(options: Dockerode.ContainerCreateOptions): Promise<string> {
    const container = await this.client.createContainer(options);
    await container.start();
    return container.id;
  }

  public async ensureSharedNetworkAttachment(containerId: string, alias: string): Promise<void> {
    const network = this.client.getNetwork(SHARED_NETWORK_NAME);

    try {
      await network.connect({
        Container: containerId,
        EndpointConfig: { Aliases: [alias] },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isAlreadyConnectedError(msg)) {
        return;
      }

      throw error;
    }
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
            `${DOCKER_LABELS.MANAGED}=true`,
            `${DOCKER_LABELS.ROLE}=volume`,
            `${DOCKER_LABELS.PROJECT}=${projectName}`,
          ],
        },
      });
      const volumes = Array.isArray(result.Volumes) ? result.Volumes : [];
      const volumeBinds: string[] = [];
      for (const vol of volumes) {
        const name = vol.Name;
        const labels = vol.Labels as Record<string, string> | undefined;
        if (!labels) continue;
        const mountPath = labels[DOCKER_LABELS.MOUNT_PATH];
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
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      if (!isContainerNotRunning(msg)) {
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
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      if (!isContainerAlreadyRunning(msg)) {
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
        const container = this.client.getContainer(containerId);
        await container.inspect();
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

  async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
    const image = this.client.getImage(sourceTag);
    await image.tag({ repo, tag: newTag });
  }

  /** Disconnect a container from a network before removal to avoid sandbox cleanup races. */
  async disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<void> {
    try {
      const network = this.client.getNetwork(networkName);
      await network.disconnect({ Container: containerId, Force: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isNotConnectedToNetwork(msg) || isDockerNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  /** Inspect a container and return full metadata. */
  async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
    try {
      const container = this.client.getContainer(containerId);
      return await container.inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  /** Connect a container to a network with optional aliases. Silently succeeds if already connected. */
  async connectContainerToNetwork(
    containerId: string,
    networkName: string,
    aliases?: string[],
  ): Promise<void> {
    try {
      const network = this.client.getNetwork(networkName);
      await network.connect({
        Container: containerId,
        EndpointConfig: aliases ? { Aliases: aliases } : undefined,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isAlreadyConnectedError(msg)) {
        return;
      }
      throw error;
    }
  }

  /** Restart a running container. */
  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.restart();
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  /** Execute a non-interactive command in a container and return structured output. */
  async execSimple(
    containerId: string,
    cmd: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = this.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: false, stdin: false });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    stdoutStream.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    stderrStream.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    this.client.modem.demuxStream(stream, stdoutStream, stderrStream);

    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    const info = await exec.inspect();
    return {
      exitCode: info.ExitCode ?? 0,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  /** Inspect a Docker network and return its metadata. */
  async getNetworkInfo(networkName: string): Promise<Dockerode.NetworkInspectInfo> {
    try {
      const network = this.client.getNetwork(networkName);
      return await network.inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new Error(`Network not found: ${networkName}`);
      }
      throw error;
    }
  }

  async ensureProjectNetwork(projectName: string): Promise<string> {
    const networkName = containerName(projectName);

    try {
      await this.client.getNetwork(networkName).inspect();
      return networkName;
    } catch (error) {
      if (!isDockerNotFoundError(error)) {
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
    const networkName = containerName(projectName);

    try {
      await this.client.getNetwork(networkName).remove();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
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
      if (isDockerNotFoundError(error)) {
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
        if (isDockerNotFoundError(error)) {
          return { healthy: false, error: 'Container not found' };
        }
      }

      await sleep(checkInterval);
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
      filters: { label: [`${DOCKER_LABELS.MANAGED}=true`] },
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
          managedByOpenLander: labels[DOCKER_LABELS.MANAGED] === 'true',
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
  /** List dangling (untagged) Docker images. */
  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
    return await this.client.listImages({ filters: { dangling: ['true'] } });
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

  /** Inspect a Docker image. Throws if not found. */
  async inspectImage(tag: string): Promise<Dockerode.ImageInspectInfo> {
    try {
      return await this.client.getImage(tag).inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
      throw error;
    }
  }

  /** Remove a Docker image. Silent on 404. */
  async removeImage(tag: string, force = false): Promise<void> {
    try {
      await this.client.getImage(tag).remove({ force });
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  /** Get one-shot container stats (CPU, memory). */
  async getContainerStats(containerId: string): Promise<unknown> {
    try {
      const container = this.client.getContainer(containerId);
      return await container.stats({ stream: false });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  /** Rename a container. */
  async renameContainer(containerId: string, newName: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.rename({ name: newName });
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new ContainerNotFoundError(containerId);
      throw error;
    }
  }

  /** Wait for a container to exit. Returns exit code. */
  async waitForContainer(containerId: string): Promise<{ StatusCode: number }> {
    const container = this.client.getContainer(containerId);
    return (await container.wait()) as { StatusCode: number };
  }

  /** Docker system disk usage (images, containers, volumes). */
  async getDiskUsage(): Promise<unknown> {
    return await this.client.df();
  }

  /** Inspect a volume. */
  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
    try {
      return await this.client.getVolume(name).inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new Error(`Volume not found: ${name}`);
      throw error;
    }
  }

  /** List volumes with optional filters. */
  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
    const result = (await this.client.listVolumes(
      filters ? { filters } : undefined,
    )) as unknown as { Volumes?: Dockerode.VolumeInspectInfo[] };
    return result.Volumes ?? [];
  }

  /** Create a volume. Always applies MANAGED=true label. */
  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
    await this.client.createVolume({
      Name: opts.name,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        ...opts.labels,
      },
    });
  }

  /** Remove a volume. Silent on 404. */
  async removeVolume(name: string): Promise<void> {
    try {
      await this.client.getVolume(name).remove();
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  /** Run a service container (PostgreSQL, Redis, etc.) with SERVICE role labels and unless-stopped restart. */
  async runServiceContainer(opts: {
    imageTag: string;
    name: string;
    port: number;
    containerPort?: number;
    hostPort?: number;
    envVars: Record<string, string>;
    serviceName: string;
    volumeBinds?: string[];
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

    const container = await this.client.createContainer({
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
        NetworkMode: this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: opts.volumeBinds ?? [],
        PortBindings: {
          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });

    await container.start();
    return container.id;
  }

  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
  async execStream(
    containerId: string,
    cmd: string[],
    opts?: { tty?: boolean },
  ): Promise<NodeJS.ReadWriteStream> {
    const container = this.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: opts?.tty ?? true,
    });
    return (await exec.start({ hijack: true, stdin: true })) as unknown as NodeJS.ReadWriteStream;
  }

  /** Get Docker daemon event stream for real-time container events. */
  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
    return await (
      this.client.getEvents as (opts: {
        filters: Record<string, string[]>;
      }) => Promise<NodeJS.ReadableStream>
    )({
      filters,
    });
  }

  getNetworkName(): string {
    return this.networkName;
  }

  /** Ensure a Docker network exists, creating it if missing. Returns the network name. */
  async ensureNetwork(name: string): Promise<string> {
    try {
      await this.client.getNetwork(name).inspect();
      return name;
    } catch (error) {
      if (!isDockerNotFoundError(error)) {
        throw error;
      }
    }
    try {
      await this.client.createNetwork({ Name: name, Driver: 'bridge' });
      return name;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return name;
      }
      throw error;
    }
  }

  /** Follow container logs as a readable stream for real-time log tailing. */
  async getLogStream(
    containerId: string,
    opts?: { tail?: number; stdout?: boolean; stderr?: boolean },
  ): Promise<NodeJS.ReadableStream> {
    const container = this.client.getContainer(containerId);
    return (await container.logs({
      follow: true,
      stdout: opts?.stdout ?? true,
      stderr: opts?.stderr ?? true,
      tail: opts?.tail ?? 50,
    })) as unknown as NodeJS.ReadableStream;
  }

  /** Open an interactive terminal exec with resize support. Returns stream and resize function. */
  async execTerminal(
    containerId: string,
    cmd: string[],
  ): Promise<{
    stream: NodeJS.ReadWriteStream;
    resize: (size: { w: number; h: number }) => Promise<void>;
  }> {
    const container = this.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: true,
    })) as unknown as NodeJS.ReadWriteStream;
    return {
      stream,
      resize: async (size: { w: number; h: number }) => {
        await exec.resize(size);
      },
    };
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
