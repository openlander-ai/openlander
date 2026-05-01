import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHealthMonitor } from '../../src/monitor/project-health-monitor.js';
import type { Database, ProjectRow } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import type { EventBus } from '../../src/events/index.js';

const mockRunProbe = vi.fn();

vi.mock('../../src/health/probe-runner.js', () => ({
  createLocalProbeRunner: vi.fn(() => ({
    runProbe: mockRunProbe,
  })),
}));

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

type MonitorInternals = {
  runCheck(projectId: string): Promise<void>;
};

describe('ProjectHealthMonitor', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let monitor: ProjectHealthMonitor;

  function createMonitor(options?: ConstructorParameters<typeof ProjectHealthMonitor>[3]) {
    const docker = {} as Docker;
    const db = {
      getProject,
      listProjects,
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;
    const events = {
      emit,
    } as unknown as EventBus;

    return new ProjectHealthMonitor(docker, db, events, options);
  }

  beforeEach(() => {
    getProject = vi
      .fn()
      .mockImplementation((projectId: string) => createProject({ id: projectId }));
    listProjects = vi.fn().mockImplementation((status?: ProjectRow['status']) => {
      if (status === 'running') {
        return [createProject({ id: 'project-1', status: 'running' })];
      }
      if (status === 'error') {
        return [];
      }
      return [];
    });
    emit = vi.fn().mockResolvedValue(undefined);
    monitor = createMonitor();
    mockRunProbe.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('starts and stops the interval lifecycle', () => {
    const intervalToken = { token: 'interval' } as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(intervalToken);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});

    monitor.start();
    monitor.stop();

    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalToken);
  });

  it('emits a healthy monitor:healthcheck event', async () => {
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http', responseTimeMs: 42 });

    await (monitor as unknown as MonitorInternals).runCheck('project-1');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('monitor:healthcheck', {
      projectId: 'project-1',
      healthy: true,
      responseTimeMs: 42,
    });
  });

  it('emits an unhealthy monitor:healthcheck event', async () => {
    mockRunProbe.mockResolvedValue({
      healthy: false,
      source: 'http',
      responseTimeMs: 5000,
      error: 'Connection refused',
    });

    await (monitor as unknown as MonitorInternals).runCheck('project-1');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('monitor:healthcheck', {
      projectId: 'project-1',
      healthy: false,
      responseTimeMs: 5000,
    });
  });

  it('emits health:degraded after the failure threshold is reached', async () => {
    monitor = createMonitor({ failureThreshold: 3 });
    mockRunProbe.mockResolvedValue({
      healthy: false,
      source: 'http',
      responseTimeMs: 100,
      error: 'Timeout',
    });

    await (monitor as unknown as MonitorInternals).runCheck('project-1');
    await (monitor as unknown as MonitorInternals).runCheck('project-1');
    await (monitor as unknown as MonitorInternals).runCheck('project-1');

    expect(emit).toHaveBeenCalledTimes(4);
    expect(emit).toHaveBeenCalledWith('health:degraded', {
      projectId: 'project-1',
      consecutiveFailures: 3,
      lastError: 'Timeout',
    });
  });

  it('resets consecutive failures after a success', async () => {
    mockRunProbe
      .mockResolvedValueOnce({
        healthy: false,
        source: 'http',
        responseTimeMs: 100,
        error: 'Fail 1',
      })
      .mockResolvedValueOnce({
        healthy: false,
        source: 'http',
        responseTimeMs: 100,
        error: 'Fail 2',
      })
      .mockResolvedValueOnce({ healthy: true, source: 'http', responseTimeMs: 20 })
      .mockResolvedValueOnce({
        healthy: false,
        source: 'http',
        responseTimeMs: 100,
        error: 'Fail 3',
      });

    const first = await monitor.checkProject('project-1');
    const second = await monitor.checkProject('project-1');
    const third = await monitor.checkProject('project-1');
    const fourth = await monitor.checkProject('project-1');

    expect(first.consecutiveFailures).toBe(1);
    expect(second.consecutiveFailures).toBe(2);
    expect(third.consecutiveFailures).toBe(0);
    expect(fourth.consecutiveFailures).toBe(1);
  });

  it('skips stopped projects without emitting events', async () => {
    getProject.mockReturnValue(createProject({ id: 'project-1', status: 'stopped' }));
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http', responseTimeMs: 5 });

    await (monitor as unknown as MonitorInternals).runCheck('project-1');

    expect(mockRunProbe).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('treats worker projects as immediately healthy', async () => {
    getProject.mockReturnValue(createProject({ id: 'worker-1', project_type: 'worker' }));

    const result = await monitor.checkProject('worker-1');

    expect(result).toEqual({
      healthy: true,
      responseTimeMs: 0,
      consecutiveFailures: 0,
    });
    expect(mockRunProbe).not.toHaveBeenCalled();
  });
});
