import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { getProjectUrl } from '../src/pipeline/traefik.js';
import type { AppContext } from '../src/app.js';
import { OpenLanderError, ProjectNotFoundError } from '../src/errors.js';
import * as gitPipeline from '../src/pipeline/git.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

const mockCloneRepo = vi.fn();

const EXPECTED_TOOL_NAMES = [
  'create_deploy_plan',
  'update_deploy_plan',
  'execute_deploy_plan',
  'stop_project',
  'get_logs',
  'list_projects',
  'list_env_vars',
  'set_env_vars',
  'expose_public',
  'unexpose_public',
  'get_system_stats',
  'rollback_project',
  'deploy_blue_green',
  'debug_build_error',
  'preview_deploy',
  'cleanup_preview',
  'list_previews',
  'restart_project',
  'map_domain',
  'list_domains',
  'get_deploy_status',
  'get_deploy_history',
  'scan_dockerfiles',

  'orchestrate_deploy',
  'list_github_repos',
  'search_github_repos',
  // v0.0.9-5: Server awareness tools
  // v0.0.10: Global secrets tools
  'set_global_secret',
  'list_global_secrets',
  'create_service',
  'list_services',
  'get_service_status',
  'start_service',
  'stop_service',
  'remove_service',
  'get_service_credentials',
  'create_service_user',
  'analyze_infrastructure',
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
    getEnvironmentsByProject: vi.fn().mockReturnValue([{ id: 'env-prod', type: 'production' }]),
    getDeployableForProject: vi.fn().mockReturnValue(undefined),
    assertEnvToolSchemaReady: vi.fn().mockResolvedValue(undefined),
    insertActivityLog: vi.fn().mockResolvedValue(undefined),
  };

  const pipeline = {
    stop: vi.fn().mockResolvedValue(undefined),
    startDeploy: vi.fn().mockResolvedValue({
      projectId: 'proj-1',
      projectName: 'demo-app',
      status: 'building',
    }),
    redeploy: vi.fn().mockResolvedValue({ status: 'redeployed' }),
  };

  const env = {
    setBulk: vi.fn().mockReturnValue(false),
    setBulkDetailed: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockReturnValue({}),
    getAllWithInheritance: vi.fn().mockReturnValue({}),
    getAllMasked: vi.fn().mockReturnValue({}),
    getAllWithInheritanceMasked: vi.fn().mockReturnValue({}),
    verifyRoundTrip: vi.fn().mockReturnValue([]),
  };

  const planEngine = {
    createPlan: vi.fn().mockResolvedValue({
      plan_id: 'plan-1',
      status: 'ready',
      complexity: 'simple',
      app: { name: 'test-app' },
      build: { method: 'dockerfile', dockerfile: 'Dockerfile', context: '.' },
      services: [],
      env: { required: [], auto: {}, provided: {}, detected: [] },
      missing: [],
      warnings: [],
    }),
  };

  const ctx = {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    db,
    env,
    pipeline,
    planEngine,
    buildDebugger: null,
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;

  return { ctx, db, env, pipeline, planEngine };
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { names: EXPECTED_TOOL_NAMES }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('Tool Registry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(gitPipeline, 'cloneRepo').mockImplementation((...args) => mockCloneRepo(...args));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns all expected tool names', () => {
    const { ctx } = createMockContext();

    const tools = createSharedToolRegistry(ctx, { names: EXPECTED_TOOL_NAMES });
    const names = tools.map((tool) => tool.name);

    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
    expect(new Set(names)).toEqual(new Set(EXPECTED_TOOL_NAMES));
  });

  it('defines required shape for each tool', () => {
    const { ctx } = createMockContext();
    const tools = createSharedToolRegistry(ctx, { names: EXPECTED_TOOL_NAMES });

    for (const tool of tools) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema.safeParse).toBe('function');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('create_deploy_plan schema validates required repo_url input', () => {
    const { ctx } = createMockContext();
    const createPlan = getTool(ctx, 'create_deploy_plan');

    const valid = createPlan.inputSchema.safeParse({
      repo_url: 'https://github.com/openlander-ai/OpenLander',
      branch: 'main',
      name: 'openlander',
    });

    expect(valid.success).toBe(true);
  });

  it('create_deploy_plan schema rejects missing required fields', () => {
    const { ctx } = createMockContext();
    const createPlan = getTool(ctx, 'create_deploy_plan');

    const invalid = createPlan.inputSchema.safeParse({
      branch: 'main',
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.some((issue) => JSON.stringify(issue).includes('repo_url'))).toBe(
        true,
      );
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
          containerName: null,
          url: getProjectUrl('my-app'),
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

  it('create_deploy_plan executes with target-aware trigger and hint', async () => {
    const { ctx } = createMockContext();
    const createPlan = getTool(ctx, 'create_deploy_plan');

    const result = await createPlan.execute(
      {
        repo_url: 'https://github.com/openlander-ai/OpenLander',
        branch: 'main',
        name: 'openlander',
      },
      { target: 'agent' },
    );

    expect(result).toHaveProperty('plan_id');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('complexity');
  });

  it('set_env_vars defers redeploy by default and applies when explicitly requested', async () => {
    const project = {
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
    } as const;
    const { ctx, db, env, pipeline } = createMockContext({
      projects: [project],
      getProjectByName: () => project,
    });
    const setEnvVars = getTool(ctx, 'set_env_vars');

    db.getDeployableForProject.mockReturnValue({ status: 'running' });
    env.setBulkDetailed.mockResolvedValueOnce([{ key: 'API_URL', op: 'insert' }]);
    const changed = await setEnvVars.execute(
      { project_name: 'my-app', variables: '{"API_URL":"https://api.local"}' },
      { target: 'agent' },
    );
    expect(db.getProjectByName).toHaveBeenCalledWith('my-app');
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(changed).toEqual({
      status: 'updated',
      project: 'my-app',
      keys: ['API_URL'],
      changed: [{ key: 'API_URL', op: 'insert' }],
      needs_redeploy: true,
      _agent_guidance: {
        next_steps: ['Redeploy required: call redeploy_project/deploy_service to apply env changes.'],
      },
    });

    env.setBulkDetailed.mockResolvedValueOnce([{ key: 'API_URL', op: 'update' }]);
    const applied = await setEnvVars.execute(
      {
        project_name: 'my-app',
        variables: '{"API_URL":"https://api.local"}',
        defer_redeploy: false,
      },
      { target: 'agent' },
    );
    expect(pipeline.redeploy).toHaveBeenCalledWith('p1');
    expect(applied).toEqual({
      status: 'updated_and_redeployed',
      project: 'my-app',
      keys: ['API_URL'],
      changed: [{ key: 'API_URL', op: 'update' }],
      needs_redeploy: false,
    });
  });

  it('list_env_vars returns masked variables for a project', async () => {
    const project = {
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
    } as const;
    const { ctx, env } = createMockContext({
      getProjectByName: () => project,
    });
    const listEnvVars = getTool(ctx, 'list_env_vars');

    env.getAllMasked.mockReturnValueOnce({
      DATABASE_URL: 'pos****5432',
      API_KEY: 'sk-****cdef',
    });
    const result = await listEnvVars.execute({ project_name: 'my-app' }, { target: 'mcp' });
    expect(env.getAllMasked).toHaveBeenCalledWith('p1');
    expect(result).toEqual({
      variables: {
        DATABASE_URL: 'pos****5432',
        API_KEY: 'sk-****cdef',
      },
      count: 2,
      revealed: false,
    });
  });

  it('set_env_vars throws on malformed JSON and does not redeploy', async () => {
    const project = {
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
    } as const;
    const { ctx, pipeline } = createMockContext({
      getProjectByName: () => project,
    });
    const setEnvVars = getTool(ctx, 'set_env_vars');

    await expect(
      setEnvVars.execute({ project_name: 'my-app', variables: '{bad json' }, { target: 'agent' }),
    ).rejects.toBeInstanceOf(OpenLanderError);
    expect(pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('debug_build_error returns target-aware message when debugger is missing', async () => {
    const { ctx } = createMockContext();
    const debugBuildError = getTool(ctx, 'debug_build_error');

    await expect(
      debugBuildError.execute({ project_name: 'my-app' }, { target: 'agent' }),
    ).rejects.toThrow('Build debugger requires an LLM provider. Configure one first.');

    await expect(
      debugBuildError.execute({ project_name: 'my-app' }, { target: 'mcp' }),
    ).rejects.toThrow('Build debugger requires an LLM provider.');
  });

  it('debug_build_error returns NO_FAILED_BUILD when last deploy did not fail', async () => {
    const project = { id: 'p1', name: 'my-app', status: 'running' } as const;
    const { ctx } = createMockContext({
      getProjectByName: () => project,
    });
    const diagnose = vi.fn();

    (ctx as { buildDebugger: unknown }).buildDebugger = { diagnose };
    (
      ctx as AppContext & {
        db: { getLastDeployLog: (projectId: string) => { status: string } | null };
      }
    ).db.getLastDeployLog = vi.fn().mockReturnValueOnce({ status: 'done' });

    const debugBuildError = getTool(ctx, 'debug_build_error');

    await expect(
      debugBuildError.execute({ project_name: 'my-app' }, { target: 'agent' }),
    ).rejects.toThrow('No failed build found for this project.');
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('debug_build_error forwards build log to debugger and uses fallback image tag', async () => {
    const project = { id: 'p1', name: 'my-app', status: 'running', image_tag: null } as const;
    const { ctx } = createMockContext({
      getProjectByName: () => project,
    });
    const diagnose = vi.fn().mockResolvedValue({ summary: 'Fixed' });

    (ctx as { buildDebugger: unknown }).buildDebugger = { diagnose };
    (
      ctx as AppContext & {
        db: {
          getLastDeployLog: (
            projectId: string,
          ) => { status: string; build_log: string | null } | null;
        };
      }
    ).db.getLastDeployLog = vi.fn().mockReturnValueOnce({ status: 'failed', build_log: null });

    const debugBuildError = getTool(ctx, 'debug_build_error');
    const result = await debugBuildError.execute({ project_name: 'my-app' }, { target: 'agent' });

    expect(diagnose).toHaveBeenCalledWith({
      buildLog: 'No build log available',
      projectName: 'my-app',
      imageTag: 'openlander/my-app:latest',
      failedStep: 'build',
    });
    expect(result).toEqual({ summary: 'Fixed' });
  });

  it('scan_dockerfiles ignores hidden/vendor/node_modules and reports monorepo metadata', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'registry-scan-'));
    mkdirSync(join(tmpRoot, '.git'), { recursive: true });
    mkdirSync(join(tmpRoot, 'apps', 'api'), { recursive: true });
    mkdirSync(join(tmpRoot, 'node_modules', 'left-pad'), { recursive: true });
    mkdirSync(join(tmpRoot, 'vendor', 'bin'), { recursive: true });
    writeFileSync(join(tmpRoot, 'Dockerfile'), 'FROM alpine\n');
    writeFileSync(join(tmpRoot, 'Dockerfile.api'), 'FROM node:22\n');
    writeFileSync(join(tmpRoot, 'Dockerfile.web'), 'FROM node:22\n');
    writeFileSync(join(tmpRoot, 'apps', 'api', 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(tmpRoot, '.git', 'Dockerfile'), 'FROM busybox\n');
    writeFileSync(join(tmpRoot, 'node_modules', 'left-pad', 'Dockerfile'), 'FROM busybox\n');
    writeFileSync(join(tmpRoot, 'vendor', 'bin', 'Dockerfile'), 'FROM busybox\n');

    mockCloneRepo.mockResolvedValueOnce({ path: tmpRoot, commitSha: 'abc123' });
    const { ctx } = createMockContext();
    const scanDockerfiles = getTool(ctx, 'scan_dockerfiles');

    const result = await scanDockerfiles.execute(
      { repo_url: 'https://github.com/user/repo', branch: 'main' },
      { target: 'agent' },
    );

    expect(mockCloneRepo).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/user/repo',
      branch: 'main',
      sshKeyPath: undefined,
    });
    expect(result).toEqual({
      repoUrl: 'https://github.com/user/repo',
      clonePath: tmpRoot,
      commitSha: 'abc123',
      dockerfiles: ['apps/api/Dockerfile', 'Dockerfile', 'Dockerfile.api', 'Dockerfile.web'],
      isMonorepo: true,
    });

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('applies tool target filtering for mcp-only tools', () => {
    const { ctx } = createMockContext();

    const defaultTools = createSharedToolRegistry(ctx, { names: EXPECTED_TOOL_NAMES });
    const mcpTools = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: EXPECTED_TOOL_NAMES,
    });
    const agentTools = createSharedToolRegistry(ctx, {
      target: 'agent',
      names: EXPECTED_TOOL_NAMES,
    });

    // start_service is mcp-only
    expect(defaultTools.some((tool) => tool.name === 'start_service')).toBe(true);
    expect(mcpTools.some((tool) => tool.name === 'start_service')).toBe(true);
    expect(agentTools.some((tool) => tool.name === 'start_service')).toBe(false);

    // All expected tools should be available in default registry
    expect(defaultTools.length).toBe(EXPECTED_TOOL_NAMES.length);
  });
});
