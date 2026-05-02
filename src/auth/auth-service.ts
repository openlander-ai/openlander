import { compareSync, hashSync } from 'bcryptjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '../env/crypto.js';
import type { AuthRow } from '../db/index.js';

const AUTH_SALT_ROUNDS = 10;
const SESSION_TTL_MS = Number(process.env['OPENLANDER_SESSION_TTL_HOURS'] || 168) * 60 * 60 * 1000;

export interface AuthDatabase {
  isPasswordSet(): Promise<boolean>;
  getAuth(): Promise<AuthRow | null>;
  setPassword(hash: string): Promise<void>;
  getApiToken(): Promise<{ encrypted: string; iv: string } | null>;
  setApiToken(encrypted: string, iv: string): Promise<void>;
  getSession(): Promise<{ token: string; createdAt: number; expiresAt: number } | null>;
  createSession(token: string, createdAt: number, expiresAt: number): Promise<void>;
  deleteSession(): Promise<void>;
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
export async function createSession(
  db: AuthDatabase,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  await db.createSession(token, createdAt, expiresAt);
  return { token, expiresAt };
}

/**
 * Validate a session token against stored token and expiration.
 */
export async function validateSession(db: AuthDatabase, token: string): Promise<boolean> {
  const session = await db.getSession();
  if (!session) {
    return false;
  }

  if (session.token !== token) {
    return false;
  }

  if (Date.now() > session.expiresAt) {
    await db.deleteSession();
    return false;
  }

  return true;
}

/**
 * Delete the current stored session.
 */
export async function deleteSession(db: AuthDatabase, _token: string): Promise<void> {
  await db.deleteSession();
}

/**
 * Initial password setup flow: stores hashed password and initial API token.
 */
export async function setupPassword(
  db: AuthDatabase,
  password: string,
): Promise<{ apiToken: string }> {
  const passwordHash = hashPassword(password);
  await db.setPassword(passwordHash);

  const { token, encrypted, iv } = generateApiToken();
  await db.setApiToken(encrypted, iv);

  return { apiToken: token };
}

/**
 * Change password after validating the current password hash.
 */
export async function changePassword(
  db: AuthDatabase,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const auth = await db.getAuth();
  if (!auth || !auth.password_hash) {
    throw new Error('Password is not configured.');
  }

  if (!verifyPassword(currentPassword, auth.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  await db.setPassword(hashPassword(newPassword));
}

/**
 * Generate and persist a fresh API token while leaving password unchanged.
 */
export async function regenerateToken(db: AuthDatabase): Promise<{ apiToken: string }> {
  const { token, encrypted, iv } = generateApiToken();
  await db.setApiToken(encrypted, iv);
  return { apiToken: token };
}

/**
 * Reset password without verifying old password (CLI recovery flow).
 */
export async function resetPassword(db: AuthDatabase, newPassword: string): Promise<void> {
  await db.setPassword(hashPassword(newPassword));
}

/**
 * Validate a presented API token against encrypted token in storage.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function validateApiToken(db: AuthDatabase, token: string): Promise<boolean> {
  const stored = await db.getApiToken();
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
  async getOrCreateSetupSecret(): Promise<string | null> {
    if (await this.db.isPasswordSet()) {
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

  createSession(): Promise<{ token: string; expiresAt: number }> {
    return createSession(this.db);
  }

  validateSession(token: string): Promise<boolean> {
    return validateSession(this.db, token);
  }

  async deleteSession(token: string): Promise<void> {
    await deleteSession(this.db, token);
  }

  async setupPassword(password: string): Promise<{ apiToken: string }> {
    const result = await setupPassword(this.db, password);
    this.clearSetupSecret();
    return result;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await changePassword(this.db, currentPassword, newPassword);
  }

  regenerateToken(): Promise<{ apiToken: string }> {
    return regenerateToken(this.db);
  }

  async resetPassword(newPassword: string): Promise<void> {
    await resetPassword(this.db, newPassword);
  }

  validateApiToken(token: string): Promise<boolean> {
    return validateApiToken(this.db, token);
  }

  isPasswordSet(): Promise<boolean> {
    return this.db.isPasswordSet();
  }

  getAuth() {
    return this.db.getAuth();
  }

  async getDecryptedApiToken(): Promise<string | null> {
    const stored = await this.db.getApiToken();
    if (!stored) return null;
    try {
      return decryptToken(stored.encrypted, stored.iv);
    } catch {
      return null;
    }
  }
}
