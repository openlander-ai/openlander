/**
 * `ServiceView` — read-only projection over the **deployable service** row
 * (the `services` row a project group's deploys land on, post-migration
 * 0012). The same projection is what routes / MCP tool defs reach for
 * when they ask "what should the response say about this service right
 * now"; until v0.2 those callers each maintain their own
 * `deployable?.X ?? project.X` fallback chain inline.
 *
 * v0.2 service-first read-model track, slice S0:
 * - This file is the single source of truth for the projection shape.
 * - `loadServiceView` resolves a `ServiceView` for one project's
 *   canonical deployable. Multi-service-group / per-service builders
 *   land in later slices.
 * - Layer-pure: `src/db/views/` may not import from `web/api/`, `app`,
 *   or any presentation helper. URL derivation, command parsing, and
 *   other display-layer transforms stay in the adapter that consumes
 *   the view (e.g. `mapProjectForApi`).
 *
 * Status normalization
 * --------------------
 * `ServiceView.status` is non-nullable with `'idle'` as the bottom case.
 * Adapters that historically emitted `null` for a missing-status read
 * (e.g. `loadProjectRuntimeStats`) map `view.status === 'idle' → null`
 * at the response boundary. This is lossless because those adapters
 * have never emitted `'idle'` in production — see the v0.2 design doc
 * in openlander-internal `planning/v0.2/service-first-read-model-claude.md`
 * §6.4.
 */

import type { Database } from '../index.js';
import { deployableServiceIdToProjectId } from '../service-ids.js';
import type { ProjectRow, ServiceRow } from '../types.js';

/** Service runtime status normalized for the read model. */
export type ServiceStatus = 'running' | 'stopped' | 'building' | 'error' | 'recovering' | 'idle';

export type ServiceSource = 'git' | 'image';
export type ServiceBuildMethod = 'dockerfile' | 'compose';
export type ServiceHealthCheckStrategy = 'http' | 'tcp' | 'exec' | 'none';
export type ServiceVisibility = 'internal' | 'quick-share' | 'shared' | 'production';
export type ServiceProjectType = 'web' | 'worker';

/**
 * Projection used by every read-surface caller. Field set mirrors the
 * existing pre-v0.2 helpers (`mapProjectForApi`, `loadProjectRuntimeStats`,
 * `loadPreviewProjections`, `buildLegacyTopologyNode`,
 * `exposeProjectTunnel`) so the S1 / S2 / S3 migration is a pure
 * field-by-field consumer rewire.
 *
 * Raw rows only — no derived display fields (`url`, parsed
 * `image_cmd`, etc.). Those stay in the adapter that wraps the view
 * for a specific response surface; the layer-purity rule keeps
 * `db/views/` importable from pipeline / monitor without dragging in
 * Hono / Traefik.
 */
export interface ServiceView {
  // ── Identity ──
  /** Canonical service id (`<projectId>__svc` for the legacy 1.0 model). */
  id: string;
  /** Owning project group id. */
  projectId: string;
  /** Owning project group name (matches `ProjectRow.name`). */
  projectName: string;
  /** Service-side name. For legacy 1.0 this equals `${projectName}__svc`. */
  name: string;
  /** Raw service kind (`git`, `image`, `compose`, managed kinds, etc.). */
  kind: ServiceRow['kind'] | null;

  // ── Lifecycle ──
  /** Normalized runtime status with `'idle'` as the bottom case. */
  status: ServiceStatus;
  containerId: string | null;
  containerName: string | null;

  // ── Network ──
  assignedPort: number | null;
  containerPort: number | null;
  publicUrl: string | null;

  // ── Build ──
  source: ServiceSource | null;
  imageUrl: string | null;
  repoUrl: string | null;
  branch: string | null;
  imageTag: string | null;
  previousImageTag: string | null;
  /** Raw `image_cmd` string — adapters that need an array parse it. */
  imageCmdRaw: string | null;
  dockerfilePath: string | null;
  dockerTarget: string | null;
  buildContext: string | null;
  buildMethod: ServiceBuildMethod | null;

