/**
 * GitHub provider implementation.
 *
 * Uses GitHub REST API v3 with the connected OAuth or PAT credential.
 * No external SDK — plain fetch against api.github.com.
 */

import type {
  GitProvider,
  GitRepo,
  GitUser,
  TokenValidation,
  ListReposOptions,
  ListReposResult,
  SearchReposOptions,
  SearchReposResult,
} from './types.js';
import type { GitHubRepoAccessReason } from '../errors.js';
import { GitHubRepoAccessError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';

const log = createModuleLogger('github');

const DEFAULT_API_BASE = 'https://api.github.com';

// --- GitHub-specific API response types ---

interface GHApiRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
}

interface GHApiUser {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  total_private_repos: number;
}

export interface GitHubRepoAccessFailure {
  reason: GitHubRepoAccessReason;
  authorizeUrl?: string;
  retryAt?: string;
  providerMessage?: string;
}

export type GitHubRepoAccessResult =
  | { accessible: true; repo: GitRepo }
  | { accessible: false; failure: GitHubRepoAccessFailure };

const ACCESSIBLE_REPO_SEARCH_PAGE_SIZE = 100;
const ACCESSIBLE_REPO_SEARCH_MAX_PAGES = 10;

// --- Implementation ---

export class GitHubProvider implements GitProvider {
  readonly type = 'github' as const;
  readonly displayName = 'GitHub';

  private readonly apiBase: string;
  constructor(
    private readonly token: string,
    baseUrl?: string,
    private readonly authMethod: 'oauth' | 'pat' = 'pat',
  ) {
    this.apiBase = baseUrl ?? DEFAULT_API_BASE;
  }

  async validateToken(): Promise<TokenValidation> {
    try {
      const res = await this.request('/user');
      const userData = res.data as GHApiUser;
      const scopes = (res.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      return {
        valid: true,
        user: mapUser(userData),
        scopes,
      };
    } catch (error) {
      return {
        valid: false,
        user: null,
        scopes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(error instanceof GitHubRepoAccessError
          ? { errorCode: error.code, errorDetails: error.details }
          : {}),
      };
    }
  }

  async listRepos(opts?: ListReposOptions): Promise<ListReposResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 30;
    const sort = opts?.sort ?? 'pushed';
    const visibility = opts?.visibility ?? 'all';

    // Use visibility + affiliation instead of type param.
    // type overrides affiliation, which can exclude org repos.
    // affiliation=organization_member explicitly includes repos from user's orgs.
    const res = await this.request(
      `/user/repos?page=${String(page)}&per_page=${String(perPage)}&sort=${sort}&visibility=${visibility}&affiliation=owner,collaborator,organization_member&direction=desc`,
    );

    const repoData = res.data as GHApiRepo[];

    const repos = repoData.map((r) => mapRepo(r));
    const linkHeader = res.headers.get('link') ?? '';
    const hasMore = linkHeader.includes('rel="next"');

    return { repos, hasMore };
  }

  async searchRepos(query: string, opts?: SearchReposOptions): Promise<SearchReposResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    const exact = /^([^/\s]+)\/([^/\s]+)$/.exec(query.trim());
    if (exact?.[1] && exact[2]) {
      const repo = await this.getRepo(exact[1], exact[2]);
      return { repos: [repo], total: 1 };
    }

