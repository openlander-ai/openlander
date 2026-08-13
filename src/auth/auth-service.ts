import { compareSync, hashSync } from 'bcryptjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '../env/crypto.js';
import type { AuthRow, PatTokenRow } from '../db/index.js';
import { OpenLanderError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';

const AUTH_SALT_ROUNDS = 10;
const SESSION_TTL_MS = Number(process.env['OPENLANDER_SESSION_TTL_HOURS'] || 168) * 60 * 60 * 1000;
const PAT_LAST_USED_TOUCH_INTERVAL_MS = 60_000;
const log = createModuleLogger('auth-service');
export const MIN_PASSWORD_LENGTH = 8;
type McpScopeKind = 'org' | 'project' | 'service';

export interface AuthDatabase {
  isPasswordSet(): Promise<boolean>;
  getAuth(): Promise<AuthRow | null>;
  setPassword(hash: string): Promise<void>;
  getApiToken(): Promise<{ encrypted: string; iv: string } | null>;
  setApiToken(encrypted: string, iv: string): Promise<void>;
  getSession(
    token: string,
  ): Promise<{ token: string; createdAt: number; expiresAt: number } | null>;
  createSession(token: string, createdAt: number, expiresAt: number): Promise<void>;
  deleteSession(token: string): Promise<void>;
  deleteAllSessions(): Promise<void>;
}

export interface IssuePatTokenInput {
  name: string;
  scopeKind: McpScopeKind;
  scopeProjectId?: string | null;
  scopeServiceId?: string | null;
  expiresAt: string | null;
  tokenType?: 'pat' | 'service';
}

export interface OrgMcpPatTokenResult {
  token: string | null;
  row: PatTokenRow;
  created: boolean;
  revokedTokenIds: string[];
  legacyTokenRotated: boolean;
}

export interface McpTokenIdentity {
  tokenId: string | null;
  tokenType: 'legacy-default' | 'pat' | 'service';
  scopeKind: McpScopeKind;
  scopeProjectId: string | null;
  scopeServiceId: string | null;
  name: string;
}

interface PatTokenDatabase {
  createPatToken(input: {
    id: string;
    name: string;
    tokenHash: string;
    tokenSuffix: string;
    tokenEncrypted?: string | null;
    tokenEncryptedIv?: string | null;
    scopeKind: McpScopeKind;
    scopeProjectId?: string | null;
    scopeServiceId?: string | null;
    tokenType?: 'pat' | 'service' | 'legacy-default';
    capabilities?: Record<string, unknown> | null;
    expiresAt?: string | null;
  }): Promise<PatTokenRow>;
  findPatTokenByHash(tokenHash: string): Promise<PatTokenRow | null>;
  findPatTokenById(id: string): Promise<PatTokenRow | null>;
  findLegacyDefaultPatToken(): Promise<PatTokenRow | null>;
  upsertLegacyDefaultPatToken(input: {
    tokenHash: string;
    tokenSuffix: string;
  }): Promise<PatTokenRow>;
  listPatTokens(options?: {
    scopeKind?: McpScopeKind;
    scopeProjectId?: string | null;
    scopeServiceId?: string | null;
    includeRevoked?: boolean;
  }): Promise<PatTokenRow[]>;
  touchPatToken(id: string): Promise<void>;
  revokePatToken(id: string): Promise<boolean>;
}

function hasPatTokenDatabase(db: AuthDatabase): db is AuthDatabase & PatTokenDatabase {
  const candidate = db as Partial<PatTokenDatabase>;
  return (
    typeof candidate.createPatToken === 'function' &&
    typeof candidate.findPatTokenByHash === 'function' &&
    typeof candidate.findPatTokenById === 'function' &&
    typeof candidate.findLegacyDefaultPatToken === 'function' &&
    typeof candidate.upsertLegacyDefaultPatToken === 'function' &&
    typeof candidate.listPatTokens === 'function' &&
    typeof candidate.touchPatToken === 'function' &&
    typeof candidate.revokePatToken === 'function'
  );
}

/**
 * Hash a plaintext password for persistent auth storage.
 */
export function hashPassword(plain: string): string {
  return hashSync(plain, AUTH_SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export function verifyPassword(plain: string, hash: string): boolean {
  return compareSync(plain, hash);
}

export function assertPasswordMeetsPolicy(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.trim().length < MIN_PASSWORD_LENGTH) {
    throw new OpenLanderError(
      `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
      'PASSWORD_TOO_SHORT',
      400,
      { minLength: MIN_PASSWORD_LENGTH },
    );
  }
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

export function generatePatTokenPlaintext(): string {
  return `olp_${randomBytes(32).toString('hex')}`;
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenSuffix(token: string): string {
  return token.slice(-4);
}

function logPatAuthFailed(
  reason: string,
  fields: {
    tokenId?: string | null;
    tokenType?: string | null;
    suffix?: string | null;
    scopeKind?: string | null;
    scopeProjectId?: string | null;
    scopeServiceId?: string | null;
  },
): void {
  log.warn(
    {
      event: 'pat.auth.failed',
      reason,
      token_id: fields.tokenId ?? null,
      token_type: fields.tokenType ?? null,
      suffix: fields.suffix ?? null,
      scope_kind: fields.scopeKind ?? null,
      scope_project_id: fields.scopeProjectId ?? null,
      scope_service_id: fields.scopeServiceId ?? null,
    },
    'pat.auth.failed',
  );
}

function logPatRevoked(
  target: PatTokenRow | null,
  fields: {
    tokenId: string;
    caller?: McpTokenIdentity;
    reason?: string;
  },
): void {
  log.info(
    {
      event: 'pat.revoked',
      token_id: fields.tokenId,
      token_type: target?.token_type,
      suffix: target?.token_suffix,
      scope_kind: target?.scope_kind,
      scope_project_id: target?.scope_project_id,
      scope_service_id: target?.scope_service_id,
      actor_token_id: fields.caller?.tokenId ?? null,
      actor_token_type: fields.caller?.tokenType ?? 'web-session',
      actor_scope_kind: fields.caller?.scopeKind ?? null,
      actor_scope_project_id: fields.caller?.scopeProjectId ?? null,
      actor_scope_service_id: fields.caller?.scopeServiceId ?? null,
      reason: fields.reason ?? null,
    },
    'pat.revoked',
  );
}

function isTokenUsable(row: PatTokenRow, now = new Date()): boolean {
  if (row.revoked_at) return false;
  if (!row.expires_at) return true;
  return Date.parse(row.expires_at) > now.getTime();
}

function shouldTouchPatToken(row: PatTokenRow, now = Date.now()): boolean {
  if (!row.last_used_at) return true;
  const lastUsed = Date.parse(row.last_used_at);
  if (Number.isNaN(lastUsed)) return true;
  return now - lastUsed > PAT_LAST_USED_TOUCH_INTERVAL_MS;
}

function narrowPatTokenListOptionsForCaller(
  options: Parameters<PatTokenDatabase['listPatTokens']>[0] | undefined,
  caller?: McpTokenIdentity,
): Parameters<PatTokenDatabase['listPatTokens']>[0] | undefined {
  if (!caller || caller.tokenType === 'legacy-default' || caller.scopeKind === 'org') {
    return options;
  }
  if (caller.scopeKind === 'service') {
    return {
      ...options,
      scopeKind: 'service',
      scopeServiceId: caller.scopeServiceId,
    };
  }
  return {
    ...options,
    scopeKind: 'project',
    scopeProjectId: caller.scopeProjectId,
  };
}

async function assertPatTokenRevokeAllowed(
  db: AuthDatabase & PatTokenDatabase,
  id: string,
  caller?: McpTokenIdentity,
): Promise<PatTokenRow | null> {
  if (!caller || caller.tokenType === 'legacy-default' || caller.scopeKind === 'org') {
    return null;
  }

  const target = await db.findPatTokenById(id);
  if (!target) return null;

  const sameToken = target.id === caller.tokenId;
  const sameService =
    caller.scopeKind === 'service' &&
    target.scope_kind === 'service' &&
    target.scope_service_id === caller.scopeServiceId;
  const sameProject =
    caller.scopeKind === 'project' &&
    target.scope_kind === 'project' &&
    target.scope_project_id === caller.scopeProjectId;
  if (sameToken || sameService || sameProject) return target;

  log.warn(
    {
      event: 'pat.auth.failed',
      reason: 'scope_mismatch',
      token_id: caller.tokenId,
      token_type: caller.tokenType,
      scope_kind: caller.scopeKind,
      scope_project_id: caller.scopeProjectId,
      scope_service_id: caller.scopeServiceId,
      target_token_id: target.id,
      target_scope_kind: target.scope_kind,
      target_scope_project_id: target.scope_project_id,
      target_scope_service_id: target.scope_service_id,
      target_suffix: target.token_suffix,
    },
    'pat.auth.failed',
  );
  throw new OpenLanderError('PAT token is outside the caller scope.', 'SCOPE_MISMATCH', 403, {
    expectedProjectId: caller.scopeProjectId,
    expectedServiceId: caller.scopeServiceId,
    actualProjectId: target.scope_project_id,
    actualServiceId: target.scope_service_id,
  });
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
  const session = await db.getSession(token);
  if (!session) {
    return false;
  }

  if (Date.now() > session.expiresAt) {
    await db.deleteSession(token);
    return false;
  }

  return true;
}

/**
 * Delete the current stored session.
 */
export async function deleteSession(db: AuthDatabase, token: string): Promise<void> {
  await db.deleteSession(token);
}

/**
 * Initial password setup flow: stores hashed password and initial API token.
 */
export async function setupPassword(
  db: AuthDatabase,
  password: string,
): Promise<{ apiToken: string }> {
  assertPasswordMeetsPolicy(password);
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

  assertPasswordMeetsPolicy(newPassword);
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
 * Reset password without verifying the old password and invalidate web sessions (CLI recovery).
 */
export async function resetPassword(db: AuthDatabase, newPassword: string): Promise<void> {
  assertPasswordMeetsPolicy(newPassword);
  await db.setPassword(hashPassword(newPassword));
  await db.deleteAllSessions();
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

export async function validateMcpBearerToken(
  db: AuthDatabase,
  token: string,
): Promise<McpTokenIdentity | null> {
  let patFailureLogged = false;
  if (hasPatTokenDatabase(db)) {
    const row = await db.findPatTokenByHash(hashMcpToken(token));
    if (row && isTokenUsable(row)) {
      if (shouldTouchPatToken(row)) {
        await db.touchPatToken(row.id);
      }
      return {
        tokenId: row.id,
        tokenType: row.token_type,
        scopeKind: row.scope_kind,
        scopeProjectId: row.scope_project_id,
        scopeServiceId: row.scope_service_id,
        name: row.name,
      };
    }
    if (row) {
      logPatAuthFailed(row.revoked_at ? 'revoked' : 'expired', {
        tokenId: row.id,
        tokenType: row.token_type,
        suffix: row.token_suffix,
        scopeKind: row.scope_kind,
        scopeProjectId: row.scope_project_id,
        scopeServiceId: row.scope_service_id,
      });
      patFailureLogged = true;
    }
  }

  if (await validateApiToken(db, token)) {
    if (hasPatTokenDatabase(db)) {
      await ensureLegacyDefaultPatToken(db, token);
    }
    return {
      tokenId: null,
      tokenType: 'legacy-default',
      scopeKind: 'org',
      scopeProjectId: null,
      scopeServiceId: null,
      name: 'legacy-default',
    };
  }

  if (!patFailureLogged && token.startsWith('olp_')) {
    logPatAuthFailed('not_found', { suffix: tokenSuffix(token) });
  }

  return null;
}

export async function ensureLegacyDefaultPatToken(
  db: AuthDatabase,
  plaintextToken?: string,
): Promise<PatTokenRow | null> {
  if (!hasPatTokenDatabase(db)) return null;
  let token = plaintextToken;
  if (!token) {
    const stored = await db.getApiToken();
    if (!stored) return null;
    try {
      token = decryptToken(stored.encrypted, stored.iv);
    } catch {
      return null;
    }
  }

  return db.upsertLegacyDefaultPatToken({
    tokenHash: hashMcpToken(token),
    tokenSuffix: tokenSuffix(token),
  });
}

/**
 * Core auth service wrapper around auth helpers and DB persistence.
 */
export class AuthService {
  private orgMcpPatTokenLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: AuthDatabase) {}

  private async withOrgMcpPatTokenLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.orgMcpPatTokenLock;
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.orgMcpPatTokenLock = previous.then(
      () => current,
      () => current,
    );
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
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

  setupPassword(password: string): Promise<{ apiToken: string }> {
    return setupPassword(this.db, password);
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

  validateMcpBearerToken(token: string): Promise<McpTokenIdentity | null> {
    return validateMcpBearerToken(this.db, token);
  }

  async issuePatToken(input: IssuePatTokenInput): Promise<{
    token: string;
    row: PatTokenRow;
  }> {
    if (!hasPatTokenDatabase(this.db)) {
      throw new OpenLanderError(
        'PAT token storage is not available.',
        'PAT_STORAGE_UNAVAILABLE',
        500,
      );
    }
    if (input.scopeKind === 'project' && !input.scopeProjectId) {
      throw new OpenLanderError(
        'scopeProjectId is required for project-scoped PAT tokens.',
        'PROJECT_REQUIRED',
        400,
      );
    }
    if (input.scopeKind === 'service' && !input.scopeServiceId) {
      throw new OpenLanderError(
        'scopeServiceId is required for service-scoped PAT tokens.',
        'SERVICE_REQUIRED',
        400,
      );
    }
    if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt))) {
      throw new OpenLanderError('expiresAt must be a valid ISO timestamp.', 'INVALID_FIELD', 400, {
        field: 'expiresAt',
      });
    }
    const token = generatePatTokenPlaintext();
    const encryptedToken = encryptToken(token);
    const row = await this.db.createPatToken({
      id: randomUUID(),
      name: input.name,
      tokenHash: hashMcpToken(token),
      tokenSuffix: tokenSuffix(token),
      tokenEncrypted: encryptedToken.encrypted,
      tokenEncryptedIv: encryptedToken.iv,
      scopeKind: input.scopeKind,
      scopeProjectId: input.scopeProjectId ?? null,
      scopeServiceId: input.scopeServiceId ?? null,
      tokenType: input.tokenType ?? 'pat',
      expiresAt: input.expiresAt,
    });
    log.info(
      {
        event: 'pat.issued',
        token_id: row.id,
        token_type: row.token_type,
        suffix: row.token_suffix,
        scope_kind: row.scope_kind,
        scope_project_id: row.scope_project_id,
        scope_service_id: row.scope_service_id,
        expires_at: row.expires_at,
      },
      'pat.issued',
    );
    return { token, row };
  }

  async revealOrgMcpPatToken(): Promise<{ token: string; row: PatTokenRow }> {
    if (!hasPatTokenDatabase(this.db)) {
      throw new OpenLanderError(
        'PAT token storage is not available.',
        'PAT_STORAGE_UNAVAILABLE',
        500,
      );
    }

    const rows = await this.db.listPatTokens({ scopeKind: 'org' });
    const row = rows.find(
      (candidate) =>
        candidate.token_type === 'pat' &&
        candidate.scope_kind === 'org' &&
        candidate.scope_project_id === null &&
        isTokenUsable(candidate),
    );
    if (!row) {
      throw new OpenLanderError('No active MCP access token exists.', 'MCP_TOKEN_NOT_FOUND', 404);
    }
    if (!row.token_encrypted || !row.token_encrypted_iv) {
      throw new OpenLanderError(
        'This token was issued before secure reveal storage was available. Regenerate it once to enable reveal.',
        'MCP_TOKEN_REVEAL_UNAVAILABLE',
        409,
      );
    }

    let token: string;
    try {
      token = decryptToken(row.token_encrypted, row.token_encrypted_iv);
    } catch {
      throw new OpenLanderError(
        'The encrypted MCP token could not be read.',
        'MCP_TOKEN_DECRYPT_FAILED',
        500,
      );
    }
    if (hashMcpToken(token) !== row.token_hash) {
      throw new OpenLanderError(
        'The encrypted MCP token does not match its verification hash.',
        'MCP_TOKEN_DECRYPT_FAILED',
        500,
      );
    }
    return { token, row };
  }

  async ensureOrgMcpPatToken(input: {
    name: string;
    expiresAt: string | null;
  }): Promise<OrgMcpPatTokenResult> {
    return this.withOrgMcpPatTokenLock(async () => {
      if (!hasPatTokenDatabase(this.db)) {
        throw new OpenLanderError(
          'PAT token storage is not available.',
          'PAT_STORAGE_UNAVAILABLE',
          500,
        );
      }

      const rows = await this.db.listPatTokens({ scopeKind: 'org' });
      const activeOrgPats = rows.filter(
        (row) =>
          row.token_type === 'pat' &&
          row.scope_kind === 'org' &&
          row.scope_project_id === null &&
          isTokenUsable(row),
      );
      const activeLegacyDefaults = rows.filter(
        (row) =>
          row.token_type === 'legacy-default' &&
          row.scope_kind === 'org' &&
          row.scope_project_id === null &&
          isTokenUsable(row),
      );
      const revokedTokenIds: string[] = [];
      let legacyTokenRotated = false;

      if (activeLegacyDefaults.length > 0) {
        await regenerateToken(this.db);
        legacyTokenRotated = true;
        for (const row of activeLegacyDefaults) {
          if (await this.db.revokePatToken(row.id)) {
            revokedTokenIds.push(row.id);
            logPatRevoked(row, {
              tokenId: row.id,
              reason: 'mcp_single_token_legacy_rotation',
            });
          }
        }
      }

      if (activeOrgPats.length > 0) {
        const [keeper, ...duplicates] = activeOrgPats;
        for (const row of duplicates) {
          if (await this.db.revokePatToken(row.id)) {
            revokedTokenIds.push(row.id);
            logPatRevoked(row, {
              tokenId: row.id,
              reason: 'mcp_single_token_duplicate',
            });
          }
        }
        if (keeper) {
          return {
            token: null,
            row: keeper,
            created: false,
            revokedTokenIds,
            legacyTokenRotated,
          };
        }
      }

      await regenerateToken(this.db);
      legacyTokenRotated = true;
      const issued = await this.issuePatToken({
        name: input.name,
        scopeKind: 'org',
        scopeProjectId: null,
        expiresAt: input.expiresAt,
      });
      return {
        token: issued.token,
        row: issued.row,
        created: true,
        revokedTokenIds,
        legacyTokenRotated,
      };
    });
  }

  async rotateOrgMcpPatToken(input: {
    name: string;
    expiresAt: string | null;
  }): Promise<OrgMcpPatTokenResult> {
    return this.withOrgMcpPatTokenLock(async () => {
      if (!hasPatTokenDatabase(this.db)) {
        throw new OpenLanderError(
          'PAT token storage is not available.',
          'PAT_STORAGE_UNAVAILABLE',
          500,
        );
      }

      const rows = await this.db.listPatTokens({ scopeKind: 'org' });
      const activeRows = rows.filter(
        (row) => row.scope_kind === 'org' && row.scope_project_id === null && isTokenUsable(row),
      );
      const revokedTokenIds: string[] = [];
      for (const row of activeRows) {
        if (await this.db.revokePatToken(row.id)) {
          revokedTokenIds.push(row.id);
          logPatRevoked(row, {
            tokenId: row.id,
            reason:
              row.token_type === 'legacy-default'
                ? 'mcp_single_token_legacy_rotation'
                : 'mcp_single_token_rotation',
          });
        }
      }

      await regenerateToken(this.db);
      const issued = await this.issuePatToken({
        name: input.name,
        scopeKind: 'org',
        scopeProjectId: null,
        expiresAt: input.expiresAt,
      });
      return {
        token: issued.token,
        row: issued.row,
        created: true,
        revokedTokenIds,
        legacyTokenRotated: true,
      };
    });
  }

  async listPatTokens(
    options?: {
      scopeKind?: McpScopeKind;
      scopeProjectId?: string | null;
      scopeServiceId?: string | null;
      includeRevoked?: boolean;
    },
    caller?: McpTokenIdentity,
  ): Promise<PatTokenRow[]> {
    if (!hasPatTokenDatabase(this.db)) return [];
    return this.db.listPatTokens(narrowPatTokenListOptionsForCaller(options, caller));
  }

  async revokePatToken(id: string, caller?: McpTokenIdentity): Promise<boolean> {
    if (!hasPatTokenDatabase(this.db)) return false;
    const target = await assertPatTokenRevokeAllowed(this.db, id, caller);
    const auditTarget = target ?? (await this.db.findPatTokenById(id));
    const revoked = await this.db.revokePatToken(id);
    if (revoked) {
      logPatRevoked(auditTarget, { tokenId: id, caller });
    }
    return revoked;
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
