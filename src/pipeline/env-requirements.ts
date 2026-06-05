export type EnvRequirementKind = 'url' | 'host' | 'int' | 'enum' | 'prefix' | 'minlen' | 'secret';

export interface EnvValueRequirement {
  kind: EnvRequirementKind;
  source: 'schema' | 'key_name';
  min?: number;
  prefix?: string;
  values?: string[];
  allowLocalhost?: boolean;
  trustedSourceRequired?: boolean;
  guidance?: string;
  message?: string;
}

export interface EnvValueIssue {
  key: string;
  code:
    | 'ENV_VALUE_PLACEHOLDER'
    | 'ENV_VALUE_TOO_SHORT'
    | 'ENV_VALUE_PREFIX_MISMATCH'
    | 'ENV_VALUE_INVALID_URL'
    | 'ENV_VALUE_INVALID_HOST'
    | 'ENV_VALUE_LOCALHOST_URL'
    | 'ENV_VALUE_RESERVED_URL_HOST'
    | 'ENV_VALUE_RESERVED_HOST'
    | 'ENV_VALUE_UNTRUSTED_EXTERNAL'
    | 'ENV_VALUE_ENUM_MISMATCH'
    | 'ENV_VALUE_NOT_INTEGER';
  severity: 'fail' | 'warning';
  message: string;
  requirement?: EnvValueRequirement;
}

export interface EnvValueValidationOptions {
  trustedSource?: boolean;
}

const PLACEHOLDER_PATTERN =
  /(^|[^a-z0-9])(changeme|change[-_]?me|replace[-_]?me|placeholder|todo|fixme|xxx+|dummy|fake|sample|test[-_](?:value|secret|key|token)|your[-_][a-z0-9_-]*)([^a-z0-9]|$)/i;

const URL_KEY_PATTERN = /(?:^|_)(URL|URI|DSN|ENDPOINT|CONNECTION)$/i;
const HOST_KEY_PATTERN = /(?:^|_)(HOST|HOSTNAME)$/i;
const INTEGER_KEY_PATTERN = /(?:^|_)(PORT|MAX|MIN|LIMIT|TTL|TIMEOUT|RETRIES|INTERVAL)$/i;
const SECRET_KEY_PATTERN =
  /(?:SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|JWT|PASSWORD)/i;
const SECRET_EXAMPLE_PATTERN =
  /(?:abcdef|123456|super[-_]?secret|very[-_]?long[-_]?secret|example(?:key)?|AKIA[0-9A-Z]*EXAMPLE|wJalrXUtnFEMI)/i;

const PLATFORM_MANAGED_ENV_KEYS = new Set([
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'MYSQL_URL',
  'REDIS_URL',
  'MONGO_URL',
  'MONGODB_URI',
  'RABBITMQ_URL',
  'AMQP_URL',
]);

const TRUSTED_EXTERNAL_PREFIXES = [
  'EXCHANGE_',
  'STRIPE_',
  'SMTP_',
  'S3_',
  'AWS_',
  'SENDGRID_',
  'MAILGUN_',
  'TWILIO_',
  'SLACK_',
  'DISCORD_',
];

function requiresTrustedExternalSource(key: string): boolean {
  const normalized = key.toUpperCase();
  if (PLATFORM_MANAGED_ENV_KEYS.has(normalized)) {
    return false;
  }
  if (/^(APP_BASE_URL|BASE_URL|PUBLIC_URL)$/.test(normalized)) {
    return true;
  }
  return TRUSTED_EXTERNAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function withExternalTrustRequirement(
  key: string,
  requirement: EnvValueRequirement,
): EnvValueRequirement {
  if (!requiresTrustedExternalSource(key)) {
    return requirement;
  }
  return {
    ...requirement,
    trustedSourceRequired: true,
  };
}

function parseNumberField(raw: string, field: string): number | undefined {
  const match = new RegExp(`\\b${field}\\s*:\\s*(\\d+)`).exec(raw);
  const value = match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  return Number.isFinite(value) ? value : undefined;
}

function parseStringField(raw: string, field: string): string | undefined {
  const match = new RegExp(`\\b${field}\\s*:\\s*['"]([^'"]+)['"]`).exec(raw);
  return match?.[1];
}

function parseStringArrayField(raw: string): string[] | undefined {
  const match = /\b(?:values|options|choices)\s*:\s*\[([^\]]*)]/.exec(raw);
  const body = match?.[1];
  if (!body) return undefined;

  const values = Array.from(body.matchAll(/['"]([^'"]+)['"]/g))
    .map((item) => item[1])
    .filter((value): value is string => typeof value === 'string');
  return values.length > 0 ? values : undefined;
}

