import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { secretFiles } from '../schema.drizzle.js';

export class SecretFileRepo {
  private readonly db: DrizzleClient;
  private readonly client: PostgresClient;

  constructor(db: DrizzleClient, client: PostgresClient) {
    this.db = db;
    this.client = client;
    void this.client;
  }

  async getSecretFiles(projectId: string | null): Promise<
    Array<{
      id: string;
      project_id: string | null;
      filename: string;
      encrypted_content: string;
      iv: string;
      mount_path: string;
    }>
  > {
    const condition =
      projectId === null ? isNull(secretFiles.project_id) : eq(secretFiles.project_id, projectId);
    return await this.db.select().from(secretFiles).where(condition);
  }

  async getSecretFilesForDeploy(projectId: string): Promise<
    Array<{
      filename: string;
      encrypted_content: string;
      iv: string;
      mount_path: string;
    }>
  > {
    return await this.db
      .select({
        filename: secretFiles.filename,
        encrypted_content: secretFiles.encrypted_content,
        iv: secretFiles.iv,
        mount_path: secretFiles.mount_path,
      })
      .from(secretFiles)
      .where(or(eq(secretFiles.project_id, projectId), isNull(secretFiles.project_id)));
  }

  async upsertSecretFile(
    projectId: string | null,
    filename: string,
    encryptedContent: string,
    iv: string,
    mountPath: string = '/run/secrets',
  ): Promise<void> {
    const whereClause =
      projectId === null
        ? and(isNull(secretFiles.project_id), eq(secretFiles.filename, filename))
        : and(eq(secretFiles.project_id, projectId), eq(secretFiles.filename, filename));
    const [selected] = await this.db
      .select({ id: secretFiles.id })
      .from(secretFiles)
      .where(whereClause)
      .limit(1);
    const existing = selected ?? null;

    if (existing) {
      await this.db
        .update(secretFiles)
        .set({
          encrypted_content: encryptedContent,
          iv,
          mount_path: mountPath,
          updated_at: sql`now()::text`,
        })
        .where(eq(secretFiles.id, existing.id));
      return;
    }

    await this.db.insert(secretFiles).values({
      id: crypto.randomUUID(),
      project_id: projectId,
      filename,
      encrypted_content: encryptedContent,
      iv,
      mount_path: mountPath,
      updated_at: sql`now()::text`,
    });
  }

  async deleteSecretFile(projectId: string | null, filename: string): Promise<boolean> {
    const whereClause =
      projectId === null
        ? and(isNull(secretFiles.project_id), eq(secretFiles.filename, filename))
        : and(eq(secretFiles.project_id, projectId), eq(secretFiles.filename, filename));
    const deleted = await this.db
      .delete(secretFiles)
      .where(whereClause)
      .returning({ id: secretFiles.id });
    return deleted.length > 0;
  }
}
