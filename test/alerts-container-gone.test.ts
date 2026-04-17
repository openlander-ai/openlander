import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertMonitor } from '../src/monitor/alerts.js';
import { ContainerAlertHandler } from '../src/monitor/container-alert-handler.js';
import type { Database } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { EventBus } from '../src/events/index.js';

describe('ContainerAlertHandler — container missing', () => {
  let alertMonitor: AlertMonitor;
  let handler: ContainerAlertHandler;
  let eventHandlers: Map<string, Function>;

  beforeEach(() => {
    eventHandlers = new Map();

    const emit = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn((event: string, callback: Function) => {
      eventHandlers.set(event, callback);
      return () => {
        eventHandlers.delete(event);
      };
    });

    const events = { emit, on } as unknown as EventBus;
    const docker = {} as unknown as Docker;
    const db = {
      listProjects: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue(null),
    } as unknown as Database;

    alertMonitor = new AlertMonitor(docker, db, events);
    handler = new ContainerAlertHandler(docker, db, events, alertMonitor);
    handler.start();
  });

  it('creates container-crash alert when container:missing event is received', async () => {
    const missingHandler = eventHandlers.get('container:missing');
    expect(missingHandler).toBeDefined();

    await missingHandler!({
      projectId: 'project-1',
      projectName: 'project-1',
      containerId: 'missing-container-1',
      suggestion: 'Run restart_project to redeploy.',
    });

    const alert = alertMonitor
      .getActiveAlerts()
      .find((candidate) => candidate.type === 'container-crash');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('critical');
    expect(alert?.message).toContain('container was removed externally');
  });

  it('includes restart suggestion in the alert', async () => {
    const missingHandler = eventHandlers.get('container:missing');

    await missingHandler!({
      projectId: 'project-1',
      projectName: 'project-1',
      containerId: 'missing-container-1',
      suggestion: 'Run restart_project to redeploy.',
    });

    const alert = alertMonitor
      .getActiveAlerts()
      .find((candidate) => candidate.type === 'container-crash');
    expect(alert?.details['reason']).toBe('container_missing');
  });

  it('creates alert with correct details on container:die event', async () => {
    eventHandlers.clear();
    const db = {
      listProjects: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue({ id: 'p1', name: 'myapp', container_id: 'c1' }),
    } as unknown as Database;

    const emit = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn((event: string, callback: Function) => {
      eventHandlers.set(event, callback);
      return () => {
        eventHandlers.delete(event);
      };
    });
    const events = { emit, on } as unknown as EventBus;
    const docker = {} as unknown as Docker;

    const monitor = new AlertMonitor(docker, db, events);
    const h = new ContainerAlertHandler(docker, db, events, monitor);
    h.start();

    const dieHandler = eventHandlers.get('container:die');
    expect(dieHandler).toBeDefined();

    await dieHandler!({
      projectId: 'p1',
      containerId: 'c1',
      containerName: 'ol-myapp',
      exitCode: 137,
    });

    const alert = monitor.getActiveAlerts().find((a) => a.type === 'container-crash');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('critical');
    expect(alert?.message).toContain('exit code 137');
    expect(alert?.details['exitCode']).toBe(137);
  });

  it('creates alert with OOM details on container:oom event', async () => {
    eventHandlers.clear();
    const db = {
      listProjects: vi.fn().mockReturnValue([]),
      listAllActiveOpsIncidents: vi.fn().mockReturnValue([]),
      getProject: vi.fn().mockReturnValue({ id: 'p1', name: 'myapp', container_id: 'c1' }),
    } as unknown as Database;

    const emit = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn((event: string, callback: Function) => {
      eventHandlers.set(event, callback);
      return () => {
        eventHandlers.delete(event);
      };
    });
    const events = { emit, on } as unknown as EventBus;
    const docker = {
      inspectContainer: vi.fn().mockResolvedValue({
        HostConfig: { Memory: 536870912 },
      }),
    } as unknown as Docker;

    const monitor = new AlertMonitor(docker, db, events);
    const h = new ContainerAlertHandler(docker, db, events, monitor);
    h.start();

    const oomHandler = eventHandlers.get('container:oom');
    expect(oomHandler).toBeDefined();

    await oomHandler!({
      projectId: 'p1',
      containerId: 'c1',
      containerName: 'ol-myapp',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const alert = monitor.getActiveAlerts().find((a) => a.type === 'container-crash');
    expect(alert).toBeDefined();
    expect(alert?.message).toContain('OOM killed');
    expect(alert?.message).toContain('Memory limit: 512MB');
    expect(alert?.details['reason']).toBe('out_of_memory');
    expect(alert?.details['memoryLimit']).toBe(536870912);
  });
});
