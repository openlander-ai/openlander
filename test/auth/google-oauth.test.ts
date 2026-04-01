import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { generatePkce, getGoogleAuthUrl, exchangeGoogleCode } from '../../src/auth/google-oauth.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// generatePkce tests
// ---------------------------------------------------------------------------

describe('generatePkce', () => {
  it('generates PKCE verifier and challenge', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toBeTruthy();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBeTruthy();
    expect(challenge).not.toBe(verifier);
  });

  it('generates unique values on each call', () => {
    const first = generatePkce();
    const second = generatePkce();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

// ---------------------------------------------------------------------------
// getGoogleAuthUrl tests
// ---------------------------------------------------------------------------

describe('getGoogleAuthUrl', () => {
  it('builds correct Google auth URL with all required params', () => {
    const url = getGoogleAuthUrl(
      'client-id-123',
      'https://example.com/callback',
      'challenge-abc',
      'state-xyz',
    );
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('accounts.google.com');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-id-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/callback');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state-xyz');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('includes Gemini scope', () => {
    const url = getGoogleAuthUrl('id', 'https://cb', 'ch', 'st');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toContain('generative-language');
  });
});

// ---------------------------------------------------------------------------
// exchangeGoogleCode tests
// ---------------------------------------------------------------------------

describe('exchangeGoogleCode', () => {
  it('returns tokens on successful exchange', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const result = await exchangeGoogleCode(
      'auth-code',
      'verifier',
      'https://example.com/callback',
      'client-id',
      'client-secret',
    );

    expect(result.access_token).toBe('access-123');
    expect(result.refresh_token).toBe('refresh-456');
    expect(result.expires_in).toBe(3600);
  });

  it('throws on non-ok response', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(
      exchangeGoogleCode('bad-code', 'verifier', 'https://cb', 'id', 'secret'),
    ).rejects.toThrow('Failed to exchange code');
  });

  it('throws when response contains error field', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'Code expired',
      }),
    });

    await expect(
      exchangeGoogleCode('expired-code', 'verifier', 'https://cb', 'id', 'secret'),
    ).rejects.toThrow('Google OAuth error');
  });

  it('throws when access_token is missing from response', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        refresh_token: 'refresh-only',
        expires_in: 3600,
      }),
    });

    await expect(
      exchangeGoogleCode('code', 'verifier', 'https://cb', 'id', 'secret'),
    ).rejects.toThrow('missing access_token');
  });
});
