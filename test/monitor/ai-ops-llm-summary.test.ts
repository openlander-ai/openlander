import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';

import type { AiOpsBriefingRow } from '../../src/db/types.js';
import {
  createAiOpsBriefingWithOptionalLlm,
  summarizeAiOpsBriefingWithLlm,
} from '../../src/monitor/ai-ops-llm-summary.js';

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

function makeBriefing(overrides: Partial<AiOpsBriefingRow> = {}): AiOpsBriefingRow {
  return {
    id: 'brief-1',
    project_id: 'proj-1',
    service_id: 'svc-1',
    dedupe_key: 'proj-1:service:svc-1:traffic:/:500',
    fingerprint: 'traffic:/:500',
    classification: 'traffic_health_mismatch',
    severity: 'high',
    title: 'Public traffic is failing',
    deterministic_summary: 'Representative traffic probe to / failed with 500.',
    llm_summary: null,
    suggested_call_json: JSON.stringify({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    }),
    evidence_json: JSON.stringify({
      projectId: 'proj-1',
      serviceId: 'svc-1',
      representativeTraffic: {
        status: 'failed',
        severity: 'fail',
        path: '/',
        status_code: 500,
      },
    }),
    status: 'open',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    server_id: 'local',
    ...overrides,
  };
}

function makeRegistry(model: LanguageModel | null) {
  return {
    getModel: vi.fn(() => model),
  };
}

describe('AI Ops LLM summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes an LLM summary without changing deterministic classification or suggested call', async () => {
    const briefing = makeBriefing({
      evidence_json: JSON.stringify({
        logs: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
        env: { DATABASE_URL: 'postgres://app:secret-password@db:5432/app' },
      }),
    });
    const model = { modelId: 'briefing-model' } as unknown as LanguageModel;
    const db = {
      updateAiOpsBriefingLlmSummary: vi.fn(async () => undefined),
    };
    generateTextMock.mockResolvedValueOnce({
      text: 'Traffic to / is returning HTTP 500. Inspect the service diagnosis next.',
    });

    const result = await summarizeAiOpsBriefingWithLlm({
      db,
      modelRegistry: makeRegistry(model),
      briefing,
    });

    expect(result).toEqual({
      status: 'llm',
      summary: 'Traffic to / is returning HTTP 500. Inspect the service diagnosis next.',
    });
    expect(db.updateAiOpsBriefingLlmSummary).toHaveBeenCalledWith(
      'brief-1',
      'Traffic to / is returning HTTP 500. Inspect the service diagnosis next.',
    );
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        maxOutputTokens: 260,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Do not claim that anything was fixed'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('"action":"diagnose_service"'),
          }),
        ]),
      }),
    );
    const prompt = generateTextMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(prompt).toContain('Bearer [REDACTED]');
    expect(prompt).toContain('"DATABASE_URL": "[REDACTED]"');
    expect(prompt).not.toContain('secret-password');
    expect(JSON.parse(briefing.suggested_call_json ?? '{}')).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    });
  });

  it('falls back to the deterministic template when the provider is not configured', async () => {
    const db = {
      updateAiOpsBriefingLlmSummary: vi.fn(async () => undefined),
    };

    const result = await summarizeAiOpsBriefingWithLlm({
      db,
      modelRegistry: makeRegistry(null),
      briefing: makeBriefing(),
    });

    expect(result.status).toBe('skipped');
    expect(result.summary).toContain('Representative traffic probe to / failed with 500.');
    expect(result.summary).toContain('openlander_monitor.diagnose_service');
    expect(db.updateAiOpsBriefingLlmSummary).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('falls back without blocking when the LLM call fails', async () => {
    const db = {
      updateAiOpsBriefingLlmSummary: vi.fn(async () => undefined),
    };
    generateTextMock.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await summarizeAiOpsBriefingWithLlm({
      db,
      modelRegistry: makeRegistry({ modelId: 'briefing-model' } as unknown as LanguageModel),
      briefing: makeBriefing(),
    });

    expect(result.status).toBe('fallback');
    expect(result.error).toContain('provider unavailable');
    expect(result.summary).toContain('Representative traffic probe to / failed with 500.');
    expect(db.updateAiOpsBriefingLlmSummary).not.toHaveBeenCalled();
  });

  it('creates a deterministic briefing and then attaches the LLM summary when enabled', async () => {
    const created = makeBriefing();
    const db = {
      createAiOpsBriefing: vi.fn(async () => created),
      updateAiOpsBriefingLlmSummary: vi.fn(async () => undefined),
    };
    generateTextMock.mockResolvedValueOnce({ text: 'The public route is failing with HTTP 500.' });

    const result = await createAiOpsBriefingWithOptionalLlm({
      db,
      modelRegistry: makeRegistry({ modelId: 'briefing-model' } as unknown as LanguageModel),
      enableLlmSummary: true,
      input: {
        projectId: 'proj-1',
        serviceId: 'svc-1',
        representativeTraffic: {
          status: 'failed',
          severity: 'fail',
          path: '/',
          status_code: 500,
        },
      },
    });

    expect(result.deterministic.classification).toBe('traffic_health_mismatch');
    expect(result.deterministic.suggestedCall).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    });
    expect(db.createAiOpsBriefing).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        serviceId: 'svc-1',
        classification: 'traffic_health_mismatch',
        suggestedCall: {
          tool: 'openlander_monitor',
          action: 'diagnose_service',
          params: { service_id: 'svc-1' },
        },
      }),
    );
    expect(result.briefing.llm_summary).toBe('The public route is failing with HTTP 500.');
  });
});
