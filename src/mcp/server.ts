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

const emptySchema = z.object({}).strict();

function toInputSchema(schema: unknown) {
  return zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0]);
}

const tools = [
  {
    name: 'deploy_project',
    description: 'Deploy a project from a git repository URL.',
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
    name: 'rollback_project',
    description: 'Rollback a project to its previous image when available.',
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
    name: 'get_system_stats',
    description: 'Get host system resource usage.',
    inputSchema: toInputSchema(emptySchema),
  },
] as const;

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

export async function startMcpServer(ctx: AppContext): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: '0.3.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: [...tools] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments ?? {};

      switch (toolName) {
        case 'deploy_project': {
          const args = parseInput(deployProjectSchema, rawArgs);
          const result = await ctx.pipeline.deploy({
            repoUrl: args.repo_url,
            branch: args.branch,
            name: args.name,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
            trigger: 'api',
          });
          return successResponse(result);
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

        case 'rollback_project': {
          const args = parseInput(projectNameSchema, rawArgs);
          const projectId = getProjectIdByName(ctx, args.project_name);
          const result = await ctx.pipeline.rollback(projectId);
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

        case 'get_system_stats': {
          parseInput(emptySchema, rawArgs);
          const stats = getSystemStats();
          return successResponse({
            summary: formatStatsSummary(stats),
            ...stats,
          });
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }
    } catch (error) {
      console.error('[MCP] Tool execution error:', error);
      return errorResponse(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] OpenLander MCP server started on stdio transport');
}
