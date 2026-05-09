import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '../../src/db/index.js';
import {
  findMatchingPatterns,
  normalizeErrorSignature,
  saveRecoveryPattern,
} from '../../src/llm/memory.js';

describe('normalizeErrorSignature', () => {
  it('removes ISO timestamps', () => {
    const input = 'Error at 2024-03-15T14:30:45.123Z during build';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain('2024');
    expect(result).toContain('Error at');
    expect(result).toContain('during build');
  });

  it('removes absolute paths', () => {
    const input = 'ENOENT: no such file /home/user/project/src/index.ts';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain('/home/user');
    expect(result).toContain('ENOENT');
  });

  it('removes /var, /tmp, /usr, /app, /workspace paths', () => {
    const input = 'Failed at /var/log/syslog and /tmp/build-123/out and /usr/lib/node';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain('/var/log');
    expect(result).not.toContain('/tmp/build');
    expect(result).not.toContain('/usr/lib');
  });

  it('removes hex hashes of 8+ chars', () => {
    const input = 'Container a1b2c3d4e5f6 exited with error';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain('a1b2c3d4e5f6');
    expect(result).toContain('Container');
    expect(result).toContain('exited with error');
  });

  it('removes line numbers', () => {
    const input = 'SyntaxError in file:42 column:10';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain(':42');
    expect(result).not.toContain(':10');
  });

  it('normalizes whitespace', () => {
    const input = 'Error   at   some   location\n\nnewlines  too';
    const result = normalizeErrorSignature(input);
    expect(result).not.toContain('  ');
    expect(result).not.toContain('\n');
  });

  it('truncates to 200 chars', () => {
    const input = 'A'.repeat(500);
    const result = normalizeErrorSignature(input);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('produces identical signatures for equivalent errors', () => {
    const error1 =
      'Error at 2024-01-01T00:00:00Z in /home/alice/project: container abc12345678 failed';
    const error2 =
      'Error at 2025-06-15T12:30:00Z in /home/bob/project: container def87654321 failed';
    expect(normalizeErrorSignature(error1)).toBe(normalizeErrorSignature(error2));
  });

  it('returns empty string for empty input', () => {
    expect(normalizeErrorSignature('')).toBe('');
  });

  it('preserves meaningful error content', () => {
    const input = 'ECONNREFUSED: Connection refused';
    const result = normalizeErrorSignature(input);
    expect(result).toContain('ECONNREFUSED');
    expect(result).toContain('Connection refused');
  });
});

describe('saveRecoveryPattern', () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-memory-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a pattern and records success', () => {
    const projectId = 'test-project-1';
    const errorLog = 'ECONNREFUSED: Connection refused at 2024-01-01T00:00:00Z';
    const fixAction = JSON.stringify({ strategy: 'recipe', recipe: 'retry-connection' });

    saveRecoveryPattern(db, projectId, errorLog, fixAction, true, 'dependency_unavailable');

    const patterns = db.findDeploymentPatternsByProject(projectId);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.pattern_type).toBe('dependency_unavailable');
    expect(patterns[0]?.fix_action).toBe(fixAction);
    expect(patterns[0]?.success_count).toBe(1);
    expect(patterns[0]?.failure_count).toBe(0);
  });

  it('creates a pattern and records failure', () => {
    const projectId = 'test-project-2';
    const errorLog = 'OOMKilled: out of memory';
    const fixAction = JSON.stringify({ strategy: 'llm' });

    saveRecoveryPattern(db, projectId, errorLog, fixAction, false, 'resource_oom');

    const patterns = db.findDeploymentPatternsByProject(projectId);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.success_count).toBe(0);
    expect(patterns[0]?.failure_count).toBe(1);
  });

  it('upserts the same error signature and accumulates counts', () => {
    const projectId = 'test-project-3';
    const fixAction = JSON.stringify({ strategy: 'recipe' });

    saveRecoveryPattern(
      db,
      projectId,
      'ECONNREFUSED at 2024-01-01T00:00:00Z',
      fixAction,
      true,
      'dependency_unavailable',
    );
    saveRecoveryPattern(
      db,
      projectId,
      'ECONNREFUSED at 2025-06-15T12:00:00Z',
      fixAction,
      true,
      'dependency_unavailable',
    );
    saveRecoveryPattern(
      db,
      projectId,
      'ECONNREFUSED at 2025-07-01T08:00:00Z',
      fixAction,
      false,
      'dependency_unavailable',
    );

    const patterns = db.findDeploymentPatternsByProject(projectId);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.success_count).toBe(2);
    expect(patterns[0]?.failure_count).toBe(1);
  });

  it('skips save for empty error log', () => {
    const projectId = 'test-project-4';
    saveRecoveryPattern(db, projectId, '', '{}', true, 'unknown');

    const patterns = db.findDeploymentPatternsByProject(projectId);
    expect(patterns).toHaveLength(0);
  });
});

describe('findMatchingPatterns', () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-memory-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds a matching pattern by normalized signature', () => {
    const projectId = 'test-project-5';
    saveRecoveryPattern(
      db,
      projectId,
      'ECONNREFUSED at 2024-01-01T00:00:00Z from /home/user/app',
      '{}',
      true,
      'dependency_unavailable',
    );

    const matches = findMatchingPatterns(
      db,
      projectId,
      'ECONNREFUSED at 2025-12-25T23:59:59Z from /home/other/app',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.pattern_type).toBe('dependency_unavailable');
  });

  it('returns empty array when no patterns match', () => {
    const projectId = 'test-project-6';
    saveRecoveryPattern(db, projectId, 'OOMKilled', '{}', true, 'resource_oom');

    const matches = findMatchingPatterns(db, projectId, 'ECONNREFUSED');
    expect(matches).toHaveLength(0);
  });

  it('returns empty array for empty error log', () => {
    const matches = findMatchingPatterns(db, 'any-project', '');
    expect(matches).toHaveLength(0);
  });

  it('does not match patterns from other projects', () => {
    saveRecoveryPattern(db, 'project-a', 'ECONNREFUSED', '{}', true, 'dependency_unavailable');

    const matches = findMatchingPatterns(db, 'project-b', 'ECONNREFUSED');
    expect(matches).toHaveLength(0);
  });
});
