import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertMonitor } from '../src/monitor/alerts.js';
import type { Database, ProjectRow, ServiceRow } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { EventBus } from '../src/events/index.js';
import * as statsModule from '../src/monitor/stats.js';

let getSystemStatsMock = vi.fn();

function makeStats(usagePercent: number): {
  disk: { usagePercent: number; usedGB: number; freeGB: number; totalGB: number };
} {
  return {
    disk: {
      usagePercent,
      usedGB: 85,
      freeGB: 15,
      totalGB: 100,
    },
  };
}

function createProject(partial?: Partial<ProjectRow>): ProjectRow {
  return {
    id: partial?.id ?? 'project-1',
    name: partial?.name ?? 'project-1',
    repo_url: partial?.repo_url ?? 'https://example.com/repo.git',
    branch: partial?.branch ?? 'main',
    status: partial?.status ?? 'running',
    visibility: partial?.visibility ?? 'internal',
    assigned_port: partial?.assigned_port ?? null,
    container_id: partial?.container_id ?? null,
    image_tag: partial?.image_tag ?? null,
    previous_image_tag: partial?.previous_image_tag ?? null,
    public_url: partial?.public_url ?? null,
    parent_project_id: partial?.parent_project_id ?? null,
    dockerfile_path: partial?.dockerfile_path ?? 'Dockerfile',
    created_at: partial?.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial?.updated_at ?? new Date().toISOString(),
    deploy_lock_session: partial?.deploy_lock_session ?? null,
    deploy_lock_at: partial?.deploy_lock_at ?? null,
  };
}

function createService(partial?: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial?.id ?? 'project-1__svc',
    name: partial?.name ?? 'project-1__svc',
    project_id: partial?.project_id ?? 'project-1',
    kind: partial?.kind ?? 'git',
    status: partial?.status ?? 'running',
    assigned_port: partial?.assigned_port ?? null,
    container_id: partial?.container_id ?? null,
    container_name: partial?.container_name ?? null,
  } as ServiceRow;
}

describe('AlertMonitor', () => {
  let emit: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let docker: Docker;
  let db: Database;
  let events: EventBus;
  let monitor: AlertMonitor;

  async function runChecks(): Promise<void> {
    await monitor.infrastructureAlerter.runChecks();
  }

  beforeEach(() => {
    vi.spyOn(statsModule, 'getSystemStats').mockImplementation((...args) =>
      getSystemStatsMock(...args),
    );
    emit = vi.fn().mockResolvedValue(undefined);
    listProjects = vi.fn().mockReturnValue([]);

    docker = {
      inspectContainer: vi.fn(),
      getContainerStats: vi.fn(),
    } as unknown as Docker;

    db = {
      listProjects,
      listServices: vi.fn().mockReturnValue([]),
      getServices: vi.fn().mockReturnValue([]),
      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue(null),
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;

    events = {
      emit,
    } as unknown as EventBus;

    monitor = new AlertMonitor(docker, db, events);
    getSystemStatsMock.mockReset();
  });

  it('creates warning disk alert at >80% usage', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(81));

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe('disk');
    expect(alerts[0]?.severity).toBe('warning');
  });

  it('creates critical disk alert at >90% usage', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(92));

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('detects inactive projects from old updated_at', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(10));
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    listProjects.mockReturnValue([
      createProject({ id: 'old-1', name: 'legacy', updated_at: oldDate }),
    ]);

    await runChecks();

    const inactiveAlert = monitor
      .getActiveAlerts()
      .find((alert) => alert.type === 'inactive-project' && alert.details['projectId'] === 'old-1');
    expect(inactiveAlert).toBeDefined();
    expect(inactiveAlert?.severity).toBe('warning');
  });

  it('checks restart loops against canonical service container before stale project container', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(10));
    listProjects.mockReturnValue([
      createProject({
        id: 'p1',
        name: 'project-a',
        container_id: 'stale-project-container',
      }),
    ]);
    (db.getServices as ReturnType<typeof vi.fn>).mockReturnValue([
      createService({
        id: 'p1__svc',
        project_id: 'p1',
        container_id: 'canonical-service-container',
      }),
    ]);
    (docker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValue({
      RestartCount: 4,
      State: { StartedAt: new Date().toISOString() },
    });

    await runChecks();

    expect(docker.inspectContainer).toHaveBeenCalledWith('canonical-service-container');
    expect(docker.inspectContainer).not.toHaveBeenCalledWith('stale-project-container');
    const restartAlert = monitor.getActiveAlerts().find((alert) => alert.type === 'restart-loop');
    expect(restartAlert?.details['containerId']).toBe('canonical-service-container');
  });

  it('checks memory saturation against canonical service container before stale project container', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(10));
    listProjects.mockReturnValue([
      createProject({
        id: 'p1',
        name: 'project-a',
        container_id: 'stale-project-container',
      }),
    ]);
    (db.getServices as ReturnType<typeof vi.fn>).mockReturnValue([
      createService({
        id: 'p1__svc',
        project_id: 'p1',
        container_id: 'canonical-service-container',
      }),
    ]);
    (docker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValue({
      RestartCount: 0,
      State: { StartedAt: new Date().toISOString() },
    });
    (docker.getContainerStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      memory_stats: { usage: 950, limit: 1000 },
    });

    await runChecks();

    expect(docker.getContainerStats).toHaveBeenCalledWith('canonical-service-container');
    expect(docker.getContainerStats).not.toHaveBeenCalledWith('stale-project-container');
    const memoryAlert = monitor
      .getActiveAlerts()
      .find((alert) => alert.type === 'resource-saturation');
    expect(memoryAlert?.details['containerId']).toBe('canonical-service-container');
  });

  it('deduplicates alerts for the same check key', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(85));

    await runChecks();
    await runChecks();

    expect(monitor.getActiveAlerts()).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith('alert:new', expect.any(Object));
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('dismisses an active alert', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(86));
    await runChecks();

    const alert = monitor.getActiveAlerts()[0];
    expect(alert).toBeDefined();

    monitor.dismissAlert(alert?.id ?? 'missing');

    expect(monitor.getActiveAlerts()).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith('alert:dismissed', { alertId: alert?.id });
  });

  it('resolves alert when condition clears', async () => {
    getSystemStatsMock.mockReturnValue(makeStats(88));
    await runChecks();
    expect(monitor.getActiveAlerts()).toHaveLength(1);

    getSystemStatsMock.mockReturnValue(makeStats(55));
    await runChecks();

    expect(monitor.getActiveAlerts()).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith('alert:resolved', expect.objectContaining({ type: 'disk' }));
  });
});

