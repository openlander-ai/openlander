import { eq } from 'drizzle-orm';
import type { DrizzleClient } from '../drizzle.js';
import { auth } from '../schema.drizzle.js';
import type { AuthRow } from '../types.js';

export class AuthRepo {
  constructor(private readonly db: DrizzleClient) {}

  isPasswordSet(): boolean {
    const row = this.db.select().from(auth).where(eq(auth.id, 1)).get();
    return row !== undefined && row.password_hash !== '';
  }

  getAuth(): AuthRow | null {
    const row = this.db.select().from(auth).where(eq(auth.id, 1)).get();
    return row ?? null;
  }

  setPassword(hash: string): void {
    const existing = this.getAuth();
    if (existing) {
      this.db.update(auth).set({ password_hash: hash }).where(eq(auth.id, 1)).run();
    } else {
      this.db.insert(auth).values({ id: 1, password_hash: hash, api_token: '' }).run();
    }
  }

  getApiToken(): { encrypted: string; iv: string } | null {
    const row = this.db.select().from(auth).where(eq(auth.id, 1)).get();
    if (!row || !row.api_token || !row.api_token_iv) return null;
    return { encrypted: row.api_token, iv: row.api_token_iv };
  }

  setApiToken(encrypted: string, iv: string): void {
    const existing = this.getAuth();
    if (existing) {
      this.db
        .update(auth)
        .set({ api_token: encrypted, api_token_iv: iv })
        .where(eq(auth.id, 1))
        .run();
    } else {
      this.db
        .insert(auth)
        .values({ id: 1, password_hash: '', api_token: encrypted, api_token_iv: iv })
        .run();
    }
  }

  getSession(): { token: string; createdAt: number; expiresAt: number } | null {
    const row = this.db.select().from(auth).where(eq(auth.id, 1)).get();
    if (
      !row ||
      !row.session_token ||
      row.session_created_at === null ||
      row.session_expires_at === null
    ) {
      return null;
    }
    return {
      token: row.session_token,
      createdAt: row.session_created_at,
      expiresAt: row.session_expires_at,
    };
  }

  createSession(token: string, createdAt: number, expiresAt: number): void {
    const existing = this.getAuth();
    if (existing) {
      this.db
        .update(auth)
        .set({
          session_token: token,
          session_created_at: createdAt,
          session_expires_at: expiresAt,
        })
        .where(eq(auth.id, 1))
        .run();
    } else {
      this.db
        .insert(auth)
        .values({
          id: 1,
          password_hash: '',
          api_token: '',
          session_token: token,
          session_created_at: createdAt,
          session_expires_at: expiresAt,
        })
        .run();
    }
  }

  deleteSession(): void {
    this.db
      .update(auth)
      .set({
        session_token: null,
        session_created_at: null,
        session_expires_at: null,
      })
      .where(eq(auth.id, 1))
      .run();
  }
}
