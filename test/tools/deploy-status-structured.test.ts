import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

const FORBIDDEN_FIELDS = ['build_log_call', 'retry_call', 'next_call'];

describe('get_deploy_status structured fields (O1)', () => {
  it('active in-flight job exposes terminal/next_poll_after_ms/status_call and no forbidden fields', async () => {
    const ctx = {
      jobManager: {
        getStatus: vi.fn((id: string) =>
          id === 'd1'
            ? {
                projectId: 'app',
                projectName: 'app',
                phase: 'building',
                startedAt: new Date(Date.now() - 3000),
              }
            : null,
        ),
      },
      db: {
        getDeployableForProject: vi.fn(async () => null),
        getDeployLog: vi.fn(async () => undefined),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd1' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd1',
      project_id: 'app',
      phase: 'building',
      status: 'running',
      terminal: false,
      next_poll_after_ms: 5000,
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { project_id: 'app' },
      },
    });
    expect(typeof job['elapsed_ms']).toBe('number');
    expect(job['service_id']).toBeTruthy();

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('failed completed deploy log is terminal with a diagnostic_call and no next_poll_after_ms', async () => {
    const ctx = {
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd2'
            ? {
                id: 'd2',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'failed',
                commit_sha: 'abc123',
                commit_message: 'broke the build',
                trigger: 'chat',
                duration_ms: 5000,
                build_log: 'step 1\nstep 2\nerror: boom',
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) =>
          id === 'app' ? { id: 'app', name: 'app' } : undefined,
        ),
        getDeployableForProject: vi.fn(async () => ({ status: 'crashed', assigned_port: 10001 })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd2' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd2',
      project_id: 'app',
      service_id: 'app__svc',
      phase: 'failed',
      status: 'failed',
      terminal: true,
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
    });
    expect(job['next_poll_after_ms']).toBeUndefined();
    expect(job['status_call']).toBeDefined();

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('active job found via project_id polling exposes structured fields with no deploy_id', async () => {
    // The common active-poll path: JobManager is keyed by project id, so
    // formatJob is called without a deploy id. status_call carries project_id
    // as the re-poll handle and deploy_id is intentionally absent.
    const ctx = {
      jobManager: {
        getStatus: vi.fn((id: string) =>
          id === 'app'
            ? {
                projectId: 'app',
                projectName: 'app',
                phase: 'building',
                startedAt: new Date(Date.now() - 3000),
              }
            : null,
        ),
      },
      db: {
        getProject: vi.fn(async (id: string) =>
          id === 'app' ? { id: 'app', name: 'app' } : undefined,
        ),
        getDeployableForProject: vi.fn(async () => ({ assigned_port: 10001, status: 'running' })),
        getDeployLockInfo: vi.fn(async () => null),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { project_id: 'app', wait: false },
      { target: 'mcp' },
    )) as { active: number; jobs: Array<Record<string, unknown>> };

    expect(result.active).toBe(1);
    const job = result.jobs[0];
    expect(job).toMatchObject({
      project_id: 'app',
      phase: 'building',
      status: 'running',
      terminal: false,
      next_poll_after_ms: 5000,
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { project_id: 'app' },
      },
    });
    expect(job['deploy_id']).toBeUndefined();
    expect(job['service_id']).toBeTruthy();
    expect(typeof job['elapsed_ms']).toBe('number');

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('watch_ms short-polls an active project and returns a re-poll envelope on timeout', async () => {
    const ctx = {
      jobManager: {
        getStatus: vi.fn((id: string) =>
          id === 'app'
            ? {
                projectId: 'app',
                projectName: 'app',
                phase: 'building',
                startedAt: new Date(Date.now() - 3000),
              }
            : null,
        ),
      },
      db: {
        getProject: vi.fn(async (id: string) =>
          id === 'app' ? { id: 'app', name: 'app' } : undefined,
        ),
        getDeployableForProject: vi.fn(async () => ({ assigned_port: 10001, status: 'running' })),
        getDeployLockInfo: vi.fn(async () => null),
        getLastDeployLog: vi.fn(async () => undefined),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { project_id: 'app', watch_ms: 5 },
      { target: 'mcp' },
    )) as {
      active: number;
      timeout?: boolean;
      status?: string;
      next_poll_after_ms?: number;
      status_call?: Record<string, unknown>;
      jobs: Array<Record<string, unknown>>;
    };

    expect(result).toMatchObject({
      active: 1,
      timeout: true,
      status: 'still_running',
      next_poll_after_ms: 5000,
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { project_id: 'app', watch_ms: 5 },
      },
    });

    expect(result.jobs[0]).toMatchObject({
      project_id: 'app',
      phase: 'building',
      status: 'running',
      terminal: false,
      next_poll_after_ms: 5000,
    });

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });
});
