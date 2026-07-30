import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getDataDir } from '../config/index.js';
import { ServiceOperationError } from '../errors.js';
import type { RuntimeBackend } from './runtime/index.js';
import type { StatefulBackupVolume } from './compose-stateful-update.js';

const DEFAULT_CONTAINERIZED_DATA_VOLUME = 'openlander-data';
const CONTAINERIZED_DATA_MOUNT = '/openlander-data';

export interface ComposeStatefulBackupManifest {
  actionRunId: string;
  serviceId: string;
  serviceName: string;
  containerId: string;
  createdAt: string;
  volumes: Array<{
    name: string;
    destination: string;
    archivePath: string;
    sizeBytes: number;
    sha256: string;
  }>;
  manifestPath: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'stateful';
}

function backupStorageMount(backupDir: string): { bind: string; containerDir: string } {
  if (isTruthyEnv(process.env.OPENLANDER_CONTAINERIZED)) {
    const dataVolume =
      process.env.OPENLANDER_DATA_VOLUME?.trim() || DEFAULT_CONTAINERIZED_DATA_VOLUME;
    return {
      bind: `${dataVolume}:${CONTAINERIZED_DATA_MOUNT}`,
      containerDir: `${CONTAINERIZED_DATA_MOUNT}/backups/compose-stateful`,
    };
  }
  return { bind: `${backupDir}:/backup`, containerDir: '/backup' };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream: AsyncIterable<unknown> = createReadStream(path);
  for await (const chunk of stream) {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
      hash.update(chunk);
    }
  }
  return hash.digest('hex');
}

export async function backupComposeStatefulVolumes(params: {
  runtime: RuntimeBackend;
  actionRunId: string;
  serviceId: string;
  serviceName: string;
  containerId: string;
  volumes: StatefulBackupVolume[];
}): Promise<ComposeStatefulBackupManifest> {
  const backupDir = join(getDataDir(), 'backups', 'compose-stateful');
  mkdirSync(backupDir, { recursive: true });
  const storage = backupStorageMount(backupDir);
  const createdAt = new Date().toISOString();
  const uniqueVolumes = new Map(params.volumes.map((volume) => [volume.name, volume]));
  const manifestVolumes: ComposeStatefulBackupManifest['volumes'] = [];

  await params.runtime.pullImage('alpine');
  for (const volume of uniqueVolumes.values()) {
    const suffix = createHash('sha256').update(volume.name).digest('hex').slice(0, 12);
    const filename = `${safeSegment(params.serviceName)}-${safeSegment(params.actionRunId)}-${suffix}.tar.gz`;
    const archivePath = join(backupDir, filename);
    const backupContainerId = await params.runtime.runInfraContainer({
      Image: 'alpine',
      Cmd: ['tar', 'czf', `${storage.containerDir}/${filename}`, '-C', '/data', '.'],
      HostConfig: {
        Binds: [`${volume.name}:/data:ro`, storage.bind],
        AutoRemove: true,
      },
    });
    const { StatusCode: exitCode } = await params.runtime.waitForContainer(backupContainerId);
    if (exitCode !== 0) {
      throw new ServiceOperationError(
        'stateful_compose_backup',
        `Stateful Compose backup failed for '${params.serviceName}'.`,
        { serviceId: params.serviceId, volumeName: volume.name, exitCode },
      );
    }
    if (!existsSync(archivePath)) {
      throw new ServiceOperationError(
        'stateful_compose_backup',
        `Stateful Compose backup archive was not created for '${params.serviceName}'.`,
        { serviceId: params.serviceId, volumeName: volume.name },
      );
    }
    manifestVolumes.push({
      name: volume.name,
      destination: volume.destination,
      archivePath,
      sizeBytes: statSync(archivePath).size,
      sha256: await sha256File(archivePath),
    });
  }

  const manifestPath = join(
    backupDir,
    `${safeSegment(params.serviceName)}-${safeSegment(params.actionRunId)}.manifest.json`,
  );
  const manifest: ComposeStatefulBackupManifest = {
    actionRunId: params.actionRunId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    containerId: params.containerId,
    createdAt,
    volumes: manifestVolumes,
    manifestPath,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return manifest;
}
