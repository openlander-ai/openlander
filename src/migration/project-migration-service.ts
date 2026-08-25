import { DOCKER_LABELS } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { ServiceRow } from '../db/types.js';
import {
  PostgresMigrationSelectionRequiredError,
  PostgresMigrationSourceNotFoundError,
  ProjectNotFoundError,
} from '../errors.js';
import { EnvManager } from '../pipeline/env.js';
import type { RuntimeBackend } from '../pipeline/runtime/index.js';
import type { AllContainerInfo } from '../pipeline/docker.js';
import { renderProjectMigrationMarkdown } from './markdown.js';
import { createProjectMigrationTargetComparison } from './target-mapping.js';
import { renderProjectMigrationTargetMarkdown } from './target-markdown.js';
import type { ProjectMigrationTargetComparisonV1 } from './target-types.js';
import { createPostgresMigrationRunbook as buildPostgresMigrationRunbook } from './postgres-runbook.js';
import { renderPostgresMigrationRunbookMarkdown } from './postgres-runbook-markdown.js';
import type {
  PostgresMigrationRunbookBundle,
  PostgresMigrationRunbookV1,
  PostgresMigrationTarget,
} from './postgres-runbook-types.js';
import { PostgresMigrationExecutionService } from './postgres-migration-execution.js';
import type {
  PostgresMigrationPreflightV1,
  PostgresMigrationRehearsalTargetInput,
  PostgresMigrationRehearsalV1,
} from './postgres-preflight-types.js';
import {
  PROJECT_MIGRATION_SCHEMA_VERSION,
  type MigrationConnection,
  type MigrationDomainRoute,
  type MigrationEnvironment,
  type MigrationEnvMetadata,
  type MigrationReadiness,
  type MigrationReadinessCheck,
  type MigrationRuntimeInspection,
  type MigrationRuntimeWarning,
  type MigrationSecretFileMetadata,
  type MigrationService,
  type MigrationVolume,
  type ProjectMigrationBundle,
  type ProjectMigrationSnapshotV1,
} from './types.js';

type MigrationDatabase = Pick<
  Database,
  | 'getProject'
  | 'getServices'
  | 'listServiceConnectionsByProject'
  | 'listDomainMappings'
  | 'listEnvVarMetadataByProject'
  | 'listSecretFileMetadataByProject'
  | 'listProjectEnvironments'
  | 'getEnvironmentsByServiceIds'
  | 'getLastDeployLogsForServices'
  | 'getSetting'
>;

interface RuntimeSnapshot {
  inspection: MigrationRuntimeInspection;
  containersByServiceId: Map<string, AllContainerInfo>;
  volumes: MigrationVolume[];
}

function compareText(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? '').localeCompare(right ?? '', 'en');
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').sort(compareText)
      : [];
  } catch {
    return [];
  }
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string').sort(compareText)
      : [];
  } catch {
    return [];
  }
}

function sanitizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    // Migration artifacts must never carry credential-bearing query strings or fragments.
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/^(https?:\/\/)[^/@\s]+@/i, '$1');
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function diskUsageByVolume(raw: unknown): Map<string, number> {
  const root = asRecord(raw);
  const rows = Array.isArray(root?.['Volumes']) ? (root['Volumes'] as unknown[]) : [];
  const result = new Map<string, number>();
  for (const row of rows) {
    const record = asRecord(row);
    const name = readString(record, 'Name');
    const usage = asRecord(record?.['UsageData']);
    const size = readNumber(usage, 'Size');
    if (name && size !== null && size >= 0) result.set(name, size);
  }
  return result;
}

function isImmutableImageReference(reference: string | null): boolean {
  return reference?.includes('@sha256:') === true;
}

function migrationServiceKind(service: ServiceRow): MigrationService['kind'] {
  // Early Compose imports stored the root as `git` while retaining
  // build_method=compose. Export the public resource kind, not the legacy row shape.
  return service.kind === 'git' && service.build_method === 'compose' ? 'compose' : service.kind;
}

