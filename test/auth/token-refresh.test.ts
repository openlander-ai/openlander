import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { refreshOAuthToken } from '../../src/auth/token-refresh.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockFetch() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

const baseOpts = {
  tokenUrl: 'https://oauth2.googleapis.com/token',
  refreshToken: 'test-refresh-token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

// ---------------------------------------------------------------------------
// refreshOAuthToken tests
// ---------------------------------------------------------------------------

describe('refreshOAuthToken', () => {
  it('returns null on 401 (invalid token)', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    });

    const result = await refreshOAuthToken(baseOpts);
    expect(result).toBeNull();
  });

  it('returns null on 400 (revoked token)', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'invalid_grant' }),
    });

    const result = await refreshOAuthToken(baseOpts);
    expect(result).toBeNull();
  });

  it('returns token on success', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const result = await refreshOAuthToken(baseOpts);
    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('new-access-token');
    expect(result?.expires_in).toBe(3600);
    expect(result?.token_type).toBe('Bearer');
  });

  it('returns null when response contains error field', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: 'invalid_grant',
      }),
    });

    const result = await refreshOAuthToken(baseOpts);
    expect(result).toBeNull();
  });

  it('throws on 5xx server error', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(refreshOAuthToken(baseOpts)).rejects.toThrow('Token refresh failed');
  });

  it('throws on network error', async () => {
    vi.useFakeTimers();
    mockFetch().mockRejectedValue(new Error('Network unreachable'));

    const result = refreshOAuthToken(baseOpts);
    const assertion = expect(result).rejects.toThrow('Token refresh failed');
    await vi.runAllTimersAsync();

    await assertion;
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('retries one transient network error before succeeding', async () => {
    vi.useFakeTimers();
    mockFetch()
      .mockRejectedValueOnce(new Error('Connect timeout'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'recovered-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

    const result = refreshOAuthToken(baseOpts);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ access_token: 'recovered-access-token' });
    expect(mockFetch()).toHaveBeenCalledTimes(2);
  });

  it('preserves new refresh token when returned', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'rotated-refresh-token',
        expires_in: 7200,
        token_type: 'Bearer',
      }),
    });

    const result = await refreshOAuthToken(baseOpts);
    expect(result?.refresh_token).toBe('rotated-refresh-token');
  });
});
