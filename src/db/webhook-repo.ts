import { BaseRepository } from './base-repo.js';
import type { WebhookConfigRow } from './types.js';

export interface SetWebhookConfigInput {
  id: string;
  projectId: string;
  source: WebhookConfigRow['source'];
  secret: string;
  branchFilter?: string;
  enabled?: boolean;
}

export class WebhookConfigRepository extends BaseRepository {
  getWebhookConfig(
    projectId: string,
    source: WebhookConfigRow['source'],
  ): WebhookConfigRow | undefined {
    return this.db
      .prepare('SELECT * FROM webhook_configs WHERE project_id = ? AND source = ? LIMIT 1')
      .get(projectId, source) as WebhookConfigRow | undefined;
  }

  setWebhookConfig(config: SetWebhookConfigInput): void {
    this.db
      .prepare(
        `INSERT INTO webhook_configs (id, project_id, source, secret, branch_filter, enabled)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, source) DO UPDATE SET
           secret = excluded.secret,
           branch_filter = excluded.branch_filter,
           enabled = excluded.enabled`,
      )
      .run(
        config.id,
        config.projectId,
        config.source,
        config.secret,
        config.branchFilter ?? 'main',
        config.enabled === false ? 0 : 1,
      );
  }

  setWebhookEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE webhook_configs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }
}
