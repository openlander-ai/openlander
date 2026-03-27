import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { ProjectAlreadyExistsError } from '../../errors.js';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { projects } from '../schema.drizzle.js';
import type { PendingFixRow, ProjectRow } from '../types.js';

export class ProjectRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  createProject(project: {
    id: string;
    name: string;
    repoUrl: string;
    branch?: string;
    parentProjectId?: string;
    dockerfilePath?: string;
    dockerTarget?: string;
    buildContext?: string;
    source?: ProjectRow['source'];
    imageUrl?: string;
    imageCmd?: string[];
    containerPort?: number;
  }): ProjectRow {
    try {
      this.db
        .insert(projects)
        .values({
          id: project.id,
          name: project.name,
          repo_url: project.repoUrl,
          branch: project.branch ?? 'main',
          parent_project_id: project.parentProjectId ?? null,
          dockerfile_path: project.dockerfilePath ?? 'Dockerfile',
          docker_target: project.dockerTarget ?? null,
          build_context: project.buildContext ?? null,
          source: project.source ?? 'git',
          image_url: project.imageUrl ?? null,
          image_cmd: project.imageCmd !== undefined ? JSON.stringify(project.imageCmd) : null,
          container_port: project.containerPort ?? null,
        })
        .run();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ProjectAlreadyExistsError(project.name);
      }
      throw error;
    }

    const created = this.getProject(project.id);
    if (!created) throw new Error(`Failed to create project ${project.id}`);
    return created;
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get() as
      | ProjectRow
      | undefined;
  }

  getProjectByName(name: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.name, name)).get() as
      | ProjectRow
      | undefined;
  }

  listProjects(status?: ProjectRow['status']): ProjectRow[] {
    if (status) {
      return this.db
        .select()
        .from(projects)
        .where(eq(projects.status, status))
        .orderBy(desc(projects.updated_at))
        .all() as ProjectRow[];
    }
    return this.db.select().from(projects).orderBy(desc(projects.updated_at)).all() as ProjectRow[];
  }

  updateProject(
    id: string,
    updates: Partial<{
      status: ProjectRow['status'];
      visibility: ProjectRow['visibility'];
      assignedPort: number | null;
      containerId: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      publicUrl: string | null;
      parentProjectId: string | null;
      dockerfilePath: string;
      dockerTarget: string | null;
      buildContext: string | null;
      buildMethod: ProjectRow['build_method'];
      source: ProjectRow['source'];
      imageUrl: string | null;
      imageCmd: string[] | null;
      containerPort: number | null;
      pendingFix: string | null;
      accessCode: string | null;
      accessCodeIv: string | null;
      isPreview: 0 | 1;
      prNumber: number | null;
      branch: string;
      monitoringPaused: 0 | 1;
    }>,
  ): void {
    const setValues: Partial<typeof projects.$inferInsert> = {};

    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.visibility !== undefined) {
      setValues.visibility = updates.visibility;
    }
    if (updates.assignedPort !== undefined) {
      setValues.assigned_port = updates.assignedPort;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }
    if (updates.imageTag !== undefined) {
      setValues.image_tag = updates.imageTag;
    }
    if (updates.previousImageTag !== undefined) {
      setValues.previous_image_tag = updates.previousImageTag;
    }
    if (updates.publicUrl !== undefined) {
      setValues.public_url = updates.publicUrl;
    }
    if (updates.parentProjectId !== undefined) {
      setValues.parent_project_id = updates.parentProjectId;
    }
    if (updates.dockerfilePath !== undefined) {
      setValues.dockerfile_path = updates.dockerfilePath;
    }
    if (updates.dockerTarget !== undefined) {
      setValues.docker_target = updates.dockerTarget;
    }
    if (updates.buildContext !== undefined) {
      setValues.build_context = updates.buildContext;
    }
    if (updates.buildMethod !== undefined) {
      setValues.build_method = updates.buildMethod;
    }
    if (updates.source !== undefined) {
      setValues.source = updates.source;
    }
    if (updates.imageUrl !== undefined) {
      setValues.image_url = updates.imageUrl;
    }
    if (updates.imageCmd !== undefined) {
      setValues.image_cmd = updates.imageCmd === null ? null : JSON.stringify(updates.imageCmd);
    }
    if (updates.containerPort !== undefined) {
      setValues.container_port = updates.containerPort;
    }
    if (updates.pendingFix !== undefined) {
      setValues.pending_fix = updates.pendingFix;
    }
    if (updates.accessCode !== undefined) {
      setValues.access_code = updates.accessCode;
    }
    if (updates.accessCodeIv !== undefined) {
      setValues.access_code_iv = updates.accessCodeIv;
    }
    if (updates.isPreview !== undefined) {
      setValues.is_preview = updates.isPreview;
    }
    if (updates.prNumber !== undefined) {
      setValues.pr_number = updates.prNumber;
    }
    if (updates.branch !== undefined) {
      setValues.branch = updates.branch;
    }
    if (updates.monitoringPaused !== undefined) {
      setValues.monitoring_paused = updates.monitoringPaused;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(projects)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .run();
  }

  setPendingFix(projectId: string, pendingFix: PendingFixRow): void {
    this.updateProject(projectId, {
      pendingFix: JSON.stringify(pendingFix),
    });
  }

  consumePendingFix(projectId: string): string | null {
    return this.sqlite.transaction(() => {
      const project = this.getProject(projectId);
      const rawPendingFix = project?.pending_fix ?? null;
      if (!rawPendingFix) {
        return null;
      }
      this.updateProject(projectId, { pendingFix: null });
      return rawPendingFix;
    })();
  }

  deleteProject(id: string): void {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  getChildProjects(parentId: string): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.parent_project_id, parentId))
      .orderBy(asc(projects.name))
      .all() as ProjectRow[];
  }

  getPreviewProjects(parentProjectId: string): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(and(eq(projects.parent_project_id, parentProjectId), eq(projects.is_preview, 1)))
      .orderBy(desc(projects.updated_at))
      .all() as ProjectRow[];
  }

  isParentProject(id: string): boolean {
    const row = this.db
      .select({ cnt: count() })
      .from(projects)
      .where(eq(projects.parent_project_id, id))
      .get();
    return (row?.cnt ?? 0) > 0;
  }

  acquireDeployLock(projectId: string, sessionId: string): boolean {
    this.cleanExpiredDeployLocks();
    const project = this.getProject(projectId);
    if (!project) return false;
    if (project.deploy_lock_session && project.deploy_lock_session !== sessionId) {
      return false;
    }
    this.db
      .update(projects)
      .set({
        deploy_lock_session: sessionId,
        deploy_lock_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projects.id, projectId))
      .run();
    return true;
  }

  releaseDeployLock(projectId: string): void {
    this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .run();
  }

  getDeployLockInfo(projectId: string): { session: string; lockedAt: string } | null {
    const project = this.getProject(projectId);
    if (!project?.deploy_lock_session || !project.deploy_lock_at) return null;
    return { session: project.deploy_lock_session, lockedAt: project.deploy_lock_at };
  }

  cleanExpiredDeployLocks(timeoutMinutes = 10): number {
    this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null })
      .where(
        sql`${projects.deploy_lock_session} IS NOT NULL AND ${projects.deploy_lock_at} < datetime('now', '-' || ${timeoutMinutes} || ' minutes')`,
      )
      .run();
    const row = this.sqlite.prepare('SELECT changes() as changes').get() as {
      changes: number;
    } | null;
    return row?.changes ?? 0;
  }
}
