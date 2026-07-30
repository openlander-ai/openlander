import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Database } from '../db/index.js';
import type {
  GitCredentialRow,
  GitCredentialServiceUsage,
  GitCredentialStatus,
} from '../db/types.js';
import { decrypt, encrypt } from '../env/crypto.js';
import {
  GitCredentialInUseError,
  GitCredentialInvalidRepositoryError,
  GitCredentialNotFoundError,
  GitCredentialNotVerifiedError,
  GitCredentialRepositoryMismatchError,
  GitCredentialSelectionRequiredError,
  GitDeployKeyUnauthorizedError,
  GitNetworkUnreachableError,
} from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { GITHUB_KNOWN_HOSTS } from './known-hosts.js';
import { isGitNetworkFailure } from './network.js';

const log = createModuleLogger('git-credential-manager');
const execFile = promisify(execFileCallback);
const COMMAND_TIMEOUT_MS = 30_000;
const SSH_CONNECT_TIMEOUT_SECONDS = 15;

type GitCredentialDatabase = Pick<
  Database,
  | 'createGitCredential'
  | 'getGitCredential'
  | 'listGitCredentials'
  | 'setGitCredentialVerification'
  | 'listGitCredentialUsages'
  | 'deleteGitCredential'
  | 'getService'
  | 'markGitCredentialUsed'
>;

export interface CanonicalGitHubRepository {
  owner: string;
  repo: string;
  repositoryUrl: string;
  repositoryKey: string;
  sshUrl: string;
  settingsUrl: string;
}

export interface GitCredentialView {
  id: string;
  name: string;
  provider: 'github';
  auth_type: 'deploy_key';
  repository_url: string;
  repository_key: string;
  public_key: string;
  fingerprint: string;
  status: GitCredentialStatus;
  default_branch: string | null;
  last_error_code: string | null;
  verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  github_setup_url: string;
  usage_count: number;
  services: GitCredentialServiceUsage[];
}

export interface GitCloneCredentialAuth {
  credentialId: string;
  cloneUrl: string;
  gitSshCommand: string;
  fallbackCloneUrl?: string;
  fallbackGitSshCommand?: string;
}

function repositoryFromParts(rawUrl: string, owner: string, repoWithSuffix: string) {
  const repo = repoWithSuffix.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'invalid_owner_or_repository');
  }
  return {
    owner,
    repo,
    repositoryUrl: `https://github.com/${owner}/${repo}`,
    repositoryKey: `github.com/${owner}/${repo}`.toLowerCase(),
    sshUrl: `git@github.com:${owner}/${repo}.git`,
    settingsUrl: `https://github.com/${owner}/${repo}/settings/keys`,
  } satisfies CanonicalGitHubRepository;
}

function githubSshFallbackUrl(repository: CanonicalGitHubRepository): string {
  return `ssh://git@ssh.github.com:443/${repository.owner}/${repository.repo}.git`;
}

export function canonicalizeGitHubRepoUrl(rawUrl: string): CanonicalGitHubRepository {
  const input = rawUrl.trim();
  if (input.length === 0) {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'empty_url');
  }

  const scpMatch = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(input);
  if (scpMatch?.[1] && scpMatch[2]) {
    return repositoryFromParts(rawUrl, scpMatch[1], scpMatch[2]);
  }

  const normalizedInput = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'malformed_url');
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'provider_not_supported');
  }
  if (parsed.username && parsed.username !== 'git') {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'unexpected_username');
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitCredentialInvalidRepositoryError(rawUrl, 'expected_owner_and_repository');
  }
  return repositoryFromParts(rawUrl, parts[0], parts[1]);
}

