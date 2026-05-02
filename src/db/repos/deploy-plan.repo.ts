import { desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { deployPlans } from '../schema.drizzle.js';
import type { DeployPlanRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

export class DeployPlanRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createDeployPlan(plan: {
    id: string;
    projectName?: string;
    projectId?: string;
    status: string;
    complexity?: string;
    planJson: string;
    commitSha?: string;
  }): Promise<DeployPlanRow> {
    const [created] = await this.db
      .insert(deployPlans)
      .values({
        id: plan.id,
        project_name: plan.projectName ?? null,
        project_id: plan.projectId ?? null,
        status: plan.status,
        complexity: plan.complexity ?? null,
        plan_json: plan.planJson,
        commit_sha: plan.commitSha ?? null,
      })
      .returning();

    if (!created) throw new RepoPersistenceError('deploy plan', plan.id);
    return created as DeployPlanRow;
  }

  async getDeployPlan(planId: string): Promise<DeployPlanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(deployPlans)
      .where(eq(deployPlans.id, planId))
      .limit(1);
    return (row as DeployPlanRow | undefined) ?? undefined;
  }

  async updateDeployPlan(
    planId: string,
    updates: Partial<{
      status: string;
      complexity: string | null;
      errorMessage: string | null;
      executedAt: string | null;
      completedAt: string | null;
      planJson: string;
      projectName: string | null;
      projectId: string | null;
    }>,
  ): Promise<void> {
    const setValues: Partial<typeof deployPlans.$inferInsert> = {};

    if (updates.status !== undefined) setValues.status = updates.status;
    if (updates.complexity !== undefined) setValues.complexity = updates.complexity;
    if (updates.errorMessage !== undefined) setValues.error_message = updates.errorMessage;
    if (updates.executedAt !== undefined) setValues.executed_at = updates.executedAt;
    if (updates.completedAt !== undefined) setValues.completed_at = updates.completedAt;
    if (updates.planJson !== undefined) setValues.plan_json = updates.planJson;
    if (updates.projectName !== undefined) setValues.project_name = updates.projectName;
    if (updates.projectId !== undefined) setValues.project_id = updates.projectId;

    if (Object.keys(setValues).length === 0) return;

    await this.db
      .update(deployPlans)
      .set({ ...setValues, updated_at: sql`now()::text` })
      .where(eq(deployPlans.id, planId));
  }

  async updateDeployPlanStatus(planId: string, status: string): Promise<void> {
    await this.db
      .update(deployPlans)
      .set({ status, updated_at: sql`now()::text` })
      .where(eq(deployPlans.id, planId));
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  async listDeployPlans(projectName?: string, _serverId?: string): Promise<DeployPlanRow[]> {
    if (projectName) {
      const rows = await this.db
        .select()
        .from(deployPlans)
        .where(eq(deployPlans.project_name, projectName))
        .orderBy(desc(deployPlans.created_at), desc(deployPlans.id));
      return rows as DeployPlanRow[];
    }
    const rows = await this.db
      .select()
      .from(deployPlans)
      .orderBy(desc(deployPlans.created_at), desc(deployPlans.id));
    return rows as DeployPlanRow[];
  }

  async getLatestPlanForProject(projectName: string): Promise<DeployPlanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(deployPlans)
      .where(eq(deployPlans.project_name, projectName))
      .orderBy(desc(deployPlans.created_at), desc(deployPlans.id))
      .limit(1);
    return (row as DeployPlanRow | undefined) ?? undefined;
  }
}
