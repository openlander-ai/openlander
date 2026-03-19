import { and, eq, isNull, or, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { secretFiles } from '../schema.drizzle.js';

export class SecretFileRepo {
  private readonly db: DrizzleClient;
  private readonly sqlite: SqliteDatabase;

  constructor(db: DrizzleClient, sqlite: SqliteDatabase) {
    this.db = db;
    this.sqlite = sqlite;
    void this.sqlite;
  }

  getSecretFiles(projectId: string | null): Array<{
    id: string;
    project_id: string | null;
    filename: string;
    encrypted_content: string;
    iv: string;
    mount_path: string;
  }> {
    const condition =
      projectId === null ? isNull(secretFiles.project_id) : eq(secretFiles.project_id, projectId);
    return this.db.select().from(secretFiles).where(condition).all();
  }

  getSecretFilesForDeploy(projectId: string): Array<{
    filename: string;
    encrypted_content: string;
    iv: string;
    mount_path: string;
  }> {
    return this.db
      .select({
        filename: secretFiles.filename,
        encrypted_content: secretFiles.encrypted_content,
        iv: secretFiles.iv,
        mount_path: secretFiles.mount_path,
      })
      .from(secretFiles)
      .where(or(eq(secretFiles.project_id, projectId), isNull(secretFiles.project_id)))
      .all();
  }

  upsertSecretFile(
    projectId: string | null,
    filename: string,
    encryptedContent: string,
    iv: string,
    mountPath: string = '/run/secrets',
  ): void {
    this.db
      .insert(secretFiles)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        project_id: projectId,
        filename,
        encrypted_content: encryptedContent,
        iv,
        mount_path: mountPath,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: [secretFiles.project_id, secretFiles.filename],
        set: {
          encrypted_content: encryptedContent,
          iv,
          mount_path: mountPath,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  deleteSecretFile(projectId: string | null, filename: string): boolean {
    const existing = this.db
      .select({ id: secretFiles.id })
      .from(secretFiles)
      .where(
        projectId === null
          ? and(isNull(secretFiles.project_id), eq(secretFiles.filename, filename))
          : and(eq(secretFiles.project_id, projectId), eq(secretFiles.filename, filename)),
      )
      .get();
    if (!existing) return false;
    this.db.delete(secretFiles).where(eq(secretFiles.id, existing.id)).run();
    return true;
  }
}
