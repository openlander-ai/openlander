import { eq } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { pickDefined } from '../helpers.js';
import { circuitBreakerState } from '../schema.drizzle.js';
import type { CircuitBreakerRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HALF_OPEN_DELAY_MS = 30 * 60 * 1000;

export class CircuitBreakerRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  getState(projectId: string): CircuitBreakerRow | undefined {
    return this.db
      .select()
      .from(circuitBreakerState)
      .where(eq(circuitBreakerState.project_id, projectId))
      .get() as CircuitBreakerRow | undefined;
  }

  upsert(projectId: string, data: Partial<CircuitBreakerRow>): void {
    const existing = this.getState(projectId);

    if (existing) {
      const setValues = pickDefined(
        data,
        'failure_count',
        'last_failure_at',
        'opened_at',
        'state',
        'reset_at',
      );

      if (Object.keys(setValues).length > 0) {
        this.db
          .update(circuitBreakerState)
          .set(setValues)
          .where(eq(circuitBreakerState.project_id, projectId))
          .run();
      }
    } else {
      this.db
        .insert(circuitBreakerState)
        .values({
          project_id: projectId,
          failure_count: data.failure_count ?? 0,
          last_failure_at: data.last_failure_at ?? null,
          opened_at: data.opened_at ?? null,
          state: data.state ?? 'closed',
          reset_at: data.reset_at ?? null,
        })
        .run();
    }
  }

  incrementFailure(projectId: string): CircuitBreakerRow {
    const existing = this.getState(projectId);
    const now = Date.now();

    if (existing) {
      const isOutsideWindow =
        typeof existing.last_failure_at === 'number' &&
        now - existing.last_failure_at > FAILURE_WINDOW_MS;

      this.db
        .update(circuitBreakerState)
        .set({
          failure_count: isOutsideWindow ? 1 : existing.failure_count + 1,
          last_failure_at: now,
        })
        .where(eq(circuitBreakerState.project_id, projectId))
        .run();
    } else {
      this.db
        .insert(circuitBreakerState)
        .values({
          project_id: projectId,
          failure_count: 1,
          last_failure_at: now,
          state: 'closed',
        })
        .run();
    }

    const updated = this.getState(projectId);
    if (!updated) throw new RepoPersistenceError('circuit breaker state', projectId);
    return updated;
  }

  openBreaker(projectId: string): void {
    const existing = this.getState(projectId);

    if (existing) {
      this.db
        .update(circuitBreakerState)
        .set({
          state: 'open',
          opened_at: Date.now(),
        })
        .where(eq(circuitBreakerState.project_id, projectId))
        .run();
    } else {
      this.db
        .insert(circuitBreakerState)
        .values({
          project_id: projectId,
          state: 'open',
          opened_at: Date.now(),
        })
        .run();
    }
  }

  halfOpen(projectId: string): void {
    const existing = this.getState(projectId);

    if (existing) {
      this.db
        .update(circuitBreakerState)
        .set({
          state: 'half_open',
        })
        .where(eq(circuitBreakerState.project_id, projectId))
        .run();
    } else {
      this.db
        .insert(circuitBreakerState)
        .values({
          project_id: projectId,
          state: 'half_open',
        })
        .run();
    }
  }

  reset(projectId: string): void {
    const existing = this.getState(projectId);

    if (existing) {
      this.db
        .update(circuitBreakerState)
        .set({
          state: 'closed',
          failure_count: 0,
          reset_at: Date.now(),
        })
        .where(eq(circuitBreakerState.project_id, projectId))
        .run();
    } else {
      this.db
        .insert(circuitBreakerState)
        .values({
          project_id: projectId,
          state: 'closed',
          failure_count: 0,
          reset_at: Date.now(),
        })
        .run();
    }
  }

  findAll(): CircuitBreakerRow[] {
    return this.db.select().from(circuitBreakerState).all() as CircuitBreakerRow[];
  }

  findAllOpen(): string[] {
    const rows = this.db
      .select({ project_id: circuitBreakerState.project_id })
      .from(circuitBreakerState)
      .where(eq(circuitBreakerState.state, 'open'))
      .all();
    return rows.map((r) => r.project_id);
  }

  isOpen(projectId: string): boolean {
    const state = this.getState(projectId);
    if (state?.state === 'open' && typeof state.opened_at === 'number') {
      const now = Date.now();
      if (now - state.opened_at > HALF_OPEN_DELAY_MS) {
        this.halfOpen(projectId);
        return false;
      }
    }

    return state?.state === 'open';
  }
}
