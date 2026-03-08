import { randomBytes } from 'node:crypto';

import { nanoid } from 'nanoid';

import type { Database, ServiceRow } from '../db/index.js';
import type { Docker } from './docker.js';

const WEB_NETWORK = 'web';
type BuiltInServiceType = 'postgresql' | 'mysql' | 'redis' | 'mongodb';

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

export class ServiceManager {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  async create(opts: {
    name: string;
    template?: string;
    image?: string;
    port?: number;
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
      image = template.image;
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

    const id = nanoid(12);
    const containerName = this.getContainerName(opts.name);
    const volumeName = this.getVolumeName(opts.name);

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
      HostConfig: {
        NetworkMode: WEB_NETWORK,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: [`${volumeName}:${dataMountPath}`],
      },
    });

    await container.start();

    this.db.createService({
      id,
      name: opts.name,
      type,
      image,
      containerName,
      port,
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

  async list(): Promise<ServiceRow[]> {
    const services = this.db.listServices();
    const client = this.docker.getClient();

    for (const service of services) {
      if (!service.container_id && !service.container_name) {
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
      } catch {
        if (service.status !== 'error') {
          this.db.updateService(service.id, { status: 'error' });
        }
      }
    }

    return this.db.listServices();
  }

  private getContainerName(name: string): string {
    return `ol-svc-${name}`;
  }

  private getVolumeName(name: string): string {
    return `ol-svc-data-${name}`;
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
}