    const accessible: GitRepo[] = [];
    let truncated = false;
    for (let repoPage = 1; repoPage <= ACCESSIBLE_REPO_SEARCH_MAX_PAGES; repoPage++) {
      const result = await this.listRepos({
        page: repoPage,
        perPage: ACCESSIBLE_REPO_SEARCH_PAGE_SIZE,
        visibility: 'all',
      });
      accessible.push(...result.repos);
      if (!result.hasMore) break;
      if (repoPage === ACCESSIBLE_REPO_SEARCH_MAX_PAGES) truncated = true;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const matches = accessible.filter((repo) =>
      [repo.name, repo.fullName, repo.description ?? ''].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
    const start = Math.max(0, (page - 1) * perPage);

    return {
      repos: matches.slice(start, start + perPage),
      total: matches.length,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  async getRepo(owner: string, name: string): Promise<GitRepo> {
    const result = await this.checkRepoAccess(owner, name);
    if (result.accessible) return result.repo;
    throw this.accessError(owner, name, result.failure);
  }

  async checkRepoAccess(owner: string, name: string): Promise<GitHubRepoAccessResult> {
    return this.checkRepoAccessWithToken(owner, name, this.token);
  }

  async checkPublicRepoAccess(owner: string, name: string): Promise<GitHubRepoAccessResult> {
    return this.checkRepoAccessWithToken(owner, name, undefined);
  }

  async hasDockerfile(owner: string, name: string, branch?: string): Promise<boolean> {
    try {
      const ref = branch ?? 'HEAD';
      await this.request(`/repos/${owner}/${name}/contents/Dockerfile?ref=${ref}`);
      return true;
    } catch (err) {
      log.debug({ err, owner, name }, 'Dockerfile check failed — assuming not present');
      return false;
    }
  }

  getAuthCloneUrl(repoFullName: string): string {
    return `https://x-access-token:${this.token}@github.com/${repoFullName}.git`;
  }

  // --- Internal ---

  private async request(path: string): Promise<{ data: unknown; headers: Headers }> {
    const url = `${this.apiBase}${path}`;
    const res = await this.fetchResponse(url, this.token);

    if (!res.ok) {
      const failure = await classifyAccessFailure(res);
      throw new GitHubRepoAccessError(
        'https://github.com',
        this.authMethod,
        failure.reason,
        failure,
      );
    }

    const data: unknown = await res.json();
    return { data, headers: res.headers };
  }

  private async checkRepoAccessWithToken(
    owner: string,
    name: string,
    token: string | undefined,
  ): Promise<GitHubRepoAccessResult> {
    try {
      const res = await this.fetchResponse(
        `${this.apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        token,
      );
      if (!res.ok) {
        return { accessible: false, failure: await classifyAccessFailure(res) };
      }
      return { accessible: true, repo: mapRepo((await res.json()) as GHApiRepo) };
    } catch (error) {
      return {
        accessible: false,
        failure: {
          reason: 'unreachable',
          providerMessage: error instanceof Error ? error.message : 'GitHub request failed',
        },
      };
    }
  }

  private fetchResponse(url: string, token: string | undefined): Promise<Response> {
    return fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `OpenLander/${VERSION}`,
      },
    });
  }

  private accessError(
    owner: string,
    name: string,
    failure: GitHubRepoAccessFailure,
  ): GitHubRepoAccessError {
    return new GitHubRepoAccessError(
      `https://github.com/${owner}/${name}`,
      this.authMethod,
      failure.reason,
      failure,
    );
  }
}

async function classifyAccessFailure(res: Response): Promise<GitHubRepoAccessFailure> {
  const providerMessage = await readGitHubErrorMessage(res);
  const ssoHeader = res.headers.get('x-github-sso') ?? '';
  const authorizeUrl = sanitizeAuthorizeUrl(/(?:^|;)\s*url=([^;\s]+)/i.exec(ssoHeader)?.[1]);
  if (ssoHeader && (/required/i.test(ssoHeader) || authorizeUrl)) {
    return {
      reason: 'sso_required',
      ...(authorizeUrl ? { authorizeUrl } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    };
  }

  const remaining = res.headers.get('x-ratelimit-remaining');
  const retryAfter = res.headers.get('retry-after');
  const rateLimited =
    res.status === 429 ||
    remaining === '0' ||
    /rate limit|secondary rate|abuse detection/i.test(providerMessage ?? '');
  if (rateLimited) {
    const retryAt = retryAtFromHeaders(res.headers, retryAfter);
    return {
      reason: 'rate_limited',
      ...(retryAt ? { retryAt } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    };
  }

  if (res.status === 401) return { reason: 'token_invalid', providerMessage };
  if (res.status === 404) return { reason: 'not_found_or_not_authorized', providerMessage };
  if (res.status === 403) return { reason: 'permission_denied', providerMessage };
  if (res.status >= 500) return { reason: 'unreachable', providerMessage };
  return { reason: 'permission_denied', providerMessage };
}

function sanitizeAuthorizeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
      return undefined;
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function readGitHubErrorMessage(res: Response): Promise<string | undefined> {
  const raw = await res.text().catch(() => '');
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === 'string' ? parsed.message.slice(0, 200) : raw.slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

function retryAtFromHeaders(headers: Headers, retryAfter: string | null): string | undefined {
  const reset = headers.get('x-ratelimit-reset');
  if (reset && /^\d+$/.test(reset)) {
    return new Date(Number.parseInt(reset, 10) * 1000).toISOString();
  }
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return new Date(Date.now() + Number.parseInt(retryAfter, 10) * 1000).toISOString();
  }
  return undefined;
}

// --- Mappers ---

function mapRepo(r: GHApiRepo): GitRepo {
  return {
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    sshUrl: r.ssh_url,
    isPrivate: r.private,
    defaultBranch: r.default_branch,
    language: r.language,
    updatedAt: r.updated_at,
    stars: r.stargazers_count,
    provider: 'github',
  };
}

function mapUser(u: GHApiUser): GitUser {
  return {
    username: u.login,
    displayName: u.name,
    avatarUrl: u.avatar_url,
    publicRepoCount: u.public_repos,
    privateRepoCount: u.total_private_repos,
  };
}
