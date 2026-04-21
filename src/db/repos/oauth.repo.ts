import { eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { oauthTokens } from '../schema.drizzle.js';
import type { OAuthTokenRow } from '../types.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('oauth-repo');

export class OAuthRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  getOAuthTokens(provider: string): OAuthTokenRow | undefined {
    try {
      return this.db.select().from(oauthTokens).where(eq(oauthTokens.provider, provider)).get() as
        | OAuthTokenRow
        | undefined;
    } catch (err) {
      // 1.0 GA — narrow defensive catch: only swallow schema-mismatch /
      // missing-table errors so the OAuth flow can recover by prompting the
      // user to re-auth. Re-throw anything else (lock errors, IO errors,
      // bugs) so they surface in logs and HTTP 5xx instead of being silently
      // hidden behind a permanent "GitHub auth required" banner.
      const msg = err instanceof Error ? err.message : String(err);
      const isSchemaMismatch = /no such column|no such table/i.test(msg);
      if (isSchemaMismatch) {
        log.error(
          { err, provider },
          'getOAuthTokens failed — schema mismatch detected. Run migrations: `npx drizzle-kit migrate` (or restart OpenLander to auto-apply pending migrations).',
        );
        return undefined;
      }
      log.error({ err, provider }, 'getOAuthTokens failed — rethrowing');
      throw err;
    }
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