function findContainerForService(
  service: ServiceRow,
  containers: readonly AllContainerInfo[],
  projectName: string,
  topLevelDeployableCount: number,
): AllContainerInfo | undefined {
  if (service.container_id) {
    const byId = containers.find(
      (container) =>
        container.id === service.container_id ||
        container.id.startsWith(service.container_id ?? '') ||
        service.container_id?.startsWith(container.id),
    );
    if (byId) return byId;
  }
  if (service.container_name) {
    const byName = containers.find((container) => container.name === service.container_name);
    if (byName) return byName;
  }
  const byServiceLabel = containers.find((container) => {
    const label = container.labels[DOCKER_LABELS.SERVICE];
    return label === service.id || label === service.name;
  });
  if (byServiceLabel) return byServiceLabel;
  if (service.kind === 'compose-child') {
    const composeName = service.name.split('/').pop() ?? service.name;
    const byComposeLabel = containers.find(
      (container) =>
        container.composeProject === projectName &&
        container.labels['com.docker.compose.service'] === composeName,
    );
    if (byComposeLabel) return byComposeLabel;
  }
  if (topLevelDeployableCount === 1 && service.parent_service_id === null) {
    return containers.find((container) => container.labels[DOCKER_LABELS.PROJECT] === projectName);
  }
  return undefined;
}

function volumeSort(left: MigrationVolume, right: MigrationVolume): number {
  return (
    compareText(left.name ?? left.source, right.name ?? right.source) ||
    compareText(left.destination, right.destination)
  );
}

