import type { AppContext } from '../../../app.js';
import type {
  DomainMappingRow,
  EnvironmentRow,
  ProjectRow,
  ServiceRow,
} from '../../../db/index.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../../db/service-ids.js';
import { isManagedServiceKind } from '../../../db/repos/service.repo.js';
import { loadServiceViewRecords, serviceViewFromRows } from '../../../db/views/service-view.js';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  OpenLanderError,
  ProjectAlreadyExistsError,
  ProjectArchivedError,
  ProjectHasActiveServicesError,
  ProjectRecoveringError,
} from '../../../errors.js';
import {
  assertProjectLifecycleMutable,
  assertProjectMutable,
  type LifecycleAction,
  type MutationPolicyCtx,
} from '../../../pipeline/mutation-policy.js';
import {
  getAllIps,
  getEnvironmentProjectHostname,
  getPreferredProjectUrl,
  type ProjectUrl,
  getProjectUrls,
} from '../../../pipeline/traefik.js';

export const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export type ProjectPatchBody = {
  name?: unknown;
  displayName?: unknown;
  display_name?: unknown;
  description?: unknown;
  tags?: unknown;
  imageUrl?: unknown;
  imageCmd?: unknown;
  containerPort?: unknown;
  image_url?: unknown;
  image_cmd?: unknown;
  container_port?: unknown;
};

export type DeployableForApi = {
  kind?: string | null;
  status?: string | null;
  visibility?: ProjectRow['visibility'];
  parent_service_id?: string | null;
  assigned_port?: number | null;
  container_id?: string | null;
  container_port?: number | null;
  image_tag?: string | null;
  previous_image_tag?: string | null;
  public_url?: string | null;
  image_url?: string | null;
  source?: string | null;
  build_method?: string | null;
  dockerfile_path?: string | null;
  access_code?: string | null;
  access_code_iv?: string | null;
  pending_fix?: string | null;
  recovering_started_at?: string | null;
  docker_target?: string | null;
  build_context?: string | null;
  image_cmd?: string | null;
  project_type?: 'web' | 'worker' | null;
  is_preview?: number | null;
  pr_number?: number | null;
  health_check_strategy?: 'http' | 'tcp' | 'exec' | 'none' | null;
  health_check_path?: string | null;
};

export function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const legacyNoTimezone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalizedInput = legacyNoTimezone.test(trimmed)
    ? trimmed.replace(' ', 'T') + 'Z'
    : trimmed;
  const parsed = new Date(normalizedInput);

  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

export function mapEnvironment(projectName: string, environment: EnvironmentRow) {
  const ips = getAllIps();
  return {
    ...environment,
    url: `http://${getEnvironmentProjectHostname(projectName, environment.type)}`,
    urls: ips.map((ip) => ({
      url: `http://${getEnvironmentProjectHostname(projectName, environment.type, ip.address)}`,
      type: ip.type,
      ip: ip.address,
    })),
    created_at: normalizeTimestamp(environment.created_at),
    updated_at: normalizeTimestamp(environment.updated_at),
  };
}

