import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { DOCKER_LABELS, getDataDir, SHARED_NETWORK_NAME } from '../config/index.js';
import type { Database, ServiceRow } from '../db/index.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../db/service-ids.js';
import { createModuleLogger } from '../lib/logger.js';
import { sleep } from '../lib/sleep.js';
import { serviceContainerName, serviceVolumeName } from './helpers.js';
import { ensureManagedTraefikNetwork } from './traefik.js';
import {
  getServiceAdapter,
  type BuiltInServiceType,
  type CreateDatabaseResult,
  type CreateUserResult,
  type ListedDatabase,
  type ListedUser,
} from './service-adapters/index.js';
import { MinioAdapter } from './service-adapters/minio-adapter.js';
import {
  assertSafeDatabaseName,
  assertSafeUserName,
  execInServiceContainer,
  type ExecOptions,
} from './service-adapters/shared.js';
import type { ContainerExecResult } from './service-adapters/types.js';
import type { RuntimeBackend } from './runtime/index.js';
import { allocatePort, clearPortScanCache, releasePortReservation } from './port.js';
import {
  isDockerContainerNameConflictError,
  isDockerNotFoundError,
  ManagedServiceNameConflictError,
  ManagedServicePersistenceCleanedError,
  RepoPersistenceError,
  ServiceConfigError,
  ServiceContainerStateError,
  ServiceInUseError,
  ServiceNotFoundError,
  ServiceOperationError,
  ServiceOperationUnsupportedError,
} from '../errors.js';

const log = createModuleLogger('service-manager');
const SERVICE_CARD_SUMMARY_CACHE_TTL_MS = 15_000;
const DEFAULT_CONTAINERIZED_DATA_VOLUME = 'openlander-data';
const CONTAINERIZED_DATA_MOUNT = '/openlander-data';

type ServiceCardSummary = ServiceRow & {
  summary: {
    healthStatus: string | null;
    uptimeSeconds: number | null;
    restartCount: number | null;
  };
};

type ContainerUsageStats = {
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
};

type BackupStorageMount = {
  bind: string;
  containerDir: string;
};

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export const AVAILABLE_VERSIONS: Record<string, string[]> = {
  postgresql: ['17-alpine', '16-alpine', '15-alpine', '14-alpine'],
  // Canonical alias so version resolution works when service.kind='postgres'
  postgres: ['17-alpine', '16-alpine', '15-alpine', '14-alpine'],
  mysql: ['9', '8'],
  redis: ['8-alpine', '7-alpine'],
  mongodb: ['8', '7'],
  // Canonical alias so version resolution works when service.kind='mongo'
  mongo: ['8', '7'],
  minio: ['RELEASE.2024-11-07T00-52-20Z', 'latest'],
  rabbitmq: ['4.0-management-alpine', '3.13-management-alpine'],
};

export interface ServiceTemplate {
  type: string;
  image: string;
  port: number;
  cmd?: string[];
  healthcheck?: {
    test: string[];
    interval: number;
    timeout: number;
    retries: number;
    startPeriod: number;
  };
  env: (creds: { user: string; password: string; database: string }) => string[];
}

const postgresTemplate: ServiceTemplate = {
  type: 'postgresql',
  image: 'postgres:16-alpine',
  port: 5432,
  env: (c) => [
    `POSTGRES_USER=${c.user}`,
    `POSTGRES_PASSWORD=${c.password}`,
    `POSTGRES_DB=${c.database}`,
  ],
};

const mongoTemplate: ServiceTemplate = {
  type: 'mongodb',
  image: 'mongo:7',
  port: 27017,
  env: (c) => [`MONGO_INITDB_ROOT_USERNAME=${c.user}`, `MONGO_INITDB_ROOT_PASSWORD=${c.password}`],
};

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate> = {
  postgresql: postgresTemplate,
  // Canonical alias — legacyTypeToKind() maps 'postgresql'→'postgres'
  postgres: postgresTemplate,
  mysql: {
    type: 'mysql',
    image: 'mysql:8',
    port: 3306,
    env: (c) => [
      `MYSQL_ROOT_PASSWORD=${c.password}`,
      `MYSQL_DATABASE=${c.database}`,
      `MYSQL_USER=${c.user}`,
      `MYSQL_PASSWORD=${c.password}`,
    ],
  },
  redis: {
    type: 'redis',
    image: 'redis:7-alpine',
    port: 6379,
    env: () => [],
  },
  mongodb: mongoTemplate,
  // Canonical alias — legacyTypeToKind() maps 'mongodb'→'mongo'
  mongo: mongoTemplate,
  minio: {
    type: 'minio',
    image: 'minio/minio:RELEASE.2024-11-07T00-52-20Z',
    port: 9000,
    cmd: ['server', '/data', '--console-address', ':9001'],
    healthcheck: {
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live'],
      interval: 30,
      timeout: 10,
      retries: 3,
      startPeriod: 10,
    },
    env: (c) => [`MINIO_ROOT_USER=${c.user}`, `MINIO_ROOT_PASSWORD=${c.password}`],
  },
  rabbitmq: {
    type: 'rabbitmq',
    image: 'rabbitmq:4.0-management-alpine',
    port: 5672,
    healthcheck: {
      test: ['CMD', 'rabbitmq-diagnostics', 'check_running'],
      interval: 30,
      timeout: 10,
      retries: 3,
      startPeriod: 30,
    },
    env: (c) => [`RABBITMQ_DEFAULT_USER=${c.user}`, `RABBITMQ_DEFAULT_PASS=${c.password}`],
  },
};

export const SERVICE_MEMORY_LIMITS: Record<
  string,
  { memoryLimitBytes: number; cpuShares: number }
> = {
  postgresql: { memoryLimitBytes: 536870912, cpuShares: 512 }, // 512MB
  postgres: { memoryLimitBytes: 536870912, cpuShares: 512 }, // canonical alias
  mysql: { memoryLimitBytes: 536870912, cpuShares: 512 }, // 512MB
  redis: { memoryLimitBytes: 134217728, cpuShares: 256 }, // 128MB
  mongodb: { memoryLimitBytes: 1073741824, cpuShares: 1024 }, // 1GB
  mongo: { memoryLimitBytes: 1073741824, cpuShares: 1024 }, // canonical alias
  minio: { memoryLimitBytes: 268435456, cpuShares: 512 }, // 256MB
  rabbitmq: { memoryLimitBytes: 268435456, cpuShares: 512 }, // 256MB
};

