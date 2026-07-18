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
  GitHubRepoAccessError,
} from '../errors.js';
import { loadConfig } from '../config/index.js';
import { GitHubProvider, type GitHubRepoAccessFailure } from '../git-providers/github.js';
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
 * Uses a connected GitHub provider for GitHub HTTPS URLs, with SSH reserved
 * for explicit SSH URLs or the no-provider fallback.
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
  let githubToken: string | undefined;
  let githubAuthMethod: 'oauth' | 'pat' = 'pat';
  try {
    const githubConfig = loadConfig().gitProviders.github;
    githubToken = githubConfig.token || undefined;
    githubAuthMethod = githubConfig.authMethod ?? 'pat';
  } catch (err) {
    log.debug({ err }, 'Failed to load GitHub provider config');
  }

  const githubRepo = parseGitHubHttpsRepo(normalizedUrl);
  if (githubRepo && githubToken) {
    const provider = new GitHubProvider(githubToken, undefined, githubAuthMethod);
    const access = await provider.checkRepoAccess(githubRepo.owner, githubRepo.repo);
    if (access.accessible) {
      normalizedUrl = authenticatedGitHubUrl(normalizedUrl, githubToken);
      log.debug({ authMethod: githubAuthMethod }, 'Using connected GitHub provider for clone');
    } else if (shouldContinueAfterAccessCheckFailure(access.failure)) {
      normalizedUrl = authenticatedGitHubUrl(normalizedUrl, githubToken);
      log.warn(
        { reason: access.failure.reason },
        'GitHub access preflight was inconclusive; continuing with authenticated clone',
      );
    } else {
      const publicAccess = await provider.checkPublicRepoAccess(githubRepo.owner, githubRepo.repo);
      if (publicAccess.accessible) {
        githubToken = undefined;
        log.warn(
          { reason: access.failure.reason },
          'Connected GitHub credential was rejected; cloning public repository anonymously',
        );
      } else if (shouldContinueAfterAccessCheckFailure(publicAccess.failure)) {
        normalizedUrl = authenticatedGitHubUrl(normalizedUrl, githubToken);
      } else {
        throw githubAccessError(repoUrl, githubAuthMethod, access.failure);
      }
    }
  } else if (githubRepo && effectiveSshKeyPath) {
    const sshUrl = toSshUrl(normalizedUrl);
    if (sshUrl) {
      log.info({ repoUrl: redactRepoUrl(repoUrl), sshUrl }, 'Using configured SSH key for clone');
      normalizedUrl = sshUrl;
    }
  } else if (!githubRepo && effectiveSshKeyPath && normalizedUrl.startsWith('http')) {
    const sshUrl = toSshUrl(normalizedUrl);
    if (sshUrl) {
      log.info(
        { repoUrl: redactRepoUrl(repoUrl), sshUrl },
        'SSH key configured, converting to SSH URL',
      );
      normalizedUrl = sshUrl;
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
    const rawMessage = error instanceof Error ? error.message : String(error);
    const msg = sanitizeGitError(rawMessage, githubToken);

    if (githubRepo && githubToken && msg.includes('Authentication failed')) {
      throw githubAccessError(repoUrl, githubAuthMethod, { reason: 'token_invalid' });
    }
    if (githubRepo && githubToken && msg.includes('Permission denied')) {
      throw githubAccessError(repoUrl, githubAuthMethod, { reason: 'permission_denied' });
    }
    if (msg.includes('Authentication failed') || msg.includes('Permission denied')) {
      throw new GitAuthError(redactRepoUrl(repoUrl));
    }
    if (isGitBranchNotFoundMessage(msg)) {
      throw new GitBranchNotFoundError(redactRepoUrl(repoUrl), branch ?? 'unknown');
    }
    if (isGitRepoNotFoundMessage(msg)) {
      if (githubRepo && githubToken) {
        throw githubAccessError(repoUrl, githubAuthMethod, {
          reason: 'not_found_or_not_authorized',
        });
      }
      throw new GitRepoNotFoundError(redactRepoUrl(repoUrl));
    }
    throw new GitCloneError(redactRepoUrl(repoUrl), msg);
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

function parseGitHubHttpsRepo(repoUrl: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null;
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const owner = segments[0];
  const rawRepo = segments[1];
  if (!owner || !rawRepo) return null;
  return { owner, repo: rawRepo.replace(/\.git$/i, '') };
}

function authenticatedGitHubUrl(repoUrl: string, token: string): string {
  const parsed = new URL(repoUrl);
  parsed.username = 'x-access-token';
  parsed.password = token;
  return parsed.toString();
}

function shouldContinueAfterAccessCheckFailure(failure: GitHubRepoAccessFailure): boolean {
  return failure.reason === 'rate_limited' || failure.reason === 'unreachable';
}

function githubAccessError(
  repoUrl: string,
  authMethod: 'oauth' | 'pat',
  failure: GitHubRepoAccessFailure,
): GitHubRepoAccessError {
  return new GitHubRepoAccessError(redactRepoUrl(repoUrl), authMethod, failure.reason, failure);
}

export function redactRepoUrl(repoUrl: string): string {
  try {
    const parsed = new URL(repoUrl);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return repoUrl.replace(/:\/\/[^/@\s]+@/, '://***@');
  }
}

function sanitizeGitError(message: string, token?: string): string {
  let sanitized = message;
  if (token) sanitized = sanitized.replaceAll(token, '***');
  return sanitized
    .replace(/https?:\/\/[^\s/@]+(?::[^\s/@]*)?@/gi, 'https://***@')
    .replace(/\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_-]+)\b/g, '***');
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
  if (!['github.com', 'gitlab.com', 'bitbucket.org'].includes(host.toLowerCase())) return null;
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
