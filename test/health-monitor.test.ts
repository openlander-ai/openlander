import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMonitor } from '../src/monitor/health.js';
import type { Database, ProjectRow } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { EventBus } from '../src/events/index.js';

function createProject(partial: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: partial.id ?? 'project-1',
    name: partial.name ?? 'project-1',
    repo_url: partial.repo_url ?? 'https://example.com/repo.git',
    branch: partial.branch ?? 'main',
    status: partial.status ?? 'running',
    visibility: partial.visibility ?? 'internal',
    assigned_port: partial.assigned_port ?? 3000,
    container_id: partial.container_id ?? 'container-1',
    image_tag: partial.image_tag ?? null,
    previous_image_tag: partial.previous_image_tag ?? null,
    public_url: partial.public_url ?? null,
    parent_project_id: partial.parent_project_id ?? null,
    dockerfile_path: partial.dockerfile_path ?? 'Dockerfile',
    docker_target: partial.docker_target ?? null,
    build_context: partial.build_context ?? null,
    build_method: partial.build_method ?? null,
    source: partial.source ?? 'git',
    image_url: partial.image_url ?? null,
    image_cmd: partial.image_cmd ?? null,
    container_port: partial.container_port ?? null,
    pending_fix: partial.pending_fix ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
    archived_at: partial.archived_at ?? null,
    deploy_lock_session: partial.deploy_lock_session ?? null,
    deploy_lock_at: partial.deploy_lock_at ?? null,
    access_code: partial.access_code ?? null,
    access_code_iv: partial.access_code_iv ?? null,
    is_preview: partial.is_preview ?? 0,
    pr_number: partial.pr_number ?? null,
    project_type: partial.project_type ?? 'web',
    health_check_strategy: partial.health_check_strategy ?? null,
    health_check_path: partial.health_check_path ?? null,
  };
}

describe('HealthMonitor checkPort fallback', () => {
  const originalFetch = globalThis.fetch;

  let fetchMock: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let inspectContainer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    getProject = vi.fn().mockReturnValue(createProject());
    emit = vi.fn().mockResolvedValue(undefined);
    inspectContainer = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function createMonitor(): HealthMonitor {
    const docker = {
      inspectContainer,
    } as unknown as Docker;

    const db = {
      getProject,
      updateProject: vi.fn(),
      getCircuitBreakerState: vi.fn().mockReturnValue(null),
      resetCircuitBreaker: vi.fn(),
    } as unknown as Database;

    const events = {
      emit,
    } as unknown as EventBus;

    return new HealthMonitor(docker, db, events, { maxRetries: 1, timeoutMs: 20 });
  }

  it('keeps HTTP success behavior unchanged', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const monitor = createMonitor();

    const result = await monitor.checkProject('project-1');

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(inspectContainer).not.toHaveBeenCalled();
  });

  it('marks healthy when HTTP fails but container is running and not restarting', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    inspectContainer.mockResolvedValueOnce({
      State: { Running: true, Restarting: false },
      RestartCount: 0,
    });
    const monitor = createMonitor();

    const result = await monitor.checkProject('project-1');

    expect(result.healthy).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.consecutiveFailures).toBe(0);
    expect(inspectContainer).toHaveBeenCalledWith('container-1');
  });

  it('stays unhealthy when HTTP fails and container is not running', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    inspectContainer.mockResolvedValueOnce({
      State: { Running: false, Restarting: false, ExitCode: 1 },
      RestartCount: 0,
      Config: { Image: 'test:latest' },
    });
    const monitor = createMonitor();

    const result = await monitor.checkProject('project-1');

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('connect ECONNREFUSED');
    expect(result.consecutiveFailures).toBe(1);
  });

  it('stays unhealthy when Docker inspect fallback fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    inspectContainer.mockRejectedValueOnce(new Error('inspect failed'));
    const monitor = createMonitor();

    const result = await monitor.checkProject('project-1');

    expect(result.healthy).toBe(false);
    expect(result.error).toBe('connect ECONNREFUSED');
    expect(result.consecutiveFailures).toBe(1);
  });
});
