import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type {
  AiOpsBriefingRow,
  AiUsageLogRow,
  ProjectRow,
  ServiceRow,
} from '../../src/db/types.js';
import { createAiOpsRoutes } from '../../src/web/api/ai-ops-routes.js';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p1',
    name: 'demo',
    display_name: 'demo',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-1',
    project_id: 'p1',
    name: 'demo__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 3000,
    container_id: 'container-1',
    container_name: 'ol-demo',
    container_port: 3000,
    image_tag: 'demo:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'git',
    repo_url: null,
    branch: null,
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
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeBriefing(overrides: Partial<AiOpsBriefingRow> = {}): AiOpsBriefingRow {
  return {
    id: 'brief-1',
    project_id: 'p1',
    service_id: 'svc-1',
    dedupe_key: 'p1:svc-1:restart_loop',
    fingerprint: 'restart_loop',
    classification: 'restart_loop',
    severity: 'critical',
    title: 'Service is restarting',
    deterministic_summary: 'Container restarted repeatedly in the last few minutes.',
    llm_summary: null,
    llm_summary_status: null,
    llm_summary_finish_reason: null,
    llm_summary_truncated: null,
    llm_summary_error: null,
    llm_summary_usage_json: null,
    suggested_call_json: JSON.stringify({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    }),
    evidence_json: JSON.stringify({ restart_count: 7 }),
    status: 'open',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    server_id: 'local',
    ...overrides,
  };
}

function makeUsage(overrides: Partial<AiUsageLogRow> = {}): AiUsageLogRow {
  return {
    id: 'usage-1',
    project_id: 'p1',
    service_id: 'svc-1',
    feature: 'ai_ops_briefing',
    briefing_id: 'brief-1',
    session_id: null,
    action_type: 'ai_ops_briefing',
    model_name: 'gpt-4.1-mini',
    provider: 'openai-compatible',
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    cost_usd: 0.0012,
    tools_called: 0,
    result: 'success',
    error_message: null,
    error_type: null,
    duration_ms: 1200,
    user_id: null,
    tenant_id: null,
    source: null,
    created_at: '2026-06-11T00:00:00.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createAiOpsRoutes(ctx as AppContext));
  return app;
}

describe('AI Ops routes', () => {
  it('returns default-off project policy and recent briefings', async () => {
    const db = {
      getProject: vi.fn(async () => makeProject()),
      getProjectByName: vi.fn(async () => null),
      getAiOpsProjectPolicy: vi.fn(async () => ({
        project_id: 'p1',
        mode: 'off',
        daily_briefing_limit: 20,
        fingerprint_cooldown_minutes: 30,
        created_at: '2026-06-11T00:00:00.000Z',
        updated_at: '2026-06-11T00:00:00.000Z',
        server_id: 'local',
      })),
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
      listAiOpsBriefingsByProject: vi.fn(async () => [makeBriefing()]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/p1/ai-ops');

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.project_id).toBe('p1');
    expect(body.policy).toMatchObject({ mode: 'off' });
    const briefings = body.recent_briefings as Array<Record<string, unknown>>;
    expect(briefings[0]?.briefing_id).toBe('brief-1');
    expect(briefings[0]).not.toHaveProperty('evidence');
  });

  it('updates project briefing mode without enabling automation', async () => {
    const db = {
      getProject: vi.fn(async () => makeProject()),
      getProjectByName: vi.fn(async () => null),
      setAiOpsProjectPolicy: vi.fn(async () => ({
        project_id: 'p1',
        mode: 'briefing',
        daily_briefing_limit: 12,
        fingerprint_cooldown_minutes: 45,
        created_at: '2026-06-11T00:00:00.000Z',
        updated_at: '2026-06-11T00:01:00.000Z',
        server_id: 'local',
      })),
      getAiOpsBriefingBudgetStatus: vi.fn(async () => ({
        projectUsed: 1,
        projectLimit: 12,
        instanceUsed: 1,
        instanceLimit: 200,
        decision: {
          llmSummaryAllowed: true,
          deterministicBriefingAllowed: true,
          reason: 'allowed',
        },
      })),
      listAiOpsBriefingsByProject: vi.fn(async () => [makeBriefing()]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/p1/ai-ops', {
      method: 'PATCH',
      body: JSON.stringify({
        mode: 'briefing',
        daily_briefing_limit: 12,
        fingerprint_cooldown_minutes: 45,
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.setAiOpsProjectPolicy).toHaveBeenCalledWith('p1', {
      mode: 'briefing',
      dailyBriefingLimit: 12,
      fingerprintCooldownMinutes: 45,
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'saved', project_id: 'p1' });
    expect(db.listAiOpsBriefingsByProject).toHaveBeenCalledWith('p1', {
      limit: 5,
      status: 'open',
    });
    const briefings = body.recent_briefings as Array<Record<string, unknown>>;
    expect(briefings[0]?.briefing_id).toBe('brief-1');
  });

  it('updates a service-level override and returns resolved policy', async () => {
    const db = {
      getProject: vi.fn(async () => makeProject()),
      getProjectByName: vi.fn(async () => null),
      getService: vi.fn(async () => makeService()),
      setAiOpsServiceOverride: vi.fn(async () => ({
        service_id: 'svc-1',
        mode: 'off',
        created_at: '2026-06-11T00:00:00.000Z',
        updated_at: '2026-06-11T00:01:00.000Z',
        server_id: 'local',
      })),
      resolveAiOpsServicePolicy: vi.fn(async () => ({
        mode: 'off',
        source: 'service_override',
      })),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/p1/services/svc-1/ai-ops', {
      method: 'PATCH',
      body: JSON.stringify({ mode: 'off' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.setAiOpsServiceOverride).toHaveBeenCalledWith('svc-1', { mode: 'off' });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'saved', service_id: 'svc-1' });
  });

  it('returns full briefing evidence and LLM usage summary', async () => {
    const db = {
      getAiOpsBriefing: vi.fn(async () =>
        makeBriefing({
          llm_summary_status: 'fallback',
          llm_summary_finish_reason: 'length',
          llm_summary_truncated: true,
          llm_summary_error: 'AI Ops briefing model output was truncated by the output budget.',
          llm_summary_usage_json: JSON.stringify({
            output_tokens: 260,
            reasoning_tokens: 240,
          }),
          evidence_json: JSON.stringify({
            restart_count: 7,
            runtime_log: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
            env: { STRIPE_API_KEY: 'sk_live_abcdefghijklmnopqrstuvwxyz' },
          }),
        }),
      ),
      getAiUsageLogsByBriefing: vi.fn(async () => [makeUsage()]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/ai-ops/briefings/brief-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { briefing: Record<string, unknown> };
    expect(body.briefing.evidence).toEqual({
      restart_count: 7,
      runtime_log: 'Authorization: Bearer [REDACTED]',
      env: { STRIPE_API_KEY: '[REDACTED]' },
    });
    expect(body.briefing).toMatchObject({
      summary_source: 'deterministic',
      summary_status: 'fallback',
      summary_truncated: true,
      summary_finish_reason: 'length',
      summary_error: 'AI Ops briefing model output was truncated by the output budget.',
      summary_usage: {
        output_tokens: 260,
        reasoning_tokens: 240,
      },
    });
    expect(body.briefing.usage).toEqual({
      total_tokens: 150,
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.0012,
      count: 1,
    });
  });
});