export function parseImageCmd(imageCmd: string | null): string[] | null {
  if (!imageCmd) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(imageCmd);
    return Array.isArray(parsed) && parsed.every((entry: unknown) => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function extractFailureSummary(buildLog: string | null): string | null {
  if (!buildLog) return null;

  const lines = buildLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = lines.find((line) => /error|failed|exception/i.test(line));
  return errorLine ?? lines.at(-1) ?? null;
}

export function parseProjectTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

export function deriveGroupLifecycleState(services: ServiceRow[]): {
  partiallyArchived: boolean;
} {
  if (services.length === 0) {
    return { partiallyArchived: false };
  }
  const archivedCount = services.filter((service) => service.archived_at).length;
  return {
    partiallyArchived: archivedCount > 0 && archivedCount < services.length,
  };
}

export function normalizeProjectTagsInput(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (!Array.isArray(input)) {
    throw new OpenLanderError('tags must be an array of strings', 'INVALID_FIELD', 400, {
      field: 'tags',
    });
  }
  const normalized = input.map((entry) => {
    if (typeof entry !== 'string') {
      throw new OpenLanderError('tags must be an array of strings', 'INVALID_FIELD', 400, {
        field: 'tags',
      });
    }
    return entry.trim();
  });
  return JSON.stringify([...new Set(normalized.filter(Boolean))]);
}

export function normalizeNullableText(input: unknown, field: string): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== 'string') {
    throw new OpenLanderError(`${field} must be a string`, 'INVALID_FIELD', 400, { field });
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveProjectSlug(displayName: string): string {
  const slug = displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug.length > 0 ? slug : 'project';
}

export async function createProjectGroupWithSlugRetry(
  ctx: AppContext,
  input: {
    slug: string;
    displayName: string;
    description?: string | null;
    tags?: string | null;
    allowSuffix: boolean;
  },
): Promise<ProjectRow> {
  const maxAttempts = input.allowSuffix ? 50 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = attempt === 0 ? input.slug : `${input.slug}-${String(attempt + 1)}`;
    try {
      return await ctx.db.createProjectGroup({
        id: crypto.randomUUID(),
        name: slug,
        displayName: input.displayName,
        description: input.description ?? null,
        tags: input.tags ?? null,
      });
    } catch (err) {
      if (err instanceof ProjectAlreadyExistsError && input.allowSuffix) {
        continue;
      }
      throw err;
    }
  }
  throw new ProjectAlreadyExistsError(input.slug);
}

export function mapProjectForApi(project: ProjectRow, deployable?: DeployableForApi) {
  // v0.2 service-first read-model, slice S1.3: source the 23-field hybrid
  // projection from `ServiceView` instead of the inline fallback chain.
  // Project-pure metadata (tags, description, archived_at, deploy_lock_*,
  // created_at, updated_at, display_name, server_id) stays read straight
  // from `ProjectRow` — those columns never lived on the deployable side
  // and the adapter owns them.
  //
  // `DeployableForApi` is the adapter's permissive structural input type:
  // looser unions than the canonical `ServiceRow` (e.g. `status?: string`
  // vs the service status union). `serviceViewFromRows` reads
  // every service field via optional chaining + `??` fallback, so an
  // input that's a value-compatible subset of `ServiceRow` resolves the
  // same view at runtime. The cast crosses only the TypeScript boundary
  // and is safe for this call shape.
  const view = serviceViewFromRows(
    project,
    deployable as unknown as Parameters<typeof serviceViewFromRows>[1],
  );
  const { port, image } = {
    port: view.assignedPort,
    image: view.imageUrl,
  };

  return {
    id: project.id,
    name: project.name,
    displayName: project.display_name || project.name,
    display_name: project.display_name || project.name,
    description: project.description ?? null,
    tags: parseProjectTags(project.tags ?? null),
    parent_project_id: view.parentProjectId,
    visibility: view.visibility,
    server_id: project.server_id,
    project_type: view.projectType,
    // Preserve the pre-S1 raw `0 | 1 | null | undefined` wire encoding —
    // `ServiceView.isPreview` normalizes to a boolean (useful for internal
    // branching), but this public API field has always shipped the raw DB
    // representation. Adapter-owned override per decision §6.4 ("adapters
    // preserve historic API shape; view normalizes internally").
    is_preview: deployable?.is_preview ?? project.is_preview,
    pr_number: view.prNumber,
    health_check_strategy: view.healthCheckStrategy,
    health_check_path: view.healthCheckPath,
    deploy_lock_session: project.deploy_lock_session,
    deploy_lock_at: project.deploy_lock_at,
    access_code: view.accessCode,
    access_code_iv: view.accessCodeIv,
    pending_fix: view.pendingFix,
    recovering_started_at: view.recoveringStartedAt,
    archived_at: project.archived_at,
    docker_target: view.dockerTarget,
    build_context: view.buildContext,
    status: view.status,
    container_id: view.containerId,
    image_tag: view.imageTag,
    previous_image_tag: view.previousImageTag,
    build_method: view.buildMethod,
    dockerfile_path: view.dockerfilePath,
    port,
    // Legacy consumers still read `url`; keep it aligned with
    // `preferred_url` so they pick up the port-aware host URL instead of
    // the Traefik `{name}.localhost` fallback on containerized installs.
    url: port ? getPreferredProjectUrl(project.name, port) : null,
    preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
    urls: port ? getProjectUrls(project.name, port) : [],
    publicUrl: view.publicUrl,
    source: view.source,
    imageUrl: image,
    imageCmd: parseImageCmd(view.imageCmdRaw),
    containerPort: view.containerPort,
    created_at: normalizeTimestamp(project.created_at),
    updated_at: normalizeTimestamp(project.updated_at),
  };
}

const COMPOSE_INTERNAL_SERVICE_NAME_RE =
  /(^|[/_-])(postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|sqlite|clickhouse|minio)([/_.:-]|$)/i;

function isComposeInternalDependency(service: ServiceRow): boolean {
  if (service.kind !== 'compose-child') return false;
  const displayName = getDeployableServiceDisplayName(service);
  const image = service.image_url ?? service.image_tag ?? '';
  return (
    COMPOSE_INTERNAL_SERVICE_NAME_RE.test(displayName) ||
    COMPOSE_INTERNAL_SERVICE_NAME_RE.test(image)
  );
}

export function getDeployableServiceRouteName(service: ServiceRow): string {
  return deriveProjectSlug(getDeployableServiceDisplayName(service));
}

export type DeployableServiceDomainMapping = Pick<
  DomainMappingRow,
  'service_id' | 'domain' | 'status' | 'path_prefix'
>;

export interface DeployableServiceUrlOptions {
  domainMappings?: readonly DeployableServiceDomainMapping[];
  autoRouteName?: string | null;
}

type DomainMappingLookup = {
  listDomainMappings?: () => Promise<DomainMappingRow[]> | DomainMappingRow[];
  listDomainMappingsForService?: (
    serviceId: string,
  ) => Promise<DomainMappingRow[]> | DomainMappingRow[];
};

function projectUrlFromExternalUrl(url: string): ProjectUrl {
  try {
    const parsed = new URL(url);
    return {
      url,
      type: 'public',
      host: parsed.hostname,
      reachable: 'external',
    };
  } catch {
    return { url, type: 'public', reachable: 'external' };
  }
}

function selectDomainMappingUrl(
  mappings: readonly DeployableServiceDomainMapping[] | undefined,
): string | null {
  const activeMappings = [...(mappings ?? [])]
    .filter((mapping) => mapping.status === 'active' && mapping.domain.trim().length > 0)
    .sort((a, b) => {
      const aRoot = a.path_prefix === '/';
      const bRoot = b.path_prefix === '/';
      if (aRoot !== bRoot) return aRoot ? -1 : 1;
      return a.path_prefix.localeCompare(b.path_prefix);
    });

  const mapping = activeMappings[0];
  if (!mapping) return null;
  const path = mapping.path_prefix === '/' ? '' : mapping.path_prefix;
  return `http://${mapping.domain}${path}`;
}

function getHostOnlyServiceUrls(service: ServiceRow, port: number): ProjectUrl[] {
  const routeName = getDeployableServiceRouteName(service);
  return getProjectUrls(routeName, port).filter(
    (route) => route.type === 'host' && route.host === 'localhost',
  );
}

export function getDeployableServiceUrls(
  service: ServiceRow,
  options: DeployableServiceUrlOptions = {},
): ProjectUrl[] {
  const port = service.assigned_port ?? null;
  if (!port || isComposeInternalDependency(service)) return [];

  if (service.public_url) {
    return [projectUrlFromExternalUrl(service.public_url)];
  }

  const mappedUrl = selectDomainMappingUrl(options.domainMappings);
  if (mappedUrl) {
    return [projectUrlFromExternalUrl(mappedUrl)];
  }

  if (options.autoRouteName) {
    return getProjectUrls(options.autoRouteName, port);
  }

  return getHostOnlyServiceUrls(service, port);
}

export function getDeployableServiceUrl(
  service: ServiceRow,
  options: DeployableServiceUrlOptions = {},
): string | null {
  return getDeployableServiceUrls(service, options)[0]?.url ?? null;
}

export function getDeployableServiceAutoRouteName(
  project: Pick<ProjectRow, 'id' | 'name'>,
  service: Pick<ServiceRow, 'id'>,
): string | null {
  return service.id === projectIdToDeployableServiceId(project.id) ? project.name : null;
}

export async function loadDomainMappingsByService(
  ctx: Pick<AppContext, 'db'>,
  services: readonly Pick<ServiceRow, 'id'>[],
): Promise<Map<string, DomainMappingRow[]>> {
  const serviceIds = new Set(services.map((service) => service.id));
  const result = new Map<string, DomainMappingRow[]>();
  for (const serviceId of serviceIds) {
    result.set(serviceId, []);
  }

  if (serviceIds.size === 0) {
    return result;
  }

  const db = ctx.db as AppContext['db'] & Partial<DomainMappingLookup>;
  if (typeof db.listDomainMappings === 'function') {
    const mappings = await db.listDomainMappings();
    for (const mapping of mappings) {
      if (!serviceIds.has(mapping.service_id)) continue;
      const serviceMappings = result.get(mapping.service_id) ?? [];
      serviceMappings.push(mapping);
      result.set(mapping.service_id, serviceMappings);
    }
    return result;
  }

  if (typeof db.listDomainMappingsForService === 'function') {
    const listDomainMappingsForService = db.listDomainMappingsForService.bind(db);
    await Promise.all(
      [...serviceIds].map(async (serviceId) => {
        result.set(serviceId, await listDomainMappingsForService(serviceId));
      }),
    );
  }

  return result;
}

export function mapServiceForApi(
  service: ServiceRow,
  environments: EnvironmentRow[] = [],
  urlOptions: DeployableServiceUrlOptions = {},
): Record<string, unknown> {
  const deployedBranch =
    environments.find((env) => env.service_id === service.id && env.type === 'production')
      ?.branch ?? null;
  const urls = getDeployableServiceUrls(service, urlOptions);
  const url = urls[0]?.url ?? null;
  return {
    id: service.id,
    name: deployableServiceIdToProjectId(service.name),
    kind: service.kind,
    project_id: service.project_id,
    parent_service_id: service.parent_service_id,
    status: service.status,
    archived_at: service.archived_at,
    archivedAt: service.archived_at,
    assigned_port: service.assigned_port,
    port: service.assigned_port,
    container_id: service.container_id,
    container_name: service.container_name,
    container_port: service.container_port,
    containerPort: service.container_port,
    image_tag: service.image_tag,
    image: service.image_url ?? service.image_tag,
    url,
    preferred_url: url,
    urls,
    imageUrl: service.image_url,
    imageCmd: parseImageCmd(service.image_cmd),
    source: service.source,
    repoUrl: service.repo_url,
    branch: service.branch,
    deployedBranch,
    dockerfilePath: service.dockerfile_path,
    dockerTarget: service.docker_target,
    buildContext: service.build_context,
    buildMethod: service.build_method,
    created_at: normalizeTimestamp(service.created_at),
    updated_at: normalizeTimestamp(service.updated_at),
  };
}

export function getAliasedField(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      return body[key];
    }
  }
  return undefined;
}

