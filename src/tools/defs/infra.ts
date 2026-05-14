import {
  OpenLanderError,
  ProjectNotFoundError,
  ServiceNotFoundError,
  ServiceSelectionRequiredError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import type { ToolContext } from './types.js';
import { analyzeInfrastructureSchema, listDomainsSchema, mapDomainSchema } from './schemas.js';

type AppCtx = ToolContext['appCtx'];
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type ProjectRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getProject']>>>;

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

function serviceSelectionCandidates(services: ServiceRow[]) {
  return services.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    projectId: service.project_id,
    kind: service.kind,
    source: service.source,
  }));
}

async function resolveProject(
  appCtx: AppCtx,
  projectName: string | undefined,
): Promise<ProjectRow | undefined> {
  if (!projectName) return undefined;
  return (
    (await appCtx.db.getProject(projectName)) ?? (await appCtx.db.getProjectByName(projectName))
  );
}

async function resolveDomainServiceTarget(
  appCtx: AppCtx,
  args: Record<string, unknown>,
): Promise<{ service: ServiceRow; project: ProjectRow }> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';

  if (serviceId) {
    const service = await appCtx.db.getService(serviceId);
    if (!service || isManagedService(service.kind)) {
      throw new ServiceNotFoundError(serviceId);
    }
    const project = await appCtx.db.getProject(service.project_id);
    if (!project) {
      throw new ProjectNotFoundError(service.project_id);
    }
    return { service, project };
  }

  const project = await resolveProject(appCtx, projectName);
  if (projectName && !project) {
    throw new ProjectNotFoundError(projectName);
  }

  if (serviceName) {
    const services = (await appCtx.db.listServices()).filter(
      (service) =>
        service.name === serviceName &&
        !isManagedService(service.kind) &&
        (!project || service.project_id === project.id),
    );
    if (services.length > 1) {
      throw new OpenLanderError(
        `Multiple deployable services named '${serviceName}' found. Specify service_id or project_name.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        { serviceName, candidates: serviceSelectionCandidates(services) },
      );
    }
    const service = services[0];
    if (!service) {
      throw new ServiceNotFoundError(
        projectName ? `${serviceName} in ${projectName}` : serviceName,
      );
    }
    const owningProject = project ?? (await appCtx.db.getProject(service.project_id));
    if (!owningProject) {
      throw new ProjectNotFoundError(service.project_id);
    }
    return { service, project: owningProject };
  }

  if (!project) {
    throw new ProjectNotFoundError(projectName || 'unknown');
  }

  const deployables = await appCtx.db.getDeployablesByGroup(project.id);
  if (deployables.length !== 1) {
    throw new ServiceSelectionRequiredError(
      project.id,
      project.name,
      serviceSelectionCandidates(deployables),
    );
  }
  const service = deployables[0];
  if (!service) {
    throw new ServiceNotFoundError(project.name);
  }
  return { service, project };
}

export const infraToolDefs: ToolDef[] = [
  {
    name: 'map_domain',
    riskLevel: 'medium',
    description:
      'Map a custom domain to a deployable service using the configured domain routing backend. Use when the user wants their own stable domain (e.g., api.myapp.com). DNS must point at the OpenLander host or reverse proxy; v0.1 does not create Cloudflare records automatically. Routing takes effect immediately without redeploy. Only redeploy if the app needs build-time env changes (e.g., NEXT_PUBLIC_API_URL, CORS origins). Prefer service_id or service_name; legacy project_name works only when the group has exactly one deployable service. Returns { status, project, service, domain, url }. Errors: PROJECT_NOT_FOUND, SERVICE_NOT_FOUND, SERVICE_SELECTION_REQUIRED.',
    mcpDescription:
      'Map a custom domain to a deployable service. DNS must already point at OpenLander; v0.1 does not create DNS records automatically.',
    inputSchema: mapDomainSchema,
    execute: async (args, { appCtx }) => {
      const domain = args['domain'] as string;
      const { project, service } = await resolveDomainServiceTarget(appCtx, args);

      await appCtx.cloudflare.createTunnelForService(service.id, domain);
      return {
        status: 'mapped',
        project: project.name,
        service: service.name,
        domain,
        url: `https://${domain}`,
        _agent_guidance: {
          next_steps: [
            'Routing is live immediately — no redeploy needed for this service.',
            'If OTHER services reference this service in NEXT_PUBLIC_* env vars (client-side/browser), update those vars to the new public URL and redeploy those services.',
            'Do NOT change server-side env vars like API_URL, DATABASE_URL, etc. — these use internal Docker DNS (http://ol-{name}:{port}) which is faster and must stay internal.',
          ],
          warning:
            'NEVER replace internal Docker URLs (http://ol-*) with public URLs in server-side env vars. Internal DNS is for container-to-container communication. Only NEXT_PUBLIC_* or browser-facing vars should use the public domain.',
        },
      };
    },
  },
  {
    name: 'list_domains',
    riskLevel: 'low',
    description:
      'List all custom domain mappings across all projects with domain name, project ID, and status. Use to check existing domain configurations. Returns { count, domains[] }. Always available, no errors.',
    mcpDescription: 'List all custom domain mappings across projects.',
    inputSchema: listDomainsSchema,
    execute: async (_args, { appCtx }) => {
      const mappings = await appCtx.db.listDomainMappings();
      return Promise.resolve({
        count: mappings.length,
        domains: mappings.map((mapping) => ({
          domain: mapping.domain,
          projectId: mapping.project_id,
          serviceId: mapping.service_id,
          status: mapping.status,
        })),
      });
    },
  },
  {
    name: 'analyze_infrastructure',
    riskLevel: 'low',
    description:
      'Analyze a repository to detect infrastructure needs (databases, caches, etc.) based on dependencies and environment variables. Clones the repo, scans package.json and .env files, and cross-references with existing services. Returns { needs, available, missing } where needs is detected infrastructure, available is already-provisioned services, and missing is what should be created.',
    mcpDescription: 'Analyze repo infrastructure needs against available services.',
    inputSchema: analyzeInfrastructureSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = (args['branch'] as string | undefined) ?? undefined;
      try {
        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
        });
        const existingServices = await appCtx.serviceManager.list();
        const analysis = analyzeInfrastructure(cloneResult.path, existingServices);
        return analysis;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    },
    targets: ['mcp'],
  },
];
