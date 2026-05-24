import type { ServiceRow } from '../../db/index.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { ServiceOperationUnsupportedError } from '../../errors.js';
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
} from './types.js';

export class RedisAdapter implements ServiceAdapter {
  readonly type = 'redis' as const;

  getDataMountPath(): string {
    return '/data';
  }

  getConnectionString(containerName: string, port: number): string {
    return `redis://${containerName}:${String(port)}`;
  }

  async waitForReady(service: ServiceRow, runtime: RuntimeBackend): Promise<void> {
    const containerId = service.container_id ?? service.container_name ?? '';
    await waitUntilReady(
      async () => {
        const logs = await runtime.getLogs(containerId, 200);
        if (!logs.includes('Ready to accept connections')) {
          throw new Error('Readiness log line not found yet');
        }
      },
      {
        maxAttempts: 30,
        intervalMs: 2000,
        description: `Redis service: ${service.id}`,
      },
    );
  }

  async getConnectionStats(service: ServiceRow, runtime: RuntimeBackend): Promise<ConnectionStats> {
    const infoResult = await execInServiceContainer(runtime, service, [
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

  listDatabases(_service: ServiceRow, _runtime: RuntimeBackend): Promise<ListedDatabase[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database listing', 'redis'));
  }

  listUsers(_service: ServiceRow, _runtime: RuntimeBackend): Promise<ListedUser[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('User listing', 'redis'));
  }

  createDatabase(
    _service: ServiceRow,
    _dbName: string,
    _runtime: RuntimeBackend,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database creation', 'redis'));
  }

  createUser(
    _service: ServiceRow,
    _options: CreateUserOptions,
    _runtime: RuntimeBackend,
  ): Promise<CreateUserResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('User creation', 'redis'));
  }
}
