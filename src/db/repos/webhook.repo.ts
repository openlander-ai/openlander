import { and, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { webhookConfigs } from '../schema.drizzle.js';
import type { WebhookConfigRow } from '../types.js';

type WebhookConfigSelect = typeof webhookConfigs.$inferSelect;

function toWebhookConfigRow(row: WebhookConfigSelect): WebhookConfigRow {
  return {
    ...row,
    branch_filter: row.branch_filter ?? 'main',
    enabled: row.enabled === 0 ? 0 : 1,
    created_at: row.created_at ?? '',
  };
}

export class WebhookRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async getWebhookConfig(
    projectId: string,
    source: WebhookConfigRow['source'],
  ): Promise<WebhookConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)))
      .limit(1);
    return row ? toWebhookConfigRow(row) : null;
  }

  async setWebhookConfig(config: {
    id: string;
    projectId: string;
    source: WebhookConfigRow['source'];
    secret: string;
    branchFilter?: string;
    enabled?: boolean;
  }): Promise<void> {
    await this.db
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
      });
  }

  async setWebhookEnabled(id: string, enabled: boolean): Promise<void> {
    await this.db
      .update(webhookConfigs)
      .set({ enabled: enabled ? 1 : 0 })
      .where(eq(webhookConfigs.id, id));
  }

  async getWebhookConfigs(projectId: string): Promise<WebhookConfigRow[]> {
    const rows = await this.db
      .select()
      .from(webhookConfigs)
      .where(eq(webhookConfigs.project_id, projectId));
    return rows.map(toWebhookConfigRow);
  }

  async deleteWebhookConfig(projectId: string, source: WebhookConfigRow['source']): Promise<void> {
    await this.db
      .delete(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)));
  }
}
