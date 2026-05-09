import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GitCloneError,
  GitAuthError,
  GitRepoNotFoundError,
  GitBranchNotFoundError,
  UnsafeRepoUrlError,
} from '../errors.js';
import { loadConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { checkUrlSafety, GIT_ALLOWED_SCHEMES } from '../lib/url-safety.js';

const log = createModuleLogger('git');

const exec = promisify(execFile);
const DEFAULT_WORKSPACE_PREFIX = 'openlander-';

export interface CloneOptions {
  repoUrl: string;
  branch?: string;
  /** SSH key path for private repos. */
  sshKeyPath?: string;
  /** Shallow clone depth (default: 1). */
  depth?: number;
}

export interface CloneResult {
  path: string;
  commitSha: string;
  branch: string;
}

export async function getCommitSubject(
  repoPath: string,
  commitSha?: string,
): Promise<string | undefined> {
  try {
    const args = ['log', '-1', '--pretty=%s'];
    if (commitSha && commitSha.trim().length > 0) {
      args.push(commitSha.trim());
    }
    const { stdout } = await exec('git', args, { cwd: repoPath, timeout: 10_000 });
    const subject = stdout.trim();
    return subject.length > 0 ? subject : undefined;
  } catch (error) {
    log.debug({ err: error, repoPath, commitSha }, 'Failed to resolve commit subject');
    return undefined;
  }
}

/**
 * Clone a git repository to a temporary directory.
 *
 * Uses SSH key authentication for private repos.
 * Shallow clone by default for speed.
 */
export async function cloneRepo(options: CloneOptions): Promise<CloneResult> {
  const { repoUrl, branch, sshKeyPath, depth = 1 } = options;
  const effectiveSshKeyPath =
    sshKeyPath && sshKeyPath.trim().length > 0 && existsSync(sshKeyPath) ? sshKeyPath : undefined;

  if (sshKeyPath && !effectiveSshKeyPath) {
    log.warn({ sshKeyPath }, 'Configured SSH key path does not exist in this runtime; ignoring it');
  }

  // Normalize URL: prepend https:// if no protocol specified
  let normalizedUrl = normalizeRepoUrl(repoUrl);

  // Day 13 M3 (SSRF): reject internal/loopback hosts and non-network schemes
  // *after* normalization so `github.com/foo/bar` and `git@github.com:foo/bar`
  // both flow through the same allow-list. This runs before any token
  // injection so we never leak credentials at an attacker-chosen host.
  assertSafeRepoUrl(normalizedUrl);
  // When SSH key is configured and URL is HTTPS, convert to SSH immediately
  // (SSH key is useless for HTTPS cloning — must use git@host:path format)
  if (effectiveSshKeyPath && normalizedUrl.startsWith('http')) {
    const sshUrl = toSshUrl(normalizedUrl);
    if (sshUrl) {
      log.info({ repoUrl, sshUrl }, 'SSH key configured, converting to SSH URL');
      normalizedUrl = sshUrl;
    }
  }

  // Inject GitHub token for HTTPS URLs (only when no SSH key and still HTTPS)
  if (!effectiveSshKeyPath && normalizedUrl.startsWith('https://github.com/')) {
    try {
      const config = loadConfig();
      const token = config.gitProviders.github.token;
      if (token) {
        normalizedUrl = normalizedUrl.replace(
          'https://github.com/',
          `https://x-access-token:${token}@github.com/`,
        );
        log.debug('GitHub token injected for clone');
      } else {
        log.debug('No GitHub token found in config');
      }
    } catch (err) {
      log.debug({ err }, 'Failed to load config for GitHub token injection');
    }
  }

  const cloneDir = await createCloneWorkspace();

  const args = ['clone', '--depth', String(depth)];
  if (branch) {
    args.push('--branch', branch);
  }
  args.push(normalizedUrl, cloneDir);

  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['PATH', 'HOME', 'USER', 'LANG', 'SSH_AUTH_SOCK', 'GIT_SSH_COMMAND']) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  if (effectiveSshKeyPath) {
    env['GIT_SSH_COMMAND'] = `ssh -i ${effectiveSshKeyPath} -o StrictHostKeyChecking=no`;
  }

  try {
    await exec('git', args, { env, timeout: 120_000 }); // 2 minute timeout
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Auto-retry with SSH if HTTPS auth fails (only when current URL is still HTTPS)
    const isAuthFailure =
      msg.includes('terminal prompts disabled') ||
      msg.includes('Authentication failed') ||
      msg.includes('could not read Username');
    const isHttpsUrl = normalizedUrl.startsWith('http');
    const sshUrl = isHttpsUrl ? toSshUrl(normalizedUrl) : null;
    if (isAuthFailure && sshUrl) {
      log.info({ repoUrl, sshUrl }, 'HTTPS auth failed, retrying with SSH');
      const sshArgs = ['clone', '--depth', String(depth)];
      if (branch) sshArgs.push('--branch', branch);
      sshArgs.push(sshUrl, cloneDir);
      const sshEnv = {
        ...env,
        GIT_SSH_COMMAND: effectiveSshKeyPath
          ? `ssh -i ${effectiveSshKeyPath} -o StrictHostKeyChecking=no`
          : 'ssh -o StrictHostKeyChecking=no',
      };
      try {
        await exec('git', sshArgs, { env: sshEnv, timeout: 120_000 });
      } catch (sshError) {
        const sshMsg = sshError instanceof Error ? sshError.message : String(sshError);
        throw new GitCloneError(repoUrl, `HTTPS and SSH both failed. SSH error: ${sshMsg}`);
      }
      // SSH clone succeeded — fall through to get commit SHA
    } else {
      // Classify the error
      if (msg.includes('Authentication failed') || msg.includes('Permission denied')) {
        throw new GitAuthError(repoUrl);
      }
      if (isGitBranchNotFoundMessage(msg)) {
        throw new GitBranchNotFoundError(repoUrl, branch ?? 'unknown');
      }
      if (isGitRepoNotFoundMessage(msg)) {
        throw new GitRepoNotFoundError(repoUrl);
      }
      throw new GitCloneError(repoUrl, msg);
    }
  }

  const { stdout: sha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: cloneDir });
  const { stdout: resolvedBranch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: cloneDir,
  });

  return {
    path: cloneDir,
    commitSha: sha.trim(),
    branch: resolvedBranch.trim() || branch || 'main',
  };
}

