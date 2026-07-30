import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { GitCredentialRow, GitCredentialServiceUsage } from '../src/db/types.js';
import { decrypt } from '../src/env/crypto.js';
import {
  GitCredentialInUseError,
  GitDeployKeyUnauthorizedError,
  GitNetworkUnreachableError,
} from '../src/errors.js';
import {
  canonicalizeGitHubRepoUrl,
  GitCredentialManager,
  setActiveGitCredentialManager,
  type VerifyGitRemote,
} from '../src/git-credentials/manager.js';
import { cloneRepo } from '../src/pipeline/git.js';

class MemoryGitCredentialDb {
  readonly rows = new Map<string, GitCredentialRow>();
  readonly usages = new Map<string, GitCredentialServiceUsage[]>();
  readonly services = new Map<string, { git_credential_id: string | null }>();
  readonly used: string[] = [];

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

  async getService(id: string): Promise<{ git_credential_id: string | null } | undefined> {
    return this.services.get(id);
  }

  async markGitCredentialUsed(id: string): Promise<void> {
    this.used.push(id);
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
    expect(decrypt(stored!.encrypted_private_key, stored!.private_key_iv, MASTER_KEY)).toContain(
      'OPENSSH PRIVATE KEY',
    );
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
      expect(await readFile(paths.knownHostsPath, 'utf8')).toContain(
        '[ssh.github.com]:443 ssh-ed25519',
      );
      return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n' };
    };
    const manager = new GitCredentialManager(db, MASTER_KEY, verifier);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    const verified = await manager.verify(created.id);

