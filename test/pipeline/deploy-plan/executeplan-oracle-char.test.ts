import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/clone', commitSha: 'sha' }),
}));

import { PlanEngine } from '../../../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../../../src/pipeline/deploy-plan/engine.js';
import { createMockDeployPlan } from '../../helpers/deploy-plan-mocks.js';

// ---------------------------------------------------------------------------
// executePlan Behavior Oracle — characterization tests.
//
// Companion to openlander-internal planning doc 06 (Execution Sequencing &
// Behavior Oracle). These tests PIN the current observable behavior of
// PlanEngine.executePlan so the upcoming PlanEngine phase split (refactor
// target #3) can be proven behavior-preserving. Every assertion here is a
// snapshot of CURRENT behavior on origin/main, not a desired future contract.
//
// Coverage maps to the Oracle labels in doc 06:
//   G1-G3  entry guards (throw, in order)
//   B1-B3  pre-execution branches (ZERO persisted mutation / side effect)
//   C2     commit point (first persisted write = updateDeployPlan(executing))
//   P1-P5  provisioning loop
//   T1-T3  terminal states
//   I1-I6  invariants
// Plus the Agent Call-Order Permutation Matrix rows that this layer can drive.
//
// The harness uses pure vi.fn() mocks for db / pipeline / serviceManager /
// docker / events — identical in spirit to test/deploy-plan-engine.test.ts —
// so it runs without a Postgres harness.
// ---------------------------------------------------------------------------

const SAFE_PG_PROPOSAL = {
  type: 'postgresql' as const,
  action: 'create' as const,
  connect_via: 'DATABASE_URL',
  resolution: 'proposed_project_service' as const,
  approval: 'safe_resource' as const,
  reason: 'pg',
};

function buildEngine() {
  const mockDb = {
    createDeployPlan: vi.fn(),
    getDeployPlan: vi.fn(),
    updateDeployPlan: vi.fn().mockResolvedValue(undefined),
    listServices: vi.fn().mockReturnValue([]),
    getProject: vi.fn((id: string) => (id === 'p1' ? { id: 'p1', name: 'test-app' } : null)),
    getProjectByName: vi.fn().mockReturnValue(null),
    getService: vi.fn().mockReturnValue(null),
    getLastDeployLog: vi.fn().mockReturnValue(null),
    attachServiceToProject: vi.fn().mockResolvedValue({
      sourceProjectId: 'p1',
      targetProjectId: 'p1',
      droppedEnvVarKeys: [],
      droppedSecretFiles: [],
    }),
    upsertServiceConnection: vi.fn().mockResolvedValue(undefined),
    getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
    listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
    getDeployableForProject: vi.fn().mockResolvedValue(null),
    createProjectDependency: vi.fn().mockResolvedValue(undefined),
    acquireDeployLock: vi.fn().mockResolvedValue(true),
    getDeployLockInfo: vi.fn().mockResolvedValue(null),
    releaseDeployLock: vi.fn().mockResolvedValue(undefined),
    recordDeployPlanApproval: vi.fn().mockResolvedValue('audit-run-1'),
  };

  const mockPipeline = {
    startDeploy: vi
      .fn()
      .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
    startMonorepoDeploy: vi
      .fn()
      .mockResolvedValue({ parentProjectId: 'p1', parentName: 'test-app', status: 'building' }),
  };

  const mockEnv = {
    getAll: vi.fn().mockReturnValue({}),
    getGlobalSecrets: vi.fn().mockReturnValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  };

  const mockServiceManager = {
    create: vi.fn().mockResolvedValue({
      id: 'svc-pg-1',
      name: 'test-app-postgresql',
      kind: 'postgres',
      container_name: 'ol-svc-test-app-postgresql',
    }),
    getSuggestedEnv: vi
      .fn()
      .mockResolvedValue([{ key: 'DATABASE_URL', value: 'postgres://provisioned/db' }]),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const mockDocker = {
    ensureProjectNetwork: vi.fn().mockResolvedValue('ol-test-app-net'),
  };

  const mockEvents = {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  };

  const deps: PlanEngineDeps = {
    db: mockDb,
    pipeline: mockPipeline,
    env: mockEnv,
    serviceManager: mockServiceManager,
    autoDetector: {},
    config: {},
    events: mockEvents,
    docker: mockDocker,
  } as unknown as PlanEngineDeps;

  return {
    engine: new PlanEngine(deps),
    mockDb,
    mockPipeline,
    mockServiceManager,
    mockDocker,
    mockEvents,
  };
}

/** Did executePlan ever persist a given status to the plan row? */
function wrotePlanStatus(
  mockDb: { updateDeployPlan: { mock: { calls: unknown[][] } } },
  status: string,
): boolean {
  return mockDb.updateDeployPlan.mock.calls.some(
    (call) => (call[1] as { status?: string } | undefined)?.status === status,
  );
}

describe('executePlan Oracle — entry guards G1-G3', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('G1: plan not found throws', async () => {
    h.mockDb.getDeployPlan.mockReturnValue(null);
    await expect(h.engine.executePlan('plan_missing')).rejects.toThrow(
      'Plan not found: plan_missing',
    );
  });

  it('G2: a status outside {ready, needs_approval} throws "only ready plans"', async () => {
    for (const status of ['executing', 'completed', 'failed', 'rolled_back'] as const) {
      const plan = createMockDeployPlan({ status });
      h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
      await expect(h.engine.executePlan(plan.plan_id)).rejects.toThrow(
        `Plan status is "${status}" — only "ready" plans can be executed.`,
      );
    }
  });

  it('G2 ordering: needs_input throws the missing-env message (its own guard), before the ready check', async () => {
    const plan = createMockDeployPlan({ status: 'needs_input', missing: ['DATABASE_URL'] });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    await expect(h.engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Plan requires missing environment variables: DATABASE_URL',
    );
  });

  it('G3: an invalid project name throws and never persists executing', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      app: {
        name: 'Bad_Name',
        source: { repo_url: 'https://github.com/test/repo', branch: 'main', commit_sha: 'abc' },
      },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    await expect(h.engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Invalid project name "Bad_Name"',
    );
    expect(wrotePlanStatus(h.mockDb, 'executing')).toBe(false);
  });

  it('G3 runs AFTER the approval branch: an unapproved needs_approval plan returns before the name check', async () => {
    // Even with an invalid name, an unapproved needs_approval plan returns the
    // structured approval response (the approval branch precedes the G3 throw).
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      app: {
        name: 'Bad_Name',
        source: { repo_url: 'https://github.com/test/repo', branch: 'main', commit_sha: 'abc' },
      },
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    const result = await h.engine.executePlan(plan.plan_id);
    expect(result.status).toBe('needs_approval');
  });
});

