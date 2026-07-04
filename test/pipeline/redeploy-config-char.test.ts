import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import type { ProjectConfig } from '../../src/pipeline/deploy-core.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { clearPortScanCache } from '../../src/pipeline/port.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import * as dockerfileGen from '../../src/pipeline/dockerfile-gen.js';
import { ServiceSelectionRequiredError } from '../../src/errors.js';
import { createMockDocker } from '../helpers/docker-mocks.js';

const NOW = '2026-01-01T00:00:00.000Z';

interface CreateProjectInput {
  id: string;
  name: string;
  repoUrl?: string;
  branch?: string;
  dockerfilePath?: string;
  dockerTarget?: string;
  buildContext?: string;
}

interface CreateGroupInput {
  id: string;
  name: string;
}

interface ProjectUpdateInput {
  visibility?: ServiceRow['visibility'];
  buildMethod?: ServiceRow['build_method'];
  assignedPort?: number;
  previousImageTag?: string | null;
  status?: ProjectRow['status'];
  containerId?: string | null;
  imageTag?: string | null;
}

function makeProjectRow(input: CreateGroupInput): ProjectRow {
  return {
    id: input.id,
    name: input.name,
    display_name: input.name,
    description: null,
    tags: null,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
  };
}

function makeServiceRow(project: ProjectRow, input: CreateProjectInput): ServiceRow {
  return {
    id: `${project.id}__svc`,
    project_id: project.id,
    name: `${project.name}__svc`,
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: 'container-1',
    container_name: `ol-${project.name}`,
    container_port: 3000,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: input.dockerfilePath ?? null,
    docker_target: input.dockerTarget ?? null,
    build_context: input.buildContext ?? null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: input.repoUrl ?? null,
    branch: input.branch ?? 'main',
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
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    server_id: 'local',
  };
}

function makeEnvironmentRow(serviceId: string, branch: string | null): EnvironmentRow {
  return {
    id: `${serviceId.replace(/__svc$/, '')}-production`,
    service_id: serviceId,
    type: 'production',
    branch,
    status: 'running',
    assigned_port: null,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    container_port: 3000,
    created_at: NOW,
    updated_at: NOW,
  };
}

class FakeRedeployDb {
  readonly projects = new Map<string, ProjectRow>();
  readonly services = new Map<string, ServiceRow>();
  readonly environments = new Map<string, EnvironmentRow>();

  async createProject(input: CreateProjectInput): Promise<ProjectRow> {
    const project = makeProjectRow(input);
    const service = makeServiceRow(project, input);
    this.projects.set(project.id, project);
    this.services.set(service.id, service);
    this.environments.set(
      `${project.id}-production`,
      makeEnvironmentRow(service.id, service.branch),
    );
    return project;
  }

  async createProjectGroup(input: CreateGroupInput): Promise<ProjectRow> {
    const project = makeProjectRow(input);
    this.projects.set(project.id, project);
    return project;
  }

  async updateProject(projectId: string, updates: ProjectUpdateInput): Promise<void> {
    const project = this.projects.get(projectId);
    if (project) {
      this.projects.set(projectId, {
        ...project,
        status: updates.status ?? project.status,
        container_id: updates.containerId ?? project.container_id,
        image_tag: updates.imageTag ?? project.image_tag,
        previous_image_tag: updates.previousImageTag ?? project.previous_image_tag,
        assigned_port: updates.assignedPort ?? project.assigned_port,
        visibility: updates.visibility ?? project.visibility,
        build_method: updates.buildMethod ?? project.build_method,
        updated_at: NOW,
      });
    }

    const service = this.services.get(`${projectId}__svc`);
    if (service) {
      this.services.set(service.id, {
        ...service,
        status: updates.status ?? service.status,
        container_id: updates.containerId ?? service.container_id,
        image_tag: updates.imageTag ?? service.image_tag,
        previous_image_tag: updates.previousImageTag ?? service.previous_image_tag,
        assigned_port: updates.assignedPort ?? service.assigned_port,
        visibility: updates.visibility ?? service.visibility,
        build_method: updates.buildMethod ?? service.build_method,
        updated_at: NOW,
      });
    }
  }

