import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Database, EnvironmentRow, ProjectRow } from '../../src/db/index.js';
import type { DeployLogRow, ServiceRow } from '../../src/db/types.js';
import { eventBus } from '../../src/events/index.js';
import { DockerBuildCancelledError } from '../../src/errors.js';
import type { ProjectStatus, StateTransitionOptions } from '../../src/monitor/project-state-manager.js';
import type { Docker } from '../../src/pipeline/docker.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import type { EnvManager } from '../../src/pipeline/env.js';

const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-cancel',
    name: 'cancel-app',
    display_name: 'Cancel App',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'project-cancel__svc',
    project_id: 'project-cancel',
    name: 'project-cancel__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    container_name: null,
    container_port: 3000,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/openlander/cancel-app',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeEnvironmentRow(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-production',
    service_id: 'project-cancel__svc',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: null,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    container_port: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    project_id: 'project-cancel',
    ...overrides,
  };
}

function makeDocker(): Docker {
  return {
    buildImage: vi.fn(async () => {
      throw new DockerBuildCancelledError('project-cancel');
    }),
    tagImage: vi.fn(async () => undefined),
    listManagedContainers: vi.fn(async () => []),
    listAllContainers: vi.fn(async () => []),
    getLogs: vi.fn(async () => ''),
    safeRemoveContainer: vi.fn(async () => undefined),
  } as unknown as Docker;
}

function makeEnv(): EnvManager {
  return {
    getGlobalSecrets: vi.fn(async () => ({})),
    getAll: vi.fn(async () => ({})),
    getAllWithInheritance: vi.fn(async () => ({})),
    getAllForService: vi.fn(async () => ({})),
    getSecretFilesForDeploy: vi.fn(async () => []),
  } as unknown as EnvManager;
}

describe('DeployPipeline build cancellation', () => {
  let tmpDir: string;
  let clonePath: string;
  let project: ProjectRow;
  let service: ServiceRow;
  let environment: EnvironmentRow;
  let deployLogs: Array<Partial<DeployLogRow> & { buildLog?: string; projectId?: string }> = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-cancel-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:22\nEXPOSE 3000\n', 'utf8');
    project = makeProjectRow();
    service = makeServiceRow();
    environment = makeEnvironmentRow();
    deployLogs = [];

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
      branch: 'main',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists user-cancelled Docker builds as cancelled deploy logs', async () => {
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async () => project),
      listProjects: vi.fn(async () => [project]),
      listServices: vi.fn(async () => [service]),
      getDeployableForProject: vi.fn(async () => service),
      isCircuitBreakerOpen: vi.fn(async () => false),
      getEnvironment: vi.fn(async (id: string) => (id === environment.id ? environment : undefined)),
      getEnvironmentsByProject: vi.fn(async () => [environment]),
      updateEnvironment: vi.fn(async (_id: string, updates: Partial<EnvironmentRow>) => {
        environment = { ...environment, ...updates };
        return environment;
      }),
      updateProject: vi.fn(async (_id: string, updates: Partial<ProjectRow>) => {
        project = { ...project, ...updates };
        return project;
      }),
      getLastDeployLog: vi.fn(async () => undefined),
      consumePendingFix: vi.fn(async () => null),
      createDeployLog: vi.fn(async (log: Partial<DeployLogRow> & { buildLog?: string }) => {
        deployLogs.push(log);
      }),
    } as unknown as Database;
    const stateTransitions: Array<{ projectId: string; status: ProjectStatus; reason: string }> =
      [];
    const stateManager = {
      transition: vi.fn(
        async (
          projectId: string,
          status: ProjectStatus,
          reason: string,
          _options?: StateTransitionOptions,
        ) => {
          stateTransitions.push({ projectId, status, reason });
          return true;
        },
      ),
    };
    const failures: Array<{ projectId: string; step: string; cancelled?: boolean }> = [];
    const unsub = eventBus.on('deploy:failed', (payload) => {
      failures.push({
        projectId: payload.projectId,
        step: payload.step,
        cancelled: payload.cancelled,
      });
    });

    try {
      const pipeline = new DeployPipeline(makeDocker(), db, makeEnv(), testConfig, stateManager);
      const result = await pipeline.deployEnvironment(project.id, environment.id, {
        repoUrl: 'https://github.com/openlander/cancel-app',
      });

      expect(result).toMatchObject({
        success: false,
        cancelled: true,
        error: 'Build cancelled by user',
      });
      expect(deployLogs).toHaveLength(1);
      expect(deployLogs[0]).toMatchObject({
        status: 'cancelled',
        projectId: project.id,
        environmentId: environment.id,
      });
      expect(deployLogs[0]?.buildLog).toContain('[cancelled] Build cancelled by user');
      expect(environment.status).toBe('stopped');
      expect(stateTransitions).toContainEqual({
        projectId: project.id,
        status: 'stopped',
        reason: 'deploy-cancelled',
      });
      expect(failures).toContainEqual({
        projectId: project.id,
        step: 'cancelled',
        cancelled: true,
      });
    } finally {
      unsub();
    }
  });
});
