import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

describe('update_app Stateful Compose approval', () => {
  it('returns pending_approval with a secret-free diff and poll_call', async () => {
    const project = {
      id: 'project-1',
      name: 'demo',
      status: 'running',
      archived_at: null,
    };
    const service = {
      id: 'project-1__svc',
      project_id: project.id,
      name: 'demo__svc',
      kind: 'compose',
      source: 'git',
      repo_url: 'https://github.com/acme/demo.git',
      branch: 'main',
      runtime_role: 'application',
      status: 'running',
      archived_at: null,
    };
    const approval = {
      version: 1 as const,
      serviceId: service.id,
      projectId: project.id,
      commitSha: 'abc123',
      composeFingerprint: 'compose-fingerprint',
      changes: [
        {
          serviceName: 'db',
          serviceId: 'db-child__svc',
          change: 'update' as const,
          changedFields: ['environment'],
          containerId: 'db-container',
          backupRequired: true as const,
          backupVolumes: [{ name: 'demo-db-data', destination: '/var/lib/postgresql/data' }],
        },
      ],
    };
    const db = {
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getServices: vi.fn(async () => [service]),
      isCircuitBreakerOpen: vi.fn(async () => false),
      createPendingMcpApproval: vi.fn(async () => 'action-run-1'),
    };
    const pipeline = {
      prepareStatefulComposeUpdate: vi.fn(async () => approval),
      redeployService: vi.fn(),
    };
    const ctx = {
      db,
      pipeline,
      env: {},
    } as unknown as AppContext;
    const tool = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: ['update_app'],
    })[0];

    const result = await tool?.execute(
      { service_id: service.id, strategy: 'force' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      action_run_id: 'action-run-1',
      project_id: project.id,
      service_id: service.id,
      diff: [
        {
          service_name: 'db',
          change: 'update',
          changed_fields: ['environment'],
          backup_required: true,
        },
      ],
      poll_call: {
        tool: 'openlander_monitor',
        arguments: {
          action: 'mcp_action_status',
          params: { action_run_id: 'action-run-1' },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('demo-db-data');
    expect(JSON.stringify(result)).not.toContain('/var/lib/postgresql/data');
    expect(pipeline.redeployService).not.toHaveBeenCalled();
    expect(db.createPendingMcpApproval).toHaveBeenCalledOnce();
    const storedPlan = db.createPendingMcpApproval.mock.calls[0]?.[0]?.plan;
    expect(storedPlan).not.toContain('DATABASE_PASSWORD');
  });
});
