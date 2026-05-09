import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
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
  ServiceCredentials,
} from './types.js';

export class RabbitMqAdapter implements ServiceAdapter {
  readonly type = 'rabbitmq' as const;

  getDataMountPath(): string {
    return '/var/lib/rabbitmq';
  }

  getConnectionString(containerName: string, port: number, creds?: ServiceCredentials): string {
    if (creds) {
      return `amqp://${creds.user}:${creds.password}@${containerName}:${String(port)}`;
    }
    return `amqp://${containerName}:${String(port)}`;
  }

  async waitForReady(service: ServiceRow, docker: Docker): Promise<void> {
    await waitUntilReady(
      async () => {
        await execInServiceContainer(docker, service, ['rabbitmq-diagnostics', 'check_running']);
      },
      {
        maxAttempts: 15,
        intervalMs: 2000,
        description: `RabbitMQ service: ${service.id}`,
      },
    );
  }

  async getConnectionStats(service: ServiceRow, docker: Docker): Promise<ConnectionStats> {
    try {
      const result = await execInServiceContainer(docker, service, [
        'rabbitmqctl',
        'list_connections',
        '--no-table-headers',
      ]);
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      return {
        activeConnections: lines.length,
        maxConnections: null,
      };
    } catch {
      return { activeConnections: null, maxConnections: null };
    }
  }

  listDatabases(_service: ServiceRow, _docker: Docker): Promise<ListedDatabase[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database listing', 'rabbitmq'));
  }

  listUsers(_service: ServiceRow, _docker: Docker): Promise<ListedUser[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('User listing', 'rabbitmq'));
  }

  createDatabase(
    _service: ServiceRow,
    _dbName: string,
    _docker: Docker,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database creation', 'rabbitmq'));
  }

  createUser(
    _service: ServiceRow,
    _options: CreateUserOptions,
    _docker: Docker,
  ): Promise<CreateUserResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('User creation', 'rabbitmq'));
  }
}
