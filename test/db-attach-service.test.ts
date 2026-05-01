import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../src/db/index.js';
import { ProjectNotFoundError, RepoPersistenceError } from '../src/errors.js';

describe('Database.attachServiceToProject', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-attach-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves the service.project_id from source to target and deletes source project', () => {
    db.createProject({ id: 'target', name: 'target-app', repoUrl: 'https://example.test/t' });
    db.createProject({ id: 'src', name: 'temp-svc', repoUrl: 'https://example.test/s' });

    const svcBefore = db.getService('src__svc');
    expect(svcBefore?.project_id).toBe('src');

    const result = db.attachServiceToProject('src__svc', 'target');
    expect(result.sourceProjectId).toBe('src');
    expect(result.targetProjectId).toBe('target');

    const svcAfter = db.getService('src__svc');
    expect(svcAfter?.project_id).toBe('target');

    expect(db.getProject('src')).toBeUndefined();
    expect(db.getProject('target')).toBeDefined();
  });

  it('moves group-shared env_vars to target and drops UNIQUE-conflict losers', () => {
    db.createProject({ id: 'target', name: 'target-app', repoUrl: 'https://example.test/t' });
    db.createProject({ id: 'src', name: 'temp-svc', repoUrl: 'https://example.test/s' });

    // Group-shared (no environment_id) — survives attach as-is.
    db.setEnvVar('target', 'DATABASE_URL', 'postgres://target');
    db.setEnvVar('target', 'API_KEY', 'target-secret');
    db.setEnvVar('src', 'DATABASE_URL', 'postgres://src');
    db.setEnvVar('src', 'NEW_VAR', 'src-only');

    const result = db.attachServiceToProject('src__svc', 'target');

    const merged = db.getEnvVars('target');
    expect(merged['DATABASE_URL']).toBe('postgres://target'); // target wins on collision
    expect(merged['API_KEY']).toBe('target-secret'); // target's existing
    expect(merged['NEW_VAR']).toBe('src-only'); // moved from src

    // CCG #3: collision losers are reported back so the tool can surface them.
    expect(result.droppedEnvVarKeys).toEqual(['DATABASE_URL']);
    expect(result.droppedSecretFiles).toEqual([]);

    expect(db.getEnvVars('src')).toEqual({}); // source project gone
  });

  it('is a no-op when source equals target', () => {
    db.createProject({ id: 'p1', name: 'app', repoUrl: 'https://example.test/p' });

    const result = db.attachServiceToProject('p1__svc', 'p1');
    expect(result.sourceProjectId).toBe('p1');
    expect(result.targetProjectId).toBe('p1');

    expect(db.getProject('p1')).toBeDefined();
    expect(db.getService('p1__svc')?.project_id).toBe('p1');
  });

  it('throws on missing service', () => {
    db.createProject({ id: 'target', name: 'target-app', repoUrl: 'https://example.test/t' });
    expect(() => db.attachServiceToProject('does-not-exist', 'target')).toThrow(
      RepoPersistenceError,
    );
  });

  it('throws on missing target project', () => {
    db.createProject({ id: 'src', name: 'temp-svc', repoUrl: 'https://example.test/s' });
    expect(() => db.attachServiceToProject('src__svc', 'no-such-target')).toThrow(
      ProjectNotFoundError,
    );
  });
});