async function inspectRuntime(
  runtime: RuntimeBackend,
  project: { id: string; name: string },
  services: readonly ServiceRow[],
  checkedAt: string,
): Promise<RuntimeSnapshot> {
  const warnings: MigrationRuntimeWarning[] = [];
  let available = false;
  try {
    available = await runtime.ping();
  } catch {
    available = false;
  }

  if (!available) {
    warnings.push({
      code: 'DOCKER_UNAVAILABLE',
      message: 'Docker runtime metadata could not be read; stored Project metadata was exported.',
    });
    return {
      inspection: {
        status: 'unavailable',
        checked_at: checkedAt,
        container_count: 0,
        matched_container_count: 0,
        volume_count: 0,
        warnings,
      },
      containersByServiceId: new Map(),
      volumes: [],
    };
  }

  const [containerResult, volumeResult, diskResult] = await Promise.allSettled([
    runtime.listAllContainers(undefined, { failOnError: true }),
    runtime.listVolumes(),
    runtime.getDiskUsage(),
  ]);
  const containers = containerResult.status === 'fulfilled' ? containerResult.value : [];
  const listedVolumes = volumeResult.status === 'fulfilled' ? volumeResult.value : [];
  const sizeByName =
    diskResult.status === 'fulfilled'
      ? diskUsageByVolume(diskResult.value)
      : new Map<string, number>();
  if (containerResult.status === 'rejected') {
    warnings.push({
      code: 'CONTAINER_INVENTORY_FAILED',
      message: 'Docker was reachable, but its container inventory could not be read.',
    });
  }
  if (volumeResult.status === 'rejected') {
    warnings.push({
      code: 'VOLUME_INVENTORY_FAILED',
      message: 'Docker was reachable, but its volume inventory could not be read.',
    });
  }
  if (diskResult.status === 'rejected') {
    warnings.push({
      code: 'DISK_USAGE_FAILED',
      message: 'Docker volume sizes could not be read.',
    });
  }

  const containersByServiceId = new Map<string, AllContainerInfo>();
  const topLevelDeployableCount = services.filter(
    (service) =>
      ['git', 'image', 'compose'].includes(service.kind) && service.parent_service_id === null,
  ).length;
  for (const service of services) {
    const container = findContainerForService(
      service,
      containers,
      project.name,
      topLevelDeployableCount,
    );
    if (container) containersByServiceId.set(service.id, container);
  }

  const serviceIdByContainerId = new Map(
    [...containersByServiceId.entries()].map(([serviceId, container]) => [container.id, serviceId]),
  );
  const projectContainerIds = new Set(
    containers
      .filter((container) => {
        const projectLabel = container.labels[DOCKER_LABELS.PROJECT];
        return (
          projectLabel === project.id ||
          projectLabel === project.name ||
          container.composeProject === project.name ||
          serviceIdByContainerId.has(container.id)
        );
      })
      .map((container) => container.id),
  );
  const volumeByKey = new Map<string, MigrationVolume>();
  for (const container of containersByServiceId.values()) {
    const serviceId = serviceIdByContainerId.get(container.id);
    if (!serviceId) continue;
    for (const mount of container.mounts ?? []) {
      if (mount.type !== 'volume' && mount.type !== 'bind') continue;
      const key = `${mount.type}:${mount.name ?? mount.source}:${mount.destination}`;
      const existing = volumeByKey.get(key);
      if (existing) {
        existing.service_ids = [...new Set([...existing.service_ids, serviceId])].sort(compareText);
        continue;
      }
      volumeByKey.set(key, {
        id: key,
        name: mount.name,
        type: mount.type,
        source: mount.source,
        destination: mount.destination,
        driver: mount.driver,
        read_only: mount.readOnly,
        size_bytes: mount.name ? (sizeByName.get(mount.name) ?? null) : null,
        service_ids: [serviceId],
      });
    }
  }

  const serviceNames = new Set(services.flatMap((service) => [service.id, service.name]));
  const composeRootServiceIds = services
    .filter(
      (service) =>
        migrationServiceKind(service) === 'compose' && service.parent_service_id === null,
    )
    .map((service) => service.id)
    .sort(compareText);
  for (const listed of listedVolumes) {
    const record = asRecord(listed);
    const name = readString(record, 'Name');
    if (!name) continue;
    const labels = asRecord(record?.['Labels']);
    const projectLabel = readString(labels, DOCKER_LABELS.PROJECT);
    const serviceLabel = readString(labels, DOCKER_LABELS.SERVICE);
    const composeProjectLabel = readString(labels, 'com.docker.compose.project');
    const relevant =
      [...volumeByKey.values()].some((volume) => volume.name === name) ||
      projectLabel === project.id ||
      projectLabel === project.name ||
      composeProjectLabel === project.id ||
      composeProjectLabel === project.name ||
      (serviceLabel !== null && serviceNames.has(serviceLabel));
    if (!relevant) continue;
    const directlyLabeledServiceIds = services
      .filter((service) => serviceLabel === service.id || serviceLabel === service.name)
      .map((service) => service.id)
      .sort(compareText);
    const serviceIds = [
      ...new Set([
        ...directlyLabeledServiceIds,
        ...(composeProjectLabel === project.id || composeProjectLabel === project.name
          ? composeRootServiceIds
          : []),
      ]),
    ].sort(compareText);
    const destination = readString(labels, DOCKER_LABELS.MOUNT_PATH);
    const key = `volume:${name}:${destination ?? ''}`;
    if (
      !volumeByKey.has(key) &&
      ![...volumeByKey.values()].some((volume) => volume.name === name)
    ) {
      volumeByKey.set(key, {
        id: key,
        name,
        type: 'volume',
        source: name,
        destination,
        driver: readString(record, 'Driver'),
        read_only: false,
        size_bytes: sizeByName.get(name) ?? readNumber(asRecord(record?.['UsageData']), 'Size'),
        service_ids: serviceIds,
      });
    }
  }

  const volumes = [...volumeByKey.values()].sort(volumeSort);
  return {
    inspection: {
      status: warnings.length > 0 ? 'partial' : 'complete',
      checked_at: checkedAt,
      // Never expose host-wide inventory counts through a Project-scoped snapshot.
      container_count: projectContainerIds.size,
      matched_container_count: containersByServiceId.size,
      volume_count: volumes.length,
      warnings,
    },
    containersByServiceId,
    volumes,
  };
}

