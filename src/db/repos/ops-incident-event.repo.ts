import { asc, eq } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { opsIncidentEvents } from '../schema.drizzle.js';
import type { OpsIncidentEventRow } from '../types.js';

export class OpsIncidentEventRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  addEvent(data: {
    id: string;
    incident_id: string;
    event_type: string;
    description: string;
    metadata?: string;
  }): OpsIncidentEventRow {
    this.db
      .insert(opsIncidentEvents)
      .values({
        id: data.id,
        incident_id: data.incident_id,
        event_type: data.event_type as
          | 'detected'
          | 'diagnosed'
          | 'action_taken'
          | 'recovered'
          | 'escalated'
          | 'alert_sent'
          | 'interrupted',
        description: data.description,
        metadata: data.metadata ?? null,
        created_at: Date.now(),
      })
      .run();

    const created = this.db
      .select()
      .from(opsIncidentEvents)
      .where(eq(opsIncidentEvents.id, data.id))
      .get() as OpsIncidentEventRow | undefined;

    if (!created) throw new Error(`Failed to create ops incident event ${data.id}`);
    return created;
  }

  findByIncidentId(incidentId: string): OpsIncidentEventRow[] {
    return this.db
      .select()
      .from(opsIncidentEvents)
      .where(eq(opsIncidentEvents.incident_id, incidentId))
      .orderBy(asc(opsIncidentEvents.created_at))
      .all() as OpsIncidentEventRow[];
  }
}
