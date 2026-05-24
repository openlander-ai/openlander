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

  it('createSession + validateSession works, and deleteSession removes it', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const { token, expiresAt } = await createSession(db);
    expect(expiresAt).toBe(604_801_000);
    await expect(validateSession(db, token)).resolves.toBe(true);

    await deleteSession(db, token);
    await expect(validateSession(db, token)).resolves.toBe(false);

    nowSpy.mockRestore();
  });

  it('validateSession expires and deletes stale sessions (mock Date.now)', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const { token } = await createSession(db);

    nowSpy.mockReturnValue(10_000 + 604_800_000 + 1);
    await expect(validateSession(db, token)).resolves.toBe(false);
    expect(db.getSession()).toBeNull();

    nowSpy.mockRestore();
  });

  it('setupPassword stores hash and token; validateApiToken checks plaintext token', async () => {
    const { apiToken } = await setupPassword(db, 'start-password');

    expect(db.isPasswordSet()).toBe(true);
    expect(apiToken.startsWith('ol_')).toBe(true);
    await expect(validateApiToken(db, apiToken)).resolves.toBe(true);
    await expect(validateApiToken(db, 'ol_invalid')).resolves.toBe(false);
  });

  it('rejects setup, change, and reset passwords shorter than 8 characters', async () => {
    await expect(setupPassword(db, '1234567')).rejects.toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
    });

    await setupPassword(db, 'old-pass');
    await expect(changePassword(db, 'old-pass', '1234567')).rejects.toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
    });
    await expect(resetPassword(db, '1234567')).rejects.toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
    });
  });

  it('changePassword verifies current password and keeps API token unchanged', async () => {
    const { apiToken } = await setupPassword(db, 'old-password');
    const before = db.getApiToken();

    await changePassword(db, 'old-password', 'new-password');

    const auth = db.getAuth();
    expect(auth.password_hash).not.toBe('new-password');
    expect(verifyPassword('new-password', auth.password_hash)).toBe(true);
    const after = db.getApiToken();
    expect(after).toEqual(before);
    await expect(validateApiToken(db, apiToken)).resolves.toBe(true);
  });

  it('regenerateToken replaces token and resetPassword updates hash without current password', async () => {
    const initial = (await setupPassword(db, 'initial-password')).apiToken;
    const regenerated = (await regenerateToken(db)).apiToken;

    expect(regenerated).not.toBe(initial);
    await expect(validateApiToken(db, initial)).resolves.toBe(false);
    await expect(validateApiToken(db, regenerated)).resolves.toBe(true);

    await resetPassword(db, 'reset-password');
    expect(verifyPassword('reset-password', db.getAuth().password_hash)).toBe(true);
  });

  it('AuthService instance methods provide end-to-end auth flow', async () => {
    const service = new AuthService(db);

    const setup = await service.setupPassword('service-password');
    await expect(service.validateApiToken(setup.apiToken)).resolves.toBe(true);

    const session = await service.createSession();
    await expect(service.validateSession(session.token)).resolves.toBe(true);

    await service.deleteSession(session.token);
    await expect(service.validateSession(session.token)).resolves.toBe(false);

    await service.changePassword('service-password', 'service-password-2');
    expect(service.verifyPassword('service-password-2', db.getAuth().password_hash)).toBe(true);

    const freshToken = (await service.regenerateToken()).apiToken;
    await expect(service.validateApiToken(freshToken)).resolves.toBe(true);

    await service.resetPassword('service-password-3');
    expect(service.verifyPassword('service-password-3', db.getAuth().password_hash)).toBe(true);
  });
});
