import { and, desc, eq, notInArray } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { timelineEvents } from '../schema.drizzle.js';
import type { TimelineEventRow } from '../types.js';

export class TimelineRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createTimelineEvent(event: {
    id: string;
    projectId: string;
    deployId?: string;
    type: string;
    message: string;
    detail?: string;
    severity?: string;
    percent?: number;
    toolName?: string;
    actionButtons?: string;
    createdAt?: string;
  }): Promise<void> {
    await this.db
      .insert(timelineEvents)
      .values({
        id: event.id,
        project_id: event.projectId,
        deploy_id: event.deployId ?? null,
        type: event.type,
        message: event.message,
        detail: event.detail ?? null,
        severity: event.severity ?? null,
        percent: event.percent ?? null,
        tool_name: event.toolName ?? null,
        action_buttons: event.actionButtons ?? null,
        created_at: event.createdAt ?? new Date().toISOString(),
      })
      .onConflictDoNothing({ target: timelineEvents.id });

    const keepIds = (
      await this.db
        .select({ id: timelineEvents.id })
        .from(timelineEvents)
        .where(eq(timelineEvents.project_id, event.projectId))
        .orderBy(desc(timelineEvents.created_at), desc(timelineEvents.id))
        .limit(200)
    ).map((row) => row.id);

    if (keepIds.length > 0) {
      await this.db
        .delete(timelineEvents)
        .where(
          and(
            eq(timelineEvents.project_id, event.projectId),
            notInArray(timelineEvents.id, keepIds),
          ),
        );
    }
  }

  async getTimelineEvents(projectId: string, limit = 200): Promise<TimelineEventRow[]> {
    const rows = await this.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.project_id, projectId))
      .orderBy(desc(timelineEvents.created_at), desc(timelineEvents.id))
      .limit(limit);
    return rows as TimelineEventRow[];
  }

  async deleteTimelineEvents(projectId: string): Promise<void> {
    await this.db.delete(timelineEvents).where(eq(timelineEvents.project_id, projectId));
  }
}