export function requirementFromNodeSchemaObject(
  rawObject: string,
  kind: string,
): EnvValueRequirement | undefined {
  if (kind === 'required' || kind === 'optional') {
    return undefined;
  }

  if (kind === 'url') {
    return {
      kind: 'url',
      source: 'schema',
      allowLocalhost: false,
      guidance: 'Use a real reachable URL. Avoid example.com, .local, .test, and localhost.',
    };
  }
  if (kind === 'int') {
    return { kind: 'int', source: 'schema' };
  }
  if (kind === 'enum') {
    return { kind: 'enum', source: 'schema', values: parseStringArrayField(rawObject) };
  }
  if (kind === 'prefix') {
    const prefix = parseStringField(rawObject, 'prefix');
    return {
      kind: 'prefix',
      source: 'schema',
      prefix,
      guidance: prefix
        ? `Ask the user for the real value; it must start with "${prefix}".`
        : undefined,
    };
  }
  if (kind === 'minlen') {
    const min = parseNumberField(rawObject, 'min');
    return {
      kind: 'minlen',
      source: 'schema',
      min,
      guidance: min
        ? `Ask the user for a real secret at least ${String(min)} characters long.`
        : undefined,
    };
  }

  return undefined;
}

export function inferEnvValueRequirement(key: string): EnvValueRequirement | undefined {
  if (/^(APP_BASE_URL|BASE_URL|PUBLIC_URL)$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'url',
      source: 'key_name',
      allowLocalhost: false,
      guidance:
        'Use the real public URL supplied or confirmed by the user; do not invent a public base URL during deploy planning.',
    });
  }
  if (/^EXCHANGE_API_URL$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'url',
      source: 'key_name',
      allowLocalhost: false,
      guidance:
        'Ask the user for the real reachable HTTP(S) endpoint; this app may preflight it during startup.',
    });
  }
  if (/^EXCHANGE_API_KEY$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'prefix',
      source: 'key_name',
      prefix: 'key_',
      guidance: 'Ask the user for the real key; it must start with "key_".',
    });
  }
  if (/^STRIPE_(?:API|SECRET)_KEY$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'prefix',
      source: 'key_name',
      prefix: 'sk_',
      guidance: 'Ask the user for the real Stripe secret key; it must start with "sk_".',
    });
  }
  if (/^STRIPE_WEBHOOK_SECRET$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'prefix',
      source: 'key_name',
      prefix: 'whsec_',
      guidance: 'Ask the user for the real Stripe webhook secret; it must start with "whsec_".',
    });
  }
  if (/^(S3_BUCKET|AWS_S3_BUCKET|AWS_BUCKET)$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'secret',
      source: 'key_name',
      guidance: 'Ask the user for the real object-storage bucket name; do not invent one.',
    });
  }
  if (/^SMTP_(?:USER|USERNAME|PASS|PASSWORD)$/i.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'secret',
      source: 'key_name',
      guidance: 'Ask the user for the real SMTP credential; do not invent one.',
    });
  }
  if (/^(JWT_SECRET|SESSION_SECRET|SECRET_KEY|APP_SECRET)$/i.test(key)) {
    return {
      kind: 'minlen',
      source: 'key_name',
      min: 16,
      guidance: 'Ask the user for a real secret at least 16 characters long.',
    };
  }
  if (URL_KEY_PATTERN.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'url',
      source: 'key_name',
      allowLocalhost: false,
      guidance: 'Use a real reachable URL. Avoid example.com, .local, .test, and localhost.',
    });
  }
  if (HOST_KEY_PATTERN.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'host',
      source: 'key_name',
      allowLocalhost: false,
      guidance: 'Use a real reachable host. Avoid example.com, .local, .test, and localhost.',
    });
  }
  if (INTEGER_KEY_PATTERN.test(key)) {
    return { kind: 'int', source: 'key_name' };
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return withExternalTrustRequirement(key, {
      kind: 'secret',
      source: 'key_name',
      guidance: 'Ask the user for the real secret value; do not invent one.',
    });
  }

  return undefined;
}

