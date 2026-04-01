/**
 * Google OAuth PKCE flow for Gemini API access.
 *
 * Implements PKCE (Proof Key for Code Exchange) OAuth flow for Google Gemini.
 * Uses raw HTTP calls — no Google Cloud SDK dependency.
 */
import { randomBytes, createHash } from 'node:crypto';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('auth-google');

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Gemini API scope
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language';

/**
 * Generate PKCE code verifier and challenge.
 *
 * verifier: random 43-128 char base64url string
 * challenge: SHA256 of verifier, base64url-encoded
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Build the Google OAuth authorization URL for web PKCE flow.
 *
 * @param callbackUrl - The callback URL (e.g., http://localhost:10114/api/auth/callback/google)
 * @param challenge - PKCE code challenge
 * @param state - Opaque state value for CSRF protection
 * @returns Authorization URL string
 */
export function getGoogleAuthUrl(callbackUrl: string, challenge: string, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', '');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', GEMINI_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Build the Google OAuth authorization URL with client ID injected.
 *
 * @param clientId - Google OAuth client ID
 * @param callbackUrl - The callback URL
 * @param challenge - PKCE code challenge
 * @param state - Opaque state value for CSRF protection
 * @returns Authorization URL string
 */
export function getGoogleAuthUrlWithClientId(
  clientId: string,
  callbackUrl: string,
  challenge: string,
  state: string,
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('scope', GEMINI_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Google token endpoint response shape. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** Successful token exchange result. */
export interface GoogleTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Exchange an authorization code for Google OAuth tokens.
 *
 * Uses PKCE code verifier for proof. Returns access token, refresh token, and expiry.
 *
 * @param code - Authorization code from callback
 * @param verifier - PKCE code verifier
 * @param redirectUri - The same redirect URI used in the authorization request
 * @param clientId - Google OAuth client ID
 * @param clientSecret - Google OAuth client secret
 * @returns Token result with access_token, refresh_token, and expires_in
 * @throws Error on exchange failure
 */
export async function exchangeGoogleCode(
  code: string,
  verifier: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<GoogleTokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log.error({ status: response.status, body: text }, 'Google token exchange failed');
    throw new Error(`Failed to exchange code for tokens: ${String(response.status)} ${text}`);
  }

  const data = (await response.json()) as GoogleTokenResponse;

  if (data.error) {
    log.error({ error: data.error, description: data.error_description }, 'Google OAuth error');
    throw new Error(`Google OAuth error: ${data.error} — ${data.error_description ?? ''}`);
  }

  if (!data.access_token) {
    log.error({ data }, 'Invalid Google response - missing access_token');
    throw new Error('Invalid response from Google: missing access_token');
  }

  if (!data.refresh_token) {
    log.warn('Google OAuth response missing refresh_token — token refresh will not be available');
  }

  log.info('Google OAuth successful - tokens received');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? '',
    expires_in: data.expires_in ?? 3600,
  };
}
