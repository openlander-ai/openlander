import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  OpenLanderError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  RepoPersistenceError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { buildSetValues } from '../helpers.js';
import { environments, projects, services } from '../schema.drizzle.js';
import type { EnvironmentRow, PendingFixRow, ProjectRow, ServiceRow } from '../types.js';

/**
 * Project row plus pre-fetched derived metadata, to let callers render lists
 * (e.g. /api/projects) without per-row N+1 queries for environments and
 * compose-parent counts.
 */
export interface ProjectWithMetadata {
  project: ProjectRow;
  environments: EnvironmentRow[];
  /** Number of child services (compose-children) under this group. */
  childCount: number;
}

const log = createModuleLogger('project-repo');

/**
 * Synthesized group hosting all managed services post-0009 split. Never
 * user-facing; filtered out of listProjects/getProjectByName results.
 * Plan §6.3 Phase C.
 */
const ORPHAN_MANAGED_GROUP_ID = '__orphan_managed';

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
    buildMethod?: 'dockerfile' | 'compose' | null;
    source?: 'git' | 'image';
    imageUrl?: string;
    imageCmd?: string[];
    containerPort?: number;
  }): ProjectRow {
    const source = project.source ?? 'git';
    const buildMethod = project.buildMethod ?? null;
    const parentProjectId = project.parentProjectId ?? null;

    // Derive the service kind mirroring 0009 Phase D semantics.
    let kind: 'git' | 'image' | 'compose' | 'compose-child';
    if (parentProjectId !== null) {
      kind = 'compose-child';
    } else if (buildMethod === 'compose') {
      kind = 'compose';
    } else if (source === 'image') {
      kind = 'image';
    } else {
      kind = 'git';
    }

    try {
      const raw = this.db.transaction((tx) => {
        // Post-0012: projects table is group-only; deployable runtime fields
        // live on the canonical services row inserted below.
        tx.insert(projects)
          .values({
            id: project.id,
            name: project.name,
            repo_url: project.repoUrl,
            branch: project.branch ?? 'main',
            // group-only: NO deployable fields, NO parent_project_id
          })
          .run();

        // Insert backing service row.
        // - Standalone / compose-parent: project_id = self id.
        // - Compose-child: project_id = parent group id.
        // The id || '__svc' convention is used by getDeployableForProject and
        // related canonical-resolution helpers across the codebase.
        // NO onConflictDoNothing — a UNIQUE conflict here means an orphan service
        // row from a previously-deleted project; that is corrupt state and must
        // abort the whole transaction so the projects row is never committed.
        tx.insert(services)
          .values({
            id: `${project.id}__svc`,
            project_id: parentProjectId ?? project.id,
            name: `${project.name}__svc`,
            kind,
            parent_service_id: parentProjectId ? `${parentProjectId}__svc` : null,
            status: 'stopped',
            visibility: 'internal',
            source,
            build_method: buildMethod,
            dockerfile_path: project.dockerfilePath ?? 'Dockerfile',
            docker_target: project.dockerTarget ?? null,
            build_context: project.buildContext ?? null,
            image_url: project.imageUrl ?? null,
            image_cmd: project.imageCmd !== undefined ? JSON.stringify(project.imageCmd) : null,
            container_port: project.containerPort ?? null,
          })
          .run();

        const created = tx.select().from(projects).where(eq(projects.id, project.id)).get() as
          | ProjectRow
          | undefined;
        if (!created) throw new RepoPersistenceError('project', project.id);
        return created;
      });
      // Hydrate deployable fields from the canonical __svc service row so
      // callers receive the full legacy runtime shape (status, visibility,
      // build_method, etc.) immediately after creation.
      return this.hydrateDeployable(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('UNIQUE constraint failed')) {
        if (msg.includes('services.id') || msg.includes('services.name')) {
          throw new Error(
            `A previous project with id "${project.id}" left orphan service rows. ` +
              `Delete them or pick a new id.`,
          );
        }
        throw new ProjectAlreadyExistsError(project.name);
      }
      throw error;
    }
  }

  /**
   * Merges the canonical `${id}__svc` service row's deployable fields back
   * onto the ProjectRow for backward-compat. All 25 columns dropped in 0012
   * Phase G are re-populated from the services table so existing callers that
   * read `project.status`, `project.visibility`, etc. continue to work.
   */
  private hydrateDeployable(row: ProjectRow): ProjectRow {
    const svc = this.db
      .select()
      .from(services)
      .where(eq(services.id, `${row.id}__svc`))
      .get() as ServiceRow | undefined;
    if (!svc) return row;
    return {
      ...row,
      status: svc.status,
      visibility: svc.visibility,
      assigned_port: svc.assigned_port,
      container_id: svc.container_id,
      image_tag: svc.image_tag,
      previous_image_tag: svc.previous_image_tag,
      public_url: svc.public_url,
      dockerfile_path: svc.dockerfile_path,
      docker_target: svc.docker_target,
      build_context: svc.build_context,
      build_method: svc.build_method,
      source: svc.source as ProjectRow['source'],
      image_url: svc.image_url,
      image_cmd: svc.image_cmd,
      container_port: svc.container_port,
      pending_fix: svc.pending_fix,
      access_code: svc.access_code,
      access_code_iv: svc.access_code_iv,
      is_preview: svc.is_preview as ProjectRow['is_preview'],
      pr_number: svc.pr_number,
      project_type: svc.project_type,
      health_check_strategy: svc.health_check_strategy,
      health_check_path: svc.health_check_path,
      recovering_started_at: svc.recovering_started_at,
      // Derive parent_project_id from parent_service_id (strip __svc suffix).
      parent_project_id: svc.parent_service_id ? svc.parent_service_id.replace(/__svc$/, '') : null,
    };
  }

  getProject(id: string): ProjectRow | undefined {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get() as
      | ProjectRow
      | undefined;
    if (!row) return undefined;
    return this.hydrateDeployable(row);
  }

  getProjectByName(name: string): ProjectRow | undefined {
    const row = this.db.select().from(projects).where(eq(projects.name, name)).get() as
      | ProjectRow
      | undefined;
    if (!row) return undefined;
    return this.hydrateDeployable(row);
  }

  /**
   * Post-0012: projects has no `status` column; the optional status filter
   * scopes to services.status of the group's deployable rows. Compose-child
   * services are excluded from the predicate (they share their parent group
   * but represent inner deployables).
   *
   * @param _serverId - Reserved for future server-side filtering. Currently ignored.
   */
  listProjects(
    status?: 'running' | 'stopped' | 'building' | 'error' | 'recovering' | null,
    opts?: { includeArchived?: boolean },
    _serverId?: string,
  ): ProjectRow[] {
    const conditions = [
      ne(projects.id, ORPHAN_MANAGED_GROUP_ID),
      // Post-0012: exclude compose-child project rows (their service has kind
      // 'compose-child' and project_id = parent group id, NOT their own id).
      // Guard: only keep projects whose OWN service (id = projects.id || '__svc')
      // is NOT a compose-child. Compose-children have no service row with
      // project_id = their own id that is non-compose-child.
      sql`NOT EXISTS (SELECT 1 FROM services s WHERE s.id = (${projects.id} || '__svc') AND s.kind = 'compose-child')`,
    ];
    if (status) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM services s WHERE s.project_id = ${projects.id} AND s.kind != 'compose-child' AND s.status = ${status})`,
      );
    }
    if (!opts?.includeArchived) {
      conditions.push(isNull(projects.archived_at));
    }
    const rows = this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updated_at))
      .all() as ProjectRow[];
    if (rows.length === 0) return rows;
    // Batch-hydrate deployable fields from the canonical __svc service rows.
    const svcIds = rows.map((r) => `${r.id}__svc`);
    const svcRows = this.db
      .select()
      .from(services)
      .where(inArray(services.id, svcIds))
      .all() as ServiceRow[];
    const svcById = new Map<string, ServiceRow>();
    for (const s of svcRows) svcById.set(s.id, s);
    return rows.map((row) => {
      const svc = svcById.get(`${row.id}__svc`);
      if (!svc) return row;
      return {
        ...row,
        status: svc.status,
        visibility: svc.visibility,
        assigned_port: svc.assigned_port,
        container_id: svc.container_id,
        image_tag: svc.image_tag,
        previous_image_tag: svc.previous_image_tag,
        public_url: svc.public_url,
        dockerfile_path: svc.dockerfile_path,
        docker_target: svc.docker_target,
        build_context: svc.build_context,
        build_method: svc.build_method,
        source: svc.source as ProjectRow['source'],
        image_url: svc.image_url,
        image_cmd: svc.image_cmd,
        container_port: svc.container_port,
        pending_fix: svc.pending_fix,
        access_code: svc.access_code,
        access_code_iv: svc.access_code_iv,
        is_preview: svc.is_preview as ProjectRow['is_preview'],
        pr_number: svc.pr_number,
        project_type: svc.project_type,
        health_check_strategy: svc.health_check_strategy,
        health_check_path: svc.health_check_path,
        recovering_started_at: svc.recovering_started_at,
        parent_project_id: svc.parent_service_id
          ? svc.parent_service_id.replace(/__svc$/, '')
          : null,
      };
    });
  }

  /**
   * Batch fetch projects + their environments + child counts in a single
   * pass over the projects table and at most two follow-up queries
   * (one for environments, one for child counts) keyed by project id.
   */
  listProjectsWithMetadata(
    status?: 'running' | 'stopped' | 'building' | 'error' | 'recovering' | null,
    opts?: { includeArchived?: boolean },
  ): ProjectWithMetadata[] {
    const projectRows = this.listProjects(status, opts);
    if (projectRows.length === 0) {
      return [];
    }

    const projectIds = projectRows.map((p) => p.id);

    // Post-0012: environments are scoped to service_id. We pull all services
    // belonging to these groups and then their environments.
    const groupServices = this.db
      .select({ id: services.id, project_id: services.project_id })
      .from(services)
      .where(inArray(services.project_id, projectIds))
      .all() as Array<{ id: string; project_id: string | null }>;

    const projectIdByServiceId = new Map<string, string>();
    for (const s of groupServices) {
      if (s.project_id) projectIdByServiceId.set(s.id, s.project_id);
    }

    const serviceIds = groupServices.map((s) => s.id);
    const envRows =
      serviceIds.length === 0
        ? []
        : (this.db
            .select()
            .from(environments)
            .where(inArray(environments.service_id, serviceIds))
            .orderBy(asc(environments.created_at))
            .all() as EnvironmentRow[]);

    const envByProject = new Map<string, EnvironmentRow[]>();
    for (const env of envRows) {
      const projectId = projectIdByServiceId.get(env.service_id);
      if (!projectId) continue;
      const list = envByProject.get(projectId);
      if (list) {
        list.push(env);
      } else {
        envByProject.set(projectId, [env]);
      }
    }

    // Total deployable services per project group (excludes managed-service kinds:
    // postgres/mysql/redis/mongo/minio). Counts compose-children + git/image/compose
    // services. This is the "serviceCount" badge shown in /api/projects.
    const childCountRows = this.db
      .select({ parentId: services.project_id, cnt: count() })
      .from(services)
      .where(
        and(
          inArray(services.project_id, projectIds),
          notInArray(services.kind, ['postgres', 'mysql', 'redis', 'mongo', 'minio']),
        ),
      )
      .groupBy(services.project_id)
      .all() as Array<{ parentId: string | null; cnt: number }>;

    const childCountByParent = new Map<string, number>();
    for (const row of childCountRows) {
      if (row.parentId) {
        childCountByParent.set(row.parentId, row.cnt);
      }
    }

    return projectRows.map((project) => ({
      project,
      environments: envByProject.get(project.id) ?? [],
      childCount: childCountByParent.get(project.id) ?? 0,
    }));
  }

  /**
   * Post-0012: projects has only group-scoped fields (name, repo_url,
   * branch). Deployable runtime fields (status, ports, container_id, etc.)
   * are written via ServiceRepo or service-manager directly. The accepted
   * update keys here are limited to the persisted columns on `projects`.
   */
  updateProject(
    id: string,
    updates: Partial<{
      branch: string;
      repoUrl: string | null;
      // @deprecated service-scoped fields — routed to the ${id}__svc service row.
      // These exist for backward-compat with pipeline/monitor callers that have
      // not yet been migrated to call updateService() directly.
      status: string;
      visibility: string;
      containerId: string | null;
      assignedPort: number | null;
      imageUrl: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      containerPort: number | null;
      publicUrl: string | null;
      source: string;
      buildMethod: string | null;
      buildContext: string | null;
      dockerfilePath: string | null;
      dockerTarget: string | null;
      imageCmd: string | null;
      isPreview: number | null;
      prNumber: number | null;
      accessCode: string | null;
      accessCodeIv: string | null;
      parentProjectId: string | null;
      recoveringStartedAt: string | null;
      pendingFix: string | null;
    }>,
  ): void {
    // Group-scoped fields — write to projects table.
    const projectSetValues = buildSetValues(updates, {
      branch: 'branch',
      repoUrl: 'repo_url',
    });
    if (Object.keys(projectSetValues).length > 0) {
      this.db
        .update(projects)
        .set({ ...projectSetValues, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(projects.id, id))
        .run();
    }

    // Service-scoped fields — route to the canonical ${id}__svc service row.
    const svcSetValues: Partial<typeof services.$inferInsert> = {};
    if (updates.status !== undefined)
      svcSetValues.status = updates.status as (typeof services.$inferInsert)['status'];
    if (updates.visibility !== undefined) svcSetValues.visibility = updates.visibility;
    if (updates.containerId !== undefined) svcSetValues.container_id = updates.containerId;
    if (updates.assignedPort !== undefined) svcSetValues.assigned_port = updates.assignedPort;
    if (updates.imageUrl !== undefined) svcSetValues.image_url = updates.imageUrl;
    if (updates.imageTag !== undefined) svcSetValues.image_tag = updates.imageTag;
    if (updates.previousImageTag !== undefined)
      svcSetValues.previous_image_tag = updates.previousImageTag;
    if (updates.containerPort !== undefined) svcSetValues.container_port = updates.containerPort;
    if (updates.publicUrl !== undefined) svcSetValues.public_url = updates.publicUrl;
    if (updates.source !== undefined) svcSetValues.source = updates.source;
    if (updates.buildMethod !== undefined) svcSetValues.build_method = updates.buildMethod;
    if (updates.buildContext !== undefined) svcSetValues.build_context = updates.buildContext;
    if (updates.dockerfilePath !== undefined) svcSetValues.dockerfile_path = updates.dockerfilePath;
    if (updates.dockerTarget !== undefined) svcSetValues.docker_target = updates.dockerTarget;
    if (updates.imageCmd !== undefined) svcSetValues.image_cmd = updates.imageCmd;
    if (updates.isPreview !== undefined) svcSetValues.is_preview = updates.isPreview;
    if (updates.prNumber !== undefined) svcSetValues.pr_number = updates.prNumber;
    if (updates.accessCode !== undefined) svcSetValues.access_code = updates.accessCode;
    if (updates.accessCodeIv !== undefined) svcSetValues.access_code_iv = updates.accessCodeIv;
    if (updates.parentProjectId !== undefined) {
      // parentProjectId maps to parent_service_id: ${parentId}__svc convention.
      svcSetValues.parent_service_id = updates.parentProjectId
        ? `${updates.parentProjectId}__svc`
        : null;
    }
    if (updates.recoveringStartedAt !== undefined)
      svcSetValues.recovering_started_at = updates.recoveringStartedAt;
    if (updates.pendingFix !== undefined) svcSetValues.pending_fix = updates.pendingFix;

    if (Object.keys(svcSetValues).length > 0) {
      this.db
        .update(services)
        .set({ ...svcSetValues, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(services.id, `${id}__svc`))
        .run();
    }
  }

  setPendingFix(projectId: string, pendingFix: PendingFixRow): void {
    // Post-0012: pending_fix is a service-row column. Persist via the
    // canonical `<id>__svc` row.
    this.db
      .update(services)
      .set({ pending_fix: JSON.stringify(pendingFix), updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(services.id, `${projectId}__svc`))
      .run();
  }

  consumePendingFix(projectId: string): string | null {
    return this.sqlite.transaction(() => {
      const svc = this.db
        .select({ pending_fix: services.pending_fix })
        .from(services)
        .where(eq(services.id, `${projectId}__svc`))
        .get();
      const rawPendingFix = svc?.pending_fix ?? null;
      if (!rawPendingFix) {
        return null;
      }
      this.db
        .update(services)
        .set({ pending_fix: null, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(services.id, `${projectId}__svc`))
        .run();
      return rawPendingFix;
    })();
  }

  archiveProject(id: string): void {
    const project = this.getProject(id);
    if (!project) {
      throw new ProjectNotFoundError(id);
    }
    // Post-0012: check environments for building status (services table has no 'building' state;
    // building is tracked per-environment in environments.status).
    const buildingEnv = this.db
      .select({ id: environments.id })
      .from(environments)
      .where(
        and(eq(environments.service_id, `${id}__svc`), sql`${environments.status} = 'building'`),
      )
      .get();
    if (buildingEnv) {
      throw new OpenLanderError(
        'Cannot archive a project that is currently building',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId: id },
      );
    }
    const archivedAt = new Date().toISOString();
    this.db
      .update(projects)
      .set({ archived_at: archivedAt, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .run();
    this.db
      .update(services)
      .set({
        archived_at: archivedAt,
        assigned_port: null,
        container_id: null,
        image_tag: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(services.id, `${id}__svc`))
      .run();
  }

  unarchiveProject(id: string): void {
    this.db
      .update(projects)
      .set({ archived_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .run();
    this.db
      .update(services)
      .set({
        archived_at: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(services.id, `${id}__svc`))
      .run();
  }

  listArchivedProjects(): ProjectRow[] {
    const rows = this.db
      .select()
      .from(projects)
      .where(and(isNotNull(projects.archived_at), ne(projects.id, ORPHAN_MANAGED_GROUP_ID)))
      .orderBy(desc(projects.updated_at))
      .all() as ProjectRow[];
    if (rows.length === 0) return rows;
    // Batch-hydrate deployable fields from the canonical __svc service rows,
    // matching the pattern used by listProjects() so archived-project
    // consumers receive the full legacy runtime shape.
    const svcIds = rows.map((r) => `${r.id}__svc`);
    const svcRows = this.db
      .select()
      .from(services)
      .where(inArray(services.id, svcIds))
      .all() as ServiceRow[];
    const svcById = new Map<string, ServiceRow>();
    for (const s of svcRows) svcById.set(s.id, s);
    return rows.map((row) => {
      const svc = svcById.get(`${row.id}__svc`);
      if (!svc) return row;
      return {
        ...row,
        status: svc.status,
        visibility: svc.visibility,
        assigned_port: svc.assigned_port,
        container_id: svc.container_id,
        image_tag: svc.image_tag,
        previous_image_tag: svc.previous_image_tag,
        public_url: svc.public_url,
        dockerfile_path: svc.dockerfile_path,
        docker_target: svc.docker_target,
        build_context: svc.build_context,
        build_method: svc.build_method,
        source: svc.source as ProjectRow['source'],
        image_url: svc.image_url,
        image_cmd: svc.image_cmd,
        container_port: svc.container_port,
        pending_fix: svc.pending_fix,
        access_code: svc.access_code,
        access_code_iv: svc.access_code_iv,
        is_preview: svc.is_preview as ProjectRow['is_preview'],
        pr_number: svc.pr_number,
        project_type: svc.project_type,
        health_check_strategy: svc.health_check_strategy,
        health_check_path: svc.health_check_path,
        recovering_started_at: svc.recovering_started_at,
        parent_project_id: svc.parent_service_id
          ? svc.parent_service_id.replace(/__svc$/, '')
          : null,
      };
    });
  }

  isArchived(id: string): boolean {
    const project = this.getProject(id);
    if (!project) return false;
    return project.archived_at !== null;
  }

  deleteProject(id: string): void {
    // Cascade-delete child projects whose service row is a child of this group.
    const childSvcs = this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.parent_service_id, `${id}__svc`))
      .all() as Array<{ id: string }>;
    for (const s of childSvcs) {
      const childProjectId = s.id.replace(/__svc$/, '');
      this.db.delete(projects).where(eq(projects.id, childProjectId)).run();
    }
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  /**
   * Post-0012: compose hierarchy lives exclusively on services.parent_service_id.
   * Returns the legacy ProjectRow shape for the parent group of any compose-children
   * — callers that need ProjectRow data resolve through getComposeChildProjects.
   */
  getChildProjects(parentId: string): ProjectRow[] {
    // Find services whose parent_service_id = parent's __svc id.
    // The child service id follows the ${childProjectId}__svc convention,
    // so we strip __svc to get the child project id, then fetch + hydrate.
    const childSvcs = this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.parent_service_id, `${parentId}__svc`))
      .orderBy(asc(services.name))
      .all() as Array<{ id: string }>;
    if (childSvcs.length === 0) return [];
    const childProjectIds = childSvcs.map((s) => s.id.replace(/__svc$/, ''));
    return childProjectIds.flatMap((cid) => {
      const row = this.getProject(cid);
      return row ? [row] : [];
    });
  }

  getPreviewProjects(parentProjectId: string): ProjectRow[] {
    // Post-0012: preview flag lives on the service row. Find child services
    // with is_preview = 1 under this parent, then fetch + hydrate their project rows.
    const previewSvcs = this.db
      .select({ id: services.id })
      .from(services)
      .where(
        and(eq(services.parent_service_id, `${parentProjectId}__svc`), eq(services.is_preview, 1)),
      )
      .all() as Array<{ id: string }>;
    if (previewSvcs.length === 0) return [];
    return previewSvcs.flatMap((s) => {
      const row = this.getProject(s.id.replace(/__svc$/, ''));
      return row ? [row] : [];
    });
  }

  isParentProject(id: string): boolean {
    const row = this.db
      .select({ cnt: count() })
      .from(services)
      .where(eq(services.parent_service_id, `${id}__svc`))
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

  // 1.0 GA B3: default aligned with `PROJECT_LOCK_TIMEOUT_MS` (30min in
  // `src/llm/agent-pool.ts`, 30min) so the in-memory project lock and
  // the persisted DB lock expire in the same window — also matches
  // recovery-policy.ts:DEFAULT_LOCK_STALE_MS.
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
