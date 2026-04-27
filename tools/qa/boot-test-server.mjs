#!/usr/bin/env node
/**
 * boot-test-server.mjs — minimal server boot for contract tests.
 *
 * Called by start-test-backend.mjs (spawned detached). Bypasses the CLI's
 * ensureDocker() / Traefik-start guards so the backend starts cleanly in a
 * CI / local test environment that may not have Docker available.
 *
 * Usage: tsx tools/qa/boot-test-server.mjs <port>
 *
 * Reads OPENLANDER_DB_PATH from env (set by start-test-backend.mjs).
 *
 * After booting, writes the generated API token to
 * web/.test-backend-token so contract tests can authenticate.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WEB_DIR = join(REPO_ROOT, 'web');
const TOKEN_FILE = join(WEB_DIR, '.test-backend-token');

const port = parseInt(process.argv[2] ?? '10117', 10);
const dbPath = process.env.OPENLANDER_DB_PATH;
if (!dbPath) {
  console.error('[boot-test-server] OPENLANDER_DB_PATH not set');
  process.exit(1);
}

// Lazy-import so tsx resolves TypeScript sources.
const { loadConfig } = await import('../../src/config/index.ts');
const { createAppContext } = await import('../../src/app.ts');
const { createServer } = await import('../../src/web/server.ts');
const { setupPassword } = await import('../../src/auth/auth-service.ts');
const { Database } = await import('../../src/db/index.ts');

const config = await loadConfig();
config.server.port = port;

// createAppContext constructs Docker/Traefik objects but does NOT connect —
// safe to call even when Docker is unavailable. The health endpoint and all
// DB-backed routes work without a live Docker daemon.
const ctx = await createAppContext(config, dbPath);

// Set up auth with a known test password so the auth middleware lets through
// API requests. Database implements AuthDatabase directly, so it can be passed
// straight to setupPassword. The generated API token is written to
// .test-backend-token so contract tests can authenticate via
// Authorization: Bearer <token>.
const authDb = new Database(dbPath);
const { apiToken } = setupPassword(authDb, 'contract-test-password');
authDb.close();
writeFileSync(TOKEN_FILE, apiToken, 'utf8');
console.log(`[boot-test-server] auth configured, token written to ${TOKEN_FILE}`);

createServer({ port, host: '0.0.0.0' }, ctx);
console.log(`[boot-test-server] server listening on port ${port}`);