/**
 * Standard env var key for each built-in service type.
 * First service of a type gets the standard key; subsequent ones are prefixed.
 */
const DEFAULT_ENV_KEYS: Record<string, string> = {
  postgresql: 'DATABASE_URL',
  postgres: 'DATABASE_URL', // canonical alias
  mysql: 'DATABASE_URL',
  redis: 'REDIS_URL',
  mongodb: 'MONGODB_URL',
  mongo: 'MONGODB_URL', // canonical alias
  minio: 'S3_ENDPOINT',
  rabbitmq: 'RABBITMQ_URL',
};

export class ServiceManager {
  private serviceCardSummaryCache: {
    key: string;
    expiresAt: number;
    data: ServiceCardSummary[];
  } | null = null;
  private serviceCardSummaryInFlight: {
    key: string;
    promise: Promise<ServiceCardSummary[]>;
  } | null = null;
  private serviceCardSummaryEpoch = 0;

  constructor(
    private readonly runtime: RuntimeBackend,
    private readonly db: Database,
    private readonly dataDir: string = getDataDir(),
  ) {}

  private invalidateServiceCardSummaryCache(): void {
    this.serviceCardSummaryCache = null;
    this.serviceCardSummaryEpoch += 1;
  }

  /**
   * Compute suggested env var(s) for a newly created service so the agent
   * can auto-link it to a project via set_env_vars.
   *
   * Rules:
   *  - Target project with no key collision → standard key.
   *  - Target project already has that key → prefixed key.
   *  - No target project → prefixed key because no consumer app is known.
   */
  async getSuggestedEnv(
    service: ServiceRow,
    opts: { targetProjectId?: string | null } = {},
  ): Promise<Array<{ key: string; value: string }>> {
    const serviceKind = service.kind;
    const baseKey = DEFAULT_ENV_KEYS[serviceKind];
    if (!baseKey) {
      return [];
    }

    const credentials = service.credentials ? this.tryParseCredentials(service.credentials) : null;
    const connectionString = (credentials?.['connectionString'] as string | undefined) ?? null;
    if (!connectionString) {
      return [];
    }

    const prefix = this.serviceEnvPrefix(service.name);

    if (serviceKind === 'minio') {
      const user = (credentials?.['user'] as string | undefined) ?? '';
      const password = (credentials?.['password'] as string | undefined) ?? '';
      const minioKeys = ['S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
      const shouldPrefix = await this.shouldPrefixSuggestedEnvKeys(service, minioKeys, opts);
      return [
        { key: `${shouldPrefix ? prefix : ''}S3_ENDPOINT`, value: connectionString },
        { key: `${shouldPrefix ? prefix : ''}AWS_ACCESS_KEY_ID`, value: user },
        { key: `${shouldPrefix ? prefix : ''}AWS_SECRET_ACCESS_KEY`, value: password },
      ];
    }

    const shouldPrefix = await this.shouldPrefixSuggestedEnvKeys(service, [baseKey], opts);
    const key = shouldPrefix ? `${prefix}${baseKey}` : baseKey;

    return [{ key, value: connectionString }];
  }

  private serviceEnvPrefix(serviceName: string): string {
    return `${serviceName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
  }

  private async shouldPrefixSuggestedEnvKeys(
    _service: ServiceRow,
    keys: string[],
    opts: { targetProjectId?: string | null },
  ): Promise<boolean> {
    if (!opts.targetProjectId) {
      return true;
    }

    const targetKeys = await this.getProjectRuntimeEnvKeys(opts.targetProjectId);
    return keys.some((key) => targetKeys.has(key));
  }

  private async getProjectRuntimeEnvKeys(projectId: string): Promise<Set<string>> {
    const keys = new Set(Object.keys(await this.db.getEnvVars(projectId)));
    const deployables = await this.db.getDeployablesByGroup(projectId);
    for (const deployable of deployables) {
      const serviceEnv = await this.db.getEnvVarsForService(projectId, deployable.id);
      for (const key of Object.keys(serviceEnv)) {
        keys.add(key);
      }
    }
    return keys;
  }

  private tryParseCredentials(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Reconcile existing service containers to their owner network.
   * Project services use the project network. Orphan/internal managed services
   * stay on the shared OpenLander network. This keeps startup repair aligned
   * with the OpenLander 0.1 network-isolation model.
   */
  async reconcileServiceNetworks(): Promise<void> {
    const services = await this.db.listServices();
    let reconciled = 0;
    let migrated = 0;
    let alreadyConnected = 0;

    for (const service of services) {
      const containerRef = service.container_id ?? service.container_name ?? '';
      if (!containerRef) {
        continue;
      }

      reconciled += 1;

      try {
        const info = await this.runtime.inspectContainer(containerRef);

        if (!info.State.Running) {
          log.warn(
            { serviceId: service.id, serviceName: service.name, containerRef },
            'Service container is stopped — skipping network reconciliation',
          );
          continue;
        }

        const targetNetwork = await this.resolveServiceNetworkName(service);
        if (!targetNetwork) {
          log.warn(
            { serviceId: service.id, serviceName: service.name, projectId: service.project_id },
            'Service project missing — skipping network reconciliation',
          );
          continue;
        }

        if (targetNetwork !== SHARED_NETWORK_NAME) {
          await ensureManagedTraefikNetwork(this.runtime, targetNetwork);
        }

        const networks = info.NetworkSettings.Networks;
        const serviceNetwork = networks[targetNetwork];
        const aliasesRaw: unknown = serviceNetwork?.Aliases;
        const aliases: string[] = Array.isArray(aliasesRaw)
          ? aliasesRaw.filter((alias): alias is string => typeof alias === 'string')
          : [];
        const hasAlias = aliases.includes(service.name);

        if (!serviceNetwork) {
          await this.runtime.connectContainerToNetwork(info.Id, targetNetwork, [service.name]);
          migrated += 1;
          log.info(
            {
              serviceId: service.id,
              serviceName: service.name,
              containerId: info.Id,
              targetNetwork,
            },
            'Service network reconciled',
          );
        } else if (hasAlias) {
          alreadyConnected += 1;
          log.info(
            {
              serviceId: service.id,
              serviceName: service.name,
              containerId: info.Id,
              targetNetwork,
            },
            'Service already connected to target network with alias',
          );
        } else {
          await this.runtime.disconnectContainerFromNetwork(info.Id, targetNetwork);
          await this.runtime.connectContainerToNetwork(info.Id, targetNetwork, [service.name]);
          migrated += 1;
          log.info(
            {
              serviceId: service.id,
              serviceName: service.name,
              containerId: info.Id,
              targetNetwork,
            },
            'Service network alias reconciled',
          );
        }

        if (targetNetwork !== SHARED_NETWORK_NAME && networks[SHARED_NETWORK_NAME]) {
          await this.runtime.disconnectContainerFromNetwork(info.Id, SHARED_NETWORK_NAME);
        }
      } catch (err) {
        if (isDockerNotFoundError(err)) {
          log.warn(
            { err, serviceId: service.id, serviceName: service.name, containerRef },
            'Service container not found — skipping network reconciliation',
          );
          continue;
        }

        log.warn(
          { err, serviceId: service.id, serviceName: service.name, containerRef },
          'Failed to reconcile service network connection',
        );
      }
    }

    log.info(
      { reconciled, migrated, alreadyConnected },
      `Reconciled ${String(reconciled)} services: ${String(migrated)} migrated, ${String(alreadyConnected)} already connected`,
    );
  }

  private async resolveServiceNetworkName(service: ServiceRow): Promise<string | null> {
    if (service.project_id === ORPHAN_MANAGED_GROUP_ID) {
      return SHARED_NETWORK_NAME;
    }

    const project = await this.db.getProject(service.project_id);
    if (!project) {
      return null;
    }
    return await this.runtime.ensureProjectNetwork(project.name);
  }

  async create(opts: {
    name: string;
    template?: string;
    image?: string;
    port?: number;
    version?: string;
    envVars?: Array<{ key: string; value: string }>;
    network?: string;
    aliases?: string[];
  }): Promise<ServiceRow> {
    const hasTemplate = typeof opts.template === 'string';
    const hasImage = typeof opts.image === 'string';

    if (!hasTemplate && !hasImage) {
      throw new ServiceConfigError('Provide at least one of template or image');
    }

    const userEnv = this.toEnvPairs(opts.envVars);

    let type: string;
    let image: string;
    let port: number;
    let env: string[];
    let credentialsJson: string | undefined;
    let dataMountPath: string;
    let containerCmd: string[] | undefined;
    let containerHealthcheck: ServiceTemplate['healthcheck'] | undefined;

    if (hasTemplate) {
      const templateId = opts.template as string;
      const template = SERVICE_TEMPLATES[templateId];
      if (!template) {
        throw new ServiceConfigError(`Unsupported service template: ${templateId}`, {
          templateId,
        });
      }

      type = template.type;
      // Use provided version or default to first available version
      const version = opts.version ?? AVAILABLE_VERSIONS[templateId]?.[0] ?? 'latest';
      // If custom image is also provided, use it instead of the template default
      image = hasImage ? (opts.image as string) : template.image.replace(/:[^:]+$/, `:${version}`);
      port = template.port;
      dataMountPath = this.getDataMountPath(template.type);
      containerCmd = template.cmd;
      containerHealthcheck = template.healthcheck;

      if (template.type === 'redis') {
        env = [...userEnv];
        credentialsJson = JSON.stringify({
          host: this.getContainerName(opts.name),
          port,
          connectionString: this.getConnectionString(
            'redis',
            this.getContainerName(opts.name),
            port,
          ),
        });
      } else if (template.type === 'minio') {
        const user = 'openlander';
        const password = randomBytes(16).toString('hex');
        const containerName = this.getContainerName(opts.name);
        env = [...template.env({ user, password, database: '' }), ...userEnv];
        credentialsJson = JSON.stringify({
          host: containerName,
          port,
          user,
          password,
          connectionString: this.getConnectionString('minio', containerName, port),
        });
      } else {
        const containerName = this.getContainerName(opts.name);
        const credentials = this.buildCredentials(
          template.type as Exclude<BuiltInServiceType, 'redis' | 'minio'>,
          opts.name,
          containerName,
          port,
        );
        env = [...template.env(credentials), ...userEnv];
        credentialsJson = JSON.stringify(credentials);
      }
    } else {
      if (!opts.image) {
        throw new ServiceConfigError('image is required when template is not provided');
      }
      if (opts.port === undefined) {
        throw new ServiceConfigError('port is required when using custom image');
      }

      type = this.extractTypeFromImage(opts.image);
      image = opts.image;
      port = opts.port;
      env = userEnv;
      credentialsJson = undefined;
      dataMountPath = '/data';
      containerCmd = undefined;
    }

    if (!Number.isInteger(port) || port <= 0) {
      throw new ServiceConfigError(`Invalid service port: ${String(port)}`, { port });
    }

    const containerPort = port;
    // Given no explicit env context, use production port policy for services.
    const hostPort = await allocatePort(this.db, this.runtime, {}, 'production');

    const id = nanoid(12);
    const containerName = this.getContainerName(opts.name);
    const volumeName = this.getVolumeName(opts.name);

    let containerId: string | undefined;
    let volumeCreated = false;
    let persistenceStarted = false;
    let rollbackClean = true;
    try {
      await this.runtime.pullImage(image);

      await this.runtime.createVolume({
        name: volumeName,
        labels: {
          [DOCKER_LABELS.ROLE]: 'service',
          [DOCKER_LABELS.SERVICE]: opts.name,
        },
      });
      volumeCreated = true;

      const envRecord: Record<string, string> = {};
      for (const entry of env) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx > 0) {
          envRecord[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
        }
      }

      const memLimits = SERVICE_MEMORY_LIMITS[type] ?? {
        memoryLimitBytes: 536870912,
        cpuShares: 512,
      };

      containerId = await this.runtime.runServiceContainer({
        imageTag: image,
        name: containerName,
        port: containerPort,
        hostPort,
        envVars: envRecord,
        serviceName: opts.name,
        volumeBinds: [`${volumeName}:${dataMountPath}`],
        memoryLimitBytes: memLimits.memoryLimitBytes,
        cpuShares: memLimits.cpuShares,
        network: opts.network,
        aliases: opts.aliases,
        ...(containerHealthcheck ? { healthcheck: containerHealthcheck } : {}),
        ...(containerCmd ? { cmd: containerCmd } : {}),
      });

      persistenceStarted = true;
      await this.db.createService({
        id,
        name: opts.name,
        type,
        image,
        containerName,
        port: hostPort,
        credentials: credentialsJson,
      });

      await this.db.updateService(id, { status: 'running', containerId });
      this.invalidateServiceCardSummaryCache();
      const created = await this.db.getService(id);
      if (!created) {
        throw new RepoPersistenceError('service', id);
      }
      return created;
    } catch (err) {
      try {
        await this.db.deleteService(id);
      } catch (cleanupErr) {
        rollbackClean = false;
        log.warn({ err: cleanupErr, serviceId: id }, 'Failed to roll back managed service row');
      }
      if (containerId) {
        try {
          await this.runtime.safeRemoveContainer(containerId);
        } catch (cleanupErr) {
          rollbackClean = false;
          log.warn(
            { err: cleanupErr, containerId, containerName },
            'Failed to roll back managed service container',
          );
        }
      }
      if (volumeCreated) {
        try {
          await this.runtime.removeVolume(volumeName);
        } catch (cleanupErr) {
          rollbackClean = false;
          log.warn({ err: cleanupErr, volumeName }, 'Failed to roll back managed service volume');
        }
      }
      if (!persistenceStarted && isDockerContainerNameConflictError(err)) {
        throw new ManagedServiceNameConflictError(opts.name, {
          containerName,
          volumeName,
          volumeRolledBack: volumeCreated ? rollbackClean : true,
        });
      }
      if (persistenceStarted && containerId && volumeCreated && rollbackClean) {
        throw new ManagedServicePersistenceCleanedError(opts.name, {
          serviceId: id,
          containerName,
          volumeName,
          hostPort,
          originalError: err,
        });
      }
      throw err;
    } finally {
      clearPortScanCache();
      releasePortReservation(hostPort);
    }
  }

  async start(id: string): Promise<void> {
    const service = await this.db.getService(id);
    if (!service) {
      throw new ServiceNotFoundError(id);
    }

    const containerId = service.container_id ?? service.container_name ?? '';
    await this.runtime.startContainer(containerId);
    await this.db.updateService(id, { status: 'running' });
    this.invalidateServiceCardSummaryCache();
  }

  async stop(id: string): Promise<void> {
    const service = await this.db.getService(id);
    if (!service) {
      throw new ServiceNotFoundError(id);
    }

    const containerId = service.container_id ?? service.container_name ?? '';
    await this.runtime.stopContainer(containerId);
    await this.db.updateService(id, { status: 'stopped' });
    this.invalidateServiceCardSummaryCache();
  }

  async remove(
    id: string,
    options?: { force?: boolean },
  ): Promise<{ warning?: string; connected_projects?: Array<{ id: string; name: string }> }> {
    const service = await this.db.getService(id);
    if (!service) {
      throw new ServiceNotFoundError(id);
    }

    // Check for connected projects before deletion
    const connectedProjects = await this.getConnectedProjects(id);
    let warning: string | undefined;
    if (connectedProjects.length > 0) {
      if (!options?.force) {
        throw new ServiceInUseError(service.name, connectedProjects);
      }
      const projectNames = connectedProjects.map((p) => p.name).join(', ');
      const count = String(connectedProjects.length);
      warning = `Service "${service.name}" is connected to ${count} project(s): ${projectNames}. These projects may fail to start if they depend on this service.`;
    }

    const containerId = service.container_id ?? service.container_name;
    if (containerId) {
      try {
        await this.runtime.stopContainer(containerId);
      } catch (error) {
        if (!isDockerNotFoundError(error)) {
          throw error;
        }
      }
      try {
        await this.runtime.safeRemoveContainer(containerId);
      } catch (error) {
        if (!isDockerNotFoundError(error)) {
          throw error;
        }
      }
    }

    const volumeName = this.getVolumeName(service.name);
    await this.runtime.removeVolume(volumeName);

    await this.db.deleteService(id);
    this.invalidateServiceCardSummaryCache();

    return {
      ...(warning && { warning }),
      ...(connectedProjects.length > 0 && { connected_projects: connectedProjects }),
    };
  }

  async backup(id: string): Promise<{ backupId: string; path: string; size: number }> {
    const service = await this.getRequiredService(id);
    const volumeName = this.getVolumeName(service.name);
    const backupDir = this.getBackupDir();
    const backupId = `${service.name}-${String(Date.now())}`;
    const backupFilename = `${backupId}.tar.gz`;
    const backupPath = join(backupDir, backupFilename);
    const backupMount = this.getBackupStorageMount('readwrite');

    mkdirSync(backupDir, { recursive: true });

    // Redis: flush in-memory data to disk (BGSAVE) before volume backup.
    // Without this, the RDB dump file may not exist or be stale, leading to empty backups.
    const isRedis = service.kind === 'redis' || (service.image_url ?? '').includes('redis');
    if (isRedis) {
      try {
        const initialResult = await execInServiceContainer(this.runtime, service, [
          'redis-cli',
          'LASTSAVE',
        ]);
        const initialTimestamp = initialResult.stdout.trim();

        await execInServiceContainer(this.runtime, service, ['redis-cli', 'BGSAVE']);

        // Poll LASTSAVE until timestamp changes (max 30s, 1s interval)
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await sleep(1000);
          const currentResult = await execInServiceContainer(this.runtime, service, [
            'redis-cli',
            'LASTSAVE',
          ]);
          if (currentResult.stdout.trim() !== initialTimestamp) {
            log.info(`Redis BGSAVE completed for service ${service.id}`);
            break;
          }
          if (attempt === 29) {
            log.warn(
              `Redis BGSAVE did not complete within 30s for service ${service.id}, proceeding with backup`,
            );
          }
        }
      } catch (error) {
        log.warn(
          `Redis BGSAVE failed for service ${service.id}, proceeding with backup: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await this.runtime.pullImage('alpine');

    const backupContainerId = await this.runtime.runInfraContainer({
      Image: 'alpine',
      Cmd: ['tar', 'czf', `${backupMount.containerDir}/${backupFilename}`, '-C', '/data', '.'],
      HostConfig: {
        Binds: [`${volumeName}:/data:ro`, backupMount.bind],
        AutoRemove: true,
      },
    });

    const { StatusCode: backupExitCode } = await this.runtime.waitForContainer(backupContainerId);
    if (backupExitCode !== 0) {
      throw new ServiceOperationError(
        'backup',
        `Backup failed with exit code ${String(backupExitCode)} for service: ${service.id}`,
        { serviceId: service.id, exitCode: backupExitCode },
      );
    }

    if (!existsSync(backupPath)) {
      throw new ServiceOperationError(
        'backup',
        `Backup file not found after backup: ${backupPath}`,
        { backupPath },
      );
    }
    const size = statSync(backupPath).size;

    return { backupId, path: backupPath, size };
  }

  async restore(id: string, backupId: string): Promise<void> {
    const service = await this.getRequiredService(id);
    const backupDir = this.getBackupDir();
    const backupFilename = `${backupId}.tar.gz`;
    const backupPath = join(backupDir, backupFilename);
    if (!existsSync(backupPath)) {
      throw new ServiceOperationError('restore', `Backup not found: ${backupPath}`, {
        backupId,
        backupPath,
      });
    }

    const volumeName = this.getVolumeName(service.name);
    const backupMount = this.getBackupStorageMount('readonly');
    await this.stop(id);

    try {
      await this.runtime.pullImage('alpine');

      const restoreContainerId = await this.runtime.runInfraContainer({
        Image: 'alpine',
        Cmd: [
          'sh',
          '-c',
          `rm -rf /data/* && tar xzf ${shellQuote(`${backupMount.containerDir}/${backupFilename}`)} -C /data`,
        ],
        HostConfig: {
          Binds: [`${volumeName}:/data`, backupMount.bind],
          AutoRemove: true,
        },
      });

      const { StatusCode: restoreExitCode } =
        await this.runtime.waitForContainer(restoreContainerId);
      if (restoreExitCode !== 0) {
        throw new ServiceOperationError(
          'restore',
          `Restore failed with exit code ${String(restoreExitCode)} for service: ${service.id}`,
          { serviceId: service.id, exitCode: restoreExitCode },
        );
      }
    } finally {
      await this.start(id);
    }
  }

  async listBackups(
    id: string,
  ): Promise<Array<{ backupId: string; createdAt: Date; sizeBytes: number }>> {
    const service = await this.getRequiredService(id);
    const backupDir = this.getBackupDir();
    if (!existsSync(backupDir)) {
      return [];
    }

    const prefix = `${service.name}-`;
    const entries = readdirSync(backupDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.tar.gz'))
      .map((name) => {
        const backupId = name.slice(0, -'.tar.gz'.length);
        const timestampRaw = backupId.slice(prefix.length);
        const timestamp = Number.parseInt(timestampRaw, 10);
        const stats = statSync(join(backupDir, name));
        return {
          backupId,
          createdAt: Number.isFinite(timestamp) ? new Date(timestamp) : stats.mtime,
          sizeBytes: stats.size,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return entries;
  }

  async list(): Promise<ServiceRow[]> {
    const services = await this.db.listServices();

    await Promise.all(
      services.map(async (service) => {
        const inspection = await this.inspectServiceContainer(service);
        await this.syncServiceStateFromInspection(service, inspection);
      }),
    );

    return this.db.listServices();
  }

  async getDetail(id: string): Promise<ServiceRow> {
    const service = await this.getRequiredService(id);

    if (!service.container_id && !service.container_name) {
      if (service.status !== 'error') {
        await this.db.updateService(service.id, { status: 'error' });
        log.warn({ serviceId: service.id }, 'Service has no container reference, marking as error');
      }
      const refreshed = await this.db.getService(id);
      if (!refreshed) {
        throw new ServiceNotFoundError(id);
      }
      return refreshed;
    }

    const containerId = service.container_id ?? service.container_name ?? '';
    try {
      const info = await this.runtime.inspectContainer(containerId);
      const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
      const containerIdFromDocker = info.Id;

      if (status !== service.status || containerIdFromDocker !== service.container_id) {
        await this.db.updateService(service.id, { status, containerId: containerIdFromDocker });
      }
    } catch (err) {
      log.warn({ err, serviceId: service.id, containerId }, 'Failed to inspect service container');
      if (service.status !== 'error') {
        await this.db.updateService(service.id, { status: 'error' });
      }
    }

    const refreshed = await this.db.getService(id);
    if (!refreshed) {
      throw new ServiceNotFoundError(id);
    }
    return refreshed;
  }

  async getLogs(id: string, lines = 100): Promise<string> {
    const service = await this.getRequiredService(id);
    const tail = Number.isInteger(lines) && lines > 0 ? lines : 100;
    const containerId = service.container_id ?? service.container_name ?? '';
    return this.runtime.getLogs(containerId, tail);
  }

  async exec(id: string, command: string[], options?: ExecOptions): Promise<ContainerExecResult> {
    const service = await this.getRequiredService(id);
    await this.ensureServiceContainerRunning(service);
    return execInServiceContainer(this.runtime, service, command, {
      throwOnNonZeroExit: false,
      ...options,
    });
  }

  async getStats(id: string): Promise<{
    status: ServiceRow['status'];
    diskUsageBytes: number | null;
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
    memoryLimitBytes: number | null;
    activeConnections: number | null;
    maxConnections: number | null;
  }> {
    const service = await this.getDetail(id);
    const runtimeStats = await this.collectRuntimeStats(service);

    return {
      status: service.status,
      ...runtimeStats,
    };
  }

  /**
   * Phase E_NEW Task 5 — recorder hook for the v4 service detail
   * sparkline. Called from `ServiceHealthMonitor.runServiceCheck` on
   * each tick (default cadence 30s) so the time-series in
   * `service_metrics` accumulates one sample per service per tick.
   * Pure no-op for non-running services; we don't want to pollute the
   * sparkline with zero rows just because the container isn't up.
   *
   * `req` (requests/sec) and `err` (error rate %) are not yet sourced —
   * the deploy pipeline doesn't surface per-service request counters
   * today. We persist `0` for both rather than `null` because the
   * sparkline is happier with zeros than with gaps; the contract is
   * unchanged. p95 and request_count similarly default to null/0
   * until a request-counting layer lands (post-1.0 follow-up).
   */
  async recordMetricSample(serviceId: string): Promise<void> {
    const service = await this.db.getService(serviceId);
    if (!service || service.status !== 'running') {
      return;
    }

    const runtime = await this.collectRuntimeStats(service);
    const memMb =
      runtime.memoryUsageBytes !== null
        ? Math.round((runtime.memoryUsageBytes / (1024 * 1024)) * 10) / 10
        : 0;

    await this.db.recordServiceMetricSample({
      serviceId,
      recordedAt: Date.now(),
      cpu: runtime.cpuPercent ?? 0,
      mem: memMb,
      // Mirrors recordMetricSample's placeholder counters. If req/err
      // become real metrics, revisit this lightweight path so topology
      // samples do not dilute service-detail sparklines.
      req: 0,
      err: 0,
      p95LatencyMs: null,
      requestCount: 0,
    });
  }

  /**
   * Lightweight recorder for topology/project summaries. Unlike
   * recordMetricSample(), this path only reads Docker stats and avoids
   * disk usage (`du`) plus adapter probes so the health monitor can keep
   * CPU/memory samples fresher than the topology stale window.
   */
  async recordLightweightMetricSample(serviceId: string): Promise<void> {
    const service = await this.db.getService(serviceId);
    if (!service || service.status !== 'running') {
      return;
    }

    const runtime = await this.collectContainerUsageStats(service);
    if (runtime.cpuPercent === null && runtime.memoryUsageBytes === null) {
      return;
    }

    const memMb =
      runtime.memoryUsageBytes !== null
        ? Math.round((runtime.memoryUsageBytes / (1024 * 1024)) * 10) / 10
        : 0;

    await this.db.recordServiceMetricSample({
      serviceId,
      recordedAt: Date.now(),
      cpu: runtime.cpuPercent ?? 0,
      mem: memMb,
      req: 0,
      err: 0,
      p95LatencyMs: null,
      requestCount: 0,
    });
  }

  /**
   * Phase E_NEW Task 4 — minimal Docker inspect projection used by
   * `GET /api/services/:id/health`. Reads the same source that the
   * card-summary path reads (`info.State.Health?.Status`) and returns
   * the raw `(status, healthStatus)` pair so the route can project
   * onto the v4 3-state vocabulary (`healthy | crashed | running`).
   *
   * `healthStatus` is `null` when the container does not declare a
   * Docker `HEALTHCHECK`; we only return strings exactly as Docker
   * reports them (`'healthy'`, `'unhealthy'`, `'starting'`).
   */
  async getInspectionHealth(id: string): Promise<{
    status: ServiceRow['status'];
    healthStatus: string | null;
  }> {
    const service = await this.getRequiredService(id);
    const inspection = await this.inspectServiceContainer(service);
    return { status: inspection.status, healthStatus: inspection.healthStatus };
  }

  /**
   * Card-summary listing with cached Docker inspect+health for each service.
   *
   * `kindIn`: when provided, filter services BEFORE the Docker fan-out so we
   * don't waste inspect work on rows the caller will discard. Backs the
   * managed-service API (~10 infrastructure rows) instead of all 30+ services
   * (CCG perf finding #1, Codex 2026-04-30).
   *
   * The cache is keyed on the filter so a future "all services" caller
   * doesn't get a managed-only payload back from a stale entry.
   */
  async listWithCardSummary(opts?: {
    kindIn?: readonly ServiceRow['kind'][];
  }): Promise<ServiceCardSummary[]> {
    const kindIn = opts?.kindIn ?? null;
    const cacheKey = kindIn ? `kinds:${[...kindIn].sort().join(',')}` : 'all';
    const cachedEntry = this.serviceCardSummaryCache;
    if (cachedEntry && cachedEntry.key === cacheKey && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.data;
    }

    if (this.serviceCardSummaryInFlight && this.serviceCardSummaryInFlight.key === cacheKey) {
      return this.serviceCardSummaryInFlight.promise;
    }

    const epoch = this.serviceCardSummaryEpoch;
    const loadPromise = (async () => {
      const allServices = await this.db.listServices();
      const services = kindIn
        ? allServices.filter((s) => (kindIn as readonly string[]).includes(s.kind))
        : allServices;
      const summaries = await Promise.all(
        services.map(async (service) => {
          const inspection = await this.inspectServiceContainer(service);
          await this.syncServiceStateFromInspection(service, inspection);

          return {
            ...service,
            status: inspection.status,
            container_id: inspection.containerId ?? service.container_id,
            summary: {
              healthStatus: inspection.healthStatus,
              uptimeSeconds: this.computeUptimeSeconds(inspection.startedAt, inspection.status),
              restartCount: inspection.restartCount,
            },
          };
        }),
      );

      if (this.serviceCardSummaryEpoch === epoch) {
        this.serviceCardSummaryCache = {
          key: cacheKey,
          expiresAt: Date.now() + SERVICE_CARD_SUMMARY_CACHE_TTL_MS,
          data: summaries,
        };
      }

      return summaries;
    })();

    this.serviceCardSummaryInFlight = { key: cacheKey, promise: loadPromise };

    try {
      return await loadPromise;
    } finally {
      // Race guard: clear in-flight only if it still points at this load.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.serviceCardSummaryInFlight?.promise === loadPromise) {
        this.serviceCardSummaryInFlight = null;
      }
    }
  }

  private async inspectServiceContainer(service: ServiceRow): Promise<{
    status: ServiceRow['status'];
    containerId: string | null;
    healthStatus: string | null;
    startedAt: string | null;
    restartCount: number | null;
  }> {
    if (!service.container_id && !service.container_name) {
      log.warn({ serviceId: service.id }, 'Service has no container reference, marking as error');
      return {
        status: 'error',
        containerId: null,
        healthStatus: null,
        startedAt: null,
        restartCount: null,
      };
    }

    const containerRef = service.container_id ?? service.container_name ?? '';
    try {
      const info = await this.runtime.inspectContainer(containerRef);
      const status: ServiceRow['status'] = info.State.Restarting
        ? 'error'
        : info.State.Running
          ? 'running'
          : 'stopped';
      const healthRaw: unknown = info.State.Health?.Status;
      const startedAtRaw: unknown = info.State.StartedAt;
      const restartCountRaw: unknown = info.RestartCount;

      return {
        status,
        containerId: info.Id,
        healthStatus: typeof healthRaw === 'string' ? healthRaw : null,
        startedAt: typeof startedAtRaw === 'string' ? startedAtRaw : null,
        restartCount: typeof restartCountRaw === 'number' ? restartCountRaw : null,
      };
    } catch (err) {
      log.warn(
        { err, serviceId: service.id, containerId: containerRef },
        'Failed to inspect service container',
      );
      return {
        status: 'error',
        containerId: service.container_id ?? null,
        healthStatus: null,
        startedAt: null,
        restartCount: null,
      };
    }
  }

  private async syncServiceStateFromInspection(
    service: ServiceRow,
    inspection: { status: ServiceRow['status']; containerId: string | null },
  ): Promise<void> {
    if (inspection.status !== service.status || inspection.containerId !== service.container_id) {
      await this.db.updateService(service.id, {
        status: inspection.status,
        containerId: inspection.containerId,
      });
    }
  }

  private computeUptimeSeconds(
    startedAt: string | null,
    status: ServiceRow['status'],
  ): number | null {
    if (!startedAt || status !== 'running') {
      return null;
    }
    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
      return null;
    }
    const elapsed = Math.floor((Date.now() - startedAtMs) / 1000);
    return elapsed >= 0 ? elapsed : null;
  }

  private async collectRuntimeStats(service: ServiceRow): Promise<{
    diskUsageBytes: number | null;
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
    memoryLimitBytes: number | null;
    activeConnections: number | null;
    maxConnections: number | null;
  }> {
    if (service.status !== 'running') {
      return {
        diskUsageBytes: null,
        cpuPercent: null,
        memoryUsageBytes: null,
        memoryLimitBytes: null,
        activeConnections: null,
        maxConnections: null,
      };
    }

    let diskUsageBytes: number | null = null;
    try {
      const dataMountPath = this.getDataMountPath(service.kind);
      const result = await execInServiceContainer(this.runtime, service, [
        'du',
        '-sb',
        dataMountPath,
      ]);
      const usageRaw = result.stdout.trim().split(/\s+/)[0] ?? '';
      const parsed = Number.parseInt(usageRaw, 10);
      if (Number.isFinite(parsed)) {
        diskUsageBytes = parsed;
      }
    } catch {
      // disk usage unavailable — non-fatal
    }

    let cpuPercent: number | null = null;
    let memoryUsageBytes: number | null = null;
    let memoryLimitBytes: number | null = null;
    const usageStats = await this.collectContainerUsageStats(service);
    cpuPercent = usageStats.cpuPercent;
    memoryUsageBytes = usageStats.memoryUsageBytes;
    memoryLimitBytes = usageStats.memoryLimitBytes;

    let activeConnections: number | null = null;
    let maxConnections: number | null = null;
    try {
      const adapter = getServiceAdapter(service.kind);
      if (adapter) {
        const connectionStats = await adapter.getConnectionStats(service, this.runtime);
        activeConnections = connectionStats.activeConnections;
        maxConnections = connectionStats.maxConnections;
      }
    } catch {
      // connection stats unavailable — non-fatal
    }

    return {
      diskUsageBytes,
      cpuPercent,
      memoryUsageBytes,
      memoryLimitBytes,
      activeConnections,
      maxConnections,
    };
  }

  private async collectContainerUsageStats(service: ServiceRow): Promise<ContainerUsageStats> {
    if (service.status !== 'running') {
      return { cpuPercent: null, memoryUsageBytes: null, memoryLimitBytes: null };
    }

    try {
      const containerId = service.container_id ?? service.container_name ?? '';
      if (!containerId) {
        return { cpuPercent: null, memoryUsageBytes: null, memoryLimitBytes: null };
      }
      const rawStats = (await this.runtime.getContainerStats(containerId)) as {
        cpu_stats?: {
          cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
          system_cpu_usage?: number;
          online_cpus?: number;
        };
        precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
        memory_stats?: { usage?: number; limit?: number };
      };
      const totalUsage = rawStats.cpu_stats?.cpu_usage?.total_usage;
      const previousTotalUsage = rawStats.precpu_stats?.cpu_usage?.total_usage;
      const systemUsage = rawStats.cpu_stats?.system_cpu_usage;
      const previousSystemUsage = rawStats.precpu_stats?.system_cpu_usage;
      const percpuUsage = rawStats.cpu_stats?.cpu_usage?.percpu_usage;
      const numCpus = percpuUsage?.length ?? rawStats.cpu_stats?.online_cpus ?? 1;
      let cpuPercent: number | null = null;
      if (
        totalUsage !== undefined &&
        previousTotalUsage !== undefined &&
        systemUsage !== undefined &&
        previousSystemUsage !== undefined
      ) {
        const cpuDelta = totalUsage - previousTotalUsage;
        const systemDelta = systemUsage - previousSystemUsage;
        cpuPercent =
          systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * numCpus * 100 * 10) / 10 : 0;
      }

      return {
        cpuPercent,
        memoryUsageBytes: rawStats.memory_stats?.usage ?? null,
        memoryLimitBytes: rawStats.memory_stats?.limit ?? null,
      };
    } catch {
      return { cpuPercent: null, memoryUsageBytes: null, memoryLimitBytes: null };
    }
  }

  async getProjectServices(projectId: string): Promise<ServiceRow[]> {
    const allValues = (await this.collectEnvValuesForProject(projectId)).join(' ');
    const services = await this.db.listServices();
    return services.filter((s) => s.container_name != null && allValues.includes(s.container_name));
  }

  private async collectEnvValuesForProject(projectId: string): Promise<string[]> {
    const values = Object.values(await this.db.getEnvVars(projectId));
    const environments = await this.db.getEnvironmentsByProject(projectId);
    for (const env of environments) {
      values.push(...Object.values(await this.db.getEnvVars(projectId, env.id)));
    }
    const deployables = await this.db.getDeployablesByGroup(projectId);
    for (const deployable of deployables) {
      values.push(...Object.values(await this.db.getEnvVarsForService(projectId, deployable.id)));
    }
    return values;
  }

  async getConnectedProjects(serviceId: string): Promise<Array<{ id: string; name: string }>> {
    await this.getRequiredService(serviceId);
    const connections = await this.db.listServiceConsumersForProvider(serviceId);
    if (connections.length === 0) return [];

    const consumerIds = new Set(connections.map((connection) => connection.service_id_consumer));
    const projectIds = new Set<string>();
    const unresolvedConsumerIds = new Set<string>();

    for (const consumerId of consumerIds) {
      if (consumerId.endsWith('__svc')) {
        projectIds.add(consumerId.replace(/__svc$/, ''));
      } else {
        unresolvedConsumerIds.add(consumerId);
      }
    }

    if (unresolvedConsumerIds.size > 0) {
      const services = await this.db.listServices();
      for (const service of services) {
        if (unresolvedConsumerIds.has(service.id)) {
          projectIds.add(service.project_id);
          unresolvedConsumerIds.delete(service.id);
        }
      }
      for (const consumerId of unresolvedConsumerIds) {
        projectIds.add(consumerId);
      }
    }

    const projects = await this.db.listProjects(null, { includeArchived: true });
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const connected: Array<{ id: string; name: string }> = [];
    for (const projectId of projectIds) {
      const project = projectsById.get(projectId);
      if (project) {
        connected.push({ id: project.id, name: project.name });
      }
    }
    return connected;
  }

  async listDatabases(serviceId: string): Promise<ListedDatabase[]> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const serviceKind = service.kind;
    const adapter = getServiceAdapter(serviceKind);
    if (!adapter) {
      throw new ServiceOperationUnsupportedError('Database listing', serviceKind);
    }

    return adapter.listDatabases(service, this.runtime);
  }

  async listUsers(serviceId: string): Promise<ListedUser[]> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const serviceKind = service.kind;
    const adapter = getServiceAdapter(serviceKind);
    if (!adapter) {
      throw new ServiceOperationUnsupportedError('User listing', serviceKind);
    }

    return adapter.listUsers(service, this.runtime);
  }

