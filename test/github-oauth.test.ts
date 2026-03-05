import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getGitHubClientId,
  requestDeviceCode,
  pollForAccessToken,
  openInBrowser,
} from '../src/git-providers/github-oauth.js';

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
  delete process.env.OPENLANDER_GITHUB_CLIENT_ID;
});

// Helper to get mocked fetch
function mockFetch() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// getGitHubClientId tests
// ---------------------------------------------------------------------------

describe('getGitHubClientId', () => {
  it('returns hardcoded client_id when env var is not set', () => {
    delete process.env.OPENLANDER_GITHUB_CLIENT_ID;
    expect(getGitHubClientId()).toBeTruthy();
    expect(getGitHubClientId().length).toBeGreaterThan(0);
  });

  it('returns env var value when set', () => {
    process.env.OPENLANDER_GITHUB_CLIENT_ID = 'test-client-id';
    expect(getGitHubClientId()).toBe('test-client-id');
  });
});

// ---------------------------------------------------------------------------
// requestDeviceCode tests
// ---------------------------------------------------------------------------

describe('requestDeviceCode', () => {
  it('requests device code from GitHub', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'test-device-code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    } as Response);

    const result = await requestDeviceCode('test-client-id');

    expect(result.device_code).toBe('test-device-code');
    expect(result.user_code).toBe('ABCD-1234');
    expect(result.verification_uri).toBe('https://github.com/login/device');
    expect(result.expires_in).toBe(900);
    expect(result.interval).toBe(5);

    // Verify request was made correctly
    const callArgs = mockFetch().mock.calls[0];
    expect(callArgs?.[0]).toBe('https://github.com/login/device/code');
    const body = JSON.parse(callArgs?.[1]?.body as string);
    expect(body.client_id).toBe('test-client-id');
    expect(body.scope).toBe('repo read:user read:org');
  });

  it('uses custom scope when provided', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'test-device-code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    } as Response);

    await requestDeviceCode('test-client-id', 'repo');

    const callArgs = mockFetch().mock.calls[0];
    const body = JSON.parse(callArgs?.[1]?.body as string);
    expect(body.scope).toBe('repo');
  });

  it('throws on HTTP error', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    } as Response);

    await expect(requestDeviceCode('test-client-id')).rejects.toThrow(
      'Failed to request device code',
    );
  });

  it('throws on invalid response', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    } as Response);

    await expect(requestDeviceCode('test-client-id')).rejects.toThrow(
      'Invalid device code response',
    );
  });
});

// ---------------------------------------------------------------------------
// pollForAccessToken tests
// ---------------------------------------------------------------------------

describe('pollForAccessToken', () => {
  it('returns access token on immediate success', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'gho_test_token',
        token_type: 'bearer',
        scope: 'repo',
      }),
    } as Response);

    const result = await pollForAccessToken('test-client-id', 'test-device-code', 0);

    expect(result).toBe('gho_test_token');
  });

  it('returns access token on success after authorization_pending', async () => {
    // First poll: authorization_pending, second poll: success
    let callCount = 0;
    mockFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ error: 'authorization_pending' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'gho_test_token',
          token_type: 'bearer',
          scope: 'repo',
        }),
      } as Response;
    });

    const result = await pollForAccessToken('test-client-id', 'test-device-code', 0);

    expect(result).toBe('gho_test_token');
    expect(callCount).toBe(2);
  });

  it('throws on expired_token error', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'expired_token' }),
    } as Response);

    await expect(pollForAccessToken('test-client-id', 'test-device-code', 0)).rejects.toThrow(
      'Device code expired',
    );
  });

  it('throws on access_denied error', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'access_denied' }),
    } as Response);

    await expect(pollForAccessToken('test-client-id', 'test-device-code', 0)).rejects.toThrow(
      'Authorization denied by user',
    );
  });

  it('throws on AbortSignal cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollForAccessToken('test-client-id', 'test-device-code', 0, controller.signal),
    ).rejects.toThrow('Polling cancelled');
  });

  it('continues polling on non-OK response', async () => {
    let callCount = 0;
    mockFetch().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal server error',
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ access_token: 'gho_test_token' }),
      } as Response;
    });

    const result = await pollForAccessToken('test-client-id', 'test-device-code', 0);

    expect(result).toBe('gho_test_token');
    expect(callCount).toBe(2);
  });

  it('sends correct request body', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'gho_test_token' }),
    } as Response);

    await pollForAccessToken('test-client-id', 'test-device-code', 0);

    const callArgs = mockFetch().mock.calls[0];
    expect(callArgs?.[0]).toBe('https://github.com/login/oauth/access_token');
    const body = JSON.parse(callArgs?.[1]?.body as string);
    expect(body.client_id).toBe('test-client-id');
    expect(body.device_code).toBe('test-device-code');
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });

  it('sends correct headers', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'gho_test_token' }),
    } as Response);

    await pollForAccessToken('test-client-id', 'test-device-code', 0);

    const callArgs = mockFetch().mock.calls[0];
    const headers = callArgs?.[1]?.headers as Record<string, string>;
    expect(headers?.['Accept']).toBe('application/json');
    expect(headers?.['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// openInBrowser tests
// ---------------------------------------------------------------------------

describe('openInBrowser', () => {
  it('opens URL without throwing', () => {
    // This function uses child_process.exec which is hard to mock
    // Just verify it doesn't throw
    expect(() => openInBrowser('https://example.com')).not.toThrow();
  });
});
