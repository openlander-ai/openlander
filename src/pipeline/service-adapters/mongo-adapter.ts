import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { waitUntilReady } from '../lib/retry.js';
import { execInServiceContainer } from './shared.js';
import type {
  ConnectionStats,
  CreateDatabaseResult,
  CreateUserOptions,
  CreateUserResult,
  ListedDatabase,
  ListedUser,
  ServiceAdapter,
  ServiceCredentials,
} from './types.js';

export class MongoAdapter implements ServiceAdapter {
  readonly type = 'mongodb' as const;

  getDataMountPath(): string {
    return '/data/db';
  }

  getConnectionString(containerName: string, port: number, creds?: ServiceCredentials): string {
    if (!creds) {
      throw new Error('Credentials required for mongodb');
    }

    const user = encodeURIComponent(creds.user);
    const password = encodeURIComponent(creds.password);
    return `mongodb://${user}:${password}@${containerName}:${String(port)}/admin`;
  }

  async waitForReady(service: ServiceRow, docker: Docker): Promise<void> {
    const containerId = service.container_id ?? service.container_name;
    await waitUntilReady(
      async () => {
        const logs = await docker.getLogs(containerId, 200);
        if (!logs.includes('Waiting for connections')) {
          throw new Error('Readiness log line not found yet');
        }
      },
      {
        maxAttempts: 30,
        intervalMs: 2000,
        description: `MongoDB service: ${service.id}`,
      },
    );
  }

  async getConnectionStats(service: ServiceRow, docker: Docker): Promise<ConnectionStats> {
    const connResult = await execInServiceContainer(docker, service, [
      'mongosh',
      '--quiet',
      '--eval',
      'JSON.stringify(db.serverStatus().connections)',
    ]);
    const parsed = JSON.parse(connResult.stdout.trim()) as {
      current?: number;
      available?: number;
    };
    return {
      activeConnections: parsed.current ?? null,
      maxConnections:
        parsed.available != null && parsed.current != null
          ? parsed.current + parsed.available
          : null,
    };
  }

  async listDatabases(service: ServiceRow, docker: Docker): Promise<ListedDatabase[]> {
    const result = await execInServiceContainer(docker, service, [
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
        if (separatorIndex < 0) {
          return { name: line, sizeBytes: null };
        }
        const name = line.slice(0, separatorIndex).trim();
        const sizeRaw = line.slice(separatorIndex + 1).trim();
        const parsedSize = Number.parseInt(sizeRaw, 10);
        return { name, sizeBytes: Number.isFinite(parsedSize) ? parsedSize : null };
      })
      .filter((db) => db.name.length > 0);
  }

  async listUsers(service: ServiceRow, docker: Docker): Promise<ListedUser[]> {
    const result = await execInServiceContainer(docker, service, [
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

  createDatabase(
    service: ServiceRow,
    _dbName: string,
    _docker: Docker,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(
      new Error(
        `Database creation is not supported for service type: ${service.kind ?? 'unknown'}`,
      ),
    );
  }

  createUser(
    service: ServiceRow,
    _options: CreateUserOptions,
    _docker: Docker,
  ): Promise<CreateUserResult> {
    return Promise.reject(
      new Error(`User creation is not supported for service type: ${service.kind ?? 'unknown'}`),
    );
  }
}
