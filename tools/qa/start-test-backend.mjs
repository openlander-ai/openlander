#!/usr/bin/env node
/**
 * start-test-backend.mjs — boots a seeded backend for contract tests.
 *
 * 1. Picks a free port (default 10117 or $CONTRACT_TEST_PORT).
 * 2. Runs sqlite3 to load the seed fixture into /tmp/ol-contract-test.db.
 * 3. Spawns the backend with OPENLANDER_DB_PATH + PORT env vars.
 * 4. Polls /api/health until HTTP 200 or 30s timeout.
 * 5. Writes the port to .test-backend-port and the PID to .test-backend-pid.
 *
 * The posttest:contract script (stop-test-backend.mjs) reads those files
 * and tears down cleanly.
 */
import { spawnSync, spawn } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WEB_DIR = join(REPO_ROOT, 'web');
const SEED_SQL = join(WEB_DIR, 'tests', 'contract', 'fixtures', 'seed.sql');
const DB_PATH = '/tmp/ol-contract-test.db';
const PID_FILE = join(WEB_DIR, '.test-backend-pid');
const PORT_FILE = join(WEB_DIR, '.test-backend-port');
const PORT = parseInt(process.env.CONTRACT_TEST_PORT ?? '10117', 10);
const BOOT_TIMEOUT_MS = 30_000;

// ── 1. Seed the database ─────────────────────────────────────────────────────

// Remove stale db from any prior run
if (existsSync(DB_PATH)) {
  spawnSync('rm', ['-f', DB_PATH]);
}

const seedSql = readFileSync(SEED_SQL, 'utf8');
const seedResult = spawnSync('sqlite3', [DB_PATH], {
  input: seedSql,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});

// sqlite3 may not be available; warn but don't abort (backend seeds on boot too)
if (seedResult.error) {
  console.warn('[start-test-backend] sqlite3 not found — seed skipped; backend must self-seed');
} else if (seedResult.status !== 0) {
  console.error('[start-test-backend] seed.sql failed:\n', seedResult.stderr);
  process.exit(1);
}

// ── 2. Spawn the backend ──────────────────────────────────────────────────────

const backendEntry = join(REPO_ROOT, 'src', 'index.ts');
const useTs = existsSync(backendEntry);
const cmd = useTs ? 'npx' : 'node';
const args = useTs
  ? ['tsx', backendEntry]
  : [join(REPO_ROOT, 'dist', 'index.js')];

const child = spawn(cmd, args, {
  detached: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    PORT: String(PORT),
    OPENLANDER_DB_PATH: DB_PATH,
    NODE_ENV: 'test',
  },
  cwd: REPO_ROOT,
});

child.unref();

writeFileSync(PID_FILE, String(child.pid));
writeFileSync(PORT_FILE, String(PORT));

console.log(`[start-test-backend] spawned PID ${child.pid} on port ${PORT}`);

// ── 3. Poll /api/health ───────────────────────────────────────────────────────

const deadline = Date.now() + BOOT_TIMEOUT_MS;

async function poll() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) {
        console.log('[start-test-backend] backend healthy — ready for contract tests');
        process.exit(0);
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('[start-test-backend] timed out waiting for backend to boot');
  process.exit(1);
}

poll();
