import { describe, expect, it } from 'vitest';
import type { AiOpsBriefingRow } from '../../src/db/types.js';
import { formatAiOpsBriefingRow } from '../../src/monitor/ai-ops-briefing-format.js';

function briefingRow(overrides: Partial<AiOpsBriefingRow> = {}): AiOpsBriefingRow {
  return {
    id: 'briefing-1',
    project_id: 'project-1',
    service_id: 'service-1',
    dedupe_key: null,
    fingerprint: 'container-exited:137',
    classification: 'container_exited',
    severity: 'high',
    title: 'Service container exited',
    deterministic_summary: 'The api container exited with code 137.',
    llm_summary: null,
    llm_summary_status: 'fallback',
    llm_summary_finish_reason: null,
    llm_summary_truncated: false,
    llm_summary_error: null,
    llm_summary_usage_json: null,
    suggested_call_json: null,
    evidence_json: JSON.stringify({ container: { exitCode: 137 } }),
    status: 'open',
    created_at: '2026-07-26T00:00:00.000Z',
    updated_at: '2026-07-26T00:00:00.000Z',
    server_id: 'local',
    ...overrides,
  };
}

describe('AI Ops briefing locale-neutral presentation', () => {
  it('adds stable codes and parameters while retaining legacy agent-facing prose', () => {
    const formatted = formatAiOpsBriefingRow(briefingRow());

    expect(formatted).toMatchObject({
      title: 'Service container exited',
      summary: 'The api container exited with code 137.',
      presentation: {
        title_code: 'container_exited',
        summary_code: 'container_exited_with_code',
        params: { exitCode: 137 },
      },
    });
  });

  it('uses a generic presentation code for unrecognized legacy classifications', () => {
    const formatted = formatAiOpsBriefingRow(
      briefingRow({ classification: 'future_server_classification' }),
    );

    expect(formatted.presentation).toEqual({
      title_code: 'unknown',
      summary_code: 'unknown',
      params: {},
    });
  });
});
