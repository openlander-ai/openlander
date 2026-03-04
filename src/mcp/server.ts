import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AppContext } from '../app.js';
import { getSystemStats, formatStatsSummary } from '../monitor/stats.js';
import { createGitProvider } from '../git-providers/index.js';
import { loadConfig } from '../config/index.js';
const log = createModuleLogger('mcp');

import { createModuleLogger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const deployProjectSchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().optional(),
  name: z.string().optional(),
});

const projectNameSchema = z.object({
  project_name: z.string().min(1),
});

const getLogsSchema = z.object({
  project_name: z.string().min(1),
  lines: z.number().int().positive().optional(),
});

const setEnvVarsSchema = z.object({
  project_name: z.string().min(1),
  variables: z.string().min(1),
});

const setGlobalSecretSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
});
const domainSchema = z.object({
  project_name: z.string().min(1),
  domain: z.string().min(1),
});

const provisionDbSchema = z.object({
  project_name: z.string().min(1),
  db_type: z.string().optional(),
});

const previewDeploySchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().min(1),
});

const previewIdSchema = z.object({
  preview_id: z.string().min(1),
});

const deployStatusSchema = z.object({
  project_name: z.string().optional(),
});

const scanDockerfilesSchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().optional(),
});

const deployMonorepoSchema = z.object({
  repo_url: z.string().min(1),
  clone_path: z.string().min(1),
  commit_sha: z.string().min(1),
  dockerfiles: z.string().min(1),
  branch: z.string().optional(),
});

const listGithubReposSchema = z.object({
  page: z.number().int().positive().optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
});

const searchGithubReposSchema = z.object({
  query: z.string().min(1),
});

const emptySchema = z.object({}).strict();

function toInputSchema(schema: unknown) {
  return zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0]);
}

// ---------------------------------------------------------------------------
// Tool metadata (all 20 tools — includes redeploy which is MCP-only)
// ---------------------------------------------------------------------------

const tools = [
  // --- v0.1 ---
  {
    name: 'deploy_project',
    description:
      'Start deploying a project from a git repository URL. Returns immediately while build runs in background.',
    inputSchema: toInputSchema(deployProjectSchema),
  },
  {
    name: 'stop_project',
    description: 'Stop a running project container.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'remove_project',
    description: 'Remove a project and its container entirely.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'redeploy_project',
    description: 'Redeploy an existing project.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'get_logs',
    description: 'Get recent container logs for a project.',
    inputSchema: toInputSchema(getLogsSchema),
  },
  {
    name: 'list_projects',
    description: 'List all deployed projects with status and URLs.',
    inputSchema: toInputSchema(emptySchema),
  },
  {
    name: 'set_env_vars',
    description: 'Set environment variables for a project. Triggers redeploy if running.',
    inputSchema: toInputSchema(setEnvVarsSchema),
  },
  {
    name: 'set_global_secret',
    description: 'Set a global secret shared across all projects (stored encrypted).',
    inputSchema: toInputSchema(setGlobalSecretSchema),
  },
  {
    name: 'list_global_secrets',
    description: 'List all global secrets (values are masked for security).',
    inputSchema: toInputSchema(emptySchema),
  },
  {
    name: 'expose_public',
    description: 'Create a temporary public URL via TryCloudflare tunnel.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'unexpose_public',
    description: 'Remove the public TryCloudflare tunnel URL for a project.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'get_system_stats',
    description: 'Get host system resource usage.',
    inputSchema: toInputSchema(emptySchema),
  },
  // --- v0.2 ---
  {
    name: 'restart_project',
    description: 'Restart a project by stopping and redeploying it.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'map_domain',
    description: 'Map a custom domain to a project via Cloudflare DNS and Tunnel.',
    inputSchema: toInputSchema(domainSchema),
  },
  {
    name: 'list_domains',
    description: 'List all custom domain mappings.',
    inputSchema: toInputSchema(emptySchema),
  },
  // --- v0.3 ---
  {
    name: 'rollback_project',
    description: 'Rollback a project to its previous image when available.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'provision_database',
    description: 'Provision a database sidecar (PostgreSQL or SQLite) for a project.',
    inputSchema: toInputSchema(provisionDbSchema),
  },
  {
    name: 'deploy_blue_green',
    description: 'Deploy with zero downtime using blue-green strategy.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  {
    name: 'debug_build_error',
    description: 'Analyze a failed build and suggest fixes using AI.',
    inputSchema: toInputSchema(projectNameSchema),
  },
  // --- v0.4 ---
  {
    name: 'preview_deploy',
    description: 'Deploy an ephemeral preview environment for a branch.',
    inputSchema: toInputSchema(previewDeploySchema),
  },
  {
    name: 'cleanup_preview',
    description: 'Remove an ephemeral preview deployment.',
    inputSchema: toInputSchema(previewIdSchema),
  },
  {
    name: 'list_previews',
    description: 'List all active preview deployments.',
    inputSchema: toInputSchema(emptySchema),
  },
  // --- Parallel + Monorepo ---
  {
    name: 'get_deploy_status',
    description: 'Get real-time deployment status for active builds.',
    inputSchema: toInputSchema(deployStatusSchema),
  },
  {
    name: 'scan_dockerfiles',
    description: 'Clone a repo and scan for all Dockerfiles (monorepo detection).',
    inputSchema: toInputSchema(scanDockerfilesSchema),
  },
  {
    name: 'deploy_monorepo',
    description:
      'Start deploying a monorepo with multiple services in parallel. Returns immediately while builds run in background.',
    inputSchema: toInputSchema(deployMonorepoSchema),
  },
  // --- Git Provider ---
  {
    name: 'list_github_repos',
    description:
      'List repositories from the connected GitHub account, sorted by most recently pushed.',
    inputSchema: toInputSchema(listGithubReposSchema),
  },
  {
    name: 'search_github_repos',
    description:
      'Search GitHub repositories by name or keyword. Resolves project names to deployable repo URLs.',
    inputSchema: toInputSchema(searchGithubReposSchema),
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, parsed.error.message);
  }
  return parsed.data;
}

