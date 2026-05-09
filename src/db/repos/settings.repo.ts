import { eq, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { settings } from '../schema.drizzle.js';

/**
 * Phase E_NEW Task 7 — single-row generic key/value config store.
 * The value is opaque JSON text; callers parse against their own
 * schema. Today: notifications webhook (key `notification_webhook`).
 */
export class SettingsRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async getSetting(key: string): Promise<{ value: string } | null> {
    const [row] = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return row ?? null;
  }

  async upsertSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({
        key,
        value,
        updated_at: sql`now()::text`,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value,
          updated_at: sql`now()::text`,
        },
      });
  }

  /**
   * Idempotent — deleting a non-existent key returns false but is not
   * an error. Callers can treat the route as 200 in either case (the
   * notifications webhook DELETE is contract-idempotent).
   */
  async deleteSetting(key: string): Promise<boolean> {
    const deleted = await this.db
      .delete(settings)
      .where(eq(settings.key, key))
      .returning({ key: settings.key });
    return deleted.length > 0;
  }
}