async function withPrivateKey<T>(
  privateKey: string,
  fn: (paths: { keyPath: string; knownHostsPath: string }) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'openlander-git-key-'));
  await chmod(tempDir, 0o700);
  const keyPath = join(tempDir, 'deploy_key');
  const knownHostsPath = join(tempDir, 'known_hosts');
  try {
    await writeFile(keyPath, privateKey, { mode: 0o600 });
    await writeFile(knownHostsPath, GITHUB_KNOWN_HOSTS, { mode: 0o600 });
    return await fn({ keyPath, knownHostsPath });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type VerifyGitRemote = (
  sshUrl: string,
  paths: { keyPath: string; knownHostsPath: string },
) => Promise<{ stdout: string }>;

function buildGitSshCommand(keyPath: string, knownHostsPath: string): string {
  return [
    'ssh',
    '-F',
    '/dev/null',
    '-i',
    shellQuote(keyPath),
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IPQoS=none',
    '-o',
    `ConnectTimeout=${String(SSH_CONNECT_TIMEOUT_SECONDS)}`,
    '-o',
    'ConnectionAttempts=1',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${shellQuote(knownHostsPath)}`,
  ].join(' ');
}

const verifyGitRemote: VerifyGitRemote = async (sshUrl, { keyPath, knownHostsPath }) => {
  const sshCommand = buildGitSshCommand(keyPath, knownHostsPath);
  return await execFile('git', ['ls-remote', '--symref', sshUrl, 'HEAD'], {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: sshCommand },
  });
};

function safeVerificationFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'killed' in error && error.killed === true) {
    return 'verification_timeout';
  }
  return 'deploy_key_not_authorized';
}

export class GitCredentialManager {
  constructor(
    private readonly db: GitCredentialDatabase,
    private readonly masterKey?: Buffer,
    private readonly verifyRemote: VerifyGitRemote = verifyGitRemote,
  ) {}

  async create(input: { repoUrl: string; name?: string }): Promise<GitCredentialView> {
    const repository = canonicalizeGitHubRepoUrl(input.repoUrl);
    const id = `gitcred_${randomUUID().replaceAll('-', '')}`;
    const tempDir = await mkdtemp(join(tmpdir(), 'openlander-git-keygen-'));
    await chmod(tempDir, 0o700);
    const keyPath = join(tempDir, 'deploy_key');
    try {
      await execFile(
        'ssh-keygen',
        [
          '-q',
          '-t',
          'ed25519',
          '-N',
          '',
          '-C',
          `openlander:${repository.repositoryKey}:${id}`,
          '-f',
          keyPath,
        ],
        { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
      await Promise.all([chmod(keyPath, 0o600), chmod(`${keyPath}.pub`, 0o600)]);
      const [privateKey, publicKey, fingerprintResult] = await Promise.all([
        readFile(keyPath, 'utf8'),
        readFile(`${keyPath}.pub`, 'utf8'),
        execFile('ssh-keygen', ['-lf', `${keyPath}.pub`, '-E', 'sha256'], {
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        }),
      ]);
      const fingerprint = fingerprintResult.stdout.trim().split(/\s+/)[1];
      if (!fingerprint?.startsWith('SHA256:')) {
        throw new GitCredentialInvalidRepositoryError(
          input.repoUrl,
          'fingerprint_generation_failed',
        );
      }
      const encrypted = encrypt(privateKey, this.masterKey);
      const row = await this.db.createGitCredential({
        id,
        name: input.name?.trim() || `${repository.owner}/${repository.repo}`,
        repositoryUrl: repository.repositoryUrl,
        repositoryKey: repository.repositoryKey,
        publicKey: publicKey.trim(),
        fingerprint,
        encryptedPrivateKey: encrypted.encrypted,
        privateKeyIv: encrypted.iv,
      });
      return this.toView(row, []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async get(id: string): Promise<GitCredentialView> {
    const row = await this.requireCredential(id);
    const usages = await this.db.listGitCredentialUsages([id]);
    return this.toView(row, usages.get(id) ?? []);
  }

  async validateForRepository(id: string, repoUrl: string): Promise<GitCredentialView> {
    const row = await this.requireCredential(id);
    const repository = canonicalizeGitHubRepoUrl(repoUrl);
    this.assertCloneCredential(row, repository);
    const usages = await this.db.listGitCredentialUsages([id]);
    return this.toView(row, usages.get(id) ?? []);
  }

  async list(filters?: {
    repoUrl?: string;
    status?: GitCredentialStatus;
  }): Promise<GitCredentialView[]> {
    const repositoryKey = filters?.repoUrl
      ? canonicalizeGitHubRepoUrl(filters.repoUrl).repositoryKey
      : undefined;
    const rows = await this.db.listGitCredentials({ repositoryKey, status: filters?.status });
    const usages = await this.db.listGitCredentialUsages(rows.map((row) => row.id));
    return rows.map((row) => this.toView(row, usages.get(row.id) ?? []));
  }

  async verify(id: string): Promise<GitCredentialView> {
    const row = await this.requireCredential(id);
    const repository = canonicalizeGitHubRepoUrl(row.repository_url);
    const privateKey = decrypt(row.encrypted_private_key, row.private_key_iv, this.masterKey);
    try {
      const result = await withPrivateKey(privateKey, async ({ keyPath, knownHostsPath }) => {
        return await this.verifyRepositoryWithFallback(repository, { keyPath, knownHostsPath });
      });
      const branch = /^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m.exec(result.stdout)?.[1] ?? null;
      const updated = await this.db.setGitCredentialVerification(id, {
        status: 'verified',
        defaultBranch: branch,
        lastErrorCode: null,
      });
      if (!updated) throw new GitCredentialNotFoundError(id);
      const usages = await this.db.listGitCredentialUsages([id]);
      return this.toView(updated, usages.get(id) ?? []);
    } catch (error) {
      if (error instanceof GitCredentialNotFoundError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof GitNetworkUnreachableError || isGitNetworkFailure(error, message)) {
        throw new GitNetworkUnreachableError(repository.repositoryUrl, 'deploy_key');
      }
      const reason = safeVerificationFailure(error);
      await this.db.setGitCredentialVerification(id, {
        status: 'failed',
        lastErrorCode: reason,
      });
      throw new GitDeployKeyUnauthorizedError(id, row.repository_url, reason);
    }
  }

  async remove(id: string): Promise<void> {
    await this.requireCredential(id);
    const usages = await this.db.listGitCredentialUsages([id]);
    const serviceIds = (usages.get(id) ?? []).map((usage) => usage.service_id);
    if (serviceIds.length > 0) throw new GitCredentialInUseError(id, serviceIds);
    const deleted = await this.db.deleteGitCredential(id);
    if (!deleted) throw new GitCredentialNotFoundError(id);
  }

  async runWithCloneCredential<T>(
    input: { repoUrl: string; credentialId?: string; serviceId?: string },
    callback: (auth: GitCloneCredentialAuth | null) => Promise<T>,
  ): Promise<T> {
    const selected = await this.resolveCloneCredential(input);
    if (!selected) return await callback(null);

    const repository = canonicalizeGitHubRepoUrl(selected.repository_url);
    const privateKey = decrypt(
      selected.encrypted_private_key,
      selected.private_key_iv,
      this.masterKey,
    );
    const result = await withPrivateKey(privateKey, async ({ keyPath, knownHostsPath }) => {
      const gitSshCommand = buildGitSshCommand(keyPath, knownHostsPath);
      return await callback({
        credentialId: selected.id,
        cloneUrl: repository.sshUrl,
        gitSshCommand,
        fallbackCloneUrl: githubSshFallbackUrl(repository),
        fallbackGitSshCommand: gitSshCommand,
      });
    });
    await this.db.markGitCredentialUsed(selected.id);
    return result;
  }

  private async verifyRepositoryWithFallback(
    repository: CanonicalGitHubRepository,
    paths: { keyPath: string; knownHostsPath: string },
  ): Promise<{ stdout: string }> {
    const attempts = [
      { sshUrl: repository.sshUrl, transport: 'ssh_22' },
      { sshUrl: githubSshFallbackUrl(repository), transport: 'ssh_443' },
      { sshUrl: githubSshFallbackUrl(repository), transport: 'ssh_443_retry' },
    ] as const;

    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      if (!attempt) continue;
      try {
        return await this.verifyRemote(attempt.sshUrl, paths);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const hasNextAttempt = index + 1 < attempts.length;
        if (hasNextAttempt && isGitNetworkFailure(error, message)) {
          log.warn(
            {
              attempt: index + 1,
              transport: attempt.transport,
              nextTransport: attempts[index + 1]?.transport,
            },
            'Deploy Key verification transport failed; retrying with the next GitHub SSH endpoint',
          );
          continue;
        }
        throw error;
      }
    }

    throw new GitNetworkUnreachableError(repository.repositoryUrl, 'deploy_key');
  }

  private async resolveCloneCredential(input: {
    repoUrl: string;
    credentialId?: string;
    serviceId?: string;
  }): Promise<GitCredentialRow | null> {
    let selectedId = input.credentialId;
    if (!selectedId && input.serviceId) {
      const service = await this.db.getService(input.serviceId);
      selectedId = service?.git_credential_id ?? undefined;
    }

    let requestedRepository: CanonicalGitHubRepository | null = null;
    try {
      requestedRepository = canonicalizeGitHubRepoUrl(input.repoUrl);
    } catch (error) {
      if (selectedId) throw error;
      return null;
    }

    if (selectedId) {
      const row = await this.requireCredential(selectedId);
      this.assertCloneCredential(row, requestedRepository);
      return row;
    }

    const matches = await this.db.listGitCredentials({
      repositoryKey: requestedRepository.repositoryKey,
      status: 'verified',
    });
    if (matches.length > 1) {
      throw new GitCredentialSelectionRequiredError(
        requestedRepository.repositoryUrl,
        matches.map((row) => row.id),
      );
    }
    return matches[0] ?? null;
  }

  private assertCloneCredential(
    row: GitCredentialRow,
    requestedRepository: CanonicalGitHubRepository,
  ): void {
    if (row.repository_key !== requestedRepository.repositoryKey) {
      throw new GitCredentialRepositoryMismatchError(
        row.id,
        row.repository_url,
        requestedRepository.repositoryUrl,
      );
    }
    if (row.status !== 'verified') {
      throw new GitCredentialNotVerifiedError(row.id, row.status);
    }
  }

  private async requireCredential(id: string): Promise<GitCredentialRow> {
    const row = await this.db.getGitCredential(id);
    if (!row) throw new GitCredentialNotFoundError(id);
    return row;
  }

  private toView(row: GitCredentialRow, usages: GitCredentialServiceUsage[]): GitCredentialView {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      auth_type: row.auth_type,
      repository_url: row.repository_url,
      repository_key: row.repository_key,
      public_key: row.public_key,
      fingerprint: row.fingerprint,
      status: row.status,
      default_branch: row.default_branch,
      last_error_code: row.last_error_code,
      verified_at: row.verified_at,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      github_setup_url: `${row.repository_url}/settings/keys`,
      usage_count: usages.length,
      services: usages,
    };
  }
}

let activeGitCredentialManager: GitCredentialManager | null = null;

export function setActiveGitCredentialManager(manager: GitCredentialManager | null): void {
  activeGitCredentialManager = manager;
}

export function getActiveGitCredentialManager(): GitCredentialManager | null {
  return activeGitCredentialManager;
}
