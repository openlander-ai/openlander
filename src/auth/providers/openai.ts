import type { OAuthProviderConfig } from '../oauth-manager.js';

export const OPENAI_OAUTH_CONFIG: OAuthProviderConfig = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authUrl: 'https://auth0.openai.com/authorize',
  tokenUrl: 'https://auth0.openai.com/oauth/token',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  redirectUri: 'http://localhost:3000/auth/callback',
};

export const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const OPENAI_ACCOUNT_ID_HEADER = 'chatgpt-account-id';

export function getOpenAICodexHeaders(chatgptAccountId: string): Record<string, string> {
  return {
    [OPENAI_ACCOUNT_ID_HEADER]: chatgptAccountId,
  };
}
