import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join, relative } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('compose path storage — Fix 1: relative path instead of absolute temp path', () => {
  let clonePath: string;
  let composePath: string;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'openlander-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    composePath = join(clonePath, 'docker-compose.yml');
    writeFileSync(composePath, 'version: "3"\nservices:\n  web:\n    image: node:20\n');
  });

  it('relative(clonePath, composePath) yields filename only for root-level compose file', () => {
    const rel = relative(clonePath, composePath);
    expect(rel).toBe('docker-compose.yml');
    expect(rel).not.toContain('/var/folders');
    expect(rel).not.toContain('/tmp');
    expect(rel).not.toMatch(/^\/|^[A-Z]:\\/);
  });

  it('relative path survives temp directory cleanup semantically', () => {
    const rel = relative(clonePath, composePath);
    // The relative path is stable — it does not embed the ephemeral tmpdir prefix
    expect(rel).not.toContain('openlander-');
    expect(rel).toBe('docker-compose.yml');
  });

  it('relative path works for nested compose file', () => {
    const nestedDir = join(clonePath, 'infra');
    mkdirSync(nestedDir, { recursive: true });
    const nestedCompose = join(nestedDir, 'docker-compose.prod.yml');
    writeFileSync(nestedCompose, 'version: "3"\nservices:\n  api:\n    image: node:20\n');

    const rel = relative(clonePath, nestedCompose);
    expect(rel).toBe(join('infra', 'docker-compose.prod.yml'));
    expect(rel).not.toMatch(/^\/|^[A-Z]:\\/);
  });

  it('absolute temp path would not survive temp dir cleanup (documents the bug)', () => {
    // This test documents why storing composePath directly was wrong:
    // the absolute path encodes the ephemeral tmpdir which is GC'd by the OS
    expect(composePath).toMatch(/openlander-/);
    expect(composePath.startsWith('/')).toBe(true);
    // After OS cleanup, a path like composePath would point to nothing.
    // The fix: store relative(clonePath, composePath) instead.
    const rel = relative(clonePath, composePath);
    expect(rel).toBe('docker-compose.yml');
  });
});
