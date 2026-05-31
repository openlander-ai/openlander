import { z } from 'zod';

import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getPreferredProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import type { ServiceRow } from '../../db/types.js';
import {
  loadServiceViewRecords,
  serviceViewFromRows,
  serviceViewWireVisibility,
} from '../../db/views/service-view.js';
import { ProjectNotFoundError } from '../../errors.js';
import { emptySchema } from './schemas.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-project-ops');

type ProjectOpsContext = Parameters<ToolDef['execute']>[1];
type ProjectRow = Awaited<ReturnType<ProjectOpsContext['appCtx']['db']['getProject']>>;
type ResolvedProjectRow = NonNullable<ProjectRow>;

const projectLifecycleSchema = z
  .object({
    project_id: z.string().min(1).optional().describe('Project group id'),
    project_name: z.string().min(1).optional().describe('Project group name'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

async function resolveProjectGroup(
  args: Record<string, unknown>,
  context: ProjectOpsContext,
): Promise<ResolvedProjectRow> {
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
  const project = projectId
    ? await context.appCtx.db.getProject(projectId)
    : ((await context.appCtx.db.getProject(projectName)) ??
      (await context.appCtx.db.getProjectByName(projectName)));

  if (!project) {
    throw new ProjectNotFoundError(projectId || projectName || 'unknown');
  }
  return project;
}

function projectGroupSummary(project: ResolvedProjectRow) {
  return {
    id: project.id,
    name: project.name,
  };
}

async function loadProjectServiceRecords(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  projects: Awaited<ReturnType<Parameters<ToolDef['execute']>[1]['appCtx']['db']['listProjects']>>,
) {
  if (typeof appCtx.db.getServices === 'function') {
    return loadServiceViewRecords(appCtx.db, projects);
  }

  return new Map(
    projects.map((project) => [
      project.id,
      {
        project,
        service: null,
        view: serviceViewFromRows(project, null),
      },
    ]),
  );
}

async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
  const projects = await appCtx.db.listProjects();
  const serviceRecords = await loadProjectServiceRecords(appCtx, projects);

  for (const project of projects) {
    const view = serviceRecords.get(project.id)?.view ?? serviceViewFromRows(project, null);
    const status = view.status;
    const containerId = view.containerId;

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
      'List project groups with status, ports, container names, local URLs, public URLs, deployable service count, and deployable service identifiers. Project groups organize deployable services; repo/image/build source lives on services. deployable_service is the primary service and deployable_services lists every app/worker service in the group. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      'List project groups and deployable service identifiers for follow-up service actions. deployable_service_count is the app/worker count; deployable_service is the primary service; deployable_services includes app/worker siblings.',
    inputSchema: emptySchema,
    execute: async (_args, context) => {
      if (context.target === 'mcp') {
        await reconcileRunningProjects(context.appCtx);
      }

      const projects = await context.appCtx.db.listProjects();
      const serviceRecords = await loadProjectServiceRecords(context.appCtx, projects);
      const deployables = new Map<string, ServiceRow | undefined>();
      const deployableGroups =
        typeof context.appCtx.db.getDeployablesByGroupIds === 'function'
          ? await context.appCtx.db.getDeployablesByGroupIds(projects.map((p) => p.id))
          : new Map<string, ServiceRow[]>();
      if (typeof context.appCtx.db.getDeployablesByGroupIds !== 'function') {
        for (const p of projects) {
          const primary = serviceRecords.get(p.id)?.service ?? undefined;
          const groupDeployables =
            typeof context.appCtx.db.getDeployablesByGroup === 'function'
              ? await context.appCtx.db.getDeployablesByGroup(p.id)
              : primary
                ? [primary]
                : [];
          deployableGroups.set(p.id, groupDeployables);
        }
      }
      for (const p of projects) {
        const primary = serviceRecords.get(p.id)?.service ?? undefined;
        const groupDeployables = deployableGroups.get(p.id) ?? [];
        deployables.set(p.id, primary ?? groupDeployables[0]);
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
            // visibility uses the raw wire helper because
            // ServiceView.visibility normalizes missing/null values to
            // 'internal', while this response historically serialized the
            // ProjectRepo-hydrated raw value.
            const status = view.status === 'idle' ? undefined : view.status;
            const visibility = serviceViewWireVisibility(project);
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
            const deployableServiceCount = deployableServices.length;
            return {
              id: project.id,
              name: project.name,
              status,
              visibility,
              port,
              containerName: containerId ? projectContainerName(project.name) : null,
              network: projectContainerName(project.name),
              url: port ? getPreferredProjectUrl(project.name, port) : null,
              preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
              urls: port ? getProjectUrls(project.name, port) : [],
              publicUrl,
              deployable_service_count: deployableServiceCount,
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
          // synthesized 'idle' bottom; visibility uses the raw wire helper
          // for the same reason as the MCP branch.
          const status = view.status === 'idle' ? undefined : view.status;
          const visibility = serviceViewWireVisibility(project);
          const port = deployable ? view.assignedPort : undefined;
          const containerId = view.containerId;
          const publicUrl = deployable ? view.publicUrl : undefined;
          const deployableServiceCount = (deployableGroups.get(project.id) ?? []).length;
          return {
            name: project.name,
            status,
            visibility,
            port,
            containerName: containerId ? projectContainerName(project.name) : null,
            url: port ? getPreferredProjectUrl(project.name, port) : null,
            preferred_url: port ? getPreferredProjectUrl(project.name, port) : null,
            publicUrl,
            deployable_service_count: deployableServiceCount,
          };
        }),
      };
    },
  },
  {
    name: 'archive_project',
    riskLevel: 'high',
    description:
      'Archive a project group by archiving its active deployable app/worker services. Preserves configuration/history and does not delete managed infrastructure.',
    mcpDescription:
      'Request human approval to archive a project group. Archives active deployable app/worker services in the group while preserving configuration/history.',
    inputSchema: projectLifecycleSchema,
    execute: async (args, context) => {
      const project = await resolveProjectGroup(args, context);
      await context.appCtx.pipeline.archiveGroup(project.id);
      return {
        status: 'archived',
        project_id: project.id,
        project_name: project.name,
        project: projectGroupSummary(project),
        _agent_guidance: {
          message:
            'Project group archive completed. Archive is reversible cleanup, not permanent deletion. OpenLander stops/removes deployable runtimes, hides archived services from default active lists, and preserves configuration/history. It does not delete managed databases, volumes, buckets, or host Docker resources.',
          next_steps: [
            'Use list_projects to confirm the group lifecycle state.',
            'Use list_archived_services if you need archived service ids for restore or cleanup review.',
            'Use unarchive_project if the group should be restored later; restored services are not redeployed automatically.',
          ],
        },
      };
    },
  },
  {
    name: 'unarchive_project',
    riskLevel: 'medium',
    description:
      'Restore a project group archive set. Does not redeploy services automatically; call redeploy_app for services that should run again.',
    mcpDescription:
      'Request human approval to restore a project group archive set. Restored services are not redeployed automatically.',
    inputSchema: projectLifecycleSchema,
    execute: async (args, context) => {
      const project = await resolveProjectGroup(args, context);
      await context.appCtx.pipeline.unarchiveGroup(project.id);
      return {
        status: 'unarchived',
        project_id: project.id,
        project_name: project.name,
        project: projectGroupSummary(project),
        _agent_guidance: {
          message:
            'Project group restore completed. OpenLander restores the archive set to the active lifecycle path without redeploying services automatically.',
          next_steps: [
            'Use list_projects to confirm which deployable services are active.',
            'Call redeploy_app with service_id for each service that should run again.',
            'Call diagnose_service after redeploying to verify runtime health before reporting success.',
          ],
        },
      };
    },
  },
];
