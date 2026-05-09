import { and, desc, eq, sql } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { deploymentPatterns } from '../schema.drizzle.js';
import type { DeploymentPatternRow } from '../schema.drizzle.js';

export class DeploymentPatternRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /**
   * Find all deployment patterns for a project.
   */
  async findByProject(projectId: string): Promise<DeploymentPatternRow[]> {
    return await this.db
      .select()
      .from(deploymentPatterns)
      .where(eq(deploymentPatterns.project_id, projectId))
      .orderBy(desc(deploymentPatterns.created_at));
  }

  /**
   * Find a deployment pattern by project and error signature.
   */
  async findBySignature(
    projectId: string,
    signature: string,
  ): Promise<DeploymentPatternRow | undefined> {
    if (!signature) return undefined;
    const row =
      (
        await this.db
          .select()
          .from(deploymentPatterns)
          .where(
            and(
              eq(deploymentPatterns.project_id, projectId),
              eq(deploymentPatterns.error_signature, signature),
            ),
          )
          .limit(1)
      )[0] ?? null;
    return row ?? undefined;
  }

  /**
   * Insert or update a deployment pattern by (project_id, error_signature) uniqueness.
   * If a pattern with the same signature exists, updates it. Otherwise creates a new one.
   */
  async upsertPattern(data: {
    project_id: string;
    pattern_type: string;
    error_signature: string;
    fix_action: string;
  }): Promise<string> {
    const existing = await this.findBySignature(data.project_id, data.error_signature);

    if (existing) {
      await this.db
        .update(deploymentPatterns)
        .set({
          pattern_type: data.pattern_type,
          fix_action: data.fix_action,
          last_seen_at: new Date().toISOString(),
        })
        .where(eq(deploymentPatterns.id, existing.id));
      return existing.id;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.db.insert(deploymentPatterns).values({
      id,
      project_id: data.project_id,
      pattern_type: data.pattern_type,
      error_signature: data.error_signature,
      fix_action: data.fix_action,
      success_count: 0,
      failure_count: 0,
      last_seen_at: createdAt,
      created_at: createdAt,
    });

    return id;
  }

  /**
   * Record a successful fix for a pattern.
   * Increments success_count and updates last_seen_at.
   */
  async recordSuccess(id: string): Promise<void> {
    await this.db
      .update(deploymentPatterns)
      .set({
        success_count: sql`${deploymentPatterns.success_count} + 1`,
        last_seen_at: new Date().toISOString(),
      })
      .where(eq(deploymentPatterns.id, id));
  }

  /**
   * Record a failed fix for a pattern.
   * Increments failure_count.
   */
  async recordFailure(id: string): Promise<void> {
    await this.db
      .update(deploymentPatterns)
      .set({
        failure_count: sql`${deploymentPatterns.failure_count} + 1`,
      })
      .where(eq(deploymentPatterns.id, id));
  }

  /**
   * Find all deployment patterns across all projects, sorted by last_seen_at DESC.
   */
  async findAll(): Promise<DeploymentPatternRow[]> {
    return await this.db
      .select()
      .from(deploymentPatterns)
      .orderBy(desc(deploymentPatterns.last_seen_at));
  }

  /**
   * Get top patterns for a project sorted by success_count descending.
   */
  async getTopPatterns(projectId: string, limit: number = 10): Promise<DeploymentPatternRow[]> {
    return await this.db
      .select()
      .from(deploymentPatterns)
      .where(eq(deploymentPatterns.project_id, projectId))
      .orderBy(desc(deploymentPatterns.success_count))
      .limit(limit);
  }
}
