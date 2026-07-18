import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { gitCredentials, services } from '../schema.drizzle.js';
import type { GitCredentialRow, GitCredentialServiceUsage, GitCredentialStatus } from '../types.js';

export interface CreateGitCredentialInput {
  id: string;
  name: string;
  repositoryUrl: string;
  repositoryKey: string;
  publicKey: string;
  fingerprint: string;
  encryptedPrivateKey: string;
  privateKeyIv: string;
}

export class GitCredentialRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(input: CreateGitCredentialInput): Promise<GitCredentialRow> {
    const [row] = await this.db
      .insert(gitCredentials)
      .values({
        id: input.id,
        name: input.name,
        repository_url: input.repositoryUrl,
        repository_key: input.repositoryKey,
        public_key: input.publicKey,
        fingerprint: input.fingerprint,
        encrypted_private_key: input.encryptedPrivateKey,
        private_key_iv: input.privateKeyIv,
      })
      .returning();
    return row as GitCredentialRow;
  }

  async getById(id: string): Promise<GitCredentialRow | null> {
    const [row] = await this.db
      .select()
      .from(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(filters?: {
    repositoryKey?: string;
    status?: GitCredentialStatus;
  }): Promise<GitCredentialRow[]> {
    const conditions = [
      ...(filters?.repositoryKey ? [eq(gitCredentials.repository_key, filters.repositoryKey)] : []),
      ...(filters?.status ? [eq(gitCredentials.status, filters.status)] : []),
    ];
    const query = this.db.select().from(gitCredentials);
    const rows =
      conditions.length === 0
        ? await query.orderBy(asc(gitCredentials.name), asc(gitCredentials.created_at))
        : await query
            .where(and(...conditions))
            .orderBy(asc(gitCredentials.name), asc(gitCredentials.created_at));
    return rows;
  }

  async setVerification(
    id: string,
    result: {
      status: 'verified' | 'failed';
      defaultBranch?: string | null;
      lastErrorCode?: string | null;
    },
  ): Promise<GitCredentialRow | null> {
    const now = new Date().toISOString();
    const [row] = await this.db
      .update(gitCredentials)
      .set({
        status: result.status,
        default_branch: result.defaultBranch ?? null,
        last_error_code: result.lastErrorCode ?? null,
        verified_at: result.status === 'verified' ? now : null,
        updated_at: now,
      })
      .where(eq(gitCredentials.id, id))
      .returning();
    return row ?? null;
  }

  async markUsed(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(gitCredentials)
      .set({ last_used_at: now, updated_at: now })
      .where(eq(gitCredentials.id, id));
  }

  async listUsages(ids: readonly string[]): Promise<Map<string, GitCredentialServiceUsage[]>> {
    const result = new Map<string, GitCredentialServiceUsage[]>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({
        credential_id: services.git_credential_id,
        service_id: services.id,
        service_name: services.name,
        project_id: services.project_id,
      })
      .from(services)
      .where(inArray(services.git_credential_id, [...ids]));
    for (const row of rows) {
      if (!row.credential_id) continue;
      const usages = result.get(row.credential_id) ?? [];
      usages.push({
        service_id: row.service_id,
        service_name: row.service_name,
        project_id: row.project_id,
      });
      result.set(row.credential_id, usages);
    }
    return result;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(gitCredentials)
      .where(eq(gitCredentials.id, id))
      .returning({ id: gitCredentials.id });
    return deleted.length > 0;
  }

  async countForRepository(repositoryKey: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::integer` })
      .from(gitCredentials)
      .where(eq(gitCredentials.repository_key, repositoryKey));
    return row?.count ?? 0;
  }
}