describe('executePlan Oracle — pre-execution branches B1-B3 (zero persisted mutation)', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('B1: needs_approval + unapproved → structured needs_approval, creates nothing, writes nothing', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('needs_approval');
    expect(result.approval_required).toEqual({ create_resources: ['postgresql'] });
    expect(result._agent_guidance).toBeDefined();
    // I1: zero persisted state.
    expect(h.mockDb.updateDeployPlan).not.toHaveBeenCalled();
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockDb.upsertServiceConnection).not.toHaveBeenCalled();
    expect(h.mockDb.attachServiceToProject).not.toHaveBeenCalled();
    expect(h.mockPipeline.startDeploy).not.toHaveBeenCalled();
    expect(h.mockDb.recordDeployPlanApproval).not.toHaveBeenCalled();
  });

  it('B2: attach target exists + app name collides with an existing group → failed, target_project_id, no write', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      execution: { targetProjectId: 'target' },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    // The new deployable's app name (test-app) collides with an existing group.
    h.mockDb.getProjectByName.mockImplementation((name: string) =>
      name === 'test-app' ? { id: 'existing', name: 'test-app' } : null,
    );

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.target_project_id).toBe('target');
    expect(result.error).toContain('collides with an existing project group');
    // I1: zero persisted state — collision is detected before the commit point.
    expect(wrotePlanStatus(h.mockDb, 'executing')).toBe(false);
    expect(h.mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  it('B3: approved managed-create + no target project (new app) → needs_target_project, creates nothing', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: undefined,
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getProjectByName.mockReturnValue(null);

    const result = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('needs_target_project');
    expect(result.approval_required).toEqual({ create_resources: ['postgresql'] });
    expect(result._agent_guidance?.next_steps.join('\n')).toContain('create_project');
    // I1: nothing created, nothing persisted.
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockDb.upsertServiceConnection).not.toHaveBeenCalled();
    expect(h.mockDb.attachServiceToProject).not.toHaveBeenCalled();
    expect(h.mockPipeline.startDeploy).not.toHaveBeenCalled();
    expect(wrotePlanStatus(h.mockDb, 'executing')).toBe(false);
    expect(h.mockDb.recordDeployPlanApproval).not.toHaveBeenCalled();
  });
});

