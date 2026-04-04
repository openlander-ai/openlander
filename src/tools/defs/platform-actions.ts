import { getRouteName } from '../../pipeline/deploy/helpers.js';
import {
  collectKnownContainerNames,
  containerName as projectContainerName,
} from '../../pipeline/helpers.js';
import {
  platformCleanupOrphansSchema,
  platformForceRemoveSchema,
  platformReconcileSchema,
  platformRecoverSchema,
} from './schemas.js';
import { isDockerNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';

function ensureConfirmed(confirm: boolean, toolName: string): void {
  if (!confirm) {
    throw new Error(`CONFIRMATION_REQUIRED: ${toolName} requires confirm=true`);
  }
}

function stripDockerName(name: string | undefined): string {
  if (!name) {
    return 'unknown';
  }
  return name.replace(/^\//, '');
}

export const platformActionToolDefs: ToolDef[] = [
  {
    name: 'platform_cleanup_orphans',
    riskLevel: 'high',
    description:
      'Find and remove OpenLander-managed orphan containers that are no longer referenced in DB records. Requires explicit confirmation.',
    mcpDescription:
      'Corrective action: detect and remove orphan OpenLander-managed containers with dry-run support.',
    inputSchema: platformCleanupOrphansSchema,
    execute: async (args, context) => {
      const confirm = args['confirm'] as boolean;
      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
      ensureConfirmed(confirm, 'platform_cleanup_orphans');

      const managedContainers = await context.appCtx.docker.listManagedContainers();
      const { knownIds, knownNames } = collectKnownContainerNames(
        context.appCtx.db.listProjects(),
        (projectId) => context.appCtx.db.getEnvironmentsByProject(projectId),
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        context.appCtx.db.listServices(),
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
      const confirm = args['confirm'] as boolean;
      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
      ensureConfirmed(confirm, 'platform_reconcile');

      const managedContainers = await context.appCtx.docker.listManagedContainers();
      const { knownIds, knownNames } = collectKnownContainerNames(
        context.appCtx.db.listProjects(),
        (projectId) => context.appCtx.db.getEnvironmentsByProject(projectId),
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        context.appCtx.db.listServices(),
      );
      const dockerClient = context.appCtx.docker.getClient();

      const actions: Array<{ type: 'mark_error' | 'stop_orphan'; target: string; detail: string }> =
        [];

      for (const project of context.appCtx.db.listProjects()) {
        if (project.container_id === null) {
          continue;
        }

        try {
          await dockerClient.getContainer(project.container_id).inspect();
          continue;
        } catch (error) {
          if (!isDockerNotFoundError(error)) {
            throw error;
          }
        }

        if (!dryRun) {
          context.appCtx.db.updateProject(project.id, { status: 'error' });
        }

        actions.push({
          type: 'mark_error',
          target: project.name,
          detail: dryRun
            ? `container missing: ${project.container_id}`
            : `status updated to error (missing container: ${project.container_id})`,
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

      const container = context.appCtx.docker.getClient().getContainer(containerId);

      let inspected: { Name?: string; Config?: { Labels?: Record<string, string> } };
      try {
        inspected = (await container.inspect()) as {
          Name?: string;
          Config?: { Labels?: Record<string, string> };
        };
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
