/**
 * Token encryption and storage wrapper.
 *
 * Uses AES-256-GCM encryption via src/env/crypto.js for token storage.
 * Provides high-level functions for OAuth token management.
 */
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from '../env/crypto.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Database } from '../db/index.js';

const log = createModuleLogger('auth');

/** Token data to store (before encryption). */
export interface TokenData {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  userEmail?: string | null;
}

/** Decrypted token data returned to callers. */
export interface DecryptedToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  userEmail: string | null;
}

/**
 * Encrypt and store an OAuth token for a provider.
 *
 * @param db - Database instance
 * @param provider - Provider name (e.g., 'openai', 'openrouter')
 * @param token - Token data to encrypt and store
 */
export function encryptAndStoreToken(db: Database, provider: string, token: TokenData): void {
  // Encrypt the access token
  const accessEncrypted = encrypt(token.accessToken);

  // Encrypt refresh token if present
  let refreshEncrypted: { encrypted: string; iv: string } | null = null;
  if (token.refreshToken) {
    refreshEncrypted = encrypt(token.refreshToken);
  }

  // Store in database
  // - iv column: stores the access token IV
  // - token_type: stores refresh token IV as "Bearer|{refresh_iv}" if refresh token exists
  db.upsertOAuthTokens({
    id: randomUUID(),
    provider,
    accessToken: accessEncrypted.encrypted,
    refreshToken: refreshEncrypted?.encrypted ?? null,
    expiresAt: token.expiresAt ?? null,
    tokenType: refreshEncrypted ? `Bearer|${refreshEncrypted.iv}` : 'Bearer',
    iv: accessEncrypted.iv,
    authMethod: 'oauth',
    userEmail: token.userEmail ?? null,
  });

  log.info({ provider }, 'OAuth token encrypted and stored');
}

/**
 * Load and decrypt an OAuth token for a provider.
 *
 * @param db - Database instance
 * @param provider - Provider name
 * @returns Decrypted token data, or null if not found
 */
export function loadDecryptedToken(db: Database, provider: string): DecryptedToken | null {
  const row = db.getOAuthTokens(provider);
  if (!row) {
    return null;
  }

  try {
    // Get iv for access token from dedicated column
    const accessIv = row.iv;
    if (!accessIv) {
      log.error({ provider }, 'Token stored without IV - cannot decrypt');
      return null;
    }

    // Decrypt access token
    const accessToken = decrypt(row.access_token, accessIv);

    // Decrypt refresh token if present
    let refreshToken: string | null = null;
    if (row.refresh_token && row.token_type.includes('|')) {
      const refreshIv = row.token_type.split('|')[1];
      if (refreshIv) {
        refreshToken = decrypt(row.refresh_token, refreshIv);
      }
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: row.expires_at,
      userEmail: row.user_email ?? null,
    };
  } catch (err) {
    log.error({ err, provider }, 'Failed to decrypt token');
    return null;
  }
}

/**
 * Delete an OAuth token for a provider.
 *
 * @param db - Database instance
 * @param provider - Provider name
 */
export function deleteProviderToken(db: Database, provider: string): void {
  db.deleteOAuthTokens(provider);
  log.info({ provider }, 'OAuth token deleted');
}

/**
 * Get a valid access token for a provider.
 *
 * Checks expiry and returns the decrypted access token.
 * For providers that don't expire (like OpenRouter API keys),
 * returns the token directly.
 *
 * @param db - Database instance
 * @param provider - Provider name
 * @returns Valid access token, or null if not found/expired
 */
export function getValidToken(db: Database, provider: string): string | null {
  const token = loadDecryptedToken(db, provider);
  if (!token) {
    return null;
  }

  // Check expiry if set
  if (token.expiresAt) {
    const expiresAtDate = new Date(token.expiresAt);
    const now = new Date();

    // Add 5 minute buffer before expiry
    const bufferMs = 5 * 60 * 1000;
    if (expiresAtDate.getTime() - now.getTime() < bufferMs) {
      log.info({ provider }, 'OAuth token expired or expiring soon');
      return null;
    }
  }

  return token.accessToken;
}
