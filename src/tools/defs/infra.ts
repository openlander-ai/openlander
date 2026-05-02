import { ProjectNotFoundError } from '../../errors.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import { analyzeInfrastructureSchema, listDomainsSchema, mapDomainSchema } from './schemas.js';

export const infraToolDefs: ToolDef[] = [
  {
    name: 'map_domain',
    riskLevel: 'medium',
    description:
      'Map a custom domain to a project via Cloudflare DNS and Tunnel for a permanent public URL. Use when user wants their own domain (e.g., api.myapp.com) instead of a temporary TryCloudflare URL. Requires Cloudflare configuration. Routing takes effect immediately without redeploy. Only redeploy if the app needs build-time env changes (e.g., NEXT_PUBLIC_API_URL, CORS origins). Returns { status, project, domain, url }. Errors: PROJECT_NOT_FOUND, CLOUDFLARE_NOT_CONFIGURED.',
    mcpDescription: 'Map a custom domain to a project via Cloudflare routing.',
    inputSchema: mapDomainSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const domain = args['domain'] as string;
      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await appCtx.cloudflare.createTunnel(project.id, domain);
      return {
        status: 'mapped',
        project: projectName,
        domain,
        url: `https://${domain}`,
        _agent_guidance: {
          next_steps: [
            'Routing is live immediately — no redeploy needed for this project.',
            'If OTHER projects reference this project in NEXT_PUBLIC_* env vars (client-side/browser), update those vars to the new public URL and redeploy those projects.',
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
