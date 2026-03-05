/**
 * OpenRouter OAuth for web context.
 *
 * OpenRouter uses PKCE OAuth flow that returns an API key (not access/refresh tokens).
 * The API key doesn't expire, so no refresh logic is needed.
 */
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('auth-openrouter');

// OpenRouter OAuth endpoints
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys';

/**
 * Build the OpenRouter authorization URL for web OAuth flow.
 *
 * @param callbackUrl - The callback URL (e.g., http://localhost:10003/api/auth/callback/openrouter)
 * @param challenge - PKCE code challenge
 * @returns Authorization URL string
 */
export function getOpenRouterAuthUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/**
 * OpenRouter token response.
 */
interface OpenRouterTokenResponse {
  key?: string;
  error?: string;
}

/**
 * Exchange authorization code for OpenRouter API key.
 *
 * OpenRouter returns an API key directly (not access/refresh tokens).
 * The API key doesn't expire.
 *
 * @param code - Authorization code from callback
 * @param verifier - PKCE code verifier
 * @returns API key string
 * @throws Error on exchange failure
 */
export async function exchangeOpenRouterCode(code: string, verifier: string): Promise<string> {
  const response = await fetch(OPENROUTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    log.error({ status: response.status, body: text }, 'OpenRouter token exchange failed');
    throw new Error(`Failed to exchange code for API key: ${String(response.status)} ${text}`);
  }

  const data = (await response.json()) as OpenRouterTokenResponse;

  if (data.error) {
    log.error({ error: data.error }, 'OpenRouter OAuth error');
    throw new Error(`OpenRouter OAuth error: ${data.error}`);
  }

  if (!data.key) {
    log.error({ data }, 'Invalid OpenRouter response - missing API key');
    throw new Error('Invalid response from OpenRouter: missing API key');
  }

  log.info('OpenRouter OAuth successful - API key received');
  return data.key;
}
