import { eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { oauthTokens } from '../schema.drizzle.js';
import type { OAuthTokenRow } from '../types.js';

export class OAuthRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  getOAuthTokens(provider: string): OAuthTokenRow | undefined {
    return this.db.select().from(oauthTokens).where(eq(oauthTokens.provider, provider)).get() as
      | OAuthTokenRow
      | undefined;
  }

  upsertOAuthTokens(token: {
    id: string;
    provider: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    tokenType: string;
    authMethod?: string;
    userEmail?: string | null;
    iv?: string;
  }): void {
    this.db
      .insert(oauthTokens)
      .values({
        id: token.id,
        provider: token.provider,
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
        token_type: token.tokenType,
        auth_method: token.authMethod ?? 'manual',
        user_email: token.userEmail ?? null,
        iv: token.iv ?? null,
      })
      .onConflictDoUpdate({
        target: oauthTokens.provider,
        set: {
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          expires_at: token.expiresAt,
          token_type: token.tokenType,
          auth_method: token.authMethod ?? 'manual',
          user_email: token.userEmail ?? null,
          iv: token.iv ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  deleteOAuthTokens(provider: string): void {
    this.db.delete(oauthTokens).where(eq(oauthTokens.provider, provider)).run();
  }
}
