import { describe, expect, it, vi } from 'vitest';

import {
  CLOUDFLARE_AUTH_URL,
  CLOUDFLARE_TOKEN_URL,
  exchangeCloudflareCode,
  getCloudflareAuthUrl,
} from '../../src/auth/cloudflare-oauth.js';

describe('Cloudflare public OAuth PKCE', () => {
  it('builds an authorization URL without a client secret', () => {
    const value = getCloudflareAuthUrl({
      clientId: 'client-id',
      redirectUri: 'https://auth.openlander.example/cloudflare/callback',
      challenge: 'challenge',
      state: 'state',
      scopes: ['zone.dns.write', 'account.cloudflare-tunnel.write'],
    });
    const url = new URL(value);

    expect(`${url.origin}${url.pathname}`).toBe(CLOUDFLARE_AUTH_URL);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('zone.dns.write account.cloudflare-tunnel.write');
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('exchanges a code with the PKCE verifier and accepts a refresh token', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_id')).toBe('client-id');
      expect(body.get('code_verifier')).toBe('verifier');
      expect(body.has('client_secret')).toBe(false);
      return new Response(
        JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 7200,
          token_type: 'Bearer',
        }),
        { status: 200 },
      );
    });

    await expect(
      exchangeCloudflareCode({
        clientId: 'client-id',
        redirectUri: 'https://auth.openlander.example/cloudflare/callback',
        code: 'code',
        verifier: 'verifier',
        fetcher,
      }),
    ).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 7200,
      tokenType: 'Bearer',
    });
    expect(fetcher).toHaveBeenCalledWith(
      CLOUDFLARE_TOKEN_URL,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns a typed error when Cloudflare rejects the code', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }), {
          status: 400,
        }),
    );

    await expect(
      exchangeCloudflareCode({
        clientId: 'client-id',
        redirectUri: 'https://auth.openlander.example/cloudflare/callback',
        code: 'bad',
        verifier: 'verifier',
        fetcher,
      }),
    ).rejects.toMatchObject({ code: 'CLOUDFLARE_API_FAILED', statusCode: 502 });
  });
});
