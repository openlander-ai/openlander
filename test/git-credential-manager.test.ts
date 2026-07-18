import { access, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GitCredentialRow, GitCredentialServiceUsage } from '../src/db/types.js';
import { decrypt } from '../src/env/crypto.js';
import { GitCredentialInUseError, GitDeployKeyUnauthorizedError } from '../src/errors.js';
import {
  canonicalizeGitHubRepoUrl,
  GitCredentialManager,
  type VerifyGitRemote,
} from '../src/git-credentials/manager.js';

class MemoryGitCredentialDb {
  readonly rows = new Map<string, GitCredentialRow>();
  readonly usages = new Map<string, GitCredentialServiceUsage[]>();

  async createGitCredential(input: {
    id: string;
    name: string;
    repositoryUrl: string;
    repositoryKey: string;
    publicKey: string;
    fingerprint: string;
    encryptedPrivateKey: string;
    privateKeyIv: string;
  }): Promise<GitCredentialRow> {
    const now = new Date().toISOString();
    const row: GitCredentialRow = {
      id: input.id,
      name: input.name,
      provider: 'github',
      auth_type: 'deploy_key',
      repository_url: input.repositoryUrl,
      repository_key: input.repositoryKey,
      public_key: input.publicKey,
      fingerprint: input.fingerprint,
      encrypted_private_key: input.encryptedPrivateKey,
      private_key_iv: input.privateKeyIv,
      status: 'pending',
      default_branch: null,
      last_error_code: null,
      verified_at: null,
      last_used_at: null,
      created_at: now,
      updated_at: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async getGitCredential(id: string): Promise<GitCredentialRow | null> {
    return this.rows.get(id) ?? null;
  }

  async listGitCredentials(filters?: {
    repositoryKey?: string;
    status?: GitCredentialRow['status'];
  }): Promise<GitCredentialRow[]> {
    return [...this.rows.values()].filter(
      (row) =>
        (!filters?.repositoryKey || row.repository_key === filters.repositoryKey) &&
        (!filters?.status || row.status === filters.status),
    );
  }

  async setGitCredentialVerification(
    id: string,
    result: {
      status: 'verified' | 'failed';
      defaultBranch?: string | null;
      lastErrorCode?: string | null;
    },
  ): Promise<GitCredentialRow | null> {
    const current = this.rows.get(id);
    if (!current) return null;
    const updated: GitCredentialRow = {
      ...current,
      status: result.status,
      default_branch: result.defaultBranch ?? null,
      last_error_code: result.lastErrorCode ?? null,
      verified_at: result.status === 'verified' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async listGitCredentialUsages(
    ids: readonly string[],
  ): Promise<Map<string, GitCredentialServiceUsage[]>> {
    return new Map(ids.map((id) => [id, this.usages.get(id) ?? []]));
  }

  async deleteGitCredential(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}

const MASTER_KEY = Buffer.alloc(32, 7);

describe('canonicalizeGitHubRepoUrl', () => {
  it.each([
    'https://github.com/Team-SpaceY/incar-app.git',
    'git@github.com:Team-SpaceY/incar-app.git',
    'ssh://git@github.com/Team-SpaceY/incar-app.git',
    'github.com/Team-SpaceY/incar-app',
  ])('normalizes %s', (input) => {
    expect(canonicalizeGitHubRepoUrl(input)).toMatchObject({
      repositoryUrl: 'https://github.com/Team-SpaceY/incar-app',
      repositoryKey: 'github.com/team-spacey/incar-app',
      sshUrl: 'git@github.com:Team-SpaceY/incar-app.git',
    });
  });

  it('rejects non-GitHub and nested URLs', () => {
    expect(() => canonicalizeGitHubRepoUrl('https://gitlab.com/a/b')).toThrow(
      'Unsupported Git repository URL',
    );
    expect(() => canonicalizeGitHubRepoUrl('https://github.com/a/b/tree/main')).toThrow(
      'Unsupported Git repository URL',
    );
  });
});

describe('GitCredentialManager', () => {
  it('generates an encrypted ED25519 key and never returns the private key', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const view = await manager.create({ repoUrl: 'https://github.com/Team-SpaceY/incar-app' });
    const stored = db.rows.get(view.id);

    expect(view.public_key).toMatch(/^ssh-ed25519 /);
    expect(view.fingerprint).toMatch(/^SHA256:/);
    expect(view).not.toHaveProperty('encrypted_private_key');
    expect(view).not.toHaveProperty('private_key_iv');
    expect(stored?.encrypted_private_key).not.toContain('OPENSSH PRIVATE KEY');
    expect(
      decrypt(stored!.encrypted_private_key, stored!.private_key_iv, MASTER_KEY),
    ).toContain('OPENSSH PRIVATE KEY');
  });

  it('verifies access, discovers the default branch, and removes temporary keys', async () => {
    const db = new MemoryGitCredentialDb();
    let keyDirectory = '';
    const verifier: VerifyGitRemote = async (sshUrl, paths) => {
      keyDirectory = dirname(paths.keyPath);
      expect(sshUrl).toBe('git@github.com:Team-SpaceY/incar-app.git');
      expect((await stat(paths.keyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(paths.knownHostsPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(paths.knownHostsPath, 'utf8')).toContain('github.com ssh-ed25519');
      return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n' };
    };
    const manager = new GitCredentialManager(db, MASTER_KEY, verifier);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    const verified = await manager.verify(created.id);

    expect(verified.status).toBe('verified');
    expect(verified.default_branch).toBe('main');
    await expect(access(keyDirectory)).rejects.toThrow();
  });

  it('records a safe failure and cleans temporary keys', async () => {
    const db = new MemoryGitCredentialDb();
    let keyDirectory = '';
    const verifier: VerifyGitRemote = async (_sshUrl, paths) => {
      keyDirectory = dirname(paths.keyPath);
      throw new Error('sensitive git stderr');
    };
    const manager = new GitCredentialManager(db, MASTER_KEY, verifier);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });

    await expect(manager.verify(created.id)).rejects.toBeInstanceOf(GitDeployKeyUnauthorizedError);
    expect(db.rows.get(created.id)?.last_error_code).toBe('deploy_key_not_authorized');
    expect(JSON.stringify(db.rows.get(created.id))).not.toContain('sensitive git stderr');
    await expect(access(keyDirectory)).rejects.toThrow();
  });

  it('blocks deletion while a service references the credential', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    db.usages.set(created.id, [
      { service_id: 'svc_1', service_name: 'app', project_id: 'project_1' },
    ]);

    await expect(manager.remove(created.id)).rejects.toBeInstanceOf(GitCredentialInUseError);
    expect(db.rows.has(created.id)).toBe(true);
  });
});
