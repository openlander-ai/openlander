import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ApplicationOperationInvocationRow } from '../../src/db/schema.drizzle.js';
import { createApplicationOperationRegistry } from '../../src/operations/index.js';
import { agentDeliveryToolDefs } from '../../src/tools/defs/agent-delivery.js';
import { engagementToolDefs } from '../../src/tools/defs/engagement.js';
import { createOperationRoutes } from '../../src/web/api/operation-routes.js';

function createHarness() {
  let invocation: ApplicationOperationInvocationRow | null = null;
  const bootstrap = vi.fn().mockResolvedValue({
    engagement: {
      id: 'eng_operation',
      status: 'active',
      runtime_health: 'unknown',
      project_count: 1,
      delivery_summary: { total: 0 },
      blocker_count: 0,
    },
    project_id: 'prj_operation',
    project_name: 'acme-platform',
  });
  const engagementDetail = {
    id: 'eng_operation',
    status: 'active' as const,
    project_count: 2,
    delivery_summary: { total: 1 },
    blocker_count: 0,
  };
  const linkProject = vi.fn().mockResolvedValue(engagementDetail);
  const unlinkProject = vi.fn().mockResolvedValue({
    ...engagementDetail,
    project_count: 1,
  });
  const archive = vi.fn().mockResolvedValue({ ...engagementDetail, status: 'archived' as const });
  const unarchive = vi.fn().mockResolvedValue(engagementDetail);
  const db = {
    claimApplicationOperation: vi.fn(
      async (input: {
        operationName: string;
        operationVersion: number;
        actorScopeKey: string;
        idempotencyKey: string;
        requestSha256: string;
      }) => {
        if (invocation) return { claimed: false, invocation };
        const now = new Date().toISOString();
        invocation = {
          id: 'operation-1',
          operation_name: input.operationName,
          operation_version: input.operationVersion,
          actor_scope_key: input.actorScopeKey,
          idempotency_key: input.idempotencyKey,
          request_sha256: input.requestSha256,
          status: 'running',
          response_json: null,
          error_json: null,
          created_at: now,
          updated_at: now,
        };
        return { claimed: true, invocation };
      },
    ),
    retryFailedApplicationOperation: vi.fn(async () => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'running', response_json: null, error_json: null };
      return invocation;
    }),
    succeedApplicationOperation: vi.fn(async (_id: string, response: Record<string, unknown>) => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'succeeded', response_json: response };
      return invocation;
    }),
    failApplicationOperation: vi.fn(async (_id: string, error: Record<string, unknown>) => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'failed', error_json: error };
      return invocation;
    }),
    getApplicationOperationById: vi.fn(async (id: string) =>
      invocation?.id === id ? invocation : null,
    ),
  };
  const operations = createApplicationOperationRegistry();
  const ctx = {
    config: { mcp: { instanceId: 'olinst_test' } },
    db,
    engagementService: { bootstrap, linkProject, unlinkProject, archive, unarchive },
    operations,
  } as unknown as AppContext;
  const actor = {
    source: 'rest' as const,
    scope: 'instance' as const,
    instanceId: 'olinst_test',
    label: 'api-token',
  };
  const input = {
    customer_name: 'Acme',
    title: 'Platform rollout',
    project: { name: 'acme-platform' },
  };
  return {
    ctx,
    operations,
    actor,
    input,
    bootstrap,
    linkProject,
    unlinkProject,
    archive,
    unarchive,
    db,
  };
}

