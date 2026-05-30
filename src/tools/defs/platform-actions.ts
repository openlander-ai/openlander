import { DOCKER_LABELS } from '../../config/index.js';
import { getRouteName } from '../../pipeline/deploy/helpers.js';
import {
  collectKnownContainerNames,
  containerName as projectContainerName,
} from '../../pipeline/helpers.js';
import {
  platformAdoptOrphanServiceSchema,
  platformCleanupOrphansSchema,
  platformForceRemoveSchema,
  platformReconcileSchema,
  platformRecoverSchema,
} from './schemas.js';
import { OpenLanderError, isDockerNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';

function ensureConfirmed(confirm: boolean, toolName: string): void {
  if (!confirm) {
    throw new Error(`CONFIRMATION_REQUIRED: ${toolName} requires confirm=true`);
  }
}

function ensureConfirmedForExecution(
  confirm: boolean | undefined,
  dryRun: boolean,
  toolName: string,
): void {
  if (!dryRun) {
    ensureConfirmed(confirm === true, toolName);
  }
}

function stripDockerName(name: string | undefined): string {
  if (!name) {
    return 'unknown';
  }
  return name.replace(/^\//, '');
}

type KnownEnvironment = { container_id: string | null; type: string };

function normalizeAdoptServiceKind(input: string | undefined): string {
  if (!input) return 'image';
  switch (input) {
    case 'postgresql':
      return 'postgres';
    case 'mongodb':
      return 'mongo';
    case 'postgres':
    case 'mysql':
    case 'redis':
    case 'mongo':
    case 'minio':
    case 'image':
      return input;
    default:
      return 'image';
  }
}

async function recordServiceAdoptActivity(
  context: Parameters<ToolDef['execute']>[1],
  serviceName: string,
  containerId: string,
): Promise<void> {
  const db = context.appCtx.db as unknown as {
    insertActivityLog?: (entry: {
      event_type: string;
      activity_type: string;
      severity: string;
      project_id: string;
      title: string;
      description: string;
      status: string;
      metadata?: string;
    }) => Promise<void> | void;
  };
  if (typeof db.insertActivityLog !== 'function') return;
  await db.insertActivityLog({
    event_type: 'service:adopted',
    activity_type: 'config',
    severity: 'info',
    project_id: '__orphan_managed',
    title: 'Service container adopted',
    description: `Adopted orphan service container ${serviceName}`,
    status: 'completed',
    metadata: JSON.stringify({
      actor: 'mcp',
      operation: 'adopt_orphan_service',
      service_name: serviceName,
      container_id: containerId,
    }),
  });
}

export const platformActionToolDefs: ToolDef[] = [
  {
    name: 'platform_adopt_orphan_service',
    riskLevel: 'high',
    description:
      'Adopt an OpenLander-managed service container that exists in Docker but is missing from the services table. Without confirm=true, returns a preview only. Adopted custom image services support logs/restart/stop/remove; build/redeploy remains unsupported.',
    mcpDescription:
      'Adopt an orphan OpenLander service container into the services table (confirm-gated).',
    inputSchema: platformAdoptOrphanServiceSchema,
    execute: async (args, context) => {
      const containerId = args['container_id'] as string | undefined;
      const containerName = args['container_name'] as string | undefined;
      const confirm = (args['confirm'] as boolean | undefined) ?? false;
      if (
        (containerId === undefined && containerName === undefined) ||
        (containerId && containerName)
      ) {
        throw new OpenLanderError(
          'Provide exactly one of container_id or container_name.',
          'BAD_REQUEST',
          400,
        );
      }

      const containers = await context.appCtx.docker.listManagedContainers();
      const candidate = containers.find((container) =>
        containerId !== undefined ? container.id === containerId : container.name === containerName,
      );
      if (!candidate) {
        throw new OpenLanderError(
          'Container not found in OpenLander managed containers.',
          'CONTAINER_NOT_FOUND',
          404,
          {
            container_id: containerId,
            container_name: containerName,
          },
        );
      }
      if (candidate.labels?.[DOCKER_LABELS.ROLE] !== 'service') {
        throw new OpenLanderError(
          'Only OpenLander-managed service containers can be adopted.',
          'SERVICE_OPERATION_UNSUPPORTED',
          400,
          { role: candidate.labels?.[DOCKER_LABELS.ROLE] ?? null },
        );
      }

      const existingServices = await context.appCtx.db.listServices();
      const alreadyRegistered = existingServices.find(
        (service) =>
          service.container_id === candidate.id ||
          service.container_name === candidate.name ||
          service.name === candidate.labels?.[DOCKER_LABELS.SERVICE],
      );
      if (alreadyRegistered) {
        return {
          status: 'already_registered',
          service: alreadyRegistered.name,
          service_id: alreadyRegistered.id,
          container_id: candidate.id,
        };
      }

      const proposedName =
        (args['service_name'] as string | undefined) ??
        candidate.labels[DOCKER_LABELS.SERVICE] ??
        candidate.name.replace(/^ol-svc-/, '');
      const proposedKind = normalizeAdoptServiceKind(args['service_type'] as string | undefined);
      const proposedService = {
        name: proposedName,
        kind: proposedKind,
        image: candidate.imageTag ?? null,
        container_id: candidate.id,
        container_name: candidate.name,
        assigned_port: candidate.port ?? null,
      };

      if (!confirm) {
        return {
          candidate: {
            id: candidate.id,
            name: candidate.name,
            status: candidate.status,
            labels: candidate.labels ?? {},
          },
          proposed_service: proposedService,
          confirm_required: true,
        };
      }

      const created = await context.appCtx.db.adoptService({
        id: crypto.randomUUID(),
        name: proposedName,
        kind: proposedKind,
        imageUrl: candidate.imageTag ?? null,
        containerId: candidate.id,
        containerName: candidate.name,
        assignedPort: candidate.port ?? null,
      });
      await recordServiceAdoptActivity(context, created.name, candidate.id);

      return {
        status: 'adopted',
        service: {
          id: created.id,
          name: created.name,
          kind: created.kind,
          status: created.status,
          container_id: created.container_id,
          container_name: created.container_name,
          image: created.image_url,
          port: created.assigned_port,
        },
        supported_operations: [
          'get_service_logs',
          'start_service',
          'stop_service',
          'remove_service',
        ],
        unsupported_operations: ['redeploy_app', 'restart_service', 'build'],
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_cleanup_orphans',
    riskLevel: 'high',
    description:
      'Find and remove OpenLander-managed orphan containers that are no longer referenced in DB records. Requires explicit confirmation.',
    mcpDescription:
      'Corrective action: detect and remove orphan OpenLander-managed containers with dry-run support.',
    inputSchema: platformCleanupOrphansSchema,
    execute: async (args, context) => {
      const confirm = args['confirm'] as boolean | undefined;
      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
      ensureConfirmedForExecution(confirm, dryRun, 'platform_cleanup_orphans');

      const managedContainers = await context.appCtx.docker.listManagedContainers();
      const projects = await context.appCtx.db.listProjects();
      const services = await context.appCtx.db.listServices();
      const environmentEntries = await Promise.all(
        projects.map(
          async (project): Promise<[string, KnownEnvironment[]]> => [
            project.id,
            await context.appCtx.db.getEnvironmentsByProject(project.id),
          ],
        ),
      );
      const environmentsByProject = new Map<string, KnownEnvironment[]>(environmentEntries);
      const { knownIds, knownNames } = collectKnownContainerNames(
        projects,
        (projectId) => environmentsByProject.get(projectId) ?? [],
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        services,
      );

      const removed: Array<{ id: string; name: string }> = [];
      const skipped: Array<{ id: string; name: string; reason: string }> = [];
      const errors: Array<{ id: string; name: string; error: string }> = [];

      const orphanCandidates = managedContainers.filter((container) => {
        if (knownIds.has(container.id)) return false;
        if (knownNames.has(container.name)) return false;
        return true;
      });

      for (const container of orphanCandidates) {
        if (container.labels?.['openlander.role']) {
          skipped.push({ id: container.id, name: container.name, reason: 'infrastructure' });
          continue;
        }

        if (dryRun) {
          skipped.push({ id: container.id, name: container.name, reason: 'dry_run' });
          continue;
        }

        try {
          await context.appCtx.docker.stopContainer(container.id);
          await context.appCtx.docker.removeContainer(container.id);
          removed.push({ id: container.id, name: container.name });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ id: container.id, name: container.name, error: message });
        }
      }

      return {
        mode: dryRun ? 'dry_run' : 'executed',
        orphans_found: orphanCandidates.length,
        removed,
        skipped,
        errors,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_reconcile',
    riskLevel: 'high',
    description:
      'Reconcile DB state with Docker reality by marking ghost project records as error and removing orphan managed containers. Requires explicit confirmation.',
    mcpDescription:
      'Corrective action: reconcile DB records against managed Docker containers (dry-run supported).',
    inputSchema: platformReconcileSchema,
    execute: async (args, context) => {
      const confirm = args['confirm'] as boolean | undefined;
      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
      ensureConfirmedForExecution(confirm, dryRun, 'platform_reconcile');

      const managedContainers = await context.appCtx.docker.listManagedContainers();
      const projects = await context.appCtx.db.listProjects();
      const services = await context.appCtx.db.listServices();
      const environmentEntries = await Promise.all(
        projects.map(
          async (project): Promise<[string, KnownEnvironment[]]> => [
            project.id,
            await context.appCtx.db.getEnvironmentsByProject(project.id),
          ],
        ),
      );
      const environmentsByProject = new Map<string, KnownEnvironment[]>(environmentEntries);
      const { knownIds, knownNames } = collectKnownContainerNames(
        projects,
        (projectId) => environmentsByProject.get(projectId) ?? [],
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        services,
      );
      const actions: Array<{ type: 'mark_error' | 'stop_orphan'; target: string; detail: string }> =
        [];

      for (const project of projects) {
        // PR 4.5: canonical-first read of container_id with `??` fallback to
        // legacy `projects` column through migration 0012.
        const deployable = await context.appCtx.db.getDeployableForProject(project.id);
        const containerId = deployable?.container_id ?? project.container_id;
        if (!containerId) {
          continue;
        }

        try {
          await context.appCtx.docker.inspectContainer(containerId);
          continue;
        } catch (error) {
          if (!isDockerNotFoundError(error)) {
            throw error;
          }
        }

        if (!dryRun) {
          await context.appCtx.db.updateProject(project.id, { status: 'error' });
        }

        actions.push({
          type: 'mark_error',
          target: project.name,
          detail: dryRun
            ? `container missing: ${containerId}`
            : `status updated to error (missing container: ${containerId})`,
        });
      }

      for (const container of managedContainers) {
        const isKnown = knownIds.has(container.id) || knownNames.has(container.name);
        if (isKnown) {
          continue;
        }

        if (container.labels?.['openlander.role']) {
          continue;
        }

        if (dryRun) {
          actions.push({
            type: 'stop_orphan',
            target: container.name,
            detail: `would stop+remove orphan container ${container.id}`,
          });
          continue;
        }

        try {
          await context.appCtx.docker.stopContainer(container.id);
          await context.appCtx.docker.removeContainer(container.id);
          actions.push({
            type: 'stop_orphan',
            target: container.name,
            detail: `stopped+removed orphan container ${container.id}`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          actions.push({
            type: 'stop_orphan',
            target: container.name,
            detail: `failed to remove orphan ${container.id}: ${message}`,
          });
        }
      }

      return {
        mode: dryRun ? 'dry_run' : 'executed',
        actions,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_force_remove',
    riskLevel: 'high',
    description:
      'Force remove a specific Docker container by ID after protected-infrastructure checks. Requires explicit confirmation.',
    mcpDescription: 'Corrective action: force-remove a specific non-infrastructure container.',
    inputSchema: platformForceRemoveSchema,
    execute: async (args, context) => {
      const containerId = args['container_id'] as string;
      const confirm = args['confirm'] as boolean;
      ensureConfirmed(confirm, 'platform_force_remove');

      let inspected: { Name?: string; Config?: { Labels?: Record<string, string> } };
      try {
        inspected = await context.appCtx.docker.inspectContainer(containerId);
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { status: 'not_found', container_id: containerId };
        }
        throw error;
      }

      if (inspected.Config?.Labels?.['openlander.role']) {
        throw new Error('PROTECTED_CONTAINER: Cannot remove infrastructure container');
      }

      try {
        await context.appCtx.docker.stopContainer(containerId);
        await context.appCtx.docker.removeContainer(containerId);
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          return { status: 'not_found', container_id: containerId };
        }
        throw error;
      }

      return {
        status: 'removed',
        container_id: containerId,
        name: stripDockerName(inspected.Name),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'recover_platform',
    riskLevel: 'medium',
    description:
      'Recover all containers after Docker migration. Recreates missing containers from existing images and preserves service volumes with data. Safe — never overwrites existing volumes. Use dry_run=true to preview what would happen.',
    mcpDescription: 'Recover containers after Docker migration (preserves data volumes).',
    inputSchema: platformRecoverSchema,
    execute: async (args, context) => {
      const dryRun = (args['dry_run'] as boolean | undefined) ?? false;
      const { recover } = await import('../../pipeline/recover.js');
      return recover(context.appCtx, { dryRun });
    },
    targets: ['mcp'],
  },
];
