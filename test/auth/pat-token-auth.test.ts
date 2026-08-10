import { describe, expect, it } from 'vitest';
import {
  AuthService,
  setupPassword,
  validateMcpBearerToken,
  type AuthDatabase,
} from '../../src/auth/auth-service.js';
import type { AuthRow, PatTokenRow } from '../../src/db/types.js';

class PatAuthDb implements AuthDatabase {
  private passwordHash = '';
  private apiTokenEncrypted = '';
  private apiTokenIv = '';
  private sessions = new Map<string, { token: string; createdAt: number; expiresAt: number }>();
  readonly rows = new Map<string, PatTokenRow>();
  touchCount = 0;

  async isPasswordSet(): Promise<boolean> {
    return this.passwordHash.length > 0;
  }

  async getAuth(): Promise<AuthRow> {
    const session = this.sessions.values().next().value;
    return {
      id: 1,
      password_hash: this.passwordHash,
      api_token: this.apiTokenEncrypted,
      api_token_iv: this.apiTokenIv || null,
      session_token: session?.token ?? null,
      session_created_at: session?.createdAt ?? null,
      session_expires_at: session?.expiresAt ?? null,
      active_scope_project_id: null,
      destructive_mcp_unlock: false,
    };
  }

  async setPassword(hash: string): Promise<void> {
    this.passwordHash = hash;
  }

  async getApiToken(): Promise<{ encrypted: string; iv: string } | null> {
    if (!this.apiTokenEncrypted || !this.apiTokenIv) return null;
    return { encrypted: this.apiTokenEncrypted, iv: this.apiTokenIv };
  }

  async setApiToken(encrypted: string, iv: string): Promise<void> {
    this.apiTokenEncrypted = encrypted;
    this.apiTokenIv = iv;
  }

  async getSession(
    token: string,
  ): Promise<{ token: string; createdAt: number; expiresAt: number } | null> {
    return this.sessions.get(token) ?? null;
  }

