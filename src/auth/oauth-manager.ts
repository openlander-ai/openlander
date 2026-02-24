import { createCipheriv, createDecipheriv, createHash, randomBytes, webcrypto } from 'node:crypto';
import { homedir, hostname, platform } from 'node:os';

import { nanoid } from 'nanoid';

import type { Database } from '../db/index.js';
import { LLMProviderError } from '../errors.js';

export interface OAuthProviderConfig {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
  additionalParams?: Record<string, string>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: string | number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

const TOKEN_REFRESH_SKEW_MS = 60_000;
const ENCRYPTION_CONTEXT = 'openlander:oauth:v1';

export function generateCodeVerifier(): string {
  return nanoid(96);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

export function generateState(): string {
  return nanoid(32);
}

export class OAuthManager {
  private readonly config: OAuthProviderConfig;
  private readonly db: Database;
  private readonly encryptionKey: Buffer;

  constructor(config: OAuthProviderConfig, db: Database) {
    this.config = config;
    this.db = db;
    this.encryptionKey = this.deriveEncryptionKey();
  }

  async generateAuthUrl(): Promise<{ url: string; state: string; codeVerifier: string }> {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (this.config.additionalParams) {
      for (const [key, value] of Object.entries(this.config.additionalParams)) {
        params.set(key, value);
      }
    }

    const authUrl = new URL(this.config.authUrl);
    authUrl.search = params.toString();

    return {
      url: authUrl.toString(),
      state,
      codeVerifier,
    };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    });

    const response = await this.requestToken(body);
    return this.toOAuthTokens(response);
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const response = await this.requestToken(body);
    const tokens = this.toOAuthTokens(response);

    if (!tokens.refreshToken) {
      tokens.refreshToken = refreshToken;
    }

    return tokens;
  }

  async getValidTokens(providerId: string): Promise<OAuthTokens | null> {
    const stored = this.db.getOAuthTokens(providerId);
    if (!stored) {
      return null;
    }

    const tokens: OAuthTokens = {
      accessToken: this.decrypt(stored.access_token),
      refreshToken: stored.refresh_token ? this.decrypt(stored.refresh_token) : undefined,
      expiresAt: stored.expires_at ? Number(stored.expires_at) : undefined,
      tokenType: stored.token_type,
    };

    const isExpired =
      typeof tokens.expiresAt === 'number' &&
      Date.now() >= tokens.expiresAt - TOKEN_REFRESH_SKEW_MS;
    if (!isExpired) {
      return tokens;
    }

    if (!tokens.refreshToken) {
      return null;
    }

    const refreshed = await this.refreshTokens(tokens.refreshToken);
    this.saveTokens(providerId, refreshed);
    return refreshed;
  }

  saveTokens(providerId: string, tokens: OAuthTokens): void {
    this.db.upsertOAuthTokens({
      id: nanoid(12),
      provider: providerId,
      accessToken: this.encrypt(tokens.accessToken),
      refreshToken: tokens.refreshToken ? this.encrypt(tokens.refreshToken) : null,
      expiresAt: typeof tokens.expiresAt === 'number' ? String(tokens.expiresAt) : null,
      tokenType: tokens.tokenType,
    });
  }

  clearTokens(providerId: string): void {
    this.db.deleteOAuthTokens(providerId);
  }

  private async requestToken(body: URLSearchParams): Promise<OAuthTokenResponse> {
    let response: Response;

    try {
      response = await fetch(this.config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('oauth', `Token request failed: ${message}`);
    }

    let payload: OAuthTokenResponse;
    try {
      payload = (await response.json()) as OAuthTokenResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('oauth', `Invalid token response JSON: ${message}`);
    }

    if (!response.ok || payload.error) {
      const providerMessage =
        payload.error_description ?? payload.error ?? `HTTP ${String(response.status)}`;
      throw new LLMProviderError('oauth', `Token exchange failed: ${providerMessage}`);
    }

    return payload;
  }

  private toOAuthTokens(response: OAuthTokenResponse): OAuthTokens {
    if (!response.access_token || typeof response.access_token !== 'string') {
      throw new LLMProviderError('oauth', 'Missing access_token in token response');
    }

    const expiresAt = this.resolveExpiresAt(response);

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt,
      tokenType: response.token_type ?? 'Bearer',
    };
  }

  private resolveExpiresAt(response: OAuthTokenResponse): number | undefined {
    if (
      typeof response.expires_in === 'number' &&
      Number.isFinite(response.expires_in) &&
      response.expires_in > 0
    ) {
      return Date.now() + response.expires_in * 1000;
    }

    if (typeof response.expires_at === 'number' && Number.isFinite(response.expires_at)) {
      return response.expires_at;
    }

    if (typeof response.expires_at === 'string') {
      const parsed = Number(response.expires_at);
      if (Number.isFinite(parsed)) {
        return parsed;
      }

      const epochMs = Date.parse(response.expires_at);
      if (Number.isFinite(epochMs)) {
        return epochMs;
      }
    }

    return undefined;
  }

  private deriveEncryptionKey(): Buffer {
    const seed = `${platform()}|${hostname()}|${homedir()}|${ENCRYPTION_CONTEXT}`;
    return createHash('sha256').update(seed).digest();
  }

  private encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${toBase64Url(iv)}.${toBase64Url(authTag)}.${toBase64Url(encrypted)}`;
  }

  private decrypt(cipherText: string): string {
    const [ivPart, authTagPart, payloadPart] = cipherText.split('.');
    if (!ivPart || !authTagPart || !payloadPart) {
      throw new LLMProviderError('oauth', 'Corrupted encrypted token payload');
    }

    const iv = fromBase64Url(ivPart);
    const authTag = fromBase64Url(authTagPart);
    const payload = fromBase64Url(payloadPart);

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('oauth', `Failed to decrypt stored token: ${message}`);
    }
  }
}

function toBase64Url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padding), 'base64');
}