  // ── Health ──
  healthCheckStrategy: ServiceHealthCheckStrategy | null;
  healthCheckPath: string | null;

  // ── Preview / lifecycle metadata ──
  isPreview: boolean;
  prNumber: number | null;
  visibility: ServiceVisibility;
  pendingFix: string | null;
  recoveringStartedAt: string | null;

  // ── S1.3 additions for `mapProjectForApi` ──
  /** `'web' | 'worker'` — defaults to `null` when neither row carries one. */
  projectType: ServiceProjectType | null;
  /** Encrypted quick-share / shared-access code. */
  accessCode: string | null;
  accessCodeIv: string | null;
  /**
   * Parent project group id when this service is a child of another
   * group (compose-child / preview). Resolves the
   * `parent_service_id → parent project id` rewrite at the view layer so
   * adapters don't re-implement the `deployableServiceIdToProjectId`
   * call. Falls back to `project.parent_project_id` when no service-side
   * pointer exists.
   */
  parentProjectId: string | null;
}

export interface ServiceViewRecord {
  project: ProjectRow;
  service: ServiceRow | null;
  view: ServiceView;
}

/**
 * Wire-boundary visibility for `list_projects`.
 *
 * `ServiceView.visibility` is normalized to `'internal'` for internal
 * consumers. The tool response historically serialized the raw
 * `ProjectRow.visibility` value returned by ProjectRepo after deployable
 * hydration, including `null` and `undefined` bottoms. Keep that raw
 * contract centralized here so tool defs do not read dropped project
 * columns directly.
 */
export function serviceViewWireVisibility(project: ProjectRow): ProjectRow['visibility'] {
  // eslint-disable-next-line openlander-internal/no-dropped-columns -- compatibility helper preserves the list_projects raw visibility wire contract; ServiceView.visibility intentionally normalizes null/undefined to 'internal'.
  return project.visibility;
}

/**
 * Build a `ServiceView` from already-fetched rows. Pure synchronous —
 * use when the caller has already paid for the lookups (the common
 * "topology already pulled both" pattern).
 *
 * `service` is the canonical deployable services row (post-0012);
 * `project` is the project group row. When `service` is missing the
 * view falls back to the deprecated ProjectRow columns so v0.1
 * standalone projects (which never wrote a `__svc` row in tests etc.)
 * still resolve a complete view.
 */
