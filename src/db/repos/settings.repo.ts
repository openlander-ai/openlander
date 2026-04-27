import { eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { settings } from '../schema.drizzle.js';

/**
 * Phase E_NEW Task 7 — single-row generic key/value config store.
 * The value is opaque JSON text; callers parse against their own
 * schema. Today: notifications webhook (key `notification_webhook`).
 */
export class SettingsRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  getSetting(key: string): { value: string } | undefined {
    const row = this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row ?? undefined;
  }

  upsertSetting(key: string, value: string): void {
    this.db
      .insert(settings)
      .values({
        key,
        value,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  /**
   * Idempotent — deleting a non-existent key returns false but is not
   * an error. Callers can treat the route as 200 in either case (the
   * notifications webhook DELETE is contract-idempotent).
   */
  deleteSetting(key: string): boolean {
    const result = this.db.delete(settings).where(eq(settings.key, key)).run() as
      | { changes?: number }
      | undefined;
    return (result?.changes ?? 0) > 0;
  }
}