  async getProject(projectId: string): Promise<ProjectRow | undefined> {
    return this.projects.get(projectId);
  }

  async getService(serviceId: string): Promise<ServiceRow | undefined> {
    return this.services.get(serviceId);
  }

  async getDeployableForProject(projectId: string): Promise<ServiceRow | undefined> {
    return (
      this.services.get(`${projectId}__svc`) ??
      [...this.services.values()].find((service) => service.project_id === projectId)
    );
  }

  async getDeployablesByGroup(projectId: string): Promise<ServiceRow[]> {
    return [...this.services.values()].filter((service) => service.project_id === projectId);
  }

  async getChildProjects(): Promise<ProjectRow[]> {
    return [];
  }

  async getServices(filter?: { ids?: string[] }): Promise<ServiceRow[]> {
    const services = [...this.services.values()];
    if (!filter?.ids) {
      return services;
    }
    return services.filter((service) => filter.ids?.includes(service.id));
  }

  async attachServiceToProject(serviceId: string, targetProjectId: string): Promise<void> {
    const service = this.services.get(serviceId);
    if (!service) return;
    this.services.set(serviceId, { ...service, project_id: targetProjectId, updated_at: NOW });
  }

  async isCircuitBreakerOpen(): Promise<boolean> {
    return false;
  }

  async acquireDeployLock(): Promise<boolean> {
    return true;
  }

  async releaseDeployLock(): Promise<void> {
    return undefined;
  }

  async getDeployLockInfo(): Promise<null> {
    return null;
  }

  async getEnvironmentsByProject(projectId: string): Promise<EnvironmentRow[]> {
    return [...this.environments.values()].filter(
      (environment) => environment.service_id === `${projectId}__svc`,
    );
  }

  async createEnvironment(input: {
    id: string;
    projectId: string;
    type: EnvironmentRow['type'];
    branch: string | null;
  }): Promise<EnvironmentRow> {
    const environment = makeEnvironmentRow(`${input.projectId}__svc`, input.branch);
    const created = { ...environment, id: input.id, type: input.type };
    this.environments.set(input.id, created);
    return created;
  }

  async updateEnvironment(): Promise<void> {
    return undefined;
  }

  async loadDeployConfigForService(): Promise<null> {
    return null;
  }

  async loadDeployConfig(): Promise<null> {
    return null;
  }
}