function createAgentDeliveryHarness() {
  const invocations = new Map<string, ApplicationOperationInvocationRow>();
  let operationSequence = 0;
  const now = '2026-07-26T00:00:00.000Z';
  const delivery = {
    id: 'delivery-agent',
    project_id: 'project-agent',
    status: 'draft',
    manifest_path: '.openlander/delivery.yml',
    auto_finalize: true,
  };
  let run = {
    id: 'run-agent',
    delivery_id: delivery.id,
    status: 'running',
    current_phase: 'planning',
    commit_sha: 'a'.repeat(40),
    manifest_sha256: 'a'.repeat(64),
  };
  const operationKey = (input: {
    operationName: string;
    operationVersion: number;
    actorScopeKey: string;
    idempotencyKey: string;
  }) =>
    [input.operationName, input.operationVersion, input.actorScopeKey, input.idempotencyKey].join(
      ':',
    );
  const db = {
    claimApplicationOperation: vi.fn(
      async (input: {
        operationName: string;
        operationVersion: number;
        actorScopeKey: string;
        idempotencyKey: string;
        requestSha256: string;
      }) => {
        const key = operationKey(input);
        const existing = invocations.get(key);
        if (existing) return { claimed: false, invocation: existing };
        operationSequence += 1;
        const invocation: ApplicationOperationInvocationRow = {
          id: `operation-${operationSequence}`,
          operation_name: input.operationName,
          operation_version: input.operationVersion,
          actor_scope_key: input.actorScopeKey,
          idempotency_key: input.idempotencyKey,
          request_sha256: input.requestSha256,
          status: 'running',
          response_json: null,
          error_json: null,
          created_at: now,
          updated_at: now,
        };
        invocations.set(key, invocation);
        return { claimed: true, invocation };
      },
    ),
    retryFailedApplicationOperation: vi.fn(async (id: string) => {
      const entry = [...invocations.entries()].find(([, value]) => value.id === id);
      if (!entry) throw new Error('missing invocation');
      const invocation = { ...entry[1], status: 'running' as const, error_json: null };
      invocations.set(entry[0], invocation);
      return invocation;
    }),
    succeedApplicationOperation: vi.fn(async (id: string, response: Record<string, unknown>) => {
      const entry = [...invocations.entries()].find(([, value]) => value.id === id);
      if (!entry) throw new Error('missing invocation');
      const invocation = {
        ...entry[1],
        status: 'succeeded' as const,
        response_json: response,
      };
      invocations.set(entry[0], invocation);
      return invocation;
    }),
    failApplicationOperation: vi.fn(async (id: string, error: Record<string, unknown>) => {
      const entry = [...invocations.entries()].find(([, value]) => value.id === id);
      if (!entry) throw new Error('missing invocation');
      const invocation = { ...entry[1], status: 'failed' as const, error_json: error };
      invocations.set(entry[0], invocation);
      return invocation;
    }),
    getApplicationOperationById: vi.fn(async (id: string) =>
      [...invocations.values()].find((invocation) => invocation.id === id),
    ),
    requireDelivery: vi.fn(async (id: string) => {
      if (id !== delivery.id) throw new Error('missing delivery');
      return delivery;
    }),
  };
  const deliveryService = {
    createDelivery: vi.fn(async (input: { id: string }) => ({ ...delivery, id: input.id })),
  };
  const deliveryAgentRunService = {
    start: vi.fn(async (input: { id: string; phase: string }) => {
      run = { ...run, id: input.id, current_phase: input.phase };
      return run;
    }),
    projectIdForRun: vi.fn(async () => delivery.project_id),
    get: vi.fn(async () => ({ run, delivery, events: [], checks: [] })),
    recordProgress: vi.fn(async (input: { phase: string; handoffSummary?: string | null }) => {
      run = {
        ...run,
        status: input.handoffSummary ? 'paused' : 'running',
        current_phase: input.phase,
      };
      return { run, event: { id: 'event-handoff' } };
    }),
    resume: vi.fn(async () => {
      run = { ...run, status: 'running' };
      return run;
    }),
    cancel: vi.fn(async () => {
      run = { ...run, status: 'cancelled' };
      return run;
    }),
  };
  const deliveryQualityGateService = {
    start: vi.fn(async () => undefined),
  };
  const operations = createApplicationOperationRegistry();
  const ctx = {
    config: { mcp: { instanceId: 'olinst_test' } },
    db,
    deliveryService,
    deliveryAgentRunService,
    deliveryQualityGateService,
    operations,
  } as unknown as AppContext;
  const actor = {
    source: 'mcp' as const,
    scope: 'project' as const,
    instanceId: 'olinst_test',
    projectId: delivery.project_id,
    label: 'project-agent',
  };
  return {
    ctx,
    operations,
    actor,
    delivery,
    deliveryService,
    deliveryAgentRunService,
    deliveryQualityGateService,
    db,
  };
}

