import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { actionRuns } from '../schema.drizzle.js';
import type { ActionRunRow } from '../types.js';

export class ActionRunRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  /**
   * Create a new action run with status='running'.
   * Generates UUID and sets started_at timestamp.
   */
  create(data: {
    projectId: string;
    triggerSource: ActionRunRow['trigger_source'];
    triggerSessionId?: string;
    recoveryStrategy?: ActionRunRow['recovery_strategy'];
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .insert(actionRuns)
      .values({
        id,
        project_id: data.projectId,
        trigger_source: data.triggerSource,
        trigger_session_id: data.triggerSessionId ?? null,
        status: 'running',
        error_message: null,
        recovery_strategy: data.recoveryStrategy ?? null,
        steps_json: null,
        started_at: now,
        completed_at: null,
        tenant_id: null,
        user_id: null,
        created_at: now,
      })
      .run();

    return id;
  }

  updateStatus(
    id: string,
    status: 'running' | 'succeeded' | 'failed' | 'pending_approval',
    errorMessage?: string,
  ): void {
    const completedAt =
      status === 'succeeded' || status === 'failed' ? new Date().toISOString() : null;

    this.db
      .update(actionRuns)
      .set({
        status,
        error_message: errorMessage ?? null,
        completed_at: completedAt,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updatePlan(id: string, plan: string): void {
    const now = new Date().toISOString();
    this.db
      .update(actionRuns)
      .set({
        plan,
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updateStep(id: string, currentStep: number, totalSteps?: number): void {
    const now = new Date().toISOString();
    this.db
      .update(actionRuns)
      .set({
        current_step: currentStep,
        ...(totalSteps !== undefined ? { total_steps: totalSteps } : {}),
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  updateApproval(
    id: string,
    approvalStatus: 'pending' | 'approved' | 'rejected',
    approvalTool?: string,
  ): void {
    const now = new Date().toISOString();
    const isPending = approvalStatus === 'pending';

    this.db
      .update(actionRuns)
      .set({
        approval_status: approvalStatus,
        approval_tool: approvalTool ?? null,
        approval_requested_at: isPending ? now : undefined,
        approval_resolved_at: isPending ? undefined : now,
        updated_at: now,
      })
      .where(eq(actionRuns.id, id))
      .run();
  }

  findPendingApproval(actionRunId: string): ActionRunRow | null {
    const result = this.db
      .select()
      .from(actionRuns)
      .where(and(eq(actionRuns.id, actionRunId), eq(actionRuns.approval_status, 'pending')))
      .get();

    return (result as ActionRunRow | undefined) ?? null;
  }

  findByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit = 20): ActionRunRow[] {
    return this.db
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.approval_status, status))
      .orderBy(desc(actionRuns.created_at))
      .limit(limit)
      .all() as ActionRunRow[];
  }

  /**
   * Find all running action runs for a project.
   */
  findRunning(projectId: string): ActionRunRow[] {
    return this.db
      .select()
      .from(actionRuns)
      .where(
        and(
          eq(actionRuns.project_id, projectId),
          or(eq(actionRuns.status, 'running'), eq(actionRuns.status, 'pending_approval')),
        ),
      )
      .orderBy(desc(actionRuns.created_at))
      .all() as ActionRunRow[];
  }

  /**
   * Find all action runs for a project, optionally limited.
   */
  findByProjectId(projectId: string, limit?: number): ActionRunRow[] {
    const baseQuery = this.db
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.project_id, projectId))
      .orderBy(desc(actionRuns.created_at));

    if (limit) {
      return baseQuery.limit(limit).all() as ActionRunRow[];
    }

    return baseQuery.all() as ActionRunRow[];
  }

  /**
   * Mark all stale running and pending_approval action runs as failed on startup.
   * Called during Database initialization to clean up incomplete runs from previous sessions.
   * Returns the count of updated rows.
   */
  markStaleAsFailedOnStartup(): number {
    this.db
      .update(actionRuns)
      .set({
        status: 'failed',
        error_message: 'Server restarted',
        completed_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(sql`${actionRuns.status} IN ('running', 'pending_approval')`)
      .run();

    const row = this.sqlite.prepare('SELECT changes() as changes').get() as {
      changes: number;
    } | null;
    return row?.changes ?? 0;
  }
}