export function mergeEnvValueRequirement(
  key: string,
  detectedRequirement?: EnvValueRequirement,
): EnvValueRequirement | undefined {
  const inferred = inferEnvValueRequirement(key);
  if (!detectedRequirement) {
    return inferred;
  }
  return {
    ...(inferred ?? {}),
    ...detectedRequirement,
    guidance: detectedRequirement.guidance ?? inferred?.guidance,
    trustedSourceRequired:
      detectedRequirement.trustedSourceRequired ?? inferred?.trustedSourceRequired,
  };
}

function isLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === 'host.docker.internal' ||
      url.hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

function isProbablyUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function isReservedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'example.com' ||
    normalized === 'example.org' ||
    normalized === 'example.net' ||
    normalized
      .split('.')
      .some(
        (label) =>
          label === 'example' ||
          label === 'demo' ||
          label === 'sample' ||
          label === 'test' ||
          label.endsWith('-example') ||
          label.startsWith('example-') ||
          label.endsWith('-demo') ||
          label.startsWith('demo-') ||
          label.endsWith('-sample') ||
          label.startsWith('sample-') ||
          label.endsWith('-test') ||
          label.startsWith('test-'),
      ) ||
    normalized.endsWith('.example.com') ||
    normalized.endsWith('.example.org') ||
    normalized.endsWith('.example.net') ||
    normalized.endsWith('.invalid') ||
    normalized.endsWith('.test') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113)
  );
}

function isReservedUrlHost(value: string): boolean {
  try {
    const url = new URL(value);
    return isReservedHostname(url.hostname);
  } catch {
    return false;
  }
}

function parseHostValue(value: string): { hostname?: string; invalid: boolean } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { invalid: true };
  }

  try {
    if (isProbablyUrl(trimmed)) {
      return { hostname: new URL(trimmed).hostname, invalid: false };
    }
    return { hostname: new URL(`tcp://${trimmed}`).hostname, invalid: false };
  } catch {
    return { invalid: true };
  }
}

