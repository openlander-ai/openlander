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
        params: { service_id: 'app__svc' },
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
    expect(job['created_at']).toBe('2026-05-21T23:59:55.000Z');
    expect(job['completed_at']).toBe('2026-05-22T00:00:00.000Z');
    expect(job['created_at']).not.toBe(job['completed_at']);

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('failed blue-green deploy log tells agents the previous version is still serving', async () => {
    const ctx = {
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd-blue'
            ? {
                id: 'd-blue',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'failed',
                commit_sha: 'abc123',
                commit_message: 'late crash',
                trigger: 'chat',
                duration_ms: 5000,
                build_log:
                  '[health] Checking http on port 12001/health\n' +
                  '[error] Health check failed\n' +
                  '[recovery] Previous version is still serving after failed blue-green deploy; inspect diagnostics and fix source/config before trying another update. Do not immediately retry with force.\n',
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) =>
          id === 'app' ? { id: 'app', name: 'app' } : undefined,
        ),
        getDeployableForProject: vi.fn(async () => ({ status: 'running', assigned_port: 10001 })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd-blue' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd-blue',
      phase: 'failed',
      status: 'failed',
      previous_version_still_serving: true,
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
      _agent_guidance: {
        message: expect.stringContaining('previous version is still serving'),
        next_steps: expect.arrayContaining([
          expect.stringContaining('Do not immediately retry with strategy="force"'),
        ]),
      },
    });
    expect(job['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('Avoid force redeploy')]),
    );
    expect(JSON.stringify(job)).not.toContain('Fix the issue, then redeploy the service');
    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('active failed blue-green job discourages immediate force redeploy', async () => {
    const ctx = {
      jobManager: {
        getStatus: vi.fn((id: string) =>
          id === 'd-active-blue'
            ? {
                projectId: 'app',
                projectName: 'app',
                phase: 'failed',
                startedAt: new Date(Date.now() - 5000),
                errorSummary:
                  'Blue-green deploy failed; previous version still serving. Inspect diagnostics and fix source/config before trying another update. Do not immediately retry with force: Health check failed',
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
      { deploy_id: 'd-active-blue' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd-active-blue',
      phase: 'failed',
      previous_version_still_serving: true,
      _agent_guidance: {
        message: expect.stringContaining('previous version is still serving'),
        next_steps: expect.arrayContaining([
          expect.stringContaining('Do not immediately retry with strategy="force"'),
        ]),
      },
    });
  });

  it('completed deploy log URLs use ServiceView project fallback when no service row exists', async () => {
    const ctx = {
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd3'
            ? {
                id: 'd3',
                service_id: 'legacy-app__svc',
                project_id: 'legacy-app',
                status: 'success',
                commit_sha: 'abc123',
                commit_message: 'ship',
                trigger: 'api',
                duration_ms: 2000,
                build_log: null,
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) =>
          id === 'legacy-app'
            ? { id: 'legacy-app', name: 'legacy-app', assigned_port: 10077, status: 'running' }
            : undefined,
        ),
        getDeployableForProject: vi.fn(async () => null),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd3' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd3',
      phase: 'done',
      health: 'running',
    });
    expect(JSON.stringify(job['urls'])).toContain('10077');
  });

  it('completed deploy log URLs use service route identity after target Project attach', async () => {
    const originalPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    process.env['OPENLANDER_PUBLIC_HOST'] = 'apps.example.com';
    try {
      const ctx = {
        jobManager: { getStatus: vi.fn(() => null) },
        db: {
          getDeployLog: vi.fn(async (id: string) =>
            id === 'd4'
              ? {
                  id: 'd4',
                  service_id: 'urlnest__svc',
                  project_id: 'p2probe',
                  status: 'success',
                  commit_sha: 'abc123',
                  commit_message: 'ship',
                  trigger: 'api',
                  duration_ms: 2000,
                  build_log: null,
                  created_at: '2026-05-22T00:00:00Z',
                }
              : undefined,
          ),
          getProject: vi.fn(async (id: string) =>
            id === 'p2probe'
              ? { id: 'p2probe', name: 'p2probe', assigned_port: null, status: 'running' }
              : undefined,
          ),
          getDeployableForProject: vi.fn(async () => null),
          getService: vi.fn(async (id: string) =>
            id === 'urlnest__svc'
              ? {
                  id: 'urlnest__svc',
                  name: 'urlnest__svc',
                  project_id: 'p2probe',
                  assigned_port: 10001,
                  public_url: null,
                  status: 'running',
                }
              : undefined,
          ),
        },
      } as unknown as AppContext;

      const result = (await getTool(ctx, 'get_deploy_status').execute(
        { deploy_id: 'd4' },
        { target: 'mcp' },
      )) as { jobs: Array<Record<string, unknown>> };

      const job = result.jobs[0]!;
      expect(job['project_id']).toBe('p2probe');
      expect(job['service_id']).toBe('urlnest__svc');
      expect(job['preferred_url']).toBe('http://urlnest.apps.example.com');
      expect(job['internal_host']).toBe('ol-urlnest');
      expect(job['preferred_url']).not.toBe('http://p2probe.apps.example.com');
    } finally {
      if (originalPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = originalPublicHost;
      }
    }
  });

  it('completed successful deploy log surfaces current recent restart loop as unhealthy', async () => {
    const project = {
      id: 'app',
      name: 'app',
      status: 'running',
      container_id: 'container-1',
    };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      status: 'running',
      container_id: 'container-1',
      assigned_port: 10001,
      public_url: null,
    };
    const ctx = {
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd5'
            ? {
                id: 'd5',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'success',
                commit_sha: 'abc123',
                commit_message: 'ship',
                trigger: 'api',
                duration_ms: 2000,
                build_log: null,
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) => (id === 'app' ? project : undefined)),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          RestartCount: 7,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
          },
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd5' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd5',
      phase: 'done',
      status: 'unhealthy',
      health: 'unhealthy',
      readiness: 'unhealthy',
      readiness_message: expect.stringContaining('restarted 7 times recently'),
      post_deploy_stability: {
        status: 'unstable',
        source: 'current_container_inspect',
        readiness: 'unhealthy',
        message: expect.stringContaining('restarted 7 times recently'),
      },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
      _agent_guidance: {
        message: expect.stringContaining('restarted 7 times recently'),
        next_steps: expect.arrayContaining([
          'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics.',
        ]),
      },
    });
    expect(job['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('restarted 7 times recently')]),
    );
    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it('completed successful deploy log surfaces persisted representative traffic failure as unhealthy', async () => {
    const project = { id: 'app', name: 'app', status: 'running', container_id: 'container-1' };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      status: 'running',
      container_id: 'container-1',
      assigned_port: 10001,
      public_url: null,
    };
    const verifyManagedTraefikRoute = vi.fn();
    const ctx = {
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd6'
            ? {
                id: 'd6',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'success',
                commit_sha: 'abc123',
                commit_message: 'ship',
                trigger: 'api',
                duration_ms: 2000,
                build_log: null,
                representative_traffic_json: JSON.stringify({
                  status: 'failed',
                  severity: 'fail',
                  path: '/',
                  status_code: 500,
                  attempts: 2,
                  elapsed_ms: 1200,
                  message: 'Route probe returned HTTP 500',
                }),
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) => (id === 'app' ? project : undefined)),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        updateDeployLogRepresentativeTraffic: vi.fn(),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          RestartCount: 0,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
          },
        })),
      },
      pipeline: { verifyManagedTraefikRoute },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd6' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd6',
      phase: 'done',
      status: 'unhealthy',
      health: 'unhealthy',
      representative_traffic: {
        status: 'failed',
        severity: 'fail',
        path: '/',
        status_code: 500,
        attempts: 2,
        elapsed_ms: 1200,
        message: 'Route probe returned HTTP 500',
      },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
      _agent_guidance: {
        message: 'Route probe returned HTTP 500',
        next_steps: expect.arrayContaining([
          'Do not report end-user success until representative public traffic returns a non-5xx response.',
        ]),
      },
    });
    expect(job['warnings']).toEqual(expect.arrayContaining(['Route probe returned HTTP 500']));
    expect(verifyManagedTraefikRoute).not.toHaveBeenCalled();
    expect(ctx.db.updateDeployLogRepresentativeTraffic).not.toHaveBeenCalled();
  });

  it('completed deploy status persists representative traffic failure when missing from log', async () => {
    const project = { id: 'app', name: 'app', status: 'running', container_id: 'container-1' };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      status: 'running',
      container_id: 'container-1',
      assigned_port: 10001,
      public_url: null,
    };
    const updateDeployLogRepresentativeTraffic = vi.fn(async () => undefined);
    const verifyManagedTraefikRoute = vi.fn(async () => ({
      ok: false,
      status: 500,
      attempts: 3,
      elapsedMs: 1800,
      error: 'Route probe returned HTTP 500',
    }));
    const ctx = {
      config: { traefik: { mode: 'managed' } },
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd7'
            ? {
                id: 'd7',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'success',
                commit_sha: 'abc123',
                commit_message: 'ship',
                trigger: 'api',
                duration_ms: 2000,
                build_log: null,
                representative_traffic_json: null,
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) => (id === 'app' ? project : undefined)),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        updateDeployLogRepresentativeTraffic,
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          RestartCount: 0,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
          },
        })),
      },
      pipeline: { verifyManagedTraefikRoute },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd7' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd7',
      phase: 'done',
      status: 'unhealthy',
      representative_traffic: {
        status: 'failed',
        severity: 'fail',
        path: '/',
        status_code: 500,
        attempts: 3,
        elapsed_ms: 1800,
        message: 'Route probe returned HTTP 500',
      },
    });
    expect(verifyManagedTraefikRoute).toHaveBeenCalledWith({
      projectName: 'web',
      path: '/',
      probeTimeoutMs: 1000,
      maxWaitMs: 2500,
      intervalMs: 500,
      minimumSuccessAgeMs: 0,
    });
    expect(updateDeployLogRepresentativeTraffic).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(updateDeployLogRepresentativeTraffic.mock.calls[0]?.[1] as string);
    expect(persisted).toMatchObject({
      status: 'failed',
      severity: 'fail',
      path: '/',
      status_code: 500,
    });
  });

  it('completed deploy status persists representative traffic success when missing from log', async () => {
    const project = { id: 'app', name: 'app', status: 'running', container_id: 'container-1' };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      status: 'running',
      container_id: 'container-1',
      assigned_port: 10001,
      public_url: null,
    };
    const updateDeployLogRepresentativeTraffic = vi.fn(async () => undefined);
    const verifyManagedTraefikRoute = vi.fn(async () => ({
      ok: true,
      status: 200,
      attempts: 2,
      elapsedMs: 700,
    }));
    const ctx = {
      config: { traefik: { mode: 'managed' } },
      jobManager: { getStatus: vi.fn(() => null) },
      db: {
        getDeployLog: vi.fn(async (id: string) =>
          id === 'd8'
            ? {
                id: 'd8',
                service_id: 'app__svc',
                project_id: 'app',
                status: 'success',
                commit_sha: 'abc123',
                commit_message: 'ship',
                trigger: 'api',
                duration_ms: 2000,
                build_log: null,
                representative_traffic_json: null,
                created_at: '2026-05-22T00:00:00Z',
              }
            : undefined,
        ),
        getProject: vi.fn(async (id: string) => (id === 'app' ? project : undefined)),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        updateDeployLogRepresentativeTraffic,
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          RestartCount: 0,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
          },
        })),
      },
      pipeline: { verifyManagedTraefikRoute },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd8' },
      { target: 'mcp' },
    )) as { jobs: Array<Record<string, unknown>> };

    const job = result.jobs[0];
    expect(job).toMatchObject({
      deploy_id: 'd8',
      phase: 'done',
      status: 'success',
      representative_traffic: {
        status: 'passed',
        severity: 'ok',
        path: '/',
        status_code: 200,
        attempts: 2,
        elapsed_ms: 700,
      },
    });
    expect(verifyManagedTraefikRoute).toHaveBeenCalledWith({
      projectName: 'web',
      path: '/',
      probeTimeoutMs: 1000,
      maxWaitMs: 2500,
      intervalMs: 500,
      minimumSuccessAgeMs: 0,
    });
    expect(updateDeployLogRepresentativeTraffic).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(updateDeployLogRepresentativeTraffic.mock.calls[0]?.[1] as string);
    expect(persisted).toMatchObject({
      status: 'passed',
      severity: 'ok',
      path: '/',
      status_code: 200,
    });
  });

  it('active job found via project_id polling exposes structured fields with no deploy_id', async () => {
    // The common active-poll path: JobManager is keyed by project id, so
    // formatJob is called without a deploy id. status_call carries service_id
    // as the preferred re-poll handle and deploy_id is intentionally absent.
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
        params: { service_id: 'app__svc' },
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

  it('project_id polling follows a single deployable group to the runtime project', async () => {
    const ctx = {
      jobManager: {
        getStatus: vi.fn((id: string) =>
          id === 'runtime-app'
            ? {
                projectId: 'runtime-app',
                projectName: 'hotdeal-api',
                phase: 'building',
                startedAt: new Date(Date.now() - 3000),
              }
            : null,
        ),
      },
      db: {
        getProject: vi.fn(async (id: string) => {
          if (id === 'group-hotdeal') return { id, name: 'hotdeal' };
          if (id === 'runtime-app') return { id, name: 'hotdeal-api' };
          return undefined;
        }),
        getDeployablesByGroup: vi.fn(async (id: string) =>
          id === 'group-hotdeal'
            ? [{ id: 'runtime-app__svc', name: 'hotdeal-api', project_id: 'group-hotdeal' }]
            : [],
        ),
        getDeployableForProject: vi.fn(async (id: string) =>
          id === 'runtime-app' ? { assigned_port: 10001, status: 'running' } : null,
        ),
        getDeployLockInfo: vi.fn(async () => null),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { project_id: 'group-hotdeal', wait: false },
      { target: 'mcp' },
    )) as { active: number; jobs: Array<Record<string, unknown>> };

    expect(result.active).toBe(1);
    expect(result.jobs[0]).toMatchObject({
      project_id: 'runtime-app',
      service_id: 'runtime-app__svc',
      name: 'hotdeal-api',
      phase: 'building',
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { service_id: 'runtime-app__svc' },
      },
    });
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

  it('watch_ms also short-polls an active deploy_id lookup consistently', async () => {
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
        getDeployLog: vi.fn(async () => undefined),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'get_deploy_status').execute(
      { deploy_id: 'd1', watch_ms: 5 },
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
        params: { deploy_id: 'd1', watch_ms: 5 },
      },
    });
    expect(result.jobs[0]).toMatchObject({
      deploy_id: 'd1',
      project_id: 'app',
      phase: 'building',
      terminal: false,
    });

    const serialized = JSON.stringify(result);
    for (const field of FORBIDDEN_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });
});
