import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
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

export class MySqlAdapter implements ServiceAdapter {
  readonly type = 'mysql' as const;

  getDataMountPath(): string {
    return '/var/lib/mysql';
  }

  getConnectionString(containerName: string, port: number, creds?: ServiceCredentials): string {
    if (!creds) {
      throw new Error('Credentials required for mysql');
    }

    const user = encodeURIComponent(creds.user);
    const password = encodeURIComponent(creds.password);
    const database = encodeURIComponent(creds.database);
    return `mysql://${user}:${password}@${containerName}:${String(port)}/${database}`;
  }

  async waitForReady(service: ServiceRow, docker: Docker): Promise<void> {
    const credentials = parseServiceCredentials(service);
    await waitUntilReady(
      async () => {
        const result = await execInServiceContainer(
          docker,
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
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || result.stdout.trim());
        }
      },
      {
        maxAttempts: 30,
        intervalMs: 1000,
        description: `MySQL service: ${service.id}`,
      },
    );
  }

  async getConnectionStats(service: ServiceRow, docker: Docker): Promise<ConnectionStats> {
    const credentials = parseServiceCredentials(service);
    const connResult = await execInServiceContainer(docker, service, [
      'mysql',
      '-N',
      '-uroot',
      `-p${credentials.password}`,
      '-e',
      'SELECT COUNT(*) FROM information_schema.processlist',
    ]);
    const maxResult = await execInServiceContainer(docker, service, [
      'mysql',
      '-N',
      '-uroot',
      `-p${credentials.password}`,
      '-e',
      "SHOW VARIABLES LIKE 'max_connections'",
    ]);
    const maxParts = maxResult.stdout.trim().split(/\s+/);

    return {
      activeConnections: Number.parseInt(connResult.stdout.trim(), 10) || 0,
      maxConnections: maxParts.length >= 2 ? Number.parseInt(maxParts[1] ?? '', 10) || null : null,
    };
  }

  async listDatabases(service: ServiceRow, docker: Docker): Promise<ListedDatabase[]> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, docker);

    const result = await execInServiceContainer(docker, service, [
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

  async listUsers(service: ServiceRow, docker: Docker): Promise<ListedUser[]> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, docker);

    const result = await execInServiceContainer(docker, service, [
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

  async createDatabase(
    service: ServiceRow,
    dbName: string,
    docker: Docker,
  ): Promise<CreateDatabaseResult> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, docker);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const hostPort = service.assigned_port ?? service.port;

    await execInServiceContainer(docker, service, [
      'mysql',
      '-uroot',
      `-p${credentials.password}`,
      '-e',
      `CREATE DATABASE IF NOT EXISTS ${quoteMySqlIdentifier(dbName)};`,
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
    docker: Docker,
  ): Promise<CreateUserResult> {
    const credentials = parseServiceCredentials(service);
    await this.waitForReady(service, docker);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const hostPort = service.assigned_port ?? service.port;

    await execInServiceContainer(docker, service, [
      'mysql',
      '-uroot',
      `-p${credentials.password}`,
      '-e',
      `CREATE USER IF NOT EXISTS ${quoteMySqlUserHost(options.username)} IDENTIFIED BY ${quoteSqlLiteral(options.password)}; ALTER USER ${quoteMySqlUserHost(options.username)} IDENTIFIED BY ${quoteSqlLiteral(options.password)};`,
    ]);

    const grantDatabase = options.grants?.database;
    if (grantDatabase) {
      await execInServiceContainer(docker, service, [
        'mysql',
        '-uroot',
        `-p${credentials.password}`,
        '-e',
        `GRANT ALL PRIVILEGES ON ${quoteMySqlIdentifier(grantDatabase)}.* TO ${quoteMySqlUserHost(options.username)}; FLUSH PRIVILEGES;`,
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

function quoteMySqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function quoteMySqlUserHost(username: string): string {
  return `${quoteSqlLiteral(username)}@'%'`;
}
