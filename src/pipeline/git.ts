import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GitCloneError,
  GitAuthError,
  GitRepoNotFoundError,
  GitBranchNotFoundError,
} from '../errors.js';
import { loadConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('git');

const exec = promisify(execFile);

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
}

/**
 * Clone a git repository to a temporary directory.
 *
 * Uses SSH key authentication for private repos.
 * Shallow clone by default for speed.
 */
export async function cloneRepo(options: CloneOptions): Promise<CloneResult> {
  const { repoUrl, branch, sshKeyPath, depth = 1 } = options;

  // Normalize URL: prepend https:// if no protocol specified
  let normalizedUrl = normalizeRepoUrl(repoUrl);

  // Inject GitHub token for HTTPS URLs to support private repos
  if (!sshKeyPath && normalizedUrl.startsWith('https://github.com/')) {
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

  const cloneDir = await mkdtemp(join(tmpdir(), 'openlander-'));

  const args = ['clone', '--depth', String(depth)];
  if (branch) {
    args.push('--branch', branch);
  }
  args.push(normalizedUrl, cloneDir);

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  // Prevent git from trying to prompt for credentials (fails in non-interactive environments)
  env['GIT_TERMINAL_PROMPT'] = '0';
  if (sshKeyPath) {
    env['GIT_SSH_COMMAND'] = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`;
  }

  try {
    await exec('git', args, { env, timeout: 120_000 }); // 2 minute timeout
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Classify the error
    if (msg.includes('Authentication failed') || msg.includes('Permission denied')) {
      throw new GitAuthError(repoUrl);
    }
    if (msg.includes('Remote branch') && msg.includes('not found')) {
      throw new GitBranchNotFoundError(repoUrl, branch ?? 'unknown');
    }
    if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('404')) {
      throw new GitRepoNotFoundError(repoUrl);
    }
    throw new GitCloneError(repoUrl, msg);
  }

  // Get commit SHA
  const { stdout: sha } = await exec('git', ['rev-parse', 'HEAD'], { cwd: cloneDir });

  return {
    path: cloneDir,
    commitSha: sha.trim(),
  };
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
