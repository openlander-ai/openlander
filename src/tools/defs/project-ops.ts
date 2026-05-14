import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getPreferredProjectUrl, getProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import { emptySchema } from './schemas.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-project-ops');

async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
  const projects = await appCtx.db.listProjects();

  for (const project of projects) {
    const deployable = await appCtx.db.getDeployableForProject(project.id);
    const status = deployable?.status ?? project.status;
    const containerId = deployable?.container_id ?? project.container_id;

    if (status !== 'running' || !containerId) {
      continue;
    }

    try {
      const info = await appCtx.docker.inspectContainer(containerId);
      const nextStatus = info.State.Running ? 'running' : 'stopped';

      if (nextStatus !== status || info.Id !== containerId) {
        await appCtx.db.updateProject(project.id, { status: nextStatus, containerId: info.Id });
      }
    } catch (err) {
      log.debug({ err, projectId: project.id, containerId }, 'Failed to inspect project container');
      await appCtx.db.updateProject(project.id, { status: 'error' });
    }
  }
}

export const projectOpsToolDefs: ToolDef[] = [
  {
    name: 'list_projects',
    riskLevel: 'low',
    description:
      'List project groups with status, ports, container names, local URLs, public URLs, and deployable_service identifiers. Project groups organize deployable services; repo/image/build source lives on services. deployable_service is null for groups without a deployable service. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      'List project groups and deployable_service identifiers for follow-up service actions. deployable_service is null when a group has no deployable service.',
    inputSchema: emptySchema,
    execute: async (_args, context) => {
      if (context.target === 'mcp') {
        await reconcileRunningProjects(context.appCtx);
      }

      const projects = await context.appCtx.db.listProjects();
      const deployables = new Map<
        string,
        Awaited<ReturnType<typeof context.appCtx.db.getDeployableForProject>>
      >();
      for (const p of projects) {
        deployables.set(p.id, await context.appCtx.db.getDeployableForProject(p.id));
      }

      if (context.target === 'mcp') {
        return {
          count: projects.length,
          projects: projects.map((project) => {
            const deployable = deployables.get(project.id);
            const status = deployable?.status ?? project.status;
            const port = deployable?.assigned_port ?? project.assigned_port;
            const containerId = deployable?.container_id ?? project.container_id;
            const publicUrl = deployable?.public_url ?? project.public_url;
            const deployableContainerName =
              deployable?.container_name ??
              (containerId ? projectContainerName(project.name) : null);
            const deployableService = deployable
              ? {
                  service_id: deployable.id,
                  service_name: deployable.name,
                  kind: deployable.kind,
                  source: deployable.source,
                  status: deployable.status,
                  port: deployable.assigned_port,
                  container_name: deployableContainerName,
                }
              : null;
            return {
              id: project.id,
              name: project.name,
              status,
              // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
              visibility: project.visibility,
              port,
              containerName: containerId ? projectContainerName(project.name) : null,
              network: SHARED_NETWORK_NAME,
              url: port ? getProjectUrl(project.name) : null,
              preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
              urls: port ? getProjectUrls(project.name, port) : [],
              publicUrl,
              deployable_service: deployableService,
              createdAt: project.created_at,
              updatedAt: project.updated_at,
            };
          }),
          _agent_guidance: {
            networking: [
              `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
              'For deployable app containers, use http://ol-{project-name}:{port}. Managed service containers use http://ol-svc-{service-name}:{port}.',
              'Project groups are not deployable services. Use projects[].deployable_service.service_id with openlander_service actions such as set_env_vars, list_env_vars, redeploy_app, expose_public, restart_service, rollback_service, or update_service_config.',
            ],
          },
        };
      }

      return {
        count: projects.length,
        projects: projects.map((project) => {
          const deployable = deployables.get(project.id);
          const status = deployable?.status ?? project.status;
          const port = deployable?.assigned_port ?? project.assigned_port;
          const containerId = deployable?.container_id ?? project.container_id;
          const publicUrl = deployable?.public_url ?? project.public_url;
          return {
            name: project.name,
            status,
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            visibility: project.visibility,
            port,
            containerName: containerId ? projectContainerName(project.name) : null,
            url: port ? getProjectUrl(project.name) : null,
            preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
            publicUrl,
          };
        }),
      };
    },
  },
];
