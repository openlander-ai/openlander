import type { AiOpsEvidencePack } from './ai-ops-briefing.js';

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret|private[_-]?key|database_url)/i;

const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${REDACTED}`],
  [/\b(?:sk|pk|whsec|rk)_(?:live|test|prod|dev)?_[A-Za-z0-9]{8,}\b/g, REDACTED],
  [/\b(?:ghp|github_pat|glpat|xoxb|xoxp)-?[A-Za-z0-9_:-]{12,}\b/g, REDACTED],
  [
    /\b([A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|DATABASE_URL)[A-Z0-9_]*\s*=\s*)([^\s'"`]+)/gi,
    `$1${REDACTED}`,
  ],
  [/(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/g, `$1${REDACTED}$3`],
];

function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

function redactUnknown(value: unknown, parentKey?: string): unknown {
  if (typeof value === 'string') {
    return parentKey && SENSITIVE_KEY_PATTERN.test(parentKey) ? REDACTED : redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, parentKey));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactUnknown(nested, key),
      ]),
    );
  }

  return value;
}

export function redactAiOpsEvidence<T>(value: T): T {
  return redactUnknown(value) as T;
}

export function redactAiOpsEvidencePack(value: AiOpsEvidencePack): AiOpsEvidencePack {
  return redactAiOpsEvidence(value);
}