function buildReadiness(
  services: readonly MigrationService[],
  volumes: readonly MigrationVolume[],
  routes: readonly MigrationDomainRoute[],
  envVars: readonly MigrationEnvMetadata[],
  secretFiles: readonly MigrationSecretFileMetadata[],
  runtime: MigrationRuntimeInspection,
): MigrationReadiness {
  const checks: MigrationReadinessCheck[] = [];
  const deployables = services.filter((service) =>
    ['git', 'image', 'compose'].includes(service.kind),
  );
  if (deployables.length === 0) {
    checks.push({
      code: 'NO_DEPLOYABLE_SERVICE',
      level: 'blocker',
      message: 'The Project has no Application or Compose resource to migrate.',
      service_id: null,
    });
  }

  for (const service of deployables) {
    const sourceMissing =
      ((service.kind === 'git' || service.kind === 'compose') && !service.source.repo_url) ||
      (service.kind === 'image' && !service.source.image_reference);
    if (sourceMissing) {
      checks.push({
        code: 'SOURCE_REFERENCE_MISSING',
        level: 'blocker',
        message: 'A required repository or image reference is missing.',
        service_id: service.id,
      });
      continue;
    }
    if (
      (service.kind === 'git' || service.kind === 'compose') &&
      !service.last_deploy?.commit_sha
    ) {
      checks.push({
        code: 'DEPLOY_REVISION_MISSING',
        level: 'warning',
        message: 'No deployed commit SHA is available; select and verify an exact revision.',
        service_id: service.id,
      });
    }
    if (service.kind === 'image') {
      if (!isImmutableImageReference(service.source.image_reference)) {
        checks.push({
          code: 'IMAGE_REFERENCE_MUTABLE',
          level: 'warning',
          message: 'The image reference is not pinned to a sha256 digest.',
          service_id: service.id,
        });
      }
      if (!service.source.image_id) {
        checks.push({
          code: 'IMAGE_ID_MISSING',
          level: 'warning',
          message: 'The runtime image ID could not be recorded.',
          service_id: service.id,
        });
      }
    }
    if (
      service.runtime_role === 'application' &&
      (!service.runtime.health_check_strategy || service.runtime.health_check_strategy === 'none')
    ) {
      checks.push({
        code: 'HEALTH_CHECK_MISSING',
        level: 'warning',
        message: 'No explicit health check is stored for this workload.',
        service_id: service.id,
      });
    }
    if (service.kind === 'compose') {
      checks.push({
        code: 'COMPOSE_DEFINITION_REVIEW_REQUIRED',
        level: 'warning',
        message:
          'Review Compose files, overlays, profiles, and the traffic-service selection manually.',
        service_id: service.id,
      });
    }
  }

  for (const service of services.filter((entry) =>
    ['postgres', 'mysql', 'redis', 'mongo', 'neo4j', 'minio'].includes(entry.kind),
  )) {
    checks.push({
      code: 'STATEFUL_DATA_EXPORT_REQUIRED',
      level: 'warning',
      message:
        'Use resource-specific logical export/import; OpenLander volume backups are not a portable cloud migration format.',
      service_id: service.id,
    });
  }

  if (volumes.length > 0) {
    checks.push({
      code: 'PERSISTENT_VOLUME_TRANSFER_REQUIRED',
      level: 'warning',
      message: `${String(volumes.length)} persistent volume or bind mount(s) require an explicit data-transfer plan.`,
      service_id: null,
    });
  }
  if (envVars.length > 0) {
    checks.push({
      code: 'TARGET_ENV_INPUT_REQUIRED',
      level: 'warning',
      message: `${String(envVars.length)} environment-variable value(s) are excluded and must be entered at the destination.`,
      service_id: null,
    });
  }
  if (secretFiles.length > 0) {
    checks.push({
      code: 'TARGET_SECRET_FILE_INPUT_REQUIRED',
      level: 'warning',
      message: `${String(secretFiles.length)} project secret file(s) must be recreated at the destination.`,
      service_id: null,
    });
  }
  if (routes.length > 0) {
    checks.push({
      code: 'DOMAIN_CUTOVER_REQUIRED',
      level: 'warning',
      message: `${String(routes.length)} custom domain route(s) require destination validation and DNS cutover.`,
      service_id: null,
    });
  }
  for (const warning of runtime.warnings) {
    checks.push({
      code: warning.code,
      level: 'warning',
      message: warning.message,
      service_id: null,
    });
  }
  if (runtime.status === 'complete') {
    const composeParentIds = new Set(
      services
        .filter((service) => service.parent_service_id !== null)
        .map((service) => service.parent_service_id),
    );
    const missingRuntimeMetadata = services.filter(
      (service) =>
        !service.archived_at &&
        service.runtime_role !== 'job' &&
        !composeParentIds.has(service.id) &&
        !service.runtime.container_state &&
        !service.runtime.container_id,
    );
    if (missingRuntimeMetadata.length > 0) {
      checks.push({
        code: 'RUNTIME_METADATA_INCOMPLETE',
        level: 'warning',
        message: `${String(missingRuntimeMetadata.length)} active service(s) had no observable Docker container metadata.`,
        service_id: null,
      });
    }
    for (const service of services) {
      if (service.runtime.container_id && !service.runtime.container_state) {
        checks.push({
          code: 'RUNTIME_CONTAINER_UNMATCHED',
          level: 'warning',
          message: 'The stored container ID was not present in the Docker inventory.',
          service_id: service.id,
        });
      }
    }
  }

  checks.push({
    code: 'SECRET_VALUES_EXCLUDED',
    level: 'pass',
    message: 'Environment values, global secrets, and secret file contents are excluded.',
    service_id: null,
  });
  checks.sort(
    (left, right) =>
      ({ blocker: 0, warning: 1, pass: 2 })[left.level] -
        { blocker: 0, warning: 1, pass: 2 }[right.level] ||
      compareText(left.service_id, right.service_id) ||
      compareText(left.code, right.code),
  );
  return {
    status: checks.some((check) => check.level === 'blocker')
      ? 'blocked'
      : checks.some((check) => check.level === 'warning')
        ? 'needs_attention'
        : 'ready',
    checks,
  };
}