describe('redeploy() config reconstruction characterization', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: FakeRedeployDb;
  let docker: Docker;
  let pipeline: DeployPipeline;
  let deploySpy: ReturnType<typeof vi.spyOn>;
  let cloneRepoSpy: ReturnType<typeof vi.spyOn>;
  let ensureDockerfileSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-redeploy-char-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new FakeRedeployDb();
    docker = createMockDocker();
    docker.cleanupSecretFiles = vi.fn();
    const env = {
      getAll: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    pipeline = new DeployPipeline(docker, db as unknown as Database, env as never, testConfig);

    cloneRepoSpy = vi.spyOn(gitPipeline, 'cloneRepo');
    cloneRepoSpy.mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
    });

    ensureDockerfileSpy = vi.spyOn(dockerfileGen, 'ensureDockerfile');
    ensureDockerfileSpy.mockReturnValue({
      generated: false,
      detection: null,
    });

    // Spy on deploy() to capture the config passed to it
    deploySpy = vi.spyOn(pipeline, 'deploy');
    deploySpy.mockResolvedValue({
      success: true,
      projectId: 'p1',
      projectName: 'test-project',
      commitSha: 'deadbeefcafebabe',
      imageTag: 'test-project:deadbeef',
      assignedPort: 3000,
      publicUrl: 'http://localhost:3000',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('scenario 1: Dockerfile project redeploy preserves and reconstructs config fields', async () => {
    // Create a Dockerfile project with all relevant fields
    db.createProject({
      id: 'p1',
      name: 'backend-service',
      repoUrl: 'https://github.com/example/backend',
      branch: 'main',
      dockerfilePath: 'backend/Dockerfile',
      dockerTarget: 'production',
      buildContext: 'backend',
    });
    db.updateProject('p1', {
      visibility: 'internal',
      buildMethod: 'dockerfile',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p1');

    // Verify redeploy succeeded
    expect(result.success).toBe(true);
    expect(result.projectId).toBe('p1');

    // Capture the config passed to deploy()
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Fields that SHOULD be present (preserved from DB)
    expect(capturedConfig.repoUrl).toBe('https://github.com/example/backend');
    expect(capturedConfig.branch).toBe('main');
    expect(capturedConfig.name).toBe('backend-service');
    expect(capturedConfig.visibility).toBe('internal');
    expect(capturedConfig.dockerTarget).toBe('production');
    expect(capturedConfig.dockerfilePath).toBe('backend/Dockerfile');
    expect(capturedConfig.buildContext).toBe('backend');
    expect(capturedConfig.preferDockerfile).toBe(true);

    // Assert: Fields that are NOT reconstructed (gaps in redeploy)
    expect(capturedConfig.sshKeyPath).toBeUndefined();
    expect(capturedConfig.envVars).toBeUndefined();
    expect(capturedConfig.composeServices).toBeUndefined();
    expect(capturedConfig.trigger).toBeUndefined();
    expect(capturedConfig._networkProjectName).toBeUndefined();
  });

  it('scenario 2: Compose project redeploy skips docker-specific fields', async () => {
    // Create a compose project
    db.createProject({
      id: 'p2',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'develop',
      dockerfilePath: '/absolute/path/docker-compose.yml',
      dockerTarget: 'staging',
      buildContext: '/absolute/context',
    });
    db.updateProject('p2', {
      visibility: 'shared',
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p2');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Basic fields are preserved
    expect(capturedConfig.repoUrl).toBe('https://github.com/example/compose-app');
    expect(capturedConfig.branch).toBe('develop');
    expect(capturedConfig.name).toBe('compose-app');
    expect(capturedConfig.visibility).toBe('shared');

    // Assert: Dockerfile-specific fields are skipped for compose
    // dockerTarget is undefined because isCompose=true
    expect(capturedConfig.dockerTarget).toBeUndefined();
    // dockerfilePath is undefined because absolute path fails isValidDockerfilePath check
    expect(capturedConfig.dockerfilePath).toBeUndefined();
    // preferDockerfile is false for compose
    expect(capturedConfig.preferDockerfile).toBe(false);

    // Assert: Gaps remain
    expect(capturedConfig.composeServices).toBeUndefined();
    expect(capturedConfig.sshKeyPath).toBeUndefined();
    expect(capturedConfig.envVars).toBeUndefined();
  });

  it('scenario 3: Non-existent project redeploy returns error', async () => {
    // Call redeploy with non-existent project ID
    const result = await pipeline.redeploy('nonexistent-project-id');

    // Assert: Returns failure with appropriate error message
    expect(result.success).toBe(false);
    expect(result.projectId).toBe('nonexistent-project-id');
    expect(result.projectName).toBe('unknown');
    expect(result.error).toContain('not found');

    // Assert: deploy() was never called
    expect(deploySpy).not.toHaveBeenCalled();
  });

  it('scenario 4: Redeploy with relative dockerfile path (valid) includes it in config', async () => {
    // Create project with valid relative dockerfile path
    db.createProject({
      id: 'p3',
      name: 'monorepo-service',
      repoUrl: 'https://github.com/example/monorepo',
      branch: 'main',
      dockerfilePath: 'services/api/Dockerfile',
      buildContext: 'services/api',
    });
    db.updateProject('p3', {
      buildMethod: 'dockerfile',
    });

    const result = await pipeline.redeploy('p3');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Valid relative path is included
    expect(capturedConfig.dockerfilePath).toBe('services/api/Dockerfile');
    expect(capturedConfig.buildContext).toBe('services/api');
  });

  it('scenario 5: Redeploy with root Dockerfile (invalid) excludes it from config', async () => {
    // Create project with root Dockerfile (fails isValidDockerfilePath check)
    db.createProject({
      id: 'p4',
      name: 'simple-app',
      repoUrl: 'https://github.com/example/simple',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '',
    });
    db.updateProject('p4', {
      buildMethod: 'dockerfile',
    });

    const result = await pipeline.redeploy('p4');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Root Dockerfile is excluded (isValidDockerfilePath check fails)
    expect(capturedConfig.dockerfilePath).toBeUndefined();
  });

  it('scenario 6: Redeploy preserves port from previous deployment', async () => {
    // Create project and simulate a previous deployment with assigned port
    db.createProject({
      id: 'p5',
      name: 'port-test',
      repoUrl: 'https://github.com/example/port-test',
      branch: 'main',
    });
    db.updateProject('p5', {
      assignedPort: 5432,
    });

    const result = await pipeline.redeploy('p5');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: _preferredPort is set to the previous port
    expect(capturedConfig._preferredPort).toBe(5432);
  });

  it('redeployService uses the exact service id for an attached workload', async () => {
    await db.createProject({
      id: 'runtime-app',
      name: 'runtime-app',
      repoUrl: 'https://github.com/example/runtime-app',
      branch: 'main',
    });
    await db.createProjectGroup({
      id: 'target-group',
      name: 'target-group',
    });
    await db.attachServiceToProject('runtime-app__svc', 'target-group');

    const result = await pipeline.redeployService('runtime-app__svc');

    expect(result.success).toBe(true);
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;
    expect(capturedConfig).toMatchObject({
      _projectId: 'runtime-app',
      _serviceId: 'runtime-app__svc',
      _networkProjectName: 'target-group',
      repoUrl: 'https://github.com/example/runtime-app',
      name: 'runtime-app',
    });
  });

  it('project compatibility redeploy delegates only when one deployable is present', async () => {
    await db.createProject({
      id: 'runtime-one',
      name: 'runtime-one',
      repoUrl: 'https://github.com/example/runtime-one',
      branch: 'main',
    });
    await db.createProjectGroup({
      id: 'group-one',
      name: 'group-one',
    });
    await db.attachServiceToProject('runtime-one__svc', 'group-one');

    const result = await pipeline.redeploy('group-one');

    expect(result.success).toBe(true);
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;
    expect(capturedConfig._serviceId).toBe('runtime-one__svc');
  });

  it('project compatibility redeploy reports no workload for empty groups', async () => {
    await db.createProjectGroup({
      id: 'empty-group',
      name: 'empty-group',
    });

    const result = await pipeline.redeploy('empty-group');

    expect(result).toMatchObject({
      success: false,
      projectId: 'empty-group',
      code: 'NO_DEPLOYABLE_SERVICE',
    });
    expect(deploySpy).not.toHaveBeenCalled();
  });

  it('project compatibility redeploy rejects ambiguous groups', async () => {
    await db.createProjectGroup({
      id: 'ambiguous-group',
      name: 'ambiguous-group',
    });
    await db.createProject({
      id: 'runtime-a',
      name: 'runtime-a',
      repoUrl: 'https://github.com/example/runtime-a',
    });
    await db.createProject({
      id: 'runtime-b',
      name: 'runtime-b',
      repoUrl: 'https://github.com/example/runtime-b',
    });
    await db.attachServiceToProject('runtime-a__svc', 'ambiguous-group');
    await db.attachServiceToProject('runtime-b__svc', 'ambiguous-group');

    await expect(pipeline.redeploy('ambiguous-group')).rejects.toBeInstanceOf(
      ServiceSelectionRequiredError,
    );
    expect(deploySpy).not.toHaveBeenCalled();
  });

  it('project compatibility redeploy can deterministically fallback for non-interactive callers', async () => {
    await db.createProjectGroup({
      id: 'ambiguous-auto-group',
      name: 'ambiguous-auto-group',
    });
    await db.createProject({
      id: 'runtime-z',
      name: 'runtime-z',
      repoUrl: 'https://github.com/example/runtime-z',
    });
    await db.createProject({
      id: 'runtime-a',
      name: 'runtime-a',
      repoUrl: 'https://github.com/example/runtime-a',
    });
    await db.attachServiceToProject('runtime-z__svc', 'ambiguous-auto-group');
    await db.attachServiceToProject('runtime-a__svc', 'ambiguous-auto-group');

    const result = await pipeline.redeploy('ambiguous-auto-group', {
      allowMultiServiceProjectFallback: true,
    });

    expect(result.success).toBe(true);
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;
    expect(capturedConfig._serviceId).toBe('runtime-z__svc');
  });
});
