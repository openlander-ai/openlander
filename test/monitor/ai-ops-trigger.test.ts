import { describe, expect, it, vi } from 'vitest';

import type { Channel } from '../../src/channels/base.js';
import type {
  AiOpsBriefingRow,
  AiOpsProjectPolicyRow,
  DeployLogRow,
  ServiceRow,
} from '../../src/db/types.js';
import type { CreateAiOpsBriefingData } from '../../src/db/repos/ai-ops-briefing.repo.js';
import { EventBus } from '../../src/events/index.js';
import { AiOpsBriefingTrigger } from '../../src/monitor/ai-ops-briefing-trigger.js';

const NOW = new Date('2026-06-11T01:00:00.000Z');

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-1',
    project_id: 'proj-1',
    name: 'api__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'production',
    assigned_port: 3000,
    container_id: 'container-1',
    container_name: 'ol-api',
    container_port: 3000,
    image_tag: 'api:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/acme/api',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    recovering_started_at: null,
    credentials: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makePolicy(overrides: Partial<AiOpsProjectPolicyRow> = {}): AiOpsProjectPolicyRow {
  return {
    project_id: 'proj-1',
    mode: 'briefing',
    daily_briefing_limit: 20,
    fingerprint_cooldown_minutes: 30,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function makeDeployLog(overrides: Partial<DeployLogRow> = {}): DeployLogRow {
  return {
    id: 'deploy-1',
    service_id: 'svc-1',
    environment_id: null,
    status: 'failed',
    trigger: 'api',
    trigger_detail: null,
    commit_sha: 'abc123',
    commit_message: null,
    build_log: 'build failed',
    runtime_log: null,
    representative_traffic_json: null,
    duration_ms: 1000,
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

function makeBriefing(input: {
  projectId: string;
  serviceId?: string | null;
  dedupeKey?: string | null;
  fingerprint: string;
  classification: string;
  severity: AiOpsBriefingRow['severity'];
  title: string;
  deterministicSummary: string;
  suggestedCall?: unknown;
  evidence: unknown;
}): AiOpsBriefingRow {
  return {
    id: 'brief-1',
    project_id: input.projectId,
    service_id: input.serviceId ?? null,
    dedupe_key: input.dedupeKey ?? null,
    fingerprint: input.fingerprint,
    classification: input.classification,
    severity: input.severity,
    title: input.title,
    deterministic_summary: input.deterministicSummary,
    llm_summary: null,
    llm_summary_status: null,
    llm_summary_finish_reason: null,
    llm_summary_truncated: null,
    llm_summary_error: null,
    llm_summary_usage_json: null,
    suggested_call_json: input.suggestedCall ? JSON.stringify(input.suggestedCall) : null,
    evidence_json: JSON.stringify(input.evidence),
    status: 'open',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    server_id: 'local',
  };
}

function makeChannel() {
  return {
    isConnected: vi.fn(() => true),
    sendMessage: vi.fn(async () => 'tg-1'),
  } as unknown as Channel;
}

function makeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    getDeployableForProject: vi.fn(async () => makeService()),
    getLastDeployLogForService: vi.fn(async () => makeDeployLog()),
    resolveAiOpsServicePolicy: vi.fn(async () => ({ mode: 'briefing', source: 'project' })),
    getAiOpsProjectPolicy: vi.fn(async () => makePolicy()),
    getAiOpsBriefingBudgetStatus: vi.fn(async () => ({
      projectUsed: 0,
      projectLimit: 20,
      instanceUsed: 0,
      instanceLimit: 200,
      decision: {
        llmSummaryAllowed: true,
        deterministicBriefingAllowed: true,
        reason: 'allowed',
      },
    })),
    claimAiOpsDedupeWindow: vi.fn(async () => ({
      status: 'created',
      dedupe: { id: 'dedupe-1' },
    })),
    attachAiOpsDedupeBriefing: vi.fn(async () => undefined),
    createAiOpsBriefing: vi.fn(async (input: CreateAiOpsBriefingData) =>
      makeBriefing({
        projectId: input.projectId,
        serviceId: input.serviceId,
        dedupeKey: input.dedupeKey,
        fingerprint: input.fingerprint,
        classification: input.classification,
        severity: input.severity,
        title: input.title,
        deterministicSummary: input.deterministicSummary,
        suggestedCall: input.suggestedCall,
        evidence: input.evidence,
      }),
    ),
    updateAiOpsBriefingLlmSummary: vi.fn(async () => undefined),
    ...overrides,
  };
  return db;
}

function makeTrigger(
  overrides: {
    db?: ReturnType<typeof makeDb>;
    channel?: Channel;
    config?: { channels: { telegram: { recoveryChannelId: string } } };
    eventBus?: EventBus;
    runtime?: { inspectContainer: ReturnType<typeof vi.fn> };
  } = {},
) {
  const eventBus = overrides.eventBus ?? new EventBus();
  const db = overrides.db ?? makeDb();
  const channel = overrides.channel ?? makeChannel();
  const trigger = new AiOpsBriefingTrigger({
    eventBus,
    db: db as never,
    runtime: overrides.runtime,
    modelRegistry: { getModel: vi.fn(() => null) },
    channelManager: {
      getChannel: vi.fn((type: string) => (type === 'telegram' ? channel : undefined)),
    },
    config: (overrides.config ?? {
      channels: { telegram: { recoveryChannelId: '12345' } },
    }) as never,
    now: () => NOW,
  });
  return { trigger, db, channel, eventBus };
}

describe('AI Ops briefing runtime trigger', () => {
  it('does nothing when Project/Service policy resolves to off', async () => {
    const db = makeDb({
      resolveAiOpsServicePolicy: vi.fn(async () => ({ mode: 'off', source: 'project' })),
    });
    const { trigger, channel } = makeTrigger({ db });

    const result = await trigger.handleHealthDegraded({
      projectId: 'proj-1',
      consecutiveFailures: 3,
      lastError: 'HTTP 502',
    });

    expect(result).toEqual({ status: 'skipped', reason: 'ai_ops_off' });
    expect(db.claimAiOpsDedupeWindow).not.toHaveBeenCalled();
    expect(db.createAiOpsBriefing).not.toHaveBeenCalled();
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('creates deterministic briefings while skipping LLM when budget is exceeded', async () => {
    const db = makeDb({
      getAiOpsBriefingBudgetStatus: vi.fn(async () => ({
        projectUsed: 20,
        projectLimit: 20,
        instanceUsed: 20,
        instanceLimit: 200,
        decision: {
          llmSummaryAllowed: false,
          deterministicBriefingAllowed: true,
          reason: 'project_daily_limit_exceeded',
        },
      })),
    });
    const { trigger, channel } = makeTrigger({ db });

    const result = await trigger.handleHealthDegraded({
      projectId: 'proj-1',
      consecutiveFailures: 3,
      lastError: 'HTTP 502',
    });

    expect(result.status).toBe('created');
    expect(result.llmSummary?.status).toBe('skipped');
    expect(db.claimAiOpsDedupeWindow).toHaveBeenCalledWith({
      projectId: 'proj-1',
      serviceId: 'svc-1',
      fingerprint: 'route:public:502',
      cooldownMinutes: 30,
      now: NOW,
    });
    expect(db.attachAiOpsDedupeBriefing).toHaveBeenCalledWith(
      'proj-1:service:svc-1:route:public:502',
      'brief-1',
    );
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        serviceId: 'svc-1',
        classification: 'route_failure',
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('No automatic remediation was run.'),
    );
    expect(db.claimAiOpsDedupeWindow).toHaveBeenCalledTimes(1);
  });

  it('skips build-only deploy failures unless runtime traffic failed too', async () => {
    const db = makeDb({
      getLastDeployLogForService: vi.fn(async () =>
        makeDeployLog({
          status: 'success',
          build_log: null,
          runtime_log: null,
        }),
      ),
    });
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleDeployFailed({
      projectId: 'proj-1',
      step: 'build',
      error: 'image build failed',
      buildLog: 'npm install failed',
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('deploy_failure_build_only');
    expect(db.createAiOpsBriefing).not.toHaveBeenCalled();
  });

  it('treats runtime deploy failures as failed even when the latest deploy row is stale success', async () => {
    const db = makeDb({
      getLastDeployLogForService: vi.fn(async () =>
        makeDeployLog({
          status: 'success',
          build_log: null,
          runtime_log: null,
        }),
      ),
    });
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleDeployFailed({
      projectId: 'proj-1',
      step: 'startup',
      error: 'image build failed',
      buildLog: 'npm install failed',
    });

    expect(result.status).toBe('created');
    expect(result.deterministic?.classification).toBe('deploy_failed');
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'deploy_failed',
        evidence: expect.objectContaining({
          deployLog: expect.objectContaining({
            status: 'failed',
            buildLogTail: 'npm install failed',
          }),
        }),
      }),
    );
  });

  it('skips user-cancelled deploy failures', async () => {
    const db = makeDb();
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleDeployFailed({
      projectId: 'proj-1',
      step: 'cancelled',
      error: 'Build cancelled by user',
      cancelled: true,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('deploy_failure_cancelled');
    expect(db.getDeployableForProject).not.toHaveBeenCalled();
    expect(db.createAiOpsBriefing).not.toHaveBeenCalled();
  });

  it('keeps failed representative traffic as the deploy failure ticket reason', async () => {
    const db = makeDb({
      getLastDeployLogForService: vi.fn(async () =>
        makeDeployLog({
          status: 'failed',
          build_log: 'build failed',
          representative_traffic_json: JSON.stringify({
            status: 'failed',
            path: '/',
            severity: 'fail',
            status_code: 503,
            attempts: 3,
          }),
        }),
      ),
    });
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleDeployFailed({
      projectId: 'proj-1',
      step: 'build',
      error: 'build failed',
      buildLog: 'build failed',
    });

    expect(result.status).toBe('created');
    expect(result.deterministic?.classification).toBe('traffic_health_mismatch');
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'traffic_health_mismatch',
      }),
    );
  });

  it('uses recent representative traffic evidence before generic route health', async () => {
    const db = makeDb({
      getLastDeployLogForService: vi.fn(async () =>
        makeDeployLog({
          status: 'success',
          representative_traffic_json: JSON.stringify({
            status: 'failed',
            path: '/',
            severity: 'fail',
            status_code: 500,
            attempts: 3,
          }),
        }),
      ),
    });
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleHealthDegraded({
      projectId: 'proj-1',
      consecutiveFailures: 3,
      lastError: 'HTTP 502',
    });

    expect(result.status).toBe('created');
    expect(result.deterministic?.classification).toBe('traffic_health_mismatch');
    expect(db.claimAiOpsDedupeWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: 'traffic:/:500',
      }),
    );
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'traffic_health_mismatch',
        evidence: expect.objectContaining({
          representativeTraffic: expect.objectContaining({
            status: 'failed',
            severity: 'fail',
            status_code: 500,
          }),
        }),
      }),
    );
  });

  it('persists container die name and exit code as structured AI Ops evidence', async () => {
    const db = makeDb();
    const { trigger } = makeTrigger({ db });

    const result = await trigger.handleContainerDie({
      projectId: 'proj-1',
      containerId: 'container-1',
      containerName: 'ol-api',
      exitCode: 137,
    });

    expect(result.status).toBe('created');
    expect(result.deterministic?.classification).toBe('container_exited');
    expect(result.deterministic?.deterministicSummary).toContain('container ol-api');
    expect(result.deterministic?.deterministicSummary).toContain('exit code 137');
    expect(result.deterministic?.deterministicSummary).not.toContain('unknown');
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: 'container_exited',
        evidence: expect.objectContaining({
          container: expect.objectContaining({
            name: 'ol-api',
            exitCode: 137,
          }),
        }),
      }),
    );
  });

  it('skips container die events when Docker reports the same container already running again', async () => {
    const db = makeDb();
    const runtime = {
      inspectContainer: vi.fn(async () => ({
        RestartCount: 1,
        State: {
          Running: true,
          Status: 'running',
          ExitCode: 0,
        },
      })),
    };
    const { trigger } = makeTrigger({ db, runtime });

    const result = await trigger.handleContainerDie({
      projectId: 'proj-1',
      containerId: 'container-1',
      containerName: 'ol-api',
      exitCode: 137,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('container_self_healed');
    expect(runtime.inspectContainer).toHaveBeenCalledWith('container-1');
    expect(db.createAiOpsBriefing).not.toHaveBeenCalled();
  });

  it('uses explicit Docker restart counts when classifying restart loops', async () => {
    const db = makeDb();
    const runtime = {
      inspectContainer: vi.fn(async () => ({
        RestartCount: 4,
        State: {
          Running: false,
          Status: 'exited',
          ExitCode: 1,
        },
      })),
    };
    const { trigger } = makeTrigger({ db, runtime });

    const result = await trigger.handleContainerDie({
      projectId: 'proj-1',
      containerId: 'container-1',
      containerName: 'ol-api',
      exitCode: 1,
    });

    expect(result.status).toBe('created');
    expect(result.deterministic?.classification).toBe('restart_loop');
    expect(result.deterministic?.deterministicSummary).toContain('restart count 4');
  });

  it('suppresses duplicate fingerprints before creating a briefing', async () => {
    const db = makeDb({
      claimAiOpsDedupeWindow: vi.fn(async () => ({
        status: 'suppressed',
        dedupe: { id: 'dedupe-1' },
      })),
    });
    const { trigger, channel } = makeTrigger({ db });

    const result = await trigger.handleContainerDie({
      projectId: 'proj-1',
      containerId: 'container-1',
      containerName: 'ol-api',
      exitCode: 1,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('dedupe_suppressed');
    expect(db.createAiOpsBriefing).not.toHaveBeenCalled();
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('subscribes to passive monitor events without invoking mutations', async () => {
    const eventBus = new EventBus();
    const db = makeDb();
    const { trigger } = makeTrigger({ db, eventBus });

    trigger.start();
    await eventBus.emit('deploy:failed', {
      projectId: 'proj-1',
      step: 'startup',
      error: 'build failed',
      buildLog: 'missing dependency',
    });

    await vi.waitFor(() => {
      expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
        expect.objectContaining({
          classification: 'deploy_failed',
        }),
      );
    });

    trigger.stop();
  });
});
