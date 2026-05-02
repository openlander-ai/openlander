/**
 * Token encryption and storage wrapper.
 *
 * Uses AES-256-GCM encryption via src/env/crypto.js for token storage.
 * Provides high-level functions for OAuth token management.
 */
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from '../env/crypto.js';
import { createModuleLogger } from '../lib/logger.js';
import { refreshOAuthToken } from './token-refresh.js';
import type { Database } from '../db/index.js';

const log = createModuleLogger('auth');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 60 second buffer before expiry to trigger refresh
const EXPIRY_BUFFER_MS = 60 * 1000;

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
 * @param provider - Provider name (e.g., 'openai')
 * @param token - Token data to encrypt and store
 */
export async function encryptAndStoreToken(
  db: Database,
  provider: string,
  token: TokenData,
): Promise<void> {
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
  await db.upsertOAuthTokens({
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
export async function loadDecryptedToken(
  db: Database,
  provider: string,
): Promise<DecryptedToken | null> {
  const row = await db.getOAuthTokens(provider);
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
export async function deleteProviderToken(db: Database, provider: string): Promise<void> {
  await db.deleteOAuthTokens(provider);
  log.info({ provider }, 'OAuth token deleted');
}

/** Config needed to attempt token refresh for a provider. */
export interface RefreshConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Check if a provider's token is expired (or expiring within buffer) and refresh it.
 *
 * Only works for providers with a refresh_token and known token URL (currently Google).
 * Returns true if a refresh was performed, false if not needed or not possible.
 */
export async function refreshIfExpired(
  db: Database,
  provider: string,
  config?: RefreshConfig,
): Promise<boolean> {
  const token = await loadDecryptedToken(db, provider);
  if (!token) {
    return false;
  }

  if (!token.expiresAt) {
    return false;
  }

  const expiresAtMs = new Date(token.expiresAt).getTime();
  const now = Date.now();

  if (expiresAtMs - now > EXPIRY_BUFFER_MS) {
    return false;
  }

  if (!token.refreshToken) {
    log.info({ provider }, 'Token expired but no refresh_token available');
    return false;
  }

  if (!config) {
    log.info({ provider }, 'Token expired but no refresh config provided');
    return false;
  }

  const tokenUrl = provider === 'google' ? GOOGLE_TOKEN_URL : null;
  if (!tokenUrl) {
    log.info({ provider }, 'Token expired but no known token URL for provider');
    return false;
  }

  const result = await refreshOAuthToken({
    tokenUrl,
    refreshToken: token.refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  if (!result) {
    log.warn({ provider }, 'Token refresh returned null — refresh token may be revoked');
    return false;
  }

  const newExpiresAt = new Date(Date.now() + result.expires_in * 1000).toISOString();

  await encryptAndStoreToken(db, provider, {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? token.refreshToken,
    expiresAt: newExpiresAt,
    userEmail: token.userEmail,
  });

  log.info({ provider }, 'Token refreshed and stored');
  return true;
}

/**
 * Get a valid access token for a provider.
 *
 * Checks expiry, attempts refresh if possible, then returns the token.
 * For providers that don't expire (like OpenRouter API keys), returns directly.
 */
export async function getValidToken(
  db: Database,
  provider: string,
  refreshConfig?: RefreshConfig,
): Promise<string | null> {
  const token = await loadDecryptedToken(db, provider);
  if (!token) {
    return null;
  }

  if (token.expiresAt) {
    const expiresAtMs = new Date(token.expiresAt).getTime();
    const now = Date.now();

    if (expiresAtMs - now < EXPIRY_BUFFER_MS) {
      const refreshed = await refreshIfExpired(db, provider, refreshConfig);
      if (refreshed) {
        const updated = await loadDecryptedToken(db, provider);
        return updated?.accessToken ?? null;
      }
      log.info({ provider }, 'OAuth token expired or expiring soon');
      return null;
    }
  }

  return token.accessToken;
}

/**
 * Get a valid access token synchronously (no refresh attempt).
 *
 * For callers that cannot await — checks expiry with 5-minute buffer.
 */
export async function getValidTokenSync(db: Database, provider: string): Promise<string | null> {
  const token = await loadDecryptedToken(db, provider);
  if (!token) {
    return null;
  }

  if (token.expiresAt) {
    const expiresAtMs = new Date(token.expiresAt).getTime();
    const bufferMs = 5 * 60 * 1000;
    if (expiresAtMs - Date.now() < bufferMs) {
      log.info({ provider }, 'OAuth token expired or expiring soon');
      return null;
    }
  }

  return token.accessToken;
}
