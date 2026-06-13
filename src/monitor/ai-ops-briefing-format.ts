import type { AiOpsBriefingRow } from '../db/types.js';
import { redactAiOpsEvidence } from './ai-ops-evidence-redaction.js';

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export function formatAiOpsBriefingRow(
  row: AiOpsBriefingRow,
  opts: { includeEvidence?: boolean } = {},
) {
  const suggestedCall = parseJsonRecord(row.suggested_call_json);
  const evidence = opts.includeEvidence
    ? redactAiOpsEvidence(parseJsonRecord(row.evidence_json))
    : undefined;
  const usage = parseJsonRecord(row.llm_summary_usage_json);
  const summarySource = row.llm_summary ? 'llm' : 'deterministic';
  const summaryStatus = row.llm_summary_status ?? summarySource;

  return {
    briefing_id: row.id,
    project_id: row.project_id,
    service_id: row.service_id,
    status: row.status,
    severity: row.severity,
    classification: row.classification,
    title: row.title,
    summary: row.llm_summary ?? row.deterministic_summary,
    summary_source: summarySource,
    summary_status: summaryStatus,
    summary_truncated: row.llm_summary_truncated === true,
    ...(row.llm_summary_finish_reason
      ? { summary_finish_reason: row.llm_summary_finish_reason }
      : {}),
    ...(row.llm_summary_error ? { summary_error: row.llm_summary_error } : {}),
    ...(usage ? { summary_usage: usage } : {}),
    deterministic_summary: row.deterministic_summary,
    ...(row.llm_summary ? { llm_summary: row.llm_summary } : {}),
    fingerprint: row.fingerprint,
    dedupe_key: row.dedupe_key,
    suggested_call: suggestedCall,
    ...(evidence ? { evidence } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
