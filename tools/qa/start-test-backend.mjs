#!/usr/bin/env node
/**
 * start-test-backend.mjs — boots a seeded backend for contract tests.
 *
 * 1. Picks a free port (default 10117 or $CONTRACT_TEST_PORT).
 * 2. Opens /tmp/ol-contract-test.db via the project's Database constructor
 *    so drizzle migrations run against the empty file (the seed below
 *    cannot insert into projects/services/service_metrics tables that
 *    don't exist yet — Codex HIGH-2 root cause).
 * 3. Runs sqlite3 to load the seed fixture into the now-migrated DB.
 * 4. Spawns the backend with OPENLANDER_DB_PATH + PORT env vars.
 * 5. Polls /health until HTTP 200 or 30s timeout.
 * 6. Writes the port to .test-backend-port and the PID to .test-backend-pid.
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

// ── 1. Wipe stale DB artifacts ────────────────────────────────────────────────

for (const ext of ['', '-shm', '-wal']) {
  const p = `${DB_PATH}${ext}`;
  if (existsSync(p)) {
    spawnSync('rm', ['-f', p]);
  }
}

// ── 2. Run drizzle migrations against the empty DB ────────────────────────────
//
// The contract seed below assumes projects/services/service_metrics/deploy_logs
// tables exist. Without this step the seed fails with `no such table` and the
// backend never sees the fixture rows even though it self-migrates on boot
// (the seed runs FIRST, the backend boot runs second). Run the project's own
// Database constructor so both the migration sources and the foreign-key /
// PRAGMA setup match production exactly.

const migrateScript = join(__dirname, 'migrate-contract-db.mjs');
const migrateResult = spawnSync('npx', ['tsx', migrateScript, DB_PATH], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (migrateResult.status !== 0) {
  console.error(
    '[start-test-backend] drizzle migration failed:\n',
    migrateResult.stdout,
    migrateResult.stderr,
  );
  process.exit(1);
}

// ── 3. Seed the database ─────────────────────────────────────────────────────

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

// ── 4. Spawn the backend ──────────────────────────────────────────────────────
//
// Use tools/qa/boot-test-server.mjs rather than the CLI entry (src/cli/index.ts)
// because the CLI calls ensureDocker() and ctx.traefik.start() which fail when
// Docker is not available in CI / ephemeral test environments. boot-test-server
// calls createAppContext + createServer directly and skips those guards.
// OPENLANDER_DB_PATH (set in env below) is picked up by getDbPath() in
// src/config/index.ts so the test DB is used instead of ~/.openlander/openlander.db.

const bootScript = join(__dirname, 'boot-test-server.mjs');
const cmd = 'npx';
const args = ['tsx', bootScript, String(PORT)];

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

// ── 5. Poll /health ──────────────────────────────────────────────────────────
//
// The server exposes its health check at GET /health (no /api prefix) —
// see src/web/server.ts. Polling /api/health returns 404 and the backend
// never appears "ready", causing a 30s timeout failure.

const deadline = Date.now() + BOOT_TIMEOUT_MS;

async function poll() {
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
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error('[start-test-backend] timed out waiting for backend to boot');
  process.exit(1);
}

poll();
