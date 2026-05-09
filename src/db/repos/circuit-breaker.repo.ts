import { eq } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { pickDefined } from '../helpers.js';
import { circuitBreakerState } from '../schema.drizzle.js';
import type { CircuitBreakerRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const HALF_OPEN_DELAY_MS = 30 * 60 * 1000;

export class CircuitBreakerRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async getState(projectId: string): Promise<CircuitBreakerRow | undefined> {
    const row =
      (
        await this.db
          .select()
          .from(circuitBreakerState)
          .where(eq(circuitBreakerState.project_id, projectId))
          .limit(1)
      )[0] ?? null;
    return row ?? undefined;
  }

  async upsert(projectId: string, data: Partial<CircuitBreakerRow>): Promise<void> {
    const existing = await this.getState(projectId);

    if (existing) {
      const setValues: Partial<typeof circuitBreakerState.$inferInsert> = pickDefined(
        data,
        'failure_count',
        'last_failure_at',
        'opened_at',
        'state',
        'reset_at',
      );

      if (Object.keys(setValues).length > 0) {
        await this.db
          .update(circuitBreakerState)
          .set(setValues)
          .where(eq(circuitBreakerState.project_id, projectId));
      }
    } else {
      await this.db.insert(circuitBreakerState).values({
        project_id: projectId,
        failure_count: data.failure_count ?? 0,
        last_failure_at: data.last_failure_at ?? null,
        opened_at: data.opened_at ?? null,
        state: data.state ?? 'closed',
        reset_at: data.reset_at ?? null,
      });
    }
  }

  async incrementFailure(projectId: string): Promise<CircuitBreakerRow> {
    const existing = await this.getState(projectId);
    const now = Date.now();
    let updated: CircuitBreakerRow | null;

    if (existing) {
      const isOutsideWindow =
        typeof existing.last_failure_at === 'number' &&
        now - existing.last_failure_at > FAILURE_WINDOW_MS;

      updated =
        (
          await this.db
            .update(circuitBreakerState)
            .set({
              failure_count: isOutsideWindow ? 1 : existing.failure_count + 1,
              last_failure_at: now,
            })
            .where(eq(circuitBreakerState.project_id, projectId))
            .returning()
        )[0] ?? null;
    } else {
      updated =
        (
          await this.db
            .insert(circuitBreakerState)
            .values({
              project_id: projectId,
              failure_count: 1,
              last_failure_at: now,
              state: 'closed',
            })
            .returning()
        )[0] ?? null;
    }

    if (!updated) throw new RepoPersistenceError('circuit breaker state', projectId);
    return updated;
  }

  async openBreaker(projectId: string): Promise<void> {
    const openedAt = Date.now();
    await this.db
      .insert(circuitBreakerState)
      .values({
        project_id: projectId,
        state: 'open',
        opened_at: openedAt,
      })
      .onConflictDoUpdate({
        target: circuitBreakerState.project_id,
        set: {
          state: 'open',
          opened_at: openedAt,
        },
      });
  }

  async halfOpen(projectId: string): Promise<void> {
    await this.db
      .insert(circuitBreakerState)
      .values({
        project_id: projectId,
        state: 'half_open',
      })
      .onConflictDoUpdate({
        target: circuitBreakerState.project_id,
        set: {
          state: 'half_open',
        },
      });
  }

  async reset(projectId: string): Promise<void> {
    const resetAt = Date.now();
    await this.db
      .insert(circuitBreakerState)
      .values({
        project_id: projectId,
        state: 'closed',
        failure_count: 0,
        reset_at: resetAt,
      })
      .onConflictDoUpdate({
        target: circuitBreakerState.project_id,
        set: {
          state: 'closed',
          failure_count: 0,
          reset_at: resetAt,
        },
      });
  }

  async findAll(): Promise<CircuitBreakerRow[]> {
    return await this.db.select().from(circuitBreakerState);
  }

  async findAllOpen(): Promise<string[]> {
    const rows = await this.db
      .select({ project_id: circuitBreakerState.project_id })
      .from(circuitBreakerState)
      .where(eq(circuitBreakerState.state, 'open'));
    return rows.map((r) => r.project_id);
  }

  async isOpen(projectId: string): Promise<boolean> {
    const state = await this.getState(projectId);
    if (state?.state === 'open' && typeof state.opened_at === 'number') {
      const now = Date.now();
      if (now - state.opened_at > HALF_OPEN_DELAY_MS) {
        await this.halfOpen(projectId);
        return false;
      }
    }

    return state?.state === 'open';
  }
}
