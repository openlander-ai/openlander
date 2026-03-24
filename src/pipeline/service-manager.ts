import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { nanoid } from 'nanoid';

import { getDataDir, getPolicy } from '../config/index.js';
import type { Database, ServiceRow } from '../db/index.js';
import { createModuleLogger } from '../lib/logger.js';
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
} from './service-adapters/shared.js';
import type { Docker } from './docker.js';
import { allocatePort } from './port.js';

const log = createModuleLogger('service-manager');

export const AVAILABLE_VERSIONS: Record<string, string[]> = {
  postgresql: ['17-alpine', '16-alpine', '15-alpine', '14-alpine'],
  mysql: ['9', '8'],
  redis: ['8-alpine', '7-alpine'],
  mongodb: ['8', '7'],
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

export const SERVICE_TEMPLATES: Record<string, ServiceTemplate> = {
  postgresql: {
    type: 'postgresql',
    image: 'postgres:16-alpine',
    port: 5432,
    env: (c) => [
      `POSTGRES_USER=${c.user}`,
      `POSTGRES_PASSWORD=${c.password}`,
      `POSTGRES_DB=${c.database}`,
    ],
  },
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
  mongodb: {
    type: 'mongodb',
    image: 'mongo:7',
    port: 27017,
    env: (c) => [
      `MONGO_INITDB_ROOT_USERNAME=${c.user}`,
      `MONGO_INITDB_ROOT_PASSWORD=${c.password}`,
    ],
  },
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

/**
 * Standard env var key for each built-in service type.
 * First service of a type gets the standard key; subsequent ones are prefixed.
 */
const DEFAULT_ENV_KEYS: Record<string, string> = {
  postgresql: 'DATABASE_URL',
  mysql: 'DATABASE_URL',
  redis: 'REDIS_URL',
  mongodb: 'MONGODB_URL',
  minio: 'S3_ENDPOINT',
  rabbitmq: 'RABBITMQ_URL',
};

export class ServiceManager {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly dataDir: string = getDataDir(),
  ) {}

  /**
   * Compute suggested env var(s) for a newly created service so the agent
   * can auto-link it to a project via set_env_vars.
   *
   * Rules:
   *  - First service of a type → standard key (DATABASE_URL, REDIS_URL, …)
   *  - Subsequent services of the same type → prefixed key (e.g. MYDB_DATABASE_URL)
   */
  getSuggestedEnv(service: ServiceRow): Array<{ key: string; value: string }> {
    const baseKey = DEFAULT_ENV_KEYS[service.type];
    if (!baseKey) {
      return [];
    }

    const credentials = service.credentials ? this.tryParseCredentials(service.credentials) : null;
    const connectionString = (credentials?.['connectionString'] as string | undefined) ?? null;
    if (!connectionString) {
      return [];
    }

    const existing = this.db
      .listServices()
      .filter((s) => s.type === service.type && s.id !== service.id);

    if (service.type === 'minio') {
      const user = (credentials?.['user'] as string | undefined) ?? '';
      const password = (credentials?.['password'] as string | undefined) ?? '';
      const prefix =
        existing.length === 0 ? '' : `${service.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
      return [
        { key: `${prefix}S3_ENDPOINT`, value: connectionString },
        { key: `${prefix}AWS_ACCESS_KEY_ID`, value: user },
        { key: `${prefix}AWS_SECRET_ACCESS_KEY`, value: password },
      ];
    }

    const key =
      existing.length === 0
        ? baseKey
        : `${service.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${baseKey}`;

    return [{ key, value: connectionString }];
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

  async create(opts: {
    name: string;
    template?: string;
    image?: string;
    port?: number;
    version?: string;
    envVars?: Array<{ key: string; value: string }>;
  }): Promise<ServiceRow> {
    const hasTemplate = typeof opts.template === 'string';
    const hasImage = typeof opts.image === 'string';

    if (hasTemplate === hasImage) {
      throw new Error('Provide exactly one of template or image');
    }

    const userEnv = this.toEnvPairs(opts.envVars);
    const userEnvJson = opts.envVars ? JSON.stringify(opts.envVars) : undefined;

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
        throw new Error(`Unsupported service template: ${templateId}`);
      }

      type = template.type;
      // Use provided version or default to first available version
      const version = opts.version ?? AVAILABLE_VERSIONS[templateId]?.[0] ?? 'latest';
      image = template.image.replace(/:[^:]+$/, `:${version}`);
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
        throw new Error('image is required when template is not provided');
      }
      if (opts.port === undefined) {
        throw new Error('port is required when using custom image');
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
      throw new Error(`Invalid service port: ${String(port)}`);
    }

    const containerPort = port;
    // Given no explicit env context, use production port policy for services.
    const hostPort = await allocatePort(this.db, this.docker, {}, 'production');

    const id = nanoid(12);
    const containerName = this.getContainerName(opts.name);
    const volumeName = this.getVolumeName(opts.name);

    await this.docker.pullImage(image);

    const client = this.docker.getClient();
    await client.createVolume({
      Name: volumeName,
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'service',
        'openlander.service': opts.name,
      },
    });

    const container = await client.createContainer({
      Image: image,
      name: containerName,
      Env: env,
      ...(containerCmd ? { Cmd: containerCmd } : {}),
      ...(containerHealthcheck
        ? {
            Healthcheck: {
              Test: containerHealthcheck.test,
              Interval: containerHealthcheck.interval * 1_000_000_000,
              Timeout: containerHealthcheck.timeout * 1_000_000_000,
              Retries: containerHealthcheck.retries,
              StartPeriod: containerHealthcheck.startPeriod * 1_000_000_000,
            },
          }
        : {}),
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'service',
        'openlander.service': opts.name,
      },
      ExposedPorts: {
        [`${String(containerPort)}/tcp`]: {},
      },
      HostConfig: {
        NetworkMode: this.docker.getNetworkName(),
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [`${volumeName}:${dataMountPath}`],
        PortBindings: {
          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
        },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
    });

    await container.start();

    const primaryNetwork = this.docker.getNetworkName();
    const prodNetwork = getPolicy('production').networkName;
    const devNetwork = getPolicy('development').networkName;
    const secondaryNetwork = primaryNetwork === prodNetwork ? devNetwork : prodNetwork;
    try {
      const client = this.docker.getClient();
      await client.getNetwork(secondaryNetwork).connect({ Container: container.id });
    } catch (err) {
      log.warn(
        { err, secondaryNetwork, containerName },
        'Failed to connect service to secondary network',
      );
    }

    this.db.createService({
      id,
      name: opts.name,
      type,
      image,
      containerName,
      port: hostPort,
      envVars: userEnvJson,
      credentials: credentialsJson,
    });

    this.db.updateService(id, { status: 'running', containerId: container.id });
    const created = this.db.getService(id);
    if (!created) {
      throw new Error(`Failed to create service: ${id}`);
    }
    return created;
  }

  async start(id: string): Promise<void> {
    const service = this.db.getService(id);
    if (!service) {
      throw new Error(`Service not found: ${id}`);
    }

    const containerId = service.container_id ?? service.container_name;
    await this.docker.startContainer(containerId);
    this.db.updateService(id, { status: 'running' });
  }

  async stop(id: string): Promise<void> {
    const service = this.db.getService(id);
    if (!service) {
      throw new Error(`Service not found: ${id}`);
    }

    const containerId = service.container_id ?? service.container_name;
    await this.docker.stopContainer(containerId);
    this.db.updateService(id, { status: 'stopped' });
  }

  async remove(id: string): Promise<void> {
    const service = this.db.getService(id);
    if (!service) {
      throw new Error(`Service not found: ${id}`);
    }

    const containerId = service.container_id ?? service.container_name;
    try {
      await this.docker.stopContainer(containerId);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }
    try {
      await this.docker.removeContainer(containerId);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }

    const volumeName = this.getVolumeName(service.name);
    const client = this.docker.getClient();
    try {
      await client.getVolume(volumeName).remove();
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
    }

    this.db.deleteService(id);
  }

  async backup(id: string): Promise<{ backupId: string; path: string; size: number }> {
    const service = this.getRequiredService(id);
    const volumeName = this.getVolumeName(service.name);
    const backupDir = this.getBackupDir();
    const backupId = `${service.name}-${String(Date.now())}`;
    const backupPath = join(backupDir, `${backupId}.tar.gz`);

    mkdirSync(backupDir, { recursive: true });
    await this.docker.pullImage('alpine');

    const client = this.docker.getClient();
    const container = await client.createContainer({
      Image: 'alpine',
      Cmd: ['tar', 'czf', `/backup/${backupId}.tar.gz`, '-C', '/data', '.'],
      HostConfig: {
        Binds: [`${volumeName}:/data:ro`, `${backupDir}:/backup`],
        AutoRemove: true,
      },
    });

    await container.start();
    const waitResult: unknown = await container.wait();
    const backupExitCode =
      waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
        ? (waitResult as { StatusCode: number }).StatusCode
        : 1;
    if (backupExitCode !== 0) {
      throw new Error(
        `Backup failed with exit code ${String(backupExitCode)} for service: ${service.id}`,
      );
    }

    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found after backup: ${backupPath}`);
    }
    const size = statSync(backupPath).size;

    return { backupId, path: backupPath, size };
  }

  async restore(id: string, backupId: string): Promise<void> {
    const service = this.getRequiredService(id);
    const backupDir = this.getBackupDir();
    const backupFilename = `${backupId}.tar.gz`;
    const backupPath = join(backupDir, backupFilename);
    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    const volumeName = this.getVolumeName(service.name);
    await this.stop(id);

    try {
      await this.docker.pullImage('alpine');
      const client = this.docker.getClient();
      const container = await client.createContainer({
        Image: 'alpine',
        Cmd: ['sh', '-c', `rm -rf /data/* && tar xzf /backup/${backupFilename} -C /data`],
        HostConfig: {
          Binds: [`${volumeName}:/data`, `${backupDir}:/backup:ro`],
          AutoRemove: true,
        },
      });

      await container.start();
      const waitResult: unknown = await container.wait();
      const restoreExitCode =
        waitResult && typeof waitResult === 'object' && 'StatusCode' in waitResult
          ? (waitResult as { StatusCode: number }).StatusCode
          : 1;
      if (restoreExitCode !== 0) {
        throw new Error(
          `Restore failed with exit code ${String(restoreExitCode)} for service: ${service.id}`,
        );
      }
    } finally {
      await this.start(id);
    }
  }

  listBackups(id: string): Array<{ backupId: string; createdAt: Date; sizeBytes: number }> {
    const service = this.getRequiredService(id);
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
    const services = this.db.listServices();

    for (const service of services) {
      if (!service.container_id && !service.container_name) {
        if (service.status !== 'error') {
          this.db.updateService(service.id, { status: 'error' });
          log.warn(
            { serviceId: service.id },
            'Service has no container reference, marking as error',
          );
        }
        continue;
      }

      const containerId = service.container_id ?? service.container_name;
      try {
        const info = await this.docker.getClient().getContainer(containerId).inspect();
        const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
        const containerIdFromDocker = info.Id;

        if (status !== service.status || containerIdFromDocker !== service.container_id) {
          this.db.updateService(service.id, { status, containerId: containerIdFromDocker });
        }
      } catch (err) {
        log.warn(
          { err, serviceId: service.id, containerId },
          'Failed to inspect service container',
        );
        if (service.status !== 'error') {
          this.db.updateService(service.id, { status: 'error' });
        }
      }
    }

    return this.db.listServices();
  }

  async getDetail(id: string): Promise<ServiceRow> {
    const service = this.getRequiredService(id);

    if (!service.container_id && !service.container_name) {
      if (service.status !== 'error') {
        this.db.updateService(service.id, { status: 'error' });
        log.warn({ serviceId: service.id }, 'Service has no container reference, marking as error');
      }
      const refreshed = this.db.getService(id);
      if (!refreshed) {
        throw new Error(`Service not found: ${id}`);
      }
      return refreshed;
    }

    const containerId = service.container_id ?? service.container_name;
    try {
      const info = await this.docker.getClient().getContainer(containerId).inspect();
      const status: ServiceRow['status'] = info.State.Running ? 'running' : 'stopped';
      const containerIdFromDocker = info.Id;

      if (status !== service.status || containerIdFromDocker !== service.container_id) {
        this.db.updateService(service.id, { status, containerId: containerIdFromDocker });
      }
    } catch (err) {
      log.warn({ err, serviceId: service.id, containerId }, 'Failed to inspect service container');
      if (service.status !== 'error') {
        this.db.updateService(service.id, { status: 'error' });
      }
    }

    const refreshed = this.db.getService(id);
    if (!refreshed) {
      throw new Error(`Service not found: ${id}`);
    }
    return refreshed;
  }

  async getLogs(id: string, lines = 100): Promise<string> {
    const service = this.getRequiredService(id);
    const tail = Number.isInteger(lines) && lines > 0 ? lines : 100;
    const containerId = service.container_id ?? service.container_name;
    return this.docker.getLogs(containerId, tail);
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
    if (service.status !== 'running') {
      return {
        status: service.status,
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
      const dataMountPath = this.getDataMountPath(service.type);
      const result = await execInServiceContainer(this.docker, service, [
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
    try {
      const containerId = service.container_id ?? service.container_name;
      const container = this.docker.getClient().getContainer(containerId);
      const rawStats = await container.stats({ stream: false });
      const cpuDelta =
        rawStats.cpu_stats.cpu_usage.total_usage - rawStats.precpu_stats.cpu_usage.total_usage;
      const systemDelta =
        rawStats.cpu_stats.system_cpu_usage - rawStats.precpu_stats.system_cpu_usage;
      const percpuUsage = rawStats.cpu_stats.cpu_usage.percpu_usage as number[] | undefined;
      const numCpus = percpuUsage ? percpuUsage.length : 1;
      cpuPercent =
        systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * numCpus * 100 * 10) / 10 : 0;
      memoryUsageBytes = (rawStats.memory_stats.usage as number | undefined) ?? null;
      memoryLimitBytes = (rawStats.memory_stats.limit as number | undefined) ?? null;
    } catch {
      // container stats unavailable — non-fatal
    }

    let activeConnections: number | null = null;
    let maxConnections: number | null = null;
    try {
      const adapter = getServiceAdapter(service.type);
      if (adapter) {
        const connectionStats = await adapter.getConnectionStats(service, this.docker);
        activeConnections = connectionStats.activeConnections;
        maxConnections = connectionStats.maxConnections;
      }
    } catch {
      // connection stats unavailable — non-fatal
    }

    return {
      status: service.status,
      diskUsageBytes,
      cpuPercent,
      memoryUsageBytes,
      memoryLimitBytes,
      activeConnections,
      maxConnections,
    };
  }

  getProjectServices(projectId: string): ServiceRow[] {
    const envVars = this.db.getEnvVars(projectId);
    const allValues = Object.values(envVars).join(' ');
    const services = this.db.listServices();
    return services.filter((s) => allValues.includes(s.container_name));
  }

  getConnectedProjects(serviceId: string): Array<{ id: string; name: string }> {
    const service = this.getRequiredService(serviceId);
    const containerName = service.container_name;
    const projects = this.db.listProjects();
    const connected: Array<{ id: string; name: string }> = [];

    for (const project of projects) {
      const envVars = this.db.getEnvVars(project.id);
      const hasConnection = Object.values(envVars).some(
        (value) => typeof value === 'string' && value.includes(containerName),
      );
      if (hasConnection) {
        connected.push({ id: project.id, name: project.name });
      }
    }

    return connected;
  }

  async listDatabases(serviceId: string): Promise<ListedDatabase[]> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const adapter = getServiceAdapter(service.type);
    if (!adapter) {
      throw new Error(`Database listing is not supported for service type: ${service.type}`);
    }

    return adapter.listDatabases(service, this.docker);
  }

  async listUsers(serviceId: string): Promise<ListedUser[]> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    const adapter = getServiceAdapter(service.type);
    if (!adapter) {
      throw new Error(`User listing is not supported for service type: ${service.type}`);
    }

    return adapter.listUsers(service, this.docker);
  }

  async createDatabase(serviceId: string, dbName: string): Promise<CreateDatabaseResult> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    assertSafeDatabaseName(dbName);

    const adapter = getServiceAdapter(service.type);
    if (!adapter) {
      throw new Error(`Database creation is not supported for service type: ${service.type}`);
    }

    return adapter.createDatabase(service, dbName, this.docker);
  }

  async createUser(
    serviceId: string,
    username: string,
    password?: string,
    grants?: { database: string },
  ): Promise<CreateUserResult> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    assertSafeUserName(username);

    const userPassword = password ?? randomBytes(16).toString('hex');
    if (grants?.database) {
      assertSafeDatabaseName(grants.database);
    }

    const adapter = getServiceAdapter(service.type);
    if (!adapter) {
      throw new Error(`User creation is not supported for service type: ${service.type}`);
    }

    return adapter.createUser(service, { username, password: userPassword, grants }, this.docker);
  }

  async listBuckets(serviceId: string): Promise<Array<{ name: string; createdAt: string }>> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    if (service.type !== 'minio') {
      throw new Error(
        `Bucket operations are only supported for MinIO services, got: ${service.type}`,
      );
    }

    const adapter = new MinioAdapter();
    return adapter.listBuckets(service, this.docker);
  }

  async createBucket(serviceId: string, bucketName: string): Promise<void> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    if (service.type !== 'minio') {
      throw new Error(
        `Bucket operations are only supported for MinIO services, got: ${service.type}`,
      );
    }

    const adapter = new MinioAdapter();
    return adapter.createBucket(service, this.docker, bucketName);
  }

  async deleteBucket(serviceId: string, bucketName: string): Promise<void> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    if (service.type !== 'minio') {
      throw new Error(
        `Bucket operations are only supported for MinIO services, got: ${service.type}`,
      );
    }

    const adapter = new MinioAdapter();
    return adapter.deleteBucket(service, this.docker, bucketName);
  }

  private getContainerName(name: string): string {
    return `ol-svc-${name}`;
  }

  private getVolumeName(name: string): string {
    return `ol-svc-data-${name}`;
  }

  private getBackupDir(): string {
    return join(this.dataDir, 'backups');
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
      throw new Error(`Unsupported service type: ${type}`);
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

  private isNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes('not found') ||
      error.message.includes('No such container') ||
      error.message.includes('No such volume')
    );
  }

  private getRequiredService(serviceId: string): ServiceRow {
    const service = this.db.getService(serviceId);
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }
    return service;
  }

  private async ensureServiceContainerRunning(service: ServiceRow): Promise<void> {
    const containerId = service.container_id ?? service.container_name;
    try {
      const info = await this.docker.getClient().getContainer(containerId).inspect();
      if (!info.State.Running) {
        throw new Error(`Service container is not running: ${service.id}`);
      }
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new Error(`Service container not found: ${service.id}`);
      }
      throw error;
    }
  }
}
