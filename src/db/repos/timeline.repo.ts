import { desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { timelineEvents } from '../schema.drizzle.js';
import type { TimelineEventRow } from '../types.js';

export class TimelineRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  createTimelineEvent(event: {
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
  }): void {
    this.db
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
      .onConflictDoNothing({ target: timelineEvents.id })
      .run();

    this.sqlite
      .prepare(
        `DELETE FROM timeline_events
         WHERE project_id = ?
           AND id NOT IN (
             SELECT id
             FROM timeline_events
             WHERE project_id = ?
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 200
           )`,
      )
      .run(event.projectId, event.projectId);
  }

  getTimelineEvents(projectId: string, limit = 200): TimelineEventRow[] {
    return this.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.project_id, projectId))
      .orderBy(desc(sql`datetime(${timelineEvents.created_at})`), desc(sql`rowid`))
      .limit(limit)
      .all() as TimelineEventRow[];
  }

  deleteTimelineEvents(projectId: string): void {
    this.db.delete(timelineEvents).where(eq(timelineEvents.project_id, projectId)).run();
  }
}
