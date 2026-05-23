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
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  environments,
  envVars,
  projects,
  secretFiles,
  serviceConnections,
  services,
  timelineEvents,
  webhookConfigs,
} from '../schema.drizzle.js';
import {
  ORPHAN_MANAGED_GROUP_ID,
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../service-ids.js';
import type { EnvironmentRow, PendingFixRow, ProjectRow, ServiceRow } from '../types.js';
import { MANAGED_SERVICE_KINDS } from './service.repo.js';

/**
 * Project row plus pre-fetched derived metadata, to let callers render lists
 * (e.g. /api/projects) without per-row N+1 queries for environments and
 * compose-parent counts.
 */
export interface ProjectWithMetadata {
  project: ProjectRow;
  environments: EnvironmentRow[];
  /** Number of services shown under this group, including connected managed services. */
  childCount: number;
  /** True when the group contains at least one `compose-child` or a `compose` parent service. */
  isCompose: boolean;
}

const log = createModuleLogger('project-repo');

type ProjectSelectRow = typeof projects.$inferSelect;
type ServiceSelectRow = typeof services.$inferSelect;
type EnvironmentSelectRow = typeof environments.$inferSelect;
type ProjectStatus = NonNullable<ProjectRow['status']>;

const NON_DEPLOYABLE_SERVICE_KINDS = [...MANAGED_SERVICE_KINDS, 'compose'] as const;

function toProjectRow(row: ProjectSelectRow): ProjectRow {
  return row as ProjectRow;
}

function toServiceRow(row: ServiceSelectRow): ServiceRow {
  return row as ServiceRow;
}

function toEnvironmentRow(row: EnvironmentSelectRow & { project_id?: string }): EnvironmentRow {
  return row as EnvironmentRow;
}

function isUniqueConstraintError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('UNIQUE constraint failed') ||
    msg.includes('duplicate key value') ||
    msg.includes('unique constraint')
  );
}

function excludesAttachedRuntimeProjectRows() {
  // Attached deployable services keep their original runtime project row so
  // service-level redeploy/rollback can still find environments and locks.
  // Hide those runtime rows from all project list surfaces once the service
  // belongs to another group.
  return sql`NOT EXISTS (SELECT 1 FROM services s WHERE s.id = (${projects.id} || '__svc') AND s.project_id != ${projects.id})`;
}

function isDeployableStatusService(kind: string): boolean {
  return !(NON_DEPLOYABLE_SERVICE_KINDS as readonly string[]).includes(kind);
}

function deriveGroupStatusFromServices(
  serviceRows: Array<{ kind: string; status: ServiceRow['status'] }>,
): ProjectStatus | undefined {
  const deployableRows = serviceRows.filter((service) => isDeployableStatusService(service.kind));
  if (deployableRows.length === 0) return undefined;
  if (deployableRows.some((service) => service.status === 'error')) return 'error';
  if (deployableRows.some((service) => service.status === 'running')) return 'running';
  return 'stopped';
}

export class ProjectRepo {
  constructor(
    private readonly db: DrizzleClient,
    _client: PostgresClient,
  ) {
    void _client;
  }

