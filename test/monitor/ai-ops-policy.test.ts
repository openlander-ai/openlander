import { describe, expect, it } from 'vitest';

import {
  AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
  AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT,
  AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT,
  AI_OPS_DEFAULT_PROJECT_MODE,
  AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE,
  buildAiOpsDedupeKey,
  evaluateAiOpsBriefingBudget,
  resolveAiOpsMode,
  startOfUtcDay,
} from '../../src/monitor/ai-ops-policy.js';

describe('AI Ops policy foundation', () => {
  it('defaults AI Ops to off and service overrides to inherit', () => {
    expect(AI_OPS_DEFAULT_PROJECT_MODE).toBe('off');
    expect(AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE).toBe('inherit');
    expect(AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT).toBe(20);
    expect(AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT).toBe(200);
    expect(AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES).toBe(30);
    expect(resolveAiOpsMode()).toEqual({ mode: 'off', source: 'project' });
  });

  it('resolves service override before project policy', () => {
    expect(resolveAiOpsMode('briefing', 'inherit')).toEqual({
      mode: 'briefing',
      source: 'project',
    });
    expect(resolveAiOpsMode('briefing', 'off')).toEqual({
      mode: 'off',
      source: 'service_override',
    });
    expect(resolveAiOpsMode('off', 'briefing')).toEqual({
      mode: 'briefing',
      source: 'service_override',
    });
  });

  it('builds durable fingerprint keys with project and service/resource scope', () => {
    expect(
      buildAiOpsDedupeKey({
        projectId: 'proj-1',
        serviceId: 'svc-api',
        fingerprint: 'restart-loop:container-a',
      }),
    ).toBe('proj-1:service:svc-api:restart-loop:container-a');

    expect(
      buildAiOpsDedupeKey({
        projectId: 'proj-1',
        resourceKind: 'domain',
        resourceId: 'example.com',
        fingerprint: 'route-502',
      }),
    ).toBe('proj-1:domain:example.com:route-502');

    expect(
      buildAiOpsDedupeKey({
        projectId: 'proj-1',
        fingerprint: 'host-disk-high',
      }),
    ).toBe('proj-1:project:host-disk-high');
  });

  it('keeps deterministic briefings when LLM summary budget is exceeded', () => {
    expect(
      evaluateAiOpsBriefingBudget({
        projectUsed: 20,
        projectLimit: 20,
        instanceUsed: 20,
        instanceLimit: 200,
      }),
    ).toEqual({
      llmSummaryAllowed: false,
      deterministicBriefingAllowed: true,
      reason: 'project_daily_limit_exceeded',
    });

    expect(
      evaluateAiOpsBriefingBudget({
        projectUsed: 10,
        projectLimit: 20,
        instanceUsed: 200,
        instanceLimit: 200,
      }),
    ).toEqual({
      llmSummaryAllowed: false,
      deterministicBriefingAllowed: true,
      reason: 'instance_daily_limit_exceeded',
    });
  });

  it('uses UTC day boundaries for daily briefing budgets', () => {
    expect(startOfUtcDay(new Date('2026-06-11T23:59:59.999Z')).toISOString()).toBe(
      '2026-06-11T00:00:00.000Z',
    );
  });
});
