import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createGitProvider } from '../../git-providers/index.js';
import { loadConfig } from '../../config/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import {
  listGithubReposSchema,
  scanDockerfilesSchema,
  scanProjectSchema,
  searchGithubReposSchema,
  createGitDeployKeySchema,
  listGitCredentialsSchema,
  verifyGitCredentialSchema,
  removeGitCredentialSchema,
} from './schemas.js';

const COMPOSE_FILENAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

const log = createModuleLogger('tools');

interface DiscoverableGitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  private: boolean;
  defaultBranch: string;
  stars?: number;
  cloneUrl: string;
  htmlUrl: string;
  updatedAt?: string;
  accessMethod: 'oauth' | 'deploy_key';
}

function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(current).sort((left, right) => left.localeCompare(right));
    } catch (error) {
      log.debug({ err: error, current }, 'Failed to read directory during Dockerfile scan');
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') {
        continue;
      }

      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && (entry === 'Dockerfile' || entry.startsWith('Dockerfile.'))) {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch (error) {
        log.debug({ err: error, fullPath }, 'Failed to stat file during Dockerfile scan');
        continue;
      }
    }
  }

  walk(dir, 0);
  return results.sort((left, right) => left.localeCompare(right));
}

function findComposeFiles(clonePath: string): string[] {
  return COMPOSE_FILENAMES.filter((filename) => {
    const candidatePath = join(clonePath, filename);
    try {
      return statSync(candidatePath).isFile();
    } catch (error) {
      log.debug(
        { err: error, candidatePath },
        'Failed to stat compose file candidate during project scan',
      );
      return false;
    }
  });
}

