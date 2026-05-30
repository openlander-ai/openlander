import { describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import { generateSmartDefaults } from '../../src/pipeline/smart-defaults.js';

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
    status: 'error',
    assigned_port: 1111,
    container_id: null,
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
    assigned_port: 2222,
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

function makeDb(project: ProjectRow, service: ServiceRow): Database {
  return {
    getProjectByName: vi.fn(async () => project),
    getDeployableForProject: vi.fn(async () => service),
    getEnvVars: vi.fn(async () => ({})),
    getDeployLogs: vi.fn(async () => []),
  } as unknown as Database;
}

describe('generateSmartDefaults ServiceView reads', () => {
  it('uses canonical service runtime fields over stale project columns', async () => {
    const result = await generateSmartDefaults(makeDb(makeProject(), makeService()), {
      repoUrl: 'https://github.com/example/demo.git',
      name: 'demo',
    });

    expect(result.hasSuggestions).toBe(true);
    expect(result.suggestions).toContainEqual(
      expect.objectContaining({
        category: 'port',
        data: { port: 2222 },
      }),
    );
    expect(result.suggestions).toContainEqual(
      expect.objectContaining({
        category: 'clone',
        data: { reuseProject: true, projectId: 'project-1' },
      }),
    );
  });
});
