import { ProjectNotFoundError } from '../../errors.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import { webSearch } from '../../lib/web-search.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import {
  analyzeInfrastructureSchema,
  listDomainsSchema,
  mapDomainSchema,
  webSearchSchema,
} from './schemas.js';

export const infraToolDefs: ToolDef[] = [
  {
    name: 'map_domain',
    description:
      'Map a custom domain to a project via Cloudflare DNS and Tunnel for a permanent public URL. Use when user wants their own domain (e.g., api.myapp.com) instead of a temporary TryCloudflare URL. Requires Cloudflare configuration. Routing takes effect immediately without redeploy. Only redeploy if the app needs build-time env changes (e.g., NEXT_PUBLIC_API_URL, CORS origins). Returns { status, project, domain, url }. Errors: PROJECT_NOT_FOUND, CLOUDFLARE_NOT_CONFIGURED.',
    inputSchema: mapDomainSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const domain = args['domain'] as string;
      const project = appCtx.db.getProjectByName(projectName);
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
            'Update env vars (e.g., NEXT_PUBLIC_API_URL) in other projects that reference this project, then redeploy them',
            'Call restart_project for any project that needs to pick up the new domain configuration',
          ],
        },
      };
    },
  },
  {
    name: 'list_domains',
    description:
      'List all custom domain mappings across all projects with domain name, project ID, and status. Use to check existing domain configurations. Returns { count, domains[] }. Always available, no errors.',
    inputSchema: listDomainsSchema,
    execute: (_args, { appCtx }) => {
      const mappings = appCtx.db.listDomainMappings();
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
    description:
      'Analyze a repository to detect infrastructure needs (databases, caches, etc.) based on dependencies and environment variables. Clones the repo, scans package.json and .env files, and cross-references with existing services. Returns { needs, available, missing } where needs is detected infrastructure, available is already-provisioned services, and missing is what should be created.',
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
        return { error: message };
      }
    },
    targets: ['mcp'],
  },
  {
    name: 'web_search',
    description:
      'Search the web using DuckDuckGo. Returns search results with title, URL, and snippet. No API key required. Use when you need to find information online.',
    inputSchema: webSearchSchema,
    execute: async (args) => {
      const query = args['query'] as string;
      const maxResults = (args['max_results'] as number | undefined) ?? undefined;
      try {
        const result = await webSearch(query, { maxResults });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message };
      }
    },
    targets: ['mcp'],
  },
];