export class ProjectMigrationService {
  private readonly postgresExecution: PostgresMigrationExecutionService;

  constructor(
    private readonly db: MigrationDatabase,
    private readonly runtime: RuntimeBackend,
  ) {
    this.postgresExecution = new PostgresMigrationExecutionService(db, runtime);
  }

  async createSnapshot(projectId: string): Promise<ProjectMigrationSnapshotV1> {
    const generatedAt = new Date().toISOString();
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const [ownedServices, connections, domainRows, envRows, secretRows, projectEnvironments] =
      await Promise.all([
        this.db.getServices({ project_id: project.id }),
        this.db.listServiceConnectionsByProject(project.id),
        this.db.listDomainMappings(),
        this.db.listEnvVarMetadataByProject(project.id),
        this.db.listSecretFileMetadataByProject(project.id),
        this.db.listProjectEnvironments(project.id),
      ]);
    const ownedIds = new Set(ownedServices.map((service) => service.id));
    const connectedIds = connections
      .map((connection) => connection.service_id_provider)
      .filter((serviceId) => !ownedIds.has(serviceId));
    const connectedServices =
      connectedIds.length > 0 ? await this.db.getServices({ ids: connectedIds }) : [];
    const allServices = [...ownedServices, ...connectedServices].filter(
      (service, index, rows) =>
        rows.findIndex((candidate) => candidate.id === service.id) === index,
    );
    const serviceIds = allServices.map((service) => service.id);
    const [runtimeEnvironments, lastDeploys, runtimeSnapshot] = await Promise.all([
      this.db.getEnvironmentsByServiceIds(serviceIds),
      this.db.getLastDeployLogsForServices(serviceIds),
      inspectRuntime(this.runtime, project, allServices, generatedAt),
    ]);

    const services: MigrationService[] = allServices
      .map((service) => {
        const container = runtimeSnapshot.containersByServiceId.get(service.id);
        const deploy = lastDeploys.get(service.id);
        return {
          id: service.id,
          project_id: service.project_id,
          ownership: service.project_id === project.id ? 'project' : 'connected',
          name: service.name,
          kind: migrationServiceKind(service),
          runtime_role: service.runtime_role,
          parent_service_id: service.parent_service_id,
          archived_at: service.archived_at,
          source: {
            type: service.source,
            repo_url: sanitizeUrl(service.repo_url),
            branch: service.branch,
            dockerfile_path: service.dockerfile_path,
            docker_target: service.docker_target,
            build_context: service.build_context,
            build_method: service.build_method,
            image_reference: sanitizeUrl(service.image_url ?? service.image_tag),
            image_id: container?.imageId ?? null,
            image_command: service.image_cmd,
          },
          runtime: {
            status: service.status,
            container_id: service.container_id,
            container_name: service.container_name ?? container?.name ?? null,
            container_state: container?.state ?? null,
            container_status: container?.status ?? null,
            assigned_port: service.assigned_port,
            container_port: service.container_port,
            health_check_strategy: service.health_check_strategy,
            health_check_path: service.health_check_path,
            public_url: sanitizeUrl(service.public_url),
          },
          last_deploy: deploy
            ? {
                deploy_id: deploy.id,
                status: deploy.status,
                commit_sha: deploy.commit_sha,
                created_at: deploy.created_at,
              }
            : null,
        } satisfies MigrationService;
      })
      .sort(
        (left, right) =>
          compareText(left.kind, right.kind) ||
          compareText(left.name, right.name) ||
          compareText(left.id, right.id),
      );

    const environments: MigrationEnvironment[] = [
      ...projectEnvironments.map((environment) => ({
        id: environment.id,
        key: environment.key,
        display_name: environment.display_name,
        scope: 'project' as const,
        service_id: null,
        tier: environment.tier,
        promotion_order: environment.promotion_order,
        branch: null,
        status: null,
      })),
      ...runtimeEnvironments.map((environment) => ({
        id: environment.id,
        key: environment.type,
        display_name: environment.type,
        scope: 'service' as const,
        service_id: environment.service_id,
        tier: environment.type,
        promotion_order: null,
        branch: environment.branch,
        status: environment.status,
      })),
    ].sort(
      (left, right) =>
        compareText(left.key, right.key) ||
        compareText(left.service_id, right.service_id) ||
        compareText(left.id, right.id),
    );

    const serviceConnections: MigrationConnection[] = connections
      .map((connection) => ({
        id: connection.id,
        service_id_consumer: connection.service_id_consumer,
        service_id_provider: connection.service_id_provider,
        environment_id: connection.environment_id,
        auto_injected_env_keys: parseStringArray(connection.auto_injected_env_keys),
      }))
      .sort(
        (left, right) =>
          compareText(left.service_id_consumer, right.service_id_consumer) ||
          compareText(left.service_id_provider, right.service_id_provider) ||
          compareText(left.id, right.id),
      );
    const serviceIdSet = new Set(serviceIds);
    const domainRoutes: MigrationDomainRoute[] = domainRows
      .filter((route) => serviceIdSet.has(route.service_id))
      .map((route) => ({
        id: route.id,
        service_id: route.service_id,
        domain: route.domain,
        path_prefix: route.path_prefix,
        upstream_path_prefix: route.upstream_path_prefix,
        strip_prefix: route.strip_prefix,
        target_port: route.target_port,
        tls_enabled: route.tls_enabled,
        status: route.status,
      }))
      .sort(
        (left, right) =>
          compareText(left.domain, right.domain) ||
          compareText(left.path_prefix, right.path_prefix) ||
          compareText(left.id, right.id),
      );
    const environmentVariables: MigrationEnvMetadata[] = envRows
      .map(
        (row) =>
          ({
            key: row.key,
            scope: row.environment_id ? 'environment' : row.service_id ? 'service' : 'project',
            service_id: row.service_id,
            environment_id: row.environment_id,
            sensitive: EnvManager.isSensitiveKey(row.key),
            public: EnvManager.isPublicKey(row.key),
          }) satisfies MigrationEnvMetadata,
      )
      .sort(
        (left, right) =>
          compareText(left.scope, right.scope) ||
          compareText(left.service_id, right.service_id) ||
          compareText(left.environment_id, right.environment_id) ||
          compareText(left.key, right.key),
      );
    const secretFiles: MigrationSecretFileMetadata[] = secretRows
      .map((row) => ({
        filename: row.filename,
        mount_path: `${row.mount_path.replace(/\/$/, '')}/${row.filename}`,
        scope: 'project' as const,
      }))
      .sort(
        (left, right) =>
          compareText(left.filename, right.filename) ||
          compareText(left.mount_path, right.mount_path),
      );
    const readiness = buildReadiness(
      services,
      runtimeSnapshot.volumes,
      domainRoutes,
      environmentVariables,
      secretFiles,
      runtimeSnapshot.inspection,
    );

    return {
      schema_version: PROJECT_MIGRATION_SCHEMA_VERSION,
      generated_at: generatedAt,
      project: {
        id: project.id,
        name: project.name,
        display_name: project.display_name || project.name,
        description: project.description ?? null,
        tags: parseTags(project.tags),
        archived_at: project.archived_at,
      },
      environments,
      services,
      service_connections: serviceConnections,
      volumes: runtimeSnapshot.volumes,
      domain_routes: domainRoutes,
      environment_variables: environmentVariables,
      secret_files: secretFiles,
      runtime_inspection: runtimeSnapshot.inspection,
      readiness,
      export_policy: {
        secret_values_included: false,
        global_secrets_included: false,
        secret_file_contents_included: false,
        data_payloads_included: false,
      },
    };
  }

