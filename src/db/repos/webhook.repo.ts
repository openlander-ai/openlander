import { and, eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { webhookConfigs } from '../schema.drizzle.js';
import type { WebhookConfigRow } from '../types.js';

export class WebhookRepo {
  constructor(
    private readonly db: DrizzleClient,
    _sqlite: SqliteDatabase,
  ) {
    void _sqlite;
  }

  getWebhookConfig(
    projectId: string,
    source: WebhookConfigRow['source'],
  ): WebhookConfigRow | undefined {
    return this.db
      .select()
      .from(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)))
      .limit(1)
      .get() as WebhookConfigRow | undefined;
  }

  setWebhookConfig(config: {
    id: string;
    projectId: string;
    source: WebhookConfigRow['source'];
    secret: string;
    branchFilter?: string;
    enabled?: boolean;
  }): void {
    this.db
      .insert(webhookConfigs)
      .values({
        id: config.id,
        project_id: config.projectId,
        source: config.source,
        secret: config.secret,
        branch_filter: config.branchFilter ?? 'main',
        enabled: config.enabled === false ? 0 : 1,
      })
      .onConflictDoUpdate({
        target: [webhookConfigs.project_id, webhookConfigs.source],
        set: {
          secret: config.secret,
          branch_filter: config.branchFilter ?? 'main',
          enabled: config.enabled === false ? 0 : 1,
        },
      })
      .run();
  }

  setWebhookEnabled(id: string, enabled: boolean): void {
    this.db
      .update(webhookConfigs)
      .set({ enabled: enabled ? 1 : 0 })
      .where(eq(webhookConfigs.id, id))
      .run();
  }

  getWebhookConfigs(projectId: string): WebhookConfigRow[] {
    return this.db
      .select()
      .from(webhookConfigs)
      .where(eq(webhookConfigs.project_id, projectId))
      .all() as WebhookConfigRow[];
  }

  deleteWebhookConfig(projectId: string, source: WebhookConfigRow['source']): void {
    this.db
      .delete(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)))
      .run();
  }
}
