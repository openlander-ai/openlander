import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Dockerode from 'dockerode';
import { getDataDir, DOCKER_LABELS } from '../../config/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { DockerStatus, SecretFileMount } from './types.js';

const log = createModuleLogger('docker');

export function isAlreadyConnectedError(msg: string): boolean {
  return msg.includes('already exists') || msg.includes('already connected');
}

export function isContainerNotRunning(msg: string): boolean {
  return msg.includes('is not running');
}

export function isContainerAlreadyRunning(msg: string): boolean {
  return msg.includes('is already running') || msg.includes('already started');
}

export function isNotConnectedToNetwork(msg: string): boolean {
  return msg.includes('is not connected');
}

export function stripDockerStreamHeaders(buffer: Buffer): string {
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

export function writeSecretFiles(containerName: string, files: SecretFileMount[]): string[] {
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

export async function getProjectVolumeBinds(
  client: Dockerode,
  projectName: string,
): Promise<string[]> {
  try {
    const result = await client.listVolumes({
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

export function cleanupSecretFiles(containerName: string): void {
  const secretsDir = join(getDataDir(), 'container-secrets', containerName);
  try {
    rmSync(secretsDir, { recursive: true, force: true });
  } catch (err) {
    log.debug({ err, containerName }, 'Failed to clean up secret files');
  }
}

export async function resolveExtraHosts(client: Dockerode, networkName: string): Promise<string[]> {
  try {
    const info = (await client.info()) as {
      OperatingSystem?: string;
    };

    if (info.OperatingSystem?.includes('Docker Desktop')) {
      return [];
    }
  } catch {
    return [];
  }

  try {
    const network = (await client.getNetwork(networkName).inspect()) as {
      IPAM?: { Config?: Array<{ Gateway?: string }> };
    };
    const gateway = network.IPAM?.Config?.[0]?.Gateway;
    if (gateway && /^\d+\.\d+\.\d+\.\d+$/.test(gateway)) {
      return [`host.docker.internal:${gateway}`];
    }
  } catch (err) {
    log.debug({ err, networkName }, 'Failed to inspect Docker network for extra hosts');
  }

  return [];
}

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

export async function dockerStatus(client: Dockerode): Promise<DockerStatus> {
  try {
    execSync('docker --version', { stdio: 'pipe' });
  } catch (err) {
    log.debug({ err }, 'Docker binary check failed');
    return { state: 'not_installed' };
  }

  try {
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error('Docker ping timeout (5s)'));
        }, 5_000),
      ),
    ]);
    return { state: 'running' };
  } catch (err) {
    log.debug({ err }, 'Dockerode ping failed — trying sg docker');
  }

  if (process.platform !== 'darwin') {
    try {
      execSync('sg docker -c "docker info"', { stdio: 'pipe', timeout: 5000 });
      return { state: 'running' };
    } catch (err) {
      log.debug({ err }, 'sg docker check failed');
    }
  }

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

export function resolveDockerSocket(): string | undefined {
  const dockerHost = process.env['DOCKER_HOST'];
  if (dockerHost?.startsWith('unix://')) {
    return dockerHost.replace('unix://', '');
  }

  const candidates = [
    '/var/run/docker.sock',
    `${homedir()}/.docker/run/docker.sock`,
    `${homedir()}/.colima/default/docker.sock`,
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  try {
    const host = execSync('docker context inspect --format "{{.Endpoints.docker.Host}}"', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
    if (host.startsWith('unix://')) {
      const sockPath = host.replace('unix://', '');
      if (existsSync(sockPath)) return sockPath;
      return sockPath;
    }
  } catch (err) {
    log.debug({ err }, 'Docker context inspect failed while resolving socket');
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
