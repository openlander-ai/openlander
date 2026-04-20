import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  OpenLanderError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  RepoPersistenceError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { buildSetValues } from '../helpers.js';
import { projects } from '../schema.drizzle.js';
import type { PendingFixRow, ProjectRow } from '../types.js';

const log = createModuleLogger('project-repo');

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
    if (!created) throw new RepoPersistenceError('project', project.id);
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

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  listProjects(
    status?: ProjectRow['status'],
    opts?: { includeArchived?: boolean },
    _serverId?: string,
  ): ProjectRow[] {
    const conditions = [];
    if (status) {
      conditions.push(eq(projects.status, status));
    }
    if (!opts?.includeArchived) {
      conditions.push(isNull(projects.archived_at));
    }
    if (conditions.length > 0) {
      return this.db
        .select()
        .from(projects)
        .where(and(...conditions))
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
      projectType: ProjectRow['project_type'];
      healthCheckStrategy: ProjectRow['health_check_strategy'];
      healthCheckPath: string | null;
    }>,
  ): void {
    const setValues = buildSetValues(updates, {
      status: 'status',
      visibility: 'visibility',
      assignedPort: 'assigned_port',
      containerId: 'container_id',
      imageTag: 'image_tag',
      previousImageTag: 'previous_image_tag',
      publicUrl: 'public_url',
      parentProjectId: 'parent_project_id',
      dockerfilePath: 'dockerfile_path',
      dockerTarget: 'docker_target',
      buildContext: 'build_context',
      buildMethod: 'build_method',
      source: 'source',
      imageUrl: 'image_url',
      containerPort: 'container_port',
      pendingFix: 'pending_fix',
      accessCode: 'access_code',
      accessCodeIv: 'access_code_iv',
      isPreview: 'is_preview',
      prNumber: 'pr_number',
      branch: 'branch',
      projectType: 'project_type',
      healthCheckStrategy: 'health_check_strategy',
      healthCheckPath: 'health_check_path',
    });
    if (updates.imageCmd !== undefined) {
      setValues.image_cmd = updates.imageCmd === null ? null : JSON.stringify(updates.imageCmd);
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

  archiveProject(id: string): void {
    const project = this.getProject(id);
    if (!project) {
      throw new ProjectNotFoundError(id);
    }
    if (project.status === 'building') {
      throw new OpenLanderError(
        'Cannot archive a project that is currently building',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId: id },
      );
    }
    this.db
      .update(projects)
      .set({
        archived_at: new Date().toISOString(),
        assigned_port: null,
        container_id: null,
        image_tag: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projects.id, id))
      .run();
  }

  unarchiveProject(id: string): void {
    this.db
      .update(projects)
      .set({
        archived_at: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projects.id, id))
      .run();
  }

  listArchivedProjects(): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(isNotNull(projects.archived_at))
      .orderBy(desc(projects.updated_at))
      .all() as ProjectRow[];
  }

  isArchived(id: string): boolean {
    const project = this.getProject(id);
    if (!project) return false;
    return project.archived_at !== null;
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
    this.db
      .update(projects)
      .set({
        deploy_lock_session: sessionId,
        deploy_lock_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(
        and(
          eq(projects.id, projectId),
          or(isNull(projects.deploy_lock_session), eq(projects.deploy_lock_session, sessionId)),
        ),
      )
      .run();
    const row = this.sqlite.prepare('SELECT changes() as changes').get() as {
      changes: number;
    } | null;
    return (row?.changes ?? 0) > 0;
  }

  releaseDeployLock(projectId: string, sessionId?: string): boolean {
    if (sessionId !== undefined) {
      this.db
        .update(projects)
        .set({
          deploy_lock_session: null,
          deploy_lock_at: null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(and(eq(projects.id, projectId), eq(projects.deploy_lock_session, sessionId)))
        .run();

      const row = this.sqlite.prepare('SELECT changes() as changes').get() as {
        changes: number;
      } | null;

      if ((row?.changes ?? 0) === 0) {
        const current = this.getDeployLockInfo(projectId);
        if (current) {
          log.warn(
            { projectId, sessionId, currentSession: current.session },
            '[DeployLock] releaseDeployLock session mismatch — lock held by different session',
          );
        } else {
          log.debug(
            { projectId, sessionId },
            '[DeployLock] releaseDeployLock no-op — lock already released',
          );
        }
        return false;
      }

      return true;
    }

    this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .run();

    return true;
  }

  getDeployLockInfo(projectId: string): { session: string; lockedAt: string } | null {
    const project = this.getProject(projectId);
    if (!project?.deploy_lock_session || !project.deploy_lock_at) return null;
    return { session: project.deploy_lock_session, lockedAt: project.deploy_lock_at };
  }

  cleanExpiredDeployLocks(timeoutMinutes = 30): number {
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
