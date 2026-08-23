import { MinioAdapter } from './minio-adapter.js';
import { MongoAdapter } from './mongo-adapter.js';
import { MySqlAdapter } from './mysql-adapter.js';
import { Neo4jAdapter } from './neo4j-adapter.js';
import { PostgresAdapter } from './postgres-adapter.js';
import { RabbitMqAdapter } from './rabbitmq-adapter.js';
import { RedisAdapter } from './redis-adapter.js';
import type { ServiceAdapter } from './types.js';

const postgresAdapter = new PostgresAdapter();
const mySqlAdapter = new MySqlAdapter();
const redisAdapter = new RedisAdapter();
const mongoAdapter = new MongoAdapter();
const neo4jAdapter = new Neo4jAdapter();
const minioAdapter = new MinioAdapter();
const rabbitMqAdapter = new RabbitMqAdapter();

export function getServiceAdapter(type: string): ServiceAdapter | null {
  switch (type) {
    case 'postgresql':
    case 'postgres': // canonical kind value from services.kind enum
      return postgresAdapter;
    case 'mysql':
      return mySqlAdapter;
    case 'redis':
      return redisAdapter;
    case 'mongodb':
    case 'mongo': // canonical kind value from services.kind enum
      return mongoAdapter;
    case 'neo4j':
      return neo4jAdapter;
    case 'minio':
      return minioAdapter;
    case 'rabbitmq':
      return rabbitMqAdapter;
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
