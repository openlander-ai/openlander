import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitLabProvider } from '../src/git-providers/gitlab.js';

function mockResponse(input: {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Headers;
}): Response {
  return {
    ok: input.ok,
    status: input.status ?? 200,
    headers: input.headers ?? new Headers(),
    json: async () => input.json,
    text: async () => input.text ?? '',
  } as unknown as Response;
}

const baseProject = {
  id: 1,
  name: 'web',
  path_with_namespace: 'team/web',
  description: 'Test project',
  web_url: 'https://gitlab.com/team/web',
  http_url_to_repo: 'https://gitlab.com/team/web.git',
  ssh_url_to_repo: 'git@gitlab.com:team/web.git',
  visibility: 'private' as const,
  default_branch: 'main',
  languages: { TypeScript: 70, JavaScript: 30 },
  last_activity_at: '2026-02-01T00:00:00Z',
  star_count: 5,
};

describe('GitLabProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('validateToken succeeds with user and project count', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        json: { id: 12, username: 'alice', name: 'Alice', avatar_url: 'u' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        json: [baseProject],
        headers: new Headers({ 'x-total': '42' }),
      }),
    );

    const provider = new GitLabProvider('glpat_token');
    const result = await provider.validateToken();

    expect(result.valid).toBe(true);
    expect(result.user?.username).toBe('alice');
    expect(result.user?.publicRepoCount).toBe(42);
  });

  it('validateToken fails on 401', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: 'Unauthorized' }));

    const provider = new GitLabProvider('bad-token');
    const result = await provider.validateToken();

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid or expired GitLab token');
  });

  it('listRepos maps fields and reads pagination header', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        json: [baseProject],
        headers: new Headers({ 'x-next-page': '2' }),
      }),
    );

    const provider = new GitLabProvider('token');
    const result = await provider.listRepos();

    expect(result.hasMore).toBe(true);
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toEqual(
      expect.objectContaining({
        name: 'web',
        fullName: 'team/web',
        cloneUrl: 'https://gitlab.com/team/web.git',
        isPrivate: true,
        provider: 'gitlab',
      }),
    );
  });

  it('searchRepos encodes query in URL', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: true,
        json: [baseProject],
        headers: new Headers({ 'x-total': '1' }),
      }),
    );

    const provider = new GitLabProvider('token');
    await provider.searchRepos('my repo/one');

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('search=my%20repo%2Fone');
  });

  it('getRepo encodes owner/name path', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, json: baseProject }));

    const provider = new GitLabProvider('token');
    await provider.getRepo('group/subgroup', 'repo');

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/v4/projects/group%2Fsubgroup%2Frepo');
  });

  it('hasDockerfile returns true when Dockerfile exists', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, json: { file_path: 'Dockerfile' } }));

    const provider = new GitLabProvider('token');
    const result = await provider.hasDockerfile('team', 'web');

    expect(result).toBe(true);
  });

  it('hasDockerfile returns false on 404', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: 'Not found' }));

    const provider = new GitLabProvider('token');
    const result = await provider.hasDockerfile('team', 'web');

    expect(result).toBe(false);
  });

  it('returns auth clone URL and display name for gitlab.com and self-hosted', () => {
    const cloudProvider = new GitLabProvider('token');
    const selfHostedProvider = new GitLabProvider('token', 'https://gitlab.example.com');

    expect(cloudProvider.getAuthCloneUrl('group/repo')).toBe(
      'https://oauth2:token@gitlab.com/group/repo.git',
    );
    expect(selfHostedProvider.getAuthCloneUrl('group/repo')).toBe(
      'https://oauth2:token@gitlab.example.com/group/repo.git',
    );
    expect(cloudProvider.displayName).toBe('GitLab');
    expect(selfHostedProvider.displayName).toBe('GitLab (gitlab.example.com)');
  });

  it('sends PRIVATE-TOKEN header and does not use Bearer auth', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: true, json: [baseProject], headers: new Headers() }),
    );

    const provider = new GitLabProvider('glpat_secret');
    await provider.listRepos();

    const [, options] = fetchMock.mock.calls[0] ?? [];
    const headers = (options as { headers?: Record<string, string> }).headers ?? {};
    expect(headers['PRIVATE-TOKEN']).toBe('glpat_secret');
    expect(headers['Authorization']).toBeUndefined();
  });
});
