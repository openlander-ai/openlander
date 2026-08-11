/**
 * Generic OAuth token refresh utility.
 *
 * Provider-agnostic: works with any OAuth 2.0 token endpoint
 * that supports the refresh_token grant type.
 */
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('auth-refresh');
const NETWORK_ATTEMPTS = 2;
const NETWORK_RETRY_DELAY_MS = 500;

/** Standard OAuth token response shape. */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/** Options for refreshing an OAuth token. */
export interface RefreshTokenOptions {
  tokenUrl: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

/**
 * Refresh an OAuth access token using a refresh token.
 *
 * Sends a POST to the token endpoint with grant_type=refresh_token.
 * Returns null on 400/401 (invalid/revoked token) — caller should
 * prompt re-authentication. Throws on other errors (network, 5xx).
 *
 * @param opts - Refresh token options
 * @returns New token response, or null if refresh token is invalid
 * @throws Error on network or unexpected server errors
 */
export async function refreshOAuthToken(
  opts: RefreshTokenOptions,
): Promise<OAuthTokenResponse | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);

  let response: Response | undefined;
  let networkError: unknown;
  for (let attempt = 1; attempt <= NETWORK_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(opts.tokenUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      break;
    } catch (err) {
      networkError = err;
      if (attempt < NETWORK_ATTEMPTS) {
        log.warn({ err, attempt, attempts: NETWORK_ATTEMPTS }, 'Token refresh network error; retrying');
        await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS));
      }
    }
  }

  if (!response) {
    log.error({ err: networkError, attempts: NETWORK_ATTEMPTS }, 'Token refresh network error');
    throw new Error(
      `Token refresh failed: ${networkError instanceof Error ? networkError.message : String(networkError)}`,
    );
  }

  // 400/401 = invalid or revoked refresh token — caller should re-auth
  if (response.status === 400 || response.status === 401) {
    const text = await response.text().catch(() => '');
    log.warn({ status: response.status, body: text }, 'Refresh token invalid or revoked');
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log.error({ status: response.status, body: text }, 'Token refresh failed');
    throw new Error(`Token refresh failed: ${String(response.status)} ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (typeof data['error'] === 'string') {
    log.warn({ error: data['error'] }, 'Token refresh returned error');
    return null;
  }

  const accessToken = data['access_token'];
  const expiresIn = data['expires_in'];
  const tokenType = data['token_type'];

  if (typeof accessToken !== 'string' || !accessToken) {
    log.error({ data }, 'Token refresh response missing access_token');
    throw new Error('Invalid token refresh response: missing access_token');
  }

  log.info('OAuth token refreshed successfully');
  return {
    access_token: accessToken,
    refresh_token: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : undefined,
    expires_in: typeof expiresIn === 'number' ? expiresIn : 3600,
    token_type: typeof tokenType === 'string' ? tokenType : 'Bearer',
  };
}
