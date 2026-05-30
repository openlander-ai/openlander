import { describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { generatePostDeployInsights } from '../../src/pipeline/post-deploy-insight.js';

vi.mock('../../src/monitor/stats.js', () => ({
  getSystemStats: () => ({
    memory: {
      usagePercent: 1,
      usedMB: 64,
      totalMB: 8192,
    },
  }),
}));

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-1',
    name: 'demo',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    status: 'running',
    assigned_port: 3000,
    container_id: 'stale-project-container',
    project_type: 'web',
    ...overrides,
  } as ProjectRow;
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'project-1__svc',
    project_id: 'project-1',
    name: 'demo__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 4000,
    container_id: 'current-service-container',
    container_name: 'demo-current-service',
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
    project_type: 'worker',
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

function makeDb(project: ProjectRow, service: ServiceRow | null): Database {
  return {
    getProject: vi.fn(async () => project),
    getDeployableForProject: vi.fn(async () => service),
    getDeployLogs: vi.fn(async () => []),
  } as unknown as Database;
}

describe('generatePostDeployInsights ServiceView reads', () => {
  it('uses the canonical service container as current when checking stale containers', async () => {
    const db = makeDb(makeProject(), makeService());
    const docker = {
      listManagedContainers: vi.fn(async () => [
        {
          id: 'current-service-container',
          name: 'demo-current-service',
          status: 'running',
        },
        {
          id: 'stale-project-container',
          name: 'demo-project-container',
          status: 'running',
        },
      ]),
    } as unknown as Docker;

    const insights = await generatePostDeployInsights(
      {
        projectId: 'project-1',
        totalDurationMs: 1000,
        url: 'http://localhost:4000',
      },
      docker,
      db,
    );

    const staleInsight = insights.find((insight) =>
      insight.actions.some((action) => action.action === 'cleanup_stale'),
    );

    expect(staleInsight).toBeDefined();
    expect(staleInsight?.detail).toContain('demo-project-container');
    expect(staleInsight?.detail).not.toContain('demo-current-service');
  });
});
