import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import {
  createOpenLanderDeployCompositeTool,
  createOpenLanderMonitorCompositeTool,
  createOpenLanderProjectCompositeTool,
} from '../../src/mcp/composite-tools.js';
import { deliveryToolDefs } from '../../src/tools/defs/delivery.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import type { ToolDef } from '../../src/tools/defs/types.js';
import type { RequestIdentity } from '../../src/types/identity.js';

const NOW = '2026-01-01T00:00:00.000Z';

const projectOne = {
  id: 'project-1',
  name: 'project-one',
  status: 'running',
  visibility: 'internal',
  repo_url: null,
  branch: 'main',
  assigned_port: null,
  public_url: null,
  created_at: NOW,
  updated_at: NOW,
};

const projectTwo = {
  ...projectOne,
  id: 'project-2',
  name: 'project-two',
};

function makeService(overrides: Record<string, unknown>) {
  return {
    id: 'service-1',
    name: 'web',
    project_id: 'project-1',
    kind: 'git',
    source: 'git',
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    container_name: null,
    public_url: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

const serviceOne = makeService({ id: 'service-1', name: 'web', project_id: 'project-1' });
const siblingService = makeService({
  id: 'service-sibling',
  name: 'worker',
  project_id: 'project-1',
  assigned_port: 10002,
});
const serviceTwo = makeService({ id: 'service-2', name: 'api', project_id: 'project-2' });

function createScopedContext(identity: RequestIdentity) {
  const services = [serviceOne, siblingService, serviceTwo];
  const projects = [projectOne, projectTwo];
  const db = {
    getProject: vi.fn(async (id: string) => projects.find((project) => project.id === id) ?? null),
    getProjectByName: vi.fn(
      async (name: string) => projects.find((project) => project.name === name) ?? null,
    ),
    listProjects: vi.fn(async () => projects),
    getService: vi.fn(async (id: string) => services.find((service) => service.id === id) ?? null),
    listServices: vi.fn(async () => services),
    getServices: vi.fn(async (query?: { ids?: string[] }) =>
      query?.ids ? services.filter((service) => query.ids?.includes(service.id)) : services,
    ),
    getDeployableForProject: vi.fn(
      async (projectId: string) =>
        services.find((service) => service.project_id === projectId) ?? null,
    ),
    getDeployablesByGroup: vi.fn(async (projectId: string) =>
      services.filter((service) => service.project_id === projectId),
    ),
    getDeployLog: vi.fn(async (deployId: string) =>
      deployId === 'deploy-service-1'
        ? { id: deployId, service_id: 'service-1' }
        : deployId === 'deploy-service-2'
          ? { id: deployId, service_id: 'service-2' }
          : null,
    ),
    getDelivery: vi.fn(async (deliveryId: string) =>
      deliveryId === 'delivery-1'
        ? { id: deliveryId, project_id: 'project-1' }
        : deliveryId === 'delivery-2'
          ? { id: deliveryId, project_id: 'project-2' }
          : null,
    ),
    getDeliveryProjectIdByArtifactId: vi.fn(async (artifactId: string) =>
      artifactId === 'artifact-1' ? 'project-1' : artifactId === 'artifact-2' ? 'project-2' : null,
    ),
    getAiOpsBriefing: vi.fn(async () => null),
    getActionRun: vi.fn(async () => null),
    listDomainMappings: vi.fn(async () => []),
    updateProject: vi.fn(async () => undefined),
  };
  const appCtx = {
    db,
    docker: { inspectContainer: vi.fn() },
  } as unknown as AppContext;
  return {
    context: { target: 'mcp' as const, appCtx, identity },
    db,
  };
}

function createMonitorComposite(execute = vi.fn(async () => ({ status: 'ok' }))) {
  const toolDefs: ToolDef[] = [
    {
      name: 'get_logs',
      description: 'Get logs',
      inputSchema: z.object({
        service_id: z.string().min(1).optional(),
        project_id: z.string().min(1).optional(),
        lines: z.number().int().positive().optional(),
      }),
      execute,
    },
    {
      name: 'get_system_stats',
      description: 'Get system stats',
      inputSchema: z.object({}),
      execute,
    },
    {
      name: 'mcp_action_status',
      description: 'Get action status',
      inputSchema: z
        .object({
          action_run_id: z.string().min(1).optional(),
          action_id: z.string().min(1).optional(),
        })
        .refine((value) => Boolean(value.action_run_id || value.action_id), {
          message: 'action_run_id or action_id is required',
        }),
      execute,
    },
    {
      name: 'get_ai_ops_briefing',
      description: 'Get AI Ops briefing',
      inputSchema: z.object({
        briefing_id: z.string().min(1),
      }),
      execute,
    },
    {
      name: 'diagnose_service',
      description: 'Diagnose service',
      inputSchema: z.object({
        service_id: z.string().min(1).optional(),
        briefing_id: z.string().min(1).optional(),
      }),
      execute,
    },
  ];
  return {
    tool: createOpenLanderMonitorCompositeTool(toolDefs),
    execute,
  };
}

function createDeployComposite(execute = vi.fn(async () => ({ status: 'ok' }))) {
  const toolDefs: ToolDef[] = [
    {
      name: 'get_deploy_status',
      description: 'Get deploy status',
      inputSchema: z.object({
        deploy_id: z.string().min(1).optional(),
        service_id: z.string().min(1).optional(),
        service_name: z.string().min(1).optional(),
        project_id: z.string().min(1).optional(),
      }),
      execute,
    },
  ];
  return {
    tool: createOpenLanderDeployCompositeTool(toolDefs),
    execute,
  };
}

describe('MCP scoped token enforcement', () => {
  it('returns SCOPE_VIOLATION when a project-scoped token targets another project', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'get_logs', params: { service_id: 'service-2', lines: 10 } },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'project',
        tokenScopeProjectId: 'project-1',
        targetProjectId: 'project-2',
        targetServiceId: 'service-2',
        reason: 'project_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects when any supplied target selector is outside a project-scoped token', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      {
        action: 'get_logs',
        params: { project_id: 'project-1', service_id: 'service-2', lines: 10 },
      },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'project',
        tokenScopeProjectId: 'project-1',
        targetProjectId: 'project-2',
        targetServiceId: 'service-2',
        reason: 'project_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects project-level target selectors for service-scoped tokens even with the scoped service_id present', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = (await tool.execute(
      {
        action: 'get_logs',
        params: { service_id: 'service-1', project_id: 'project-1', lines: 10 },
      },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'service',
        tokenScopeServiceId: 'service-1',
        targetProjectId: 'project-1',
        targetServiceId: null,
        reason: 'service_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects mixed deploy_id and service_id when any target is outside a service-scoped token', async () => {
    const { tool, execute } = createDeployComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = (await tool.execute(
      {
        action: 'get_deploy_status',
        params: { deploy_id: 'deploy-service-1', service_id: 'service-sibling' },
      },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'service',
        tokenScopeServiceId: 'service-1',
        targetProjectId: 'project-1',
        targetServiceId: 'service-sibling',
        reason: 'service_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects mixed service_id and service_name when any target is outside a service-scoped token', async () => {
    const { tool, execute } = createDeployComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = (await tool.execute(
      {
        action: 'get_deploy_status',
        params: { service_id: 'service-1', service_name: 'api' },
      },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'service',
        tokenScopeServiceId: 'service-1',
        targetProjectId: 'project-2',
        targetServiceId: 'service-2',
        reason: 'service_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects mixed briefing_id and service_id when any target is outside a service-scoped token', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });
    db.getAiOpsBriefing.mockResolvedValueOnce({
      id: 'brief-service-1',
      project_id: 'project-1',
      service_id: 'service-1',
    });

    const result = (await tool.execute(
      {
        action: 'diagnose_service',
        params: { briefing_id: 'brief-service-1', service_id: 'service-sibling' },
      },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'service',
        tokenScopeServiceId: 'service-1',
        targetProjectId: 'project-1',
        targetServiceId: 'service-sibling',
        reason: 'service_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns SCOPE_VIOLATION when a service-scoped token targets a sibling service', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = (await tool.execute(
      { action: 'get_logs', params: { service_id: 'service-sibling', lines: 10 } },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'service',
        tokenScopeServiceId: 'service-1',
        targetProjectId: 'project-1',
        targetServiceId: 'service-sibling',
        reason: 'service_mismatch',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets a service-scoped token execute against its exact service target', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = await tool.execute(
      { action: 'get_logs', params: { service_id: 'service-1', lines: 10 } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ service_id: 'service-1', lines: 10 }, context);
  });

  it('lets a service-scoped token poll its own held MCP action status', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });
    db.getActionRun.mockResolvedValueOnce({
      id: 'action-run-1',
      project_id: 'project-1',
      plan: JSON.stringify({
        type: 'destructive_mcp',
        tool: 'archive_service',
        args: { service_id: 'service-1' },
        targetProjectId: 'project-1',
        targetServiceId: 'service-1',
      }),
    });

    const result = await tool.execute(
      { action: 'mcp_action_status', params: { action_run_id: 'action-run-1' } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ action_run_id: 'action-run-1' }, context);
  });

  it('lets a service-scoped token poll its own held MCP action status by action_id alias', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });
    db.getActionRun.mockResolvedValueOnce({
      id: 'action-run-1',
      project_id: 'project-1',
      plan: JSON.stringify({
        type: 'destructive_mcp',
        tool: 'archive_service',
        args: { service_id: 'service-1' },
        targetProjectId: 'project-1',
        targetServiceId: 'service-1',
      }),
    });

    const result = await tool.execute(
      { action: 'mcp_action_status', params: { action_id: 'action-run-1' } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ action_id: 'action-run-1' }, context);
  });

  it('lets a project-scoped token poll a project-level held MCP action from plan targetProjectId', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });
    db.getActionRun.mockResolvedValueOnce({
      id: 'action-run-1',
      project_id: '',
      plan: JSON.stringify({
        type: 'destructive_mcp',
        tool: 'archive_project',
        args: { project_id: 'project-1' },
        targetProjectId: 'project-1',
      }),
    });

    const result = await tool.execute(
      { action: 'mcp_action_status', params: { action_run_id: 'action-run-1' } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ action_run_id: 'action-run-1' }, context);
  });

  it('lets a service-scoped token poll project-level held MCP action status in its project', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });
    db.getActionRun.mockResolvedValueOnce({
      id: 'action-run-1',
      project_id: 'project-1',
      plan: JSON.stringify({
        type: 'destructive_mcp',
        tool: 'archive_project',
        args: { project_id: 'project-1' },
        targetProjectId: 'project-1',
      }),
    });

    const result = await tool.execute(
      { action: 'mcp_action_status', params: { action_run_id: 'action-run-1' } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ action_run_id: 'action-run-1' }, context);
  });

  it('normalizes missing service targets to SCOPE_VIOLATION for scoped tokens', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'get_logs', params: { service_id: 'missing-service', lines: 10 } },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      code: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'project',
        tokenScopeProjectId: 'project-1',
        targetProjectId: null,
        targetServiceId: null,
        reason: 'target_not_found_or_out_of_scope',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets a service-scoped token read project-level briefings for its service project', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context, db } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });
    db.getAiOpsBriefing.mockResolvedValueOnce({
      id: 'briefing-1',
      project_id: 'project-1',
      service_id: null,
    });

    const result = await tool.execute(
      { action: 'get_ai_ops_briefing', params: { briefing_id: 'briefing-1' } },
      context,
    );

    expect(result).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledWith({ briefing_id: 'briefing-1' }, context);
  });

  it('returns target_required for targetless host-level actions under scoped tokens', async () => {
    const { tool, execute } = createMonitorComposite();
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'get_system_stats', params: {} },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      details: {
        tokenScopeKind: 'project',
        tokenScopeProjectId: 'project-1',
        targetProjectId: null,
        reason: 'target_required',
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('filters list_projects to the scoped service and hides sibling services', async () => {
    const tool = createOpenLanderProjectCompositeTool(projectOpsToolDefs);
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: null,
      mcpScopeServiceId: 'service-1',
    });

    const result = (await tool.execute({ action: 'list_projects', params: {} }, context)) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({ count: 1 });
    const projects = result['projects'] as Array<Record<string, unknown>>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: 'project-1',
      deployable_service: {
        service_id: 'service-1',
        service_name: 'web',
      },
      deployable_service_count: 1,
    });
    expect(projects[0]?.['deployable_services']).toEqual([
      expect.objectContaining({ service_id: 'service-1', service_name: 'web' }),
    ]);
    expect(JSON.stringify(projects[0])).not.toContain('service-sibling');
    expect(JSON.stringify(result)).not.toContain('project-2');
  });

  it('hides a Delivery from a token scoped to another Project', async () => {
    const tool = createOpenLanderProjectCompositeTool(deliveryToolDefs);
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'get_delivery', params: { delivery_id: 'delivery-2' } },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'SCOPE_VIOLATION',
      details: {
        tokenScopeProjectId: 'project-1',
        targetProjectId: 'project-2',
        resolvedFrom: 'delivery_id',
        reason: 'project_mismatch',
      },
    });
  });

  it('rejects mixed Delivery, deployment, and report artifact selectors across Projects', async () => {
    const tool = createOpenLanderProjectCompositeTool(deliveryToolDefs);
    const { context } = createScopedContext({
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    });

    const deployResult = (await tool.execute(
      {
        action: 'link_delivery_deploy',
        params: {
          delivery_id: 'delivery-1',
          deploy_id: 'deploy-service-2',
          relation: 'released',
        },
      },
      context,
    )) as Record<string, unknown>;
    const artifactResult = (await tool.execute(
      {
        action: 'record_delivery_gate_result',
        params: {
          delivery_id: 'delivery-1',
          gate_key: 'qa',
          status: 'passed',
          report_artifact_id: 'artifact-2',
        },
      },
      context,
    )) as Record<string, unknown>;

    expect(deployResult).toMatchObject({
      error: 'SCOPE_VIOLATION',
      details: { targetProjectId: 'project-2', resolvedFrom: 'deploy_id' },
    });
    expect(artifactResult).toMatchObject({
      error: 'SCOPE_VIOLATION',
      details: { targetProjectId: 'project-2', resolvedFrom: 'artifact_id' },
    });
  });
});
