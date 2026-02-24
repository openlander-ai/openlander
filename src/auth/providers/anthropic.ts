/*
 * ⚠️ Anthropic OAuth uses unofficial flow. May break without notice. Use at own risk.
 *
 * This provider config and helper cover a reverse-engineered integration pattern.
 * Anthropic may change endpoints, scopes, or callback formats at any time.
 * Treat this as best-effort compatibility, not a stable contract.
 */
import type { OAuthProviderConfig } from '../oauth-manager.js';

export interface AnthropicAuthorizationCode {
  code: string;
  embeddedState: string | null;
}

export const ANTHROPIC_OAUTH_CONFIG: OAuthProviderConfig = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
};

export function parseAnthropicAuthorizationCode(rawCode: string): AnthropicAuthorizationCode {
  const hashIndex = rawCode.indexOf('#');

  if (hashIndex === -1) {
    return { code: rawCode, embeddedState: null };
  }

  return {
    code: rawCode.slice(0, hashIndex),
    embeddedState: rawCode.slice(hashIndex + 1) || null,
  };
}
