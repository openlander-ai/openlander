import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { ServiceConfigError, ServiceOperationUnsupportedError } from '../../errors.js';
import { waitUntilReady } from '../lib/retry.js';
import { resolveContainerUrl } from '../url-resolver.js';
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

function parseMinioCredentials(service: ServiceRow): { user: string; password: string } {
  if (!service.credentials) {
    throw new ServiceConfigError(`Service credentials not available: ${service.id}`, {
      serviceId: service.id,
    });
  }

  const parsed = JSON.parse(service.credentials) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceConfigError(`Invalid MinIO credentials payload: ${service.id}`, {
      serviceId: service.id,
    });
  }

  const record = parsed as Record<string, unknown>;
  const user = record['user'];
  const password = record['password'];
  if (typeof user !== 'string' || typeof password !== 'string') {
    throw new ServiceConfigError(`Incomplete MinIO credentials: ${service.id}`, {
      serviceId: service.id,
    });
  }

  return { user, password };
}

export class MinioAdapter implements ServiceAdapter {
  readonly type = 'minio' as const;

  getDataMountPath(): string {
    return '/data';
  }

  getConnectionString(containerName: string, port: number): string {
    return `http://${containerName}:${String(port)}`;
  }

  async waitForReady(service: ServiceRow, _docker: Docker): Promise<void> {
    await waitUntilReady(
      async () => {
        const response = await fetch(`${resolveContainerUrl(service.port)}/minio/health/live`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${String(response.status)}`);
        }
      },
      {
        maxAttempts: 30,
        intervalMs: 2000,
        description: `MinIO service: ${service.id}`,
      },
    );
  }

  getConnectionStats(_service: ServiceRow, _docker: Docker): Promise<ConnectionStats> {
    return Promise.resolve({ activeConnections: null, maxConnections: null });
  }

  listDatabases(_service: ServiceRow, _docker: Docker): Promise<ListedDatabase[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database listing', 'minio'));
  }

  listUsers(_service: ServiceRow, _docker: Docker): Promise<ListedUser[]> {
    return Promise.reject(new ServiceOperationUnsupportedError('User listing', 'minio'));
  }

  createDatabase(
    _service: ServiceRow,
    _dbName: string,
    _docker: Docker,
  ): Promise<CreateDatabaseResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('Database creation', 'minio'));
  }

  createUser(
    _service: ServiceRow,
    _options: CreateUserOptions,
    _docker: Docker,
  ): Promise<CreateUserResult> {
    return Promise.reject(new ServiceOperationUnsupportedError('User creation', 'minio'));
  }

  async setupAlias(service: ServiceRow, docker: Docker): Promise<void> {
    const creds = parseMinioCredentials(service);
    await execInServiceContainer(docker, service, [
      'mc',
      'alias',
      'set',
      'local',
      'http://localhost:9000',
      creds.user,
      creds.password,
    ]);
  }

  async listBuckets(
    service: ServiceRow,
    docker: Docker,
  ): Promise<Array<{ name: string; createdAt: string }>> {
    await this.setupAlias(service, docker);
    const result = await execInServiceContainer(docker, service, ['mc', 'ls', 'local', '--json']);

    const buckets: Array<{ name: string; createdAt: string }> = [];
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const entry = JSON.parse(trimmed) as unknown;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }

        const record = entry as Record<string, unknown>;
        const key = record['key'];
        const lastModified = record['lastModified'];
        if (typeof key === 'string') {
          buckets.push({
            name: key.replace(/\/$/, ''),
            createdAt: typeof lastModified === 'string' ? lastModified : '',
          });
        }
      } catch {
        continue;
      }
    }

    return buckets;
  }

  async createBucket(service: ServiceRow, docker: Docker, bucketName: string): Promise<void> {
    await this.setupAlias(service, docker);
    await execInServiceContainer(docker, service, ['mc', 'mb', `local/${bucketName}`], {
      throwOnNonZeroExit: true,
    });
  }

  async deleteBucket(service: ServiceRow, docker: Docker, bucketName: string): Promise<void> {
    await this.setupAlias(service, docker);
    await execInServiceContainer(docker, service, ['mc', 'rb', `local/${bucketName}`], {
      throwOnNonZeroExit: true,
    });
  }
}
