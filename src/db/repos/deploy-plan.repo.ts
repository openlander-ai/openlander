import { desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { buildSetValues } from '../helpers.js';
import { deployPlans } from '../schema.drizzle.js';
import type { DeployPlanRow } from '../types.js';

export class DeployPlanRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createDeployPlan(plan: {
    id: string;
    projectName?: string;
    projectId?: string;
    status: string;
    complexity?: string;
    planJson: string;
    commitSha?: string;
  }): DeployPlanRow {
    this.db
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
      .run();

    const created = this.getDeployPlan(plan.id);
    if (!created) throw new Error(`Failed to create deploy plan ${plan.id}`);
    return created;
  }

  getDeployPlan(planId: string): DeployPlanRow | undefined {
    return this.db.select().from(deployPlans).where(eq(deployPlans.id, planId)).get() as
      | DeployPlanRow
      | undefined;
  }

  updateDeployPlan(
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
  ): void {
    const setValues = buildSetValues(updates, {
      status: 'status',
      complexity: 'complexity',
      errorMessage: 'error_message',
      executedAt: 'executed_at',
      completedAt: 'completed_at',
      planJson: 'plan_json',
      projectName: 'project_name',
      projectId: 'project_id',
    });

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(deployPlans)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(deployPlans.id, planId))
      .run();
  }

  updateDeployPlanStatus(planId: string, status: string): void {
    this.db
      .update(deployPlans)
      .set({ status, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(deployPlans.id, planId))
      .run();
  }

  listDeployPlans(projectName?: string): DeployPlanRow[] {
    if (projectName) {
      return this.db
        .select()
        .from(deployPlans)
        .where(eq(deployPlans.project_name, projectName))
        .orderBy(desc(deployPlans.created_at))
        .all() as DeployPlanRow[];
    }
    return this.db
      .select()
      .from(deployPlans)
      .orderBy(desc(deployPlans.created_at))
      .all() as DeployPlanRow[];
  }

  getLatestPlanForProject(projectName: string): DeployPlanRow | undefined {
    return this.db
      .select()
      .from(deployPlans)
      .where(eq(deployPlans.project_name, projectName))
      .orderBy(desc(deployPlans.created_at), desc(sql`rowid`))
      .limit(1)
      .get() as DeployPlanRow | undefined;
  }
}
