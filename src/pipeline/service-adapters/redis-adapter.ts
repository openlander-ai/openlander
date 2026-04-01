import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { execInServiceContainer, sleep } from './shared.js';
import type {
  ConnectionStats,
  CreateDatabaseResult,
  CreateUserOptions,
  CreateUserResult,
  ListedDatabase,
  ListedUser,
  ServiceAdapter,
} from './types.js';

export class RedisAdapter implements ServiceAdapter {
  readonly type = 'redis' as const;

  getDataMountPath(): string {
    return '/data';
  }

  getConnectionString(containerName: string, port: number): string {
    return `redis://${containerName}:${String(port)}`;
  }

  async waitForReady(service: ServiceRow, docker: Docker): Promise<void> {
    let lastError = '';
    const containerId = service.container_id ?? service.container_name;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const logs = await docker.getLogs(containerId, 200);
        if (logs.includes('Ready to accept connections')) {
          return;
        }
        lastError = 'Readiness log line not found yet';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await sleep(2000);
    }

    throw new Error(`Redis service is not ready: ${service.id} (${lastError})`);
  }

  async getConnectionStats(service: ServiceRow, docker: Docker): Promise<ConnectionStats> {
    const infoResult = await execInServiceContainer(docker, service, [
      'redis-cli',
      'INFO',
      'clients',
    ]);
    const clientsMatch = infoResult.stdout.match(/connected_clients:(\d+)/);
    const maxMatch = infoResult.stdout.match(/maxclients:(\d+)/);
    return {
      activeConnections: clientsMatch ? Number.parseInt(clientsMatch[1] ?? '', 10) : null,
      maxConnections: maxMatch ? Number.parseInt(maxMatch[1] ?? '', 10) : null,
    };
  }

  listDatabases(_service: ServiceRow, _docker: Docker): Promise<ListedDatabase[]> {
    return Promise.reject(new Error('Database listing is not supported for redis services'));
  }

  listUsers(_service: ServiceRow, _docker: Docker): Promise<ListedUser[]> {
    return Promise.reject(new Error('User listing is not supported for redis services'));
  }

  createDatabase(
    _service: ServiceRow,
    _dbName: string,
    _docker: Docker,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(new Error('Database creation is not supported for redis services'));
  }

  createUser(
    _service: ServiceRow,
    _options: CreateUserOptions,
    _docker: Docker,
  ): Promise<CreateUserResult> {
    return Promise.reject(new Error('User creation is not supported for redis services'));
  }
}
