import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { patTokens } from '../schema.drizzle.js';
import type { PatTokenRow } from '../types.js';
import { OpenLanderError } from '../../errors.js';

const LEGACY_DEFAULT_PAT_ID = 'legacy-default';

export interface CreatePatTokenInput {
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
}

export interface ListPatTokensOptions {
  scopeKind?: 'org' | 'project' | 'service';
  scopeProjectId?: string | null;
  scopeServiceId?: string | null;
  includeRevoked?: boolean;
}

export class PatTokenRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(input: CreatePatTokenInput): Promise<PatTokenRow> {
    const [row] = await this.db
      .insert(patTokens)
      .values({
        id: input.id,
        name: input.name,
        token_hash: input.tokenHash,
        token_suffix: input.tokenSuffix,
        scope_kind: input.scopeKind,
        scope_project_id: input.scopeKind === 'project' ? (input.scopeProjectId ?? null) : null,
        scope_service_id: input.scopeKind === 'service' ? (input.scopeServiceId ?? null) : null,
        token_type: input.tokenType ?? 'pat',
        capabilities: input.capabilities ?? null,
        expires_at: input.expiresAt ?? null,
      })
      .returning();
    if (!row) {
      throw new OpenLanderError('Failed to create PAT token row.', 'PAT_TOKEN_CREATE_FAILED', 500);
    }
    return row;
  }

  async findByHash(tokenHash: string): Promise<PatTokenRow | null> {
    const [row] = await this.db
      .select()
      .from(patTokens)
      .where(eq(patTokens.token_hash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<PatTokenRow | null> {
    const [row] = await this.db.select().from(patTokens).where(eq(patTokens.id, id)).limit(1);
    return row ?? null;
  }

  async findLegacyDefault(): Promise<PatTokenRow | null> {
    const [row] = await this.db
      .select()
      .from(patTokens)
      .where(eq(patTokens.token_type, 'legacy-default'))
      .limit(1);
    return row ?? null;
  }

  async upsertLegacyDefault(input: {
    tokenHash: string;
    tokenSuffix: string;
  }): Promise<PatTokenRow> {
    const existing = await this.findLegacyDefault();
    if (existing) {
      const [row] = await this.db
        .update(patTokens)
        .set({
          token_hash: input.tokenHash,
          token_suffix: input.tokenSuffix,
          revoked_at: null,
        })
        .where(eq(patTokens.id, existing.id))
        .returning();
      if (!row) {
        throw new OpenLanderError(
          'Failed to update legacy default PAT token row.',
          'PAT_TOKEN_UPDATE_FAILED',
          500,
        );
      }
      return row;
    }

    const [row] = await this.db
      .insert(patTokens)
      .values({
        id: LEGACY_DEFAULT_PAT_ID,
        name: 'Legacy default token',
        token_hash: input.tokenHash,
        token_suffix: input.tokenSuffix,
        scope_kind: 'org',
        scope_project_id: null,
        scope_service_id: null,
        token_type: 'legacy-default',
        expires_at: null,
      })
      .onConflictDoUpdate({
        target: patTokens.id,
        set: {
          token_hash: input.tokenHash,
          token_suffix: input.tokenSuffix,
          revoked_at: null,
        },
      })
      .returning();
    if (!row) {
      throw new OpenLanderError(
        'Failed to create legacy default PAT token row.',
        'PAT_TOKEN_CREATE_FAILED',
        500,
      );
    }
    return row;
  }

  async list(options: ListPatTokensOptions = {}): Promise<PatTokenRow[]> {
    const conditions = [];
    if (!options.includeRevoked) {
      conditions.push(isNull(patTokens.revoked_at));
    }
    if (options.scopeKind) {
      conditions.push(eq(patTokens.scope_kind, options.scopeKind));
    }
    if (options.scopeKind === 'project' && options.scopeProjectId) {
      conditions.push(eq(patTokens.scope_project_id, options.scopeProjectId));
    }
    if (options.scopeKind === 'service' && options.scopeServiceId) {
      conditions.push(eq(patTokens.scope_service_id, options.scopeServiceId));
    }
    if (options.scopeKind === 'org') {
      conditions.push(isNull(patTokens.scope_project_id));
      conditions.push(isNull(patTokens.scope_service_id));
    }

    const query = this.db.select().from(patTokens);
    if (conditions.length > 0) {
      return query.where(and(...conditions)).orderBy(desc(patTokens.created_at));
    }
    return query.orderBy(desc(patTokens.created_at));
  }

  async touch(id: string, lastUsedAt = new Date().toISOString()): Promise<void> {
    await this.db.update(patTokens).set({ last_used_at: lastUsedAt }).where(eq(patTokens.id, id));
  }

  async revoke(id: string, revokedAt = new Date().toISOString()): Promise<boolean> {
    const rows = await this.db
      .update(patTokens)
      .set({ revoked_at: revokedAt })
      .where(eq(patTokens.id, id))
      .returning({ id: patTokens.id });
    return rows.length > 0;
  }
}