async function createCloneWorkspace(): Promise<string> {
  const configuredRoot = process.env['OPENLANDER_WORKSPACE_DIR']?.trim();
  const workspaceRoot = configuredRoot && configuredRoot.length > 0 ? configuredRoot : tmpdir();
  await mkdir(workspaceRoot, { recursive: true });
  return mkdtemp(join(workspaceRoot, DEFAULT_WORKSPACE_PREFIX));
}

/** Normalize repo URL to a git-cloneable format. */
function normalizeRepoUrl(url: string): string {
  // Already has protocol or SSH format
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('git@')) {
    return url;
  }

  // Bare domain format: github.com/user/repo → https://github.com/user/repo
  if (url.includes('/')) {
    return `https://${url}`;
  }

  return url;
}

/** Convert HTTPS GitHub/GitLab/Bitbucket URL to SSH format. Returns null if not convertible. */
function toSshUrl(url: string): string | null {
  const match = url.match(/https?:\/\/(?:[^@]+@)?([^/]+)\/(.+)/);
  if (!match) return null;
  const [, host, path] = match;
  if (!host || !path) return null;
  // Only convert known hosts
  if (!['github.com', 'gitlab.com', 'bitbucket.org'].some((h) => host.includes(h))) return null;
  return `git@${host}:${path}`;
}

/**
 * Day 13 M3: validate that the (already normalized) clone URL targets a
 * legitimate external host with a network scheme we know how to clone over.
 *
 * Accepts:
 *   - http:// and https:// URLs
 *   - ssh:// URLs
 *   - SCP-style `git@host:path` (rewritten to `ssh://git@host/path` for the
 *     parse + safety check, then the original is left untouched for git)
 *
 * Rejects:
 *   - file://, javascript:, data:, gopher:, and any unknown scheme
 *   - localhost, 127.x, 0.x, 169.254.x, 10/8, 172.16/12, 192.168/16
 *   - `*.local` and `*.localhost` mDNS names
 *   - the AWS/GCP metadata endpoint
 *   - URLs with userinfo (passwords/tokens) embedded by the caller — token
 *     injection happens later in this module under our own control.
 *
 * Throws `UnsafeRepoUrlError` (HTTP 400) on rejection so API callers get
 * a stable machine-readable code instead of a vague clone failure.
 */
export function assertSafeRepoUrl(repoUrl: string): void {
  // SCP-style `git@host:path` is not parseable by URL — translate it to
  // `ssh://git@host/path` for the safety check only. The original string
  // is what we hand to git.
  let urlForCheck = repoUrl;
  const scpMatch = /^([\w.-]+)@([^:]+):(.+)$/.exec(repoUrl);
  if (scpMatch && !repoUrl.includes('://')) {
    const [, user, host, path] = scpMatch;
    urlForCheck = `ssh://${user ?? 'git'}@${host ?? ''}/${path ?? ''}`;
  }

  const result = checkUrlSafety(urlForCheck, {
    allowedSchemes: GIT_ALLOWED_SCHEMES,
    allowUserInfo: true,
  });
  if (!result.ok) {
    throw new UnsafeRepoUrlError(repoUrl, result.reason ?? 'unsafe URL');
  }
}

function isGitBranchNotFoundMessage(message: string): boolean {
  return message.includes('Remote branch') && message.includes('not found');
}

function isGitRepoNotFoundMessage(message: string): boolean {
  return (
    message.includes('not found') || message.includes('does not exist') || message.includes('404')
  );
}
