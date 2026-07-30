import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { StatefulBackupUnsupportedError, StatefulMigrationRequiredError } from '../errors.js';
import { composeContainerName } from './helpers.js';
import type { ComposeRuntimeRole, ComposeService } from './compose.js';
import type { RuntimeBackend } from './runtime/index.js';

type ContainerInspection = Awaited<ReturnType<RuntimeBackend['inspectContainer']>>;

export interface StatefulBackupVolume {
  name: string;
  destination: string;
}

export interface StatefulComposeChange {
  serviceName: string;
  serviceId: string;
  change: 'update' | 'remove';
  changedFields: string[];
  containerId: string;
  previousFingerprint?: string;
  currentFingerprint?: string;
  backupRequired: true;
  backupVolumes: StatefulBackupVolume[];
}

export interface StatefulComposeApproval {
  version: 1;
  actionRunId?: string;
  serviceId: string;
  projectId: string;
  commitSha: string;
  composeFingerprint: string;
  changes: StatefulComposeChange[];
}

export interface ExistingStatefulComposeService {
  serviceName: string;
  serviceId: string;
  runtimeRole: ComposeRuntimeRole;
  containerId: string | null;
  previousFingerprint?: string;
  inspection?: ContainerInspection;
}

export function fingerprintComposeProject(
  serviceFingerprints: Readonly<Record<string, string>>,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(serviceFingerprints).sort(([left], [right]) => left.localeCompare(right)),
      ),
    )
    .digest('hex');
}

