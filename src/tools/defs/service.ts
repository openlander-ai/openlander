import { ProjectNotFoundError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getAllIps } from '../../pipeline/traefik.js';
import type { ToolDef } from './types.js';
import {
  backupServiceSchema,
  createBucketSchema,
  createDatabaseSchema,
  createServiceDatabaseSchema,
  createServiceSchema,
  createServiceUserSchema,
  deleteBucketSchema,
  getServiceLogsSchema,
  listBucketsSchema,
  listDatabasesSchema,
  listServiceBackupsSchema,
  listServicesSchema,
  provisionDbSchema,
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
    throw new Error(`Service not found: ${serviceName}`);
  }
  return service;
}

export const serviceToolDefs: ToolDef[] = [
  {
    name: 'create_service',
    description:
      'Create a new service (database, cache, or custom container). Use when user needs a PostgreSQL, MySQL, Redis, MongoDB, or custom Docker image service. Provide either template (postgresql/mysql/redis/mongodb) or custom image with port. Returns { service, suggested_env } — suggested_env contains the recommended env var key/value (e.g. DATABASE_URL) for connecting a project. Call set_env_vars with the suggested key/value to auto-link. Errors: INVALID_TEMPLATE, MISSING_PORT_FOR_CUSTOM_IMAGE.',
    mcpDescription: 'Create a PostgreSQL, MySQL, Redis, MongoDB, or custom image service.',
    inputSchema: createServiceSchema,
    execute: async (args, { appCtx }) => {
      const result = await appCtx.serviceManager.create({
        name: args['name'] as string,
        template: args['template'] as string | undefined,
        image: args['image'] as string | undefined,
        port: args['port'] as number | undefined,
      });

      const suggestedEnv = appCtx.serviceManager.getSuggestedEnv(result);

      return {
        status: 'created',
        service: {
          id: result.id,
          name: result.name,
          type: result.type,
          status: result.status,
          port: result.port,
          credentials: parseServiceCredentials(result.credentials),
        },
        suggested_env: suggestedEnv,
        externalAccess: getServiceExternalAccess(result.port),
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
    description:
      'List all services (databases, caches, custom containers) with status, type, and connection details. Use to see what services are available and their current state. Returns { count, services[] } with id, name, type, status, port, and credentials.',
    mcpDescription: 'List infrastructure services with type, status, and exposed port.',
    inputSchema: listServicesSchema,
    execute: async (_args, { appCtx, target }) => {
      const services = await appCtx.serviceManager.list();

      if (target === 'mcp') {
        return {
          count: services.length,
          services: services.map((service) => ({
            id: service.id,
            name: service.name,
            type: service.type,
            status: service.status,
            port: service.port,
            image: service.image,
            createdAt: service.created_at,
            externalAccess: getServiceExternalAccess(service.port),
          })),
        };
      }

      return {
        count: services.length,
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          type: service.type,
          status: service.status,
          port: service.port,
          containerName: service.container_name,
          credentials: parseServiceCredentials(service.credentials),
        })),
      };
    },
  },
  {
    name: 'list_databases',
    description:
      'List databases for a named PostgreSQL or MySQL service. Use when selecting an existing database during environment setup. Returns { service, count, databases[] }. Errors: SERVICE_NOT_FOUND or unsupported service type.',
    mcpDescription: 'List databases inside a PostgreSQL or MySQL service.',
    inputSchema: listDatabasesSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const services = await appCtx.serviceManager.list();
      const service = services.find((item) => item.name === serviceName);
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      try {
        const databases = await appCtx.serviceManager.listDatabases(service.id);
        return {
          service: service.name,
          count: databases.length,
          databases: databases.map((database) => ({
            name: database.name,
            sizeBytes: database.sizeBytes,
          })),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    },
    targets: ['agent'],
  },
  {
    name: 'create_database',
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
        throw new Error(`Service not found: ${serviceName}`);
      }

      try {
        const result = await appCtx.serviceManager.createDatabase(service.id, databaseName);
        return {
          status: 'created',
          service: service.name,
          database: result.database,
          user: result.user,
          password: result.password,
          connectionString: result.connectionString,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    },
    targets: ['agent'],
  },
  {
    name: 'list_buckets',
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
    description:
      'Get the current status of a specific service. Returns { id, name, status, health, type, port, ... } where status is running/stopped and health reflects container health (healthy/unhealthy/unknown/degraded). healthDetail may be included when crash-like log patterns are detected. Errors: SERVICE_NOT_FOUND if the service name is invalid.',
    mcpDescription: 'Get service status, health, container state, and metadata.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      let health: 'healthy' | 'unhealthy' | 'unknown' | 'degraded' = 'unknown';
      let healthDetail: string | undefined;

      const containerId = service.container_id ?? service.container_name;
      if (containerId) {
        try {
          const info = (await appCtx.docker.getClient().getContainer(containerId).inspect()) as {
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

      return {
        id: service.id,
        name: service.name,
        type: service.type,
        status: service.status,
        health,
        ...(healthDetail ? { healthDetail } : {}),
        port: service.port,
        image: service.image,
        containerName: service.container_name,
        containerId: service.container_id,
        createdAt: service.created_at,
        updatedAt: service.updated_at,
        externalAccess: getServiceExternalAccess(service.port),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'start_service',
    description:
      'Start a stopped service. Use when a service is stopped and needs to be running. Returns { status, id, name }. Errors: SERVICE_NOT_FOUND.',
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
    description:
      'Stop a running service gracefully. Use when a service needs to be paused without deletion. Returns { status, id, name }. Errors: SERVICE_NOT_FOUND.',
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
    description:
      'Permanently remove a service — deletes the container, volume, and ALL persistent data. DESTRUCTIVE — cannot be undone. WARNING: This deletes database files, cache data, and everything stored in the service volume. ALWAYS call backup_service BEFORE removing a service with important data. Returns { status, service, warning }. Errors: SERVICE_NOT_FOUND.',
    mcpDescription: 'Remove a service container and volume. Data is permanently deleted.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const serviceType = service.type;
      await appCtx.serviceManager.remove(service.id);
      return {
        status: 'removed',
        service: serviceName,
        warning: `All persistent data for ${serviceType} service "${serviceName}" has been permanently deleted. This cannot be undone. If you needed the data, it is now lost. Use backup_service before remove_service in the future.`,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'backup_service',
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
    description:
      'List available backup snapshots for a service. Returns { service, count, backups[] } with backupId, createdAt, and sizeBytes for each snapshot.',
    mcpDescription: 'List available backup snapshots for a service.',
    inputSchema: listServiceBackupsSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      const backups = appCtx.serviceManager.listBackups(service.id);
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
        const isContainerGone =
          message.includes('not found') ||
          message.includes('No such container') ||
          message.includes('is not running');
        if (isContainerGone) {
          return {
            service: serviceName,
            status: service.status,
            logs: null,
            error: `Service "${serviceName}" is in ${service.status} state — container is not running. Logs are unavailable. Try start_service to restart, or check Docker host health.`,
          };
        }
        throw error;
      }
    },
    targets: ['mcp'],
  },
  {
    name: 'get_service_credentials',
    description:
      'Get connection credentials for a service (connection string, host, port, user, password). Use when a project needs to connect to a service. Returns { id, name, credentials } with full connection details. Errors: SERVICE_NOT_FOUND.',
    mcpDescription:
      'Get service connection credentials. Host is Docker internal DNS (e.g., ol-svc-pg), not localhost. Use for DATABASE_URL, REDIS_URL, etc. in projects.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const credentials = parseServiceCredentials(service.credentials);
      const internalHost = (credentials?.['host'] as string | undefined) || null;
      const connectionString = (credentials?.['connectionString'] as string | undefined) || null;

      return {
        service: serviceName,
        type: service.type,
        credentials,
        connectionString,
        host: internalHost,
        port: (credentials?.['port'] as number | undefined) || service.port,
        user: (credentials?.['user'] as string | undefined) || null,
        password: (credentials?.['password'] as string | undefined) || null,
        database: (credentials?.['database'] as string | undefined) || null,
        externalAccess: getServiceExternalAccess(service.port),
        externalConnectionStrings: getExternalConnectionStrings(connectionString, internalHost),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'create_service_database',
    description:
      'Create a new database in a PostgreSQL or MySQL service. Use when a project needs a dedicated database. Returns { status, service, database, user, password, connectionString }. Errors: SERVICE_NOT_FOUND, UNSUPPORTED_SERVICE_TYPE (redis, mongodb), CONTAINER_NOT_RUNNING.',
    mcpDescription: 'Create an additional database in a PostgreSQL or MySQL service.',
    inputSchema: createServiceDatabaseSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const databaseName = args['database_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const result = await appCtx.serviceManager.createDatabase(service.id, databaseName);
      return {
        status: 'created',
        service: serviceName,
        database: result.database,
        user: result.user,
        password: result.password,
        connectionString: result.connectionString,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'create_service_user',
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
  {
    name: 'provision_database',
    description:
      'Provision a database sidecar (PostgreSQL or SQLite) for a project. Automatically sets DATABASE_URL in the project env vars and redeploys. Use when user says they need a database. Defaults to PostgreSQL. Returns { status, connectionUrl, type }. For other services (Redis, MongoDB) use create_service + set_env_vars pattern instead. Errors: PROJECT_NOT_FOUND, ALREADY_PROVISIONED.',
    mcpDescription: 'Provision PostgreSQL or SQLite and auto-set DATABASE_URL for a project.',
    inputSchema: provisionDbSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      const dbType = (args['db_type'] as string | undefined) === 'sqlite' ? 'sqlite' : 'postgres';
      const result = await appCtx.dbProvisioner.provision(project.id, { type: dbType });
      return { status: 'provisioned', project: projectName, ...result };
    },
  },
];
