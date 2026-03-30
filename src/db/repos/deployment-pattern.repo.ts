import { and, desc, eq, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { deploymentPatterns } from '../schema.drizzle.js';
import type { DeploymentPatternRow } from '../schema.drizzle.js';

export class DeploymentPatternRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  /**
   * Find all deployment patterns for a project.
   */
  findByProject(projectId: string): DeploymentPatternRow[] {
    return this.db
      .select()
      .from(deploymentPatterns)
      .where(eq(deploymentPatterns.project_id, projectId))
      .orderBy(desc(deploymentPatterns.created_at))
      .all() as DeploymentPatternRow[];
  }

  /**
   * Find a deployment pattern by project and error signature.
   */
  findBySignature(projectId: string, signature: string): DeploymentPatternRow | undefined {
    if (!signature) return undefined;
    return this.db
      .select()
      .from(deploymentPatterns)
      .where(
        and(
          eq(deploymentPatterns.project_id, projectId),
          eq(deploymentPatterns.error_signature, signature),
        ),
      )
      .get() as DeploymentPatternRow | undefined;
  }

  /**
   * Insert or update a deployment pattern by (project_id, error_signature) uniqueness.
   * If a pattern with the same signature exists, updates it. Otherwise creates a new one.
   */
  upsertPattern(data: {
    project_id: string;
    pattern_type: string;
    error_signature: string;
    fix_action: string;
  }): string {
    const existing = this.findBySignature(data.project_id, data.error_signature);

    if (existing) {
      this.db
        .update(deploymentPatterns)
        .set({
          pattern_type: data.pattern_type,
          fix_action: data.fix_action,
          last_seen_at: new Date().toISOString(),
        })
        .where(eq(deploymentPatterns.id, existing.id))
        .run();
      return existing.id;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .insert(deploymentPatterns)
      .values({
        id,
        project_id: data.project_id,
        pattern_type: data.pattern_type,
        error_signature: data.error_signature,
        fix_action: data.fix_action,
        success_count: 0,
        failure_count: 0,
        last_seen_at: createdAt,
        created_at: createdAt,
      })
      .run();

    return id;
  }

  /**
   * Record a successful fix for a pattern.
   * Increments success_count and updates last_seen_at.
   */
  recordSuccess(id: string): void {
    this.db
      .update(deploymentPatterns)
      .set({
        success_count: sql`${deploymentPatterns.success_count} + 1`,
        last_seen_at: new Date().toISOString(),
      })
      .where(eq(deploymentPatterns.id, id))
      .run();
  }

  /**
   * Record a failed fix for a pattern.
   * Increments failure_count.
   */
  recordFailure(id: string): void {
    this.db
      .update(deploymentPatterns)
      .set({
        failure_count: sql`${deploymentPatterns.failure_count} + 1`,
      })
      .where(eq(deploymentPatterns.id, id))
      .run();
  }

  /**
   * Get top patterns for a project sorted by success_count descending.
   */
  getTopPatterns(projectId: string, limit: number = 10): DeploymentPatternRow[] {
    return this.db
      .select()
      .from(deploymentPatterns)
      .where(eq(deploymentPatterns.project_id, projectId))
      .orderBy(desc(deploymentPatterns.success_count))
      .limit(limit)
      .all() as DeploymentPatternRow[];
  }
}
