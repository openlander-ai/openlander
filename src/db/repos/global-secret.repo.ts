import { asc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { globalSecrets } from '../schema.drizzle.js';

export class GlobalSecretRepo {
  private readonly db: DrizzleClient;
  private readonly sqlite: SqliteDatabase;

  constructor(db: DrizzleClient, sqlite: SqliteDatabase) {
    this.db = db;
    this.sqlite = sqlite;
    void this.sqlite;
  }

  getGlobalSecrets(): Array<{
    id: string;
    key: string;
    encrypted_value: string;
    iv: string;
    description: string | null;
    created_at: string | null;
    updated_at: string | null;
  }> {
    return this.db.select().from(globalSecrets).orderBy(asc(globalSecrets.key)).all();
  }

  getGlobalSecret(key: string):
    | {
        id: string;
        key: string;
        encrypted_value: string;
        iv: string;
        description: string | null;
      }
    | undefined {
    return this.db.select().from(globalSecrets).where(eq(globalSecrets.key, key)).get();
  }

  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string): void {
    this.db
      .insert(globalSecrets)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        key,
        encrypted_value: encryptedValue,
        iv,
        description: description ?? null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: globalSecrets.key,
        set: {
          encrypted_value: encryptedValue,
          iv,
          description: description ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  deleteGlobalSecret(key: string): boolean {
    const existing = this.getGlobalSecret(key);
    if (!existing) return false;
    this.db.delete(globalSecrets).where(eq(globalSecrets.key, key)).run();
    return true;
  }
}
