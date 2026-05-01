import { compareSync, hashSync } from 'bcryptjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '../env/crypto.js';
import type { AuthRow } from '../db/index.js';

const AUTH_SALT_ROUNDS = 10;
const SESSION_TTL_MS = Number(process.env['OPENLANDER_SESSION_TTL_HOURS'] || 168) * 60 * 60 * 1000;

export interface AuthDatabase {
  isPasswordSet(): boolean;
  getAuth(): AuthRow | null;
  setPassword(hash: string): void;
  getApiToken(): { encrypted: string; iv: string } | null;
  setApiToken(encrypted: string, iv: string): void;
  getSession(): { token: string; createdAt: number; expiresAt: number } | null;
  createSession(token: string, createdAt: number, expiresAt: number): void;
  deleteSession(): void;
}

/**
 * Hash a plaintext password for persistent auth storage.
 */
export function hashPassword(plain: string): string {
  // Salt rounds = 10 for auth (tunnel.ts uses 5 for quick share access codes)
  return hashSync(plain, AUTH_SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export function verifyPassword(plain: string, hash: string): boolean {
  return compareSync(plain, hash);
}

/**
 * Encrypt a plaintext API token using AES-256-GCM.
 */
export function encryptToken(token: string): { encrypted: string; iv: string } {
  return encrypt(token);
}

/**
 * Decrypt an encrypted API token payload.
 */
export function decryptToken(encrypted: string, iv: string): string {
  return decrypt(encrypted, iv);
}

/**
 * Generate a new API token with `ol_` prefix and encrypted storage payload.
 */
export function generateApiToken(): { token: string; encrypted: string; iv: string } {
  const token = `ol_${randomBytes(32).toString('hex')}`;
  const { encrypted, iv } = encryptToken(token);
  return { token, encrypted, iv };
}

/**
 * Create a session token, persist it, and return expiry metadata.
 */
export function createSession(db: AuthDatabase): { token: string; expiresAt: number } {
  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  db.createSession(token, createdAt, expiresAt);
  return { token, expiresAt };
}

/**
 * Validate a session token against stored token and expiration.
 */
export function validateSession(db: AuthDatabase, token: string): boolean {
  const session = db.getSession();
  if (!session) {
    return false;
  }

  if (session.token !== token) {
    return false;
  }

  if (Date.now() > session.expiresAt) {
    db.deleteSession();
    return false;
  }

  return true;
}

/**
 * Delete the current stored session.
 */
export function deleteSession(db: AuthDatabase, _token: string): void {
  db.deleteSession();
}

/**
 * Initial password setup flow: stores hashed password and initial API token.
 */
export function setupPassword(db: AuthDatabase, password: string): { apiToken: string } {
  const passwordHash = hashPassword(password);
  db.setPassword(passwordHash);

  const { token, encrypted, iv } = generateApiToken();
  db.setApiToken(encrypted, iv);

  return { apiToken: token };
}

/**
 * Change password after validating the current password hash.
 */
export function changePassword(
  db: AuthDatabase,
  currentPassword: string,
  newPassword: string,
): void {
  const auth = db.getAuth();
  if (!auth || !auth.password_hash) {
    throw new Error('Password is not configured.');
  }

  if (!verifyPassword(currentPassword, auth.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  db.setPassword(hashPassword(newPassword));
}

/**
 * Generate and persist a fresh API token while leaving password unchanged.
 */
export function regenerateToken(db: AuthDatabase): { apiToken: string } {
  const { token, encrypted, iv } = generateApiToken();
  db.setApiToken(encrypted, iv);
  return { apiToken: token };
}

/**
 * Reset password without verifying old password (CLI recovery flow).
 */
export function resetPassword(db: AuthDatabase, newPassword: string): void {
  db.setPassword(hashPassword(newPassword));
}

/**
 * Validate a presented API token against encrypted token in storage.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateApiToken(db: AuthDatabase, token: string): boolean {
  const stored = db.getApiToken();
  if (!stored) {
    return false;
  }

  try {
    const decrypted = decryptToken(stored.encrypted, stored.iv);
    // Use constant-time comparison to prevent timing attacks
    if (decrypted.length !== token.length) return false;
    const a = Buffer.from(decrypted);
    const b = Buffer.from(token);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Core auth service wrapper around auth helpers and DB persistence.
 *
 * Setup secret semantics:
 *  - Generated lazily on the first `getOrCreateSetupSecret()` call when no
 *    password has been configured. The plaintext value is held in process
 *    memory only — it is never persisted, so a restart rotates it.
 *  - Validated with constant-time comparison to mitigate timing attacks.
 *  - Cleared automatically when a password is successfully provisioned via
 *    `setupPassword()` so the same secret cannot be reused.
 */
export class AuthService {
  private setupSecret: string | null = null;

  constructor(private readonly db: AuthDatabase) {}

  /**
   * Generate (if needed) and return the one-time bootstrap secret used to
   * authorize the very first password setup. Returns `null` once a password
   * has already been configured, so callers don't accidentally print a stale
   * value during runtime.
   */
  getOrCreateSetupSecret(): string | null {
    if (this.db.isPasswordSet()) {
      this.setupSecret = null;
      return null;
    }
    if (!this.setupSecret) {
      this.setupSecret = randomBytes(16).toString('hex');
    }
    return this.setupSecret;
  }

  /**
   * Constant-time validation of a presented setup secret. Returns false when
   * either no secret has been issued yet or the supplied value does not match.
   */
  verifySetupSecret(presented: string | undefined | null): boolean {
    const expected = this.setupSecret;
    if (!expected || typeof presented !== 'string' || presented.length === 0) {
      return false;
    }
    const a = Buffer.from(expected);
    const b = Buffer.from(presented);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  /** Drop the in-memory secret (called after a successful password setup). */
  clearSetupSecret(): void {
    this.setupSecret = null;
  }

  hashPassword(plain: string): string {
    return hashPassword(plain);
  }

  verifyPassword(plain: string, hash: string): boolean {
    return verifyPassword(plain, hash);
  }

  generateApiToken(): { token: string; encrypted: string; iv: string } {
    return generateApiToken();
  }

  encryptToken(token: string): { encrypted: string; iv: string } {
    return encryptToken(token);
  }

  decryptToken(encrypted: string, iv: string): string {
    return decryptToken(encrypted, iv);
  }

  createSession(): { token: string; expiresAt: number } {
    return createSession(this.db);
  }

  validateSession(token: string): boolean {
    return validateSession(this.db, token);
  }

  deleteSession(token: string): void {
    deleteSession(this.db, token);
  }

  setupPassword(password: string): { apiToken: string } {
    const result = setupPassword(this.db, password);
    this.clearSetupSecret();
    return result;
  }

  changePassword(currentPassword: string, newPassword: string): void {
    changePassword(this.db, currentPassword, newPassword);
  }

  regenerateToken(): { apiToken: string } {
    return regenerateToken(this.db);
  }

  resetPassword(newPassword: string): void {
    resetPassword(this.db, newPassword);
  }

  validateApiToken(token: string): boolean {
    return validateApiToken(this.db, token);
  }

  isPasswordSet(): boolean {
    return this.db.isPasswordSet();
  }

  getAuth() {
    return this.db.getAuth();
  }

  getDecryptedApiToken(): string | null {
    const stored = this.db.getApiToken();
    if (!stored) return null;
    try {
      return decryptToken(stored.encrypted, stored.iv);
    } catch {
      return null;
    }
  }
}
