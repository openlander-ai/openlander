import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertMonitor } from '../src/monitor/alerts.js';
import type { Database, ProjectRow } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { EventBus } from '../src/events/index.js';
import * as statsModule from '../src/monitor/stats.js';

let getSystemStatsMock = vi.fn();

function createProject(partial?: Partial<ProjectRow>): ProjectRow {
  return {
    id: partial?.id ?? 'project-1',
    name: partial?.name ?? 'project-1',
    repo_url: partial?.repo_url ?? 'https://example.com/repo.git',
    branch: partial?.branch ?? 'main',
    status: partial?.status ?? 'running',
    visibility: partial?.visibility ?? 'internal',
    assigned_port: partial?.assigned_port ?? null,
    container_id: partial?.container_id ?? 'missing-container-1',
    image_tag: partial?.image_tag ?? null,
    previous_image_tag: partial?.previous_image_tag ?? null,
    public_url: partial?.public_url ?? null,
    parent_project_id: partial?.parent_project_id ?? null,
    dockerfile_path: partial?.dockerfile_path ?? 'Dockerfile',
    docker_target: partial?.docker_target ?? null,
    build_method: partial?.build_method ?? null,
    pending_fix: partial?.pending_fix ?? null,
    access_code: partial?.access_code ?? null,
    access_code_iv: partial?.access_code_iv ?? null,
    is_preview: partial?.is_preview ?? 0,
    pr_number: partial?.pr_number ?? null,
    created_at: partial?.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial?.updated_at ?? new Date().toISOString(),
    deploy_lock_session: partial?.deploy_lock_session ?? null,
    deploy_lock_at: partial?.deploy_lock_at ?? null,
  };
}

describe('AlertMonitor missing container handling', () => {
  let emit: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let listImages: ReturnType<typeof vi.fn>;
  let docker: Docker;
  let db: Database;
  let events: EventBus;
  let monitor: AlertMonitor;

  async function runChecks(): Promise<void> {
    await (monitor as unknown as { runChecks: () => Promise<void> }).runChecks();
  }

  beforeEach(() => {
    vi.spyOn(statsModule, 'getSystemStats').mockImplementation((...args) =>
      getSystemStatsMock(...args),
    );
    emit = vi.fn().mockResolvedValue(undefined);
    updateProject = vi.fn();
    listImages = vi.fn().mockResolvedValue([]);
    listProjects = vi.fn().mockReturnValue([createProject()]);

    docker = {
      inspectContainer: vi.fn().mockRejectedValue(new Error('No such container')),
      getContainerStats: vi.fn(),
    } as unknown as Docker;

    db = {
      listProjects,
      updateProject,
      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue(null),
    } as unknown as Database;

    events = {
      emit,
    } as unknown as EventBus;

    monitor = new AlertMonitor(docker, db, events, { intervalMs: 1 });
    getSystemStatsMock.mockReset();
    getSystemStatsMock.mockReturnValue({
      disk: {
        usagePercent: 10,
        usedGB: 10,
        freeGB: 90,
        totalGB: 100,
      },
    });
  });

  it('emits container:missing without changing project status (Coordinator manages status)', async () => {
    await runChecks();

    expect(updateProject).not.toHaveBeenCalledWith('project-1', { status: 'error' });
    expect(emit).toHaveBeenCalledWith(
      'container:missing',
      expect.objectContaining({
        projectId: 'project-1',
        containerId: 'missing-container-1',
      }),
    );
  });

  it('creates container-crash alert when container is missing', async () => {
    await runChecks();

    const alert = monitor
      .getActiveAlerts()
      .find((candidate) => candidate.type === 'container-crash');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('critical');
    expect(alert?.message).toContain('container was removed externally');
  });

  it('includes restart suggestion in the alert', async () => {
    await runChecks();

    const alert = monitor
      .getActiveAlerts()
      .find((candidate) => candidate.type === 'container-crash');
    expect(alert?.suggestion).toBe('Run restart_project to redeploy.');
  });
});
