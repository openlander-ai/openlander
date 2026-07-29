import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ApplicationOperationInvocationRow } from '../../src/db/schema.drizzle.js';
import { createApplicationOperationRegistry } from '../../src/operations/index.js';
import {
  agentDeliveryToolDefs,
  projectManifestToolDefs,
} from '../../src/tools/defs/agent-delivery.js';
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
  const registeredServices: Array<{
    id: string;
    source: 'git';
    repo_url: string;
    branch: string;
  }> = [];
  const projectUpdate = {
    id: 'pupd_operation-1',
    project_id: delivery.project_id,
    delivery_id: null,
    summary: 'Customer meeting clarified the SI dependency.',
    occurred_at: now,
    sources: [{ source_type: 'meeting', label: '7/29 customer meeting' }],
    created_by: 'project-agent',
    created_at: now,
  };
  const projectUpdateItem = {
    id: 'pui-question',
    project_update_id: projectUpdate.id,
    kind: 'question',
    title: 'Confirm the SI API contract',
    detail: 'The payload and authentication method are not fixed.',
    status: 'open',
    resolution_update_id: null,
    resolution_note: null,
    resolved_at: null,
    created_at: now,
    updated_at: now,
  };
  const reviewStatus = {
    project_id: delivery.project_id,
    delivery_id: delivery.id,
    gate_key: 'change-review',
    state: 'pending' as const,
    ready_for_next_step: false,
    artifact: {
      id: 'artifact-review',
      logical_key: 'change-plan',
      revision: 1,
      sha256: 'b'.repeat(64),
      status: 'draft' as const,
      is_latest_revision: true,
    },
    gate: {
      status: 'pending' as const,
      required: true,
      recorded_by: 'project-agent',
      recorded_at: now,
      waiver_reason: null,
    },
    approval_evidence_id: null,
    blockers: ['artifact_not_approved' as const, 'gate_pending' as const],
  };
  const acceptedReviewStatus = {
    ...reviewStatus,
    state: 'accepted' as const,
    ready_for_next_step: true,
    artifact: { ...reviewStatus.artifact, status: 'approved' as const },
    gate: { ...reviewStatus.gate, status: 'passed' as const, recorded_by: 'web-session' },
    blockers: [],
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
    getProject: vi.fn(async (id: string) =>
      id === delivery.project_id ? { id, archived_at: null } : null,
    ),
    getArtifactProjectRowsByIds: vi.fn(async () => []),
    recordProjectUpdate: vi.fn(async () => ({
      update: projectUpdate,
      items: [projectUpdateItem],
      transitionedItemIds: [],
      affectedDeliveryIds: [],
    })),
    getProjectUpdateContext: vi.fn(async () => ({
      counts: { 'question:open': 1 },
      currentItems: [
        {
          item: projectUpdateItem,
          update: {
            id: projectUpdate.id,
            summary: projectUpdate.summary,
            occurred_at: projectUpdate.occurred_at,
            created_by: projectUpdate.created_by,
          },
          deliveryIds: [],
        },
      ],
      currentItemsTruncated: false,
      recentUpdates: [{ ...projectUpdate, itemCount: 1 }],
      recentUpdatesTruncated: false,
      changedDeliveryContext: [],
      changedDeliveryContextTruncated: false,
    })),
    getProjectUpdateDetail: vi.fn(async () => ({
      update: projectUpdate,
      items: [projectUpdateItem],
      transitionedItems: [],
      deliveryIdsByItem: new Map<string, string[]>(),
    })),
    getDeployablesByGroup: vi.fn(async () => registeredServices),
    ensureDeployableServiceForProject: vi.fn(
      async (projectId: string, input: { source: 'git'; repoUrl: string; branch: string }) => {
        const service = {
          id: `${projectId}__svc`,
          source: input.source,
          repo_url: input.repoUrl,
          branch: input.branch,
        };
        registeredServices.push(service);
        return service;
      },
    ),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const deliveryService = {
    createDelivery: vi.fn(async (input: { id: string }) => ({ ...delivery, id: input.id })),
    assertProjectCanMutate: vi.fn(async () => undefined),
    requestReview: vi.fn(async () => reviewStatus),
    getReviewStatus: vi.fn(async () => reviewStatus),
    acceptReview: vi.fn(async () => acceptedReviewStatus),
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
  const packageRow = {
    id: 'package-review-1',
    delivery_id: delivery.id,
    revision: 4,
    status: 'draft' as const,
    manifest_sha256: 'd'.repeat(64),
    base_evidence_version: 7,
    source_run_id: null,
    review_gate_key: 'change-review',
    review_note: 'Review together',
    overview_mode: 'keep' as const,
    overview_patch: null,
    overview_keep_reason: 'Still current',
    overview_before_sha256: 'e'.repeat(64),
    overview_after_sha256: 'e'.repeat(64),
    expires_at: '2026-08-04T00:00:00.000Z',
    published_at: null,
    created_by: 'project-agent',
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
  };
  const packageItem = {
    id: 'package-item-pdf',
    package_id: packageRow.id,
    role: 'review_document' as const,
    filename: 'review.pdf',
    expected_sha256: 'f'.repeat(64),
    expected_size_bytes: 1024,
    expected_mime_type: 'application/pdf',
    required: true,
    blob_id: 'blob-review-pdf',
    artifact_id: 'artifact-review',
    status: 'uploaded' as const,
    attempt_count: 1,
    actual_sha256: 'f'.repeat(64),
    actual_size_bytes: 1024,
    actual_mime_type: 'application/pdf',
    last_error_code: null,
    last_error_details: null,
    uploaded_at: '2026-07-28T00:01:00.000Z',
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:01:00.000Z',
  };
  const packageBlob = {
    id: 'blob-review-pdf',
    sha256: packageItem.expected_sha256,
    mime_type: 'application/pdf',
    size_bytes: 1024,
    storage_key: `sha256/ff/${packageItem.expected_sha256}`,
    created_at: '2026-07-28T00:01:00.000Z',
  };
  const packageArtifact = {
    id: 'artifact-review',
    delivery_id: delivery.id,
    blob_id: packageBlob.id,
    logical_key: 'customer-review-package',
    revision: 4,
    kind: 'companion_pdf' as const,
    original_filename: 'review.pdf',
    status: 'draft' as const,
    companion_pdf_artifact_id: null,
    include_in_receipt: true,
    receipt_order: 10,
    idempotency_key: `review-package:${packageRow.id}:review_document`,
    created_at: '2026-07-28T00:01:00.000Z',
    updated_at: '2026-07-28T00:01:00.000Z',
  };
  const packageDetail = {
    package: packageRow,
    delivery: { ...delivery, evidence_version: 7 },
    items: [{ item: packageItem, blob: packageBlob, artifact: packageArtifact }],
    gate: {
      id: 'gate-review',
      delivery_id: delivery.id,
      gate_key: 'change-review',
      source: 'manual' as const,
      definition_sha256: null,
      gate_type: 'review' as const,
      label: 'Review',
      required: true,
      status: 'pending' as const,
      summary: null,
      waiver_reason: null,
      warning_accepted: false,
      report_artifact_id: 'artifact-review',
      review_package_id: packageRow.id,
      idempotency_key: null,
      recorded_by: 'project-agent',
      recorded_at: null,
      created_at: '2026-07-28T00:00:00.000Z',
      updated_at: '2026-07-28T00:00:00.000Z',
    },
  };
  const deliveryReviewPackageService = {
    prepare: vi.fn(async () => packageDetail),
    getStatus: vi.fn(async () => ({
      selected: packageDetail,
      draft: packageRow,
      current: null,
      previous: null,
      blockers: [],
      missing_roles: [],
      upload_capabilities: [],
    })),
    publish: vi.fn(async () => ({
      ...packageDetail,
      package: { ...packageRow, status: 'published' as const },
      primaryArtifact: packageArtifact,
      artifacts: [packageArtifact],
    })),
  };
  Object.assign(db, {
    getDeliveryReviewPackage: vi.fn(async () => packageDetail),
  });
  const operations = createApplicationOperationRegistry();
  const ctx = {
    config: { mcp: { instanceId: 'olinst_test' } },
    db,
    deliveryService,
    deliveryAgentRunService,
    deliveryQualityGateService,
    deliveryReviewPackageService,
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
    deliveryReviewPackageService,
    reviewStatus,
    acceptedReviewStatus,
    projectUpdate,
    projectUpdateItem,
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

  it('records and reads Project context without requiring a Delivery', async () => {
    const harness = createAgentDeliveryHarness();
    const recorded = await harness.operations.execute(
      harness.ctx,
      'record_project_update',
      {
        project_id: harness.delivery.project_id,
        summary: 'Customer meeting clarified the SI dependency.',
        occurred_at: '2026-07-26T00:00:00.000Z',
        sources: [{ source_type: 'meeting', label: '7/29 customer meeting' }],
        entries: [
          {
            kind: 'question',
            title: 'Confirm the SI API contract',
            detail: 'The payload and authentication method are not fixed.',
          },
        ],
      },
      { actor: harness.actor, idempotencyKey: 'project-update-1' },
    );
    expect(recorded.result).toMatchObject({
      status: 'recorded',
      project_id: harness.delivery.project_id,
      delivery_id: null,
      update_id: 'pupd_operation-1',
      entry_count: 1,
      suggested_call: {
        operation: 'get_project_context',
        input: { project_id: harness.delivery.project_id },
      },
    });
    expect(harness.db.recordProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: harness.delivery.project_id,
        deliveryId: null,
        sources: [{ source_type: 'meeting', label: '7/29 customer meeting' }],
        entries: [expect.objectContaining({ kind: 'question', status: 'open' })],
      }),
    );

    const context = await harness.operations.execute(
      harness.ctx,
      'get_project_context',
      { project_id: harness.delivery.project_id },
      { actor: harness.actor },
    );
    expect(context.result).toMatchObject({
      status: 'ok',
      counts: {
        total_by_kind: { question: 1 },
        current_by_kind: { question: 1 },
      },
      current_items: [
        {
          item_id: 'pui-question',
          kind: 'question',
          detail_excerpt: 'The payload and authentication method are not fixed.',
        },
      ],
    });

    const detail = await harness.operations.execute(
      harness.ctx,
      'get_project_update',
      { project_id: harness.delivery.project_id, update_id: harness.projectUpdate.id },
      { actor: harness.actor },
    );
    expect(detail.result).toMatchObject({
      update: {
        update_id: harness.projectUpdate.id,
        sources: harness.projectUpdate.sources,
      },
      entries: [{ item_id: harness.projectUpdateItem.id, status: 'open' }],
    });
  });

  it('reuses the operation timestamp when a committed Project Update is retried', async () => {
    const harness = createAgentDeliveryHarness();
    harness.db.succeedApplicationOperation.mockRejectedValueOnce(
      new Error('simulated invocation persistence failure'),
    );
    const input = {
      project_id: harness.delivery.project_id,
      summary: 'Meeting update without an explicit occurrence timestamp.',
      sources: [{ source_type: 'meeting', label: 'Customer meeting' }],
      entries: [{ kind: 'fact', title: 'Prototype received', detail: 'Ready for review.' }],
    };

    await expect(
      harness.operations.execute(harness.ctx, 'record_project_update', input, {
        actor: harness.actor,
        idempotencyKey: 'project-update-recovery-1',
      }),
    ).rejects.toThrow('simulated invocation persistence failure');
    await expect(
      harness.operations.execute(harness.ctx, 'record_project_update', input, {
        actor: harness.actor,
        idempotencyKey: 'project-update-recovery-1',
      }),
    ).resolves.toMatchObject({ result: { status: 'recorded' } });

    expect(harness.db.recordProjectUpdate).toHaveBeenCalledTimes(2);
    expect(harness.db.recordProjectUpdate.mock.calls[0]?.[0]).toMatchObject({
      occurredAt: '2026-07-26T00:00:00.000Z',
    });
    expect(harness.db.recordProjectUpdate.mock.calls[1]?.[0]).toMatchObject({
      occurredAt: '2026-07-26T00:00:00.000Z',
    });
  });

  it('bounds Project context source labels and Delivery links', async () => {
    const harness = createAgentDeliveryHarness();
    harness.db.getProjectUpdateContext.mockResolvedValueOnce({
      counts: { 'question:open': 1 },
      currentItems: [
        {
          item: harness.projectUpdateItem,
          update: {
            id: harness.projectUpdate.id,
            summary: harness.projectUpdate.summary,
            occurred_at: harness.projectUpdate.occurred_at,
            created_by: harness.projectUpdate.created_by,
          },
          deliveryIds: Array.from({ length: 21 }, (_, index) => `delivery-${String(index + 1)}`),
        },
      ],
      currentItemsTruncated: false,
      recentUpdates: [
        {
          ...harness.projectUpdate,
          sources: Array.from({ length: 6 }, (_, index) => ({
            source_type: 'meeting' as const,
            label: `Source ${String(index + 1)}`,
          })),
          itemCount: 1,
        },
      ],
      recentUpdatesTruncated: false,
      changedDeliveryContext: [],
      changedDeliveryContextTruncated: false,
    });

    const context = await harness.operations.execute(
      harness.ctx,
      'get_project_context',
      { project_id: harness.delivery.project_id },
      { actor: harness.actor },
    );

    expect(context.result['current_items']).toEqual([
      expect.objectContaining({
        related_delivery_ids: expect.any(Array),
        related_delivery_count: 21,
        related_delivery_ids_truncated: true,
      }),
    ]);
    const currentItem = (context.result['current_items'] as Array<Record<string, unknown>>)[0];
    expect(currentItem?.['related_delivery_ids']).toHaveLength(20);
    expect(context.result['recent_updates']).toEqual([
      expect.objectContaining({ source_count: 6, sources_truncated: true }),
    ]);
    const recentUpdate = (context.result['recent_updates'] as Array<Record<string, unknown>>)[0];
    expect(recentUpdate?.['source_labels']).toHaveLength(5);
  });

  it('links selected Project context items while planning a Delivery', async () => {
    const harness = createAgentDeliveryHarness();
    const planned = await harness.operations.execute(
      harness.ctx,
      'plan_delivery',
      {
        project_id: harness.delivery.project_id,
        title: 'SI interface slice',
        objective: 'Implement against a stable mock contract.',
        definition_of_done: ['Contract tests pass'],
        gates: [{ gate_key: 'qa', gate_type: 'qa', label: 'Quality', required: true }],
        source_project_update_item_ids: ['pui-question'],
      },
      { actor: harness.actor, idempotencyKey: 'plan-with-context-1' },
    );
    expect(planned.result).toMatchObject({ source_context_item_count: 1 });
    expect(harness.deliveryService.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ sourceProjectUpdateItemIds: ['pui-question'] }),
    );
  });

  it('rejects unsafe Project Update sources and service-scoped access', async () => {
    const harness = createAgentDeliveryHarness();
    const input = {
      project_id: harness.delivery.project_id,
      summary: 'WBS comparison',
      sources: [{ source_type: 'wbs', label: 'Weekly WBS', locator: '../customer.xlsx' }],
      entries: [{ kind: 'progress', title: 'Compared schedule', detail: 'No material change.' }],
    };
    await expect(
      harness.operations.execute(harness.ctx, 'record_project_update', input, {
        actor: harness.actor,
        idempotencyKey: 'unsafe-source-1',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_SOURCE_INVALID' });
    expect(harness.db.recordProjectUpdate).not.toHaveBeenCalled();

    await expect(
      harness.operations.execute(
        harness.ctx,
        'record_project_update',
        {
          ...input,
          sources: [
            {
              source_type: 'repository',
              label: 'Windows path',
              locator: 'C:\\customer\\requirements.md',
            },
          ],
        },
        { actor: harness.actor, idempotencyKey: 'unsafe-source-windows-path-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_SOURCE_INVALID' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'record_project_update',
        {
          ...input,
          sources: [
            {
              source_type: 'repository',
              label: 'Local requirements URI',
              locator: 'file:docs/requirements.md',
            },
          ],
        },
        { actor: harness.actor, idempotencyKey: 'unsafe-source-uri-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_SOURCE_INVALID' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'record_project_update',
        {
          ...input,
          sources: [
            {
              source_type: 'url',
              label: 'Credential-bearing URL',
              locator: 'https://user:secret@example.com/meeting',
            },
          ],
        },
        { actor: harness.actor, idempotencyKey: 'unsafe-source-url-credentials-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_SOURCE_INVALID' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'record_project_update',
        {
          ...input,
          sources: [
            {
              source_type: 'repository',
              label: 'Requirements',
              locator: 'docs/requirements.md',
              sha256: 'NOT-A-SHA256',
            },
          ],
        },
        { actor: harness.actor, idempotencyKey: 'unsafe-source-sha-1' },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_SOURCE_INVALID' });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'get_project_context',
        { project_id: harness.delivery.project_id },
        {
          actor: {
            source: 'mcp',
            scope: 'service',
            instanceId: 'olinst_test',
            projectId: harness.delivery.project_id,
            serviceId: 'service-1',
            label: 'service-agent',
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
  });

  it('keeps Project context query results aligned across in-process, REST, and MCP', async () => {
    const directHarness = createAgentDeliveryHarness();
    const direct = await directHarness.operations.execute(
      directHarness.ctx,
      'get_project_context',
      { project_id: directHarness.delivery.project_id },
      { actor: directHarness.actor },
    );

    const restHarness = createAgentDeliveryHarness();
    const app = new Hono<{ Variables: { authKind: 'session' | 'api_token' } }>();
    app.use('*', async (c, next) => {
      c.set('authKind', 'session');
      await next();
    });
    app.route('/', createOperationRoutes(restHarness.ctx));
    const restResponse = await app.request('/v1/operations/get_project_context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: restHarness.delivery.project_id }),
    });
    expect(restResponse.status).toBe(200);
    const rest = (await restResponse.json()) as { result: Record<string, unknown> };

    const mcpHarness = createAgentDeliveryHarness();
    const tool = projectManifestToolDefs.find(
      (definition) => definition.name === 'get_project_context',
    );
    const mcp = await tool?.execute(
      { project_id: mcpHarness.delivery.project_id },
      {
        target: 'mcp',
        appCtx: mcpHarness.ctx,
        identity: {
          source: 'mcp',
          mcpScopeKind: 'project',
          mcpScopeProjectId: mcpHarness.delivery.project_id,
        },
      },
    );

    for (const result of [direct.result, rest.result, mcp]) {
      expect(result).toMatchObject({
        status: 'ok',
        project_id: directHarness.delivery.project_id,
        current_items: [{ item_id: 'pui-question', kind: 'question', status: 'open' }],
        truncated: {
          current_items: false,
          recent_updates: false,
          changed_delivery_context: false,
        },
      });
    }
  });

  it('binds and polls an exact Artifact review through the common operation contract', async () => {
    const harness = createAgentDeliveryHarness();
    const requested = await harness.operations.execute(
      harness.ctx,
      'request_delivery_review',
      {
        delivery_id: harness.delivery.id,
        gate_key: 'change-review',
        artifact_id: 'artifact-review',
        expected_sha256: 'b'.repeat(64),
        summary: 'Review the proposed change before applying it.',
      },
      { actor: harness.actor, idempotencyKey: 'review-1' },
    );

    expect(requested.result).toMatchObject({
      status: 'pending_review',
      project_id: harness.delivery.project_id,
      artifact_id: 'artifact-review',
      sha256: 'b'.repeat(64),
      status_call: {
        operation: 'get_delivery_review_status',
        input: { delivery_id: harness.delivery.id, gate_key: 'change-review' },
      },
    });
    expect(harness.deliveryService.requestReview).toHaveBeenCalledWith({
      deliveryId: harness.delivery.id,
      gateKey: 'change-review',
      artifactId: 'artifact-review',
      expectedSha256: 'b'.repeat(64),
      summary: 'Review the proposed change before applying it.',
      idempotencyKey: 'review-request:operation-1',
      actor: 'project-agent',
    });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'get_delivery_review_status',
        { delivery_id: harness.delivery.id, gate_key: 'change-review' },
        { actor: harness.actor },
      ),
    ).resolves.toMatchObject({
      result: {
        status: 'pending',
        ready_for_next_step: false,
        blockers: ['artifact_not_approved', 'gate_pending'],
      },
    });

    const tool = agentDeliveryToolDefs.find(
      (definition) => definition.name === 'get_delivery_review_status',
    );
    expect(tool).toBeDefined();
    await expect(
      tool?.execute(
        { delivery_id: harness.delivery.id, gate_key: 'change-review' },
        {
          target: 'mcp',
          appCtx: harness.ctx,
          identity: {
            source: 'mcp',
            mcpScopeKind: 'project',
            mcpScopeProjectId: harness.delivery.project_id,
          },
        },
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      status_call: {
        tool: 'openlander_project',
        arguments: {
          action: 'get_delivery_review_status',
          params: { delivery_id: harness.delivery.id, gate_key: 'change-review' },
        },
      },
    });

    await expect(
      harness.operations.execute(
        harness.ctx,
        'get_delivery_review_status',
        { delivery_id: harness.delivery.id, gate_key: 'change-review' },
        { actor: { ...harness.actor, projectId: 'sibling-project' } },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
  });

  it('accepts an exact review version only from an authenticated Web session', async () => {
    const harness = createAgentDeliveryHarness();
    const input = {
      delivery_id: harness.delivery.id,
      gate_key: 'change-review',
      artifact_id: 'artifact-review',
      expected_sha256: 'b'.repeat(64),
    };

    await expect(
      harness.operations.execute(harness.ctx, 'accept_delivery_review', input, {
        actor: {
          source: 'rest',
          scope: 'instance',
          instanceId: 'olinst_test',
          label: 'api-token',
        },
        idempotencyKey: 'accept-review-rest',
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_REQUIRES_HUMAN_UI' });
    expect(harness.deliveryService.acceptReview).not.toHaveBeenCalled();

    await expect(
      harness.operations.execute(harness.ctx, 'accept_delivery_review', input, {
        actor: {
          source: 'web',
          scope: 'instance',
          instanceId: 'olinst_test',
          label: 'web-session',
        },
        idempotencyKey: 'accept-review-web',
      }),
    ).resolves.toMatchObject({
      result: {
        status: 'accepted',
        artifact_id: 'artifact-review',
        ready_for_next_step: true,
      },
    });
    expect(harness.deliveryService.acceptReview).toHaveBeenCalledWith({
      deliveryId: harness.delivery.id,
      gateKey: 'change-review',
      artifactId: 'artifact-review',
      expectedSha256: 'b'.repeat(64),
      summary: null,
      actor: 'web-session',
    });
    expect(
      agentDeliveryToolDefs.some((definition) => definition.name === 'accept_delivery_review'),
    ).toBe(false);
  });

  it('registers a repository without deploy and enforces the Project scope boundary', async () => {
    const harness = createAgentDeliveryHarness();
    const input = {
      project_id: harness.delivery.project_id,
      repo_url: 'https://github.com/example/incar-app.git',
      branch: 'codex/admin-collateral-storyboard',
    };

    const registered = await harness.operations.execute(
      harness.ctx,
      'register_project_repository',
      input,
      { actor: harness.actor, idempotencyKey: 'register-repository-1' },
    );
    expect(registered.result).toMatchObject({
      status: 'registered',
      project_id: harness.delivery.project_id,
      service_id: `${harness.delivery.project_id}__svc`,
      repo_url: input.repo_url,
      branch: input.branch,
      suggested_call: {
        operation: 'plan_delivery',
        input: { project_id: harness.delivery.project_id },
      },
    });
    expect(harness.db.ensureDeployableServiceForProject).toHaveBeenCalledWith(
      harness.delivery.project_id,
      { source: 'git', repoUrl: input.repo_url, branch: input.branch },
    );
    expect(harness.db.insertActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'project.repository_registered',
        project_id: harness.delivery.project_id,
      }),
    );

    await expect(
      harness.operations.execute(harness.ctx, 'register_project_repository', input, {
        actor: harness.actor,
        idempotencyKey: 'register-repository-2',
      }),
    ).resolves.toMatchObject({ result: registered.result });
    expect(harness.db.ensureDeployableServiceForProject).toHaveBeenCalledOnce();
    expect(harness.db.insertActivityLog).toHaveBeenCalledOnce();

    const tool = projectManifestToolDefs.find(
      (definition) => definition.name === 'register_project_repository',
    );
    expect(tool).toBeDefined();
    await expect(
      tool?.execute(
        { idempotency_key: 'register-sibling', ...input, project_id: 'sibling-project' },
        {
          target: 'mcp',
          appCtx: harness.ctx,
          identity: {
            source: 'mcp',
            mcpScopeKind: 'project',
            mcpScopeProjectId: harness.delivery.project_id,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(harness.db.ensureDeployableServiceForProject).toHaveBeenCalledOnce();
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

  it('prepares, inspects, and publishes a customer review package through one operation contract', async () => {
    const harness = createAgentDeliveryHarness();
    const prepared = await harness.operations.execute(
      harness.ctx,
      'prepare_delivery_review_package',
      {
        delivery_id: harness.delivery.id,
        gate_key: 'change-review',
        review_note: 'Review together',
        files: [
          {
            role: 'review_document',
            filename: 'review.pdf',
            expected_sha256: 'f'.repeat(64),
            expected_size_bytes: 1024,
            mime_type: 'application/pdf',
          },
        ],
        overview: { mode: 'keep', reason: 'Still current' },
      },
      { actor: harness.actor, idempotencyKey: 'prepare-package-1' },
    );
    expect(prepared.result).toMatchObject({
      status: 'prepared',
      package_id: 'package-review-1',
      revision: 4,
      manifest_sha256: 'd'.repeat(64),
    });
    expect(JSON.stringify(prepared.result)).not.toContain('upload_url');
    await expect(
      harness.operations.execute(
        harness.ctx,
        'prepare_delivery_review_package',
        {
          delivery_id: harness.delivery.id,
          gate_key: 'change-review',
          review_note: 'Review together',
          files: [
            {
              role: 'review_document',
              filename: 'review.pdf',
              expected_sha256: 'f'.repeat(64),
              expected_size_bytes: 1024,
              mime_type: 'application/pdf',
            },
          ],
          overview: { mode: 'keep', reason: 'Still current' },
        },
        { actor: harness.actor, idempotencyKey: 'prepare-package-1' },
      ),
    ).resolves.toMatchObject({ replayed: true, result: prepared.result });
    expect(harness.deliveryReviewPackageService.prepare).toHaveBeenCalledOnce();

    const status = await harness.operations.execute(
      harness.ctx,
      'get_delivery_review_package_status',
      { delivery_id: harness.delivery.id, package_id: 'package-review-1' },
      { actor: harness.actor },
    );
    expect(status).toMatchObject({
      operation_id: null,
      result: {
        status: 'ok',
        files: [{ role: 'review_document', status: 'uploaded' }],
        suggested_call: {
          operation: 'publish_delivery_review_package',
          idempotency_key: `review-package:package-review-1:publish:${'d'.repeat(64)}`,
        },
      },
    });

    const statusTool = agentDeliveryToolDefs.find(
      (definition) => definition.name === 'get_delivery_review_package_status',
    );
    expect(statusTool).toBeDefined();
    await expect(
      statusTool?.execute(
        { delivery_id: harness.delivery.id, package_id: 'package-review-1' },
        {
          target: 'mcp',
          appCtx: harness.ctx,
          identity: {
            source: 'mcp',
            mcpScopeKind: 'project',
            mcpScopeProjectId: harness.delivery.project_id,
          },
        },
      ),
    ).resolves.toMatchObject({
      suggested_call: {
        tool: 'openlander_project',
        arguments: {
          action: 'publish_delivery_review_package',
          params: {
            package_id: 'package-review-1',
            idempotency_key: `review-package:package-review-1:publish:${'d'.repeat(64)}`,
          },
        },
      },
    });

    const published = await harness.operations.execute(
      harness.ctx,
      'publish_delivery_review_package',
      {
        package_id: 'package-review-1',
        expected_manifest_sha256: 'd'.repeat(64),
        expected_delivery_evidence_version: 7,
      },
      { actor: harness.actor, idempotencyKey: 'publish-package-1' },
    );
    expect(published.result).toMatchObject({
      status: 'pending_review',
      package_id: 'package-review-1',
      review_document_artifact_id: 'artifact-review',
      review_document_sha256: 'f'.repeat(64),
    });
    await expect(
      harness.operations.execute(
        harness.ctx,
        'publish_delivery_review_package',
        {
          package_id: 'package-review-1',
          expected_manifest_sha256: 'd'.repeat(64),
          expected_delivery_evidence_version: 7,
        },
        { actor: harness.actor, idempotencyKey: 'publish-package-1' },
      ),
    ).resolves.toMatchObject({ replayed: true, result: published.result });
    expect(harness.deliveryReviewPackageService.publish).toHaveBeenCalledOnce();
  });
});
