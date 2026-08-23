import { ServiceOperationUnsupportedError } from '../../errors.js';
import type { ServiceRow } from '../../db/index.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { waitUntilReady } from '../lib/retry.js';
import { execInServiceContainer, parseServiceCredentials } from './shared.js';
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

export class Neo4jAdapter implements ServiceAdapter {
  readonly type = 'neo4j' as const;

  getDataMountPath(): string {
    return '/data';
  }

  getConnectionString(containerName: string, port: number, _creds?: ServiceCredentials): string {
    return `neo4j://${containerName}:${String(port)}`;
  }

  async waitForReady(service: ServiceRow, runtime: RuntimeBackend): Promise<void> {
    const credentials = parseServiceCredentials(service);
    await waitUntilReady(
      async () => {
        await execInServiceContainer(runtime, service, [
          'cypher-shell',
          '-a',
          'neo4j://localhost:7687',
          '-u',
          credentials.user,
          '-p',
          credentials.password,
          'RETURN 1',
        ]);
      },
      {
        maxAttempts: 30,
        intervalMs: 2000,
        description: `Neo4j service: ${service.id}`,
      },
    );
  }

  getConnectionStats(_service: ServiceRow, _runtime: RuntimeBackend): Promise<ConnectionStats> {
    return Promise.resolve({ activeConnections: null, maxConnections: null });
  }

  listDatabases(_service: ServiceRow, _runtime: RuntimeBackend): Promise<ListedDatabase[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database listing', 'neo4j'));
  }

  listUsers(_service: ServiceRow, _runtime: RuntimeBackend): Promise<ListedUser[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('User listing', 'neo4j'));
  }

  createDatabase(
    _service: ServiceRow,
    _dbName: string,
    _runtime: RuntimeBackend,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database creation', 'neo4j'));
  }

  createUser(
    _service: ServiceRow,
    _options: CreateUserOptions,
    _runtime: RuntimeBackend,
  ): Promise<CreateUserResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('User creation', 'neo4j'));
  }
}
