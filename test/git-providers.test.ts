import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createGitProvider,
  createConfiguredProviders,
  getDefaultProvider,
} from '../src/git-providers/index.js';
import { GitHubProvider } from '../src/git-providers/github.js';
import type { GitProviderConfig, GitProviderType } from '../src/git-providers/types.js';
import { GitHubRepoAccessError } from '../src/errors.js';

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
      json: async () => [
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
      headers: new Headers(),
    } as Response);

    const result = await provider.searchRepos('search-result');

    expect(result.total).toBe(1);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe('search-result');
    expect(result.repos[0]?.isPrivate).toBe(true);
  });

  it('searches collaborator repositories from the paginated accessible-repo list', async () => {
    mockFetch()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: 'unrelated',
              full_name: 'testuser/unrelated',
              description: null,
              html_url: 'https://github.com/testuser/unrelated',
              clone_url: 'https://github.com/testuser/unrelated.git',
              ssh_url: 'git@github.com:testuser/unrelated.git',
              private: true,
              default_branch: 'main',
              language: null,
              updated_at: '2026-01-01T00:00:00Z',
              stargazers_count: 0,
            },
          ]),
          { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: 'shared-service',
              full_name: 'outside-owner/shared-service',
              description: 'Outside collaborator repository',
              html_url: 'https://github.com/outside-owner/shared-service',
              clone_url: 'https://github.com/outside-owner/shared-service.git',
              ssh_url: 'git@github.com:outside-owner/shared-service.git',
              private: true,
              default_branch: 'main',
              language: 'TypeScript',
              updated_at: '2026-01-01T00:00:00Z',
              stargazers_count: 0,
            },
          ]),
        ),
      );

    const result = await provider.searchRepos('outside collaborator');

    expect(result.repos.map((repo) => repo.fullName)).toEqual(['outside-owner/shared-service']);
    expect(mockFetch().mock.calls[0]?.[0]).toContain(
      'affiliation=owner,collaborator,organization_member',
    );
  });

  it('marks search results truncated when more than ten accessible-repo pages exist', async () => {
    for (let page = 1; page <= 10; page++) {
      mockFetch().mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          headers: {
            link: `<https://api.github.com/user/repos?page=${String(page + 1)}>; rel="next"`,
          },
        }),
      );
    }

    const result = await provider.searchRepos('anything');

    expect(result).toMatchObject({ repos: [], total: 0, truncated: true });
    expect(mockFetch()).toHaveBeenCalledTimes(10);
  });

  it('uses a single repository access check for exact owner/repo search', async () => {
    mockFetch().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: 'repo',
          full_name: 'outside-owner/repo',
          description: null,
          html_url: 'https://github.com/outside-owner/repo',
          clone_url: 'https://github.com/outside-owner/repo.git',
          ssh_url: 'git@github.com:outside-owner/repo.git',
          private: true,
          default_branch: 'main',
          language: null,
          updated_at: '2026-01-01T00:00:00Z',
          stargazers_count: 0,
        }),
      ),
    );

    const result = await provider.searchRepos('outside-owner/repo');

    expect(result.total).toBe(1);
    expect(mockFetch()).toHaveBeenCalledTimes(1);
    expect(mockFetch().mock.calls[0]?.[0]).toBe('https://api.github.com/repos/outside-owner/repo');
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

  it('throws a typed token_invalid error on 401 Unauthorized', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Bad credentials',
      headers: new Headers(),
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: { reason: 'token_invalid' },
    });
  });

  it('throws a typed rate_limited error for rate-limit 403 responses', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Rate limit exceeded',
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: { reason: 'rate_limited' },
    });
  });

  it('classifies generic 403 as permission_denied', async () => {
    mockFetch().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Resource not accessible by token' }), {
        status: 403,
      }),
    );

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      details: { reason: 'permission_denied' },
    });
  });

  it('classifies 429 as rate_limited and exposes retryAt', async () => {
    mockFetch().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Slow down' }), {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    );

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      details: { reason: 'rate_limited', retryAt: expect.any(String) },
    });
  });

  it.each([
    ['server error', () => Promise.resolve(new Response('Unavailable', { status: 503 }))],
    ['network error', () => Promise.reject(new Error('socket closed'))],
  ])('classifies %s as unreachable', async (_label, responseFactory) => {
    mockFetch().mockImplementationOnce(responseFactory);

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      details: { reason: 'unreachable' },
    });
  });

  it('keeps 404 ambiguous between missing and unauthorized', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
      headers: new Headers(),
    } as Response);

    await expect(provider.getRepo('user', 'repo')).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: { reason: 'not_found_or_not_authorized' },
    });
  });

  it('surfaces the GitHub SSO authorization URL', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ message: 'Resource protected by organization SAML' }),
      headers: new Headers({
        'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=abc',
      }),
    } as Response);

    try {
      await provider.getRepo('acme', 'private-repo');
      throw new Error('expected access check to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubRepoAccessError);
      expect((error as GitHubRepoAccessError).details).toMatchObject({
        reason: 'sso_required',
        authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
      });
    }
  });

  it('removes URL userinfo from GitHub SSO authorization links', async () => {
    mockFetch().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'SSO required' }), {
        status: 403,
        headers: {
          'x-github-sso':
            'required; url=https://credential@github.com/orgs/acme/sso?authorization_request=abc',
        },
      }),
    );

    try {
      await provider.getRepo('acme', 'private-repo');
      throw new Error('expected access check to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubRepoAccessError);
      const serialized = JSON.stringify((error as GitHubRepoAccessError).toJSON());
      expect(serialized).not.toContain('credential@');
      expect((error as GitHubRepoAccessError).details).toMatchObject({
        authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
      });
    }
  });
});
