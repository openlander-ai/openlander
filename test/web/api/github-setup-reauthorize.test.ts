import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { updateConfig } from '../../../src/config/index.js';
import { createGitProvider } from '../../../src/git-providers/index.js';
import { createGithubSetupRoutes } from '../../../src/web/api/setup/github-routes.js';

vi.mock('../../../src/config/index.js', () => ({
  updateConfig: vi.fn(),
}));

vi.mock('../../../src/git-providers/index.js', () => ({
  createGitProvider: vi.fn(),
}));

vi.mock('../../../src/git-providers/github-oauth.js', () => ({
  requestDeviceCode: vi.fn(),
  getGitHubClientId: vi.fn(() => 'test-client-id'),
}));

const originalFetch = global.fetch;

function createCtx(): AppContext {
  return {
    config: {
      gitProviders: {
        github: {
          token: 'old-token',
          username: 'old-user',
          authMethod: 'pat',
          connectedAt: '2026-01-01T00:00:00.000Z',
          lastSyncAt: '2026-01-02T00:00:00.000Z',
        },
      },
    },
  } as unknown as AppContext;
}

describe('GitHub re-authorization token replacement', () => {
  beforeEach(() => {
    vi.mocked(updateConfig).mockReset();
    vi.mocked(createGitProvider).mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the existing token when PAT validation fails', async () => {
    const ctx = createCtx();
    vi.mocked(createGitProvider).mockReturnValue({
      validateToken: vi.fn(async () => ({
        valid: false,
        user: null,
        scopes: [],
        error: 'Bad credentials',
      })),
    } as unknown as ReturnType<typeof createGitProvider>);

    const res = await createGithubSetupRoutes(ctx).request('/setup/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid-new-token' }),
    });

    expect(res.status).toBe(400);
    expect(updateConfig).not.toHaveBeenCalled();
    expect(ctx.config.gitProviders.github).toMatchObject({
      token: 'old-token',
      username: 'old-user',
    });
  });

  it('replaces the token only after PAT validation succeeds', async () => {
    const ctx = createCtx();
    vi.mocked(createGitProvider).mockReturnValue({
      validateToken: vi.fn(async () => ({
        valid: true,
        user: {
          username: 'new-user',
          displayName: null,
          avatarUrl: '',
          publicRepoCount: 0,
          privateRepoCount: 1,
        },
        scopes: ['repo'],
      })),
    } as unknown as ReturnType<typeof createGitProvider>);

    const res = await createGithubSetupRoutes(ctx).request('/setup/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'new-token' }),
    });

    expect(res.status).toBe(200);
    expect(updateConfig).toHaveBeenCalledWith({
      gitProviders: {
        github: expect.objectContaining({
          token: 'new-token',
          username: 'new-user',
          authMethod: 'pat',
        }),
      },
    });
    expect(ctx.config.gitProviders.github).toMatchObject({
      token: 'new-token',
      username: 'new-user',
      authMethod: 'pat',
    });
  });

  it.each([
    ['access_denied', 403],
    ['expired_token', 410],
  ])('keeps the existing token when OAuth returns %s', async (oauthError, expectedStatus) => {
    const ctx = createCtx();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: oauthError }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await createGithubSetupRoutes(ctx).request('/setup/github/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'device-code', interval: 5 }),
    });

    expect(res.status).toBe(expectedStatus);
    expect(updateConfig).not.toHaveBeenCalled();
    expect(ctx.config.gitProviders.github.token).toBe('old-token');
  });
});
