import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, ProjectRow } from '../../src/db/index.js';
import type { EventBus, EventPayload } from '../../src/events/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { ContainerStateReconciler } from '../../src/monitor/container-state-reconciler.js';
import type { ProjectStateManager } from '../../src/monitor/project-state-manager.js';

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
    server_id: partial?.server_id ?? 'local',
    recovering_started_at: partial?.recovering_started_at ?? null,
  };
}

describe('ContainerStateReconciler — recovering watchdog (Fix 3)', () => {
  let db: Partial<Database>;
  let events: { emit: ReturnType<typeof vi.fn> };
  let docker: Partial<Docker>;
  let stateManager: Partial<ProjectStateManager>;
  let reconciler: ContainerStateReconciler;

  // 1.0 GA: timeout raised from 30 → 60 minutes to reduce false positives on
  // legitimately-slow recoveries (large npm install, multi-service compose).
  const SIXTY_ONE_MINUTES_AGO = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  const FIVE_MINUTES_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  beforeEach(() => {
    events = { emit: vi.fn().mockResolvedValue(undefined) };

    docker = {
      inspectContainer: vi.fn().mockResolvedValue({}),
      listAllContainers: vi.fn().mockResolvedValue([]),
    };

    stateManager = {
      transition: vi.fn().mockResolvedValue(true),
    };

    db = {
      listProjects: vi.fn().mockReturnValue([]),
      listServices: vi.fn().mockReturnValue([]),
      getDeployLockInfo: vi.fn().mockReturnValue(null),
      cleanExpiredDeployLocks: vi.fn().mockResolvedValue(0),
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    };

    reconciler = new ContainerStateReconciler(
      docker as Docker,
      db as Database,
      events as unknown as EventBus,
      { intervalMs: 100 },
    );
    reconciler.setStateManager(stateManager as ProjectStateManager);
  });

  it('transitions stuck-recovering project to error after 60 min timeout', async () => {
    const stuckProject = createProject({
      id: 'stuck-1',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [stuckProject];
      return [];
    });

    await reconciler.reconcile();

    expect(stateManager.transition).toHaveBeenCalledWith('stuck-1', 'error', 'recovering-timeout');
  });

  it('does NOT timeout a project that has been recovering for less than 60 min', async () => {
    const recentProject = createProject({
      id: 'recent-1',
      status: 'recovering',
      recovering_started_at: FIVE_MINUTES_AGO,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [recentProject];
      return [];
    });

    await reconciler.reconcile();

    expect(stateManager.transition).not.toHaveBeenCalled();
  });

  it('does NOT timeout a recovering project with no recovering_started_at', async () => {
    const noTimestamp = createProject({
      id: 'no-ts-1',
      status: 'recovering',
      recovering_started_at: null,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [noTimestamp];
      return [];
    });

    await reconciler.reconcile();

    expect(stateManager.transition).not.toHaveBeenCalled();
  });

  it('emits project:status-changed event when timing out stuck recovery', async () => {
    const stuckProject = createProject({
      id: 'stuck-2',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [stuckProject];
      return [];
    });

    await reconciler.reconcile();

    expect(events.emit).toHaveBeenCalledWith(
      'project:status-changed',
      expect.objectContaining({
        projectId: 'stuck-2',
        from: 'recovering',
        to: 'error',
      }),
    );
  });

  it('handles multiple stuck projects in one reconcile cycle', async () => {
    const stuck1 = createProject({
      id: 'stuck-a',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
    });
    const stuck2 = createProject({
      id: 'stuck-b',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
    });
    const ok = createProject({
      id: 'ok-1',
      status: 'recovering',
      recovering_started_at: FIVE_MINUTES_AGO,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [stuck1, stuck2, ok];
      return [];
    });

    await reconciler.reconcile();

    expect(stateManager.transition).toHaveBeenCalledTimes(2);
    expect(stateManager.transition).toHaveBeenCalledWith('stuck-a', 'error', 'recovering-timeout');
    expect(stateManager.transition).toHaveBeenCalledWith('stuck-b', 'error', 'recovering-timeout');
  });

  it('does NOT timeout a project whose deploy lock is still held by an active session', async () => {
    const stuckButLocked = createProject({
      id: 'lock-held',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [stuckButLocked];
      return [];
    });

    (db.getDeployLockInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      session: 'auto-recovery-lock-held-abc',
      lockedAt: new Date().toISOString(),
    });

    await reconciler.reconcile();

    expect(stateManager.transition).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalledWith(
      'project:status-changed',
      expect.objectContaining({ projectId: 'lock-held' }),
    );
  });

  it('cleans stale deploy locks before deciding a stuck recovery is still locked', async () => {
    const stuckWithStaleLock = createProject({
      id: 'stale-lock',
      status: 'recovering',
      recovering_started_at: SIXTY_ONE_MINUTES_AGO,
      container_id: null,
      deploy_lock_session: 'stale-session',
      deploy_lock_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    });

    (db.listProjects as ReturnType<typeof vi.fn>).mockImplementation((status?: string) => {
      if (status === 'recovering') return [stuckWithStaleLock];
      return [];
    });
    (db.cleanExpiredDeployLocks as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (db.getDeployLockInfo as ReturnType<typeof vi.fn>).mockReturnValue(null);

    await reconciler.reconcile();

    expect(db.cleanExpiredDeployLocks).toHaveBeenCalled();
    expect(stateManager.transition).toHaveBeenCalledWith(
      'stale-lock',
      'error',
      'recovering-timeout',
    );
  });
});