function shouldFailReservedHost(key: string, value: string, required: boolean): boolean {
  if (!required) {
    return false;
  }
  if (/^EXCHANGE_API_URL$/i.test(key)) {
    return true;
  }
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateEnvValue(
  key: string,
  value: string,
  requirement?: EnvValueRequirement,
  required = true,
  options: EnvValueValidationOptions = {},
): EnvValueIssue[] {
  const issues: EnvValueIssue[] = [];
  const trimmed = value.trim();

  if (trimmed.length === 0 || PLACEHOLDER_PATTERN.test(trimmed)) {
    issues.push({
      key,
      code: 'ENV_VALUE_PLACEHOLDER',
      severity: required ? 'fail' : 'warning',
      message: `${key} looks empty or placeholder-like; provide the real value before deployment.`,
      requirement,
    });
  }

  if (
    requirement &&
    (requirement.kind === 'secret' ||
      requirement.kind === 'prefix' ||
      requirement.kind === 'minlen') &&
    SECRET_EXAMPLE_PATTERN.test(trimmed)
  ) {
    issues.push({
      key,
      code: 'ENV_VALUE_PLACEHOLDER',
      severity: required ? 'fail' : 'warning',
      message: `${key} looks like a copied example secret; ask the user for the real value before deployment.`,
      requirement,
    });
  }

  if (!requirement) {
    return issues;
  }

  if (requirement.trustedSourceRequired && options.trustedSource === false) {
    issues.push({
      key,
      code: 'ENV_VALUE_UNTRUSTED_EXTERNAL',
      severity: required ? 'fail' : 'warning',
      message: `${key} is user-owned external configuration. Provide it from a saved/trusted user source; do not invent it during deploy planning.`,
      requirement,
    });
  }

  if (
    requirement.kind === 'prefix' &&
    requirement.prefix &&
    !trimmed.startsWith(requirement.prefix)
  ) {
    issues.push({
      key,
      code: 'ENV_VALUE_PREFIX_MISMATCH',
      severity: 'fail',
      message: `${key} must start with "${requirement.prefix}".`,
      requirement,
    });
  }

  if (requirement.kind === 'minlen' && requirement.min && trimmed.length < requirement.min) {
    issues.push({
      key,
      code: 'ENV_VALUE_TOO_SHORT',
      severity: 'fail',
      message: `${key} must be at least ${String(requirement.min)} characters.`,
      requirement,
    });
  }

  if (
    requirement.kind === 'enum' &&
    requirement.values?.length &&
    !requirement.values.includes(trimmed)
  ) {
    issues.push({
      key,
      code: 'ENV_VALUE_ENUM_MISMATCH',
      severity: 'fail',
      message: `${key} must be one of: ${requirement.values.join(', ')}.`,
      requirement,
    });
  }

  if (requirement.kind === 'int' && !/^-?\d+$/.test(trimmed)) {
    issues.push({
      key,
      code: 'ENV_VALUE_NOT_INTEGER',
      severity: 'fail',
      message: `${key} must be an integer.`,
      requirement,
    });
  }

  if (requirement.kind === 'url') {
    if (!isProbablyUrl(trimmed)) {
      issues.push({
        key,
        code: 'ENV_VALUE_INVALID_URL',
        severity: 'fail',
        message: `${key} must be a full URL/DSN with a scheme, such as https://, postgres://, or redis://.`,
        requirement,
      });
    } else if (requirement.allowLocalhost !== true && isLocalhostUrl(trimmed)) {
      issues.push({
        key,
        code: 'ENV_VALUE_LOCALHOST_URL',
        severity: 'warning',
        message: `${key} points to localhost; inside a container this usually needs a service hostname or external URL.`,
        requirement,
      });
    } else if (isReservedUrlHost(trimmed)) {
      issues.push({
        key,
        code: 'ENV_VALUE_RESERVED_URL_HOST',
        severity: shouldFailReservedHost(key, trimmed, required) ? 'fail' : 'warning',
        message: `${key} points to a reserved/example host; use a real reachable URL before deployment.`,
        requirement,
      });
    }
  }

  if (requirement.kind === 'host') {
    const parsed = parseHostValue(trimmed);
    if (parsed.invalid || !parsed.hostname) {
      issues.push({
        key,
        code: 'ENV_VALUE_INVALID_HOST',
        severity: 'fail',
        message: `${key} must be a hostname or host:port value, not a placeholder or path.`,
        requirement,
      });
    } else if (requirement.allowLocalhost !== true && isLocalhostUrl(`tcp://${parsed.hostname}`)) {
      issues.push({
        key,
        code: 'ENV_VALUE_LOCALHOST_URL',
        severity: 'warning',
        message: `${key} points to localhost; inside a container this usually needs a service hostname or external host.`,
        requirement,
      });
    } else if (isReservedHostname(parsed.hostname)) {
      issues.push({
        key,
        code: 'ENV_VALUE_RESERVED_HOST',
        severity: required ? 'fail' : 'warning',
        message: `${key} points to a reserved/example host; use a real reachable host before deployment.`,
        requirement,
      });
    }
  }

  return issues;
}
