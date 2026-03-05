import { describe, it, expect, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { ProjectNotFoundError } from '../src/errors.js';
import { createToolRegistry } from '../src/tools/registry.js';

const EXPECTED_TOOL_NAMES = [
  'deploy_project',
  'stop_project',
  'remove_project',
  'redeploy_project',
  'get_logs',
  'list_projects',
  'set_env_vars',
  'expose_public',
  'unexpose_public',
  'get_system_stats',
  'rollback_project',
  'provision_database',
  'deploy_blue_green',
  'debug_build_error',
  'preview_deploy',
  'cleanup_preview',
  'list_previews',
  'restart_project',
  'map_domain',
  'list_domains',
  'get_deploy_status',
  'scan_dockerfiles',
  'deploy_monorepo',
  'list_github_repos',
  'search_github_repos',
  // v0.0.9-5: Server awareness tools
  // v0.0.10: Global secrets tools
  'set_global_secret',
  'list_global_secrets',
  'list_all_containers',
  'scan_ports',
  'get_container_stats',
];

function createMockContext(opts?: {
  projects?: Array<{
    id: string;
    name: string;
    status: 'running' | 'stopped' | 'building' | 'error';
    visibility: 'internal' | 'quick-share' | 'production';
    repo_url: string | null;
    branch: string;
    assigned_port: number | null;
    public_url: string | null;
    created_at: string;
    updated_at: string;
  }>;
  getProjectByName?: (name: string) => unknown;
}) {
  const db = {
    listProjects: vi.fn().mockReturnValue(opts?.projects ?? []),
    getProjectByName: vi.fn().mockImplementation((name: string) => opts?.getProjectByName?.(name)),
  };

  const pipeline = {
    stop: vi.fn().mockResolvedValue(undefined),
  };

  const ctx = {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    db,
    pipeline,
  } as unknown as AppContext;

  return { ctx, db, pipeline };
}

function getTool(ctx: AppContext, name: string) {
  const tool = createToolRegistry(ctx).find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('Tool Registry', () => {
  it('returns all expected tool names (30 tools)', () => {
    const { ctx } = createMockContext();

    const tools = createToolRegistry(ctx);
    const names = tools.map((tool) => tool.name);

    expect(names).toHaveLength(30);
    expect(new Set(names)).toEqual(new Set(EXPECTED_TOOL_NAMES));
  });

  it('defines required shape for each tool', () => {
    const { ctx } = createMockContext();
    const tools = createToolRegistry(ctx);

    for (const tool of tools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema.safeParse).toBe('function');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('deploy_project schema validates required repo_url input', () => {
    const { ctx } = createMockContext();
    const deployProject = getTool(ctx, 'deploy_project');

    const valid = deployProject.inputSchema.safeParse({
      repo_url: 'https://github.com/openlander-ai/OpenLander',
      branch: 'main',
      name: 'openlander',
    });

    expect(valid.success).toBe(true);
  });

  it('deploy_project schema rejects missing required fields', () => {
    const { ctx } = createMockContext();
    const deployProject = getTool(ctx, 'deploy_project');

    const invalid = deployProject.inputSchema.safeParse({
      branch: 'main',
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues[0]?.path).toContain('repo_url');
    }
  });

  it('list_projects returns { count, projects }', async () => {
    const { ctx, db } = createMockContext({
      projects: [
        {
          id: 'p1',
          name: 'my-app',
          status: 'running',
          visibility: 'internal',
          repo_url: 'https://github.com/user/my-app',
          branch: 'main',
          assigned_port: 10001,
          public_url: null,
          created_at: '2026-01-01 00:00:00',
          updated_at: '2026-01-01 00:00:00',
        },
      ],
    });
    const listProjects = getTool(ctx, 'list_projects');

    const result = await listProjects.execute({}, { target: 'agent' });

    expect(db.listProjects).toHaveBeenCalledOnce();
    expect(result).toEqual({
      count: 1,
      projects: [
        {
          name: 'my-app',
          status: 'running',
          visibility: 'internal',
          port: 10001,
          url: 'http://my-app.localhost',
          publicUrl: null,
          repoUrl: 'https://github.com/user/my-app',
        },
      ],
    });
  });

  it('get_system_stats returns stats object', async () => {
    const { ctx } = createMockContext();
    const getSystemStats = getTool(ctx, 'get_system_stats');

    const result = await getSystemStats.execute({}, { target: 'agent' });

    expect(result).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        cpu: expect.objectContaining({
          usagePercent: expect.any(Number),
          cores: expect.any(Number),
        }),
        memory: expect.objectContaining({
          usagePercent: expect.any(Number),
          totalMB: expect.any(Number),
        }),
        disk: expect.objectContaining({
          usagePercent: expect.any(Number),
          totalGB: expect.any(Number),
        }),
      }),
    );
  });

  it('stop_project throws ProjectNotFoundError for unknown project', async () => {
    const { ctx, pipeline } = createMockContext({
      getProjectByName: () => undefined,
    });
    const stopProject = getTool(ctx, 'stop_project');

    await expect(
      stopProject.execute({ project_name: 'missing-app' }, { target: 'agent' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(pipeline.stop).not.toHaveBeenCalled();
  });
});
