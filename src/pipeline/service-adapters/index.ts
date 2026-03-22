import { MongoAdapter } from './mongo-adapter.js';
import { MySqlAdapter } from './mysql-adapter.js';
import { PostgresAdapter } from './postgres-adapter.js';
import { RedisAdapter } from './redis-adapter.js';
import type { ServiceAdapter } from './types.js';

const postgresAdapter = new PostgresAdapter();
const mySqlAdapter = new MySqlAdapter();
const redisAdapter = new RedisAdapter();
const mongoAdapter = new MongoAdapter();

export function getServiceAdapter(type: string): ServiceAdapter | null {
  switch (type) {
    case 'postgresql':
      return postgresAdapter;
    case 'mysql':
      return mySqlAdapter;
    case 'redis':
      return redisAdapter;
    case 'mongodb':
      return mongoAdapter;
    default:
      return null;
  }
}

export type {
  BuiltInServiceType,
  ConnectionStats,
  CreateDatabaseResult,
  CreateUserOptions,
  CreateUserResult,
  ListedDatabase,
  ListedUser,
  ServiceAdapter,
  ServiceCredentials,
} from './types.js';
