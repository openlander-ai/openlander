import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import * as configModule from '../../src/config/index.js';
import * as gitProviders from '../../src/git-providers/index.js';
import type { GitProvider } from '../../src/git-providers/index.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import { DeployOrchestrator } from '../../src/pipeline/orchestrator.js';
import * as portModule from '../../src/pipeline/port.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

const mockCloneRepo = vi.fn();
const mockScanUsedPorts = vi.fn();
const mockLoadConfig = vi.fn();
const mockBuildTopology = vi.fn();
const mockValidateTopology = vi.fn();

function createMockContext() {
  const project = {
    id: 'p1',
    name: 'critical-app',
    status: 'running',
    image_tag: null,
  };

  const pipeline = {
    startDeploy: vi.fn().mockResolvedValue({ projectId: 'p1', projectName: 'critical-app' }),
    redeploy: vi.fn().mockResolvedValue({ status: 'redeployed' }),
    getLogs: vi.fn().mockResolvedValue('container logs'),
    startMonorepoDeploy: vi
      .fn()
      .mockReturnValue({ parentProjectId: 'parent-1', parentName: 'repo' }),
    deployMonorepo: vi.fn(),
    rollback: vi.fn(),
  };

  const composePipeline = {
    detectComposeFile: vi.fn(),
    parseComposeFile: vi.fn(),
  };

  const jobManager = {
    getStatus: vi.fn(),
    getActiveJobs: vi.fn(),
  };

  const ctx = {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn().mockReturnValue(project),
      getDeployableForProject: vi.fn((id: string) =>
        id === project.id
          ? { id: 'p1__svc', status: 'healthy', assigned_port: 10001 }
          : undefined,
      ),
      getLastDeployLog: vi.fn(),
      getDeployLogs: vi.fn().mockReturnValue([
        {
          id: 'deploy-1',
          service_id: 'p1__svc',
          status: 'failed',
          trigger: 'api',
          commit_sha: 'abc123',
          duration_ms: 1200,
          created_at: '2026-05-13T00:00:00.000Z',
          build_log: 'build failed',
        },
      ]),
      getDeployLog: vi.fn((id: string) =>
        id === 'deploy-1'
          ? {
              id: 'deploy-1',
              service_id: 'p1__svc',
              status: 'failed',
              trigger: 'api',
              commit_sha: 'abc123',
              duration_ms: 1200,
              created_at: '2026-05-13T00:00:00.000Z',
              build_log: 'line 1\nline 2',
            }
          : undefined,
      ),
      getDeployLockInfo: vi.fn().mockReturnValue(null),
    },
    composePipeline,
    jobManager,
    serviceManager: {
      list: vi.fn().mockResolvedValue([]),
    },
    docker: {},
    pipeline,
  } as unknown as AppContext;

  return { ctx, pipeline, composePipeline, jobManager };
}

