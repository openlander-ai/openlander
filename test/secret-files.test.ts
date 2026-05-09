import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';

describe('Secret file mount', () => {
  let db: Database;
  let env: EnvManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-secret-files-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);

    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
    db.createProject({ id: 'p2', name: 'other-app', repoUrl: 'https://github.com/test/b' });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uploads and retrieves a project-scoped secret file', () => {
    env.uploadSecretFile('p1', 'firebase-sa.json', '{"type":"service_account"}');

    const files = env.listSecretFiles('p1');
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      filename: 'firebase-sa.json',
      mountPath: '/run/secrets/firebase-sa.json',
      scope: 'project',
    });
  });

  it('uploads and retrieves a global secret file (project_id=null)', () => {
    env.uploadSecretFile(null, 'ca-cert.pem', '-----BEGIN CERTIFICATE-----');

    const files = env.listSecretFiles(null);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({
      filename: 'ca-cert.pem',
      mountPath: '/run/secrets/ca-cert.pem',
      scope: 'global',
    });
  });

  it('upserts (overwrites) an existing secret file', () => {
    env.uploadSecretFile('p1', 'creds.json', 'old-content');
    env.uploadSecretFile('p1', 'creds.json', 'new-content');

    const files = env.listSecretFiles('p1');
    expect(files).toHaveLength(1);

    const deployed = env.getSecretFilesForDeploy('p1');
    expect(deployed).toHaveLength(1);
    expect(deployed[0]!.content).toBe('new-content');
  });

  it('decrypts content correctly for deploy', () => {
    const content = '{"project_id":"my-gcp-project","private_key":"-----BEGIN RSA-----"}';
    env.uploadSecretFile('p1', 'gcp-sa.json', content);

    const deployed = env.getSecretFilesForDeploy('p1');
    expect(deployed).toHaveLength(1);
    expect(deployed[0]).toEqual({
      filename: 'gcp-sa.json',
      content,
      mountPath: '/run/secrets/gcp-sa.json',
    });
  });

  it('merges global and project secret files for deploy', () => {
    env.uploadSecretFile(null, 'global-cert.pem', 'global-cert-data');
    env.uploadSecretFile('p1', 'firebase-sa.json', '{"type":"service_account"}');

    const deployed = env.getSecretFilesForDeploy('p1');
    expect(deployed).toHaveLength(2);

    const filenames = deployed.map((f) => f.filename).sort();
    expect(filenames).toEqual(['firebase-sa.json', 'global-cert.pem']);
  });

  it('does not leak project secret files to other projects', () => {
    env.uploadSecretFile('p1', 'p1-secret.json', 'p1-data');
    env.uploadSecretFile('p2', 'p2-secret.json', 'p2-data');

    const p1Files = env.getSecretFilesForDeploy('p1');
    const p2Files = env.getSecretFilesForDeploy('p2');

    expect(p1Files.map((f) => f.filename)).toEqual(['p1-secret.json']);
    expect(p2Files.map((f) => f.filename)).toEqual(['p2-secret.json']);
  });

  it('global secret files are shared to all projects', () => {
    env.uploadSecretFile(null, 'shared.pem', 'shared-data');

    const p1Files = env.getSecretFilesForDeploy('p1');
    const p2Files = env.getSecretFilesForDeploy('p2');

    expect(p1Files.map((f) => f.filename)).toContain('shared.pem');
    expect(p2Files.map((f) => f.filename)).toContain('shared.pem');
  });

  it('removes a project secret file', () => {
    env.uploadSecretFile('p1', 'to-remove.json', 'data');
    expect(env.listSecretFiles('p1')).toHaveLength(1);

    const removed = env.removeSecretFile('p1', 'to-remove.json');
    expect(removed).toBe(true);
    expect(env.listSecretFiles('p1')).toHaveLength(0);
  });

  it('removes a global secret file', () => {
    env.uploadSecretFile(null, 'global-remove.pem', 'data');
    expect(env.listSecretFiles(null)).toHaveLength(1);

    const removed = env.removeSecretFile(null, 'global-remove.pem');
    expect(removed).toBe(true);
    expect(env.listSecretFiles(null)).toHaveLength(0);
  });

  it('returns false when removing a non-existent file', () => {
    const removed = env.removeSecretFile('p1', 'does-not-exist.json');
    expect(removed).toBe(false);
  });

  it('supports custom mount path', () => {
    env.uploadSecretFile('p1', 'nginx.conf', 'server {}', '/etc/nginx');

    const files = env.listSecretFiles('p1');
    expect(files[0]!.mountPath).toBe('/etc/nginx/nginx.conf');

    const deployed = env.getSecretFilesForDeploy('p1');
    expect(deployed[0]!.mountPath).toBe('/etc/nginx/nginx.conf');
  });

  it('content is encrypted in DB (not plaintext)', () => {
    env.uploadSecretFile('p1', 'secret.json', 'super-secret-content');

    const rawRows = db.getSecretFiles('p1');
    expect(rawRows).toHaveLength(1);
    expect(rawRows[0]!.encrypted_content).not.toBe('super-secret-content');
    expect(rawRows[0]!.encrypted_content).toBeTruthy();
    expect(rawRows[0]!.iv).toBeTruthy();
  });
});