function getProjectIdByName(ctx: AppContext, name: string): string {
  const project = ctx.db.getProjectByName(name);
  if (!project) {
    throw new McpError(ErrorCode.InvalidParams, `Project not found: ${name}`);
  }
  return project.id;
}

function getProjectByName(ctx: AppContext, name: string) {
  const project = ctx.db.getProjectByName(name);
  if (!project) {
    throw new McpError(ErrorCode.InvalidParams, `Project not found: ${name}`);
  }
  return project;
}

function successResponse(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

function errorResponse(error: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startMcpServer(ctx: AppContext): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: '0.4.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [...tools] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments ?? {};

      switch (toolName) {
        // --- v0.1 ---
        case 'deploy_project': {
          const args = parseInput(deployProjectSchema, rawArgs);
          const result = await ctx.pipeline.startDeploy({
            repoUrl: args.repo_url,
            branch: args.branch,
            name: args.name,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
            trigger: 'api',
          });
          if (result.status === 'preflight_failed') {
            return successResponse({
              ...result,
              error: result.preflightError,
              hint: 'Fix the preflight issues and try again.',
            });
          }
          return successResponse({ ...result, hint: 'Use get_deploy_status to check progress.' });
        }

        case 'stop_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          await ctx.pipeline.stop(projectId);
          return successResponse({ status: 'stopped', project: args.project_name });
        }

        case 'remove_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          await ctx.pipeline.remove(projectId);
          return successResponse({ status: 'removed', project: args.project_name });
        }

        case 'redeploy_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const result = await ctx.pipeline.redeploy(projectId);
          return successResponse(result);
        }

        case 'get_logs': {
          const args = parseInput(getLogsSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const logs = await ctx.pipeline.getLogs(projectId, args.lines ?? 50);
          return successResponse({ project: args.project_name, logs });
        }

        case 'list_projects': {
          parseInput(emptySchema, rawArgs);
          const projects = ctx.db.listProjects();
          return successResponse({
            count: projects.length,
            projects: projects.map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              visibility: p.visibility,
              repoUrl: p.repo_url,
              branch: p.branch,
              port: p.assigned_port,
              url: p.assigned_port ? `http://${p.name}.localhost` : null,
              publicUrl: p.public_url,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
            })),
          });
        }

        case 'set_env_vars': {
          const args = parseInput(setEnvVarsSchema, rawArgs);
          const project = getProjectByName(ctx, args.project_name);
          const vars = JSON.parse(args.variables) as Record<string, string>;
          const changed = ctx.env.setBulk(project.id, vars);

          if (changed && project.status === 'running') {
            await ctx.pipeline.redeploy(project.id);
            return successResponse({
              status: 'updated_and_redeployed',
              project: args.project_name,
              keys: Object.keys(vars),
            });
          }
          return successResponse({
            status: 'updated',
            project: args.project_name,
            keys: Object.keys(vars),
          });
        }

        case 'set_global_secret': {
          const args = parseInput(setGlobalSecretSchema, rawArgs);
          ctx.env.setGlobalSecret(args.key, args.value, args.description);
          return successResponse({ status: 'saved', key: args.key });
        }

        case 'list_global_secrets': {
          const secrets = ctx.env.getGlobalSecretsMasked();
          return successResponse({ secrets, count: secrets.length });
        }

        case 'expose_public': {
          const args = parseInput(projectNameSchema, rawArgs);
          const project = getProjectByName(ctx, args.project_name);
          if (!project.assigned_port) {
            return successResponse({ error: 'Project is not running — deploy it first' });
          }
          const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
          return successResponse({ status: 'exposed', project: args.project_name, publicUrl: url });
        }

        case 'unexpose_public': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          ctx.pipeline.closeTunnel(projectId);
          return successResponse({ status: 'unexposed', project: args.project_name });
        }

        case 'get_system_stats': {
          parseInput(emptySchema, rawArgs);
          const stats = getSystemStats();
          return successResponse({
            summary: formatStatsSummary(stats),
            ...stats,
          });
        }

        // --- v0.2 ---
        case 'restart_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          await ctx.pipeline.stop(projectId);
          const result = await ctx.pipeline.redeploy(projectId);
          return successResponse({ status: 'restarted', project: args.project_name, ...result });
        }

        case 'map_domain': {
          const args = parseInput(domainSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          await ctx.cloudflare.createTunnel(projectId, args.domain);
          return successResponse({
            status: 'mapped',
            project: args.project_name,
            domain: args.domain,
            url: `https://${args.domain}`,
          });
        }

        case 'list_domains': {
          parseInput(emptySchema, rawArgs);
          const mappings = ctx.db.listDomainMappings();
          return successResponse({
            count: mappings.length,
            domains: mappings.map((m) => ({
              domain: m.domain,
              projectId: m.project_id,
              status: m.status,
            })),
          });
        }

        // --- v0.3 ---
        case 'rollback_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const result = await ctx.pipeline.rollback(projectId);
          return successResponse(result);
        }

        case 'provision_database': {
          const args = parseInput(provisionDbSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const dbType = args.db_type === 'sqlite' ? 'sqlite' : 'postgres';
          const result = await ctx.dbProvisioner.provision(projectId, { type: dbType });
          return successResponse({ status: 'provisioned', project: args.project_name, ...result });
        }

        case 'deploy_blue_green': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const result = await ctx.blueGreen.deploy(projectId);
          return successResponse(result);
        }

        case 'debug_build_error': {
          if (!ctx.buildDebugger) {
            return successResponse({ error: 'Build debugger requires an LLM provider.' });
          }
          const args = parseInput(projectNameSchema, rawArgs);
          const project = getProjectByName(ctx, args.project_name);
          const lastDeploy = ctx.db.getLastDeployLog(project.id);
          if (!lastDeploy || lastDeploy.status !== 'failed') {
            return successResponse({ error: 'No failed build found for this project.' });
          }
          const diagnosis = await ctx.buildDebugger.diagnose({
            buildLog: lastDeploy.build_log ?? 'No build log available',
            projectName: args.project_name,
            imageTag: project.image_tag ?? `openlander/${args.project_name}:latest`,
            failedStep: 'build',
          });
          return successResponse(diagnosis);
        }

        // --- v0.4 ---
        case 'preview_deploy': {
          const args = parseInput(previewDeploySchema, rawArgs);
          const result = await ctx.previewDeployer.deploy({
            repoUrl: args.repo_url,
            branch: args.branch,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          });
          return successResponse(result);
        }

        case 'cleanup_preview': {
          const args = parseInput(previewIdSchema, rawArgs);
          await ctx.previewDeployer.cleanup(args.preview_id);
          return successResponse({ status: 'cleaned_up', previewId: args.preview_id });
        }

        case 'list_previews': {
          parseInput(emptySchema, rawArgs);
          const previews = ctx.previewDeployer.list();
          return successResponse({
            count: previews.length,
            previews: previews.map((p) => ({
              branch: p.branch,
              url: p.url,
              port: p.port,
              createdAt: p.createdAt.toISOString(),
            })),
          });
        }

        // --- Parallel + Monorepo ---
        case 'get_deploy_status': {
          const args = parseInput(deployStatusSchema, rawArgs);
          if (args.project_name) {
            const project = getProjectByName(ctx, args.project_name);
            const status = ctx.jobManager.getStatus(project.id);
            const isActive = status && status.phase !== 'done' && status.phase !== 'failed';
            return successResponse({
              active: isActive ? 1 : 0,
              jobs: status ? [{ name: args.project_name, phase: status.phase }] : [],
            });
          }
          const jobs = ctx.jobManager.getActiveJobs();
          return successResponse({
            active: jobs.length,
            jobs: jobs.map((j) => ({ name: j.projectName, phase: j.phase })),
          });
        }

        case 'scan_dockerfiles': {
          const args = parseInput(scanDockerfilesSchema, rawArgs);
          const agentTools = (await import('../agent/tools.js')).createTools(ctx);
          const tool = agentTools.find((t) => t.name === 'scan_dockerfiles');
          if (!tool)
            throw new McpError(ErrorCode.InternalError, 'scan_dockerfiles tool not available');
          const result = await tool.execute({ repo_url: args.repo_url, branch: args.branch });
          return successResponse(result);
        }

        case 'deploy_monorepo': {
          const args = parseInput(deployMonorepoSchema, rawArgs);
          const dockerfiles = JSON.parse(args.dockerfiles) as string[];
          const result = ctx.pipeline.startMonorepoDeploy({
            repoUrl: args.repo_url,
            clonePath: args.clone_path,
            commitSha: args.commit_sha,
            dockerfiles,
            branch: args.branch,
          });
          return successResponse({ ...result, hint: 'Use get_deploy_status to check progress.' });
        }

        // --- Git Provider ---
        case 'list_github_repos': {
          const args = parseInput(listGithubReposSchema, rawArgs);
          const config = loadConfig();
          const ghConfig = config.gitProviders.github;
          if (!ghConfig.token) {
            return successResponse({
              error: 'GITHUB_NOT_CONFIGURED',
              message: 'No GitHub token configured.',
            });
          }
          const ghProvider = createGitProvider('github', ghConfig);
          const listResult = await ghProvider.listRepos({
            page: args.page,
            perPage: 30,
            visibility: args.visibility,
          });
          return successResponse({
            count: listResult.repos.length,
            hasMore: listResult.hasMore,
            repos: listResult.repos.map((r) => ({
              name: r.name,
              fullName: r.fullName,
              description: r.description,
              language: r.language,
              private: r.isPrivate,
              cloneUrl: r.isPrivate ? ghProvider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
              htmlUrl: r.htmlUrl,
            })),
          });
        }

        case 'search_github_repos': {
          const args = parseInput(searchGithubReposSchema, rawArgs);
          const searchConfig = loadConfig();
          const searchGhConfig = searchConfig.gitProviders.github;
          if (!searchGhConfig.token) {
            return successResponse({
              error: 'GITHUB_NOT_CONFIGURED',
              message: 'No GitHub token configured.',
            });
          }
          const searchProvider = createGitProvider('github', searchGhConfig);
          const searchResult = await searchProvider.searchRepos(args.query);
          return successResponse({
            total: searchResult.total,
            repos: searchResult.repos.map((r) => ({
              name: r.name,
              fullName: r.fullName,
              description: r.description,
              language: r.language,
              private: r.isPrivate,
              cloneUrl: r.isPrivate ? searchProvider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
              htmlUrl: r.htmlUrl,
            })),
          });
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }
    } catch (error) {
      log.error({ error }, 'Tool execution error');
      return errorResponse(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('OpenLander MCP server started on stdio transport');
}