function getTool(ctx: AppContext, name: string, target?: 'agent' | 'mcp') {
  const tool = createSharedToolRegistry(ctx, target ? { target } : undefined).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('registry critical tool behaviors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(gitPipeline, 'cloneRepo').mockImplementation((...args) => mockCloneRepo(...args));
    vi.spyOn(portModule, 'scanUsedPorts').mockImplementation((...args) =>
      mockScanUsedPorts(...args),
    );
    vi.spyOn(configModule, 'loadConfig').mockImplementation((...args) => mockLoadConfig(...args));
    vi.spyOn(DeployOrchestrator.prototype, 'buildTopology').mockImplementation(function (...args) {
      return mockBuildTopology(...args);
    });
    vi.spyOn(DeployOrchestrator.prototype, 'validateTopology').mockImplementation(function (
      ...args
    ) {
      return mockValidateTopology(...args);
    });
    vi.spyOn(DeployOrchestrator.prototype, 'executeOrdered').mockResolvedValue({
      success: true,
      services: [],
      totalDuration: 0,
    });
    mockLoadConfig.mockReturnValue({ gitProviders: { github: { token: '' } } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('get_logs applies target-specific default line counts', async () => {
    const { ctx, pipeline } = createMockContext();
    const tool = getTool(ctx, 'get_logs');

    await tool.execute({ project_name: 'critical-app' }, { target: 'agent' });
    await tool.execute({ project_name: 'critical-app' }, { target: 'mcp' });

    expect(pipeline.getLogs).toHaveBeenNthCalledWith(1, 'p1', 20);
    expect(pipeline.getLogs).toHaveBeenNthCalledWith(2, 'p1', 50);
  });

  it('deployment debug tools accept project_id and deploy_id targets', async () => {
    const { ctx } = createMockContext();
    const historyTool = getTool(ctx, 'get_deploy_history');
    const buildLogTool = getTool(ctx, 'get_build_log');

    const history = await historyTool.execute({ project_id: 'p1', limit: 3 }, { target: 'mcp' });
    const buildLog = await buildLogTool.execute({ deploy_id: 'deploy-1' }, { target: 'mcp' });

    expect(ctx.db.getDeployLogs).toHaveBeenCalledWith('p1', 3);
    expect(history).toMatchObject({
      project: 'critical-app',
      project_id: 'p1',
      count: 1,
    });
    expect(ctx.db.getDeployLog).toHaveBeenCalledWith('deploy-1');
    expect(buildLog).toMatchObject({
      id: 'deploy-1',
      status: 'failed',
      build_log: 'line 1\nline 2',
    });
  });

  it('get_deploy_status formats single project status for agent and mcp targets', async () => {
    const { ctx, jobManager } = createMockContext();
    const tool = getTool(ctx, 'get_deploy_status');
    const now = new Date(Date.now() - 3000);

    jobManager.getStatus
      .mockReturnValueOnce({
        projectName: 'critical-app',
        phase: 'building',
        startedAt: now,
        errorSummary: null,
      })
      .mockReturnValueOnce({
        projectName: 'critical-app',
        phase: 'done',
        startedAt: now,
        errorSummary: 'none',
      });

    const agentResult = await tool.execute({ project_name: 'critical-app' }, { target: 'agent' });
    const mcpResult = await tool.execute({ project_name: 'critical-app' }, { target: 'mcp' });

    expect(agentResult).toEqual({
      active: 1,
      jobs: [
        expect.objectContaining({
          name: 'critical-app',
          phase: 'building',
          elapsed: expect.any(String),
        }),
      ],
    });
    expect(mcpResult).toEqual({
      active: 0,
      jobs: [
        expect.objectContaining({
          name: 'critical-app',
          phase: 'done',
          elapsed: expect.any(String),
        }),
      ],
    });
  });

  it('get_deploy_status prefers a newer deploy lock over stale completed job state', async () => {
    const { ctx, jobManager } = createMockContext();
    const tool = getTool(ctx, 'get_deploy_status');
    const startedAt = new Date(Date.now() - 60_000);
    const completedAt = new Date(Date.now() - 55_000);

    jobManager.getStatus.mockReturnValue({
      projectId: 'p1',
      projectName: 'critical-app',
      phase: 'done',
      startedAt,
      completedAt,
    });
    ctx.db.getDeployLockInfo.mockResolvedValue({
      session: 'mcp-redeploy-app',
      lockedAt: new Date().toISOString(),
    });

    const result = await tool.execute(
      { project_name: 'critical-app', wait: true },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      active: 1,
      locked: true,
      lock_session: 'mcp-redeploy-app',
      jobs: [expect.objectContaining({ name: 'critical-app', phase: 'queued' })],
    });
  });

  it('get_deploy_status wait=false also prefers a newer deploy lock over stale completed job state', async () => {
    const { ctx, jobManager } = createMockContext();
    const tool = getTool(ctx, 'get_deploy_status');
    const startedAt = new Date(Date.now() - 60_000);

    jobManager.getStatus.mockReturnValue({
      projectId: 'p1',
      projectName: 'critical-app',
      phase: 'done',
      startedAt,
      completedAt: new Date(Date.now() - 55_000),
    });
    ctx.db.getDeployLockInfo.mockResolvedValue({
      session: 'mcp-redeploy-app',
      lockedAt: new Date().toISOString(),
    });

    const result = await tool.execute(
      { project_name: 'critical-app', wait: false },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      active: 1,
      locked: true,
      lock_session: 'mcp-redeploy-app',
      jobs: [expect.objectContaining({ name: 'critical-app', phase: 'queued' })],
    });
  });

  it('get_deploy_status resolves completed deploy logs by deploy_id', async () => {
    const { ctx } = createMockContext();
    const tool = getTool(ctx, 'get_deploy_status');

    const result = await tool.execute({ deploy_id: 'deploy-1' }, { target: 'mcp' });

    expect(ctx.db.getDeployLog).toHaveBeenCalledWith('deploy-1');
    expect(result).toMatchObject({
      active: 0,
      status: 'found',
      jobs: [
        {
          deploy_id: 'deploy-1',
          service_id: 'p1__svc',
          project_id: 'p1',
          name: 'critical-app',
          phase: 'failed',
          health: 'healthy',
          build_log_tail: 'line 1\nline 2',
        },
      ],
    });
  });

  it('get_deploy_status distinguishes unknown deploy ids from completed jobs', async () => {
    const { ctx } = createMockContext();
    const tool = getTool(ctx, 'get_deploy_status');

    const result = await tool.execute({ job_id: 'missing-deploy' }, { target: 'mcp' });

    expect(ctx.db.getDeployLog).toHaveBeenCalledWith('missing-deploy');
    expect(result).toMatchObject({
      active: 0,
      jobs: [],
      status: 'not_found',
      code: 'DEPLOY_STATUS_NOT_FOUND',
      deploy_id: 'missing-deploy',
    });
  });

  it('orchestrate_deploy builds service nodes and returns topology validation failure', async () => {
    const tempRepo = mkdtempSync(join(tmpdir(), 'registry-orchestrate-'));
    mkdirSync(join(tempRepo, 'web'), { recursive: true });
    mkdirSync(join(tempRepo, 'apps', 'api'), { recursive: true });
    writeFileSync(join(tempRepo, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(tempRepo, 'Dockerfile.api'), 'FROM node:22\n');
    writeFileSync(join(tempRepo, 'Dockerfile.web'), 'FROM node:22\n');
    writeFileSync(join(tempRepo, 'apps', 'api', 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(tempRepo, 'web', 'Dockerfile'), 'FROM node:22\n');

    try {
      const { ctx, composePipeline } = createMockContext();
      const tool = getTool(ctx, 'orchestrate_deploy');

      mockCloneRepo.mockResolvedValueOnce({ path: tempRepo, commitSha: 'sha123' });
      composePipeline.detectComposeFile.mockReturnValueOnce('/tmp/compose.yml');
      composePipeline.parseComposeFile.mockReturnValueOnce({
        services: [
          {
            name: 'web',
            build: { context: 'web' },
            dependsOn: ['app'],
            ports: ['8080:3000/tcp'],
            environment: ['NODE_ENV=production'],
          },
        ],
      });
      mockScanUsedPorts.mockResolvedValueOnce({ all: [80, 443] });
      mockBuildTopology.mockReturnValueOnce({});
      mockValidateTopology.mockReturnValueOnce({ valid: false, errors: ['Port already in use'] });

      const result = await tool.execute(
        { repo_url: 'https://github.com/example/repo', branch: 'main' },
        { target: 'agent' },
      );

      expect(mockBuildTopology).toHaveBeenCalled();
      expect(mockBuildTopology.mock.calls[0]?.[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'app', dockerfile: 'Dockerfile' }),
          expect.objectContaining({ dockerfile: 'Dockerfile.api' }),
          expect.objectContaining({ dockerfile: 'Dockerfile.web' }),
          expect.objectContaining({ dockerfile: 'apps/api/Dockerfile' }),
          expect.objectContaining({
            name: 'web',
            dockerfile: 'web/Dockerfile',
            dependsOn: [],
            port: 8080,
            envVars: { NODE_ENV: 'production' },
          }),
        ]),
      );
      expect(result).toEqual({
        success: false,
        services: expect.arrayContaining([
          expect.objectContaining({ name: 'app', status: 'failed', error: 'Port already in use' }),
          expect.objectContaining({ name: 'web', status: 'failed', error: 'Port already in use' }),
        ]),
        totalDuration: 0,
        error: 'TOPOLOGY_VALIDATION_FAILED',
        validationErrors: ['Port already in use'],
      });
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });

  it('github tools throw target-aware GITHUB_NOT_CONFIGURED errors', async () => {
    const { ctx } = createMockContext();
    const listRepos = getTool(ctx, 'list_github_repos');
    const searchRepos = getTool(ctx, 'search_github_repos');

    await expect(listRepos.execute({}, { target: 'agent' })).rejects.toThrow(
      'GITHUB_NOT_CONFIGURED: No GitHub token configured. Add one in settings to browse repos.',
    );
    await expect(listRepos.execute({}, { target: 'mcp' })).rejects.toThrow(
      'GITHUB_NOT_CONFIGURED: No GitHub token configured.',
    );

    await expect(searchRepos.execute({ query: 'openlander' }, { target: 'agent' })).rejects.toThrow(
      'GITHUB_NOT_CONFIGURED: No GitHub token configured. Add one in settings to search repos.',
    );
    await expect(searchRepos.execute({ query: 'openlander' }, { target: 'mcp' })).rejects.toThrow(
      'GITHUB_NOT_CONFIGURED: No GitHub token configured.',
    );
  });

  it('github repo discovery never returns credentialed clone URLs', async () => {
    const { ctx } = createMockContext();
    const listRepos = getTool(ctx, 'list_github_repos');
    const searchRepos = getTool(ctx, 'search_github_repos');
    const token = 'gho_supersecretfixture';
    const repo = {
      name: 'private-app',
      fullName: 'acme/private-app',
      description: 'private',
      language: 'TypeScript',
      isPrivate: true,
      defaultBranch: 'main',
      stars: 0,
      cloneUrl: 'https://github.com/acme/private-app.git',
      htmlUrl: 'https://github.com/acme/private-app',
      updatedAt: '2026-05-13T00:00:00.000Z',
    };

    mockLoadConfig.mockReturnValue({ gitProviders: { github: { token, username: 'acme' } } });
    const provider: GitProvider = {
      type: 'github',
      displayName: 'GitHub',
      validateToken: vi.fn(),
      listRepos: vi.fn().mockResolvedValue({ repos: [repo], hasMore: false }),
      searchRepos: vi.fn().mockResolvedValue({ repos: [repo], total: 1 }),
      getRepo: vi.fn(),
      hasDockerfile: vi.fn(),
      getAuthCloneUrl: vi.fn(),
    };
    vi.spyOn(gitProviders, 'createGitProvider').mockReturnValue(provider);

    const listResult = await listRepos.execute({}, { target: 'mcp' });
    const searchResult = await searchRepos.execute({ query: 'private' }, { target: 'mcp' });
    const payload = JSON.stringify({ listResult, searchResult });

    expect(payload).toContain('https://github.com/acme/private-app.git');
    expect(payload).not.toContain(token);
    expect(payload).not.toContain('x-access-token');
    expect(payload).not.toContain('gho_');
  });
});
