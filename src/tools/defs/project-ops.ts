import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import {
  getDeployableServiceUrls,
  getPreferredDeployableServiceUrl,
} from '../../pipeline/traefik.js';
import type { ServiceRow } from '../../db/types.js';
import {
  loadServiceViewRecords,
  serviceViewFromRows,
  serviceViewWireVisibility,
} from '../../db/views/service-view.js';
import {
  InvalidProjectNameError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
} from '../../errors.js';
import { emptySchema } from './schemas.js';
import { summarizeRouteHealth, type DomainRouteHealth } from '../route-health.js';
import type { ToolDef } from './types.js';
import { filterDeployablesForMcpScope, projectVisibleToMcpScope } from '../../mcp/scope-policy.js';

const log = createModuleLogger('tools-defs-project-ops');
const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

type ProjectOpsContext = Parameters<ToolDef['execute']>[1];
type ProjectRow = Awaited<ReturnType<ProjectOpsContext['appCtx']['db']['getProject']>>;
type ResolvedProjectRow = NonNullable<ProjectRow>;

const projectLifecycleSchema = z
  .object({
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .regex(
      PROJECT_NAME_REGEX,
      'Project names must start with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens.',
    )
    .describe(
      'Project slug. Use this before creating Database/Cache resources for a brand-new app.',
    ),
  display_name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional human-readable Project name.'),
  description: z.string().trim().min(1).optional().describe('Optional project description.'),
  tags: z.array(z.string().trim().min(1)).max(20).optional().describe('Optional project tags.'),
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
    display_name: project.display_name || project.name,
    description: project.description ?? null,
    tags: parseProjectTags(project.tags ?? null),
    archived: Boolean(project.archived_at),
  };
}

function parseProjectTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === 'string');
  } catch {
    return [];
  }
}

function normalizeProjectTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  const unique = [...new Set(normalized)];
  return unique.length > 0 ? JSON.stringify(unique) : null;
}

function createProjectNextSteps(project: ResolvedProjectRow): string[] {
  return [
    `If this app needs a database/cache, call openlander_managed_service.create_service with project_id="${project.id}" before deploying.`,
    `Deploy the first app with openlander_deploy.deploy_app using target_project_id="${project.id}" so the Application is attached to this Project after readiness succeeds.`,
    'Use project_id for follow-up Database/Cache/Storage actions; use the returned Application service_id for runtime/env/domain actions after deployment.',
  ];
}

