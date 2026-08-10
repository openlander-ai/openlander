import { eq, lte } from 'drizzle-orm';
import type { DrizzleClient } from '../drizzle.js';
import { auth, authSessions } from '../schema.drizzle.js';
import type { AuthRow } from '../types.js';

export class AuthRepo {
  constructor(private readonly db: DrizzleClient) {}

  async isPasswordSet(): Promise<boolean> {
    const [row] = await this.db.select().from(auth).where(eq(auth.id, 1)).limit(1);
    return row !== undefined && row.password_hash !== '';
  }

  async getAuth(): Promise<AuthRow | null> {
    const [row] = await this.db.select().from(auth).where(eq(auth.id, 1)).limit(1);
    return row ?? null;
  }

  async setPassword(hash: string): Promise<void> {
    const existing = await this.getAuth();
    if (existing) {
      await this.db.update(auth).set({ password_hash: hash }).where(eq(auth.id, 1));
    } else {
      await this.db.insert(auth).values({ id: 1, password_hash: hash, api_token: '' });
    }
  }

  async getApiToken(): Promise<{ encrypted: string; iv: string } | null> {
    const [row] = await this.db.select().from(auth).where(eq(auth.id, 1)).limit(1);
    if (!row || !row.api_token || !row.api_token_iv) return null;
    return { encrypted: row.api_token, iv: row.api_token_iv };
  }

  async setApiToken(encrypted: string, iv: string): Promise<void> {
    const existing = await this.getAuth();
    if (existing) {
      await this.db
        .update(auth)
        .set({ api_token: encrypted, api_token_iv: iv })
        .where(eq(auth.id, 1));
    } else {
      await this.db
        .insert(auth)
        .values({ id: 1, password_hash: '', api_token: encrypted, api_token_iv: iv });
    }
  }

  async getSession(
    token: string,
  ): Promise<{ token: string; createdAt: number; expiresAt: number } | null> {
    const [row] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.token, token))
      .limit(1);
    if (!row) return null;
    return {
      token: row.token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async createSession(token: string, createdAt: number, expiresAt: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(authSessions).where(lte(authSessions.expires_at, createdAt));
      await tx.insert(authSessions).values({
        token,
        created_at: createdAt,
        expires_at: expiresAt,
      });
    });
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.delete(authSessions).where(eq(authSessions.token, token));
  }

  async deleteAllSessions(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(authSessions);
      await tx
        .update(auth)
        .set({
          session_token: null,
          session_created_at: null,
          session_expires_at: null,
        })
        .where(eq(auth.id, 1));
    });
  }

  async getActiveScopeProjectId(): Promise<string | null> {
    const row = await this.getAuth();
    return row?.active_scope_project_id ?? null;
  }

  async setActiveScopeProjectId(projectId: string | null): Promise<void> {
    const existing = await this.getAuth();
    if (existing) {
      await this.db.update(auth).set({ active_scope_project_id: projectId }).where(eq(auth.id, 1));
    } else {
      await this.db.insert(auth).values({
        id: 1,
        password_hash: '',
        api_token: '',
        active_scope_project_id: projectId,
      });
    }
  }

  async isDestructiveMcpUnlockEnabled(): Promise<boolean> {
    const row = await this.getAuth();
    return row?.destructive_mcp_unlock ?? false;
  }

  async setDestructiveMcpUnlock(enabled: boolean): Promise<void> {
    const existing = await this.getAuth();
    if (existing) {
      await this.db.update(auth).set({ destructive_mcp_unlock: enabled }).where(eq(auth.id, 1));
    } else {
      await this.db.insert(auth).values({
        id: 1,
        password_hash: '',
        api_token: '',
        destructive_mcp_unlock: enabled,
      });
    }
  }
}
