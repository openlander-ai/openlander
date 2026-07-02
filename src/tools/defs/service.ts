import { createModuleLogger } from '../../lib/logger.js';
import { getAllIps } from '../../pipeline/traefik.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { ManagedServiceLinker } from '../../pipeline/managed-service-linker.js';
import {
  describeDataSource,
  listProjectDataSources,
  readDataSource,
} from '../../data-inspector/index.js';
import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../../config/index.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../../db/service-ids.js';
import {
  isDockerNotFoundError,
  ManagedServiceNameConflictError,
  ManagedServicePersistenceCleanedError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import {
  isManagedServiceKind,
  kindToLegacyType,
  MANAGED_SERVICE_KINDS,
} from '../../db/repos/service.repo.js';
import type { ToolDef } from './types.js';
import {
  backupServiceSchema,
  createBucketSchema,
  createDatabaseSchema,
  createServiceSchema,
  createServiceUserSchema,
  describeDataSourceSchema,
  deleteBucketSchema,
  execServiceContainerSchema,
  getServiceLogsSchema,
  listDataSourcesSchema,
  listBucketsSchema,
  listDatabasesSchema,
  listServiceBackupsSchema,
  listServicesSchema,
  managedServiceTargetSchema,
  readDataSourceSchema,
  removeServiceSchema,
  restoreServiceSchema,
  serviceNameSchema,
} from './schemas.js';

const log = createModuleLogger('tools-defs-service');
const SERVICE_CRASH_LOG_PATTERN = /PANIC|FATAL|OOM|Segmentation fault|out of memory|No space left/i;

type ServiceAttachmentLookup = (service: { project_id: string }) => {
  scope: 'project' | 'unassigned';
  attachedProjectId: string | null;
  attachedProjectName: string | null;
  network: string | null;
};

function getServiceExternalAccess(port: number | null) {
  if (!port) {
    return [];
  }

  return getAllIps().map((ip) => ({
    host: ip.address,
    port,
    type: ip.type,
  }));
}

async function buildServiceAttachmentLookup(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  services: Array<{ project_id: string }>,
): Promise<ServiceAttachmentLookup> {
  const projectIds = new Set(
    services
      .map((service) => service.project_id)
      .filter((projectId) => projectId !== ORPHAN_MANAGED_GROUP_ID),
  );
  const projects = await appCtx.db.listProjects();
  const projectNameById = new Map(
    projects
      .filter((project) => projectIds.has(project.id))
      .map((project) => [project.id, project.name] as const),
  );

  return (service: { project_id: string }) => {
    if (service.project_id === ORPHAN_MANAGED_GROUP_ID) {
      return {
        scope: 'unassigned',
        attachedProjectId: null,
        attachedProjectName: null,
        network: SHARED_NETWORK_NAME,
      };
    }
    const projectName = projectNameById.get(service.project_id);
    return {
      scope: 'project',
      attachedProjectId: service.project_id,
      attachedProjectName: projectName ?? null,
      network: projectName ? projectContainerName(projectName) : null,
    };
  };
}

async function resolveServiceNetworkName(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  service: { project_id: string },
) {
  if (service.project_id === ORPHAN_MANAGED_GROUP_ID) {
    return SHARED_NETWORK_NAME;
  }
  const project = await appCtx.db.getProject(service.project_id);
  return project ? projectContainerName(project.name) : null;
}

function getExternalConnectionStrings(
  connectionString: string | null | undefined,
  internalHost: string | null | undefined,
) {
  if (!connectionString || !internalHost) {
    return [];
  }

  return getAllIps().map((ip) => ({
    connectionString: connectionString.replace(internalHost, ip.address),
    type: ip.type,
    ip: ip.address,
  }));
}

function parseServiceCredentials(credentials: string | null): Record<string, unknown> | null {
  if (!credentials) {
    return null;
  }
  try {
    const parsed = JSON.parse(credentials) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    log.warn({ err: error }, 'Failed to parse service credentials');
    return null;
  }
}

function parseStringCredentials(credentials: string | null): Record<string, string> | undefined {
  const parsed = parseServiceCredentials(credentials);
  if (!parsed) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

async function getServiceByName(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  serviceName: string,
) {
  const services = await appCtx.serviceManager.list();
  const service = services.find((item) => item.name === serviceName);
  if (!service) {
    throw new ServiceNotFoundError(serviceName);
  }
  if (!(MANAGED_SERVICE_KINDS as readonly string[]).includes(service.kind)) {
    throw new ServiceOperationUnsupportedError('Database/Cache/Storage operation', service.kind);
  }
  return service;
}

async function resolveServiceByIdOrName(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  args: Record<string, unknown>,
) {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  if (serviceId) {
    const service = await appCtx.db.getService(serviceId);
    if (!service) throw new ServiceNotFoundError(serviceId);
    return service;
  }
  const services = await appCtx.serviceManager.list();
  const service = services.find((item) => item.name === serviceName);
  if (!service) throw new ServiceNotFoundError(serviceName);
  return service;
}

function readStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveCreateServiceScope(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  args: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      projectId: string;
      projectName: string;
    }
  | {
      ok: false;
      response: Record<string, unknown>;
    }
> {
  const projectId = readStringArg(args, 'project_id');
  const legacyTargetProjectId = readStringArg(args, 'target_project_id');
  const projectName = readStringArg(args, 'project_name');

  if ('scope' in args) {
    return {
      ok: false,
      response: {
        status: 'blocked',
        error: 'SCOPE_NOT_ACCEPTED',
        code: 'SCOPE_NOT_ACCEPTED',
        message:
          'create_service no longer accepts scope. Create Database/Cache/Storage resources inside the Project that will use them by passing project_id or project_name.',
        _agent_guidance: {
          next_steps: [
            'Call openlander_project.list_projects to get the target project id.',
            'Retry create_service with project_id or project_name and without scope.',
          ],
        },
      },
    };
  }

  if (projectId && legacyTargetProjectId && projectId !== legacyTargetProjectId) {
    return {
      ok: false,
      response: {
        status: 'blocked',
        error: 'INVALID_PARAMS',
        code: 'INVALID_PARAMS',
        message: 'project_id and target_project_id refer to different projects.',
        _agent_guidance: {
          message: 'Use exactly one project target. Prefer project_id when known.',
        },
      },
    };
  }

  const requestedProjectId = projectId ?? legacyTargetProjectId;
  if (requestedProjectId) {
    const project = await appCtx.db.getProject(requestedProjectId);
    if (!project) {
      return {
        ok: false,
        response: {
          status: 'failed',
          error: 'TARGET_PROJECT_NOT_FOUND',
          code: 'TARGET_PROJECT_NOT_FOUND',
          message: `Project "${requestedProjectId}" does not exist. Verify the id with list_projects before retrying.`,
        },
      };
    }
    return { ok: true, projectId: project.id, projectName: project.name };
  }

  if (projectName) {
    const project = await appCtx.db.getProjectByName(projectName);
    if (!project) {
      return {
        ok: false,
        response: {
          status: 'failed',
          error: 'TARGET_PROJECT_NOT_FOUND',
          code: 'TARGET_PROJECT_NOT_FOUND',
          message: `Project "${projectName}" does not exist. Verify the name with list_projects before retrying.`,
        },
      };
    }
    return { ok: true, projectId: project.id, projectName: project.name };
  }

  return {
    ok: false,
    response: {
      status: 'blocked',
      error: 'PROJECT_TARGET_REQUIRED',
      code: 'PROJECT_TARGET_REQUIRED',
      message:
        'create_service requires a Project target. Pass project_id or project_name so the Database/Cache/Storage resource is created on the same isolated network as the app that will use it.',
      required_params: ['project_id | project_name'],
      _agent_guidance: {
        next_steps: [
          'Call openlander_project.list_projects to get a project id, then retry create_service with project_id.',
          'Create app databases/caches inside the target project. Cross-project shared services are not exposed in OpenLander 0.1.',
        ],
      },
    },
  };
}

async function resolveOptionalProjectTarget(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  args: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      project: { id: string; name: string } | null;
    }
  | {
      ok: false;
      response: Record<string, unknown>;
    }
> {
  const projectId = readStringArg(args, 'project_id');
  const projectName = readStringArg(args, 'project_name');

  if (!projectId && !projectName) {
    return { ok: true, project: null };
  }

  const project = projectId
    ? await appCtx.db.getProject(projectId)
    : await appCtx.db.getProjectByName(projectName ?? '');

  if (!project) {
    const requested = projectId ?? projectName ?? '';
    return {
      ok: false,
      response: {
        status: 'failed',
        error: 'PROJECT_NOT_FOUND',
        code: 'PROJECT_NOT_FOUND',
        message: `Project "${requested}" does not exist. Verify it with openlander_project.list_projects before retrying.`,
      },
    };
  }

  if (projectName && project.name !== projectName) {
    return {
      ok: false,
      response: {
        status: 'failed',
        error: 'INVALID_PROJECT_TARGET',
        code: 'INVALID_PROJECT_TARGET',
        message: `project_id "${project.id}" resolves to "${project.name}", not "${projectName}". Use one project target.`,
      },
    };
  }

  return { ok: true, project: { id: project.id, name: project.name } };
}

function serviceKindMismatchResponse(service: { id: string; name: string; kind: string }) {
  return {
    status: 'blocked',
    error: 'SERVICE_KIND_MISMATCH',
    code: 'SERVICE_KIND_MISMATCH',
    service: { id: service.id, name: service.name, kind: service.kind },
    message:
      'This tool manages Database/Cache/Storage resources only. Use openlander_service for Application/Compose lifecycle/config actions.',
    _agent_guidance: {
      next_steps: [
        `Use openlander_monitor.diagnose_service with service_id="${service.id}" for Application/Compose diagnostics.`,
        `Use openlander_service actions with service_id="${service.id}" for Application/Compose lifecycle/config changes.`,
      ],
    },
  };
}

async function projectHasDeployableService(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  projectId: string,
): Promise<boolean> {
  if (typeof appCtx.db.getDeployablesByGroup === 'function') {
    const deployables = await appCtx.db.getDeployablesByGroup(projectId);
    return deployables.some((service) => !isManagedServiceKind(service.kind));
  }

  const deployable = await appCtx.db.getDeployableForProject(projectId);
  return Boolean(deployable);
}

function createServiceGuidance(params: {
  hasDeployableService: boolean;
  autoInjectedEnvKeys: string[];
}) {
  if (!params.hasDeployableService) {
    return {
      next_steps: [
        'Connection env was saved on the empty Project.',
        'Deploy the first Application with deploy_app using target_project_id so OpenLander attaches it to this Project after readiness succeeds.',
        'After deployment, use the returned service_id for runtime/env/domain actions.',
      ],
    };
  }

  return {
    next_steps:
      params.autoInjectedEnvKeys.length > 0
        ? [
            'Connection env was saved automatically on the target Application/Compose workload.',
            'Call update_app for the target service/project to apply it.',
          ]
        : [
            'Call set_env_vars on the Application/Compose workload with suggested_env to save the binding.',
            'Then call update_app for the target service/project to apply it.',
          ],
  };
}

function firstAppDeploySuggestedCall(projectId: string) {
  return {
    tool: 'openlander_deploy',
    arguments: {
      action: 'deploy_app',
      params: {
        target_project_id: projectId,
        name: '<app-service-name>',
        repo_url: '<git-repo-url>',
      },
    },
  };
}

export const serviceToolDefs: ToolDef[] = [
  {
    name: 'create_service',
    riskLevel: 'medium',
    description:
      'Create a new Database/Cache/Storage resource (postgresql/mysql/redis/mongodb/rabbitmq/minio, or a custom container) inside a Project. Requires project_id or project_name so the resource is attached to the Application network that will use it. Provide template, custom image with port, or BOTH template + image to get auto-credentials with a custom image (e.g., template="postgresql" + image="pgvector/pgvector:pg17"). Returns { service, scope, suggested_env } — suggested_env contains the recommended env var key/value (e.g. DATABASE_URL, REDIS_URL, S3_ENDPOINT) for connecting the Project. Call set_env_vars with the suggested key/value to save the binding, then call update_app for the running Application/Compose workload to apply it. Errors: PROJECT_TARGET_REQUIRED, INVALID_TEMPLATE, MISSING_PORT_FOR_CUSTOM_IMAGE.',
    mcpDescription:
      'Create a Database/Cache/Storage resource inside a Project. Pass project_id or project_name. Use this manual path for existing groups/shared resources; for new apps with safe DB/cache proposals, prefer deploy-plan approval. Existing Application: redeploy to apply saved env.',
    inputSchema: createServiceSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolveCreateServiceScope(appCtx, args);
      if (!target.ok) return target.response;

      let result: Awaited<ReturnType<typeof appCtx.serviceManager.create>>;
      try {
        const network = await appCtx.docker.ensureProjectNetwork(target.projectName);
        result = await appCtx.serviceManager.create({
          name: args['name'] as string,
          projectId: target.projectId,
          template: args['template'] as string | undefined,
          image: args['image'] as string | undefined,
          port: args['port'] as number | undefined,
          ...(network ? { network, aliases: [args['name'] as string] } : {}),
        });
      } catch (err) {
        if (err instanceof ManagedServicePersistenceCleanedError) {
          return {
            status: 'failed',
            error: err.code,
            code: err.code,
            message: err.message,
            details: err.details,
            _agent_guidance: {
              message:
                'The failed create_service attempt was rolled back at the Docker layer. It is safe to retry after fixing the database issue.',
            },
          };
        }
        if (err instanceof ManagedServiceNameConflictError) {
          return {
            status: 'failed',
            error: err.code,
            code: err.code,
            message: err.message,
            details: err.details,
            suggested_call: {
              tool: 'openlander_managed_service',
              arguments: {
                action: 'list_services',
                params: { include_orphans: true },
              },
            },
            _agent_guidance: {
              message:
                'A Docker container with this resource name already exists. Do not overwrite or delete it automatically; inspect existing resources and orphan containers first.',
              next_steps: [
                'Run openlander_managed_service.list_services with include_orphans=true to find the existing container.',
                'If the container belongs to data you still need, choose a different Database/Cache/Storage resource name.',
                'If it is a stale OpenLander resource from a previous test, remove it deliberately, then retry create_service.',
              ],
            },
          };
        }
        throw err;
      }

      let resolvedProjectId = target.projectId;
      let attachCleanupFailed: string | undefined;
      let droppedKeys: string[] | undefined;
      let autoInjectedEnvKeys: string[] = [];
      try {
        const linker = new ManagedServiceLinker(appCtx.db, appCtx.env);
        const linked = await linker.connect({
          projectId: target.projectId,
          service: result,
          source: 'mcp',
          credentials: parseStringCredentials(result.credentials),
        });
        resolvedProjectId = linked.resolvedProjectId;
        autoInjectedEnvKeys = linked.autoInjectedEnvKeys;
        if (linked.droppedEnvVarKeys.length > 0 || linked.droppedSecretFiles.length > 0) {
          droppedKeys = [...linked.droppedEnvVarKeys, ...linked.droppedSecretFiles];
        }
      } catch (err) {
        const attachMessage = `attach to ${target.projectId} failed: ${err instanceof Error ? err.message : String(err)}`;
        try {
          await appCtx.serviceManager.remove(result.id, { force: true });
        } catch (cleanupErr) {
          attachCleanupFailed =
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        }
        return {
          status: 'failed',
          error: 'PROJECT_ATTACH_FAILED',
          code: 'PROJECT_ATTACH_FAILED',
          message: attachMessage,
          service: { id: result.id, name: result.name },
          cleanup: attachCleanupFailed
            ? { attempted: true, success: false, error: attachCleanupFailed }
            : { attempted: true, success: true },
          _agent_guidance: {
            next_steps: [
              'Verify the project target with list_projects before retrying.',
              ...(attachCleanupFailed
                ? [`Manual cleanup may be required for service_id="${result.id}".`]
                : ['The failed service was cleaned up; it is safe to retry.']),
            ],
          },
        };
      }

      const suggestedEnv = await appCtx.serviceManager.getSuggestedEnv(result, {
        targetProjectId: resolvedProjectId,
      });
      const attachedProjectId = resolvedProjectId;
      const hasDeployableService = await projectHasDeployableService(appCtx, attachedProjectId);

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const legacyPort = result.assigned_port ?? result.port;
      return {
        status: 'created',
        scope: 'project',
        attached_to: attachedProjectId,
        attached_project_name: target.projectName,
        service: {
          id: result.id,
          name: result.name,
          // Wire contract: emit legacy vocabulary (postgresql/mongodb) regardless of
          // whether legacy `type` column is populated. kindToLegacyType ensures
          // forward-compat with post-0012 rows where legacy column may be NULL.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          type: result.type ?? kindToLegacyType(result.kind),
          status: result.status,
          // Wire key preserved; canonical source: assigned_port
          port: legacyPort,
          credentials: parseServiceCredentials(result.credentials),
        },
        ...(droppedKeys && resolvedProjectId
          ? {
              dropped_on_attach: droppedKeys,
              _agent_notice: `${String(droppedKeys.length)} env var(s) / secret file(s) collided with target group keys and were dropped (target wins). Re-set them on ${resolvedProjectId} if needed.`,
            }
          : {}),
        suggested_env: suggestedEnv,
        auto_injected_env_keys: autoInjectedEnvKeys,
        externalAccess: getServiceExternalAccess(legacyPort ?? null),
        ...(!hasDeployableService
          ? { suggested_call: firstAppDeploySuggestedCall(attachedProjectId) }
          : {}),
        _agent_guidance: createServiceGuidance({
          hasDeployableService,
          autoInjectedEnvKeys,
        }),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_services',
    riskLevel: 'low',
    description:
      'List all Database/Cache/Storage resources with status, type, and connection details. Agent responses include parsed credentials; MCP responses intentionally omit credential values and expose them only through get_service_credentials. Pass include_orphans=true to also list OpenLander infrastructure resource containers that are not registered in the resource inventory.',
    mcpDescription:
      'List Database/Cache/Storage resources with type, status, exposed port, optional project_id/project_name filter, and optional orphan resource containers. Credentials are omitted; use get_service_credentials when needed.',
    inputSchema: listServicesSchema,
    execute: async (_args, { appCtx, target }) => {
      const includeOrphans = (_args['include_orphans'] as boolean | undefined) ?? false;
      const projectTarget = await resolveOptionalProjectTarget(appCtx, _args);
      if (!projectTarget.ok) {
        return projectTarget.response;
      }
      const selectedProject = projectTarget.project;
      const allServices = await appCtx.serviceManager.list();
      let services = allServices.filter((service) => isManagedServiceKind(service.kind));
      if (selectedProject) {
        const connections = await appCtx.db.listServiceConnectionsByProject(selectedProject.id);
        const connectedServiceIds = new Set(
          connections.map((connection) => connection.service_id_provider),
        );
        services = services.filter(
          (service) =>
            service.project_id === selectedProject.id || connectedServiceIds.has(service.id),
        );
      }
      const knownContainerRefs = new Set(
        allServices.flatMap((service) => [
          service.container_id ?? '',
          service.container_name ?? '',
          service.name,
        ]),
      );
      const orphanContainers = includeOrphans
        ? (await appCtx.docker.listManagedContainers()).filter((container) => {
            if (container.labels?.[DOCKER_LABELS.ROLE] !== 'service') return false;
            return !knownContainerRefs.has(container.id) && !knownContainerRefs.has(container.name);
          })
        : [];

      if (target === 'mcp') {
        const serviceAttachment: ServiceAttachmentLookup = selectedProject
          ? () => ({
              scope: 'project' as const,
              attachedProjectId: selectedProject.id,
              attachedProjectName: selectedProject.name,
              network: projectContainerName(selectedProject.name),
            })
          : await buildServiceAttachmentLookup(appCtx, services);
        return {
          count: services.length,
          services: services.map((service) => {
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            const svcPort = service.assigned_port ?? service.port;
            const attachment = serviceAttachment(service);
            return {
              id: service.id,
              name: service.name,
              kind: service.kind,
              // Wire contract: emit legacy vocabulary (postgresql/mongodb).
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              type: service.type ?? kindToLegacyType(service.kind),
              status: service.status,
              // Wire key preserved; canonical source: assigned_port
              port: svcPort,
              scope: attachment.scope,
              attached_to: attachment.attachedProjectId,
              attached_project_id: attachment.attachedProjectId,
              attached_project_name: attachment.attachedProjectName,
              network: attachment.network,
              // Wire key preserved; canonical first, legacy fallback for pre-migration rows
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              image: service.image_url ?? service.image ?? '',
              createdAt: service.created_at,
              externalAccess: getServiceExternalAccess(svcPort ?? null),
            };
          }),
          ...(includeOrphans
            ? {
                orphan_count: orphanContainers.length,
                orphan_services: orphanContainers.map((container) => ({
                  id: container.id,
                  name:
                    container.labels?.[DOCKER_LABELS.SERVICE] ??
                    container.name.replace(/^ol-svc-/, ''),
                  containerName: container.name,
                  image: container.imageTag ?? '',
                  status: container.status,
                  port: container.port ?? null,
                  labels: container.labels ?? {},
                })),
              }
            : {}),
          _agent_guidance: {
            networking: [
              'Database/Cache/Storage resources created through MCP are Project-scoped and attached only to their Project Docker network.',
              'Create app databases/caches in the same Project as the app that uses them. Cross-project shared resources are not exposed in OpenLander 0.1.',
              'For existing Docker/PaaS migrations, inspect and back up existing volumes before changing network attachments.',
            ],
          },
        };
      }

      return {
        count: services.length,
        services: services.map((service) => {
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          const svcPort = service.assigned_port ?? service.port;
          return {
            id: service.id,
            name: service.name,
            // Wire contract: emit legacy vocabulary (postgresql/mongodb).
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            type: service.type ?? kindToLegacyType(service.kind),
            status: service.status,
            // Wire key preserved; canonical source: assigned_port
            port: svcPort,
            scope:
              selectedProject || service.project_id !== ORPHAN_MANAGED_GROUP_ID
                ? 'project'
                : 'unassigned',
            attached_to:
              selectedProject?.id ??
              (service.project_id === ORPHAN_MANAGED_GROUP_ID ? null : service.project_id),
            containerName: service.container_name,
            credentials: parseServiceCredentials(service.credentials),
          };
        }),
        ...(includeOrphans
          ? {
              orphan_count: orphanContainers.length,
              orphan_services: orphanContainers.map((container) => ({
                id: container.id,
                name:
                  container.labels?.[DOCKER_LABELS.SERVICE] ??
                  container.name.replace(/^ol-svc-/, ''),
                containerName: container.name,
                image: container.imageTag ?? '',
                status: container.status,
                port: container.port ?? null,
                labels: container.labels ?? {},
              })),
            }
          : {}),
      };
    },
  },
  {
    name: 'list_databases',
    riskLevel: 'low',
    description:
      'List databases for a named PostgreSQL or MySQL service. Use when selecting an existing database during environment setup. Returns { service, count, databases[] }. Errors: SERVICE_NOT_FOUND or unsupported service type.',
    mcpDescription: 'List databases inside a PostgreSQL or MySQL service.',
    inputSchema: listDatabasesSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const services = await appCtx.serviceManager.list();
      const service = services.find((item) => item.name === serviceName);
      if (!service) {
        throw new ServiceNotFoundError(serviceName);
      }

      // Let typed errors from serviceManager (ServiceOperationUnsupportedError,
      // ServiceContainerStateError, etc.) propagate to the caller — wrapping
      // them in raw Error loses the structured `code` / `statusCode` and
      // breaks `instanceof` matching in HTTP / MCP error handlers.
      const databases = await appCtx.serviceManager.listDatabases(service.id);
      return {
        service: service.name,
        count: databases.length,
        databases: databases.map((database) => ({
          name: database.name,
          sizeBytes: database.sizeBytes,
        })),
      };
    },
    targets: ['agent'],
  },
  {
    name: 'create_database',
    riskLevel: 'high',
    description:
      'Create a database in a named PostgreSQL or MySQL service. Use when provisioning app-specific database credentials. Returns { status, service, database, user, password, connectionString }. Errors: SERVICE_NOT_FOUND or unsupported service type.',
    mcpDescription: 'Create a database inside an existing PostgreSQL or MySQL service.',
    inputSchema: createDatabaseSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const databaseName = args['database_name'] as string;
      const services = await appCtx.serviceManager.list();
      const service = services.find((item) => item.name === serviceName);
      if (!service) {
        throw new ServiceNotFoundError(serviceName);
      }

      const result = await appCtx.serviceManager.createDatabase(service.id, databaseName);
      return {
        status: 'created',
        service: service.name,
        database: result.database,
        user: result.user,
        password: result.password,
        connectionString: result.connectionString,
      };
    },
    targets: ['agent'],
  },
  {
    name: 'list_buckets',
    riskLevel: 'low',
    description:
      'List S3 buckets in a MinIO service. Use to see what storage buckets exist. Returns { service, count, buckets[] } where each bucket has name and createdAt. Errors: SERVICE_NOT_FOUND, not a MinIO service.',
    mcpDescription: 'List S3 buckets in a MinIO object storage service.',
    inputSchema: listBucketsSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const buckets = await appCtx.serviceManager.listBuckets(service.id);
      return {
        service: service.name,
        count: buckets.length,
        buckets,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'create_bucket',
    riskLevel: 'medium',
    description:
      'Create an S3 bucket in a MinIO service. Use when setting up storage for a project. Bucket names must be 3-63 chars, lowercase, following S3 naming rules. Returns { status, service, bucket }. Errors: SERVICE_NOT_FOUND, bucket already exists, not a MinIO service.',
    mcpDescription: 'Create an S3 bucket in a MinIO object storage service.',
    inputSchema: createBucketSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const bucketName = args['bucket_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      await appCtx.serviceManager.createBucket(service.id, bucketName);
      return {
        status: 'created',
        service: service.name,
        bucket: bucketName,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'delete_bucket',
    riskLevel: 'medium',
    description:
      'Delete an empty S3 bucket from a MinIO service. The bucket must be empty before deletion. Returns { status, service, bucket, warning }. Errors: SERVICE_NOT_FOUND, bucket not empty, not a MinIO service.',
    mcpDescription: 'Delete an empty S3 bucket from a MinIO object storage service.',
    inputSchema: deleteBucketSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const bucketName = args['bucket_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      await appCtx.serviceManager.deleteBucket(service.id, bucketName);
      return {
        status: 'deleted',
        service: service.name,
        bucket: bucketName,
        warning: 'Bucket and all its contents have been permanently deleted.',
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_data_sources',
    riskLevel: 'low',
    description:
      'List Project-connected data sources that an agent can inspect through OpenLander. Returns managed Postgres/Redis sources and external env URLs as setup-required placeholders. Does not return credentials or connection strings.',
    mcpDescription:
      'List Project data sources for read-only agent inspection. Credentials are never returned.',
    inputSchema: listDataSourcesSchema,
    execute: async (args, { appCtx, identity }) => {
      if (identity?.mcpScopeKind === 'service') {
        return {
          status: 'blocked',
          error: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          code: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          message: 'Data source discovery requires a Project-scoped or instance token.',
          _agent_guidance: {
            message:
              'This service-scoped token cannot inspect Project data sources. Ask the user for a Project-scoped read token.',
          },
        };
      }
      const projectTarget = await resolveOptionalProjectTarget(appCtx, args);
      if (!projectTarget.ok) {
        return projectTarget.response;
      }
      if (!projectTarget.project) {
        return {
          status: 'failed',
          error: 'PROJECT_TARGET_REQUIRED',
          code: 'PROJECT_TARGET_REQUIRED',
          message: 'project_id or project_name is required.',
        };
      }
      const sources = await listProjectDataSources(appCtx, projectTarget.project.id);
      return {
        status: 'ok',
        project_id: projectTarget.project.id,
        project_name: projectTarget.project.name,
        count: sources.length,
        data_sources: sources,
        _agent_guidance: {
          message:
            'Use describe_data_source for schema/keyspace inspection and read_data_source for bounded read-only queries. Do not ask for raw credentials.',
          next_steps: [
            'If queryable=false, ask the user to enable Agent read access in Project Settings → Data Access.',
            'Use service_id as data_source_id for describe_data_source and read_data_source.',
          ],
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'describe_data_source',
    riskLevel: 'low',
    description:
      'Describe a managed Postgres/Redis data source after Project Data Access is enabled. Returns schema/table/column metadata or Redis keyspace metadata, not credentials or row values.',
    mcpDescription:
      'Describe a read-enabled managed data source. Requires service_id. Credentials are never returned.',
    inputSchema: describeDataSourceSchema,
    execute: async (args, { appCtx, identity }) => {
      if (identity?.mcpScopeKind === 'service') {
        return {
          status: 'blocked',
          error: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          code: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          message: 'Data source inspection requires a Project-scoped or instance token.',
          _agent_guidance: {
            message:
              'This service-scoped token cannot inspect data sources. Ask the user for a Project-scoped read token.',
          },
        };
      }
      return await describeDataSource(appCtx, args['service_id'] as string, {
        database: args['database'] as string | undefined,
        schema: args['schema'] as string | undefined,
      });
    },
    targets: ['mcp'],
  },
  {
    name: 'read_data_source',
    riskLevel: 'low',
    description:
      'Run a bounded read-only query against a managed Postgres/Redis data source after Project Data Access is enabled. Postgres accepts SELECT/read-only WITH only; Redis accepts explicit read operations only. Results are capped and audited.',
    mcpDescription:
      'Read a managed data source through bounded read-only operations. Credentials are never returned.',
    inputSchema: readDataSourceSchema,
    execute: async (args, { appCtx, identity }) => {
      if (identity?.mcpScopeKind === 'service') {
        return {
          status: 'blocked',
          error: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          code: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
          message: 'Data source reads require a Project-scoped or instance token.',
          _agent_guidance: {
            message:
              'This service-scoped token cannot query data sources. Ask the user for a Project-scoped read token.',
          },
        };
      }
      return await readDataSource(appCtx, args['service_id'] as string, args);
    },
    targets: ['mcp'],
  },
  {
    name: 'get_service_status',
    riskLevel: 'low',
    description:
      'Get the current status of a specific managed/infrastructure service. Returns { id, name, status, health, type, port, ... } where status is running/stopped and health reflects container health (healthy/unhealthy/unknown/degraded). healthDetail may be included when crash-like log patterns are detected. Errors: SERVICE_NOT_FOUND if the service target is invalid.',
    mcpDescription: 'Get service status, health, container state, and metadata.',
    inputSchema: managedServiceTargetSchema,
    execute: async (args, { appCtx }) => {
      const service = await resolveServiceByIdOrName(appCtx, args);
      if (!isManagedServiceKind(service.kind)) {
        return serviceKindMismatchResponse(service);
      }
      let health: 'healthy' | 'unhealthy' | 'unknown' | 'degraded' = 'unknown';
      let healthDetail: string | undefined;

      const containerId = service.container_id ?? service.container_name;
      if (containerId) {
        try {
          const info = (await appCtx.docker.inspectContainer(containerId)) as {
            State?: { Health?: { Status?: string } };
          };
          const dockerHealth = info.State?.Health?.Status;

          if (dockerHealth === 'healthy') {
            health = 'healthy';
          } else if (dockerHealth === 'unhealthy') {
            health = 'unhealthy';
          } else if (dockerHealth) {
            health = 'unknown';
          } else {
            const logs = await appCtx.docker.getLogs(containerId, 20);
            const matchedLine = logs
              .split(/\r?\n/)
              .find((line) => SERVICE_CRASH_LOG_PATTERN.test(line));

            if (matchedLine) {
              health = 'degraded';
              healthDetail = matchedLine.trim();
            } else {
              health = 'healthy';
            }
          }
        } catch (error) {
          log.warn(
            { err: error, serviceId: service.id, containerId },
            'Failed to derive container health for service status',
          );
          health = 'unknown';
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const svcPort = service.assigned_port ?? service.port;
      const network = await resolveServiceNetworkName(appCtx, service);
      return {
        id: service.id,
        name: service.name,
        // Wire contract: emit legacy vocabulary (postgresql/mongodb).
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        type: service.type ?? kindToLegacyType(service.kind),
        status: service.status,
        health,
        ...(healthDetail ? { healthDetail } : {}),
        // Wire key preserved; canonical source: assigned_port
        port: svcPort,
        network,
        // Wire key preserved; canonical first, legacy fallback for pre-migration rows
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        image: service.image_url ?? service.image ?? '',
        containerName: service.container_name,
        containerId: service.container_id,
        createdAt: service.created_at,
        updatedAt: service.updated_at,
        externalAccess: getServiceExternalAccess(svcPort ?? null),
        _agent_guidance: {
          networking: [
            'Database/Cache/Storage resources are attached to their Project Docker network.',
            'Use Project resources as the app database/cache path. Cross-project shared resources are not exposed in OpenLander 0.1.',
            'For existing Docker/PaaS migrations, inspect and back up existing volumes before changing network attachments.',
          ],
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'start_service',
    riskLevel: 'medium',
    description:
      'Start a stopped service. Use when a service is stopped and needs to be running. Returns { status, service }. Errors: SERVICE_NOT_FOUND.',
    mcpDescription: 'Start a stopped service container.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      await appCtx.serviceManager.start(service.id);
      return { status: 'started', service: serviceName };
    },
    targets: ['mcp'],
  },
  {
    name: 'stop_service',
    riskLevel: 'medium',
    description:
      'Stop a running service gracefully. Use when a service needs to be paused without deletion. Returns { status, service }. Errors: SERVICE_NOT_FOUND.',
    mcpDescription: 'Stop a running service container gracefully.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      await appCtx.serviceManager.stop(service.id);
      return { status: 'stopped', service: serviceName };
    },
    targets: ['mcp'],
  },
  {
    name: 'remove_service',
    riskLevel: 'high',
    description:
      'Permanently remove a service — deletes the container, volume, and ALL persistent data. DESTRUCTIVE — cannot be undone. WARNING: This deletes database files, cache data, and everything stored in the service volume. ALWAYS call backup_service BEFORE removing a service with important data. If projects reference this service, removal is blocked unless force=true. Returns { status, service, warning, connected_projects }. Errors: SERVICE_NOT_FOUND, SERVICE_IN_USE.',
    mcpDescription: 'Remove a service container and volume. Data is permanently deleted.',
    inputSchema: removeServiceSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const force = (args['force'] as boolean | undefined) ?? false;
      const service = await getServiceByName(appCtx, serviceName);
      // Wire contract: emit legacy vocabulary (postgresql/mongodb).
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const serviceType = service.type ?? kindToLegacyType(service.kind);
      const result = await appCtx.serviceManager.remove(service.id, { force });
      return {
        status: 'removed',
        service: serviceName,
        warning: `All persistent data for ${serviceType} service "${serviceName}" has been permanently deleted. This cannot be undone. If you needed the data, it is now lost. Use backup_service before remove_service in the future.`,
        ...(result.connected_projects && { connected_projects: result.connected_projects }),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'backup_service',
    riskLevel: 'medium',
    description:
      "Create a backup snapshot of a service's persistent data (database files, etc.). Returns { status, backupId, path, sizeBytes }. Use BEFORE remove_service to prevent data loss.",
    mcpDescription: 'Create a backup snapshot of service data before destructive actions.',
    inputSchema: backupServiceSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      const result = await appCtx.serviceManager.backup(service.id);
      return {
        status: 'backed_up',
        service: service.name,
        backupId: result.backupId,
        path: result.path,
        sizeBytes: result.size,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'restore_service',
    riskLevel: 'medium',
    description:
      'Restore a service volume from a backup snapshot. Stops the service container, restores the selected backup into the service volume, then starts the service again. Returns { status, service, backupId }.',
    mcpDescription: 'Restore service data from a selected backup snapshot.',
    inputSchema: restoreServiceSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      const backupId = args['backup_id'] as string;
      await appCtx.serviceManager.restore(service.id, backupId);
      return {
        status: 'restored',
        service: service.name,
        backupId,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_service_backups',
    riskLevel: 'low',
    description:
      'List available backup snapshots for a service. Returns { service, count, backups[] } with backupId, createdAt, and sizeBytes for each snapshot.',
    mcpDescription: 'List available backup snapshots for a service.',
    inputSchema: listServiceBackupsSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      const backups = await appCtx.serviceManager.listBackups(service.id);
      return {
        service: service.name,
        count: backups.length,
        backups: backups.map((backup) => ({
          backupId: backup.backupId,
          createdAt: backup.createdAt,
          sizeBytes: backup.sizeBytes,
        })),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'get_service_logs',
    riskLevel: 'low',
    description:
      'Get recent container logs for a service (database, cache, or custom container). Use when a service is in error state or behaving unexpectedly. Returns { service, logs }. Errors: SERVICE_NOT_FOUND.',
    mcpDescription: 'Get recent container logs for an infrastructure service.',
    inputSchema: getServiceLogsSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const lines = (args['lines'] as number | undefined) ?? 50;
      try {
        const logs = await appCtx.serviceManager.getLogs(service.id, lines);
        return { service: serviceName, logs };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isContainerGone = isDockerNotFoundError(error) || message.includes('is not running');
        if (isContainerGone) {
          return {
            service: serviceName,
            status: service.status,
            logs: null,
            error: `Service "${serviceName}" is in ${service.status ?? 'unknown'} state — container is not running. Logs are unavailable. Try start_service to restart, or check Docker host health.`,
          };
        }
        throw error;
      }
    },
    targets: ['mcp'],
  },
  {
    name: 'exec_service_container',
    riskLevel: 'high',
    description:
      'Execute a command inside a running service container (like docker exec). command must be an argv array, not a shell string (for example ["psql", "-U", "openlander", "-c", "SELECT 1"]). Use for installing extensions (e.g., pgvector), running SQL, debugging, or any ad-hoc command. Returns { service, command, exitCode, stdout, stderr }. Non-zero exit codes are returned (not thrown) so you can inspect the output. Errors: SERVICE_NOT_FOUND, container not running.',
    mcpDescription:
      'Run an argv-array command inside a service container. command must be string[]. Returns stdout, stderr, and exit code.',
    inputSchema: execServiceContainerSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const command = args['command'] as string[];
      const service = await getServiceByName(appCtx, serviceName);
      const timeoutMs =
        typeof args['timeout_seconds'] === 'number' ? args['timeout_seconds'] * 1000 : undefined;
      const result = await appCtx.serviceManager.exec(service.id, command, { timeoutMs });
      return {
        service: serviceName,
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.truncated ? { truncated: true } : {}),
        ...(result.exitCode === -1
          ? {
              error:
                'Command timed out. Output may be partial. The command may still be running inside the container.',
            }
          : {}),
        _agent_guidance: {
          notes: [
            'Exit code 0 means success. Non-zero means the command failed — check stderr for details.',
            'Exit code -1 means the command timed out. Use timeout_seconds to extend the limit.',
            'For database extensions: after installing, verify with a query (e.g., SELECT * FROM pg_extension).',
          ],
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'get_service_credentials',
    riskLevel: 'low',
    description:
      'Get connection credentials for a service (connection string, host, port, user, password). Use when a project needs to connect to a service. Returns { service, type, credentials, connectionString, host, port, user, password, database, externalAccess, externalConnectionStrings }. Errors: SERVICE_NOT_FOUND.',
    mcpDescription:
      'Get service connection credentials. Host is Docker internal DNS (e.g., ol-svc-pg), not localhost. Use for DATABASE_URL, REDIS_URL, etc. in projects.',
    inputSchema: managedServiceTargetSchema,
    execute: async (args, { appCtx }) => {
      const service = await resolveServiceByIdOrName(appCtx, args);
      if (!isManagedServiceKind(service.kind)) {
        return serviceKindMismatchResponse(service);
      }
      const serviceName = service.name;
      const credentials = parseServiceCredentials(service.credentials);
      const internalHost = (credentials?.['host'] as string | undefined) || null;
      const connectionString = (credentials?.['connectionString'] as string | undefined) || null;

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const svcPort = service.assigned_port ?? service.port;
      return {
        service: serviceName,
        // Wire contract: emit legacy vocabulary (postgresql/mongodb).
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        type: service.type ?? kindToLegacyType(service.kind),
        credentials,
        connectionString,
        host: internalHost,
        // Wire key preserved; prefer stored credentials port, then canonical assigned_port
        port: (credentials?.['port'] as number | undefined) || svcPort,
        user: (credentials?.['user'] as string | undefined) || null,
        password: (credentials?.['password'] as string | undefined) || null,
        database: (credentials?.['database'] as string | undefined) || null,
        externalAccess: getServiceExternalAccess(svcPort ?? null),
        externalConnectionStrings: getExternalConnectionStrings(connectionString, internalHost),
      };
    },
    targets: ['mcp'],
  },

  {
    name: 'create_service_user',
    riskLevel: 'medium',
    description:
      'Create a new user in a PostgreSQL or MySQL service with optional database grants. Use when a project needs a dedicated database user. Returns { status, service, user, password, database, connectionString }. Errors: SERVICE_NOT_FOUND, UNSUPPORTED_SERVICE_TYPE (redis, mongodb), CONTAINER_NOT_RUNNING.',
    mcpDescription: 'Create a database user with optional per-database grants.',
    inputSchema: createServiceUserSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const result = await appCtx.serviceManager.createUser(
        service.id,
        args['username'] as string,
        args['password'] as string | undefined,
        args['database'] ? { database: args['database'] as string } : undefined,
      );
      return {
        status: 'created',
        service: serviceName,
        user: result.user,
        password: result.password,
        database: result.database,
        connectionString: result.connectionString,
      };
    },
    targets: ['mcp'],
  },
];