describe('Application Operation contract', () => {
  it('replays the same command without executing the handler twice', async () => {
    const { ctx, operations, actor, input, bootstrap } = createHarness();

    const first = await operations.execute(ctx, 'bootstrap_engagement', input, {
      actor,
      idempotencyKey: 'brief-1',
    });
    const replay = await operations.execute(ctx, 'bootstrap_engagement', input, {
      actor,
      idempotencyKey: 'brief-1',
    });

    expect(first).toMatchObject({ operation_id: 'operation-1', replayed: false });
    expect(replay).toMatchObject({ operation_id: 'operation-1', replayed: true });
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('rejects idempotency-key reuse with changed input', async () => {
    const { ctx, operations, actor, input } = createHarness();
    await operations.execute(ctx, 'bootstrap_engagement', input, {
      actor,
      idempotencyKey: 'brief-1',
    });

    await expect(
      operations.execute(
        ctx,
        'bootstrap_engagement',
        { ...input, title: 'Changed rollout' },
        { actor, idempotencyKey: 'brief-1' },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_IDEMPOTENCY_CONFLICT' });
  });

  it('rejects project-scoped actors before an Engagement-wide mutation', async () => {
    const { ctx, operations, input, db } = createHarness();
    await expect(
      operations.execute(ctx, 'bootstrap_engagement', input, {
        actor: {
          source: 'mcp',
          scope: 'project',
          instanceId: 'olinst_test',
          projectId: 'project-a',
          label: 'project-agent',
        },
        idempotencyKey: 'brief-1',
      }),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(db.claimApplicationOperation).not.toHaveBeenCalled();
  });

  it('lets a project-scoped Agent link only its own Project', async () => {
    const { ctx, operations, linkProject } = createHarness();
    const actor = {
      source: 'mcp' as const,
      scope: 'project' as const,
      instanceId: 'olinst_test',
      projectId: 'project-a',
      label: 'project-agent',
    };

    const linked = await operations.execute(
      ctx,
      'link_project_to_engagement',
      { engagement_id: 'eng_operation', project_id: 'project-a' },
      { actor, idempotencyKey: 'link-own-project' },
    );
    expect(linked.result).toMatchObject({
      status: 'linked',
      engagement_id: 'eng_operation',
      project_count: 2,
    });
    expect(linkProject).toHaveBeenCalledWith('eng_operation', 'project-a', 'project-agent');
  });

  it('rejects project-scoped Engagement linking for a sibling Project', async () => {
    const { ctx, operations, linkProject, db } = createHarness();

    await expect(
      operations.execute(
        ctx,
        'link_project_to_engagement',
        { engagement_id: 'eng_operation', project_id: 'project-b' },
        {
          actor: {
            source: 'mcp',
            scope: 'project',
            instanceId: 'olinst_test',
            projectId: 'project-a',
            label: 'project-agent',
          },
          idempotencyKey: 'link-sibling-project',
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(linkProject).not.toHaveBeenCalled();
    expect(db.claimApplicationOperation).not.toHaveBeenCalled();
  });

  it('keeps Engagement archive commands at instance or org scope', async () => {
    const { ctx, operations, archive, db } = createHarness();

    await expect(
      operations.execute(
        ctx,
        'archive_engagement',
        { engagement_id: 'eng_operation' },
        {
          actor: {
            source: 'mcp',
            scope: 'project',
            instanceId: 'olinst_test',
            projectId: 'project-a',
            label: 'project-agent',
          },
          idempotencyKey: 'archive-from-project',
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(archive).not.toHaveBeenCalled();
    expect(db.claimApplicationOperation).not.toHaveBeenCalled();
  });

  it('exposes the same operation through REST and MCP adapters', async () => {
    const restHarness = createHarness();
    const app = new Hono<{ Variables: { authKind: 'session' | 'api_token' } }>();
    app.use('*', async (c, next) => {
      c.set('authKind', 'api_token');
      await next();
    });
    app.route('/', createOperationRoutes(restHarness.ctx));

    const restResponse = await app.request('/v1/operations/bootstrap_engagement', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'rest-1' },
      body: JSON.stringify(restHarness.input),
    });
    expect(restResponse.status).toBe(200);
    const restBody = (await restResponse.json()) as Record<string, unknown>;
    expect(restBody).toMatchObject({
      operation: 'bootstrap_engagement',
      status: 'succeeded',
    });

    const mcpHarness = createHarness();
    const tool = engagementToolDefs.find(
      (definition) => definition.name === 'bootstrap_engagement',
    );
    expect(tool).toBeDefined();
    const mcpBody = await tool?.execute(
      { idempotency_key: 'mcp-1', ...mcpHarness.input },
      {
        target: 'mcp',
        appCtx: mcpHarness.ctx,
        identity: { source: 'mcp', mcpScopeKind: 'org' },
      },
    );
    expect(mcpBody).toMatchObject({
      status: 'created',
      engagement_id: 'eng_operation',
      operation_id: 'operation-1',
    });
  });

  it('runs the Agent Delivery plan, pin, handoff, resume, and cancel contract', async () => {
    const harness = createAgentDeliveryHarness();
    const plan = await harness.operations.execute(
      harness.ctx,
      'plan_delivery',
      {
        project_id: harness.delivery.project_id,
        title: 'Evidence-backed release',
        objective: 'Ship a verified release.',
        definition_of_done: ['Focused tests pass', 'Smoke test passes'],
        gates: [{ gate_key: 'qa', gate_type: 'qa', label: 'Quality', required: true }],
      },
      { actor: harness.actor, idempotencyKey: 'plan-1' },
    );
    expect(plan.result).toMatchObject({
      status: 'planned',
      project_id: harness.delivery.project_id,
      manifest_path: '.openlander/delivery.yml',
      gate_count: 1,
    });
    expect(harness.deliveryService.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'del_operation-1',
        gates: [
          expect.objectContaining({
            gate_key: 'qa',
            source: 'manifest',
            definition_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ],
      }),
    );

    const started = await harness.operations.execute(
      harness.ctx,
      'start_delivery_run',
      {
        delivery_id: harness.delivery.id,
        commit_sha: 'a'.repeat(40),
        manifest_path: '.openlander/delivery.yml',
        manifest_sha256: 'a'.repeat(64),
        runner_image: 'node:22',
      },
      { actor: harness.actor, idempotencyKey: 'start-1' },
    );
    expect(started.result).toMatchObject({
      status: 'running',
      run_id: 'run_operation-2',
      commit_sha: 'a'.repeat(40),
      manifest_sha256: 'a'.repeat(64),
    });

    const quality = await harness.operations.execute(
      harness.ctx,
      'run_quality_gates',
      { run_id: 'run_operation-2', check_keys: ['unit'] },
      { actor: harness.actor, idempotencyKey: 'quality-1' },
    );
    expect(quality.result).toMatchObject({
      status: 'running',
      run_id: 'run_operation-2',
      status_call: {
        operation: 'get_delivery_run',
        input: { run_id: 'run_operation-2' },
      },
    });
    expect(harness.deliveryQualityGateService.start).toHaveBeenCalledWith({
      runId: 'run_operation-2',
      checkKeys: ['unit'],
      actor: 'project-agent',
    });

    const handoff = await harness.operations.execute(
      harness.ctx,
      'record_delivery_run_progress',
      {
        run_id: 'run_operation-2',
        phase: 'qa',
        summary: 'Focused tests passed.',
        handoff_summary: 'Continue with scenario QA.',
      },
      { actor: harness.actor, idempotencyKey: 'handoff-1' },
    );
    expect(handoff.result).toMatchObject({ status: 'paused', phase: 'qa' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'get_delivery_run',
        { run_id: 'run_operation-2' },
        {
          actor: { ...harness.actor, projectId: 'sibling-project' },
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'resume_delivery_run',
        { run_id: 'run_operation-2', summary: 'Accepted handoff.' },
        { actor: harness.actor, idempotencyKey: 'resume-1' },
      ),
    ).resolves.toMatchObject({ result: { status: 'running' } });
    await expect(
      harness.operations.execute(
        harness.ctx,
        'cancel_delivery_run',
        { run_id: 'run_operation-2', reason: 'Exercise cancellation path.' },
        { actor: harness.actor, idempotencyKey: 'cancel-1' },
      ),
    ).resolves.toMatchObject({ result: { status: 'cancelled' } });
  });

  it('maps interface-neutral Agent Delivery call links into MCP composite calls', async () => {
    const harness = createAgentDeliveryHarness();
    const tool = agentDeliveryToolDefs.find((definition) => definition.name === 'plan_delivery');
    expect(tool).toBeDefined();
    const result = await tool?.execute(
      {
        idempotency_key: 'plan-mcp-1',
        project_id: harness.delivery.project_id,
        title: 'MCP release',
        objective: 'Prove the common operation adapter.',
        definition_of_done: ['Contract passes'],
        gates: [{ gate_key: 'qa', gate_type: 'qa', label: 'Quality', required: true }],
      },
      {
        target: 'mcp',
        appCtx: harness.ctx,
        identity: {
          source: 'mcp',
          mcpScopeKind: 'project',
          mcpScopeProjectId: harness.delivery.project_id,
        },
      },
    );
    expect(result).toMatchObject({
      status: 'planned',
      suggested_call: {
        tool: 'openlander_project',
        arguments: {
          action: 'start_delivery_run',
          params: { delivery_id: 'del_operation-1' },
        },
      },
      operation_id: 'operation-1',
    });
  });
});