describe('AlertMonitor - checkPortConflicts', () => {
  let emit: ReturnType<typeof vi.fn>;
  let listProjects: ReturnType<typeof vi.fn>;
  let docker: Docker;
  let db: Database;
  let events: EventBus;
  let monitor: AlertMonitor;

  async function runChecks(): Promise<void> {
    await monitor.infrastructureAlerter.runChecks();
  }

  beforeEach(() => {
    emit = vi.fn().mockResolvedValue(undefined);
    listProjects = vi.fn().mockReturnValue([]);

    docker = {
      inspectContainer: vi.fn(),
      getContainerStats: vi.fn(),
    } as unknown as Docker;

    db = {
      listProjects,
      listServices: vi.fn().mockReturnValue([]),
      getServices: vi.fn().mockReturnValue([]),
      listOpsIncidentsByDateRange: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue(null),
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;

    events = {
      emit,
    } as unknown as EventBus;

    monitor = new AlertMonitor(docker, db, events);
    getSystemStatsMock.mockReset();
    getSystemStatsMock.mockReturnValue(makeStats(10));
  });

  it('should not create alert when no port conflicts exist', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3000 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3001 }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlerts = alerts.filter((a) => a.type === 'port-conflict');
    expect(portConflictAlerts).toHaveLength(0);
  });

  it('detects port conflicts from canonical service ports before stale project ports', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3100 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3200 }),
    ]);
    (db.getServices as ReturnType<typeof vi.fn>).mockReturnValue([
      createService({ id: 'p1__svc', project_id: 'p1', assigned_port: 3000 }),
      createService({ id: 'p2__svc', project_id: 'p2', assigned_port: 3000 }),
    ]);

    await runChecks();

    const portConflictAlert = monitor
      .getActiveAlerts()
      .find((alert) => alert.type === 'port-conflict');
    expect(portConflictAlert).toBeDefined();
    expect(portConflictAlert?.details['port']).toBe(3000);
  });

  it('should create alert when two projects share the same port', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3000 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3000 }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlerts = alerts.filter((a) => a.type === 'port-conflict');
    expect(portConflictAlerts).toHaveLength(1);
  });

  it('should include suggested port in alert details', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3000 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3000 }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlert = alerts.find((a) => a.type === 'port-conflict');
    expect(portConflictAlert).toBeDefined();
    expect(portConflictAlert?.details['port']).toBe(3000);
    expect(portConflictAlert?.details['suggestedPort']).toBe(4000);
  });

  it('should have correct alert type port-conflict', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3000 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3000 }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlert = alerts.find((a) => a.type === 'port-conflict');
    expect(portConflictAlert?.type).toBe('port-conflict');
  });

  it('should include suggestion message with alternative port', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: 3000 }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: 3000 }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlert = alerts.find((a) => a.type === 'port-conflict');
    expect(portConflictAlert?.suggestion).toContain('4000');
  });

  it('should handle projects with null ports gracefully', async () => {
    listProjects.mockReturnValue([
      createProject({ id: 'p1', name: 'project-a', assigned_port: null }),
      createProject({ id: 'p2', name: 'project-b', assigned_port: null }),
    ]);

    await runChecks();

    const alerts = monitor.getActiveAlerts();
    const portConflictAlerts = alerts.filter((a) => a.type === 'port-conflict');
    expect(portConflictAlerts).toHaveLength(0);
  });
});