export function serviceViewFromRows(
  project: ProjectRow,
  service: ServiceRow | null | undefined,
): ServiceView {
  // Status normalization: services-row wins, then project (deprecated),
  // then 'idle' bottom case. Adapters that historically emitted `null`
  // for missing status restore that emission at the response boundary
  // (see file-header note).
  const status: ServiceStatus = service?.status ?? project.status ?? 'idle';

  // Source defaults to null when neither row carries one — the
  // pre-0012 `mapProjectForApi` returned `project.source ?? undefined`
  // here, but null is the deployable-row's actual default and adapters
  // already coalesce undefined → null when shaping JSON.
  const source = (service?.source ?? project.source ?? null) as ServiceSource | null;

  return {
    id: service?.id ?? `${project.id}__svc`,
    projectId: project.id,
    projectName: project.name,
    name: service?.name ?? `${project.name}__svc`,
    kind: service?.kind ?? null,

    status,
    containerId: service?.container_id ?? project.container_id ?? null,
    containerName: service?.container_name ?? null,

    assignedPort: service?.assigned_port ?? project.assigned_port ?? null,
    containerPort: service?.container_port ?? project.container_port ?? null,
    publicUrl: service?.public_url ?? project.public_url ?? null,

    source,
    imageUrl: service?.image_url ?? project.image_url ?? null,
    repoUrl: service?.repo_url ?? null,
    branch: service?.branch ?? null,
    imageTag: service?.image_tag ?? project.image_tag ?? null,
    previousImageTag: service?.previous_image_tag ?? project.previous_image_tag ?? null,
    imageCmdRaw: service?.image_cmd ?? project.image_cmd ?? null,
    dockerfilePath: service?.dockerfile_path ?? project.dockerfile_path ?? null,
    dockerTarget: service?.docker_target ?? project.docker_target ?? null,
    buildContext: service?.build_context ?? project.build_context ?? null,
    buildMethod: service?.build_method ?? project.build_method ?? null,

    healthCheckStrategy: service?.health_check_strategy ?? project.health_check_strategy ?? null,
    healthCheckPath: service?.health_check_path ?? project.health_check_path ?? null,

    isPreview: Boolean(service?.is_preview ?? project.is_preview ?? 0),
    prNumber: service?.pr_number ?? project.pr_number ?? null,
    // Visibility falls back to `'internal'` to match the pre-v0.2
    // `mapProjectForApi` default; that helper already shipped this
    // behavior to clients.
    visibility: service?.visibility ?? project.visibility ?? 'internal',
    pendingFix: service?.pending_fix ?? project.pending_fix ?? null,
    recoveringStartedAt: service?.recovering_started_at ?? project.recovering_started_at ?? null,

    projectType: service?.project_type ?? project.project_type ?? null,
    accessCode: service?.access_code ?? project.access_code ?? null,
    accessCodeIv: service?.access_code_iv ?? project.access_code_iv ?? null,
    // Mirrors the pre-v0.2 `mapProjectForApi` chain: prefer the
    // service-side `parent_service_id` (transformed back into a project
    // id), fall through to the legacy `project.parent_project_id`
    // column. Keeps the transform inside the view layer so adapters
    // never re-import `deployableServiceIdToProjectId`.
    parentProjectId: service?.parent_service_id
      ? deployableServiceIdToProjectId(service.parent_service_id)
      : (project.parent_project_id ?? null),
  };
}

/**
 * Resolve a `ServiceView` for a project group. Convenience entry point
 * for the common shape where the caller already holds the `ProjectRow`
 * and needs the deployable projection — typically the route handler
 * pattern of `getProjectOrThrow → loadServiceView`.
 *
 * Only the deployable lookup runs here; the `ProjectRow` is consumed as
 * the fallback half of the view and never re-fetched.
 */
export async function loadServiceView(
  db: Pick<Database, 'getDeployableForProject'>,
  project: ProjectRow,
): Promise<ServiceView> {
  return (await loadServiceViewRecord(db, project)).view;
}

/**
 * Resolve both halves of the projection for callers that still need the
 * canonical service row to perform a write (for example, monitor status sync).
 */
export async function loadServiceViewRecord(
  db: Pick<Database, 'getDeployableForProject'>,
  project: ProjectRow,
): Promise<ServiceViewRecord> {
  const service = (await db.getDeployableForProject(project.id)) ?? null;
  return {
    project,
    service,
    view: serviceViewFromRows(project, service),
  };
}

/**
 * Batch form of `loadServiceView`. Use this for list/dashboard surfaces
 * that already hold multiple project groups and only need each group's
 * canonical deployable row. This keeps the service-first projection
 * centralized without reintroducing route/tool-level N+1 lookups.
 */
export async function loadServiceViewRecords(
  db: Pick<Database, 'getServices'>,
  projects: readonly ProjectRow[],
): Promise<Map<string, ServiceViewRecord>> {
  if (projects.length === 0) {
    return new Map();
  }

  const ids = projects.map((project) => `${project.id}__svc`);
  const services = await db.getServices({ ids });
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const records = new Map<string, ServiceViewRecord>();

  for (const project of projects) {
    const service = servicesById.get(`${project.id}__svc`) ?? null;
    records.set(project.id, {
      project,
      service,
      view: serviceViewFromRows(project, service),
    });
  }
  return records;
}
