/**
 * CLI lifecycle smoke tests for B1 fix (1.0 GA).
 *
 * Verifies that `openlander stop` and `openlander restart` no longer pretend
 * to manage a background daemon. Both should:
 *   - Exit cleanly (exit code 0).
 *   - Print user-facing guidance pointing at systemd / pm2 / docker.
 *   - Best-effort clean up any stale daemon socket / pid file from older
 *     installs (stop only).
 *
 * These tests deliberately do NOT exercise `openlander start` end-to-end —
 * that path requires Docker, a config dir, and would block the test process
 * because the server is foreground-only. We test the side-effects of `start`
 * separately via the help text.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI_ENTRY = join(__dirname, '..', '..', 'src', 'cli', 'index.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runCli(args: string[], dataDir: string): CliResult {
  const env = { ...process.env, HOME: dataDir, USERPROFILE: dataDir };
  const result = spawnSync('npx', ['tsx', CLI_ENTRY, ...args], {
    env,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

describe('CLI lifecycle commands (1.0 GA: foreground-only)', () => {
  let tmpHome: string;
  let openlanderDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'openlander-cli-test-'));
    openlanderDir = join(tmpHome, '.openlander');
    mkdirSync(openlanderDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // Each `runCli` invocation spawns `npx tsx` and re-imports the CLI graph
  // — cold-start can exceed vitest's 5s default when other suites contend
  // for CPU. Match the in-test 30s spawn budget so the suite is not flaky
  // under parallel load.
  const CLI_TEST_TIMEOUT_MS = 30_000;

  describe('openlander stop', () => {
    it(
      'exits 0 and prints supervisor guidance when nothing is running',
      () => {
        const result = runCli(['stop'], tmpHome);

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/does not run as a background daemon/i);
        expect(result.stdout).toMatch(/systemctl|pm2|docker/);
      },
      CLI_TEST_TIMEOUT_MS,
    );

    it(
      'removes stale daemon socket and pid file from older installs',
      () => {
        const socketPath = join(openlanderDir, 'openlander.sock');
        const pidPath = join(openlanderDir, 'openlander.pid');
        writeFileSync(socketPath, '');
        writeFileSync(pidPath, '99999');

        const result = runCli(['stop'], tmpHome);

        expect(result.status).toBe(0);
        expect(existsSync(socketPath)).toBe(false);
        expect(existsSync(pidPath)).toBe(false);
        expect(result.stdout).toMatch(/Cleaned up stale daemon artifacts/i);
      },
      CLI_TEST_TIMEOUT_MS,
    );
  });

  describe('openlander restart', () => {
    it(
      'exits 0 and points the user at the supervisor (no double-start)',
      () => {
        const result = runCli(['restart'], tmpHome);

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/does not run as a background daemon/i);
        expect(result.stdout).toMatch(/systemctl|pm2|docker/);
      },
      CLI_TEST_TIMEOUT_MS,
    );

    it(
      'does not create or touch socket/pid files',
      () => {
        const socketPath = join(openlanderDir, 'openlander.sock');
        const pidPath = join(openlanderDir, 'openlander.pid');

        runCli(['restart'], tmpHome);

        expect(existsSync(socketPath)).toBe(false);
        expect(existsSync(pidPath)).toBe(false);
      },
      CLI_TEST_TIMEOUT_MS,
    );
  });

  describe('openlander start --help', () => {
    it(
      'documents that start runs in the foreground',
      () => {
        const result = runCli(['start', '--help'], tmpHome);

        expect(result.status).toBe(0);
        expect(result.stdout.toLowerCase()).toContain('foreground');
      },
      CLI_TEST_TIMEOUT_MS,
    );
  });
});
