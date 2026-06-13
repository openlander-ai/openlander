import type { AiOpsSuggestedCall } from './ai-ops-briefing.js';
import { redactAiOpsEvidence } from './ai-ops-evidence-redaction.js';

export const DEFAULT_AI_OPS_EVIDENCE_CHAR_CAP = 6_000;

type AiOpsEvidenceSource = 'briefing_snapshot' | 'diagnose_service';

export interface AiOpsOmittedEvidence {
  path: string;
  reason: 'input_cap';
  omitted_chars: number;
  follow_up_call?: AiOpsSuggestedCall;
}

export interface AiOpsEvidenceMetadata {
  observed_at: string;
  live: boolean;
  source: AiOpsEvidenceSource;
  input_token_estimate: number;
  input_cap_applied: boolean;
  omitted_evidence: AiOpsOmittedEvidence[];
}

export interface NormalizedAiOpsEvidence {
  evidence: Record<string, unknown>;
  metadata: AiOpsEvidenceMetadata;
}

interface NormalizeAiOpsEvidenceOptions {
  source: AiOpsEvidenceSource;
  live: boolean;
  observedAt?: string | null;
  serviceId?: string | null;
  charCap?: number;
  hardCap?: boolean;
}

const APPROX_CHARS_PER_TOKEN = 4;
const TRUNCATION_MARKER = '\n...[truncated by OpenLander evidence cap]';

const TRUNCATABLE_PATHS: string[][] = [
  ['recentLogTail'],
  ['deployLog', 'buildLogTail'],
  ['deployLog', 'runtimeLogTail'],
  ['recentDeployment', 'latest', 'buildLogTail'],
  ['logs', 'tail'],
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function estimateInputTokens(value: unknown): number {
  return Math.ceil(serializedLength(value) / APPROX_CHARS_PER_TOKEN);
}

function getStringAtPath(record: Record<string, unknown>, path: readonly string[]): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : null;
}

function setStringAtPath(
  record: Record<string, unknown>,
  path: readonly string[],
  value: string,
): boolean {
  let current: Record<string, unknown> = record;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    current = next as Record<string, unknown>;
  }
  const finalKey = path[path.length - 1];
  if (!finalKey) return false;
  current[finalKey] = value;
  return true;
}

function readObservedAt(record: Record<string, unknown>, fallback?: string | null): string {
  const camel = record['observedAt'];
  const snake = record['observed_at'];
  if (typeof camel === 'string' && camel.trim()) return camel;
  if (typeof snake === 'string' && snake.trim()) return snake;
  if (fallback?.trim()) return fallback;
  return new Date().toISOString();
}

function getNestedRecord(
  record: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return {};
    current = (current as Record<string, unknown>)[key];
  }
  return asRecord(current);
}

function buildFollowUpCall(
  record: Record<string, unknown>,
  path: readonly string[],
  serviceId: string | null | undefined,
): AiOpsSuggestedCall | undefined {
  const pathKey = path.join('.');
  if (pathKey.startsWith('deployLog.')) {
    const deployId = getNestedRecord(record, ['deployLog'])['id'];
    if (typeof deployId === 'string' && deployId) {
      return {
        tool: 'openlander_deploy',
        action: 'get_build_log',
        params: { deploy_id: deployId },
      };
    }
  }
  if (pathKey.startsWith('recentDeployment.latest.')) {
    const deployId = getNestedRecord(record, ['recentDeployment', 'latest'])['id'];
    if (typeof deployId === 'string' && deployId) {
      return {
        tool: 'openlander_deploy',
        action: 'get_build_log',
        params: { deploy_id: deployId },
      };
    }
  }
  if ((pathKey === 'recentLogTail' || pathKey === 'logs.tail') && serviceId) {
    return {
      tool: 'openlander_monitor',
      action: 'get_logs',
      params: { service_id: serviceId, lines: 500 },
    };
  }
  return undefined;
}

function truncateEvidenceToCap(
  record: Record<string, unknown>,
  input: { charCap: number; serviceId?: string | null; hardCap?: boolean },
): { evidence: Record<string, unknown>; omitted: AiOpsOmittedEvidence[] } {
  let evidence = cloneRecord(record);
  const omitted: AiOpsOmittedEvidence[] = [];
  if (serializedLength(evidence) <= input.charCap) return { evidence, omitted };

  const maxFieldChars = Math.max(400, Math.floor(input.charCap / 5));
  for (const path of TRUNCATABLE_PATHS) {
    if (serializedLength(evidence) <= input.charCap) break;
    const value = getStringAtPath(evidence, path);
    if (!value || value.length <= maxFieldChars) continue;

    const nextValue = `${value.slice(0, maxFieldChars)}${TRUNCATION_MARKER}`;
    if (!setStringAtPath(evidence, path, nextValue)) continue;
    const followUpCall = buildFollowUpCall(record, path, input.serviceId);
    omitted.push({
      path: path.join('.'),
      reason: 'input_cap',
      omitted_chars: Math.max(0, value.length - nextValue.length),
      ...(followUpCall ? { follow_up_call: followUpCall } : {}),
    });
  }

  const remainingOverflow = serializedLength(evidence) - input.charCap;
  if (remainingOverflow > 0) {
    if (input.hardCap === true) {
      const beforeHardClampLength = serializedLength(evidence);
      evidence = hardClampEvidence(evidence, input.charCap);
      omitted.push({
        path: '*',
        reason: 'input_cap',
        omitted_chars: Math.max(
          remainingOverflow,
          beforeHardClampLength - serializedLength(evidence),
        ),
      });
      return { evidence, omitted };
    }

    omitted.push({
      path: '*',
      reason: 'input_cap',
      omitted_chars: remainingOverflow,
    });
  }

  return { evidence, omitted };
}

function hardClampEvidence(
  record: Record<string, unknown>,
  charCap: number,
): Record<string, unknown> {
  const serialized = JSON.stringify(record);
  let maxValueChars = Math.max(0, charCap - TRUNCATION_MARKER.length - 100);
  let evidence: Record<string, unknown> = {
    truncated_json: `${serialized.slice(0, maxValueChars)}${TRUNCATION_MARKER}`,
  };

  for (let attempt = 0; attempt < 10 && serializedLength(evidence) > charCap; attempt += 1) {
    const overflow = serializedLength(evidence) - charCap;
    maxValueChars = Math.max(0, maxValueChars - overflow - 16);
    evidence = {
      truncated_json: `${serialized.slice(0, maxValueChars)}${TRUNCATION_MARKER}`,
    };
  }

  return evidence;
}

export function normalizeAiOpsEvidenceForRead(
  value: unknown,
  options: NormalizeAiOpsEvidenceOptions,
): NormalizedAiOpsEvidence {
  const original = redactAiOpsEvidence(cloneRecord(asRecord(value)));
  const observedAt = readObservedAt(original, options.observedAt);
  const { evidence, omitted } = truncateEvidenceToCap(original, {
    charCap: options.charCap ?? DEFAULT_AI_OPS_EVIDENCE_CHAR_CAP,
    hardCap: options.hardCap,
    serviceId:
      options.serviceId ??
      (typeof original['serviceId'] === 'string' ? original['serviceId'] : null),
  });

  return {
    evidence,
    metadata: {
      observed_at: observedAt,
      live: options.live,
      source: options.source,
      input_token_estimate: estimateInputTokens(evidence),
      input_cap_applied: omitted.length > 0,
      omitted_evidence: omitted,
    },
  };
}
