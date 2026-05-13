import { createModuleLogger } from '../../lib/logger.js';
import { getAllIps } from '../../pipeline/traefik.js';
import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../../config/index.js';
import {
  isDockerNotFoundError,
  ManagedServicePersistenceCleanedError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import type { ToolDef } from './types.js';
import {
  backupServiceSchema,
  createBucketSchema,
  createDatabaseSchema,
  createServiceSchema,
  createServiceUserSchema,
  deleteBucketSchema,
  execServiceContainerSchema,
  getServiceLogsSchema,
  listBucketsSchema,
  listDatabasesSchema,
  listServiceBackupsSchema,
  listServicesSchema,
  managedServiceTargetSchema,
  removeServiceSchema,
  restoreServiceSchema,
  serviceNameSchema,
} from './schemas.js';

const log = createModuleLogger('tools-defs-service');
const SERVICE_CRASH_LOG_PATTERN = /PANIC|FATAL|OOM|Segmentation fault|out of memory|No space left/i;

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
    throw new ServiceOperationUnsupportedError('managed service operation', service.kind);
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

function isManagedServiceKind(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

function serviceKindMismatchResponse(service: { id: string; name: string; kind: string }) {
  return {
    status: 'blocked',
    error: 'SERVICE_KIND_MISMATCH',
    code: 'SERVICE_KIND_MISMATCH',
    service: { id: service.id, name: service.name, kind: service.kind },
    message:
      'This tool manages infrastructure services only. Use openlander_service for deployable app/worker actions.',
    _agent_guidance: {
      next_steps: [
        `Use openlander_monitor.diagnose_service with service_id="${service.id}" for deployable service diagnostics.`,
        `Use openlander_service actions with service_id="${service.id}" for deployable service lifecycle/config changes.`,
      ],
    },
  };
}

export const serviceToolDefs: ToolDef[] = [
  {
    name: 'create_service',
    riskLevel: 'medium',
    description:
      'Create a new service (database, cache, message broker, object storage, or custom container). Use when user needs a PostgreSQL, MySQL, Redis, MongoDB, RabbitMQ, MinIO (S3-compatible storage), or custom Docker image service. Provide template (postgresql/mysql/redis/mongodb/rabbitmq/minio), custom image with port, or BOTH template + image to get auto-credentials with a custom image (e.g., template="postgresql" + image="pgvector/pgvector:pg17" gives you PostgreSQL credential generation with the pgvector image). Returns { service, suggested_env } — suggested_env contains the recommended env var key/value (e.g. DATABASE_URL, RABBITMQ_URL, S3_ENDPOINT) for connecting a project. For MinIO: returns S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Call set_env_vars with the suggested key/value to save the binding, then redeploy the running project/service to apply it. Errors: INVALID_TEMPLATE, MISSING_PORT_FOR_CUSTOM_IMAGE.',
    mcpDescription:
      'Create a service. Supports template, custom image, or template + custom image combo (auto-credentials with custom image).',
    inputSchema: createServiceSchema,
    execute: async (args, { appCtx }) => {
      const targetProjectId = args['target_project_id'] as string | undefined;

      // Pre-flight (CCG #2): if target_project_id is set, verify the project
      // exists BEFORE provisioning the service. A typo otherwise creates the
      // managed service in __orphan_managed and then surfaces only as a
      // warning string — easy to miss.
      if (targetProjectId && !(await appCtx.db.getProject(targetProjectId))) {
        return {
          status: 'failed',
          error: 'TARGET_PROJECT_NOT_FOUND',
          message: `target_project_id "${targetProjectId}" does not exist. Verify the id with list_projects before retrying.`,
        };
      }

      let result: Awaited<ReturnType<typeof appCtx.serviceManager.create>>;
      try {
        result = await appCtx.serviceManager.create({
          name: args['name'] as string,
          template: args['template'] as string | undefined,
          image: args['image'] as string | undefined,
          port: args['port'] as number | undefined,
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
        throw err;
      }

      let attachWarning: string | undefined;
      let resolvedProjectId: string | undefined;
      let droppedKeys: string[] | undefined;
      if (targetProjectId) {
        try {
          const moved = await appCtx.db.attachServiceToProject(result.id, targetProjectId);
          resolvedProjectId = moved.targetProjectId;
          if (moved.droppedEnvVarKeys.length > 0 || moved.droppedSecretFiles.length > 0) {
            droppedKeys = [...moved.droppedEnvVarKeys, ...moved.droppedSecretFiles];
          }
        } catch (err) {
          attachWarning = `attach to ${targetProjectId} failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      const suggestedEnv = appCtx.serviceManager.getSuggestedEnv(result);

      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const legacyPort = result.assigned_port ?? result.port;
      return {
        status: 'created',
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
        ...(resolvedProjectId ? { attached_to: resolvedProjectId } : {}),
        ...(droppedKeys && resolvedProjectId
          ? {
              dropped_on_attach: droppedKeys,
              _agent_notice: `${String(droppedKeys.length)} env var(s) / secret file(s) collided with target group keys and were dropped (target wins). Re-set them on ${resolvedProjectId} if needed.`,
            }
          : {}),
        ...(attachWarning ? { warnings: [attachWarning] } : {}),
        suggested_env: suggestedEnv,
        externalAccess: getServiceExternalAccess(legacyPort ?? null),
        _agent_guidance: {
          next_steps: [
            'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
            'Then redeploy the project with create_deploy_plan + execute_deploy_plan for changes to take effect.',
          ],
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_services',
    riskLevel: 'low',
    description:
      'List all services (databases, caches, custom containers) with status, type, and connection details. Agent responses include parsed credentials; MCP responses intentionally omit credential values and expose them only through get_service_credentials. Pass include_orphans=true to also list OpenLander-managed service containers that are not registered in the services table.',
    mcpDescription:
      'List infrastructure services with type, status, exposed port, and optional orphan service containers. Credentials are omitted; use get_service_credentials when needed.',
    inputSchema: listServicesSchema,
    execute: async (_args, { appCtx, target }) => {
      const includeOrphans = (_args['include_orphans'] as boolean | undefined) ?? false;
      const allServices = await appCtx.serviceManager.list();
      const services = allServices.filter((service) => isManagedServiceKind(service.kind));
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
              network: SHARED_NETWORK_NAME,
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
              `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
              'For managed service containers, use http://ol-svc-{service-name}:{port} (DNS auto-resolved). Deployable app containers use http://ol-{project-name}:{port}.',
              'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
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
        network: SHARED_NETWORK_NAME,
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
            `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
            'For managed service containers, use http://ol-svc-{service-name}:{port} (DNS auto-resolved). Deployable app containers use http://ol-{project-name}:{port}.',
            'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
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
