#!/usr/bin/env node
/**
 * start-test-backend.mjs — boots a seeded Postgres backend for contract tests.
 *
 * 1. Resets the configured Postgres schema.
 * 2. Runs drizzle migrations through the project's Database connector.
 * 3. Loads the contract seed fixture.
 * 4. Spawns the backend with OPENLANDER_DATABASE_URL + PORT env vars.
 * 5. Polls /health until HTTP 200 or 30s timeout.
 * 6. Writes the port to .test-backend-port and the PID to .test-backend-pid.
 */
import postgres from 'postgres';
import { spawnSync, spawn } from 'child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WEB_DIR = join(REPO_ROOT, 'web');
const SEED_SQL = join(WEB_DIR, 'tests', 'contract', 'fixtures', 'seed.sql');
const PID_FILE = join(WEB_DIR, '.test-backend-pid');
const PORT_FILE = join(WEB_DIR, '.test-backend-port');
const TOKEN_FILE = join(WEB_DIR, '.test-backend-token');
const PORT = parseInt(process.env.CONTRACT_TEST_PORT ?? '10117', 10);
const BOOT_TIMEOUT_MS = 30_000;
const DATABASE_URL =
  process.env.OPENLANDER_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:test@127.0.0.1:5432/openlander_test';

for (const p of [PID_FILE, PORT_FILE, TOKEN_FILE]) {
  if (existsSync(p)) unlinkSync(p);
}

async function resetDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await sql`CREATE SCHEMA public`;
    await sql`GRANT ALL ON SCHEMA public TO public`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function splitSqlStatements(source) {
  return source
    .split(/;\s*(?:\n|$)/)
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

async function seedDatabase(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const seedSql = readFileSync(SEED_SQL, 'utf8');
    for (const statement of splitSqlStatements(seedSql)) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await resetDatabase(DATABASE_URL);

const migrateScript = join(__dirname, 'migrate-contract-db.mjs');
const migrateResult = spawnSync('npx', ['tsx', migrateScript], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    OPENLANDER_DATABASE_URL: DATABASE_URL,
    DATABASE_URL,
  },
});

if (migrateResult.status !== 0) {
  console.error(
    '[start-test-backend] drizzle migration failed:\n',
    migrateResult.stdout,
    migrateResult.stderr,
  );
  process.exit(1);
}

await seedDatabase(DATABASE_URL);

const bootScript = join(__dirname, 'boot-test-server.mjs');
const child = spawn('npx', ['tsx', bootScript, String(PORT)], {
  detached: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: String(PORT),
    OPENLANDER_DATABASE_URL: DATABASE_URL,
    DATABASE_URL,
    NODE_ENV: 'test',
  },
  cwd: REPO_ROOT,
});

child.unref();

writeFileSync(PID_FILE, String(child.pid));
writeFileSync(PORT_FILE, String(PORT));

console.log(`[start-test-backend] spawned PID ${child.pid} on port ${PORT}`);

const deadline = Date.now() + BOOT_TIMEOUT_MS;

while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    if (res.ok) {
      console.log('[start-test-backend] backend healthy — ready for contract tests');
      process.exit(0);
    }
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error('[start-test-backend] timed out waiting for backend to boot');
process.exit(1);
