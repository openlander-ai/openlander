import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  changePassword,
  createSession,
  decryptToken,
  deleteSession,
  encryptToken,
  generateApiToken,
  hashPassword,
  regenerateToken,
  resetPassword,
  setupPassword,
  validateApiToken,
  validateSession,
  verifyPassword,
  type AuthDatabase,
} from '../../src/auth/auth-service.js';

type SessionState = {
  token: string;
  createdAt: number;
  expiresAt: number;
};

class MockAuthDb implements AuthDatabase {
  private passwordHash = '';
  private apiTokenEncrypted = '';
  private apiTokenIv = '';
  private session: SessionState | null = null;

  isPasswordSet(): boolean {
    return this.passwordHash.length > 0;
  }

  getAuth() {
    return {
      id: 1,
      password_hash: this.passwordHash,
      api_token: this.apiTokenEncrypted,
      api_token_iv: this.apiTokenIv || null,
      session_token: this.session?.token ?? null,
      session_created_at: this.session?.createdAt ?? null,
      session_expires_at: this.session?.expiresAt ?? null,
    };
  }

  setPassword(hash: string): void {
    this.passwordHash = hash;
  }

  getApiToken() {
    if (!this.apiTokenEncrypted || !this.apiTokenIv) {
      return null;
    }
    return {
      encrypted: this.apiTokenEncrypted,
      iv: this.apiTokenIv,
    };
  }

  setApiToken(encrypted: string, iv: string): void {
    this.apiTokenEncrypted = encrypted;
    this.apiTokenIv = iv;
  }

  getSession() {
    return this.session;
  }

  createSession(token: string, createdAt: number, expiresAt: number): void {
    this.session = { token, createdAt, expiresAt };
  }

  deleteSession(): void {
    this.session = null;
  }
}

describe('auth-service', () => {
  let db: MockAuthDb;

  beforeEach(() => {
    db = new MockAuthDb();
    vi.restoreAllMocks();
  });

  it('hashPassword + verifyPassword roundtrip works', () => {
    const hash = hashPassword('my-secret');
    expect(hash).not.toBe('my-secret');
    expect(verifyPassword('my-secret', hash)).toBe(true);
  });

  it('verifyPassword returns false for wrong password', () => {
    const hash = hashPassword('right-password');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('generateApiToken returns ol_ prefix', () => {
    const { token } = generateApiToken();
    expect(token.startsWith('ol_')).toBe(true);
    expect(token.length).toBeGreaterThan(3);
  });

  it('encryptToken/decryptToken roundtrip works', () => {
    const plaintext = 'ol_roundtrip_token';
    const { encrypted, iv } = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('createSession + validateSession works, and deleteSession removes it', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const { token, expiresAt } = createSession(db);
    expect(expiresAt).toBe(604_801_000);
    expect(validateSession(db, token)).toBe(true);

    deleteSession(db, token);
    expect(validateSession(db, token)).toBe(false);

    nowSpy.mockRestore();
  });

  it('validateSession expires and deletes stale sessions (mock Date.now)', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { token } = createSession(db);

    nowSpy.mockReturnValue(10_000 + 604_800_000 + 1);
    expect(validateSession(db, token)).toBe(false);
    expect(db.getSession()).toBeNull();

    nowSpy.mockRestore();
  });

  it('setupPassword stores hash and token; validateApiToken checks plaintext token', () => {
    const { apiToken } = setupPassword(db, 'start-password');

    expect(db.isPasswordSet()).toBe(true);
    expect(apiToken.startsWith('ol_')).toBe(true);
    expect(validateApiToken(db, apiToken)).toBe(true);
    expect(validateApiToken(db, 'ol_invalid')).toBe(false);
  });

  it('changePassword verifies current password and keeps API token unchanged', () => {
    const { apiToken } = setupPassword(db, 'old-password');
    const before = db.getApiToken();

    changePassword(db, 'old-password', 'new-password');

    const auth = db.getAuth();
    expect(auth.password_hash).not.toBe('new-password');
    expect(verifyPassword('new-password', auth.password_hash)).toBe(true);
    const after = db.getApiToken();
    expect(after).toEqual(before);
    expect(validateApiToken(db, apiToken)).toBe(true);
  });

  it('regenerateToken replaces token and resetPassword updates hash without current password', () => {
    const initial = setupPassword(db, 'initial-password').apiToken;
    const regenerated = regenerateToken(db).apiToken;

    expect(regenerated).not.toBe(initial);
    expect(validateApiToken(db, initial)).toBe(false);
    expect(validateApiToken(db, regenerated)).toBe(true);

    resetPassword(db, 'reset-password');
    expect(verifyPassword('reset-password', db.getAuth().password_hash)).toBe(true);
  });

  it('AuthService instance methods provide end-to-end auth flow', () => {
    const service = new AuthService(db);

    const setup = service.setupPassword('service-password');
    expect(service.validateApiToken(setup.apiToken)).toBe(true);

    const session = service.createSession();
    expect(service.validateSession(session.token)).toBe(true);

    service.deleteSession(session.token);
    expect(service.validateSession(session.token)).toBe(false);

    service.changePassword('service-password', 'service-password-2');
    expect(service.verifyPassword('service-password-2', db.getAuth().password_hash)).toBe(true);

    const freshToken = service.regenerateToken().apiToken;
    expect(service.validateApiToken(freshToken)).toBe(true);

    service.resetPassword('service-password-3');
    expect(service.verifyPassword('service-password-3', db.getAuth().password_hash)).toBe(true);
  });
});
