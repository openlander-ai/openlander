import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { actionRuns } from '../schema.drizzle.js';
import type { ActionRunRow } from '../types.js';

export class ActionRunRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /**
   * Create a new action run with status='running'.
   * Generates UUID and sets started_at timestamp.
   */
  async create(data: {
    projectId: string;
    triggerSource: ActionRunRow['trigger_source'];
    triggerSessionId?: string;
    recoveryStrategy?: ActionRunRow['recovery_strategy'];
    correlationId?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const recoveryStrategy = data.recoveryStrategy === 'unknown' ? null : data.recoveryStrategy;

    await this.db.insert(actionRuns).values({
      id,
      project_id: data.projectId,
      trigger_source: data.triggerSource,
      trigger_session_id: data.triggerSessionId ?? null,
      status: 'running',
      error_message: null,
      recovery_strategy: recoveryStrategy ?? null,
      correlation_id: data.correlationId ?? null,
      steps_json: null,
      started_at: now,
      completed_at: null,
      tenant_id: null,
      user_id: null,
      created_at: now,
    });

    return id;
  }

  async createPendingMcpApproval(data: {
    projectId: string;
    toolName: string;
    plan: string;
    correlationId?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db.insert(actionRuns).values({
      id,
      project_id: data.projectId,
      trigger_source: 'mcp',
      status: 'pending_approval',
      error_message: null,
      recovery_strategy: null,
      correlation_id: data.correlationId ?? null,
      steps_json: null,
      plan: data.plan,
      approval_status: 'pending',
      approval_tool: 'destructive_mcp',
      approval_requested_at: now,
      started_at: now,
      completed_at: null,
      tenant_id: null,
      user_id: null,
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  /**
   * Record a durable, terminal audit entry for a deploy-plan provisioning
   * approval granted synchronously over MCP (execute_deploy_plan with
   * approvals). Unlike the destructive-MCP flow there is no pending window —
   * the agent supplies the approval in the same call — so the row is written
   * already-resolved (approval_status='approved', status='succeeded'). The
   * deploy outcome itself is tracked elsewhere (deploy_logs / timeline); this
   * row exists so approved provisioning is visible in the same approval ledger
   * as destructive_mcp approvals.
   */
  async recordDeployPlanApproval(data: {
    projectId: string;
    plan: string;
    correlationId?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db.insert(actionRuns).values({
      id,
      project_id: data.projectId,
      trigger_source: 'mcp',
      status: 'succeeded',
      error_message: null,
      recovery_strategy: null,
      correlation_id: data.correlationId ?? null,
      steps_json: null,
      plan: data.plan,
      approval_status: 'approved',
      approval_tool: 'deploy_plan',
      approval_requested_at: now,
      approval_resolved_at: now,
      started_at: now,
      completed_at: now,
      tenant_id: null,
      user_id: null,
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  async updateStatus(
    id: string,
    status: 'running' | 'succeeded' | 'failed' | 'pending_approval',
    errorMessage?: string,
  ): Promise<void> {
    const completedAt =
      status === 'succeeded' || status === 'failed' ? new Date().toISOString() : null;

    await this.db
      .update(actionRuns)
      .set({
        status,
        error_message: errorMessage ?? null,
        completed_at: completedAt,
      })
      .where(eq(actionRuns.id, id));
  }

  async updatePlan(id: string, plan: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(actionRuns)
      .set({
        plan,
        updated_at: now,
      })
      .where(eq(actionRuns.id, id));
  }

  async updateStep(id: string, currentStep: number, totalSteps?: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(actionRuns)
      .set({
        current_step: currentStep,
        ...(totalSteps !== undefined ? { total_steps: totalSteps } : {}),
        updated_at: now,
      })
      .where(eq(actionRuns.id, id));
  }

  async updateApproval(
    id: string,
    approvalStatus: 'pending' | 'approved' | 'rejected',
    approvalTool?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const isPending = approvalStatus === 'pending';
    const setValues: Partial<typeof actionRuns.$inferInsert> = {
      approval_status: approvalStatus,
      approval_tool: approvalTool ?? null,
      updated_at: now,
    };

    if (isPending) {
      setValues.approval_requested_at = now;
    } else {
      setValues.approval_resolved_at = now;
    }

    await this.db.update(actionRuns).set(setValues).where(eq(actionRuns.id, id));
  }

  async updateRecoveryStrategy(
    id: string,
    strategy: ActionRunRow['recovery_strategy'],
  ): Promise<void> {
    const normalized = strategy === 'unknown' ? null : strategy;
    await this.db
      .update(actionRuns)
      .set({ recovery_strategy: normalized, updated_at: new Date().toISOString() })
      .where(eq(actionRuns.id, id));
  }

  async findPendingApproval(actionRunId: string): Promise<ActionRunRow | null> {
    const result =
      (
        await this.db
          .select()
          .from(actionRuns)
          .where(and(eq(actionRuns.id, actionRunId), eq(actionRuns.approval_status, 'pending')))
          .limit(1)
      )[0] ?? null;

    return result;
  }

  async findById(id: string): Promise<ActionRunRow | null> {
    const [row] = await this.db.select().from(actionRuns).where(eq(actionRuns.id, id)).limit(1);
    return row ?? null;
  }

  async findByApprovalStatus(
    status: 'pending' | 'approved' | 'rejected',
    limit = 20,
  ): Promise<ActionRunRow[]> {
    const whereClause =
      status === 'pending'
        ? and(
            eq(actionRuns.approval_status, 'pending'),
            eq(actionRuns.status, 'pending_approval'),
            gte(
              actionRuns.approval_requested_at,
              new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            ),
          )
        : eq(actionRuns.approval_status, status);

    const rows = await this.db
      .select()
      .from(actionRuns)
      .where(whereClause)
      .orderBy(desc(actionRuns.created_at))
      .limit(limit);
    return rows;
  }

  /**
   * Find all running action runs for a project.
   */
  async findRunning(projectId: string): Promise<ActionRunRow[]> {
    const rows = await this.db
      .select()
      .from(actionRuns)
      .where(
        and(
          eq(actionRuns.project_id, projectId),
          or(eq(actionRuns.status, 'running'), eq(actionRuns.status, 'pending_approval')),
        ),
      )
      .orderBy(desc(actionRuns.created_at));
    return rows;
  }

  /**
   * Find all action runs for a project, optionally limited.
   */
  async findByProjectId(projectId: string, limit?: number): Promise<ActionRunRow[]> {
    const baseQuery = this.db
      .select()
      .from(actionRuns)
      .where(eq(actionRuns.project_id, projectId))
      .orderBy(desc(actionRuns.created_at));

    const rows = limit ? await baseQuery.limit(limit) : await baseQuery;
    return rows;
  }

  /**
   * Find recent action runs globally, ordered by created_at DESC.
   */
  async findRecent(limit: number): Promise<ActionRunRow[]> {
    const rows = await this.db
      .select()
      .from(actionRuns)
      .orderBy(desc(actionRuns.created_at))
      .limit(limit);
    return rows;
  }

  /**
   * Mark all stale running and pending_approval action runs as failed on startup.
   * Called during Database initialization to clean up incomplete runs from previous sessions.
   * Returns the count of updated rows.
   */
  async markStaleAsFailedOnStartup(): Promise<number> {
    const now = new Date().toISOString();
    const approvedDestructiveRows = await this.db
      .update(actionRuns)
      .set({
        status: 'failed',
        error_message: 'server_restart_during_execute',
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(actionRuns.status, 'pending_approval'),
          eq(actionRuns.approval_status, 'approved'),
          eq(actionRuns.approval_tool, 'destructive_mcp'),
        ),
      )
      .returning({ id: actionRuns.id });

    const staleRows = await this.db
      .update(actionRuns)
      .set({
        status: 'failed',
        error_message: 'Server restarted',
        completed_at: now,
        updated_at: now,
      })
      .where(inArray(actionRuns.status, ['running', 'pending_approval']))
      .returning({ id: actionRuns.id });

    await this.db
      .update(actionRuns)
      .set({
        approval_status: 'rejected',
        approval_resolved_at: now,
        updated_at: now,
      })
      .where(eq(actionRuns.approval_status, 'pending'));

    return staleRows.length + approvedDestructiveRows.length;
  }
}
