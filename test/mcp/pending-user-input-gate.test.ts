import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AppContext } from '../../src/app.js';
import {
  createOpenLanderProjectCompositeTool,
  createOpenLanderServiceCompositeTool,
} from '../../src/mcp/composite-tools.js';
import type { ToolContext, ToolDef } from '../../src/tools/defs/types.js';

const envSchema = z
  .object({
    project_id: z.string().optional(),
    service_id: z.string().optional(),
    scope: z.enum(['project', 'service']).optional(),
    variables: z.record(z.string(), z.string()),
    defer_redeploy: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.project_id || value.service_id), {
    message: 'target required',
  });

const serviceUpdateSchema = z
  .object({
    service_id: z.string(),
    env_vars: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const routeSchema = z
  .object({
    service_id: z.string(),
    container_port: z.number(),
  })
  .strict();

function toolDef(name: string, schema: z.ZodType, execute = vi.fn(async () => ({ status: 'ok' }))) {
  return {
    name,
    riskLevel: 'low',
    description: `${name} test def`,
    inputSchema: schema,
    execute,
  } satisfies ToolDef;
}

function pending(field = 'EXCHANGE_API_URL') {
  return {
    id: 'pending-1',
    project_id: 'project-1',
    service_id: 'svc-1',
    briefing_id: 'brief-1',
    field,
    reason: `${field} is unreachable`,
    source_required: 'user',
    status: 'pending',
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z',
    resolved_at: null,
  };
}

function context(overrides?: {
  servicePending?: ReturnType<typeof pending>[];
  projectPending?: ReturnType<typeof pending>[];
}): ToolContext {
  const service = {
    id: 'svc-1',
    project_id: 'project-1',
    name: 'api',
    kind: 'git',
  };
  const appCtx = {
    db: {
      getService: vi.fn(async (id: string) => (id === service.id ? service : null)),
      listPendingAiOpsInputsForServiceKeys: vi.fn(async () => overrides?.servicePending ?? []),
      listPendingAiOpsInputsForProjectKeys: vi.fn(async () => overrides?.projectPending ?? []),
    },
  } as unknown as AppContext;
  return { target: 'mcp', appCtx };
}

describe('pending user input MCP mutation gate', () => {
  it('blocks service-scoped set_env_vars for a pending user-owned field', async () => {
    const execute = vi.fn(async () => ({ status: 'updated' }));
    const tool = createOpenLanderServiceCompositeTool([
      toolDef('set_env_vars', envSchema, execute),
    ]);

    const result = (await tool.execute(
      {
        action: 'set_env_vars',
        params: {
          service_id: 'svc-1',
          variables: { EXCHANGE_API_URL: 'https://guessed.example.com' },
        },
      },
      context({ servicePending: [pending()] }),
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'USER_INPUT_REQUIRED',
      blocked_action: 'set_env_vars',
      field: 'EXCHANGE_API_URL',
      service_id: 'svc-1',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks project-scoped set_env_vars when any service in the project is awaiting the field', async () => {
    const execute = vi.fn(async () => ({ status: 'updated' }));
    const tool = createOpenLanderProjectCompositeTool([
      toolDef('set_env_vars', envSchema, execute),
    ]);

    const result = (await tool.execute(
      {
        action: 'set_env_vars',
        params: {
          project_id: 'project-1',
          scope: 'project',
          variables: { EXCHANGE_API_URL: 'https://guessed.example.com' },
        },
      },
      context({ projectPending: [pending()] }),
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'USER_INPUT_REQUIRED',
      blocked_action: 'set_env_vars',
      field: 'EXCHANGE_API_URL',
      project_id: 'project-1',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows unrelated env mutations while pending input exists', async () => {
    const execute = vi.fn(async () => ({ status: 'updated' }));
    const tool = createOpenLanderServiceCompositeTool([
      toolDef('set_env_vars', envSchema, execute),
    ]);

    const result = (await tool.execute(
      {
        action: 'set_env_vars',
        params: {
          service_id: 'svc-1',
          variables: { UNRELATED_KEY: 'ok' },
        },
      },
      context({ servicePending: [] }),
    )) as Record<string, unknown>;

    expect(result).toEqual({ status: 'updated' });
    expect(execute).toHaveBeenCalled();
  });

  it.each(['update_app', 'redeploy_app'])(
    'blocks %s inline env_vars for a pending field before execution',
    async (action) => {
      const execute = vi.fn(async () => ({ status: 'started' }));
      const tool = createOpenLanderServiceCompositeTool([
        toolDef(action, serviceUpdateSchema, execute),
      ]);

      const result = (await tool.execute(
        {
          action,
          params: {
            service_id: 'svc-1',
            env_vars: { EXCHANGE_API_URL: 'https://guessed.example.com' },
          },
        },
        context({ servicePending: [pending()] }),
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        status: 'blocked',
        code: 'USER_INPUT_REQUIRED',
        blocked_action: action,
        field: 'EXCHANGE_API_URL',
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('does not block route-only repair actions while pending input exists', async () => {
    const execute = vi.fn(async () => ({ status: 'route_updated' }));
    const tool = createOpenLanderServiceCompositeTool([
      toolDef('apply_route_config', routeSchema, execute),
    ]);

    const result = (await tool.execute(
      {
        action: 'apply_route_config',
        params: { service_id: 'svc-1', container_port: 4000 },
      },
      context({ servicePending: [pending()] }),
    )) as Record<string, unknown>;

    expect(result).toEqual({ status: 'route_updated' });
    expect(execute).toHaveBeenCalled();
  });
});