function readRecord(target: object, key: string): Record<string, unknown> | null {
  const value: unknown = Reflect.get(target, key);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(target: object, key: string): unknown[] {
  const value: unknown = Reflect.get(target, key);
  return Array.isArray(value) ? value : [];
}

function readString(target: object, key: string): string | null {
  const value: unknown = Reflect.get(target, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeCommand(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function composeDurationNanoseconds(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim();
  if (!normalized) return 0;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized) * 1_000_000_000;
  const tokenRegex = /([0-9]*\.?[0-9]+)\s*(ns|us|ms|s|m|h)/g;
  let consumed = 0;
  let nanoseconds = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(normalized)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2];
    consumed += match[0].length;
    nanoseconds +=
      unit === 'h'
        ? amount * 3_600_000_000_000
        : unit === 'm'
          ? amount * 60_000_000_000
          : unit === 's'
            ? amount * 1_000_000_000
            : unit === 'ms'
              ? amount * 1_000_000
              : unit === 'us'
                ? amount * 1_000
                : amount;
  }
  return consumed === normalized.length ? nanoseconds : 0;
}

function runtimeCommand(config: object, key: string): string[] {
  return readArray(config, key).filter((value): value is string => typeof value === 'string');
}

function imageIdentity(image: string): { family: string; major: string | null } {
  const withoutDigest = image.split('@')[0] ?? image;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const family = lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const tag = lastColon > lastSlash ? withoutDigest.slice(lastColon + 1) : '';
  return { family, major: tag.match(/(?:^|[^0-9])(\d{1,3})(?:[^0-9]|$)/)?.[1] ?? null };
}

function envRecord(inspection: ContainerInspection): Record<string, string> {
  const config = readRecord(inspection, 'Config');
  if (!config) return {};
  return Object.fromEntries(
    readArray(config, 'Env').flatMap((value) => {
      if (typeof value !== 'string') return [];
      const separator = value.indexOf('=');
      return separator > 0 ? [[value.slice(0, separator), value.slice(separator + 1)]] : [];
    }),
  );
}

function desiredVolumeContracts(params: {
  projectName: string;
  projectPath: string;
  service: ComposeService;
}): StatefulBackupVolume[] {
  return (params.service.volumes ?? []).flatMap((mapping, index) => {
    const [source, destination] = mapping.split(':');
    if (!source || !destination?.startsWith('/')) return [];
    if (isAbsolute(source)) {
      throw new StatefulBackupUnsupportedError(params.service.name, ['bind']);
    }
    if (source.startsWith('.')) {
      const absoluteSource = resolve(params.projectPath, source);
      if (existsSync(absoluteSource) && statSync(absoluteSource).isFile()) return [];
      return [
        {
          name: composeContainerName(
            params.projectName,
            `bind-${params.service.name}-${String(index + 1)}`,
          ),
          destination,
        },
      ];
    }
    return [
      {
        name: composeContainerName(params.projectName, `volume-${source}`),
        destination,
      },
    ];
  });
}

function runtimeBackupVolumes(
  serviceName: string,
  inspection: ContainerInspection,
): StatefulBackupVolume[] {
  const mounts = inspection.Mounts;
  const mountTypes = mounts.map((mount) => mount.Type);
  if (mountTypes.some((type) => type !== 'volume')) {
    throw new StatefulBackupUnsupportedError(serviceName, [...new Set(mountTypes)].sort());
  }
  const volumes = mounts.flatMap((mount) => {
    const name = mount.Name;
    const destination = mount.Destination;
    return name && destination ? [{ name, destination }] : [];
  });
  if (volumes.length === 0) {
    throw new StatefulBackupUnsupportedError(serviceName, ['no_named_volume']);
  }
  return volumes.sort((left, right) => left.destination.localeCompare(right.destination));
}

function sameVolumes(left: StatefulBackupVolume[], right: StatefulBackupVolume[]): boolean {
  const normalize = (values: StatefulBackupVolume[]) =>
    values
      .map((value) => `${value.name}:${value.destination}`)
      .sort()
      .join('|');
  return normalize(left) === normalize(right);
}

function desiredContainerPorts(service: ComposeService): number[] {
  return [...(service.ports ?? []), ...(service.expose ?? [])]
    .flatMap((value) => {
      const normalized = value.split('/')[0] ?? '';
      const target = normalized.split(':').at(-1);
      const port = target ? Number(target) : NaN;
      return Number.isInteger(port) && port > 0 ? [port] : [];
    })
    .sort((left, right) => left - right);
}

function runtimeContainerPorts(inspection: ContainerInspection): number[] {
  const config = readRecord(inspection, 'Config');
  const exposed = config ? readRecord(config, 'ExposedPorts') : null;
  return Object.keys(exposed ?? {})
    .flatMap((key) => {
      const port = Number(key.split('/')[0]);
      return Number.isInteger(port) && port > 0 ? [port] : [];
    })
    .sort((left, right) => left - right);
}

function changedRuntimeFields(params: {
  service: ComposeService;
  inspection: ContainerInspection;
  desiredEnv: Record<string, string>;
}): { approvable: string[]; migration: string[] } {
  const approvable = new Set<string>();
  const migration = new Set<string>();
  const config = readRecord(params.inspection, 'Config') ?? {};
  const hostConfig = readRecord(params.inspection, 'HostConfig') ?? {};
  // eslint-disable-next-line openlander-internal/no-dropped-columns -- Compose YAML field, not a services table column
  const desiredImage = params.service.image;
  const runtimeImage = readString(config, 'Image');
  if (desiredImage && runtimeImage && desiredImage !== runtimeImage) {
    const desiredIdentity = imageIdentity(desiredImage);
    const runtimeIdentity = imageIdentity(runtimeImage);
    if (
      desiredIdentity.family !== runtimeIdentity.family ||
      (desiredIdentity.major !== null &&
        runtimeIdentity.major !== null &&
        desiredIdentity.major !== runtimeIdentity.major)
    ) {
      migration.add('image');
    } else {
      approvable.add('image');
    }
  }

  const actualEnv = envRecord(params.inspection);
  if (
    Object.entries(params.desiredEnv).some(([key, value]) => actualEnv[key] !== value) ||
    (params.service.environment !== undefined && Object.keys(params.desiredEnv).length === 0)
  ) {
    approvable.add('environment');
  }

  const desiredCommand = normalizeCommand(params.service.command);
  const desiredEntrypoint = normalizeCommand(params.service.entrypoint);
  if (
    params.service.command !== undefined &&
    JSON.stringify(desiredCommand) !== JSON.stringify(runtimeCommand(config, 'Cmd'))
  ) {
    approvable.add('command');
  }
  if (
    params.service.entrypoint !== undefined &&
    JSON.stringify(desiredEntrypoint) !== JSON.stringify(runtimeCommand(config, 'Entrypoint'))
  ) {
    approvable.add('command');
  }

  const restartPolicy = readRecord(hostConfig, 'RestartPolicy');
  const runtimeRestart = restartPolicy ? readString(restartPolicy, 'Name') : null;
  if ((params.service.restart ?? 'unless-stopped') !== (runtimeRestart ?? '')) {
    approvable.add('restart');
  }

  const runtimeMemoryValue: unknown = Reflect.get(hostConfig, 'Memory');
  const runtimeMemory = typeof runtimeMemoryValue === 'number' ? runtimeMemoryValue : 0;
  if ((params.service.memoryLimitBytes ?? 0) !== runtimeMemory) approvable.add('memory');

  if (
    ((params.service.ports?.length ?? 0) > 0 || (params.service.expose?.length ?? 0) > 0) &&
    JSON.stringify(desiredContainerPorts(params.service)) !==
      JSON.stringify(runtimeContainerPorts(params.inspection))
  ) {
    approvable.add('ports');
  }

  const runtimeHealthcheck = readRecord(config, 'Healthcheck');
  if (params.service.healthcheck && !runtimeHealthcheck) {
    approvable.add('healthcheck');
  } else if (params.service.healthcheck && runtimeHealthcheck) {
    const test = readArray(runtimeHealthcheck, 'Test').filter(
      (value): value is string => typeof value === 'string',
    );
    const desiredTest =
      typeof params.service.healthcheck.test === 'string'
        ? ['CMD-SHELL', params.service.healthcheck.test]
        : params.service.healthcheck.test;
    const runtimeInterval = Reflect.get(runtimeHealthcheck, 'Interval');
    const runtimeTimeout = Reflect.get(runtimeHealthcheck, 'Timeout');
    const runtimeRetries = Reflect.get(runtimeHealthcheck, 'Retries');
    const runtimeStartPeriod = Reflect.get(runtimeHealthcheck, 'StartPeriod');
    if (
      JSON.stringify(test) !== JSON.stringify(desiredTest) ||
      (typeof runtimeInterval === 'number' ? runtimeInterval : 0) !==
        composeDurationNanoseconds(params.service.healthcheck.interval) ||
      (typeof runtimeTimeout === 'number' ? runtimeTimeout : 0) !==
        composeDurationNanoseconds(params.service.healthcheck.timeout) ||
      (typeof runtimeRetries === 'number' ? runtimeRetries : 0) !==
        (params.service.healthcheck.retries ?? 0) ||
      (typeof runtimeStartPeriod === 'number' ? runtimeStartPeriod : 0) !==
        composeDurationNanoseconds(params.service.healthcheck.start_period)
    ) {
      approvable.add('healthcheck');
    }
  }

  return { approvable: [...approvable].sort(), migration: [...migration].sort() };
}

export function classifyStatefulComposeChanges(params: {
  projectName: string;
  projectPath: string;
  services: readonly ComposeService[];
  runtimeRoles: ReadonlyMap<string, ComposeRuntimeRole>;
  existingServices: readonly ExistingStatefulComposeService[];
  currentFingerprints: Readonly<Record<string, string>>;
  desiredEnvByService: ReadonlyMap<string, Record<string, string>>;
}): StatefulComposeChange[] {
  const desiredByName = new Map(params.services.map((service) => [service.name, service]));
  const changes: StatefulComposeChange[] = [];

  for (const existing of params.existingServices) {
    const desired = desiredByName.get(existing.serviceName);
    const desiredRole = params.runtimeRoles.get(existing.serviceName);
    if (
      desired &&
      desiredRole !== undefined &&
      desiredRole !== existing.runtimeRole &&
      (desiredRole === 'resource' || existing.runtimeRole === 'resource')
    ) {
      throw new StatefulMigrationRequiredError(existing.serviceName, ['runtime_role']);
    }
    if (existing.runtimeRole !== 'resource') continue;
    if (!existing.containerId || !existing.inspection) {
      throw new StatefulMigrationRequiredError(existing.serviceName, ['container']);
    }
    const backupVolumes = runtimeBackupVolumes(existing.serviceName, existing.inspection);
    if (!desired) {
      changes.push({
        serviceName: existing.serviceName,
        serviceId: existing.serviceId,
        change: 'remove',
        changedFields: ['removed'],
        containerId: existing.containerId,
        previousFingerprint: existing.previousFingerprint,
        backupRequired: true,
        backupVolumes,
      });
      continue;
    }

    const currentRole = desiredRole ?? 'application';
    if (currentRole !== 'resource') {
      throw new StatefulMigrationRequiredError(existing.serviceName, ['runtime_role']);
    }
    const currentFingerprint = params.currentFingerprints[existing.serviceName];
    const desiredVolumes = desiredVolumeContracts({
      projectName: params.projectName,
      projectPath: params.projectPath,
      service: desired,
    });
    if (!sameVolumes(desiredVolumes, backupVolumes)) {
      throw new StatefulMigrationRequiredError(existing.serviceName, ['volumes']);
    }
    const fields = changedRuntimeFields({
      service: desired,
      inspection: existing.inspection,
      desiredEnv: params.desiredEnvByService.get(existing.serviceName) ?? {},
    });
    if (fields.migration.length > 0) {
      throw new StatefulMigrationRequiredError(existing.serviceName, fields.migration);
    }
    const definitionChanged =
      existing.previousFingerprint !== undefined &&
      currentFingerprint !== undefined &&
      existing.previousFingerprint !== currentFingerprint;
    if (!definitionChanged && fields.approvable.length === 0) continue;
    changes.push({
      serviceName: existing.serviceName,
      serviceId: existing.serviceId,
      change: 'update',
      changedFields: fields.approvable.length > 0 ? fields.approvable : ['definition'],
      containerId: existing.containerId,
      previousFingerprint: existing.previousFingerprint,
      currentFingerprint,
      backupRequired: true,
      backupVolumes,
    });
  }

  return changes;
}