export function parseNullableTextField(
  raw: unknown,
  field: string,
): { ok: true; value: string | null | undefined } | { ok: false; field: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, field };
  const trimmed = raw.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

export function parseImageCommandField(
  raw: unknown,
): { ok: true; value: string[] | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (Array.isArray(raw)) {
    if (!raw.every((entry) => typeof entry === 'string')) return { ok: false };
    const entries = raw.map((entry) => entry.trim()).filter(Boolean);
    return { ok: true, value: entries.length > 0 ? entries : null };
  }
  if (typeof raw === 'string') {
    const entries = raw
      .split(' ')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return { ok: true, value: entries.length > 0 ? entries : null };
  }
  return { ok: false };
}

export function getDeployableServiceDisplayName(service: ServiceRow): string {
  return deployableServiceIdToProjectId(service.name);
}

export function getServiceDeleteSlug(project: ProjectRow, service: ServiceRow): string {
  return `${project.name}/${getDeployableServiceDisplayName(service)}`;
}

export async function getProjectDeletionBlockers(
  ctx: AppContext,
  project: ProjectRow,
): Promise<
  Array<{
    serviceId: string;
    serviceName: string;
    slug: string;
    kind: string;
    status: string | null;
  }>
> {
  const getDeployablesByGroup = (
    ctx.db as {
      getDeployablesByGroup?: (projectId: string) => Promise<ServiceRow[]> | ServiceRow[];
    }
  ).getDeployablesByGroup;

  const getManagedServicesByGroup = (
    ctx.db as {
      getManagedServicesByGroup?: (projectId: string) => Promise<ServiceRow[]> | ServiceRow[];
    }
  ).getManagedServicesByGroup;
  if (!getDeployablesByGroup && !getManagedServicesByGroup) {
    return [];
  }

  const [deployables, managedServices] = await Promise.all([
    getDeployablesByGroup ? getDeployablesByGroup.call(ctx.db, project.id) : [],
    getManagedServicesByGroup ? getManagedServicesByGroup.call(ctx.db, project.id) : [],
  ]);
  const services = [...deployables, ...managedServices];
  return services.map((service) => {
    const serviceName = isManagedServiceKind(service.kind)
      ? service.name
      : getDeployableServiceDisplayName(service);
    return {
      serviceId: service.id,
      serviceName,
      slug: `${project.name}/${serviceName}`,
      kind: service.kind,
      status: service.status ?? null,
    };
  });
}

