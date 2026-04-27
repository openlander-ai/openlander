#!/usr/bin/env node
/**
 * migrate-contract-db.mjs — opens an empty sqlite file via the project's
 * Database constructor so drizzle migrations run against it. Used by
 * start-test-backend.mjs before the seed fixture loads.
 *
 * Lives in tools/qa/ rather than as an inline `--eval` because
 * `import.meta.dirname` resolves to undefined inside `--eval`, and
 * the Database constructor relies on it to find the drizzle/ folder.
 */
import { Database } from '../../src/db/index.ts';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: migrate-contract-db.mjs <db-path>');
  process.exit(1);
}

const db = new Database(dbPath);
db.close();
console.log(`[migrate-contract-db] migrated ${dbPath}`);