describe('executePlan Oracle — commit point C2', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('C2: updateDeployPlan(executing) is the FIRST persisted write, before any provisioning or deploy', async () => {
    const plan = createMockDeployPlan({ status: 'ready' });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    h.mockPipeline.startDeploy.mockImplementation(async () => {
      // By the time the deploy starts, executing must already be persisted.
      expect(wrotePlanStatus(h.mockDb, 'executing')).toBe(true);
      return { status: 'building', projectId: 'p1', projectName: 'test-app' };
    });

    await h.engine.executePlan(plan.plan_id);

    // The first updateDeployPlan call writes executing (no earlier ready write).
    expect(h.mockDb.updateDeployPlan.mock.calls[0][1]).toMatchObject({ status: 'executing' });
  });

  it('I2/I3: ready is never persisted, and nothing provisions before the executing write', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    // Capture mock ordering: provisioning (serviceManager.create) must not fire
    // before the executing write.
    let executingWrittenBeforeProvision = false;
    h.mockServiceManager.create.mockImplementation(async () => {
      executingWrittenBeforeProvision = wrotePlanStatus(h.mockDb, 'executing');
      return {
        id: 'svc-pg-1',
        name: 'test-app-postgresql',
        kind: 'postgres',
        container_name: 'ol-svc-test-app-postgresql',
      };
    });

    await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(wrotePlanStatus(h.mockDb, 'ready')).toBe(false);
    expect(executingWrittenBeforeProvision).toBe(true);
  });
});

describe('executePlan Oracle — provisioning loop P1-P5', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('P1: create + approved-safe + target project → provisions and merges the env value', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('building');
    expect(h.mockServiceManager.create).toHaveBeenCalledTimes(1);
    expect(h.mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({ DATABASE_URL: 'postgres://provisioned/db' }),
      }),
    );
  });

  it('P2: create + non-safe (unapproved/compose/not_auto_creatable) throws ServiceConfigError, provisions nothing, ends failed (post-commit)', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [{ type: 'postgresql', action: 'create', connect_via: 'DATABASE_URL' }],
      env: { auto: {}, required: ['DATABASE_URL'], provided: {}, detected: [] },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('requires an explicit DATABASE_URL value');
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockPipeline.startDeploy).not.toHaveBeenCalled();
    // I5: the throw is post-commit, so the plan persists failed (executing was
    // already written).
    expect(wrotePlanStatus(h.mockDb, 'executing')).toBe(true);
    expect(wrotePlanStatus(h.mockDb, 'failed')).toBe(true);
  });

  it('P4: reuse + target project → resolves reusable service + upserts a connection row (idempotent backfill)', async () => {
    const reusableService = {
      id: 'reuse-pg-1',
      name: 'existing-postgres',
      project_id: 'p1',
      kind: 'postgres',
      credentials: JSON.stringify({ connectionString: 'postgres://reused-host/db' }),
    };
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          service_id: reusableService.id,
          name: reusableService.name,
          connect_via: 'DATABASE_URL',
          resolution: 'existing_project_service',
          approval: 'safe_resource',
          reason: 'pg',
        },
      ],
      env: { auto: {}, required: [], provided: {}, detected: [] },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getService.mockReturnValue(reusableService);
    h.mockDb.listServices.mockReturnValue([reusableService]);

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockDb.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: reusableService.id,
    });
    expect(h.mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({ DATABASE_URL: 'postgres://reused-host/db' }),
      }),
    );
  });

  it('P5: reuse + no target project throws, ends failed', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: undefined,
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          name: 'existing-postgres',
          connect_via: 'DATABASE_URL',
          resolution: 'existing_project_service',
          approval: 'safe_resource',
          reason: 'pg',
        },
      ],
      env: { auto: {}, required: [], provided: {}, detected: [] },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getProjectByName.mockReturnValue(null);

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('requires an existing target project');
    expect(h.mockPipeline.startDeploy).not.toHaveBeenCalled();
  });
});

