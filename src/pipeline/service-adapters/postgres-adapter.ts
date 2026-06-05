import type { ServiceRow } from '../../db/index.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { waitUntilReady } from '../lib/retry.js';
import { execInServiceContainer, parseServiceCredentials, quoteSqlLiteral } from './shared.js';
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

export class PostgresAdapter implements ServiceAdapter {
  readonly type = 'postgresql' as const;

  getDataMountPath(): string {
    return '/var/lib/postgresql/data';
  }

  getConnectionString(containerName: string, port: number, creds?: ServiceCredentials): string {
    if (!creds) {
      throw new Error('Credentials required for postgresql');
    }

    const user = encodeURIComponent(creds.user);
    const password = encodeURIComponent(creds.password);
    const database = encodeURIComponent(creds.database);
    return `postgresql://${user}:${password}@${containerName}:${String(port)}/${database}`;
  }

  async waitForReady(service: ServiceRow, runtime: RuntimeBackend): Promise<void> {
    const credentials = parseServiceCredentials(service);
    await waitUntilReady(
      async () => {
        const result = await execInServiceContainer(
          runtime,
          service,
          ['pg_isready', '-U', credentials.user, '-d', 'postgres'],
          { throwOnNonZeroExit: false },
        );
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || result.stdout.trim());
        }
        const credentialResult = await execInServiceContainer(
          runtime,
          service,
          [
            'sh',
            '-c',
            'PGPASSWORD="$1" psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U "$2" -d "$3" -t -A -c "SELECT 1"',
            'openlander-pg-ready',
            credentials.password,
            credentials.user,
            credentials.database,
          ],
          { throwOnNonZeroExit: false },
        );
        if (credentialResult.exitCode !== 0) {
          throw new Error(credentialResult.stderr.trim() || credentialResult.stdout.trim());
        }
      },
      {
        maxAttempts: 30,
        intervalMs: 1000,
        description: `PostgreSQL service: ${service.id}`,
      },
    );
  }

  async getConnectionStats(service: ServiceRow, runtime: RuntimeBackend): Promise<ConnectionStats> {
    const credentials = parseServiceCredentials(service);
    const connResult = await execInServiceContainer(runtime, service, [
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
    const maxResult = await execInServiceContainer(runtime, service, [
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

    return {
      activeConnections: Number.parseInt(connResult.stdout.trim(), 10) || 0,
      maxConnections: Number.parseInt(maxResult.stdout.trim(), 10) || null,
    };
  }

  async listDatabases(service: ServiceRow, runtime: RuntimeBackend): Promise<ListedDatabase[]> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, runtime);

    const result = await execInServiceContainer(runtime, service, [
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

  async listUsers(service: ServiceRow, runtime: RuntimeBackend): Promise<ListedUser[]> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, runtime);

    const result = await execInServiceContainer(runtime, service, [
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

  async createDatabase(
    service: ServiceRow,
    dbName: string,
    runtime: RuntimeBackend,
  ): Promise<CreateDatabaseResult> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, runtime);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const hostPort = service.assigned_port ?? service.port;

    await execInServiceContainer(runtime, service, [
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      credentials.user,
      '-d',
      'postgres',
      '-c',
      `CREATE DATABASE ${quotePostgresIdentifier(dbName)}`,
    ]);

    return {
      database: dbName,
      user: credentials.user,
      password: credentials.password,
      connectionString: this.getConnectionString(service.container_name ?? '', hostPort ?? 0, {
        user: credentials.user,
        password: credentials.password,
        database: dbName,
      }),
    };
  }

  async createUser(
    service: ServiceRow,
    options: CreateUserOptions,
    runtime: RuntimeBackend,
  ): Promise<CreateUserResult> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, runtime);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const hostPort = service.assigned_port ?? service.port;

    await execInServiceContainer(runtime, service, [
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      credentials.user,
      '-d',
      'postgres',
      '-c',
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteSqlLiteral(options.username)}) THEN CREATE ROLE ${quotePostgresIdentifier(options.username)} LOGIN PASSWORD ${quoteSqlLiteral(options.password)}; ELSE ALTER ROLE ${quotePostgresIdentifier(options.username)} LOGIN PASSWORD ${quoteSqlLiteral(options.password)}; END IF; END $$;`,
    ]);

    const grantDatabase = options.grants?.database;
    if (grantDatabase) {
      await execInServiceContainer(runtime, service, [
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        credentials.user,
        '-d',
        'postgres',
        '-c',
        `GRANT ALL PRIVILEGES ON DATABASE ${quotePostgresIdentifier(grantDatabase)} TO ${quotePostgresIdentifier(options.username)};`,
      ]);
      await execInServiceContainer(runtime, service, [
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        credentials.user,
        '-d',
        grantDatabase,
        '-c',
        [
          `GRANT USAGE, CREATE ON SCHEMA public TO ${quotePostgresIdentifier(options.username)};`,
          `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${quotePostgresIdentifier(options.username)};`,
          `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${quotePostgresIdentifier(options.username)};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${quotePostgresIdentifier(options.username)};`,
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${quotePostgresIdentifier(options.username)};`,
        ].join(' '),
      ]);
    }

    const database = grantDatabase ?? credentials.database;
    return {
      database,
      user: options.username,
      password: options.password,
      connectionString: this.getConnectionString(service.container_name ?? '', hostPort ?? 0, {
        user: options.username,
        password: options.password,
        database,
      }),
    };
  }
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
