import { and, asc, between, desc, eq, gt, lt, type SQL } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { activityLog } from '../schema.drizzle.js';
import type { ActivityLogRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

// ── Inline ULID generator (Crockford Base32, 26 chars, monotonic) ──
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = 0;
let lastRandom: number[] = [];

export function ulid(): string {
  const now = Date.now();
  // 10-char timestamp (ms since epoch, Crockford Base32, big-endian)
  let ts = now;
  const timePart = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    timePart[i] = CROCKFORD[ts & 0x1f] ?? '0';
    ts = Math.floor(ts / 32);
  }

  // 16-char random component — monotonic within same millisecond
  const randPart = new Array<string>(16);
  if (now === lastTime && lastRandom.length === 16) {
    // Increment the previous random part by 1 (big-endian carry)
    const prev = [...lastRandom];
    for (let i = 15; i >= 0; i--) {
      prev[i] = ((prev[i] ?? 0) + 1) % 32;
      if (prev[i] !== 0) break; // no carry needed
    }
    lastRandom = prev;
  } else {
    lastTime = now;
    lastRandom = [];
    for (let i = 0; i < 16; i++) {
      lastRandom.push(Math.floor(Math.random() * 32));
    }
  }
  for (let i = 0; i < 16; i++) {
    randPart[i] = CROCKFORD[lastRandom[i] ?? 0] ?? '0';
  }
  return timePart.join('') + randPart.join('');
}

export class ActivityLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async insert(entry: {
    event_type: string;
    activity_type: string;
    severity: string;
    project_id: string;
    correlation_id?: string | null;
    title: string;
    description: string;
    status: string;
    metadata?: string;
    created_at?: string;
  }): Promise<ActivityLogRow> {
    const id = ulid();
    const now = entry.created_at ?? new Date().toISOString();

    const created =
      (
        await this.db
          .insert(activityLog)
          .values({
            id,
            event_type: entry.event_type,
            activity_type: entry.activity_type,
            severity: entry.severity,
            project_id: entry.project_id,
            correlation_id: entry.correlation_id ?? null,
            title: entry.title,
            description: entry.description,
            status: entry.status,
            metadata: entry.metadata ?? '{}',
            created_at: now,
          })
          .returning()
      )[0] ?? null;

    if (!created) throw new RepoPersistenceError('activity log entry', id);
    return created;
  }

  async findSince(lastUlid: string, limit = 50): Promise<ActivityLogRow[]> {
    return await this.db
      .select()
      .from(activityLog)
      .where(gt(activityLog.id, lastUlid))
      .orderBy(asc(activityLog.id))
      .limit(limit);
  }

  async findByDateRange(
    from: string,
    to: string,
    filters?: { project_id?: string; activity_type?: string },
    cursor?: string,
    limit = 50,
  ): Promise<ActivityLogRow[]> {
    const conditions: SQL[] = [between(activityLog.created_at, from, to)];

    if (filters?.project_id) {
      conditions.push(eq(activityLog.project_id, filters.project_id));
    }
    if (filters?.activity_type) {
      conditions.push(eq(activityLog.activity_type, filters.activity_type));
    }
    if (cursor) {
      conditions.push(gt(activityLog.id, cursor));
    }

    return await this.db
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(asc(activityLog.id))
      .limit(limit);
  }

  /** Find recent activity log entries with optional filters (newest first). */
  async findRecent(
    limit = 50,
    filters?: {
      project_id?: string;
      activity_type?: string;
      severity?: string;
      correlation_id?: string;
    },
  ): Promise<ActivityLogRow[]> {
    const conditions: SQL[] = [];
    if (filters?.project_id) {
      conditions.push(eq(activityLog.project_id, filters.project_id));
    }
    if (filters?.activity_type) {
      conditions.push(eq(activityLog.activity_type, filters.activity_type));
    }
    if (filters?.severity) {
      conditions.push(eq(activityLog.severity, filters.severity));
    }
    if (filters?.correlation_id) {
      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
    }

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(activityLog)
            .where(and(...conditions))
            .orderBy(desc(activityLog.id))
            .limit(limit)
        : await this.db.select().from(activityLog).orderBy(desc(activityLog.id)).limit(limit);

    return rows.reverse();
  }

  /** Find entries since a ULID cursor with optional filters (ascending order). */
  async findSinceFiltered(
    lastUlid: string,
    limit = 50,
    filters?: {
      project_id?: string;
      activity_type?: string;
      severity?: string;
      correlation_id?: string;
    },
  ): Promise<ActivityLogRow[]> {
    const conditions: SQL[] = [gt(activityLog.id, lastUlid)];
    if (filters?.project_id) {
      conditions.push(eq(activityLog.project_id, filters.project_id));
    }
    if (filters?.activity_type) {
      conditions.push(eq(activityLog.activity_type, filters.activity_type));
    }
    if (filters?.severity) {
      conditions.push(eq(activityLog.severity, filters.severity));
    }
    if (filters?.correlation_id) {
      conditions.push(eq(activityLog.correlation_id, filters.correlation_id));
    }

    return await this.db
      .select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(asc(activityLog.id))
      .limit(limit);
  }

  async deleteOlderThan(isoDate: string): Promise<number> {
    const deleted = await this.db
      .delete(activityLog)
      .where(lt(activityLog.created_at, isoDate))
      .returning({ id: activityLog.id });
    return deleted.length;
  }
}
