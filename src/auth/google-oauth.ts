/**
 * Google OAuth PKCE flow for Gemini API access.
 *
 * Raw HTTP — no Google Cloud SDK dependency.
 */
import { randomBytes, createHash } from 'node:crypto';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('auth-google');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GEMINI_SCOPE = 'https://www.googleapis.com/auth/generative-language';

/** Generate PKCE code verifier (base64url, 43 chars) and SHA256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Build the Google OAuth authorization URL for web PKCE flow.
 *
 * Uses access_type=offline + prompt=consent to ensure a refresh token is returned.
 */
export function getGoogleAuthUrl(
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

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleTokenResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Exchange an authorization code for Google OAuth tokens via PKCE.
 *
 * @throws Error on exchange failure or missing access_token
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
