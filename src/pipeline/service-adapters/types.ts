import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';

export type BuiltInServiceType =
  | 'postgresql'
  | 'mysql'
  | 'redis'
  | 'mongodb'
  | 'minio'
  | 'rabbitmq';

export interface ServiceCredentials {
  user: string;
  password: string;
  database: string;
}

export interface ListedDatabase {
  name: string;
  sizeBytes: number | null;
}

export interface ListedUser {
  name: string;
}

export interface CreateDatabaseResult {
  database: string;
  user?: string;
  password?: string;
  connectionString?: string;
}

export interface CreateUserResult {
  database: string;
  user: string;
  password: string;
  connectionString: string;
}

export interface CreateUserOptions {
  username: string;
  password: string;
  grants?: { database: string };
}

export interface ConnectionStats {
  activeConnections: number | null;
  maxConnections: number | null;
}

export interface ContainerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated?: boolean;
}

export interface ServiceAdapter {
  readonly type: BuiltInServiceType;
  getDataMountPath(): string;
  getConnectionString(containerName: string, port: number, creds?: ServiceCredentials): string;
  waitForReady(service: ServiceRow, docker: Docker): Promise<void>;
  getConnectionStats(service: ServiceRow, docker: Docker): Promise<ConnectionStats>;
  listDatabases(service: ServiceRow, docker: Docker): Promise<ListedDatabase[]>;
  listUsers(service: ServiceRow, docker: Docker): Promise<ListedUser[]>;
  createDatabase(
    service: ServiceRow,
    dbName: string,
    docker: Docker,
  ): Promise<CreateDatabaseResult>;
  createUser(
    service: ServiceRow,
    options: CreateUserOptions,
    docker: Docker,
  ): Promise<CreateUserResult>;
}
