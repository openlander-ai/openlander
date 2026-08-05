import { CloudflareApiError } from '../errors.js';

export const CLOUDFLARE_AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
export const CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
export const CLOUDFLARE_REVOKE_URL = 'https://dash.cloudflare.com/oauth2/revoke';

export interface CloudflareOAuthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string;
}

interface CloudflareOAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export function getCloudflareAuthUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes: readonly string[];
}): string {
  const url = new URL(CLOUDFLARE_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', options.state);
  if (options.scopes.length > 0) url.searchParams.set('scope', options.scopes.join(' '));
  return url.toString();
}

export async function exchangeCloudflareCode(options: {
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  fetcher?: typeof fetch;
}): Promise<CloudflareOAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code: options.code,
    code_verifier: options.verifier,
  });
  const response = await (options.fetcher ?? fetch)(CLOUDFLARE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await response.text();
  let data: CloudflareOAuthTokenResponse = {};
  try {
    data = JSON.parse(text) as CloudflareOAuthTokenResponse;
  } catch {
    if (response.ok) {
      throw new CloudflareApiError(response.status, 'Invalid OAuth token response', 'oauth_token');
    }
  }
  if (!response.ok || typeof data.error === 'string') {
    const detail =
      typeof data.error_description === 'string'
        ? data.error_description
        : typeof data.error === 'string'
          ? data.error
          : `HTTP ${String(response.status)}`;
    throw new CloudflareApiError(response.status, detail, 'oauth_token');
  }
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new CloudflareApiError(response.status, 'Missing access_token', 'oauth_token');
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
  };
}

export async function revokeCloudflareToken(options: {
  clientId: string;
  token: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const response = await (options.fetcher ?? fetch)(CLOUDFLARE_REVOKE_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: options.clientId, token: options.token }).toString(),
  });
  if (!response.ok) {
    throw new CloudflareApiError(response.status, 'OAuth token revocation failed', 'oauth_revoke');
  }
}