describe('executePlan Oracle — terminal T1-T3 + invariants I4/I6', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('T1/I6: success returns building (async dispatch), NOT completed', async () => {
    const plan = createMockDeployPlan({ status: 'ready' });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(result.project_id).toBe('p1');
    expect(result.estimated_seconds).toBeDefined();
  });

  it('T1 attach response: a target-attach success carries service_id + target_project_id + runtime_project_id', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      execution: { targetProjectId: 'target' },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    h.mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'runtime-project',
      projectName: 'new-worker',
    });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result).toMatchObject({
      status: 'building',
      project_id: 'runtime-project',
      runtime_project_id: 'runtime-project',
      target_project_id: 'target',
      service_id: 'runtime-project__svc',
    });
  });

  it('T2: a throw after the commit point transitions to failed and persists failed + errorMessage', async () => {
    const plan = createMockDeployPlan({ status: 'ready' });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockPipeline.startDeploy.mockRejectedValue(new Error('pipeline boom'));

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('pipeline boom');
    const failedCall = h.mockDb.updateDeployPlan.mock.calls.find(
      (call: unknown[]) => (call[1] as { status?: string }).status === 'failed',
    );
    expect(failedCall?.[1]).toMatchObject({ status: 'failed', errorMessage: 'pipeline boom' });
  });

  it('T3: the async completion listener persists completed on deploy:success', async () => {
    const plan = createMockDeployPlan({ status: 'ready' });
    const listeners = new Map<string, (payload: unknown) => void>();
    h.mockEvents.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return vi.fn();
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'p1',
      projectName: 'test-app',
    });

    await h.engine.executePlan(plan.plan_id);
    listeners.get('deploy:success')?.({ projectId: 'p1' });

    await vi.waitFor(() => {
      expect(wrotePlanStatus(h.mockDb, 'completed')).toBe(true);
    });
  });

  it('I4: approved provisioning is idempotent on retry — the connection upsert never throws on the second run', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const first = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });
    const second = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(first.status).toBe('building');
    expect(second.status).toBe('building');
    expect(
      h.mockDb.upsertServiceConnection.mock.results.every(
        (r: { type: string }) => r.type === 'return',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent Call-Order Permutation Matrix (doc 06) — the rows this layer drives.
// Each row asserts a relevant Oracle invariant. DB-only orderings (empty-group
// create_service, list_services) are covered at the linker/route layer.
// ---------------------------------------------------------------------------
describe('executePlan Oracle — call-order permutation matrix', () => {
  let h: ReturnType<typeof buildEngine>;
  beforeEach(() => {
    h = buildEngine();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('New app, no DB: deploy_app alone → one deploy dispatch, no managed provisioning', async () => {
    const plan = createMockDeployPlan({ status: 'ready', services: [] });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockPipeline.startDeploy).toHaveBeenCalledTimes(1);
  });

  it('New app + DB, plan-then-approve: unapproved is gated (I1), approved-with-no-project is blocked (B3)', async () => {
    // Unapproved → needs_approval, zero side effects.
    const unapprovedPlan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: undefined,
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(unapprovedPlan) });
    const gated = await h.engine.executePlan(unapprovedPlan.plan_id);
    expect(gated.status).toBe('needs_approval');
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();

    // Approved but new app with no project row → needs_target_project, no __svc
    // consumer synthesized before a workload exists.
    const approved = await h.engine.executePlan(
      unapprovedPlan.plan_id,
      undefined,
      undefined,
      undefined,
      { approveAllSafeResources: true },
    );
    expect(approved.status).toBe('needs_target_project');
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockDb.upsertServiceConnection).not.toHaveBeenCalled();
  });

  it('Add app to existing project: deploy_app(target) on a populated group attaches without a duplicate project', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      execution: { targetProjectId: 'target' },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    h.mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    // No name collision: the new deployable name does not match an existing group.
    h.mockDb.getProjectByName.mockReturnValue(null);
    h.mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'runtime-project',
      projectName: 'test-app',
    });

    const result = await h.engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(result.target_project_id).toBe('target');
    // Attach happens in the async success listener, not synchronously here.
    expect(h.mockPipeline.startDeploy).toHaveBeenCalledTimes(1);
  });

  it('External URL: deploy_app with an explicit DATABASE_URL skips managed provisioning (no resource row)', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: { DATABASE_URL: 'postgres://external-host/db' },
        detected: [],
      },
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('building');
    // Explicit env wins: no managed service is provisioned for the external URL.
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
    expect(h.mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({ DATABASE_URL: 'postgres://external-host/db' }),
      }),
    );
  });

  it('Out-of-order / wrong target: an approved create against a missing project returns guidance, not a synthetic id', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'does-not-exist',
      services: [SAFE_PG_PROPOSAL],
    });
    h.mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    // project_id resolves to nothing and no project by name.
    h.mockDb.getProject.mockReturnValue(null);
    h.mockDb.getProjectByName.mockReturnValue(null);

    const result = await h.engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('needs_target_project');
    // No synthetic service id is emitted for the unresolved target.
    expect(result.service_id).toBeUndefined();
    expect(h.mockServiceManager.create).not.toHaveBeenCalled();
  });
});
