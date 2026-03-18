import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import * as configModule from '../../src/config/index.js';
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
      getProjectByName: vi.fn().mockReturnValue(project),
      getLastDeployLog: vi.fn(),
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

  it('deploy_project uses target to set trigger source', async () => {
    const { ctx, pipeline } = createMockContext();
    const tool = getTool(ctx, 'deploy_project', 'mcp');

    await tool.execute(
      { repo_url: 'https://github.com/openlander-ai/OpenLander' },
      { target: 'mcp' },
    );

    expect(pipeline.startDeploy).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/openlander-ai/OpenLander',
      branch: undefined,
      name: undefined,
      sshKeyPath: undefined,
      trigger: 'api',
    });
  });

  it('redeploy_project resolves project id and calls redeploy', async () => {
    const { ctx, pipeline } = createMockContext();
    const tool = getTool(ctx, 'redeploy_project', 'mcp');

    const result = await tool.execute({ project_name: 'critical-app' }, { target: 'mcp' });

    expect(pipeline.redeploy).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ status: 'redeployed' });
  });

  it('get_logs applies target-specific default line counts', async () => {
    const { ctx, pipeline } = createMockContext();
    const tool = getTool(ctx, 'get_logs');

    await tool.execute({ project_name: 'critical-app' }, { target: 'agent' });
    await tool.execute({ project_name: 'critical-app' }, { target: 'mcp' });

    expect(pipeline.getLogs).toHaveBeenNthCalledWith(1, 'p1', 20);
    expect(pipeline.getLogs).toHaveBeenNthCalledWith(2, 'p1', 50);
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

  it('deploy_monorepo parses dockerfiles JSON and returns status hint', async () => {
    const { ctx, pipeline } = createMockContext();
    const tool = getTool(ctx, 'deploy_monorepo');

    const result = await tool.execute(
      {
        repo_url: 'https://github.com/example/repo',
        clone_path: '/tmp/repo',
        commit_sha: 'abc123',
        dockerfiles: '["frontend/Dockerfile","backend/Dockerfile"]',
      },
      { target: 'agent' },
    );

    expect(pipeline.startMonorepoDeploy).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/example/repo',
      clonePath: '/tmp/repo',
      commitSha: 'abc123',
      dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      branch: undefined,
    });
    expect(result).toEqual({
      parentProjectId: 'parent-1',
      parentName: 'repo',
      hint: 'Use get_deploy_status to check progress.',
    });
  });

  it('orchestrate_deploy builds service nodes and returns topology validation failure', async () => {
    const tempRepo = mkdtempSync(join(tmpdir(), 'registry-orchestrate-'));
    mkdirSync(join(tempRepo, 'web'), { recursive: true });
    writeFileSync(join(tempRepo, 'Dockerfile'), 'FROM node:22\n');
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

  it('github tools return target-aware GITHUB_NOT_CONFIGURED responses', async () => {
    const { ctx } = createMockContext();
    const listRepos = getTool(ctx, 'list_github_repos');
    const searchRepos = getTool(ctx, 'search_github_repos');

    await expect(listRepos.execute({}, { target: 'agent' })).resolves.toEqual({
      error: 'GITHUB_NOT_CONFIGURED',
      message: 'No GitHub token configured. Add one in settings to browse repos.',
    });
    await expect(listRepos.execute({}, { target: 'mcp' })).resolves.toEqual({
      error: 'GITHUB_NOT_CONFIGURED',
      message: 'No GitHub token configured.',
    });

    await expect(
      searchRepos.execute({ query: 'openlander' }, { target: 'agent' }),
    ).resolves.toEqual({
      error: 'GITHUB_NOT_CONFIGURED',
      message: 'No GitHub token configured. Add one in settings to search repos.',
    });
    await expect(searchRepos.execute({ query: 'openlander' }, { target: 'mcp' })).resolves.toEqual({
      error: 'GITHUB_NOT_CONFIGURED',
      message: 'No GitHub token configured.',
    });
  });
});
