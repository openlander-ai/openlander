import { createModuleLogger } from '../lib/logger.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from '../db/index.js';
import type { EnvScanResult } from './env-scan.js';
import type { EnvManager } from './env.js';

const log = createModuleLogger('env-inject');

const SECRET_PATTERNS = [
  /_SECRET$/i,
  /_KEY$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /^SECRET_/i,
  /^API_KEY/i,
  /^AUTH_/i,
];

export const SERVICE_ENV_MAP: Record<
  string,
  { varName: string; template: (service: string) => string }
> = {
  postgres: {
    varName: 'DATABASE_URL',
    template: (s) => `postgresql://postgres:postgres@${s}:5432/app`,
  },
  postgresql: {
    varName: 'DATABASE_URL',
    template: (s) => `postgresql://postgres:postgres@${s}:5432/app`,
  },
  mysql: { varName: 'DATABASE_URL', template: (s) => `mysql://root:root@${s}:3306/app` },
  mariadb: { varName: 'DATABASE_URL', template: (s) => `mysql://root:root@${s}:3306/app` },
  redis: { varName: 'REDIS_URL', template: (s) => `redis://${s}:6379` },
  mongo: { varName: 'MONGO_URL', template: (s) => `mongodb://${s}:27017/app` },
  mongodb: { varName: 'MONGO_URL', template: (s) => `mongodb://${s}:27017/app` },
  rabbitmq: { varName: 'AMQP_URL', template: (s) => `amqp://${s}:5672` },
};

const ENV_EXAMPLE_FILENAMES = ['.env.example', '.env.sample', '.env.template'] as const;

export type EnvVarClassification = 'default' | 'secret' | 'internal';

export interface ClassifiedEnvVar {
  key: string;
  classification: EnvVarClassification;
  defaultValue?: string;
  inferredFrom?: string;
}

export interface EnvInjectionResult {
  envFile: string;
  classified: ClassifiedEnvVar[];
  needsUserInput: ClassifiedEnvVar[];
}

function normalizeServiceType(serviceType: string): string {
  const normalized = serviceType.trim().toLowerCase();
  if (normalized === 'postgres') {
    return 'postgresql';
  }
  if (normalized === 'mongo') {
    return 'mongodb';
  }
  if (normalized === 'mariadb') {
    return 'mysql';
  }
  return normalized;
}

function toServiceNameSuffix(serviceName: string): string {
  return serviceName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function isPlaceholderEnvValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    /^(changeme|change_me|change-me|replace_me|replace-me|your[_-]?.*here|xxx+|todo|fixme|placeholder)$/.test(
      normalized,
    )
  );
}

export async function autoInjectServiceEnv(params: {
  db: Database;
  env: EnvManager;
  projectId: string;
  serviceId: string;
  serviceName: string;
  serviceType: string;
  containerName: string;
  credentials?: Record<string, string>;
}): Promise<string[]> {
  const mapping = SERVICE_ENV_MAP[normalizeServiceType(params.serviceType)];
  if (!mapping) {
    return [];
  }

  const existingConnections = await params.db.listServiceConnectionsByProject(params.projectId);
  let hasSameTypeConnection = false;
  for (const connection of existingConnections) {
    if (connection.service_id_provider === params.serviceId) {
      continue;
    }
    const connectedService = await params.db.getService(connection.service_id_provider);
    if (!connectedService) {
      continue;
    }
    // Post-0012: `type` column dropped; `kind` holds the canonical service type.
    const svcType = connectedService.kind;
    if (normalizeServiceType(svcType) === normalizeServiceType(params.serviceType)) {
      hasSameTypeConnection = true;
      break;
    }
  }

  const envKey = hasSameTypeConnection
    ? `${mapping.varName}_${toServiceNameSuffix(params.serviceName)}`
    : mapping.varName;
  const credentialValue = params.credentials?.['connectionString'];
  const envValue =
    typeof credentialValue === 'string' && credentialValue.trim().length > 0
      ? credentialValue.trim()
      : mapping.template(params.serviceName);

  const deployable = await params.db.getDeployableForProject(params.projectId);
  const allVars = deployable
    ? await params.env.getAllForService(params.projectId, deployable.id)
    : await params.env.getAll(params.projectId);
  const existingValue = allVars[envKey];
  if (typeof existingValue === 'string' && !isPlaceholderEnvValue(existingValue)) {
    return [];
  }

  if (deployable) {
    await params.env.setBulkForService(params.projectId, deployable.id, { [envKey]: envValue });
  } else {
    await params.env.set(params.projectId, envKey, envValue);
  }
  return [envKey];
}

