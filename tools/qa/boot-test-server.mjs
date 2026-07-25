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
 * Reads OPENLANDER_DATABASE_URL from env (set by start-test-backend.mjs).
 * After booting, writes the generated API token to web/.test-backend-token
 * so contract tests can authenticate.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const WEB_DIR = join(REPO_ROOT, 'web');
const TOKEN_FILE = join(WEB_DIR, '.test-backend-token');

const port = parseInt(process.argv[2] ?? '10117', 10);
const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[boot-test-server] OPENLANDER_DATABASE_URL not set');
  process.exit(1);
}

// Lazy-import so tsx resolves TypeScript sources.
const { loadConfig } = await import('../../src/config/index.ts');
const { createAppContext } = await import('../../src/app.ts');
const { createServer } = await import('../../src/web/server.ts');
const { setupPassword } = await import('../../src/auth/auth-service.ts');
const { ArtifactStore } = await import('../../src/delivery/artifact-store.ts');
const { DeliveryService } = await import('../../src/delivery/delivery-service.ts');

const config = await loadConfig();
config.server.port = port;
const isolatedDockerSocket = process.env.OPENLANDER_TEST_DOCKER_SOCKET?.trim();
if (isolatedDockerSocket) {
  config.docker.socketPath = isolatedDockerSocket;
  console.log(`[boot-test-server] Docker isolated on ${isolatedDockerSocket}`);
}

// createAppContext constructs Docker/Traefik objects but does NOT connect to
// Docker. The health endpoint and DB-backed routes work without a live Docker
// daemon, which keeps contract tests runnable in CI.
const ctx = await createAppContext(config, databaseUrl);
const isolatedDataDir = process.env.OPENLANDER_TEST_DATA_DIR?.trim();
if (isolatedDataDir) {
  ctx.artifactStore = new ArtifactStore(isolatedDataDir);
  ctx.deliveryService = new DeliveryService(ctx.db, ctx.artifactStore);
  console.log(`[boot-test-server] Delivery artifacts isolated under ${isolatedDataDir}`);
}

// Set up auth with a known test password so the auth middleware lets through
// API requests. The generated API token is written to .test-backend-token so
// contract tests can authenticate via Authorization: Bearer <token>.
const { apiToken } = await setupPassword(ctx.db, 'contract-test-password');
writeFileSync(TOKEN_FILE, apiToken, 'utf8');
console.log(`[boot-test-server] auth configured, token written to ${TOKEN_FILE}`);

createServer({ port, host: '0.0.0.0' }, ctx);
console.log(`[boot-test-server] server listening on port ${port}`);