  async createSession(token: string, createdAt: number, expiresAt: number): Promise<void> {
    this.sessions.set(token, { token, createdAt, expiresAt });
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async deleteAllSessions(): Promise<void> {
    this.sessions.clear();
  }

  async createPatToken(input: {
    id: string;
    name: string;
    tokenHash: string;
    tokenSuffix: string;
    scopeKind: 'org' | 'project' | 'service';
    scopeProjectId?: string | null;
    scopeServiceId?: string | null;
    tokenType?: 'pat' | 'service' | 'legacy-default';
    capabilities?: Record<string, unknown> | null;
    expiresAt?: string | null;
  }): Promise<PatTokenRow> {
    const row: PatTokenRow = {
      id: input.id,
      name: input.name,
      token_hash: input.tokenHash,
      token_suffix: input.tokenSuffix,
      scope_kind: input.scopeKind,
      scope_project_id: input.scopeKind === 'project' ? (input.scopeProjectId ?? null) : null,
      scope_service_id: input.scopeKind === 'service' ? (input.scopeServiceId ?? null) : null,
      token_type: input.tokenType ?? 'pat',
      capabilities: input.capabilities ?? null,
      last_used_at: null,
      expires_at: input.expiresAt ?? null,
      revoked_at: null,
      created_at: '2026-05-05T00:00:00.000Z',
      server_id: 'local',
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findPatTokenByHash(tokenHash: string): Promise<PatTokenRow | null> {
    return [...this.rows.values()].find((row) => row.token_hash === tokenHash) ?? null;
  }

  async findPatTokenById(id: string): Promise<PatTokenRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findLegacyDefaultPatToken(): Promise<PatTokenRow | null> {
    return [...this.rows.values()].find((row) => row.token_type === 'legacy-default') ?? null;
  }

  async upsertLegacyDefaultPatToken(input: {
    tokenHash: string;
    tokenSuffix: string;
  }): Promise<PatTokenRow> {
    const existing = await this.findLegacyDefaultPatToken();
    if (existing) {
      const row = {
        ...existing,
        token_hash: input.tokenHash,
        token_suffix: input.tokenSuffix,
        revoked_at: null,
      };
      this.rows.set(row.id, row);
      return row;
    }
    return this.createPatToken({
      id: 'legacy-default',
      name: 'Legacy default token',
      tokenHash: input.tokenHash,
      tokenSuffix: input.tokenSuffix,
      scopeKind: 'org',
      scopeProjectId: null,
      tokenType: 'legacy-default',
      expiresAt: null,
    });
  }

  async listPatTokens(
    options: {
      scopeKind?: 'org' | 'project' | 'service';
      scopeProjectId?: string | null;
      scopeServiceId?: string | null;
      includeRevoked?: boolean;
    } = {},
  ): Promise<PatTokenRow[]> {
    return [...this.rows.values()]
      .filter((row) => options.includeRevoked || !row.revoked_at)
      .filter((row) => !options.scopeKind || row.scope_kind === options.scopeKind)
      .filter(
        (row) =>
          options.scopeKind !== 'project' ||
          !options.scopeProjectId ||
          row.scope_project_id === options.scopeProjectId,
      )
      .filter(
        (row) =>
          options.scopeKind !== 'service' ||
          !options.scopeServiceId ||
          row.scope_service_id === options.scopeServiceId,
      )
      .filter(
        (row) =>
          options.scopeKind !== 'org' ||
          (row.scope_project_id === null && row.scope_service_id === null),
      );
  }

  async touchPatToken(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) {
      this.touchCount += 1;
      this.rows.set(id, { ...row, last_used_at: new Date().toISOString() });
    }
  }

  async revokePatToken(id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    this.rows.set(id, { ...row, revoked_at: '2026-05-05T00:02:00.000Z' });
    return true;
  }
}

describe('PAT token auth', () => {
  it('issues hashed project-scoped MCP PATs and validates their identity', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);

    const issued = await service.issuePatToken({
      name: 'Cursor',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(issued.token).toMatch(/^olp_/);
    expect(issued.row.token_hash).not.toBe(issued.token);

    const identity = await service.validateMcpBearerToken(issued.token);
    expect(identity).toMatchObject({
      tokenId: issued.row.id,
      tokenType: 'pat',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      name: 'Cursor',
    });
  });

  it('issues hashed service-scoped MCP service tokens and validates their identity', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);

    const issued = await service.issuePatToken({
      name: 'Open in Agent handoff',
      scopeKind: 'service',
      scopeServiceId: 'service-1',
      tokenType: 'service',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(issued.token).toMatch(/^olp_/);
    expect(issued.row).toMatchObject({
      scope_kind: 'service',
      scope_project_id: null,
      scope_service_id: 'service-1',
      token_type: 'service',
    });

    const identity = await service.validateMcpBearerToken(issued.token);
    expect(identity).toMatchObject({
      tokenId: issued.row.id,
      tokenType: 'service',
      scopeKind: 'service',
      scopeProjectId: null,
      scopeServiceId: 'service-1',
      name: 'Open in Agent handoff',
    });
  });

  it('keeps legacy api_token valid and seeds a legacy-default PAT metadata row', async () => {
    const db = new PatAuthDb();
    const { apiToken } = await setupPassword(db, 'password');

    const identity = await validateMcpBearerToken(db, apiToken);

    expect(identity).toMatchObject({
      tokenType: 'legacy-default',
      scopeKind: 'org',
      scopeProjectId: null,
    });
    expect([...db.rows.values()]).toEqual([
      expect.objectContaining({
        id: 'legacy-default',
        name: 'Legacy default token',
        token_type: 'legacy-default',
        scope_kind: 'org',
      }),
    ]);
  });

  it('debounces PAT last-used writes during frequent MCP polling', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const issued = await service.issuePatToken({
      name: 'Cursor',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await service.validateMcpBearerToken(issued.token);
    await service.validateMcpBearerToken(issued.token);

    expect(db.touchCount).toBe(1);
  });

  it('rejects invalid PAT expiry timestamps before persistence', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);

    await expect(
      service.issuePatToken({
        name: 'Cursor',
        scopeKind: 'project',
        scopeProjectId: 'proj-1',
        expiresAt: 'never',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_FIELD' });
    expect(db.rows.size).toBe(0);
  });

  it('narrows project-scoped callers to their own PAT metadata', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const first = await service.issuePatToken({
      name: 'Project One',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await service.issuePatToken({
      name: 'Project Two',
      scopeKind: 'project',
      scopeProjectId: 'proj-2',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const rows = await service.listPatTokens(undefined, {
      tokenId: first.row.id,
      tokenType: 'pat',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      scopeServiceId: null,
      name: 'Project One',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope_project_id: 'proj-1' });
  });

  it('narrows service-scoped callers to their own PAT metadata', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const first = await service.issuePatToken({
      name: 'Service One',
      scopeKind: 'service',
      scopeServiceId: 'service-1',
      tokenType: 'service',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await service.issuePatToken({
      name: 'Service Two',
      scopeKind: 'service',
      scopeServiceId: 'service-2',
      tokenType: 'service',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const rows = await service.listPatTokens(undefined, {
      tokenId: first.row.id,
      tokenType: 'service',
      scopeKind: 'service',
      scopeProjectId: null,
      scopeServiceId: 'service-1',
      name: 'Service One',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope_service_id: 'service-1' });
  });

  it('blocks project-scoped callers from revoking tokens outside their project', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const first = await service.issuePatToken({
      name: 'Project One',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const second = await service.issuePatToken({
      name: 'Project Two',
      scopeKind: 'project',
      scopeProjectId: 'proj-2',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(
      service.revokePatToken(second.row.id, {
        tokenId: first.row.id,
        tokenType: 'pat',
        scopeKind: 'project',
        scopeProjectId: 'proj-1',
        scopeServiceId: null,
        name: 'Project One',
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
    expect((await db.findPatTokenById(second.row.id))?.revoked_at).toBeNull();
  });

  it('allows project-scoped callers to revoke sibling tokens in the same project', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const first = await service.issuePatToken({
      name: 'Cursor',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const second = await service.issuePatToken({
      name: 'Claude',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const revoked = await service.revokePatToken(second.row.id, {
      tokenId: first.row.id,
      tokenType: 'pat',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      scopeServiceId: null,
      name: 'Cursor',
    });

    expect(revoked).toBe(true);
    expect((await db.findPatTokenById(second.row.id))?.revoked_at).not.toBeNull();
  });

  it('rotates the v0.1 org MCP PAT and invalidates the legacy default token', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const { apiToken } = await setupPassword(db, 'password');
    await validateMcpBearerToken(db, apiToken);
    const oldOrgPat = await service.issuePatToken({
      name: 'Old org token',
      scopeKind: 'org',
      scopeProjectId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const projectPat = await service.issuePatToken({
      name: 'Project token',
      scopeKind: 'project',
      scopeProjectId: 'proj-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const rotated = await service.rotateOrgMcpPatToken({
      name: 'OpenLander agent',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(rotated.token).toMatch(/^olp_/);
    expect(rotated.created).toBe(true);
    expect(rotated.legacyTokenRotated).toBe(true);
    expect(rotated.revokedTokenIds).toEqual(
      expect.arrayContaining(['legacy-default', oldOrgPat.row.id]),
    );
    expect(await validateMcpBearerToken(db, apiToken)).toBeNull();
    expect(await validateMcpBearerToken(db, oldOrgPat.token)).toBeNull();
    await expect(validateMcpBearerToken(db, projectPat.token)).resolves.toMatchObject({
      tokenId: projectPat.row.id,
      scopeKind: 'project',
    });
    await expect(validateMcpBearerToken(db, rotated.token ?? '')).resolves.toMatchObject({
      tokenId: rotated.row.id,
      tokenType: 'pat',
      scopeKind: 'org',
    });
  });

  it('returns the existing org MCP PAT and revokes duplicate org PATs', async () => {
    const db = new PatAuthDb();
    const service = new AuthService(db);
    const keeper = await service.issuePatToken({
      name: 'Keeper',
      scopeKind: 'org',
      scopeProjectId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const duplicate = await service.issuePatToken({
      name: 'Duplicate',
      scopeKind: 'org',
      scopeProjectId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const ensured = await service.ensureOrgMcpPatToken({
      name: 'OpenLander agent',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(ensured.token).toBeNull();
    expect(ensured.created).toBe(false);
    expect(ensured.row.id).toBe(keeper.row.id);
    expect(ensured.revokedTokenIds).toEqual([duplicate.row.id]);
    expect((await db.findPatTokenById(duplicate.row.id))?.revoked_at).not.toBeNull();
  });
});
