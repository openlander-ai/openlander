import { createModuleLogger } from '../lib/logger.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const SERVICE_ENV_MAP: Record<string, { varName: string; template: (service: string) => string }> =
  {
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

function formatEnvValue(value: string): string {
  if (!value) {
    return '';
  }
  if (/\s|#/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
