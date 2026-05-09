import { asc, eq, inArray } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { opsIncidentEvents } from '../schema.drizzle.js';
import type { OpsIncidentEventRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

export class OpsIncidentEventRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async addEvent(data: {
    id: string;
    incident_id: string;
    event_type: string;
    description: string;
    metadata?: string;
  }): Promise<OpsIncidentEventRow> {
    const created =
      (
        await this.db
          .insert(opsIncidentEvents)
          .values({
            id: data.id,
            incident_id: data.incident_id,
            event_type: data.event_type as OpsIncidentEventRow['event_type'],
            description: data.description,
            metadata: data.metadata ?? null,
            created_at: Date.now(),
          })
          .returning()
      )[0] ?? null;

    if (!created) throw new RepoPersistenceError('ops incident event', data.id);
    return created;
  }

  async findByIncidentId(incidentId: string): Promise<OpsIncidentEventRow[]> {
    return await this.db
      .select()
      .from(opsIncidentEvents)
      .where(eq(opsIncidentEvents.incident_id, incidentId))
      .orderBy(asc(opsIncidentEvents.created_at));
  }

  async findByIncidentIds(incidentIds: string[]): Promise<OpsIncidentEventRow[]> {
    if (incidentIds.length === 0) return [];
    return await this.db
      .select()
      .from(opsIncidentEvents)
      .where(inArray(opsIncidentEvents.incident_id, incidentIds))
      .orderBy(asc(opsIncidentEvents.created_at));
  }
}
