import { describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import {
  rollbackMonorepoService,
  type MonorepoOrchestrationDeps,
} from '../../src/pipeline/deploy/monorepo-orchestrator.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-1',
    name: 'demo/api',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    status: 'running',
    assigned_port: 3000,
    container_id: 'stale-project-container',
    ...overrides,
  } as ProjectRow;
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'project-1__svc',
    project_id: 'project-1',
    name: 'demo-api__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 4000,
    container_id: 'canonical-service-container',
    container_name: null,
    container_port: 3000,
    image_tag: 'demo:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/example/demo.git',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeDeps(project: ProjectRow, service: ServiceRow): MonorepoOrchestrationDeps {
  return {
    runtime: {
      stopContainer: vi.fn(async () => undefined),
      safeRemoveContainer: vi.fn(async () => undefined),
    } as unknown as RuntimeBackend,
    db: {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => service),
      updateProject: vi.fn(async () => undefined),
      createDeployLog: vi.fn(async () => undefined),
    } as unknown as Database,
    env: {} as MonorepoOrchestrationDeps['env'],
    stateManager: {
      transition: vi.fn(async () => true),
    },
    buildExecutor: {} as MonorepoOrchestrationDeps['buildExecutor'],
    containerRunner: {} as MonorepoOrchestrationDeps['containerRunner'],
  };
}

describe('rollbackMonorepoService ServiceView reads', () => {
  it('cleans up the canonical service container instead of the stale project container', async () => {
    const deps = makeDeps(makeProject(), makeService());

    await rollbackMonorepoService(deps, {
      service: {
        name: 'api',
        projectId: 'project-1',
      },
      trigger: 'api',
      startTime: Date.now(),
    });

    expect(deps.runtime.stopContainer).toHaveBeenCalledWith('canonical-service-container');
    expect(deps.runtime.safeRemoveContainer).toHaveBeenCalledWith('canonical-service-container');
    expect(deps.runtime.stopContainer).not.toHaveBeenCalledWith('stale-project-container');
  });
});
