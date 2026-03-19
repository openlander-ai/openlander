import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { nanoid } from 'nanoid';

import { getDataDir } from '../config/index.js';
import type { Database, ServiceRow } from '../db/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from './docker.js';
import { allocatePort } from './port.js';

const log = createModuleLogger('service-manager');

const WEB_NETWORK = 'web';
type BuiltInServiceType = 'postgresql' | 'mysql' | 'redis' | 'mongodb';

function shouldMarkMissingContainerAsError(status: string): boolean {
  return status !== 'error' && status !== 'provisioning';
}

interface ServiceCredentials {
  user: string;
  password: string;
  database: string;
}

export const AVAILABLE_VERSIONS: Record<string, string[]> = {
  postgresql: ['17-alpine', '16-alpine', '15-alpine', '14-alpine'],
  mysql: ['9', '8'],
  redis: ['8-alpine', '7-alpine'],
  mongodb: ['8', '7'],
};

interface ContainerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CreateDatabaseResult {
  database: string;
  user?: string;
  password?: string;
  connectionString?: string;
}

interface CreateUserResult {
  database: string;
  user: string;
  password: string;
  connectionString: string;
}

interface ListedDatabase {
  name: string;
  sizeBytes: number | null;
}

interface ListedUser {
  name: string;
}

export interface ServiceTemplate {
  type: string;
  image: string;
  port: number;
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
      } else {
        const containerName = this.getContainerName(opts.name);
        const credentials = this.buildCredentials(
          template.type as Exclude<BuiltInServiceType, 'redis'>,
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
    }

    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid service port: ${String(port)}`);
    }

    const containerPort = port;
    const hostPort = await allocatePort(this.db, this.docker);

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
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'service',
        'openlander.service': opts.name,
      },
      ExposedPorts: {
        [`${String(containerPort)}/tcp`]: {},
      },
      HostConfig: {
        NetworkMode: WEB_NETWORK,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [`${volumeName}:${dataMountPath}`],
        PortBindings: {
          [`${String(containerPort)}/tcp`]: [{ HostPort: String(hostPort) }],
        },
      },
    });

    await container.start();

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
    const client = this.docker.getClient();

    for (const service of services) {
      if (!service.container_id && !service.container_name) {
        if (shouldMarkMissingContainerAsError(service.status)) {
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
        const info = await client.getContainer(containerId).inspect();
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
      if (shouldMarkMissingContainerAsError(service.status)) {
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
      const result = await this.execInServiceContainer(service, ['du', '-sb', dataMountPath]);
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
      if (service.type === 'postgresql') {
        const credentials = this.parseServiceCredentials(service);
        const connResult = await this.execInServiceContainer(service, [
          'psql',
          '-t',
          '-A',
          '-U',
          credentials.user,
          '-d',
          'postgres',
          '-c',
          'SELECT count(*) FROM pg_stat_activity WHERE state IS NOT NULL',
        ]);
        const maxResult = await this.execInServiceContainer(service, [
          'psql',
          '-t',
          '-A',
          '-U',
          credentials.user,
          '-d',
          'postgres',
          '-c',
          'SHOW max_connections',
        ]);
        activeConnections = Number.parseInt(connResult.stdout.trim(), 10) || 0;
        maxConnections = Number.parseInt(maxResult.stdout.trim(), 10) || null;
      } else if (service.type === 'mysql') {
        const credentials = this.parseServiceCredentials(service);
        const connResult = await this.execInServiceContainer(service, [
          'mysql',
          '-N',
          '-uroot',
          `-p${credentials.password}`,
          '-e',
          'SELECT COUNT(*) FROM information_schema.processlist',
        ]);
        const maxResult = await this.execInServiceContainer(service, [
          'mysql',
          '-N',
          '-uroot',
          `-p${credentials.password}`,
          '-e',
          "SHOW VARIABLES LIKE 'max_connections'",
        ]);
        activeConnections = Number.parseInt(connResult.stdout.trim(), 10) || 0;
        const maxParts = maxResult.stdout.trim().split(/\s+/);
        maxConnections =
          maxParts.length >= 2 ? Number.parseInt(maxParts[1] ?? '', 10) || null : null;
      } else if (service.type === 'redis') {
        const infoResult = await this.execInServiceContainer(service, [
          'redis-cli',
          'INFO',
          'clients',
        ]);
        const clientsMatch = infoResult.stdout.match(/connected_clients:(\d+)/);
        const maxMatch = infoResult.stdout.match(/maxclients:(\d+)/);
        activeConnections = clientsMatch ? Number.parseInt(clientsMatch[1] ?? '', 10) : null;
        maxConnections = maxMatch ? Number.parseInt(maxMatch[1] ?? '', 10) : null;
      } else if (service.type === 'mongodb') {
        const connResult = await this.execInServiceContainer(service, [
          'mongosh',
          '--quiet',
          '--eval',
          'JSON.stringify(db.serverStatus().connections)',
        ]);
        const parsed = JSON.parse(connResult.stdout.trim()) as {
          current?: number;
          available?: number;
        };
        activeConnections = parsed.current ?? null;
        maxConnections =
          parsed.available != null && parsed.current != null
            ? parsed.current + parsed.available
            : null;
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

    if (service.type === 'redis') {
      throw new Error('Database listing is not supported for redis services');
    }

    if (service.type === 'postgresql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForPostgresReady(service, credentials);

      const result = await this.execInServiceContainer(service, [
        'psql',
        '-t',
        '-A',
        '-F',
        '|',
        '-U',
        credentials.user,
        '-d',
        'postgres',
        '-c',
        'SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false',
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const separatorIndex = line.indexOf('|');
          if (separatorIndex < 0) {
            return {
              name: line,
              sizeBytes: null,
            };
          }

          const name = line.slice(0, separatorIndex).trim();
          const sizeRaw = line.slice(separatorIndex + 1).trim();
          const parsedSize = Number.parseInt(sizeRaw, 10);
          return {
            name,
            sizeBytes: Number.isFinite(parsedSize) ? parsedSize : null,
          };
        })
        .filter((database) => database.name.length > 0);
    }

    if (service.type === 'mysql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForMySqlReady(service, credentials);

      const result = await this.execInServiceContainer(service, [
        'mysql',
        '-N',
        '-uroot',
        `-p${credentials.password}`,
        '-e',
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys')",
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({
          name,
          sizeBytes: null,
        }));
    }

    if (service.type === 'mongodb') {
      const result = await this.execInServiceContainer(service, [
        'mongosh',
        '--quiet',
        '--eval',
        'db.adminCommand("listDatabases").databases.filter(d => !["admin","config","local"].includes(d.name)).forEach(d => print(d.name + "|" + d.sizeOnDisk))',
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const separatorIndex = line.indexOf('|');
          if (separatorIndex < 0) return { name: line, sizeBytes: null };
          const name = line.slice(0, separatorIndex).trim();
          const sizeRaw = line.slice(separatorIndex + 1).trim();
          const parsedSize = Number.parseInt(sizeRaw, 10);
          return { name, sizeBytes: Number.isFinite(parsedSize) ? parsedSize : null };
        })
        .filter((db) => db.name.length > 0);
    }

    throw new Error(`Database listing is not supported for service type: ${service.type}`);
  }

  async listUsers(serviceId: string): Promise<ListedUser[]> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);

    if (service.type === 'redis') {
      throw new Error('User listing is not supported for redis services');
    }

    if (service.type === 'postgresql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForPostgresReady(service, credentials);

      const result = await this.execInServiceContainer(service, [
        'psql',
        '-t',
        '-A',
        '-F',
        '|',
        '-U',
        credentials.user,
        '-d',
        'postgres',
        '-c',
        'SELECT rolname FROM pg_roles WHERE rolcanlogin = true',
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const separatorIndex = line.indexOf('|');
          const name = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
          return { name };
        })
        .filter((user) => user.name.length > 0);
    }

    if (service.type === 'mysql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForMySqlReady(service, credentials);

      const result = await this.execInServiceContainer(service, [
        'mysql',
        '-N',
        '-uroot',
        `-p${credentials.password}`,
        '-e',
        "SELECT user FROM mysql.user WHERE user NOT IN ('root','mysql.sys','mysql.infoschema','mysql.session')",
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ name }));
    }

    if (service.type === 'mongodb') {
      const result = await this.execInServiceContainer(service, [
        'mongosh',
        '--quiet',
        '--eval',
        'db.system.users.find({}, {user:1, _id:0}).forEach(u => print(u.user))',
      ]);

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((name) => name.length > 0)
        .map((name) => ({ name }));
    }

    throw new Error(`User listing is not supported for service type: ${service.type}`);
  }

  async createDatabase(serviceId: string, dbName: string): Promise<CreateDatabaseResult> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    this.assertSafeDatabaseName(dbName);

    if (service.type === 'redis') {
      throw new Error('Database creation is not supported for redis services');
    }

    if (service.type === 'postgresql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForPostgresReady(service, credentials);

      await this.execInServiceContainer(service, [
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        credentials.user,
        '-d',
        'postgres',
        '-c',
        `CREATE DATABASE ${this.quotePostgresIdentifier(dbName)}`,
      ]);

      return {
        database: dbName,
        user: credentials.user,
        password: credentials.password,
        connectionString: this.getConnectionString(
          'postgresql',
          service.container_name,
          service.port,
          {
            user: credentials.user,
            password: credentials.password,
            database: dbName,
          },
        ),
      };
    }

    if (service.type === 'mysql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForMySqlReady(service, credentials);

      await this.execInServiceContainer(service, [
        'mysql',
        '-uroot',
        `-p${credentials.password}`,
        '-e',
        `CREATE DATABASE IF NOT EXISTS ${this.quoteMySqlIdentifier(dbName)};`,
      ]);

      return {
        database: dbName,
        user: credentials.user,
        password: credentials.password,
        connectionString: this.getConnectionString('mysql', service.container_name, service.port, {
          user: credentials.user,
          password: credentials.password,
          database: dbName,
        }),
      };
    }

    throw new Error(`Database creation is not supported for service type: ${service.type}`);
  }

  async createUser(
    serviceId: string,
    username: string,
    password?: string,
    grants?: { database: string },
  ): Promise<CreateUserResult> {
    const service = this.getRequiredService(serviceId);
    await this.ensureServiceContainerRunning(service);
    this.assertSafeUserName(username);

    if (service.type === 'redis') {
      throw new Error('User creation is not supported for redis services');
    }

    const userPassword = password ?? randomBytes(16).toString('hex');

    if (service.type === 'postgresql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForPostgresReady(service, credentials);

      await this.execInServiceContainer(service, [
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        credentials.user,
        '-d',
        'postgres',
        '-c',
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${this.quoteSqlLiteral(username)}) THEN CREATE ROLE ${this.quotePostgresIdentifier(username)} LOGIN PASSWORD ${this.quoteSqlLiteral(userPassword)}; ELSE ALTER ROLE ${this.quotePostgresIdentifier(username)} LOGIN PASSWORD ${this.quoteSqlLiteral(userPassword)}; END IF; END $$;`,
      ]);

      const grantDatabase = grants?.database;
      if (grantDatabase) {
        this.assertSafeDatabaseName(grantDatabase);
        await this.execInServiceContainer(service, [
          'psql',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          credentials.user,
          '-d',
          'postgres',
          '-c',
          `GRANT ALL PRIVILEGES ON DATABASE ${this.quotePostgresIdentifier(grantDatabase)} TO ${this.quotePostgresIdentifier(username)};`,
        ]);
      }

      const database = grantDatabase ?? credentials.database;
      return {
        database,
        user: username,
        password: userPassword,
        connectionString: this.getConnectionString(
          'postgresql',
          service.container_name,
          service.port,
          {
            user: username,
            password: userPassword,
            database,
          },
        ),
      };
    }

    if (service.type === 'mysql') {
      const credentials = this.parseServiceCredentials(service);
      await this.waitForMySqlReady(service, credentials);

      await this.execInServiceContainer(service, [
        'mysql',
        '-uroot',
        `-p${credentials.password}`,
        '-e',
        `CREATE USER IF NOT EXISTS ${this.quoteMySqlUserHost(username)} IDENTIFIED BY ${this.quoteSqlLiteral(userPassword)}; ALTER USER ${this.quoteMySqlUserHost(username)} IDENTIFIED BY ${this.quoteSqlLiteral(userPassword)};`,
      ]);

      const grantDatabase = grants?.database;
      if (grantDatabase) {
        this.assertSafeDatabaseName(grantDatabase);
        await this.execInServiceContainer(service, [
          'mysql',
          '-uroot',
          `-p${credentials.password}`,
          '-e',
          `GRANT ALL PRIVILEGES ON ${this.quoteMySqlIdentifier(grantDatabase)}.* TO ${this.quoteMySqlUserHost(username)}; FLUSH PRIVILEGES;`,
        ]);
      }

      const database = grantDatabase ?? credentials.database;
      return {
        database,
        user: username,
        password: userPassword,
        connectionString: this.getConnectionString('mysql', service.container_name, service.port, {
          user: username,
          password: userPassword,
          database,
        }),
      };
    }

    throw new Error(`User creation is not supported for service type: ${service.type}`);
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
    switch (type) {
      case 'postgresql':
        return '/var/lib/postgresql/data';
      case 'mysql':
        return '/var/lib/mysql';
      case 'redis':
        return '/data';
      case 'mongodb':
        return '/data/db';
      default:
        return '/data';
    }
  }

  private buildCredentials(
    type: Exclude<BuiltInServiceType, 'redis'>,
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
    if (type === 'redis') {
      return `redis://${containerName}:${String(port)}`;
    }

    if (!creds) {
      throw new Error(`Credentials required for ${type}`);
    }

    const user = encodeURIComponent(creds.user);
    const password = encodeURIComponent(creds.password);
    const database = encodeURIComponent(creds.database);

    switch (type) {
      case 'postgresql':
        return `postgresql://${user}:${password}@${containerName}:${String(port)}/${database}`;
      case 'mysql':
        return `mysql://${user}:${password}@${containerName}:${String(port)}/${database}`;
      case 'mongodb':
        return `mongodb://${user}:${password}@${containerName}:${String(port)}/admin`;
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unsupported service type: ${_exhaustive as string}`);
      }
    }
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

  private parseServiceCredentials(service: ServiceRow): ServiceCredentials {
    if (!service.credentials) {
      throw new Error(`Service credentials not available: ${service.id}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(service.credentials);
    } catch (_err) {
      throw new Error(`Invalid service credentials: ${service.id}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Incomplete service credentials: ${service.id}`);
    }

    const record = parsed as Record<string, unknown>;
    if (
      typeof record['user'] !== 'string' ||
      typeof record['password'] !== 'string' ||
      typeof record['database'] !== 'string'
    ) {
      throw new Error(`Incomplete service credentials: ${service.id}`);
    }

    return {
      user: record['user'],
      password: record['password'],
      database: record['database'],
    };
  }

  private assertSafeDatabaseName(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid database name: ${name}`);
    }
  }

  private assertSafeUserName(username: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
      throw new Error(`Invalid username: ${username}`);
    }
  }

  private quotePostgresIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private quoteMySqlIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  private quoteMySqlUserHost(username: string): string {
    return `${this.quoteSqlLiteral(username)}@'%'`;
  }

  private quoteSqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private async waitForPostgresReady(
    service: ServiceRow,
    credentials: ServiceCredentials,
  ): Promise<void> {
    let lastError = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const result = await this.execInServiceContainer(
          service,
          ['pg_isready', '-U', credentials.user, '-d', 'postgres'],
          { throwOnNonZeroExit: false },
        );
        if (result.exitCode === 0) {
          return;
        }
        lastError = result.stderr.trim() || result.stdout.trim();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await this.sleep(1000);
    }

    throw new Error(
      `PostgreSQL service is not ready: ${service.id}${lastError ? ` (${lastError})` : ''}`,
    );
  }

  private async waitForMySqlReady(
    service: ServiceRow,
    credentials: ServiceCredentials,
  ): Promise<void> {
    let lastError = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const result = await this.execInServiceContainer(
          service,
          [
            'mysqladmin',
            'ping',
            '-h',
            '127.0.0.1',
            '-uroot',
            `-p${credentials.password}`,
            '--silent',
          ],
          { throwOnNonZeroExit: false },
        );
        if (result.exitCode === 0) {
          return;
        }
        lastError = result.stderr.trim() || result.stdout.trim();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await this.sleep(1000);
    }

    throw new Error(
      `MySQL service is not ready: ${service.id}${lastError ? ` (${lastError})` : ''}`,
    );
  }

  private async execInServiceContainer(
    service: ServiceRow,
    command: string[],
    options?: { throwOnNonZeroExit?: boolean },
  ): Promise<ContainerExecResult> {
    const client = this.docker.getClient();
    const containerId = service.container_id ?? service.container_name;
    const container = client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: command,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
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

    client.modem.demuxStream(stream, stdoutStream, stderrStream);

    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    const info = await exec.inspect();
    const exitCode = info.ExitCode;
    if (typeof exitCode !== 'number') {
      throw new Error(`Container command did not report an exit code for service: ${service.id}`);
    }

    const stdout = Buffer.concat(stdoutChunks).toString('utf8');
    const stderr = Buffer.concat(stderrChunks).toString('utf8');

    if (options?.throwOnNonZeroExit !== false && exitCode !== 0) {
      const commandText = command.join(' ');
      const output = stderr.trim() || stdout.trim();
      throw new Error(
        `Container command failed (${commandText}) with exit code ${String(exitCode)}${output ? `: ${output}` : ''}`,
      );
    }

    return { stdout, stderr, exitCode };
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
