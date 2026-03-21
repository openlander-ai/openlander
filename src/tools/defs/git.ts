import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createGitProvider } from '../../git-providers/index.js';
import { loadConfig } from '../../config/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import {
  deployMonorepoSchema,
  listGithubReposSchema,
  scanDockerfilesSchema,
  scanProjectSchema,
  searchGithubReposSchema,
} from './schemas.js';

const COMPOSE_FILENAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

const log = createModuleLogger('tools');

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
        if (stat.isFile() && entry === 'Dockerfile') {
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
    name: 'scan_dockerfiles',
    description:
      'Clone a repo and scan for all Dockerfiles. Use BEFORE deploying when you suspect a monorepo (multiple services). Returns paths like ["Dockerfile", "frontend/Dockerfile", "backend/Dockerfile"]. If only one Dockerfile is found, use create_deploy_plan normally. If multiple are found, use orchestrate_deploy to deploy all services at once with dependency ordering and atomic rollback. Do NOT call create_deploy_plan multiple times for each Dockerfile. Errors: CLONE_FAILED.',
    inputSchema: scanDockerfilesSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = (args['branch'] as string | undefined) ?? undefined;
      const cloneResult = await cloneRepo({
        repoUrl,
        branch,
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
    description:
      'Scan a repository for deployment-relevant files before deploying. Reuses an existing clone when clone_path is provided; otherwise clones from repo_url. Detects Dockerfiles and known Docker Compose filenames to identify monorepo signals. Returns { isMonorepo, dockerfiles, composeFiles, clonePath }.',
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
    name: 'deploy_monorepo',
    description:
      'Start deploying a monorepo with multiple services in the background. Use AFTER scan_dockerfiles confirms multiple Dockerfiles. Returns immediately with { parentProjectId, parentName, status: "building" } while all services build in parallel. Use get_deploy_status to check progress. Errors: BUILD_FAILED on individual services (others continue).',
    inputSchema: deployMonorepoSchema,
    execute: (args, { appCtx }) => {
      const raw = args['dockerfiles'] as string | string[];
      const dockerfiles = Array.isArray(raw) ? raw : (JSON.parse(raw) as string[]);
      const result = appCtx.pipeline.startMonorepoDeploy({
        repoUrl: args['repo_url'] as string,
        clonePath: args['clone_path'] as string,
        commitSha: args['commit_sha'] as string,
        dockerfiles,
        branch: (args['branch'] as string | undefined) ?? undefined,
      });
      return Promise.resolve({ ...result, hint: 'Use get_deploy_status to check progress.' });
    },
  },
  {
    name: 'list_github_repos',
    description:
      'List repositories from the user\'s connected GitHub account, sorted by most recently pushed. Use when user asks "show my repos", "what can I deploy?", or needs to find a project by name. Returns { count, repos[] } with name, description, language, private flag, and clone URL. Errors: GITHUB_NOT_CONFIGURED if no GitHub token is set — tell user to add one in settings. Supports pagination with page parameter.',
    inputSchema: listGithubReposSchema,
    execute: async (args, { target }) => {
      const config = loadConfig();
      const ghConfig = config.gitProviders.github;
      if (!ghConfig.token) {
        if (target === 'agent') {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to browse repos.',
          };
        }

        return {
          error: 'GITHUB_NOT_CONFIGURED',
          message: 'No GitHub token configured.',
        };
      }

      const provider = createGitProvider('github', ghConfig);
      const pageArg = args['page'] as number | undefined;
      const visibilityArg = args['visibility'] as 'all' | 'public' | 'private' | undefined;
      const page = target === 'agent' ? (pageArg ?? 1) : pageArg;
      const visibility = target === 'agent' ? (visibilityArg ?? 'all') : visibilityArg;
      const result = await provider.listRepos({ page, perPage: 30, visibility });

      if (target === 'mcp') {
        return {
          count: result.repos.length,
          hasMore: result.hasMore,
          repos: result.repos.map((repo) => ({
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
          })),
        };
      }

      return {
        count: result.repos.length,
        hasMore: result.hasMore,
        repos: result.repos.map((repo) => ({
          name: repo.name,
          fullName: repo.fullName,
          description: repo.description,
          language: repo.language,
          private: repo.isPrivate,
          defaultBranch: repo.defaultBranch,
          stars: repo.stars,
          cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
          htmlUrl: repo.htmlUrl,
          updatedAt: repo.updatedAt,
        })),
      };
    },
  },
  {
    name: 'search_github_repos',
    description:
      'Search the user\'s GitHub repositories by name or keyword. Use when user says "deploy my-project" or "find repo X" — this resolves a project name to a deployable repo URL. Returns { total, repos[] } with clone URLs ready for create_deploy_plan. Errors: GITHUB_NOT_CONFIGURED. Tip: after finding the repo, call create_deploy_plan with the clone URL.',
    inputSchema: searchGithubReposSchema,
    execute: async (args, { target }) => {
      const config = loadConfig();
      const ghConfig = config.gitProviders.github;
      if (!ghConfig.token) {
        if (target === 'agent') {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to search repos.',
          };
        }

        return {
          error: 'GITHUB_NOT_CONFIGURED',
          message: 'No GitHub token configured.',
        };
      }

      const provider = createGitProvider('github', ghConfig);
      const query = args['query'] as string;
      const result = await provider.searchRepos(query);

      if (target === 'mcp') {
        return {
          total: result.total,
          repos: result.repos.map((repo) => ({
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
          })),
        };
      }

      return {
        total: result.total,
        repos: result.repos.map((repo) => ({
          name: repo.name,
          fullName: repo.fullName,
          description: repo.description,
          language: repo.language,
          private: repo.isPrivate,
          defaultBranch: repo.defaultBranch,
          cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
          htmlUrl: repo.htmlUrl,
        })),
      };
    },
  },
];
