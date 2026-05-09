import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { OpenLanderError } from '../errors.js';
import { drizzleSchema } from './schema.drizzle.js';

export type DrizzleClient = PostgresJsDatabase<typeof drizzleSchema>;
export type PostgresClient = Sql;

export function createDrizzleDatabase(databaseUrl: string): {
  client: PostgresClient;
  db: DrizzleClient;
} {
  if (!databaseUrl.trim()) {
    throw new OpenLanderError(
      'Postgres database URL is not configured. Set OPENLANDER_DATABASE_URL or DATABASE_URL.',
      'DATABASE_NOT_CONFIGURED',
      500,
    );
  }

  const client = postgres(databaseUrl, {
    max: Number.parseInt(process.env.OPENLANDER_DB_POOL_SIZE ?? '10', 10),
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema: drizzleSchema }),
  };
}
