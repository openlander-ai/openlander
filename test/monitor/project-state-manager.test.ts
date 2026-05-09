import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import { ProjectStateManager } from '../../src/monitor/project-state-manager.js';

function createProject(partial: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: partial.id ?? 'project-1',
    name: partial.name ?? 'demo-app',
    repo_url: partial.repo_url ?? 'https://example.com/repo.git',
    branch: partial.branch ?? 'main',
    status: partial.status ?? 'stopped',
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
    build_method: partial.build_method ?? 'dockerfile',
    source: partial.source ?? 'git',
    image_url: partial.image_url ?? null,
    image_cmd: partial.image_cmd ?? null,
    container_port: partial.container_port ?? 3000,
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

describe('ProjectStateManager', () => {
  let eventBus: EventBus;
  let getProject: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let listManagedContainers: ReturnType<typeof vi.fn>;
  let manager: ProjectStateManager;
  let capturedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    eventBus = new EventBus();
    capturedEvents = [];
    eventBus.setCaptureHook((event, payload) => {
      capturedEvents.push({ event, payload });
    });

    getProject = vi.fn();
    listProjects = vi.fn();
    updateProject = vi.fn();
    listManagedContainers = vi.fn();

    const ctx = {
      db: {
        getProject,
        listProjects,
        updateProject,
        // PR 4.5: canonical-first reads need this helper.
        getDeployableForProject: vi.fn().mockReturnValue(undefined),
      },
      docker: {
        listManagedContainers,
      },
      eventBus,
    } as unknown as AppContext;

    manager = new ProjectStateManager(ctx);
  });

  afterEach(() => {
    eventBus.clear();
    eventBus.removeCaptureHook();
    vi.restoreAllMocks();
  });

  it('updates the DB and emits an event for a valid transition', async () => {
    getProject.mockReturnValue(createProject({ status: 'stopped' }));

    const transitioned = await manager.transition('project-1', 'building', 'deploy started');

    expect(transitioned).toBe(true);
    expect(updateProject).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({ status: 'building' }),
    );
    expect(capturedEvents).toEqual([
      {
        event: 'project:status-changed',
        payload: {
          projectId: 'project-1',
          from: 'stopped',
          to: 'building',
          reason: 'deploy started',
        },
      },
    ]);
  });

  it('rejects an invalid transition without changing the DB', async () => {
    getProject.mockReturnValue(createProject({ status: 'running' }));

    const transitioned = await manager.transition('project-1', 'error', 'unexpected state jump');

    expect(transitioned).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
    expect(capturedEvents).toEqual([]);
  });

  it('reconciles active projects without emitting recovery-facing events', async () => {
    const buildingProject = createProject({
      id: 'project-building',
      name: 'app-building',
      status: 'building',
      container_id: 'container-building',
    });
    const runningButMissing = createProject({
      id: 'project-running',
      name: 'app-running',
      status: 'running',
      container_id: 'container-missing',
    });
    const alreadyStopped = createProject({
      id: 'project-stopped',
      name: 'app-stopped',
      status: 'stopped',
      container_id: null,
    });

    listProjects.mockReturnValue([buildingProject, runningButMissing, alreadyStopped]);
    getProject.mockImplementation((projectId: string) => {
      if (projectId === buildingProject.id) {
        return buildingProject;
      }
      if (projectId === runningButMissing.id) {
        return runningButMissing;
      }
      if (projectId === alreadyStopped.id) {
        return alreadyStopped;
      }
      return undefined;
    });
    listManagedContainers.mockResolvedValue([
      {
        id: 'container-building',
        name: 'ol-app-building',
        status: 'running',
        labels: {
          'openlander.project': 'app-building',
        },
      },
    ]);

    const result = await manager.reconcileAll();

    expect(result).toEqual({ reconciled: 2, skipped: 1 });
    expect(updateProject).toHaveBeenNthCalledWith(
      1,
      'project-building',
      expect.objectContaining({ status: 'running' }),
    );
    expect(updateProject).toHaveBeenNthCalledWith(
      2,
      'project-running',
      expect.objectContaining({ status: 'stopped' }),
    );
    expect(capturedEvents).toEqual([]);
  });
});
