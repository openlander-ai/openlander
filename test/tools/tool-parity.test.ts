import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import type { AppContext } from '../../src/app.js';
import { createTools } from '../../src/agent/tools.js';
import { startMcpServer } from '../../src/mcp/server.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

type MockServerInstance = {
  handlers: Map<unknown, (request: unknown) => Promise<unknown> | unknown>;
};

const mockServerInstances: MockServerInstance[] = [];
const { mockLoadConfig, mockCreateGitProvider, mockGithubListRepos, mockBuildDiagnose } =
  vi.hoisted(() => ({
    mockLoadConfig: vi.fn(),
    mockCreateGitProvider: vi.fn(),
    mockGithubListRepos: vi.fn(),
    mockBuildDiagnose: vi.fn(),
  }));

vi.mock('../../src/config/index.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../../src/git-providers/index.js', () => ({
  createGitProvider: mockCreateGitProvider,
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    handlers = new Map<unknown, (request: unknown) => Promise<unknown> | unknown>();

    constructor() {
      mockServerInstances.push(this as MockServerInstance);
    }

    setRequestHandler(schema: unknown, handler: (request: unknown) => Promise<unknown> | unknown) {
      this.handlers.set(schema, handler);
    }

    connect = vi.fn(async () => undefined);
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}));

function createMockContext(): AppContext {
  const project = {
    id: 'project-1',
    name: 'demo-app',
    status: 'running',
    visibility: 'internal',
    repo_url: 'https://github.com/acme/demo-app',
    branch: 'main',
    assigned_port: 10001,
    public_url: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 01:00:00',
    image_tag: null,
  } as const;

  return {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    db: {
      listProjects: vi.fn(() => [project]),
      getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
      getLastDeployLog: vi.fn(() => ({
        id: 'deploy-log-1',
        status: 'failed',
        build_log: 'npm ERR! build failed',
      })),
      setPendingFix: vi.fn(),
    },
    pipeline: {
      getLogs: vi.fn(async (_projectId: string, _lines: number) => 'line1\nline2'),
      startDeploy: vi.fn(async () => ({
        projectId: 'project-1',
        projectName: 'demo-app',
        status: 'building',
      })),
    },
    buildDebugger: {
      diagnose: mockBuildDiagnose,
    },
    serviceManager: {
      list: vi.fn(async () => []),
    },
    env: {
      setBulk: vi.fn(),
      setGlobalSecret: vi.fn(),
      getGlobalSecretsMasked: vi.fn(() => []),
    },
    questionBridge: undefined,
    planEngine: {
      createPlan: vi.fn(async () => ({
        plan_id: 'plan_test123',
        status: 'ready',
        complexity: 'simple',
        app: { name: 'demo-app' },
        services: [],
        env: {
          required: [],
          auto: [],
          provided: {},
        },
        missing: [],
        warnings: [],
      })),
      updatePlan: vi.fn(),
      executePlan: vi.fn(),
    },
  } as unknown as AppContext;
}

function simplifyPropertySchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const typed = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of ['type', 'description', 'enum', '$ref']) {
    if (typed[key] !== undefined) {
      result[key] = typed[key];
    }
  }

  if (Array.isArray(typed['anyOf'])) {
    result['anyOf'] = (typed['anyOf'] as unknown[]).map((entry) => simplifyPropertySchema(entry));
  }

  if (typed['items']) {
    result['items'] = simplifyPropertySchema(typed['items']);
  }

  return result;
}

function simplifyToolSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {};
  }

  const typed = schema as Record<string, unknown>;
  const resolveRef = (target: Record<string, unknown>): Record<string, unknown> => {
    const ref = target['$ref'];
    if (typeof ref === 'string') {
      if (ref.startsWith('#/definitions/')) {
        const key = ref.slice('#/definitions/'.length);
        const defs = target['definitions'];
        if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
          const schemaFromRef = (defs as Record<string, unknown>)[key];
          if (schemaFromRef && typeof schemaFromRef === 'object' && !Array.isArray(schemaFromRef)) {
            return schemaFromRef as Record<string, unknown>;
          }
        }
      }

      if (ref.startsWith('#/$defs/')) {
        const key = ref.slice('#/$defs/'.length);
        const defs = target['$defs'];
        if (defs && typeof defs === 'object' && !Array.isArray(defs)) {
          const schemaFromRef = (defs as Record<string, unknown>)[key];
          if (schemaFromRef && typeof schemaFromRef === 'object' && !Array.isArray(schemaFromRef)) {
            return schemaFromRef as Record<string, unknown>;
          }
        }
      }
    }

    for (const compositeKey of ['allOf', 'anyOf', 'oneOf']) {
      const composite = target[compositeKey];
      if (Array.isArray(composite)) {
        const firstSchema = composite.find(
          (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
        ) as Record<string, unknown> | undefined;
        if (firstSchema) {
          return resolveRef(firstSchema);
        }
      }
    }

    const definitions = target['definitions'];
    if (definitions && typeof definitions === 'object' && !Array.isArray(definitions)) {
      const keys = Object.keys(definitions as Record<string, unknown>);
      if (keys.length === 1) {
        const first = (definitions as Record<string, unknown>)[keys[0]];
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          return first as Record<string, unknown>;
        }
      }
    }

    return target;
  };

  const resolved = resolveRef(typed);
  const properties =
    resolved['properties'] &&
    typeof resolved['properties'] === 'object' &&
    !Array.isArray(resolved['properties'])
      ? (resolved['properties'] as Record<string, unknown>)
      : {};

  const sortedProperties = Object.fromEntries(
    Object.keys(properties)
      .sort()
      .map((name) => [name, simplifyPropertySchema(properties[name])]),
  );

  const required = Array.isArray(resolved['required'])
    ? [...(resolved['required'] as string[])].sort()
    : [];

  return {
    type: resolved['type'] ?? null,
    required,
    properties: sortedProperties,
  };
}

function schemaShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }
    return [schemaShape(value[0])];
  }

  if (value && typeof value === 'object') {
    const typed = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(typed)
        .sort()
        .map((key) => [key, schemaShape(typed[key])]),
    ) as Record<string, unknown>;
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function topLevelKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

async function getMcpHandlers(ctx: AppContext) {
  await startMcpServer(ctx);
  const server = mockServerInstances[mockServerInstances.length - 1];
  expect(server).toBeDefined();

  const listToolsHandler = server?.handlers.get(ListToolsRequestSchema);
  const callToolHandler = server?.handlers.get(CallToolRequestSchema);

  expect(listToolsHandler).toBeDefined();
  expect(callToolHandler).toBeDefined();

  return {
    listToolsHandler: listToolsHandler as (
      request: unknown,
    ) => Promise<{ tools: unknown[] }> | { tools: unknown[] },
    callToolHandler: callToolHandler as (request: unknown) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    }>,
  };
}