  async createProject(project: {
    id: string;
    name: string;
    displayName?: string;
    description?: string | null;
    tags?: string | null;
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
  }): Promise<ProjectRow> {
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
      const raw = await this.db.transaction(async (tx) => {
        // Post-0012: projects table is group-only; deployable runtime fields
        // live on the canonical services row inserted below.
        const [created] = await tx
          .insert(projects)
          .values({
            id: project.id,
            name: project.name,
            display_name: project.displayName ?? project.name,
            description: project.description ?? null,
            tags: project.tags ?? null,
            // group-only: NO deployable fields, NO parent_project_id
          })
          .returning();

        // Insert backing service row.
        // - Standalone / compose-parent: project_id = self id.
        // - Compose-child: project_id = parent group id.
        // The id || '__svc' convention is used by getDeployableForProject and
        // related canonical-resolution helpers across the codebase.
        // NO onConflictDoNothing — a UNIQUE conflict here means an orphan service
        // row from a previously-deleted project; that is corrupt state and must
        // abort the whole transaction so the projects row is never committed.
        await tx
          .insert(services)
          .values({
            id: projectIdToDeployableServiceId(project.id),
            project_id: parentProjectId ?? project.id,
            name: `${project.name}__svc`,
            kind,
            parent_service_id: parentProjectId
              ? projectIdToDeployableServiceId(parentProjectId)
              : null,
            status: 'stopped',
            visibility: 'internal',
            source,
            build_method: buildMethod,
            repo_url: source === 'git' || kind === 'compose' ? project.repoUrl : null,
            branch: source === 'git' || kind === 'compose' ? (project.branch ?? null) : null,
            dockerfile_path: project.dockerfilePath ?? 'Dockerfile',
            docker_target: project.dockerTarget ?? null,
            build_context: project.buildContext ?? null,
            image_url: project.imageUrl ?? null,
            image_cmd: project.imageCmd !== undefined ? JSON.stringify(project.imageCmd) : null,
            container_port: project.containerPort ?? null,
          })
          .returning({ id: services.id });

        if (!created) throw new RepoPersistenceError('project', project.id);
        return toProjectRow(created);
      });
      // Hydrate deployable fields from the canonical __svc service row so
      // callers receive the full legacy runtime shape (status, visibility,
      // build_method, etc.) immediately after creation.
      return await this.hydrateDeployable(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (
        msg.includes('UNIQUE constraint failed') ||
        msg.includes('duplicate key value') ||
        msg.includes('unique constraint')
      ) {
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

  async createProjectGroup(project: {
    id: string;
    name: string;
    displayName?: string;
    description?: string | null;
    tags?: string | null;
  }): Promise<ProjectRow> {
    try {
      const [created] = await this.db
        .insert(projects)
        .values({
          id: project.id,
          name: project.name,
          display_name: project.displayName ?? project.name,
          description: project.description ?? null,
          tags: project.tags ?? null,
        })
        .returning();

      if (!created) throw new RepoPersistenceError('project', project.id);
      return toProjectRow(created);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ProjectAlreadyExistsError(project.name);
      }
      if (err instanceof OpenLanderError) throw err;
      log.error({ err }, 'Failed to create project group');
      throw new RepoPersistenceError('project', project.id);
    }
  }

  /**
   * Merges the canonical `${id}__svc` service row's deployable fields back
   * onto the ProjectRow for backward-compat. All 25 columns dropped in 0012
   * Phase G are re-populated from the services table so existing callers that
   * read `project.status`, `project.visibility`, etc. continue to work.
   */
  private mergeDeployable(row: ProjectRow, svc: ServiceRow): ProjectRow {
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
      // Derived compatibility alias; parent hierarchy is canonical on services.
      parent_project_id: svc.parent_service_id
        ? deployableServiceIdToProjectId(svc.parent_service_id)
        : null,
    };
  }

  private async hydrateDeployable(row: ProjectRow): Promise<ProjectRow> {
    const [svc] = await this.db
      .select()
      .from(services)
      .where(eq(services.id, projectIdToDeployableServiceId(row.id)))
      .limit(1);
    return svc ? this.mergeDeployable(row, toServiceRow(svc)) : row;
  }

  async getProject(id: string): Promise<ProjectRow | undefined> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) return undefined;
    return await this.hydrateDeployable(toProjectRow(row));
  }

  async getProjectByName(name: string): Promise<ProjectRow | undefined> {
    if (name === ORPHAN_MANAGED_GROUP_ID) return undefined;

    const [row] = await this.db.select().from(projects).where(eq(projects.name, name)).limit(1);
    if (!row) return undefined;
    return await this.hydrateDeployable(toProjectRow(row));
  }

  /**
   * Post-0012: projects has no `status` column; the optional status filter
   * scopes to services.status of the group's deployable rows. Compose-child
   * services are excluded from the predicate (they share their parent group
   * but represent inner deployables).
   *
   * @param _serverId - Reserved for future server-side filtering. Currently ignored.
   */
  async listProjects(
    status?: 'running' | 'stopped' | 'building' | 'error' | 'recovering' | null,
    opts?: { includeArchived?: boolean },
    _serverId?: string,
  ): Promise<ProjectRow[]> {
    const conditions = [
      ne(projects.id, ORPHAN_MANAGED_GROUP_ID),
      // Post-0012: exclude compose-child project rows (their service has kind
      // 'compose-child' and project_id = parent group id, NOT their own id).
      // Guard: only keep projects whose OWN service (id = projects.id || '__svc')
      // is NOT a compose-child. Compose-children have no service row with
      // project_id = their own id that is non-compose-child.
      sql`NOT EXISTS (SELECT 1 FROM services s WHERE s.id = (${projects.id} || '__svc') AND s.kind = 'compose-child')`,
      excludesAttachedRuntimeProjectRows(),
    ];
    if (status) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM services s WHERE s.project_id = ${projects.id} AND s.kind NOT IN ('postgres', 'mysql', 'redis', 'mongo', 'minio', 'compose') AND s.status = ${status})`,
      );
    }
    if (!opts?.includeArchived) {
      conditions.push(isNull(projects.archived_at));
    }
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(...conditions))
      .orderBy(desc(projects.updated_at));
    if (rows.length === 0) return [];
    // Batch-hydrate deployable fields from the canonical __svc service rows.
    const svcIds = rows.map((r) => projectIdToDeployableServiceId(r.id));
    const svcRows = await this.db.select().from(services).where(inArray(services.id, svcIds));
    const svcById = new Map<string, ServiceRow>();
    for (const s of svcRows) svcById.set(s.id, toServiceRow(s));
    return rows.map((row) => {
      const svc = svcById.get(projectIdToDeployableServiceId(row.id));
      const project = toProjectRow(row);
      return svc ? this.mergeDeployable(project, svc) : project;
    });
  }

  async getDeployableServiceCountsByProjectIds(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) {
      return new Map();
    }
    const uniqueProjectIds = [...new Set(projectIds)];

    const rows = await this.db
      .select({ parentId: services.project_id, cnt: count() })
      .from(services)
      .where(
        and(
          inArray(services.project_id, uniqueProjectIds),
          notInArray(services.kind, [...NON_DEPLOYABLE_SERVICE_KINDS]),
          sql`NOT (${services.parent_service_id} IS NULL AND coalesce(${services.build_method}, '') = 'compose')`,
        ),
      )
      .groupBy(services.project_id);

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.parentId) {
        counts.set(row.parentId, row.cnt);
      }
    }

    const managedServiceIdsByProject = new Map<string, Set<string>>();
    const addManagedService = (projectId: string | null, serviceId: string): void => {
      if (!projectId) return;
      const serviceIds = managedServiceIdsByProject.get(projectId) ?? new Set<string>();
      serviceIds.add(serviceId);
      managedServiceIdsByProject.set(projectId, serviceIds);
    };

    const directManagedRows = await this.db
      .select({ projectId: services.project_id, serviceId: services.id })
      .from(services)
      .where(
        and(
          inArray(services.project_id, uniqueProjectIds),
          inArray(services.kind, [...MANAGED_SERVICE_KINDS]),
        ),
      );
    for (const row of directManagedRows) {
      addManagedService(row.projectId, row.serviceId);
    }

    const managedConnectionRows = await this.db
      .select({
        consumerId: serviceConnections.service_id_consumer,
        serviceId: serviceConnections.service_id_provider,
      })
      .from(serviceConnections)
      .innerJoin(services, eq(serviceConnections.service_id_provider, services.id))
      .where(
        and(
          inArray(
            serviceConnections.service_id_consumer,
            uniqueProjectIds.map(projectIdToDeployableServiceId),
          ),
          inArray(services.kind, [...MANAGED_SERVICE_KINDS]),
        ),
      )
      .groupBy(serviceConnections.service_id_consumer, serviceConnections.service_id_provider);

    for (const row of managedConnectionRows) {
      const projectId = deployableServiceIdToProjectId(row.consumerId);
      addManagedService(projectId, row.serviceId);
    }

    for (const [projectId, serviceIds] of managedServiceIdsByProject.entries()) {
      counts.set(projectId, (counts.get(projectId) ?? 0) + serviceIds.size);
    }
    return counts;
  }

  /**
   * Batch fetch projects + their environments + child counts in a single
   * pass over the projects table and at most two follow-up queries
   * (one for environments, one for child counts) keyed by project id.
   */
  async listProjectsWithMetadata(
    status?: 'running' | 'stopped' | 'building' | 'error' | 'recovering' | null,
    opts?: { includeArchived?: boolean },
  ): Promise<ProjectWithMetadata[]> {
    const projectRows = await this.listProjects(status, opts);
    if (projectRows.length === 0) {
      return [];
    }

    const projectIds = projectRows.map((p) => p.id);

    // Post-0012: environments are scoped to service_id. The /api/projects list
    // remains backward-compatible with detail routes by returning only each
    // project's canonical deployable environments, not compose-child service
    // environments owned by the same group.
    const canonicalServiceIds = projectIds.map((projectId) =>
      projectIdToDeployableServiceId(projectId),
    );
    const projectIdByCanonicalServiceId = new Map(
      projectIds.map((projectId) => [projectIdToDeployableServiceId(projectId), projectId]),
    );
    const envRows = await this.db
      .select()
      .from(environments)
      .where(inArray(environments.service_id, canonicalServiceIds))
      .orderBy(asc(environments.created_at));

    const envByProject = new Map<string, EnvironmentRow[]>();
    for (const env of envRows) {
      const projectId = projectIdByCanonicalServiceId.get(env.service_id);
      if (!projectId) continue;
      const hydrated = toEnvironmentRow({ ...env, project_id: projectId });
      const list = envByProject.get(projectId);
      if (list) {
        list.push(hydrated);
      } else {
        envByProject.set(projectId, [hydrated]);
      }
    }

    // Compose detection still needs the whole service group so the UI can mark
    // compose parents even though environments above are canonical-only.
    const groupServices = await this.db
      .select({
        id: services.id,
        project_id: services.project_id,
        kind: services.kind,
        status: services.status,
      })
      .from(services)
      .where(inArray(services.project_id, projectIds));

    const isComposeByProject = new Map<string, boolean>();
    const servicesByProject = new Map<
      string,
      Array<{ kind: string; status: ServiceRow['status'] }>
    >();
    for (const s of groupServices) {
      if (!s.project_id) continue;
      const rows = servicesByProject.get(s.project_id) ?? [];
      rows.push({ kind: s.kind, status: s.status });
      servicesByProject.set(s.project_id, rows);
      if (s.kind === 'compose' || s.kind === 'compose-child') {
        isComposeByProject.set(s.project_id, true);
      }
    }

    // Total deployable services per project group (excludes managed-service kinds:
    // postgres/mysql/redis/mongo/minio). Counts compose-children + git/image/compose
    // services. This is the "serviceCount" badge shown in /api/projects.
    // Count actual deployables: plain git/image services + compose children.
    // Skip managed DBs (postgres etc.) and skip the synthetic 'compose' parent
    // metadata service — users think of compose as "3 services," not "1 parent
    // + 3 children = 4," so omit the parent meta from the badge.
    const childCountByParent = await this.getDeployableServiceCountsByProjectIds(projectIds);

    return projectRows.map((project) => {
      const aggregateStatus = deriveGroupStatusFromServices(
        servicesByProject.get(project.id) ?? [],
      );
      return {
        project: aggregateStatus ? { ...project, status: aggregateStatus } : project,
        environments: envByProject.get(project.id) ?? [],
        childCount: childCountByParent.get(project.id) ?? 0,
        isCompose: isComposeByProject.get(project.id) ?? false,
      };
    });
  }

  /**
   * Post-service-source: projects has only group-scoped fields. Deployable
   * source/runtime fields are routed to the canonical service row.
   */
  async updateProject(
    id: string,
    updates: Partial<{
      // @deprecated service-scoped fields — routed to the ${id}__svc service row.
      // These exist for backward-compat with pipeline/monitor callers that have
      // not yet been migrated to call updateService() directly.
      status: string;
      visibility: string;
      containerId: string | null;
      containerName: string | null;
      assignedPort: number | null;
      imageUrl: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      containerPort: number | null;
      publicUrl: string | null;
      source: string;
      repoUrl: string | null;
      branch: string | null;
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
      // Group metadata fields — live on projects.
      displayName: string;
      description: string | null;
      tags: string | null;
    }>,
  ): Promise<void> {
    const projectSetValues: Partial<typeof projects.$inferInsert> = {};
    if (updates.displayName !== undefined) projectSetValues.display_name = updates.displayName;
    if (updates.description !== undefined) projectSetValues.description = updates.description;
    if (updates.tags !== undefined) projectSetValues.tags = updates.tags;

    if (Object.keys(projectSetValues).length > 0) {
      await this.db
        .update(projects)
        .set({ ...projectSetValues, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(projects.id, id))
        .returning({ id: projects.id });
    }

    // Service-scoped fields — route to the canonical ${id}__svc service row.
    const svcSetValues: Partial<typeof services.$inferInsert> = {};
    if (updates.status !== undefined)
      svcSetValues.status = updates.status as (typeof services.$inferInsert)['status'];
    if (updates.visibility !== undefined) svcSetValues.visibility = updates.visibility;
    if (updates.containerId !== undefined) svcSetValues.container_id = updates.containerId;
    if (updates.containerName !== undefined) svcSetValues.container_name = updates.containerName;
    if (updates.assignedPort !== undefined) svcSetValues.assigned_port = updates.assignedPort;
    if (updates.imageUrl !== undefined) svcSetValues.image_url = updates.imageUrl;
    if (updates.imageTag !== undefined) svcSetValues.image_tag = updates.imageTag;
    if (updates.previousImageTag !== undefined)
      svcSetValues.previous_image_tag = updates.previousImageTag;
    if (updates.containerPort !== undefined) svcSetValues.container_port = updates.containerPort;
    if (updates.publicUrl !== undefined) svcSetValues.public_url = updates.publicUrl;
    if (updates.source !== undefined) svcSetValues.source = updates.source;
    if (updates.repoUrl !== undefined) svcSetValues.repo_url = updates.repoUrl;
    if (updates.branch !== undefined) svcSetValues.branch = updates.branch;
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
        ? projectIdToDeployableServiceId(updates.parentProjectId)
        : null;
    }
    if (updates.recoveringStartedAt !== undefined)
      svcSetValues.recovering_started_at = updates.recoveringStartedAt;
    if (updates.pendingFix !== undefined) svcSetValues.pending_fix = updates.pendingFix;

    if (Object.keys(svcSetValues).length > 0) {
      await this.db
        .update(services)
        .set({ ...svcSetValues, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(services.id, projectIdToDeployableServiceId(id)))
        .returning({ id: services.id });
    }
  }

  async setPendingFix(projectId: string, pendingFix: PendingFixRow): Promise<void> {
    // Post-0012: pending_fix is a service-row column. Persist via the
    // canonical `<id>__svc` row.
    await this.db
      .update(services)
      .set({ pending_fix: JSON.stringify(pendingFix), updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(services.id, projectIdToDeployableServiceId(projectId)))
      .returning({ id: services.id });
  }

  async consumePendingFix(projectId: string): Promise<string | null> {
    return await this.db.transaction(async (tx) => {
      const [svc] = await tx
        .select({ pending_fix: services.pending_fix })
        .from(services)
        .where(eq(services.id, projectIdToDeployableServiceId(projectId)))
        .limit(1);
      const rawPendingFix = svc?.pending_fix ?? null;
      if (!rawPendingFix) {
        return null;
      }
      await tx
        .update(services)
        .set({ pending_fix: null, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(services.id, projectIdToDeployableServiceId(projectId)))
        .returning({ id: services.id });
      return rawPendingFix;
    });
  }

  async archiveProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new ProjectNotFoundError(id);
    }
    // Post-0012: check environments for building status (services table has no 'building' state;
    // building is tracked per-environment in environments.status).
    const [buildingEnv] = await this.db
      .select({ id: environments.id })
      .from(environments)
      .where(
        and(
          eq(environments.service_id, projectIdToDeployableServiceId(id)),
          sql`${environments.status} = 'building'`,
        ),
      )
      .limit(1);
    if (buildingEnv) {
      throw new OpenLanderError(
        'Cannot archive a project that is currently building',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId: id },
      );
    }
    const archivedAt = new Date().toISOString();
    await this.db
      .update(projects)
      .set({ archived_at: archivedAt, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .returning({ id: projects.id });
    await this.db
      .update(services)
      .set({
        archived_at: archivedAt,
        assigned_port: null,
        container_id: null,
        image_tag: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(services.id, projectIdToDeployableServiceId(id)))
      .returning({ id: services.id });
  }

  async unarchiveProject(id: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ archived_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .returning({ id: projects.id });
    await this.db
      .update(services)
      .set({
        archived_at: null,
        status: 'stopped',
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(services.id, projectIdToDeployableServiceId(id)))
      .returning({ id: services.id });
  }

  async listArchivedProjects(): Promise<ProjectRow[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        and(
          isNotNull(projects.archived_at),
          ne(projects.id, ORPHAN_MANAGED_GROUP_ID),
          excludesAttachedRuntimeProjectRows(),
        ),
      )
      .orderBy(desc(projects.updated_at));
    if (rows.length === 0) return [];
    // Batch-hydrate deployable fields from the canonical __svc service rows,
    // matching the pattern used by listProjects() so archived-project
    // consumers receive the full legacy runtime shape.
    const svcIds = rows.map((r) => projectIdToDeployableServiceId(r.id));
    const svcRows = await this.db.select().from(services).where(inArray(services.id, svcIds));
    const svcById = new Map<string, ServiceRow>();
    for (const s of svcRows) svcById.set(s.id, toServiceRow(s));
    return rows.map((row) => {
      const svc = svcById.get(projectIdToDeployableServiceId(row.id));
      const project = toProjectRow(row);
      return svc ? this.mergeDeployable(project, svc) : project;
    });
  }

  async isArchived(id: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) return false;
    return project.archived_at !== null;
  }

  async deleteProject(id: string): Promise<void> {
    // Cascade-delete child projects whose service row is a child of this group.
    const childSvcs = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.parent_service_id, projectIdToDeployableServiceId(id)));
    for (const s of childSvcs) {
      const childProjectId = deployableServiceIdToProjectId(s.id);
      await this.db.delete(projects).where(eq(projects.id, childProjectId)).returning({
        id: projects.id,
      });
    }
    await this.db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  }

  /**
   * v5 (target_project_id flow): move a freshly-deployed service from its
   * temp project into an existing target group.
   * Mirrors the manual SQL pattern used to merge hotdeal/quickpoll on dogfood.
   *
   * The pipeline still creates a single-svc temp project per deploy. After the
   * deploy resolves, the MCP/REST handler calls this to relocate the service
   * under the user-specified target group. The runtime project row is preserved
   * but hidden from project lists because service-level redeploy/rollback still
   * needs it for environments and deploy locks. Project-scoped tables (env_vars,
   * timeline_events, secret_files, project_ops_overrides) are relocated with
   * `UPDATE OR IGNORE` — on env_vars (project_id, key) UNIQUE collision the
   * target's row wins, matching the hotdeal/quickpoll resolution.
   *
   * Throws if either side is missing or if source == target.
   */
  async attachServiceToProject(
    serviceId: string,
    targetProjectId: string,
  ): Promise<{
    sourceProjectId: string;
    targetProjectId: string;
    /** env_var keys that lost the UNIQUE(project_id, key) race — target won. */
    droppedEnvVarKeys: string[];
    /** secret_file filenames that lost the UNIQUE(project_id, filename) race. */
    droppedSecretFiles: string[];
  }> {
    return await this.db.transaction(async (tx) => {
      const [svc] = await tx
        .select({ project_id: services.project_id })
        .from(services)
        .where(eq(services.id, serviceId))
        .limit(1);
      if (!svc) {
        throw new RepoPersistenceError('service', serviceId);
      }
      const sourceProjectId = svc.project_id;
      if (!sourceProjectId) {
        throw new RepoPersistenceError('project', serviceId);
      }

      if (sourceProjectId === targetProjectId) {
        return {
          sourceProjectId,
          targetProjectId,
          droppedEnvVarKeys: [],
          droppedSecretFiles: [],
        };
      }

      const [target] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, targetProjectId))
        .limit(1);
      if (!target) {
        throw new ProjectNotFoundError(targetProjectId);
      }

      await tx
        .update(services)
        .set({ project_id: targetProjectId, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(services.id, serviceId))
        .returning({ id: services.id });

      // CCG #4: when source is __orphan_managed (the synthetic pool that
      // hosts every managed service), do NOT migrate project-scoped rows.
      // Those rows belong to the pool's many sibling services, not the one
      // we're attaching, and migrating them would sweep unrelated data.
      // Today create_service doesn't create env_vars / timeline_events on
      // the pool, so this is a defensive guard against future regressions.
      const isPoolSource = sourceProjectId === ORPHAN_MANAGED_GROUP_ID;

      const droppedEnvVarKeys: string[] = [];
      const droppedSecretFiles: string[] = [];

      if (!isPoolSource) {
        // env_vars (project_id, key) UNIQUE. CCG #3: capture the collision
        // losers BEFORE we drop them so the caller can surface "key X was
        // dropped because the target already had it".
        const targetEnvRows = await tx
          .select({ key: envVars.key })
          .from(envVars)
          .where(eq(envVars.project_id, targetProjectId));
        const targetEnvKeys = new Set(targetEnvRows.map((row) => row.key));
        const sourceEnvRows = await tx
          .select({ id: envVars.id, key: envVars.key })
          .from(envVars)
          .where(eq(envVars.project_id, sourceProjectId));
        const movableEnvIds = sourceEnvRows
          .filter((row) => !targetEnvKeys.has(row.key))
          .map((row) => row.id);
        droppedEnvVarKeys.push(
          ...sourceEnvRows.filter((row) => targetEnvKeys.has(row.key)).map((row) => row.key),
        );
        if (movableEnvIds.length > 0) {
          await tx
            .update(envVars)
            .set({ project_id: targetProjectId })
            .where(inArray(envVars.id, movableEnvIds))
            .returning({ id: envVars.id });
        }
        await tx.delete(envVars).where(eq(envVars.project_id, sourceProjectId)).returning({
          id: envVars.id,
        });

        // timeline_events: project_id FK only, no UNIQUE — straight UPDATE.
        await tx
          .update(timelineEvents)
          .set({ project_id: targetProjectId })
          .where(eq(timelineEvents.project_id, sourceProjectId))
          .returning({ id: timelineEvents.id });

        // secret_files (project_id, filename) UNIQUE — same collision-capture
        // pattern as env_vars.
        const targetSecretRows = await tx
          .select({ filename: secretFiles.filename })
          .from(secretFiles)
          .where(eq(secretFiles.project_id, targetProjectId));
        const targetSecretFilenames = new Set(targetSecretRows.map((row) => row.filename));
        const sourceSecretRows = await tx
          .select({ id: secretFiles.id, filename: secretFiles.filename })
          .from(secretFiles)
          .where(eq(secretFiles.project_id, sourceProjectId));
        const movableSecretIds = sourceSecretRows
          .filter((row) => !targetSecretFilenames.has(row.filename))
          .map((row) => row.id);
        droppedSecretFiles.push(
          ...sourceSecretRows
            .filter((row) => targetSecretFilenames.has(row.filename))
            .map((row) => row.filename),
        );
        if (movableSecretIds.length > 0) {
          await tx
            .update(secretFiles)
            .set({ project_id: targetProjectId })
            .where(inArray(secretFiles.id, movableSecretIds))
            .returning({ id: secretFiles.id });
        }
        await tx.delete(secretFiles).where(eq(secretFiles.project_id, sourceProjectId)).returning({
          id: secretFiles.id,
        });

        // service_ops_overrides was renamed/repointed in 0009/0012 and now
        // keys on service_id, not project_id — the row rides along with the
        // service automatically via the FK. No project-id rewrite needed.

        // webhook_configs is project-specific; the temp project's webhook
        // (auto-created by deploy) shouldn't leak into the target group.
        await tx
          .delete(webhookConfigs)
          .where(eq(webhookConfigs.project_id, sourceProjectId))
          .returning({ id: webhookConfigs.id });
      }

      return { sourceProjectId, targetProjectId, droppedEnvVarKeys, droppedSecretFiles };
    });
  }

  /**
   * Post-0012: compose hierarchy lives exclusively on services.parent_service_id.
   * Returns the legacy ProjectRow shape for the parent group of any compose-children
   * — callers that need ProjectRow data resolve through getComposeChildProjects.
   */
  async getChildProjects(parentId: string): Promise<ProjectRow[]> {
    // Find services whose parent_service_id = parent's __svc id.
    // The child service id follows the ${childProjectId}__svc convention,
    // so we strip __svc to get the child project id, then fetch + hydrate.
    const childSvcs = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.parent_service_id, projectIdToDeployableServiceId(parentId)))
      .orderBy(asc(services.name));
    if (childSvcs.length === 0) return [];
    const childProjectIds = childSvcs.map((s) => deployableServiceIdToProjectId(s.id));
    const rows = await Promise.all(childProjectIds.map((cid) => this.getProject(cid)));
    return rows.filter((p): p is ProjectRow => p !== undefined);
  }

  async getPreviewProjects(parentProjectId: string): Promise<ProjectRow[]> {
    // Post-0012: preview flag lives on the service row. Find child services
    // with is_preview = 1 under this parent, then fetch + hydrate their project rows.
    const previewSvcs = await this.db
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.parent_service_id, projectIdToDeployableServiceId(parentProjectId)),
          eq(services.is_preview, 1),
        ),
      );
    if (previewSvcs.length === 0) return [];
    const rows = await Promise.all(
      previewSvcs.map((s) => this.getProject(deployableServiceIdToProjectId(s.id))),
    );
    return rows.filter((p): p is ProjectRow => p !== undefined);
  }

  async isParentProject(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ cnt: count() })
      .from(services)
      .where(eq(services.parent_service_id, projectIdToDeployableServiceId(id)))
      .limit(1);
    return (row?.cnt ?? 0) > 0;
  }

  async acquireDeployLock(projectId: string, sessionId: string): Promise<boolean> {
    await this.cleanExpiredDeployLocks();
    const updated = await this.db
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
      .returning({ id: projects.id });
    return updated.length > 0;
  }

  async releaseDeployLock(projectId: string, sessionId?: string): Promise<boolean> {
    if (sessionId !== undefined) {
      const updated = await this.db
        .update(projects)
        .set({
          deploy_lock_session: null,
          deploy_lock_at: null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(and(eq(projects.id, projectId), eq(projects.deploy_lock_session, sessionId)))
        .returning({ id: projects.id });

      if (updated.length === 0) {
        const current = await this.getDeployLockInfo(projectId);
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

    await this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });

    return true;
  }

  async getDeployLockInfo(
    projectId: string,
  ): Promise<{ session: string; lockedAt: string } | null> {
    const project = await this.getProject(projectId);
    if (!project?.deploy_lock_session || !project.deploy_lock_at) return null;
    return { session: project.deploy_lock_session, lockedAt: project.deploy_lock_at };
  }

  // 1.0 GA B3: default aligned with `PROJECT_LOCK_TIMEOUT_MS` (30min in
  // `src/llm/agent-pool.ts`, 30min) so the in-memory project lock and
  // the persisted DB lock expire in the same window — also matches
  // recovery-policy.ts:DEFAULT_LOCK_STALE_MS.
  async cleanExpiredDeployLocks(timeoutMinutes = 30): Promise<number> {
    const updated = await this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null })
      .where(
        sql`${projects.deploy_lock_session} IS NOT NULL AND (${projects.deploy_lock_at})::timestamp < now() - (${timeoutMinutes} * interval '1 minute')`,
      )
      .returning({ id: projects.id });
    return updated.length;
  }
}
