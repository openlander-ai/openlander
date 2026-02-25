/**
 * GitHub provider implementation.
 *
 * Uses GitHub REST API v3 with a Personal Access Token (PAT).
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
import { createModuleLogger } from '../lib/logger.js';

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

interface GHSearchResult {
  total_count: number;
  items: GHApiRepo[];
}

// --- Implementation ---

export class GitHubProvider implements GitProvider {
  readonly type = 'github' as const;
  readonly displayName = 'GitHub';

  private readonly apiBase: string;

  constructor(
    private readonly token: string,
    baseUrl?: string,
  ) {
    this.apiBase = baseUrl ?? DEFAULT_API_BASE;
  }

  async validateToken(): Promise<TokenValidation> {
    try {
      const res = await this.request<GHApiUser>('/user');
      const scopes = (res.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      return {
        valid: true,
        user: mapUser(res.data),
        scopes,
      };
    } catch (error) {
      return {
        valid: false,
        user: null,
        scopes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async listRepos(opts?: ListReposOptions): Promise<ListReposResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 30;
    const sort = opts?.sort ?? 'pushed';
    const type = opts?.visibility ?? 'all';

    const res = await this.request<GHApiRepo[]>(
      `/user/repos?page=${page}&per_page=${perPage}&sort=${sort}&type=${type}&direction=desc`,
    );

    const repos = res.data.map((r) => mapRepo(r));
    const linkHeader = res.headers.get('link') ?? '';
    const hasMore = linkHeader.includes('rel="next"');

    return { repos, hasMore };
  }

  async searchRepos(query: string, opts?: SearchReposOptions): Promise<SearchReposResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;

    // Search user's own repos + repos they have access to
    const encodedQuery = encodeURIComponent(`${query} user:@me`);
    const res = await this.request<GHSearchResult>(
      `/search/repositories?q=${encodedQuery}&page=${page}&per_page=${perPage}&sort=updated`,
    );

    return {
      repos: res.data.items.map((r) => mapRepo(r)),
      total: res.data.total_count,
    };
  }

  async getRepo(owner: string, name: string): Promise<GitRepo> {
    const res = await this.request<GHApiRepo>(`/repos/${owner}/${name}`);
    return mapRepo(res.data);
  }

  async hasDockerfile(owner: string, name: string, branch?: string): Promise<boolean> {
    try {
      const ref = branch ?? 'HEAD';
      await this.request<unknown>(`/repos/${owner}/${name}/contents/Dockerfile?ref=${ref}`);
      return true;
    } catch (err) {
      log.debug({ err, owner, name }, 'Dockerfile check failed — assuming not present');
      return false;
      return false;
    }
  }

  getAuthCloneUrl(repoFullName: string): string {
    return `https://x-access-token:${this.token}@github.com/${repoFullName}.git`;
  }

  // --- Internal ---

  private async request<T>(path: string): Promise<{ data: T; headers: Headers }> {
    const url = `${this.apiBase}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'OpenLander/0.4',
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('Invalid or expired GitHub token');
      if (res.status === 403) throw new Error('GitHub token lacks required permissions');
      if (res.status === 404) throw new Error('GitHub resource not found');
      throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as T;
    return { data, headers: res.headers };
  }
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