export const gitToolDefs: ToolDef[] = [
  {
    name: 'create_git_deploy_key',
    riskLevel: 'medium',
    description:
      'Generate a read-only GitHub Deploy Key for one repository. Returns only the public key and GitHub setup URL; the encrypted private key never leaves OpenLander.',
    mcpDescription:
      'Generate a repository Deploy Key, then ask the user to add the returned public key in GitHub with write access disabled.',
    inputSchema: createGitDeployKeySchema,
    execute: async (args, { appCtx }) => ({
      credential: await appCtx.gitCredentials.create({
        repoUrl: args['repo_url'] as string,
        name: args['name'] as string | undefined,
      }),
      next_step:
        'Add credential.public_key in GitHub Repository Settings > Deploy keys with Allow write access disabled, then call verify_git_credential.',
    }),
  },
  {
    name: 'list_git_credentials',
    riskLevel: 'low',
    description: 'List repository Deploy Key credentials without private key material.',
    mcpDescription: 'List sanitized repository Deploy Key credentials and service usage.',
    inputSchema: listGitCredentialsSchema,
    execute: async (args, { appCtx }) => ({
      credentials: await appCtx.gitCredentials.list({
        repoUrl: args['repo_url'] as string | undefined,
        status: args['status'] as 'pending' | 'verified' | 'failed' | undefined,
      }),
    }),
  },
  {
    name: 'verify_git_credential',
    riskLevel: 'low',
    description: 'Verify that a repository Deploy Key can read its exact GitHub repository.',
    mcpDescription: 'Verify Deploy Key access with strict GitHub host-key checking.',
    inputSchema: verifyGitCredentialSchema,
    execute: async (args, { appCtx }) => ({
      credential: await appCtx.gitCredentials.verify(args['credential_id'] as string),
    }),
  },
  {
    name: 'remove_git_credential',
    riskLevel: 'high',
    description:
      'Permanently delete an unused repository Deploy Key credential. Refuses while services reference it.',
    mcpDescription:
      'Permanently delete an unused repository Deploy Key. Requires human approval and is blocked while in use.',
    inputSchema: removeGitCredentialSchema,
    execute: async (args, { appCtx }) => {
      const credentialId = args['credential_id'] as string;
      await appCtx.gitCredentials.remove(credentialId);
      return { status: 'deleted', credential_id: credentialId };
    },
  },
  {
    name: 'scan_dockerfiles',
    riskLevel: 'low',
    description:
      'Clone a repo and scan for all Dockerfiles. Use BEFORE deploying when you suspect a monorepo (multiple services). Returns paths like ["Dockerfile", "frontend/Dockerfile", "backend/Dockerfile"]. If only one Dockerfile is found, use create_deploy_plan normally. If multiple are found, ask the user which service path to deploy and then create a deploy plan for that Dockerfile. Errors: CLONE_FAILED.',
    mcpDescription: 'Scan a repository for Dockerfiles before creating deploy plans for monorepos.',
    inputSchema: scanDockerfilesSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = (args['branch'] as string | undefined) ?? undefined;
      const cloneResult = await cloneRepo({
        repoUrl,
        branch,
        gitCredentialId: args['git_credential_id'] as string | undefined,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
      });
      const dockerfiles = findDockerfiles(cloneResult.path);
      const relativePaths = dockerfiles.map((dockerfile) => relative(cloneResult.path, dockerfile));

      return {
        repoUrl,
        clonePath: cloneResult.path,
        commitSha: cloneResult.commitSha,
        dockerfiles: relativePaths,
        isMonorepo: relativePaths.length > 1,
      };
    },
  },
  {
    name: 'scan_project',
    riskLevel: 'low',
    description:
      'Scan a repository for deployment-relevant files before deploying. Reuses an existing clone when clone_path is provided; otherwise clones from repo_url. Detects Dockerfiles and known Docker Compose filenames to identify monorepo signals. Returns { isMonorepo, dockerfiles, composeFiles, clonePath }.',
    mcpDescription: 'Detect Dockerfiles, compose files, and monorepo deployment signals.',
    inputSchema: scanProjectSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = (args['branch'] as string | undefined) ?? undefined;
      const clonePathArg = (args['clone_path'] as string | undefined) ?? undefined;
      const clonePath =
        clonePathArg ??
        (
          await cloneRepo({
            repoUrl,
            branch,
            gitCredentialId: args['git_credential_id'] as string | undefined,
            sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
          })
        ).path;

      const dockerfiles = findDockerfiles(clonePath).map((dockerfilePath) =>
        relative(clonePath, dockerfilePath),
      );
      const composeFiles = findComposeFiles(clonePath);

      return {
        isMonorepo: dockerfiles.length > 1 || composeFiles.length > 0,
        dockerfiles,
        composeFiles,
        clonePath,
      };
    },
    targets: ['agent'],
  },
  {
    name: 'list_github_repos',
    riskLevel: 'low',
    description:
      'List repositories from the user\'s connected GitHub account, sorted by most recently pushed. Use when user asks "show my repos", "what can I deploy?", or needs to find a project by name. Returns { count, repos[] } with name, description, language, private flag, and safe clone URL. Private repo credentials are injected internally at clone time and are never returned. Errors: GITHUB_NOT_CONFIGURED if no GitHub token is set — tell user to add one in settings. Supports pagination with page parameter.',
    mcpDescription: 'List repositories from the connected GitHub account by recent activity.',
    inputSchema: listGithubReposSchema,
    execute: async (args, { target, appCtx }) => {
      const config = loadConfig();
      const ghConfig = config.gitProviders.github;
      const gitCredentialManager = (appCtx as Partial<typeof appCtx>).gitCredentials;
      const deployKeyCredentials = gitCredentialManager
        ? await gitCredentialManager.list({ status: 'verified' })
        : [];
      if (!ghConfig.token && deployKeyCredentials.length === 0) {
        if (target === 'agent') {
          throw new Error(
            'GITHUB_NOT_CONFIGURED: No GitHub token configured. Add one in settings to browse repos.',
          );
        }

        throw new Error('GITHUB_NOT_CONFIGURED: No GitHub token configured.');
      }

      const pageArg = args['page'] as number | undefined;
      const visibilityArg = args['visibility'] as 'all' | 'public' | 'private' | undefined;
      const page = target === 'agent' ? (pageArg ?? 1) : pageArg;
      const visibility = target === 'agent' ? (visibilityArg ?? 'all') : visibilityArg;
      const result = ghConfig.token
        ? await createGitProvider('github', ghConfig).listRepos({ page, perPage: 30, visibility })
        : { repos: [], hasMore: false };
      const byRepository = new Map<string, DiscoverableGitHubRepo>(
        result.repos.map((repo) => [
          repo.fullName.toLowerCase(),
          {
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            defaultBranch: repo.defaultBranch,
            stars: repo.stars,
            cloneUrl: repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
            updatedAt: repo.updatedAt,
            accessMethod: 'oauth' as const,
          },
        ]),
      );
      for (const credential of deployKeyCredentials) {
        const fullName = credential.repository_url.replace(/^https:\/\/github\.com\//i, '');
        byRepository.set(fullName.toLowerCase(), {
          name: fullName.split('/').at(-1) ?? fullName,
          fullName,
          description: null,
          language: null,
          private: true,
          defaultBranch: credential.default_branch ?? 'main',
          stars: 0,
          cloneUrl: credential.repository_url,
          htmlUrl: credential.repository_url,
          updatedAt: credential.verified_at ?? credential.updated_at,
          accessMethod: 'deploy_key',
        });
      }
      const repos = [...byRepository.values()];

      if (target === 'mcp') {
        return {
          count: repos.length,
          hasMore: result.hasMore,
          repos,
        };
      }

      return {
        count: repos.length,
        hasMore: result.hasMore,
        repos,
      };
    },
  },
  {
    name: 'search_github_repos',
    riskLevel: 'low',
    description:
      'Search the user\'s GitHub repositories by name or keyword. Use when user says "deploy my-project" or "find repo X" — this resolves a project name to a deployable repo URL. Returns { total, repos[] } with safe token-free clone URLs. Private repo credentials are injected internally at clone time and are never returned. Errors: GITHUB_NOT_CONFIGURED. Tip: after finding the repo, call create_deploy_plan with the clone URL.',
    mcpDescription: 'Search connected GitHub repositories by name or keyword.',
    inputSchema: searchGithubReposSchema,
    execute: async (args, { target, appCtx }) => {
      const config = loadConfig();
      const ghConfig = config.gitProviders.github;
      const query = args['query'] as string;
      const gitCredentialManager = (appCtx as Partial<typeof appCtx>).gitCredentials;
      const deployKeyCredentials = (
        gitCredentialManager ? await gitCredentialManager.list({ status: 'verified' }) : []
      ).filter((credential) =>
        credential.repository_url.toLowerCase().includes(query.trim().toLowerCase()),
      );
      if (!ghConfig.token && deployKeyCredentials.length === 0) {
        if (target === 'agent') {
          throw new Error(
            'GITHUB_NOT_CONFIGURED: No GitHub token configured. Add one in settings to search repos.',
          );
        }

        throw new Error('GITHUB_NOT_CONFIGURED: No GitHub token configured.');
      }

      const result = ghConfig.token
        ? await createGitProvider('github', ghConfig).searchRepos(query)
        : { repos: [], total: 0, truncated: false };
      const byRepository = new Map<string, DiscoverableGitHubRepo>(
        result.repos.map((repo) => [
          repo.fullName.toLowerCase(),
          {
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            defaultBranch: repo.defaultBranch,
            cloneUrl: repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
            accessMethod: 'oauth' as const,
          },
        ]),
      );
      for (const credential of deployKeyCredentials) {
        const fullName = credential.repository_url.replace(/^https:\/\/github\.com\//i, '');
        byRepository.set(fullName.toLowerCase(), {
          name: fullName.split('/').at(-1) ?? fullName,
          fullName,
          description: null,
          language: null,
          private: true,
          defaultBranch: credential.default_branch ?? 'main',
          cloneUrl: credential.repository_url,
          htmlUrl: credential.repository_url,
          accessMethod: 'deploy_key',
        });
      }
      const repos = [...byRepository.values()];

      if (target === 'mcp') {
        return {
          total: repos.length,
          ...(result.truncated ? { truncated: true } : {}),
          repos,
        };
      }

      return {
        total: repos.length,
        ...(result.truncated ? { truncated: true } : {}),
        repos,
      };
    },
  },
];
