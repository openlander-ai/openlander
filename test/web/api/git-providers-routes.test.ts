import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { updateConfig } from '../../../src/config/index.js';
import { createGitProvider } from '../../../src/git-providers/index.js';
import { createGitProvidersRoutes } from '../../../src/web/api/git-providers-routes.js';

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...actual,
    updateConfig: vi.fn((partial: unknown) => partial),
  };
});

vi.mock('../../../src/git-providers/index.js', () => ({
  createGitProvider: vi.fn(),
}));

function createCtx() {
  return {
    config: {
      gitProviders: {
        github: {
          token: 'ghp_test',
          username: 'old-user',
          authMethod: 'pat',
          connectedAt: null,
          lastSyncAt: null,
        },
      },
    },
    db: {
      listServices: vi.fn(async () => []),
    },
  } as unknown as AppContext;
}

describe('createGitProvidersRoutes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T01:02:03.000Z'));
    vi.mocked(updateConfig).mockClear();
    vi.mocked(createGitProvider).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists connectedAt and lastSyncAt after successful GitHub validation', async () => {
    const ctx = createCtx();
    vi.mocked(createGitProvider).mockReturnValue({
      validateToken: vi.fn(async () => ({
        valid: true,
        user: {
          username: 'octocat',
          displayName: 'Octo Cat',
          avatarUrl: 'https://github.com/images/error/octocat_happy.gif',
          publicRepoCount: 10,
          privateRepoCount: 2,
        },
        scopes: ['repo', 'read:user'],
      })),
    } as unknown as ReturnType<typeof createGitProvider>);

    const app = createGitProvidersRoutes(ctx);
    const res = await app.request('/git-providers/github');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      connected: true,
      tokenValid: true,
      login: 'octocat',
      connectedAt: '2026-05-08T01:02:03.000Z',
      lastSyncAt: '2026-05-08T01:02:03.000Z',
    });
    expect(ctx.config.gitProviders.github).toMatchObject({
      username: 'octocat',
      connectedAt: '2026-05-08T01:02:03.000Z',
      lastSyncAt: '2026-05-08T01:02:03.000Z',
    });
    expect(updateConfig).toHaveBeenCalledWith({
      gitProviders: {
        github: {
          username: 'octocat',
          connectedAt: '2026-05-08T01:02:03.000Z',
          lastSyncAt: '2026-05-08T01:02:03.000Z',
        },
      },
    });
  });

  it('does not overwrite timestamps when GitHub rejects the token', async () => {
    const ctx = createCtx();
    ctx.config.gitProviders.github.connectedAt = '2026-05-01T00:00:00.000Z';
    ctx.config.gitProviders.github.lastSyncAt = '2026-05-02T00:00:00.000Z';
    vi.mocked(createGitProvider).mockReturnValue({
      validateToken: vi.fn(async () => ({
        valid: false,
        user: null,
        scopes: [],
        error: 'Invalid or expired GitHub token',
      })),
    } as unknown as ReturnType<typeof createGitProvider>);

    const app = createGitProvidersRoutes(ctx);
    const res = await app.request('/git-providers/github');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      connected: true,
      tokenValid: false,
      connectedAt: '2026-05-01T00:00:00.000Z',
      lastSyncAt: '2026-05-02T00:00:00.000Z',
    });
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('returns structured GitHub validation guidance without provider response text', async () => {
    const ctx = createCtx();
    vi.mocked(createGitProvider).mockReturnValue({
      validateToken: vi.fn(async () => ({
        valid: false,
        user: null,
        scopes: [],
        error: 'GitHub SSO authorization is required for this repository.',
        errorCode: 'GITHUB_REPO_ACCESS_DENIED',
        errorDetails: {
          reason: 'sso_required',
          authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
          providerMessage: 'must not cross the API boundary',
        },
      })),
    } as unknown as ReturnType<typeof createGitProvider>);

    const res = await createGitProvidersRoutes(ctx).request('/git-providers/github');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      tokenValid: false,
      validationReason: 'sso_required',
      authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
      retryAt: null,
    });
    expect(JSON.stringify(body)).not.toContain('must not cross the API boundary');
  });
});
