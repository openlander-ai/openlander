#!/usr/bin/env node
/**
 * migrate-contract-db.mjs — opens a Postgres database through the project's
 * Database connector so drizzle migrations run before contract seed loading.
 */
import { Database } from '../../src/db/index.ts';

const databaseUrl =
  process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? process.argv[2];

if (!databaseUrl) {
  console.error('Usage: OPENLANDER_DATABASE_URL=<postgres-url> migrate-contract-db.mjs');
  process.exit(1);
}

function redactDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<configured database url>';
  }
}

const db = await Database.connect(databaseUrl);
await db.close();
console.log(`[migrate-contract-db] migrated ${redactDatabaseUrl(databaseUrl)}`);
