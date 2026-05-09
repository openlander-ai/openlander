/**
 * AES-256-GCM encryption for global secrets.
 *
 * Master key is stored at ~/.openlander/master.key (auto-generated on first use).
 * Can be overridden via OPENLANDER_MASTER_KEY environment variable.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // GCM recommended
const AUTH_TAG_LENGTH = 16;

const MASTER_KEY_FILENAME = 'master.key';

/** Cached master key (loaded once per process). */
let cachedMasterKey: Buffer | null = null;

export interface EncryptedPayload {
  /** Base64-encoded ciphertext (includes auth tag). */
  encrypted: string;
  /** Base64-encoded initialization vector. */
  iv: string;
}

/**
 * Get or create the master encryption key.
 *
 * Priority:
 *   1. OPENLANDER_MASTER_KEY env var (hex-encoded, 64 chars)
 *   2. ~/.openlander/master.key file (raw 32 bytes)
 *   3. Auto-generate and save to file
 */
export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;

  // 1. Check environment variable
  const envKey = process.env['OPENLANDER_MASTER_KEY'];
  if (envKey) {
    if (envKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(envKey)) {
      throw new Error('OPENLANDER_MASTER_KEY must be a 64-character hex string (256 bits).');
    }
    cachedMasterKey = Buffer.from(envKey, 'hex');
    return cachedMasterKey;
  }

  // 2. Check master.key file
  const dataDir = getDataDir();
  const keyPath = join(dataDir, MASTER_KEY_FILENAME);

  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath);
    if (raw.length !== KEY_LENGTH) {
      throw new Error(
        `Corrupted master key at ${keyPath}: expected ${String(KEY_LENGTH)} bytes, got ${String(raw.length)}.`,
      );
    }
    cachedMasterKey = raw;
    return cachedMasterKey;
  }

  // 3. Auto-generate
  mkdirSync(dataDir, { recursive: true });
  const newKey = randomBytes(KEY_LENGTH);
  writeFileSync(keyPath, newKey, { mode: 0o600 }); // owner-only read/write
  log.info({ keyPath }, 'Generated new master encryption key');
  cachedMasterKey = newKey;
  return cachedMasterKey;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 */
export function encrypt(plaintext: string, masterKey?: Buffer): EncryptedPayload {
  const key = masterKey ?? getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Store ciphertext + auth tag together
  const combined = Buffer.concat([encrypted, authTag]);

  return {
    encrypted: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt a ciphertext back to plaintext.
 */
export function decrypt(encryptedB64: string, ivB64: string, masterKey?: Buffer): string {
  const key = masterKey ?? getMasterKey();
  const combined = Buffer.from(encryptedB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');

  // Split ciphertext and auth tag
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Reset cached master key (for testing). */
export function _resetCachedKey(): void {
  cachedMasterKey = null;
}