export async function cleanupAutoInjectedEnv(params: {
  db: Database;
  env: EnvManager;
  projectId: string;
  autoInjectedEnvKeys: string[];
}): Promise<void> {
  const deployable = await params.db.getDeployableForProject(params.projectId);
  for (const key of params.autoInjectedEnvKeys) {
    if (deployable) {
      await params.env.deleteForService(params.projectId, deployable.id, key);
    } else {
      await params.env.delete(params.projectId, key);
    }
  }
}

export function detectEnvFile(projectPath: string): string | null {
  for (const name of ENV_EXAMPLE_FILENAMES) {
    const filePath = join(projectPath, name);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

export function parseEnvFile(filePath: string): Map<string, string> {
  const content = readFileSync(filePath, 'utf8');
  const vars = new Map<string, string>();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!key) {
      continue;
    }

    const rawValue = trimmed.slice(separator + 1).trim();
    const unquoted = unquoteEnvValue(rawValue);
    vars.set(key, unquoted);
  }

  return vars;
}

export function classifyVar(key: string, value: string): EnvVarClassification {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(key))) {
    return 'secret';
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized === 'changeme' ||
    normalized === 'change-me' ||
    normalized === 'xxx' ||
    /^your[-_].+/.test(normalized)
  ) {
    return 'secret';
  }

  return 'default';
}

export function inferServiceEnvVars(serviceNames: string[]): ClassifiedEnvVar[] {
  const inferred: ClassifiedEnvVar[] = [];
  const seenKeys = new Set<string>();

  for (const serviceName of serviceNames) {
    const mapping = SERVICE_ENV_MAP[serviceName.toLowerCase()];
    if (!mapping || seenKeys.has(mapping.varName)) {
      continue;
    }

    seenKeys.add(mapping.varName);
    inferred.push({
      key: mapping.varName,
      classification: 'internal',
      defaultValue: mapping.template(serviceName),
      inferredFrom: `service:${serviceName}`,
    });
  }

  return inferred;
}

export function generateEnvFile(projectPath: string, serviceNames: string[]): EnvInjectionResult {
  const classified: ClassifiedEnvVar[] = [];
  const needsUserInput: ClassifiedEnvVar[] = [];
  const seenKeys = new Set<string>();

  const envTemplatePath = detectEnvFile(projectPath);
  if (envTemplatePath) {
    log.debug({ envTemplatePath }, 'Detected env template file');
    const parsed = parseEnvFile(envTemplatePath);
    for (const [key, value] of parsed.entries()) {
      const classification = classifyVar(key, value);
      const item: ClassifiedEnvVar = {
        key,
        classification,
        defaultValue: value,
      };
      classified.push(item);
      seenKeys.add(key);
      if (classification === 'secret') {
        needsUserInput.push(item);
      }
    }
  }

  const inferred = inferServiceEnvVars(serviceNames);
  for (const item of inferred) {
    if (seenKeys.has(item.key)) {
      continue;
    }
    classified.push(item);
    seenKeys.add(item.key);
  }

  const envLines: string[] = [];
  for (const item of classified) {
    if (item.classification === 'secret') {
      envLines.push(`# TODO: Set ${item.key}`);
      envLines.push(`${item.key}=`);
      continue;
    }

    const value = item.defaultValue ?? '';
    envLines.push(`${item.key}=${formatEnvValue(value)}`);
  }

  return {
    envFile: envLines.join('\n'),
    classified,
    needsUserInput,
  };
}

