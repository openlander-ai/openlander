import type { OAuthProviderConfig } from '../oauth-manager.js';

export const GOOGLE_OAUTH_CONFIG: OAuthProviderConfig = {
  clientId: '',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/generative-language',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  redirectUri: 'http://localhost:3000/auth/callback',
};

export function createGoogleOAuthConfig(clientId: string): OAuthProviderConfig {
  return {
    ...GOOGLE_OAUTH_CONFIG,
    clientId,
  };
}

export function isGoogleOAuthConfigReady(config: OAuthProviderConfig): boolean {
  return config.clientId.trim().length > 0;
}
