#!/usr/bin/env node
/**
 * stop-test-backend.mjs — tears down the contract-test backend.
 *
 * Reads .test-backend-pid, sends SIGTERM, then removes web test metadata files.
 */
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', '..', 'web');
const PID_FILE = join(WEB_DIR, '.test-backend-pid');
const PORT_FILE = join(WEB_DIR, '.test-backend-port');
const TOKEN_FILE = join(WEB_DIR, '.test-backend-token');

if (existsSync(PID_FILE)) {
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  if (!isNaN(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[stop-test-backend] sent SIGTERM to PID ${pid}`);
    } catch (err) {
      // Process may have already exited
      console.warn(`[stop-test-backend] could not kill PID ${pid}: ${err.message}`);
    }
  }
  unlinkSync(PID_FILE);
}

if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);

console.log('[stop-test-backend] cleanup complete');