export async function assertProjectHasNoActiveServices(
  ctx: AppContext,
  project: ProjectRow,
): Promise<void> {
  const blockers = await getProjectDeletionBlockers(ctx, project);
  if (blockers.length > 0) {
    throw new ProjectHasActiveServicesError(project.id, project.name, blockers);
  }
}

export const assertProjectHasNoDeployableServices = assertProjectHasNoActiveServices;

export async function createMutationPolicySnapshot(
  ctx: AppContext,
  project: ProjectRow,
): Promise<MutationPolicyCtx> {
  const [serviceRecord, circuitBreakerOpen] = await Promise.all([
    typeof ctx.db.getServices === 'function'
      ? loadServiceViewRecords(ctx.db, [project]).then((records) => records.get(project.id))
      : Promise.resolve({ service: null }),
    ctx.db.isCircuitBreakerOpen(project.id),
  ]);
  return {
    db: {
      service: serviceRecord?.service ?? null,
      isCircuitBreakerOpen: (projectId) => projectId === project.id && circuitBreakerOpen,
    },
  };
}

export async function assertProjectMutableForRoute(
  project: ProjectRow,
  ctx: AppContext,
): Promise<void> {
  assertProjectMutable(project, await createMutationPolicySnapshot(ctx, project));
}

export async function assertProjectLifecycleMutableForRoute(
  project: ProjectRow,
  action: LifecycleAction,
  ctx: AppContext,
): Promise<void> {
  assertProjectLifecycleMutable(project, action, await createMutationPolicySnapshot(ctx, project));
}

export function lifecycleErrorResponse(
  err: unknown,
): { body: Record<string, unknown>; status: 409 } | undefined {
  if (
    err instanceof ProjectArchivedError ||
    err instanceof ProjectRecoveringError ||
    err instanceof CircuitBreakerOpenError
  ) {
    return { body: err.toJSON(), status: 409 };
  }
  return undefined;
}

export async function withProjectRuntimeLock<T>(
  ctx: AppContext,
  projectId: string,
  action: string,
  run: () => Promise<T>,
): Promise<T | DeployLockedError> {
  const lockSessionId = `${action}-${projectId}-${Date.now().toString(36)}`;
  if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(projectId, lockSessionId)) {
    const lock = ctx.agentPool.getProjectLock(projectId);
    return new DeployLockedError(projectId, lock?.sessionId ?? 'unknown');
  }

  try {
    return await run();
  } finally {
    ctx.agentPool?.releaseProjectLock(projectId, lockSessionId);
  }
}