async function callMcpTool(
  callToolHandler: (
    request: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await callToolHandler({ params: { name, arguments: args } });
  return JSON.parse(response.content[0]?.text ?? 'null') as unknown;
}

describe('Tool parity baseline snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerInstances.length = 0;

    mockLoadConfig.mockReturnValue({
      gitProviders: {
        github: {
          token: 'gh-token',
        },
      },
    });

    mockGithubListRepos.mockResolvedValue({
      repos: [
        {
          name: 'demo-app',
          fullName: 'acme/demo-app',
          description: 'Demo app',
          language: 'TypeScript',
          isPrivate: false,
          defaultBranch: 'main',
          stars: 10,
          cloneUrl: 'https://github.com/acme/demo-app.git',
          htmlUrl: 'https://github.com/acme/demo-app',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      hasMore: false,
    });

    mockCreateGitProvider.mockReturnValue({
      listRepos: mockGithubListRepos,
      getAuthCloneUrl: (fullName: string) =>
        `https://x-access-token:gh-token@github.com/${fullName}.git`,
    });

    mockBuildDiagnose.mockResolvedValue({
      summary: 'Install missing dependency',
      rootCause: 'Missing package-lock.json',
      suggestedFixes: ['Run npm install and commit lockfile'],
    });
  });

  it('snapshots agent tool names and simplified input schemas', () => {
    const ctx = createMockContext();
    const tools = createTools(ctx);

    const snapshot = Object.entries(tools)
      .sort(([nameA], [nameB]) => nameA.localeCompare(nameB))
      .map(([name, toolDef]) => ({
        name,
        inputSchema: simplifyToolSchema(
          z.toJSONSchema((toolDef as { inputSchema: z.ZodType }).inputSchema),
        ),
      }));

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "inputSchema": {
            "properties": {
              "preview_id": {
                "description": "Preview deployment ID",
                "type": "string",
              },
            },
            "required": [
              "preview_id",
            ],
            "type": "object",
          },
          "name": "cleanup_preview",
        },
        {
          "inputSchema": {
            "properties": {
              "database_name": {
                "description": "Database name to create",
                "type": "string",
              },
              "service_name": {
                "description": "Service name where database will be created",
                "type": "string",
              },
            },
            "required": [
              "database_name",
              "service_name",
            ],
            "type": "object",
          },
          "name": "create_database",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to deploy (default: repo default branch)",
                "type": "string",
              },
              "docker_target": {
                "description": "Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)",
                "type": "string",
              },
              "dockerfile_path": {
                "description": "Relative Dockerfile path inside the repository (e.g., frontend/Dockerfile)",
                "type": "string",
              },
              "env_vars": {
                "description": "JSON object of environment variables to include in the plan (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})",
                "type": "string",
              },
              "name": {
                "description": "Project name (auto-generated from repo if not provided)",
                "type": "string",
              },
              "prefer_dockerfile": {
                "description": "Prefer Dockerfile flow and skip compose detection",
                "type": "boolean",
              },
              "repo_url": {
                "description": "Git repository URL (e.g., github.com/user/repo)",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "create_deploy_plan",
        },
        {
          "inputSchema": {
            "properties": {
              "build_log": {
                "description": "Optional build log text to analyze when stored deploy logs are missing",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "debug_build_error",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "deploy_blue_green",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "name": {
                "description": "Project name (auto-generated from repo if omitted)",
                "type": "string",
              },
              "profiles": {
                "description": "Docker Compose profiles to activate (e.g., ["infra", "dev"])",
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "deploy_compose",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "clone_path": {
                "description": "Path where repo is cloned",
                "type": "string",
              },
              "commit_sha": {
                "description": "Commit SHA",
                "type": "string",
              },
              "dockerfiles": {
                "anyOf": [
                  {
                    "items": {
                      "type": "string",
                    },
                    "type": "array",
                  },
                  {
                    "type": "string",
                  },
                ],
                "description": "Dockerfile paths from scan_dockerfiles — array or JSON string, e.g. ["frontend/Dockerfile", "backend/Dockerfile"]",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "clone_path",
              "commit_sha",
              "dockerfiles",
              "repo_url",
            ],
            "type": "object",
          },
          "name": "deploy_monorepo",
        },
        {
          "inputSchema": {
            "properties": {
              "alert_id": {
                "description": "Alert ID",
                "type": "string",
              },
            },
            "required": [
              "alert_id",
            ],
            "type": "object",
          },
          "name": "dismiss_alert",
        },
        {
          "inputSchema": {
            "properties": {
              "deploy_only": {
                "description": "For compose projects: deploy only these service names (e.g., ["backend", "worker"]). Omit to deploy all services.",
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "plan_id": {
                "description": "Plan ID to execute. Plan must be in "ready" status.",
                "type": "string",
              },
            },
            "required": [
              "plan_id",
            ],
            "type": "object",
          },
          "name": "execute_deploy_plan",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "expose_public",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Name of project with Dockerfile build error",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "fix_dockerfile",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "get_alerts",
        },
        {
          "inputSchema": {
            "properties": {
              "deploy_index": {
                "description": "Deploy index (0 = latest, 1 = previous). Default: 0",
                "type": "integer",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_build_log",
        },
        {
          "inputSchema": {
            "properties": {
              "environment_name": {
                "description": "Filter by environment (e.g. "production", "development")",
                "type": "string",
              },
              "limit": {
                "description": "Max entries to return (default 10)",
                "type": "number",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_deploy_history",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name (optional, returns all if omitted)",
                "type": "string",
              },
              "timeout": {
                "description": "Max wait time in seconds (default 300, only used with wait=true)",
                "type": "number",
              },
              "wait": {
                "description": "If true, block until deploy completes instead of returning current status",
                "type": "boolean",
              },
            },
            "required": [],
            "type": "object",
          },
          "name": "get_deploy_status",
        },
        {
          "inputSchema": {
            "properties": {
              "key": {
                "description": "Environment variable key to retrieve",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "key",
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_env_var",
        },
        {
          "inputSchema": {
            "properties": {
              "lines": {
                "description": "Number of log lines to retrieve",
                "type": "integer",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_logs",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "get_system_stats",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "list_compose_services",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name to inspect",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "list_databases",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_domains",
        },
        {
          "inputSchema": {
            "properties": {
              "environment_name": {
                "description": "Environment name to show source tracking (global/project/production/environment). Omit for backward-compatible response.",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "list_env_vars",
        },
        {
          "inputSchema": {
            "properties": {
              "page": {
                "description": "Page number",
                "type": "integer",
              },
              "visibility": {
                "description": "Repository visibility filter",
                "enum": [
                  "all",
                  "public",
                  "private",
                ],
                "type": "string",
              },
            },
            "required": [],
            "type": "object",
          },
          "name": "list_github_repos",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_global_secrets",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_previews",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_projects",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_services",
        },
        {
          "inputSchema": {
            "properties": {
              "domain": {
                "description": "Domain name",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "domain",
              "project_name",
            ],
            "type": "object",
          },
          "name": "map_domain",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "profiles": {
                "description": "Docker Compose profiles to activate (e.g., ["infra", "dev"])",
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "orchestrate_deploy",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to preview",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "branch",
              "repo_url",
            ],
            "type": "object",
          },
          "name": "preview_deploy",
        },
        {
          "inputSchema": {
            "properties": {
              "db_type": {
                "description": "Database type: "sqlite" or "postgres" (default: postgres)",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "provision_database",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "remove_project",
        },
        {
          "inputSchema": {
            "properties": {
              "no_cache": {
                "description": "Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.",
                "type": "boolean",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "restart_project",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "rollback_project",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to scan",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "scan_dockerfiles",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "clone_path": {
                "description": "Existing clone path to reuse instead of cloning again",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "scan_project",
        },
        {
          "inputSchema": {
            "properties": {
              "query": {
                "description": "Search query",
                "type": "string",
              },
            },
            "required": [
              "query",
            ],
            "type": "object",
          },
          "name": "search_github_repos",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
              "variables": {
                "description": "JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})",
                "type": "string",
              },
            },
            "required": [
              "project_name",
              "variables",
            ],
            "type": "object",
          },
          "name": "set_env_vars",
        },
        {
          "inputSchema": {
            "properties": {
              "description": {
                "description": "Description of the secret",
                "type": "string",
              },
              "key": {
                "description": "Secret key",
                "type": "string",
              },
              "value": {
                "description": "Secret value",
                "type": "string",
              },
            },
            "required": [
              "key",
              "value",
            ],
            "type": "object",
          },
          "name": "set_global_secret",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "stop_project",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "unexpose_public",
        },
        {
          "inputSchema": {
            "properties": {
              "plan_id": {
                "description": "Plan ID returned from create_deploy_plan",
                "type": "string",
              },
              "updates": {
                "description": "JSON object with plan updates. Supported fields: env (to fill missing environment variables), dockerfile (to select specific Dockerfile), services (to configure service decisions)",
                "type": "string",
              },
            },
            "required": [
              "plan_id",
              "updates",
            ],
            "type": "object",
          },
          "name": "update_deploy_plan",
        },
      ]
    `);
  });

  it('snapshots MCP tool names and simplified JSON schemas from MCP server', async () => {
    const ctx = createMockContext();
    const { listToolsHandler } = await getMcpHandlers(ctx);
    const listed = await listToolsHandler({});

    const snapshot = [...listed.tools]
      .map((tool) => tool as { name: string; inputSchema: unknown })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        name: tool.name,
        inputSchema: simplifyToolSchema(tool.inputSchema),
      }));

    expect(snapshot).toMatchInlineSnapshot(`
      [
        {
          "inputSchema": {
            "properties": {
              "goal": {
                "description": "The goal for the agent to accomplish using available tools",
                "type": "string",
              },
            },
            "required": [
              "goal",
            ],
            "type": "object",
          },
          "name": "agent_execute_goal",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "analyze_infrastructure",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "backup_service",
        },
        {
          "inputSchema": {
            "properties": {
              "preview_id": {
                "description": "Preview deployment ID",
                "type": "string",
              },
            },
            "required": [
              "preview_id",
            ],
            "type": "object",
          },
          "name": "cleanup_preview",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to deploy (default: repo default branch)",
                "type": "string",
              },
              "docker_target": {
                "description": "Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)",
                "type": "string",
              },
              "dockerfile_path": {
                "description": "Relative Dockerfile path inside the repository (e.g., frontend/Dockerfile)",
                "type": "string",
              },
              "env_vars": {
                "description": "JSON object of environment variables to include in the plan (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})",
                "type": "string",
              },
              "name": {
                "description": "Project name (auto-generated from repo if not provided)",
                "type": "string",
              },
              "prefer_dockerfile": {
                "description": "Prefer Dockerfile flow and skip compose detection",
                "type": "boolean",
              },
              "repo_url": {
                "description": "Git repository URL (e.g., github.com/user/repo)",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "create_deploy_plan",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Git branch for this environment",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
              "type": {
                "description": "Environment type",
                "enum": [
                  "production",
                  "development",
                ],
                "type": "string",
              },
            },
            "required": [
              "branch",
              "project_name",
              "type",
            ],
            "type": "object",
          },
          "name": "create_environment",
        },
        {
          "inputSchema": {
            "properties": {
              "image": {
                "description": "Docker image",
                "type": "string",
              },
              "name": {
                "description": "Service name",
                "type": "string",
              },
              "port": {
                "description": "Port number",
                "type": "integer",
              },
              "template": {
                "description": "Service template (postgres, mysql, redis, etc.)",
                "type": "string",
              },
            },
            "required": [
              "name",
            ],
            "type": "object",
          },
          "name": "create_service",
        },
        {
          "inputSchema": {
            "properties": {
              "database_name": {
                "description": "Database name",
                "type": "string",
              },
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "database_name",
              "service_name",
            ],
            "type": "object",
          },
          "name": "create_service_database",
        },
        {
          "inputSchema": {
            "properties": {
              "database": {
                "description": "Database name",
                "type": "string",
              },
              "password": {
                "description": "Password (auto-generated if omitted)",
                "type": "string",
              },
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
              "username": {
                "description": "Username",
                "type": "string",
              },
            },
            "required": [
              "service_name",
              "username",
            ],
            "type": "object",
          },
          "name": "create_service_user",
        },
        {
          "inputSchema": {
            "properties": {
              "build_log": {
                "description": "Optional build log text to analyze when stored deploy logs are missing",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "debug_build_error",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "deploy_blue_green",
        },
        {
          "inputSchema": {
            "properties": {
              "environment_type": {
                "description": "Environment to deploy",
                "enum": [
                  "production",
                  "development",
                ],
                "type": "string",
              },
              "no_cache": {
                "description": "Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.",
                "type": "boolean",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "environment_type",
              "project_name",
            ],
            "type": "object",
          },
          "name": "deploy_environment",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch",
                "type": "string",
              },
              "clone_path": {
                "description": "Path where repo is cloned",
                "type": "string",
              },
              "commit_sha": {
                "description": "Commit SHA",
                "type": "string",
              },
              "dockerfiles": {
                "anyOf": [
                  {
                    "items": {
                      "type": "string",
                    },
                    "type": "array",
                  },
                  {
                    "type": "string",
                  },
                ],
                "description": "Dockerfile paths from scan_dockerfiles — array or JSON string, e.g. ["frontend/Dockerfile", "backend/Dockerfile"]",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "clone_path",
              "commit_sha",
              "dockerfiles",
              "repo_url",
            ],
            "type": "object",
          },
          "name": "deploy_monorepo",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
              "source": {
                "description": "Git provider",
                "enum": [
                  "github",
                  "gitlab",
                  "bitbucket",
                ],
                "type": "string",
              },
            },
            "required": [
              "project_name",
              "source",
            ],
            "type": "object",
          },
          "name": "disable_webhook",
        },
        {
          "inputSchema": {
            "properties": {
              "branch_filter": {
                "description": "Branch to trigger deploys on (default: main)",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
              "source": {
                "description": "Git provider",
                "enum": [
                  "github",
                  "gitlab",
                  "bitbucket",
                ],
                "type": "string",
              },
            },
            "required": [
              "project_name",
              "source",
            ],
            "type": "object",
          },
          "name": "enable_webhook",
        },
        {
          "inputSchema": {
            "properties": {
              "deploy_only": {
                "description": "For compose projects: deploy only these service names (e.g., ["backend", "worker"]). Omit to deploy all services.",
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "plan_id": {
                "description": "Plan ID to execute. Plan must be in "ready" status.",
                "type": "string",
              },
            },
            "required": [
              "plan_id",
            ],
            "type": "object",
          },
          "name": "execute_deploy_plan",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "expose_public",
        },
        {
          "inputSchema": {
            "properties": {
              "deploy_index": {
                "description": "Deploy index (0 = latest, 1 = previous). Default: 0",
                "type": "integer",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_build_log",
        },
        {
          "inputSchema": {
            "properties": {
              "environment_name": {
                "description": "Filter by environment (e.g. "production", "development")",
                "type": "string",
              },
              "limit": {
                "description": "Max entries to return (default 10)",
                "type": "number",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_deploy_history",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name (optional, returns all if omitted)",
                "type": "string",
              },
              "timeout": {
                "description": "Max wait time in seconds (default 300, only used with wait=true)",
                "type": "number",
              },
              "wait": {
                "description": "If true, block until deploy completes instead of returning current status",
                "type": "boolean",
              },
            },
            "required": [],
            "type": "object",
          },
          "name": "get_deploy_status",
        },
        {
          "inputSchema": {
            "properties": {
              "key": {
                "description": "Environment variable key to retrieve",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "key",
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_env_var",
        },
        {
          "inputSchema": {
            "properties": {
              "lines": {
                "description": "Number of log lines to retrieve",
                "type": "integer",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_logs",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "get_service_credentials",
        },
        {
          "inputSchema": {
            "properties": {
              "lines": {
                "description": "Number of log lines to retrieve",
                "type": "integer",
              },
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "get_service_logs",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "get_service_status",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "get_system_stats",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "get_webhook_config",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_domains",
        },
        {
          "inputSchema": {
            "properties": {
              "environment_name": {
                "description": "Environment name to show source tracking (global/project/production/environment). Omit for backward-compatible response.",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "list_env_vars",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "list_environments",
        },
        {
          "inputSchema": {
            "properties": {
              "page": {
                "description": "Page number",
                "type": "integer",
              },
              "visibility": {
                "description": "Repository visibility filter",
                "enum": [
                  "all",
                  "public",
                  "private",
                ],
                "type": "string",
              },
            },
            "required": [],
            "type": "object",
          },
          "name": "list_github_repos",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_global_secrets",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_previews",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_projects",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name. Omit to list global secret files.",
                "type": "string",
              },
            },
            "required": [],
            "type": "object",
          },
          "name": "list_secret_files",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "list_service_backups",
        },
        {
          "inputSchema": {
            "properties": {},
            "required": [],
            "type": "object",
          },
          "name": "list_services",
        },
        {
          "inputSchema": {
            "properties": {
              "domain": {
                "description": "Domain name",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "domain",
              "project_name",
            ],
            "type": "object",
          },
          "name": "map_domain",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to preview",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "branch",
              "repo_url",
            ],
            "type": "object",
          },
          "name": "preview_deploy",
        },
        {
          "inputSchema": {
            "properties": {
              "db_type": {
                "description": "Database type: "sqlite" or "postgres" (default: postgres)",
                "type": "string",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "provision_database",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "remove_project",
        },
        {
          "inputSchema": {
            "properties": {
              "filename": {
                "description": "Filename to remove",
                "type": "string",
              },
              "project_name": {
                "description": "Project name. Omit for global secret file.",
                "type": "string",
              },
            },
            "required": [
              "filename",
            ],
            "type": "object",
          },
          "name": "remove_secret_file",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "remove_service",
        },
        {
          "inputSchema": {
            "properties": {
              "no_cache": {
                "description": "Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.",
                "type": "boolean",
              },
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "restart_project",
        },
        {
          "inputSchema": {
            "properties": {
              "backup_id": {
                "type": "string",
              },
              "service_name": {
                "type": "string",
              },
            },
            "required": [
              "backup_id",
              "service_name",
            ],
            "type": "object",
          },
          "name": "restore_service",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "rollback_project",
        },
        {
          "inputSchema": {
            "properties": {
              "branch": {
                "description": "Branch to scan",
                "type": "string",
              },
              "repo_url": {
                "description": "Git repository URL",
                "type": "string",
              },
            },
            "required": [
              "repo_url",
            ],
            "type": "object",
          },
          "name": "scan_dockerfiles",
        },
        {
          "inputSchema": {
            "properties": {
              "query": {
                "description": "Search query",
                "type": "string",
              },
            },
            "required": [
              "query",
            ],
            "type": "object",
          },
          "name": "search_github_repos",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
              "variables": {
                "description": "JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})",
                "type": "string",
              },
            },
            "required": [
              "project_name",
              "variables",
            ],
            "type": "object",
          },
          "name": "set_env_vars",
        },
        {
          "inputSchema": {
            "properties": {
              "description": {
                "description": "Description of the secret",
                "type": "string",
              },
              "key": {
                "description": "Secret key",
                "type": "string",
              },
              "value": {
                "description": "Secret value",
                "type": "string",
              },
            },
            "required": [
              "key",
              "value",
            ],
            "type": "object",
          },
          "name": "set_global_secret",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "start_service",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "stop_project",
        },
        {
          "inputSchema": {
            "properties": {
              "service_name": {
                "description": "Service name",
                "type": "string",
              },
            },
            "required": [
              "service_name",
            ],
            "type": "object",
          },
          "name": "stop_service",
        },
        {
          "inputSchema": {
            "properties": {
              "project_name": {
                "description": "Project name",
                "type": "string",
              },
            },
            "required": [
              "project_name",
            ],
            "type": "object",
          },
          "name": "unexpose_public",
        },
        {
          "inputSchema": {
            "properties": {
              "plan_id": {
                "description": "Plan ID returned from create_deploy_plan",
                "type": "string",
              },
              "updates": {
                "description": "JSON object with plan updates. Supported fields: env (to fill missing environment variables), dockerfile (to select specific Dockerfile), services (to configure service decisions)",
                "type": "string",
              },
            },
            "required": [
              "plan_id",
              "updates",
            ],
            "type": "object",
          },
          "name": "update_deploy_plan",
        },
        {
          "inputSchema": {
            "properties": {
              "content": {
                "description": "File content (plaintext — will be encrypted at rest)",
                "type": "string",
              },
              "filename": {
                "description": "Filename (e.g. firebase-sa.json, tls-cert.pem)",
                "type": "string",
              },
              "mount_path": {
                "description": "Container mount directory (default: /run/secrets). File available at mount_path/filename.",
                "type": "string",
              },
              "project_name": {
                "description": "Project name. Omit for global secret file (shared across all projects).",
                "type": "string",
              },
            },
            "required": [
              "content",
              "filename",
            ],
            "type": "object",
          },
          "name": "upload_secret_file",
        },
        {
          "inputSchema": {
            "properties": {
              "max_results": {
                "description": "Maximum results",
                "type": "integer",
              },
              "query": {
                "description": "Search query",
                "type": "string",
              },
            },
            "required": [
              "query",
            ],
            "type": "object",
          },
          "name": "web_search",
        },
      ]
    `);
  });

  it('checks response-shape parity baseline for drift-prone tools', async () => {
    const ctx = createMockContext();
    const agentTools = createTools(ctx);
    const { callToolHandler } = await getMcpHandlers(ctx);

    const argsByTool: Record<string, Record<string, unknown>> = {
      list_projects: {},
      get_logs: { project_name: 'demo-app' },
      list_github_repos: {},
      create_deploy_plan: {
        repo_url: 'https://github.com/acme/demo-app',
        branch: 'main',
        name: 'demo-app',
      },
      debug_build_error: { project_name: 'demo-app' },
    };

    const parity = [] as Array<{
      tool: string;
      topLevelAgentKeys: string[];
      topLevelMcpKeys: string[];
      sharedTopLevelKeys: string[];
      exactTopLevelParity: boolean;
      agentShape: unknown;
      mcpShape: unknown;
    }>;

    for (const tool of [
      'list_projects',
      'get_logs',
      'list_github_repos',
      'create_deploy_plan',
      'debug_build_error',
    ]) {
      const args = argsByTool[tool];
      const agentResult = await (
        agentTools[tool] as { execute: (a: unknown, b: unknown) => Promise<unknown> }
      ).execute(args, { toolCallId: 'test', messages: [] });
      const mcpResult = await callMcpTool(callToolHandler, tool, args);

      const agentKeys = topLevelKeys(agentResult);
      const mcpKeys = topLevelKeys(mcpResult);
      const shared = agentKeys.filter((key) => mcpKeys.includes(key));

      parity.push({
        tool,
        topLevelAgentKeys: agentKeys,
        topLevelMcpKeys: mcpKeys,
        sharedTopLevelKeys: shared,
        exactTopLevelParity: JSON.stringify(agentKeys) === JSON.stringify(mcpKeys),
        agentShape: schemaShape(agentResult),
        mcpShape: schemaShape(mcpResult),
      });
    }

    expect(parity).toMatchInlineSnapshot(`
      [
        {
          "agentShape": {
            "count": "number",
            "projects": [
              {
                "containerName": "null",
                "name": "string",
                "port": "number",
                "publicUrl": "null",
                "repoUrl": "string",
                "status": "string",
                "url": "string",
                "visibility": "string",
              },
            ],
          },
          "exactTopLevelParity": true,
          "mcpShape": {
            "count": "number",
            "projects": [
              {
                "branch": "string",
                "containerName": "null",
                "createdAt": "string",
                "id": "string",
                "name": "string",
                "port": "number",
                "publicUrl": "null",
                "repoUrl": "string",
                "status": "string",
                "updatedAt": "string",
                "url": "string",
                "urls": [
                  {
                    "ip": "string",
                    "type": "string",
                    "url": "string",
                  },
                ],
                "visibility": "string",
              },
            ],
          },
          "sharedTopLevelKeys": [
            "count",
            "projects",
          ],
          "tool": "list_projects",
          "topLevelAgentKeys": [
            "count",
            "projects",
          ],
          "topLevelMcpKeys": [
            "count",
            "projects",
          ],
        },
        {
          "agentShape": {
            "logs": "string",
            "project": "string",
          },
          "exactTopLevelParity": true,
          "mcpShape": {
            "logs": "string",
            "project": "string",
          },
          "sharedTopLevelKeys": [
            "logs",
            "project",
          ],
          "tool": "get_logs",
          "topLevelAgentKeys": [
            "logs",
            "project",
          ],
          "topLevelMcpKeys": [
            "logs",
            "project",
          ],
        },
        {
          "agentShape": {
            "count": "number",
            "hasMore": "boolean",
            "repos": [
              {
                "cloneUrl": "string",
                "defaultBranch": "string",
                "description": "string",
                "fullName": "string",
                "htmlUrl": "string",
                "language": "string",
                "name": "string",
                "private": "boolean",
                "stars": "number",
                "updatedAt": "string",
              },
            ],
          },
          "exactTopLevelParity": true,
          "mcpShape": {
            "count": "number",
            "hasMore": "boolean",
            "repos": [
              {
                "cloneUrl": "string",
                "description": "string",
                "fullName": "string",
                "htmlUrl": "string",
                "language": "string",
                "name": "string",
                "private": "boolean",
              },
            ],
          },
          "sharedTopLevelKeys": [
            "count",
            "hasMore",
            "repos",
          ],
          "tool": "list_github_repos",
          "topLevelAgentKeys": [
            "count",
            "hasMore",
            "repos",
          ],
          "topLevelMcpKeys": [
            "count",
            "hasMore",
            "repos",
          ],
        },
        {
          "agentShape": {
            "app": {
              "name": "string",
            },
            "build": "undefined",
            "complexity": "string",
            "env": {
              "auto": [],
              "detected": "undefined",
              "provided_count": "number",
              "required": [],
            },
            "internal_url": "undefined",
            "internal_url_note": "undefined",
            "missing": [],
            "plan_id": "string",
            "services": [],
            "status": "string",
            "warnings": [],
          },
          "exactTopLevelParity": false,
          "mcpShape": {
            "app": {
              "name": "string",
            },
            "complexity": "string",
            "env": {
              "auto": [],
              "provided_count": "number",
              "required": [],
            },
            "missing": [],
            "plan_id": "string",
            "services": [],
            "status": "string",
            "warnings": [],
          },
          "sharedTopLevelKeys": [
            "app",
            "complexity",
            "env",
            "missing",
            "plan_id",
            "services",
            "status",
            "warnings",
          ],
          "tool": "create_deploy_plan",
          "topLevelAgentKeys": [
            "app",
            "build",
            "complexity",
            "env",
            "internal_url",
            "internal_url_note",
            "missing",
            "plan_id",
            "services",
            "status",
            "warnings",
          ],
          "topLevelMcpKeys": [
            "app",
            "complexity",
            "env",
            "missing",
            "plan_id",
            "services",
            "status",
            "warnings",
          ],
        },
        {
          "agentShape": {
            "rootCause": "string",
            "suggestedFixes": [
              "string",
            ],
            "summary": "string",
          },
          "exactTopLevelParity": true,
          "mcpShape": {
            "rootCause": "string",
            "suggestedFixes": [
              "string",
            ],
            "summary": "string",
          },
          "sharedTopLevelKeys": [
            "rootCause",
            "suggestedFixes",
            "summary",
          ],
          "tool": "debug_build_error",
          "topLevelAgentKeys": [
            "rootCause",
            "suggestedFixes",
            "summary",
          ],
          "topLevelMcpKeys": [
            "rootCause",
            "suggestedFixes",
            "summary",
          ],
        },
      ]
    `);
  });
});