export function generateEnvExample(
  scanResult: EnvScanResult,
  existingVars?: Record<string, string>,
): string {
  const vars = existingVars ?? {};
  const inferred = inferServiceEnvVars(scanResult.serviceHints);
  const inferredByKey = new Map(inferred.map((item) => [item.key, item]));
  const scanKeys = scanResult.vars.map((item) => item.key);
  const allKeys = Array.from(new Set([...scanKeys, ...inferred.map((item) => item.key)])).sort(
    (a, b) => a.localeCompare(b),
  );

  const lines: string[] = [
    '# Auto-generated by OpenLander from env usage scan',
    '# Fill values before local runtime; OpenLander-managed values are redacted here',
    '',
  ];

  for (const key of allKeys) {
    const inferredItem = inferredByKey.get(key);
    const existingValue = vars[key];
    const hasExistingValue = typeof existingValue === 'string' && existingValue.length > 0;
    const isSecretLike = SECRET_PATTERNS.some((pattern) => pattern.test(key));

    if (inferredItem?.inferredFrom) {
      lines.push(`# Inferred from ${inferredItem.inferredFrom}`);
    }

    if (hasExistingValue) {
      lines.push(`# Existing value in OpenLander: ${maskForExample(existingValue)}`);
      if (isSecretLike) {
        lines.push(`# TODO: Set ${key}`);
        lines.push(`${key}=`);
      } else {
        lines.push(`${key}=<configured-in-openlander>`);
      }
      lines.push('');
      continue;
    }

    if (inferredItem?.defaultValue) {
      lines.push(`${key}=${formatEnvValue(inferredItem.defaultValue)}`);
      lines.push('');
      continue;
    }

    if (isSecretLike) {
      lines.push(`# TODO: Set ${key}`);
      lines.push(`${key}=`);
      lines.push('');
      continue;
    }

    lines.push(`${key}=`);
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * Check .env.example requirements against provided env vars.
 * Returns missing and optional variables.
 *
 * @param projectPath - Path to cloned repo
 * @param providedVars - Already-configured env vars (global + project merged)
 */
export interface EnvCheckResult {
  /** All keys defined in .env.example. */
  required: string[];
  /** Keys already provided via env vars or global secrets. */
  provided: string[];
  /** Keys missing from provided vars (secret or empty default). */
  missing: string[];
  /** Keys with non-empty defaults (won't block deploy). */
  optional: string[];
  /** Name of the detected template file (null if none). */
  templateFile: string | null;
}

export function checkEnvRequirements(
  projectPath: string,
  providedVars: Record<string, string>,
): EnvCheckResult {
  const templatePath = detectEnvFile(projectPath);
  if (!templatePath) {
    return { required: [], provided: [], missing: [], optional: [], templateFile: null };
  }

  const parsed = parseEnvFile(templatePath);
  const required: string[] = [];
  const provided: string[] = [];
  const missing: string[] = [];
  const optional: string[] = [];

  for (const [key, value] of parsed.entries()) {
    required.push(key);

    if (key in providedVars) {
      provided.push(key);
      continue;
    }

    const classification = classifyVar(key, value);
    if (classification === 'secret' || value.trim() === '') {
      // Must be provided by user
      missing.push(key);
    } else {
      // Has a sensible default
      optional.push(key);
    }
  }

  const fileName = templatePath.split('/').pop() ?? null;
  log.debug(
    {
      templateFile: fileName,
      total: required.length,
      missing: missing.length,
      optional: optional.length,
    },
    'Env requirements check',
  );

  return { required, provided, missing, optional, templateFile: fileName };
}

export function detectNewEnvKeys(
  projectPath: string,
  storedVarKeys: string[],
): { newKeys: string[]; templateFile: string } | null {
  const templatePath = detectEnvFile(projectPath);
  if (!templatePath) {
    return null;
  }

  const templateVars = parseEnvFile(templatePath);
  const storedSet = new Set(storedVarKeys.map((key) => key.toUpperCase()));
  const newKeys = Array.from(templateVars.keys()).filter(
    (key) => !storedSet.has(key.toUpperCase()),
  );

  if (newKeys.length === 0) {
    return null;
  }

  return { newKeys, templateFile: templatePath };
}

function unquoteEnvValue(rawValue: string): string {
  if (rawValue.length < 2) {
    return rawValue;
  }

  const first = rawValue[0];
  const last = rawValue[rawValue.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return rawValue.slice(1, -1);
  }

  return rawValue;
}

export function formatEnvValue(value: string): string {
  if (!value) {
    return '';
  }
  if (/[\s#"'$`\\=\n\r]/.test(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
    return `"${escaped}"`;
  }
  return value;
}

function maskForExample(value: string): string {
  if (!value) {
    return '[redacted]';
  }
  if (value.length <= 8) {
    return '****';
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}
