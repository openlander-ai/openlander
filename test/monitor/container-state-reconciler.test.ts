import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import type { EventBus, EventPayload } from '../../src/events/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { ContainerStateReconciler } from '../../src/monitor/container-state-reconciler.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createProject(partial?: Partial<ProjectRow>): ProjectRow {
  return {
    id: partial?.id ?? 'project-1',
    name: partial?.name ?? 'demo-project',
    repo_url: partial?.repo_url ?? 'https://example.com/repo.git',
    branch: partial?.branch ?? 'main',
    status: partial?.status ?? 'running',
    visibility: partial?.visibility ?? 'internal',
    assigned_port: partial?.assigned_port ?? null,
    container_id: partial?.container_id ?? 'container-1',
    image_tag: partial?.image_tag ?? null,
    previous_image_tag: partial?.previous_image_tag ?? null,
    public_url: partial?.public_url ?? null,
    parent_project_id: partial?.parent_project_id ?? null,
    dockerfile_path: partial?.dockerfile_path ?? 'Dockerfile',
    docker_target: partial?.docker_target ?? null,
    build_context: partial?.build_context ?? null,
    build_method: partial?.build_method ?? null,
    source: partial?.source ?? 'git',
    image_url: partial?.image_url ?? null,
    image_cmd: partial?.image_cmd ?? null,
    container_port: partial?.container_port ?? null,
    pending_fix: partial?.pending_fix ?? null,
    created_at: partial?.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial?.updated_at ?? '2026-01-01T00:00:00.000Z',
    archived_at: partial?.archived_at ?? null,
    deploy_lock_session: partial?.deploy_lock_session ?? null,
    deploy_lock_at: partial?.deploy_lock_at ?? null,
    access_code: partial?.access_code ?? null,
    access_code_iv: partial?.access_code_iv ?? null,
    is_preview: partial?.is_preview ?? 0,
    pr_number: partial?.pr_number ?? null,
    project_type: partial?.project_type ?? 'web',
    health_check_strategy: partial?.health_check_strategy ?? null,
    health_check_path: partial?.health_check_path ?? null,
  };
}

function createService(partial?: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial?.id ?? 'service-1',
    name: partial?.name ?? 'postgres',
    type: partial?.type ?? 'postgres',
    image: partial?.image ?? 'postgres:16',
    status: partial?.status ?? 'running',
    container_id: partial?.container_id ?? 'service-container-1',
    container_name: partial?.container_name ?? 'ol-svc-postgres',
    port: partial?.port ?? 5432,
    env_vars: partial?.env_vars ?? null,
    credentials: partial?.credentials ?? null,
    created_at: partial?.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial?.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('ContainerStateReconciler', () => {
  let listProjects: ReturnType<typeof vi.fn>;
  let listServices: ReturnType<typeof vi.fn>;
  let inspectContainer: ReturnType<typeof vi.fn>;
  let listAllContainers: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let db: Database;
  let docker: Docker;
  let events: EventBus;

  beforeEach(() => {
    listProjects = vi.fn().mockReturnValue([createProject()]);
    listServices = vi.fn().mockReturnValue([createService()]);
    inspectContainer = vi.fn().mockResolvedValue({ State: { Running: true } });
    listAllContainers = vi.fn().mockResolvedValue([]);
    emit = vi.fn().mockResolvedValue(undefined);

    db = {
      listProjects,
      listServices,
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;

    docker = {
      inspectContainer,
      listAllContainers,
    } as unknown as Docker;

    events = {
      emit,
    } as unknown as EventBus;
  });

  it('reconcile calls missing and orphan detection', async () => {
    const reconciler = new ContainerStateReconciler(docker, db, events);
    const detectMissingSpy = vi.spyOn(
      reconciler as unknown as { detectMissingContainers: () => Promise<void> },
      'detectMissingContainers',
    );
    const detectOrphansSpy = vi.spyOn(
      reconciler as unknown as { detectOrphanContainers: () => Promise<void> },
      'detectOrphanContainers',
    );

    await reconciler.reconcile();

    expect(detectMissingSpy).toHaveBeenCalledTimes(1);
    expect(detectOrphansSpy).toHaveBeenCalledTimes(1);
    expect(db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('emits container:missing with the expected payload when inspectContainer reports not found', async () => {
    inspectContainer.mockRejectedValueOnce(new Error('No such container: container-1'));
    const reconciler = new ContainerStateReconciler(docker, db, events);
    const payload: EventPayload['container:missing'] = {
      projectId: 'project-1',
      projectName: 'demo-project',
      containerId: 'container-1',
      suggestion: 'Run restart_service to redeploy.',
    };

    await reconciler.reconcile();

    expect(emit).toHaveBeenCalledWith('container:missing', payload);
  });

  it('does not emit container:missing when inspectContainer succeeds', async () => {
    const reconciler = new ContainerStateReconciler(docker, db, events);

    await reconciler.reconcile();

    expect(emit).not.toHaveBeenCalledWith('container:missing', expect.anything());
  });

  it('skips stopped projects during missing container detection', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'project-1', status: 'stopped', container_id: 'container-1' }),
    ]);
    const reconciler = new ContainerStateReconciler(docker, db, events);

    await reconciler.reconcile();

    expect(inspectContainer).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('counts orphan OpenLander containers that are missing from the database', async () => {
    listProjects.mockReturnValue([createProject({ container_id: 'project-container-1' })]);
    listServices.mockReturnValue([createService({ container_id: 'service-container-1' })]);
    listAllContainers.mockResolvedValue([
      {
        id: 'project-container-1',
        name: 'ol-demo-project',
        image: 'demo:latest',
        state: 'running',
        status: 'Up 10s',
        ports: [],
        labels: {},
        managedByOpenLander: true,
        composeProject: null,
        created: 1,
      },
      {
        id: 'orphan-container-1',
        name: 'ol-orphaned-project',
        image: 'demo:latest',
        state: 'exited',
        status: 'Exited (1)',
        ports: [],
        labels: {},
        managedByOpenLander: true,
        composeProject: null,
        created: 2,
      },
      {
        id: 'service-container-1',
        name: 'openlander-postgres',
        image: 'postgres:16',
        state: 'running',
        status: 'Up 10s',
        ports: [],
        labels: {},
        managedByOpenLander: true,
        composeProject: null,
        created: 3,
      },
    ]);
    const reconciler = new ContainerStateReconciler(docker, db, events);

    await reconciler.reconcile();

    expect(reconciler.getOrphanCount()).toBe(1);
  });

  it('ignores non-OpenLander containers when counting orphans', async () => {
    listProjects.mockReturnValue([]);
    listServices.mockReturnValue([]);
    listAllContainers.mockResolvedValue([
      {
        id: 'external-container-1',
        name: 'redis',
        image: 'redis:7',
        state: 'running',
        status: 'Up 10s',
        ports: [],
        labels: {},
        managedByOpenLander: false,
        composeProject: null,
        created: 1,
      },
    ]);
    const reconciler = new ContainerStateReconciler(docker, db, events);

    await reconciler.reconcile();

    expect(reconciler.getOrphanCount()).toBe(0);
  });
});