  async createBundle(projectId: string): Promise<ProjectMigrationBundle> {
    const snapshot = await this.createSnapshot(projectId);
    const targetComparison = createProjectMigrationTargetComparison(snapshot);
    return {
      snapshot,
      document_markdown: renderProjectMigrationMarkdown(snapshot),
      target_comparison: targetComparison,
      target_document_markdown: renderProjectMigrationTargetMarkdown(targetComparison),
    };
  }

  async createTargetComparison(projectId: string): Promise<ProjectMigrationTargetComparisonV1> {
    return createProjectMigrationTargetComparison(await this.createSnapshot(projectId));
  }

  async createPostgresMigrationRunbook(
    projectId: string,
    target: PostgresMigrationTarget,
    serviceId?: string,
  ): Promise<PostgresMigrationRunbookV1> {
    const snapshot = await this.createSnapshot(projectId);
    const candidates = snapshot.services.filter(
      (service) =>
        service.kind === 'postgres' &&
        service.ownership === 'project' &&
        service.archived_at === null,
    );
    const selected = serviceId
      ? candidates.find((service) => service.id === serviceId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!serviceId && candidates.length > 1) {
      throw new PostgresMigrationSelectionRequiredError(
        projectId,
        candidates
          .map((service) => ({ service_id: service.id, service_name: service.name }))
          .sort(
            (left, right) =>
              compareText(left.service_name, right.service_name) ||
              compareText(left.service_id, right.service_id),
          ),
      );
    }
    if (!selected) throw new PostgresMigrationSourceNotFoundError(projectId, serviceId);
    return buildPostgresMigrationRunbook(snapshot, selected, target);
  }

  async createPostgresMigrationRunbookBundle(
    projectId: string,
    target: PostgresMigrationTarget,
    serviceId?: string,
  ): Promise<PostgresMigrationRunbookBundle> {
    const runbook = await this.createPostgresMigrationRunbook(projectId, target, serviceId);
    return {
      runbook,
      document_markdown: renderPostgresMigrationRunbookMarkdown(runbook),
    };
  }

  async createPostgresMigrationPreflight(
    projectId: string,
    serviceId?: string,
  ): Promise<PostgresMigrationPreflightV1> {
    return await this.postgresExecution.createPreflight(projectId, serviceId);
  }

  async startPostgresMigrationRehearsal(
    projectId: string,
    serviceId: string | undefined,
    target: PostgresMigrationRehearsalTargetInput,
  ): Promise<PostgresMigrationRehearsalV1> {
    return await this.postgresExecution.startRehearsal(projectId, serviceId, target);
  }

  getPostgresMigrationRehearsal(projectId: string, runId: string): PostgresMigrationRehearsalV1 {
    return this.postgresExecution.getRehearsal(projectId, runId);
  }
}
