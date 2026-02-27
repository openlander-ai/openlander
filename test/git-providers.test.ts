import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createGitProvider,
  createConfiguredProviders,
  getDefaultProvider,
} from '../src/git-providers/index.js';
import { GitHubProvider } from '../src/git-providers/github.js';
import type { GitProviderConfig, GitProviderType } from '../src/git-providers/types.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetAllMocks();
});

// Helper to get mocked fetch
function mockFetch() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// createGitProvider factory tests
// ---------------------------------------------------------------------------

describe('createGitProvider', () => {
  it('creates GitHubProvider for github type', () => {
    const config: GitProviderConfig = { token: 'ghp_test', username: 'testuser' };
    const provider = createGitProvider('github', config);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(provider.type).toBe('github');
    expect(provider.displayName).toBe('GitHub');
  });

  it('throws when token is missing', () => {
    const config: GitProviderConfig = { token: '', username: '' };
    expect(() => createGitProvider('github', config)).toThrow('No token configured');
  });

  it('throws for unsupported provider type', () => {
    const config: GitProviderConfig = { token: 'test', username: '' };
    expect(() => createGitProvider('bitbucket' as unknown as GitProviderType, config)).toThrow(
      'Unsupported git provider',
    );
  });

  it('uses custom baseUrl when provided', () => {
    const config: GitProviderConfig = {
      token: 'ghp_test',
      username: 'testuser',
      baseUrl: 'https://github.enterprise.com/api/v3',
    };
    const provider = createGitProvider('github', config);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });
});

// ---------------------------------------------------------------------------
// createConfiguredProviders tests
// ---------------------------------------------------------------------------

describe('createConfiguredProviders', () => {
  it('returns map with only configured providers', () => {
    const gitProviders: Partial<Record<GitProviderType, GitProviderConfig>> = {
      github: { token: 'ghp_test', username: 'ghuser' },
      gitlab: { token: '', username: '' }, // empty token = not configured
    };

    const providers = createConfiguredProviders(gitProviders);
    expect(providers.size).toBe(1);
    expect(providers.has('github')).toBe(true);
    expect(providers.has('gitlab')).toBe(false);
  });

  it('returns empty map when no providers configured', () => {
    const providers = createConfiguredProviders({});
    expect(providers.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDefaultProvider tests
// ---------------------------------------------------------------------------

describe('getDefaultProvider', () => {
  it('returns GitHub provider first when available', () => {
    const config: GitProviderConfig = { token: 'ghp_test', username: '' };
    const providers = new Map<GitProviderType, ReturnType<typeof createGitProvider>>();
    providers.set('github', createGitProvider('github', config));

    const result = getDefaultProvider(providers);
    expect(result?.type).toBe('github');
  });

  it('returns null when no providers available', () => {
    const providers = new Map<GitProviderType, ReturnType<typeof createGitProvider>>();
    expect(getDefaultProvider(providers)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GitHubProvider tests
// ---------------------------------------------------------------------------

describe('GitHubProvider', () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    provider = new GitHubProvider('ghp_test_token');
  });

  it('sends correct authorization headers', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'x-oauth-scopes': 'repo' }),
      json: async () => ({
        login: 'testuser',
        name: 'Test User',
        avatar_url: 'https://avatar.url',
        public_repos: 10,
        total_private_repos: 5,
      }),
    } as Response);

    await provider.validateToken();

    const headers = mockFetch().mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer ghp_test_token');
    expect(headers['Accept']).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('validateToken returns valid result on success', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'x-oauth-scopes': 'repo, user' }),
      json: async () => ({
        login: 'testuser',
        name: 'Test User',
        avatar_url: 'https://avatar.url',
        public_repos: 10,
        total_private_repos: 5,
      }),
    } as Response);

    const result = await provider.validateToken();

    expect(result.valid).toBe(true);
    expect(result.user?.username).toBe('testuser');
    expect(result.scopes).toContain('repo');
    expect(result.scopes).toContain('user');
  });

  it('validateToken returns invalid result on error', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    const result = await provider.validateToken();

    expect(result.valid).toBe(false);
    expect(result.user).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('listRepos returns mapped repos', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ link: '<https://api.github.com?page=2>; rel="next"' }),
      json: async () => [
        {
          name: 'my-app',
          full_name: 'user/my-app',
          description: 'Test app',
          html_url: 'https://github.com/user/my-app',
          clone_url: 'https://github.com/user/my-app.git',
          ssh_url: 'git@github.com:user/my-app.git',
          private: false,
          default_branch: 'main',
          language: 'TypeScript',
          updated_at: '2026-01-01T00:00:00Z',
          stargazers_count: 100,
        },
      ],
    } as Response);

    const result = await provider.listRepos();

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe('my-app');
    expect(result.repos[0]?.provider).toBe('github');
    expect(result.hasMore).toBe(true);
  });

  it('searchRepos returns mapped results', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        items: [
          {
            name: 'search-result',
            full_name: 'user/search-result',
            description: null,
            html_url: 'https://github.com/user/search-result',
            clone_url: 'https://github.com/user/search-result.git',
            ssh_url: 'git@github.com:user/search-result.git',
            private: true,
            default_branch: 'develop',
            language: null,
            updated_at: '2026-01-01T00:00:00Z',
            stargazers_count: 0,
          },
        ],
      }),
    } as Response);

    const result = await provider.searchRepos('search-result');

    expect(result.total).toBe(1);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe('search-result');
    expect(result.repos[0]?.isPrivate).toBe(true);
  });

  it('getRepo returns single repo', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: 'single-repo',
        full_name: 'user/single-repo',
        description: 'A single repo',
        html_url: 'https://github.com/user/single-repo',
        clone_url: 'https://github.com/user/single-repo.git',
        ssh_url: 'git@github.com:user/single-repo.git',
        private: false,
        default_branch: 'main',
        language: 'JavaScript',
        updated_at: '2026-01-01T00:00:00Z',
        stargazers_count: 50,
      }),
    } as Response);

    const repo = await provider.getRepo('user', 'single-repo');

    expect(repo.name).toBe('single-repo');
    expect(repo.fullName).toBe('user/single-repo');
    expect(repo.language).toBe('JavaScript');
  });

  it('hasDockerfile returns true when Dockerfile exists', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: 'RlJPTSBub2RlOjE4' }), // base64
    } as Response);

    const result = await provider.hasDockerfile('user', 'repo');
    expect(result).toBe(true);
  });

  it('hasDockerfile returns false when Dockerfile missing', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await provider.hasDockerfile('user', 'repo');
    expect(result).toBe(false);
  });

  it('getAuthCloneUrl returns URL with embedded token', () => {
    const url = provider.getAuthCloneUrl('user/repo');
    expect(url).toBe('https://x-access-token:ghp_test_token@github.com/user/repo.git');
  });

  it('throws on 401 Unauthorized', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Bad credentials',
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toThrow(
      'Invalid or expired GitHub token',
    );
  });

  it('throws on 403 Forbidden', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Rate limit exceeded',
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toThrow(
      'GitHub token lacks required permissions',
    );
  });

  it('throws on 404 Not Found', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toThrow('GitHub resource not found');
  });
});
