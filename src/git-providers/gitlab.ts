import { createModuleLogger } from '../lib/logger.js';
import type {
  GitProvider,
  GitRepo,
  TokenValidation,
  ListReposOptions,
  ListReposResult,
  SearchReposOptions,
  SearchReposResult,
} from './types.js';

const log = createModuleLogger('gitlab');

interface GitLabProject {
  name: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  visibility: 'public' | 'private' | 'internal';
  default_branch: string | null;
  language: string | null;
  last_activity_at: string;
  star_count: number;
}

interface GitLabUser {
  username: string;
  name: string | null;
  avatar_url: string;
}

export class GitLabProvider implements GitProvider {
  readonly type = 'gitlab' as const;
  readonly displayName: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly hostname: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl ?? 'https://gitlab.com').replace(/\/$/, '');
    this.hostname = new URL(this.baseUrl).hostname;
    this.displayName = this.hostname === 'gitlab.com' ? 'GitLab' : `GitLab (${this.hostname})`;
  }

  async validateToken(): Promise<TokenValidation> {
    try {
      const user = (await this.request('/api/v4/user')) as GitLabUser;
      const repoCountRes = (await this.requestWithHeaders(
        '/api/v4/projects?membership=true&statistics=false&per_page=1',
      )) as { data: GitLabProject[]; headers: Headers };
      const totalRepos = Number.parseInt(repoCountRes.headers.get('x-total') ?? '0', 10);

      return {
        valid: true,
        user: {
          username: user.username,
          displayName: user.name,
          avatarUrl: user.avatar_url,
          publicRepoCount: totalRepos,
          privateRepoCount: 0,
        },
        scopes: [],
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
    const visibility =
      opts?.visibility && opts.visibility !== 'all' ? `&visibility=${opts.visibility}` : '';
    const path =
      '/api/v4/projects' +
      `?membership=true&order_by=last_activity_at&sort=desc&per_page=${String(perPage)}&page=${String(page)}${visibility}`;

    const { data, headers } = (await this.requestWithHeaders(path)) as {
      data: GitLabProject[];
      headers: Headers;
    };
    const repos = data.map((repo) => mapRepo(repo));
    const hasMore = (headers.get('x-next-page') ?? '') !== '';

    return { repos, hasMore };
  }

  async searchRepos(query: string, opts?: SearchReposOptions): Promise<SearchReposResult> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    const encodedQuery = encodeURIComponent(query);
    const path =
      '/api/v4/projects' +
      `?search=${encodedQuery}&membership=true&per_page=${String(perPage)}&page=${String(page)}`;

    const { data, headers } = (await this.requestWithHeaders(path)) as {
      data: GitLabProject[];
      headers: Headers;
    };
    const repos = data.map((repo) => mapRepo(repo));
    const total = Number.parseInt(headers.get('x-total') ?? '0', 10);

    return { repos, total };
  }

  async getRepo(owner: string, name: string): Promise<GitRepo> {
    const projectPath = encodeURIComponent(`${owner}/${name}`);
    const repo = (await this.request(`/api/v4/projects/${projectPath}`)) as GitLabProject;
    return mapRepo(repo);
  }

  async hasDockerfile(owner: string, name: string, branch?: string): Promise<boolean> {
    const projectPath = encodeURIComponent(`${owner}/${name}`);
    const ref = encodeURIComponent(branch ?? 'main');
    const path = `/api/v4/projects/${projectPath}/repository/files/Dockerfile?ref=${ref}`;
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'PRIVATE-TOKEN': this.token },
    });

    if (response.ok) return true;
    if (response.status === 404) return false;

    log.debug({ owner, name, branch, status: response.status }, 'Dockerfile check failed');
    this.throwRequestError(response, path);
  }

  getAuthCloneUrl(repoFullName: string): string {
    return `https://oauth2:${this.token}@${this.hostname}/${repoFullName}.git`;
  }

  private async request(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'PRIVATE-TOKEN': this.token },
    });

    if (!response.ok) {
      this.throwRequestError(response, path);
    }

    return response.json();
  }

  private async requestWithHeaders(path: string): Promise<{ data: unknown; headers: Headers }> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'PRIVATE-TOKEN': this.token },
    });

    if (!response.ok) {
      this.throwRequestError(response, path);
    }

    const data: unknown = await response.json();
    return { data, headers: response.headers };
  }

  private throwRequestError(response: Response, path: string): never {
    if (response.status === 401) throw new Error('Invalid or expired GitLab token');
    if (response.status === 403)
      throw new Error('GitLab token lacks required permissions (api scope needed)');
    if (response.status === 404) throw new Error(`GitLab resource not found: ${path}`);
    throw new Error(`GitLab API error: ${String(response.status)} ${response.statusText}`);
  }
}

function mapRepo(project: GitLabProject): GitRepo {
  return {
    fullName: project.path_with_namespace,
    name: project.name,
    description: project.description,
    htmlUrl: project.web_url,
    cloneUrl: project.http_url_to_repo,
    sshUrl: project.ssh_url_to_repo,
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    isPrivate: project.visibility === 'private',
    defaultBranch: project.default_branch ?? 'main',
    language: project.language,
    updatedAt: project.last_activity_at,
    stars: project.star_count,
    provider: 'gitlab',
  };
}
