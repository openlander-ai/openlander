import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getPreferredProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import type { ServiceRow } from '../../db/types.js';
import { serviceViewFromRows } from '../../db/views/service-view.js';
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
      'List project groups with status, ports, container names, local URLs, public URLs, and deployable service identifiers. Project groups organize deployable services; repo/image/build source lives on services. deployable_service is the primary service and deployable_services lists every app/worker service in the group. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      'List project groups and deployable service identifiers for follow-up service actions. deployable_service is the primary service; deployable_services includes app/worker siblings.',
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
      const deployableGroups = new Map<string, ServiceRow[]>();
      for (const p of projects) {
        const primary = await context.appCtx.db.getDeployableForProject(p.id);
        const groupDeployables =
          typeof context.appCtx.db.getDeployablesByGroup === 'function'
            ? await context.appCtx.db.getDeployablesByGroup(p.id)
            : primary
              ? [primary]
              : [];
        deployables.set(p.id, primary ?? groupDeployables[0]);
        deployableGroups.set(p.id, groupDeployables);
      }

      if (context.target === 'mcp') {
        return {
          count: projects.length,
          projects: projects.map((project) => {
            const deployable = deployables.get(project.id);
            const view = serviceViewFromRows(project, deployable);
            // S3.2: read via ServiceView, but restore each field's historic
            // MCP JSON bottom (JSON.stringify omits `undefined`, serializes
            // `null`). `listProjects()` hydrates the project row from the
            // canonical `__svc` services row (mergeDeployable), so the old
            // `deployable?.X ?? project.X` chains emitted:
            //   - a value / explicit `null` when a services row exists
            //     (assigned_port / public_url are nullable on that row), and
            //   - `undefined` (key omitted) only when NO services row exists.
            // So restore `null` when `deployable` is present and omit
            // otherwise — `view.assignedPort ?? undefined` alone would drop
            // the explicit-null case to an omit.
            //
            // status is exempt: the services-row status is non-null and
            // never 'idle' (enum running|stopped|error), so a view 'idle'
            // uniquely marks the no-services-row bottom → omit.
            //
            // visibility stays on the deprecated direct read — its raw
            // null/undefined distinction is not recoverable from the view
            // (deferred, service-view-deferred-routes).
            const status = view.status === 'idle' ? undefined : view.status;
            const port = deployable ? view.assignedPort : undefined;
            const containerId = view.containerId;
            const publicUrl = deployable ? view.publicUrl : undefined;
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
            const deployableServices = (deployableGroups.get(project.id) ?? []).map((service) => ({
              service_id: service.id,
              service_name: service.name,
              kind: service.kind,
              source: service.source,
              status: service.status,
              port: service.assigned_port,
              container_name:
                service.container_name ??
                (deployable?.id === service.id ? deployableContainerName : null),
            }));
            return {
              id: project.id,
              name: project.name,
              status,
              // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
              visibility: project.visibility,
              port,
              containerName: containerId ? projectContainerName(project.name) : null,
              network: projectContainerName(project.name),
              url: port ? getPreferredProjectUrl(project.name, port) : null,
              preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
              urls: port ? getProjectUrls(project.name, port) : [],
              publicUrl,
              deployable_service: deployableService,
              deployable_services: deployableServices,
              createdAt: project.created_at,
              updatedAt: project.updated_at,
            };
          }),
          _agent_guidance: {
            networking: [
              'Project app and managed-service containers are isolated on the project Docker network.',
              'For same-project inter-container traffic, use the service DNS name on that project network. Do not create Docker networks manually.',
              'Project groups are not deployable services. Use projects[].deployable_services[].service_id with openlander_service/openlander_monitor actions when a group has app, API, and worker services.',
            ],
          },
        };
      }

      return {
        count: projects.length,
        projects: projects.map((project) => {
          const deployable = deployables.get(project.id);
          const view = serviceViewFromRows(project, deployable);
          // Same boundary restoration as the MCP branch (see the note
          // there): the agent-target result is JSON-serialized for the
          // model, so honor the historic null-vs-omit shape — null when a
          // services row exists, omit when none. status omits only on the
          // synthesized 'idle' bottom; visibility stays deferred.
          const status = view.status === 'idle' ? undefined : view.status;
          const port = deployable ? view.assignedPort : undefined;
          const containerId = view.containerId;
          const publicUrl = deployable ? view.publicUrl : undefined;
          return {
            name: project.name,
            status,
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            visibility: project.visibility,
            port,
            containerName: containerId ? projectContainerName(project.name) : null,
            url: port ? getPreferredProjectUrl(project.name, port) : null,
            preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
            publicUrl,
          };
        }),
      };
    },
  },
];