  async createDatabase(serviceId: string, dbName: string): Promise<CreateDatabaseResult> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    assertSafeDatabaseName(dbName);

    const serviceKind = service.kind;
    const adapter = getServiceAdapter(serviceKind);
    if (!adapter) {
      throw new ServiceOperationUnsupportedError('Database creation', serviceKind);
    }

    return adapter.createDatabase(service, dbName, this.runtime);
  }

  async createUser(
    serviceId: string,
    username: string,
    password?: string,
    grants?: { database: string },
  ): Promise<CreateUserResult> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    assertSafeUserName(username);

    const userPassword = password ?? randomBytes(16).toString('hex');
    if (grants?.database) {
      assertSafeDatabaseName(grants.database);
    }

    const serviceKind = service.kind;
    const adapter = getServiceAdapter(serviceKind);
    if (!adapter) {
      throw new ServiceOperationUnsupportedError('User creation', serviceKind);
    }

    return adapter.createUser(service, { username, password: userPassword, grants }, this.runtime);
  }

  async listBuckets(serviceId: string): Promise<Array<{ name: string; createdAt: string }>> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const serviceKind = service.kind;
    if (serviceKind !== 'minio') {
      throw new ServiceOperationUnsupportedError('Bucket operations (MinIO only)', serviceKind);
    }

    const adapter = new MinioAdapter();
    return adapter.listBuckets(service, this.runtime);
  }

  async createBucket(serviceId: string, bucketName: string): Promise<void> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const serviceKind = service.kind;
    if (serviceKind !== 'minio') {
      throw new ServiceOperationUnsupportedError('Bucket operations (MinIO only)', serviceKind);
    }

    const adapter = new MinioAdapter();
    return adapter.createBucket(service, this.runtime, bucketName);
  }

  async deleteBucket(serviceId: string, bucketName: string): Promise<void> {
    const service = await this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const serviceKind = service.kind;
    if (serviceKind !== 'minio') {
      throw new ServiceOperationUnsupportedError('Bucket operations (MinIO only)', serviceKind);
    }

    const adapter = new MinioAdapter();
    return adapter.deleteBucket(service, this.runtime, bucketName);
  }

  private getContainerName(name: string): string {
    return serviceContainerName(name);
  }

  private getVolumeName(name: string): string {
    return serviceVolumeName(name);
  }

  private getBackupDir(): string {
    return join(this.dataDir, 'backups');
  }

  private getBackupStorageMount(mode: 'readwrite' | 'readonly'): BackupStorageMount {
    if (isTruthyEnv(process.env.OPENLANDER_CONTAINERIZED)) {
      const dataVolume =
        process.env.OPENLANDER_DATA_VOLUME?.trim() || DEFAULT_CONTAINERIZED_DATA_VOLUME;
      return {
        bind:
          mode === 'readonly'
            ? `${dataVolume}:${CONTAINERIZED_DATA_MOUNT}:ro`
            : `${dataVolume}:${CONTAINERIZED_DATA_MOUNT}`,
        containerDir: `${CONTAINERIZED_DATA_MOUNT}/backups`,
      };
    }

    const backupDir = this.getBackupDir();
    return {
      bind: mode === 'readonly' ? `${backupDir}:/backup:ro` : `${backupDir}:/backup`,
      containerDir: '/backup',
    };
  }

  private getDataMountPath(type: string): string {
    const adapter = getServiceAdapter(type);
    if (!adapter) {
      return '/data';
    }

    return adapter.getDataMountPath();
  }

  private buildCredentials(
    type: Exclude<BuiltInServiceType, 'redis' | 'minio'>,
    name: string,
    containerName: string,
    port: number,
  ): {
    user: string;
    password: string;
    database: string;
    connectionString: string;
    host: string;
    port: number;
  } {
    const user = 'openlander';
    const password = randomBytes(16).toString('hex');
    const database = this.toDatabaseName(name);

    return {
      user,
      password,
      database,
      host: containerName,
      port,
      connectionString: this.getConnectionString(type, containerName, port, {
        user,
        password,
        database,
      }),
    };
  }

  private getConnectionString(
    type: BuiltInServiceType,
    containerName: string,
    port: number,
    creds?: { user: string; password: string; database: string },
  ): string {
    const adapter = getServiceAdapter(type);
    if (!adapter) {
      throw new ServiceOperationUnsupportedError('Connection string', type);
    }

    return adapter.getConnectionString(containerName, port, creds);
  }

  private toDatabaseName(name: string): string {
    const normalized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    return normalized.length > 0 ? normalized : 'openlander';
  }

  private toEnvPairs(envVars?: Array<{ key: string; value: string }>): string[] {
    if (!envVars) {
      return [];
    }

    return envVars.map(({ key, value }) => `${key}=${value}`);
  }

  private extractTypeFromImage(image: string): string {
    const imageWithoutDigest = image.split('@')[0] ?? image;
    const imageNameWithTag = imageWithoutDigest.split('/').pop() ?? imageWithoutDigest;
    const imageName = imageNameWithTag.split(':')[0] ?? imageNameWithTag;
    const normalized = imageName.trim().toLowerCase();

    return normalized.length > 0 ? normalized : 'custom';
  }

  private async getRequiredService(serviceId: string): Promise<ServiceRow> {
    const service = await this.db.getService(serviceId);
    if (!service) {
      throw new ServiceNotFoundError(serviceId);
    }
    return service;
  }

  private async ensureServiceContainerRunning(service: ServiceRow): Promise<void> {
    const containerId = service.container_id ?? service.container_name ?? '';
    try {
      const info = await this.runtime.inspectContainer(containerId);
      if (!info.State.Running) {
        throw new ServiceContainerStateError(
          service.id,
          'stopped',
          `Service container is not running: ${service.id}`,
        );
      }
    } catch (error) {
      if (error instanceof ServiceContainerStateError) {
        throw error;
      }
      if (isDockerNotFoundError(error)) {
        throw new ServiceContainerStateError(
          service.id,
          'missing',
          `Service container not found: ${service.id}`,
        );
      }
      throw error;
    }
  }
}