    expect(verified.status).toBe('verified');
    expect(verified.default_branch).toBe('main');
    await expect(access(keyDirectory)).rejects.toThrow();
  });

  it('retries Deploy Key verification on GitHub SSH port 443 after a network failure', async () => {
    const db = new MemoryGitCredentialDb();
    const attemptedUrls: string[] = [];
    const verifier: VerifyGitRemote = async (sshUrl) => {
      attemptedUrls.push(sshUrl);
      if (attemptedUrls.length === 1) {
        throw Object.assign(new Error('ssh: connect to host github.com port 22: timed out'), {
          code: 'ETIMEDOUT',
        });
      }
      return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n' };
    };
    const manager = new GitCredentialManager(db, MASTER_KEY, verifier);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });

    await expect(manager.verify(created.id)).resolves.toMatchObject({
      status: 'verified',
      default_branch: 'main',
    });
    expect(attemptedUrls).toEqual([
      'git@github.com:Team-SpaceY/incar-app.git',
      'ssh://git@ssh.github.com:443/Team-SpaceY/incar-app.git',
    ]);
  });

  it('keeps credential state unchanged when every verification endpoint is unreachable', async () => {
    const db = new MemoryGitCredentialDb();
    const attemptedUrls: string[] = [];
    const verifier: VerifyGitRemote = async (sshUrl) => {
      attemptedUrls.push(sshUrl);
      throw Object.assign(new Error('ssh: connect to host github.com port 22: timed out'), {
        code: 'ETIMEDOUT',
      });
    };
    const manager = new GitCredentialManager(db, MASTER_KEY, verifier);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });

    await expect(manager.verify(created.id)).rejects.toBeInstanceOf(GitNetworkUnreachableError);
    expect(db.rows.get(created.id)).toMatchObject({ status: 'pending', last_error_code: null });
    expect(attemptedUrls).toEqual([
      'git@github.com:Team-SpaceY/incar-app.git',
      'ssh://git@ssh.github.com:443/Team-SpaceY/incar-app.git',
      'ssh://git@ssh.github.com:443/Team-SpaceY/incar-app.git',
    ]);
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

  it('auto-selects the unique verified exact-repository credential', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(created.id, { status: 'verified' });

    const selected = await manager.runWithCloneCredential(
      { repoUrl: 'https://github.com/team-spacey/incar-app.git' },
      async (auth) => auth?.credentialId,
    );

    expect(selected).toBe(created.id);
    expect(db.used).toEqual([created.id]);
  });

  it('bounds SSH connection setup and provides GitHub port 443 fallback', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(created.id, { status: 'verified' });

    const auth = await manager.runWithCloneCredential(
      { repoUrl: created.repository_url, credentialId: created.id },
      async (selectedAuth) => selectedAuth,
    );

    expect(auth?.gitSshCommand).toContain('-o IPQoS=none');
    expect(auth?.gitSshCommand).toContain('-o ConnectTimeout=15');
    expect(auth?.gitSshCommand).toContain('-o ConnectionAttempts=1');
    expect(auth?.fallbackCloneUrl).toBe('ssh://git@ssh.github.com:443/Team-SpaceY/incar-app.git');
    expect(auth?.fallbackGitSshCommand).toBe(auth?.gitSshCommand);
  });

  it('prefers an existing service binding and requires explicit selection for ambiguous matches', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const first = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    const second = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(first.id, { status: 'verified' });
    await db.setGitCredentialVerification(second.id, { status: 'verified' });

    await expect(
      manager.runWithCloneCredential(
        { repoUrl: first.repository_url },
        async (auth) => auth?.credentialId,
      ),
    ).rejects.toMatchObject({ code: 'GIT_CREDENTIAL_SELECTION_REQUIRED' });

    db.services.set('svc_1', { git_credential_id: second.id });
    await expect(
      manager.runWithCloneCredential(
        { repoUrl: first.repository_url, serviceId: 'svc_1' },
        async (auth) => auth?.credentialId,
      ),
    ).resolves.toBe(second.id);
  });

  it('rejects pending and cross-repository explicit credentials', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const pending = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });

    await expect(
      manager.runWithCloneCredential(
        { repoUrl: pending.repository_url, credentialId: pending.id },
        async () => 'unused',
      ),
    ).rejects.toMatchObject({ code: 'GIT_CREDENTIAL_NOT_VERIFIED' });

    await db.setGitCredentialVerification(pending.id, { status: 'verified' });
    await expect(
      manager.runWithCloneCredential(
        { repoUrl: 'github.com/Team-SpaceY/another-repo', credentialId: pending.id },
        async () => 'unused',
      ),
    ).rejects.toMatchObject({ code: 'GIT_CREDENTIAL_REPOSITORY_MISMATCH' });
  });

  it('does not mark a selected key used when the authenticated operation fails', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(created.id, { status: 'verified' });

    await expect(
      manager.runWithCloneCredential(
        { repoUrl: created.repository_url, credentialId: created.id },
        async () => {
          throw new Error('selected deploy key failed');
        },
      ),
    ).rejects.toThrow('selected deploy key failed');
    expect(db.used).toEqual([]);
  });

  it('maps a selected Deploy Key clone failure without falling back to another auth method', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(created.id, { status: 'verified' });
    const fakeBin = await mkdtemp(`${tmpdir()}/openlander-fake-git-`);
    const workspace = await mkdtemp(`${tmpdir()}/openlander-clone-test-`);
    const gitPath = `${fakeBin}/git`;
    await writeFile(gitPath, '#!/bin/sh\necho "fatal: Authentication failed" >&2\nexit 128\n');
    await chmod(gitPath, 0o755);
    const previousPath = process.env['PATH'];
    const previousWorkspace = process.env['OPENLANDER_WORKSPACE_DIR'];
    process.env['PATH'] = `${fakeBin}:${previousPath ?? ''}`;
    process.env['OPENLANDER_WORKSPACE_DIR'] = workspace;
    setActiveGitCredentialManager(manager);
    try {
      await expect(
        cloneRepo({ repoUrl: created.repository_url, gitCredentialId: created.id }),
      ).rejects.toMatchObject({ code: 'GIT_DEPLOY_KEY_UNAUTHORIZED' });
      expect(db.used).toEqual([]);
    } finally {
      setActiveGitCredentialManager(null);
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
      if (previousWorkspace === undefined) delete process.env['OPENLANDER_WORKSPACE_DIR'];
      else process.env['OPENLANDER_WORKSPACE_DIR'] = previousWorkspace;
      await Promise.all([
        rm(fakeBin, { recursive: true, force: true }),
        rm(workspace, { recursive: true, force: true }),
      ]);
    }
  });

  it('classifies a selected Deploy Key endpoint failure as retryable network failure', async () => {
    const db = new MemoryGitCredentialDb();
    const manager = new GitCredentialManager(db, MASTER_KEY);
    const created = await manager.create({ repoUrl: 'github.com/Team-SpaceY/incar-app' });
    await db.setGitCredentialVerification(created.id, { status: 'verified' });
    const fakeBin = await mkdtemp(`${tmpdir()}/openlander-fake-git-`);
    const workspace = await mkdtemp(`${tmpdir()}/openlander-clone-test-`);
    const gitPath = `${fakeBin}/git`;
    await writeFile(
      gitPath,
      '#!/bin/sh\necho "ssh: connect to host github.com port 22: Network is unreachable" >&2\nexit 128\n',
    );
    await chmod(gitPath, 0o755);
    const previousPath = process.env['PATH'];
    const previousWorkspace = process.env['OPENLANDER_WORKSPACE_DIR'];
    process.env['PATH'] = `${fakeBin}:${previousPath ?? ''}`;
    process.env['OPENLANDER_WORKSPACE_DIR'] = workspace;
    setActiveGitCredentialManager(manager);
    try {
      await expect(
        cloneRepo({ repoUrl: created.repository_url, gitCredentialId: created.id }),
      ).rejects.toMatchObject({
        code: 'GIT_NETWORK_UNREACHABLE',
        details: {
          repoUrl: created.repository_url,
          authMethod: 'deploy_key',
          retryable: true,
        },
      });
      expect(db.used).toEqual([]);
    } finally {
      setActiveGitCredentialManager(null);
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
      if (previousWorkspace === undefined) delete process.env['OPENLANDER_WORKSPACE_DIR'];
      else process.env['OPENLANDER_WORKSPACE_DIR'] = previousWorkspace;
      await Promise.all([
        rm(fakeBin, { recursive: true, force: true }),
        rm(workspace, { recursive: true, force: true }),
      ]);
    }
  });
});
