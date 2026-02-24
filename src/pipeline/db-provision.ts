import { randomBytes } from 'node:crypto';

import type { Database } from '../db/index.js';
import type { Docker } from './docker.js';

const POSTGRES_IMAGE = 'postgres:16-alpine';
const WEB_NETWORK = 'web';

const POSTGRES_ENV_KEYS = [
  'DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
] as const;
const SQLITE_ENV_KEYS = ['DATABASE_URL'] as const;

export interface DbProvisionConfig {
  type: 'sqlite' | 'postgres';
  /** For postgres: database name */
  dbName?: string;
  /** For postgres: user */
  user?: string;
  /** For postgres: password (auto-generated if not provided) */
  password?: string;
}

export interface DbProvisionResult {
  type: 'sqlite' | 'postgres';
  /** Connection string / DSN */
  connectionString: string;
  /** Container ID (for postgres) */
  containerId?: string;
  /** Volume name (for sqlite) */
  volumeName?: string;
  /** Environment variables to inject into the project container */
  envVars: Record<string, string>;
}

export class DatabaseProvisioner {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  async provision(projectId: string, config: DbProvisionConfig): Promise<DbProvisionResult> {
    const projectName = this.getProjectName(projectId);

    await this.remove(projectId);

    if (config.type === 'postgres') {
      return this.provisionPostgres(projectId, projectName, config);
    }

    return this.provisionSqlite(projectId, projectName);
  }

  async getStatus(
    projectId: string,
  ): Promise<{ provisioned: boolean; type?: string; containerId?: string }> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return { provisioned: false };
    }

    const client = this.docker.getClient();
    const projectName = project.name;

    const containers = await client.listContainers({
      all: true,
      filters: {
        label: [
          'openlander.managed=true',
          'openlander.role=database',
          `openlander.project=${projectName}`,
        ],
      },
    });

    if (containers.length > 0) {
      return {
        provisioned: true,
        type: 'postgres',
        containerId: containers[0]?.Id,
      };
    }

    const volumeName = this.getSqliteVolumeName(projectName);
    const volumes = await client.listVolumes({
      filters: {
        name: [volumeName],
      },
    });

    if (volumes.Volumes.length > 0) {
      return {
        provisioned: true,
        type: 'sqlite',
      };
    }

    return { provisioned: false };
  }

  async remove(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return;
    }

    const client = this.docker.getClient();
    const projectName = project.name;

    const containers = await client.listContainers({
      all: true,
      filters: {
        label: [
          'openlander.managed=true',
          'openlander.role=database',
          `openlander.project=${projectName}`,
        ],
      },
    });

    for (const containerInfo of containers) {
      const container = client.getContainer(containerInfo.Id);
      try {
        await container.remove({ force: true });
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    const volumeName = this.getSqliteVolumeName(projectName);
    const volumes = await client.listVolumes({
      filters: {
        name: [volumeName],
      },
    });

    for (const volumeInfo of volumes.Volumes) {
      const volume = client.getVolume(volumeInfo.Name);
      try {
        await volume.remove();
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    for (const key of [...POSTGRES_ENV_KEYS, ...SQLITE_ENV_KEYS]) {
      this.db.deleteEnvVar(projectId, key);
    }
  }

  private async provisionPostgres(
    projectId: string,
    projectName: string,
    config: DbProvisionConfig,
  ): Promise<DbProvisionResult> {
    const client = this.docker.getClient();

    const dbUser = config.user ?? 'openlander';
    const dbPassword = config.password ?? randomBytes(16).toString('hex');
    const dbName = config.dbName ?? projectName;
    const host = this.getPostgresContainerName(projectName);
    const connectionString = `postgresql://${dbUser}:${dbPassword}@${host}:5432/${dbName}`;

    const container = await client.createContainer({
      Image: POSTGRES_IMAGE,
      name: host,
      Env: [`POSTGRES_USER=${dbUser}`, `POSTGRES_PASSWORD=${dbPassword}`, `POSTGRES_DB=${dbName}`],
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'database',
        'openlander.project': projectName,
      },
      HostConfig: {
        NetworkMode: WEB_NETWORK,
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });

    await container.start();

    const envVars = {
      DATABASE_URL: connectionString,
      PGHOST: host,
      PGPORT: '5432',
      PGUSER: dbUser,
      PGPASSWORD: dbPassword,
      PGDATABASE: dbName,
    };

    this.db.setEnvVarsBulk(projectId, envVars);

    return {
      type: 'postgres',
      connectionString,
      containerId: container.id,
      envVars,
    };
  }

  private async provisionSqlite(
    projectId: string,
    projectName: string,
  ): Promise<DbProvisionResult> {
    const client = this.docker.getClient();
    const volumeName = this.getSqliteVolumeName(projectName);
    const connectionString = `/data/${projectName}.db`;

    await client.createVolume({
      Name: volumeName,
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'database',
        'openlander.project': projectName,
      },
    });

    const envVars = {
      DATABASE_URL: `file:${connectionString}`,
    };

    this.db.setEnvVarsBulk(projectId, envVars);

    return {
      type: 'sqlite',
      connectionString,
      volumeName,
      envVars,
    };
  }

  private getProjectName(projectId: string): string {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return project.name;
  }

  private getPostgresContainerName(projectName: string): string {
    return `ol-db-${projectName}`;
  }

  private getSqliteVolumeName(projectName: string): string {
    return `ol-data-${projectName}`;
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
