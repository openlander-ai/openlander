import { ProjectNotFoundError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { ToolDef } from './types.js';
import {
  createDatabaseSchema,
  createServiceDatabaseSchema,
  createServiceSchema,
  createServiceUserSchema,
  listDatabasesSchema,
  listServicesSchema,
  provisionDbSchema,
  serviceNameSchema,
} from './schemas.js';

const log = createModuleLogger('tools-defs-service');

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
      'Create a new service (database, cache, or custom container). Use when user needs a PostgreSQL, MySQL, Redis, MongoDB, or custom Docker image service. Provide either template (postgresql/mysql/redis/mongodb) or custom image with port. Returns { id, name, type, status, credentials } with connection details. After creating, use set_env_vars to connect projects: DATABASE_URL for postgres/mysql, REDIS_URL for redis, MONGODB_URL for mongodb — use the container_name from credentials as hostname. Errors: INVALID_TEMPLATE, MISSING_PORT_FOR_CUSTOM_IMAGE.',
    inputSchema: createServiceSchema,
    execute: async (args, { appCtx }) => {
      const result = await appCtx.serviceManager.create({
        name: args['name'] as string,
        template: args['template'] as string | undefined,
        image: args['image'] as string | undefined,
        port: args['port'] as number | undefined,
      });

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
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_services',
    description:
      'List all services (databases, caches, custom containers) with status, type, and connection details. Use to see what services are available and their current state. Returns { count, services[] } with id, name, type, status, port, and credentials.',
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
    inputSchema: listDatabasesSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const services = await appCtx.serviceManager.list();
      const service = services.find((item) => item.name === serviceName);
      if (!service) {
        return { error: `Service not found: ${serviceName}` };
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
        return { error: message };
      }
    },
    targets: ['agent'],
  },
  {
    name: 'create_database',
    description:
      'Create a database in a named PostgreSQL or MySQL service. Use when provisioning app-specific database credentials. Returns { status, service, database, user, password, connectionString }. Errors: SERVICE_NOT_FOUND or unsupported service type.',
    inputSchema: createDatabaseSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const databaseName = args['database_name'] as string;
      const services = await appCtx.serviceManager.list();
      const service = services.find((item) => item.name === serviceName);
      if (!service) {
        return { error: `Service not found: ${serviceName}` };
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
        return { error: message };
      }
    },
    targets: ['agent'],
  },
  {
    name: 'get_service_status',
    description:
      'Get the current status of a specific service. Returns { id, name, status, type, port, credentials }. Errors: SERVICE_NOT_FOUND if the service name is invalid.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const service = await getServiceByName(appCtx, args['service_name'] as string);
      return {
        id: service.id,
        name: service.name,
        type: service.type,
        status: service.status,
        port: service.port,
        image: service.image,
        containerName: service.container_name,
        containerId: service.container_id,
        createdAt: service.created_at,
        updatedAt: service.updated_at,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'start_service',
    description:
      'Start a stopped service. Use when a service is stopped and needs to be running. Returns { status, id, name }. Errors: SERVICE_NOT_FOUND.',
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
      'Permanently remove a service — deletes the container, volume, and database record. DESTRUCTIVE — cannot be undone. Use only when user explicitly wants to delete a service. Returns { status, id, name }. Errors: SERVICE_NOT_FOUND.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      await appCtx.serviceManager.remove(service.id);
      return { status: 'removed', service: serviceName };
    },
    targets: ['mcp'],
  },
  {
    name: 'get_service_credentials',
    description:
      'Get connection credentials for a service (connection string, host, port, user, password). Use when a project needs to connect to a service. Returns { id, name, credentials } with full connection details. Errors: SERVICE_NOT_FOUND.',
    inputSchema: serviceNameSchema,
    execute: async (args, { appCtx }) => {
      const serviceName = args['service_name'] as string;
      const service = await getServiceByName(appCtx, serviceName);
      const credentials = parseServiceCredentials(service.credentials);
      return {
        service: serviceName,
        type: service.type,
        credentials,
        connectionString: (credentials?.['connectionString'] as string | undefined) || null,
        host: (credentials?.['host'] as string | undefined) || null,
        port: (credentials?.['port'] as number | undefined) || service.port,
        user: (credentials?.['user'] as string | undefined) || null,
        password: (credentials?.['password'] as string | undefined) || null,
        database: (credentials?.['database'] as string | undefined) || null,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'create_service_database',
    description:
      'Create a new database in a PostgreSQL or MySQL service. Use when a project needs a dedicated database. Returns { status, service, database, user, password, connectionString }. Errors: SERVICE_NOT_FOUND, UNSUPPORTED_SERVICE_TYPE (redis, mongodb), CONTAINER_NOT_RUNNING.',
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
