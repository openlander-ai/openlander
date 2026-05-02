import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { globalSecrets } from '../schema.drizzle.js';

type GlobalSecretRow = typeof globalSecrets.$inferSelect;

export class GlobalSecretRepo {
  private readonly db: DrizzleClient;
  private readonly client: PostgresClient;

  constructor(db: DrizzleClient, client: PostgresClient) {
    this.db = db;
    this.client = client;
    void this.client;
  }

  async getGlobalSecrets(): Promise<GlobalSecretRow[]> {
    return this.db.select().from(globalSecrets).orderBy(asc(globalSecrets.key));
  }

  async getGlobalSecret(key: string): Promise<GlobalSecretRow | null> {
    const [row] = await this.db
      .select()
      .from(globalSecrets)
      .where(eq(globalSecrets.key, key))
      .limit(1);
    return row ?? null;
  }

  async setGlobalSecret(
    key: string,
    encryptedValue: string,
    iv: string,
    description?: string,
  ): Promise<void> {
    await this.db
      .insert(globalSecrets)
      .values({
        id: randomUUID(),
        key,
        encrypted_value: encryptedValue,
        iv,
        description: description ?? null,
        updated_at: sql`now()::text`,
      })
      .onConflictDoUpdate({
        target: globalSecrets.key,
        set: {
          encrypted_value: encryptedValue,
          iv,
          description: description ?? null,
          updated_at: sql`now()::text`,
        },
      });
  }

  async deleteGlobalSecret(key: string): Promise<boolean> {
    const deleted = await this.db
      .delete(globalSecrets)
      .where(eq(globalSecrets.key, key))
      .returning({ key: globalSecrets.key });
    return deleted.length > 0;
  }
}