function createManagedServiceSuggestedCall(project: ResolvedProjectRow) {
  return {
    tool: 'openlander_managed_service',
    arguments: {
      action: 'create_service',
      params: {
        project_id: project.id,
        name: '<database-or-cache-name>',
        template: 'postgresql',
      },
    },
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

async function listProjectsWithRuntimeStatus(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
  if (typeof appCtx.db.listProjectsWithMetadata === 'function') {
    const projectsWithMetadata = await appCtx.db.listProjectsWithMetadata();
    return {
      projects: projectsWithMetadata.map((entry) => entry.project),
      runtimeStatusByProject: new Map(
        projectsWithMetadata.map((entry) => [entry.project.id, entry.runtimeStatus]),
      ),
      failedInitialDeployProjectIds: new Set(
        projectsWithMetadata
          .filter((entry) => entry.failedInitialDeploy)
          .map((entry) => entry.project.id),
      ),
    };
  }

  return {
    projects: await appCtx.db.listProjects(),
    runtimeStatusByProject: new Map<string, 'running' | 'stopped' | 'error'>(),
    failedInitialDeployProjectIds: new Set<string>(),
  };
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
    name: 'create_project',
    riskLevel: 'low',
    description:
      'Create an empty Project for an existing group, manual Database/Cache resource setup, or later Application/worker attach. This does not deploy code, create a repository source, or start a container. For new apps with safe PostgreSQL/Redis proposals, prefer create_deploy_plan -> execute_deploy_plan approval so OpenLander owns same-project provisioning.',
    mcpDescription:
      'Create an empty Project for existing groups or manual resource setup. For a brand-new app with proposed safe Database/Cache resources, prefer the deploy-plan approval flow.',
    inputSchema: createProjectSchema,
    execute: async (args, context) => {
      const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
      if (!PROJECT_NAME_REGEX.test(name)) {
        throw new InvalidProjectNameError(name);
      }

      const displayName =
        typeof args['display_name'] === 'string' && args['display_name'].trim().length > 0
          ? args['display_name'].trim()
          : name;
      const description =
        typeof args['description'] === 'string' && args['description'].trim().length > 0
          ? args['description'].trim()
          : null;
      const tags = normalizeProjectTags(args['tags']);

      const existing = await context.appCtx.db.getProjectByName(name);
      if (existing) {
        return {
          status: 'exists',
          project_id: existing.id,
          project_name: existing.name,
          project: projectGroupSummary(existing),
          suggested_call: createManagedServiceSuggestedCall(existing),
          _agent_guidance: {
            message:
              'Project already exists. Continue with this project_id instead of creating a placeholder deployment.',
            next_steps: createProjectNextSteps(existing),
          },
        };
      }

      let project: ResolvedProjectRow;
      try {
        project = await context.appCtx.db.createProjectGroup({
          id: randomUUID(),
          name,
          displayName,
          description,
          tags,
        });
      } catch (err) {
        if (err instanceof ProjectAlreadyExistsError) {
          const racedProject = await context.appCtx.db.getProjectByName(name);
          if (racedProject) {
            return {
              status: 'exists',
              project_id: racedProject.id,
              project_name: racedProject.name,
              project: projectGroupSummary(racedProject),
              suggested_call: createManagedServiceSuggestedCall(racedProject),
              _agent_guidance: {
                message:
                  'Project already exists. Continue with this project_id instead of creating a placeholder deployment.',
                next_steps: createProjectNextSteps(racedProject),
              },
            };
          }
        }
        throw err;
      }

      return {
        status: 'created',
        project_id: project.id,
        project_name: project.name,
        project: projectGroupSummary(project),
        suggested_call: createManagedServiceSuggestedCall(project),
        _agent_guidance: {
          message:
            'Project created without deploying code. This removes the first-deploy chicken-and-egg case for apps that need Project-scoped Database/Cache resources.',
          next_steps: createProjectNextSteps(project),
        },
      };
    },
  },
  {
    name: 'list_projects',
    riskLevel: 'low',
    description:
      'List Projects with status, ports, URLs, Application identifiers, and failed_initial_deploy when a retained first deployment has no successful history. Projects organize Applications, Compose stacks, and Database/Cache/Storage resources. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      'List Projects and Application service_id values for follow-up workload actions. failed_initial_deploy marks retained failed setup evidence; cleanup stays approval-gated.',
    inputSchema: emptySchema,
    execute: async (_args, context) => {
      if (context.target === 'mcp') {
        await reconcileRunningProjects(context.appCtx);
      }

      const { projects, runtimeStatusByProject, failedInitialDeployProjectIds } =
        await listProjectsWithRuntimeStatus(context.appCtx);
      const serviceRecords = await loadProjectServiceRecords(context.appCtx, projects);
      const deployables = new Map<string, ServiceRow | undefined>();
      const domainMappings =
        typeof context.appCtx.db.listDomainMappings === 'function'
          ? await context.appCtx.db.listDomainMappings()
          : [];
      const domainMappingsByService = new Map<string, DomainRouteHealth[]>();
      for (const mapping of domainMappings) {
        const routes = domainMappingsByService.get(mapping.service_id) ?? [];
        routes.push({
          domain: mapping.domain,
          path_prefix: mapping.path_prefix,
          mapping_status: mapping.status,
        });
        domainMappingsByService.set(mapping.service_id, routes);
      }
      const routeHealthFor = (
        service: ServiceRow,
        statusOverride?: 'running' | 'stopped' | 'error',
      ) =>
        summarizeRouteHealth({
          service: { status: statusOverride ?? service.status },
          domainRoutes: domainMappingsByService.get(service.id) ?? [],
        });
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

      const projectsForResponse =
        context.target === 'mcp'
          ? projects.filter((project) =>
              projectVisibleToMcpScope(
                project,
                deployableGroups.get(project.id) ?? [],
                context.identity,
              ),
            )
          : projects;
      const deployableGroupsForResponse = new Map(deployableGroups);
      if (context.target === 'mcp') {
        for (const project of projectsForResponse) {
          deployableGroupsForResponse.set(
            project.id,
            filterDeployablesForMcpScope(deployableGroups.get(project.id) ?? [], context.identity),
          );
        }
      }

      for (const p of projectsForResponse) {
        const groupDeployables = deployableGroupsForResponse.get(p.id) ?? [];
        const primary =
          context.target === 'mcp' && context.identity?.mcpScopeKind === 'service'
            ? (groupDeployables[0] ?? serviceRecords.get(p.id)?.service ?? undefined)
            : (serviceRecords.get(p.id)?.service ?? undefined);
        deployables.set(p.id, primary ?? groupDeployables[0]);
      }

      const gitCredentialManager = (context.appCtx as Partial<typeof context.appCtx>)
        .gitCredentials;
      const gitCredentials = gitCredentialManager ? await gitCredentialManager.list() : [];
      const gitCredentialsById = new Map(
        gitCredentials.map((credential) => [
          credential.id,
          {
            id: credential.id,
            name: credential.name,
            fingerprint: credential.fingerprint,
            status: credential.status,
          },
        ]),
      );

      if (context.target === 'mcp') {
        return {
          count: projectsForResponse.length,
          projects: projectsForResponse.map((project) => {
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
            const runtimeStatus = runtimeStatusByProject.get(project.id);
            const status =
              deployable?.kind === 'compose' && runtimeStatus != null
                ? runtimeStatus
                : view.status === 'idle'
                  ? undefined
                  : view.status;
            const visibility = serviceViewWireVisibility(project);
            const port = deployable ? view.assignedPort : undefined;
            const containerId = view.containerId;
            const publicUrl = deployable ? view.publicUrl : undefined;
            const routeService = deployable
              ? {
                  name: deployable.name,
                  assigned_port: view.assignedPort,
                  public_url: view.publicUrl,
                }
              : null;
            const serviceUrls = routeService ? getDeployableServiceUrls(routeService) : [];
            const deployableContainerName =
              deployable?.container_name ??
              (containerId ? projectContainerName(project.name) : null);
            const deployableService = deployable
              ? {
                  service_id: deployable.id,
                  service_name: deployable.name,
                  kind: deployable.kind,
                  source: deployable.source,
                  status: deployable.kind === 'compose' ? status : deployable.status,
                  port: deployable.assigned_port,
                  container_name: deployableContainerName,
                  route_health: routeHealthFor(
                    deployable,
                    deployable.kind === 'compose' ? runtimeStatus : undefined,
                  ),
                  git_credential: deployable.git_credential_id
                    ? gitCredentialsById.get(deployable.git_credential_id)
                    : null,
                }
              : null;
            const deployableServices = (deployableGroupsForResponse.get(project.id) ?? []).map(
              (service) => ({
                service_id: service.id,
                service_name: service.name,
                kind: service.kind,
                source: service.source,
                status:
                  service.id === deployable?.id && service.kind === 'compose'
                    ? status
                    : service.status,
                port: service.assigned_port,
                container_name:
                  service.container_name ??
                  (deployable?.id === service.id ? deployableContainerName : null),
                route_health: routeHealthFor(
                  service,
                  service.id === deployable?.id && service.kind === 'compose'
                    ? runtimeStatus
                    : undefined,
                ),
                git_credential: service.git_credential_id
                  ? gitCredentialsById.get(service.git_credential_id)
                  : null,
              }),
            );
            const deployableServiceCount = deployableServices.length;
            return {
              id: project.id,
              name: project.name,
              status,
              visibility,
              port,
              containerName: containerId ? projectContainerName(project.name) : null,
              network: projectContainerName(project.name),
              url: routeService ? getPreferredDeployableServiceUrl(routeService) : null,
              preferred_url: routeService ? getPreferredDeployableServiceUrl(routeService) : null,
              urls: serviceUrls,
              publicUrl,
              route_health: deployable
                ? routeHealthFor(
                    deployable,
                    deployable.kind === 'compose' ? runtimeStatus : undefined,
                  )
                : undefined,
              deployable_service_count: deployableServiceCount,
              ...(failedInitialDeployProjectIds.has(project.id)
                ? { failed_initial_deploy: true }
                : {}),
              deployable_service: deployableService,
              deployable_services: deployableServices,
              createdAt: project.created_at,
              updatedAt: project.updated_at,
            };
          }),
          _agent_guidance: {
            networking: [
              'Application and Database/Cache/Storage containers are isolated on the Project Docker network.',
              'For same-project inter-container traffic, use the service DNS name on that project network. Do not create Docker networks manually.',
              'Projects are not Applications. Use projects[].deployable_services[].service_id with openlander_service/openlander_monitor actions when a Project has app, API, and worker workloads.',
            ],
          },
        };
      }

      return {
        count: projectsForResponse.length,
        projects: projectsForResponse.map((project) => {
          const deployable = deployables.get(project.id);
          const view = serviceViewFromRows(project, deployable);
          // Same boundary restoration as the MCP branch (see the note
          // there): the agent-target result is JSON-serialized for the
          // model, so honor the historic null-vs-omit shape — null when a
          // services row exists, omit when none. status omits only on the
          // synthesized 'idle' bottom; visibility uses the raw wire helper
          // for the same reason as the MCP branch.
          const runtimeStatus = runtimeStatusByProject.get(project.id);
          const status =
            deployable?.kind === 'compose' && runtimeStatus != null
              ? runtimeStatus
              : view.status === 'idle'
                ? undefined
                : view.status;
          const visibility = serviceViewWireVisibility(project);
          const port = deployable ? view.assignedPort : undefined;
          const containerId = view.containerId;
          const publicUrl = deployable ? view.publicUrl : undefined;
          const routeService = deployable
            ? {
                name: deployable.name,
                assigned_port: view.assignedPort,
                public_url: view.publicUrl,
              }
            : null;
          const preferredUrl = routeService ? getPreferredDeployableServiceUrl(routeService) : null;
          const deployableServiceCount = (deployableGroups.get(project.id) ?? []).length;
          return {
            name: project.name,
            status,
            visibility,
            port,
            containerName: containerId ? projectContainerName(project.name) : null,
            url: preferredUrl,
            preferred_url: preferredUrl,
            publicUrl,
            route_health: deployable
              ? routeHealthFor(
                  deployable,
                  deployable.kind === 'compose' ? runtimeStatus : undefined,
                )
              : undefined,
            deployable_service_count: deployableServiceCount,
            ...(failedInitialDeployProjectIds.has(project.id)
              ? { failed_initial_deploy: true }
              : {}),
          };
        }),
      };
    },
  },
  {
    name: 'archive_project',
    riskLevel: 'high',
    description:
      'Archive a Project by archiving its active Applications/workers. Preserves configuration/history and does not delete Database/Cache/Storage resources.',
    mcpDescription:
      'Request human approval to archive a Project. Archives active Applications/workers while preserving configuration/history; execution returns DEPLOY_LOCKED if any target has an active deployment.',
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
            'Project archive completed. Archive is reversible cleanup, not permanent deletion. OpenLander stops/removes Application runtimes, hides archived Applications from default active lists, and preserves configuration/history. It does not delete databases, volumes, buckets, or host Docker resources.',
          next_steps: [
            'Use list_projects to confirm the Project lifecycle state.',
            'Use list_archived_services if you need archived Application service_id values for restore or cleanup review.',
            'Use unarchive_project if the Project should be restored later; restored Applications are not redeployed automatically.',
          ],
        },
      };
    },
  },
  {
    name: 'unarchive_project',
    riskLevel: 'medium',
    description:
      'Restore a Project archive set. Does not redeploy Applications automatically; call update_app for workloads that should run again.',
    mcpDescription:
      'Request human approval to restore a Project archive set. Restored Applications are not redeployed automatically.',
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
            'Project restore completed. OpenLander restores the archive set to the active lifecycle path without redeploying Applications automatically.',
          next_steps: [
            'Use list_projects to confirm which Applications are active.',
            'Call update_app with service_id for each Application that should run again.',
            'Call diagnose_service after updating to verify runtime health before reporting success.',
          ],
        },
      };
    },
  },
];
