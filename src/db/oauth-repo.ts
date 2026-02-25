import { BaseRepository } from './base-repo.js';
import type { OAuthTokenRow } from './types.js';

export interface UpsertOAuthTokensInput {
  id: string;
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  tokenType: string;
}

export class OAuthTokenRepository extends BaseRepository {
  getOAuthTokens(provider: string): OAuthTokenRow | undefined {
    return this.db.prepare('SELECT * FROM oauth_tokens WHERE provider = ?').get(provider) as
      | OAuthTokenRow
      | undefined;
  }

  upsertOAuthTokens(token: UpsertOAuthTokensInput): void {
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (id, provider, access_token, refresh_token, expires_at, token_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           token_type = excluded.token_type,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        token.id,
        token.provider,
        token.accessToken,
        token.refreshToken,
        token.expiresAt,
        token.tokenType,
      );
  }

  deleteOAuthTokens(provider: string): void {
    this.db.prepare('DELETE FROM oauth_tokens WHERE provider = ?').run(provider);
  }
}
