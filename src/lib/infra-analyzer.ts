import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createModuleLogger } from './logger.js';
import type { ServiceRow } from '../db/index.js';

const log = createModuleLogger('infra-analyzer');

/**
 * Service type that can be detected from dependencies or env vars.
 */
export type DetectedServiceType = 'postgresql' | 'mysql' | 'redis' | 'mongodb' | 'rabbitmq';

/**
 * Infrastructure need detected from package.json or env files.
 */
export interface InfrastructureNeed {
  type: DetectedServiceType;
  detectedFrom: string;
}

/**
 * Available service that matches a detected need.
 */
export interface AvailableService {
  type: DetectedServiceType;
  name: string;
  id: string;
  connectVia?: string;
  /** Detection evidence (dependency name, env var, schema.prisma:provider, etc.) */
  detectedFrom?: string;
}

/**
 * Missing service that was detected but not provisioned.
 */
export interface MissingService {
  type: DetectedServiceType;
  suggestion: string;
  connectVia?: string;
  /** Detection evidence (dependency name, env var, schema.prisma:provider, etc.) */
  detectedFrom?: string;
}

/**
 * Result of infrastructure analysis.
 */
export interface InfrastructureAnalysisResult {
  needs: InfrastructureNeed[];
  available: AvailableService[];
  missing: MissingService[];
}

/**
 * Map canonical `services.kind` (post-0012 taxonomy) to the legacy
 * `DetectedServiceType` enum used by infra-need matching. The legacy
 * enum carries the IANA-style names (postgresql, mongodb) that show up
 * in DATABASE_URL / connection-string heuristics; the canonical kinds
 * use shorter forms (postgres, mongo). Returns null for kinds that
 * cannot satisfy any infra need (git/image/compose deployables).
 */
function kindToDetectedType(kind: string | null | undefined): DetectedServiceType | null {
  switch (kind) {
    case 'postgres':
      return 'postgresql';
    case 'mongo':
      return 'mongodb';
    case 'mysql':
    case 'redis':
      return kind;
    default:
      return null;
  }
}

/**
 * Dependency patterns to detect service needs from package.json.
 * Maps package names to service types.
 * Exact database drivers are safe to infer. Generic ORMs (Prisma, TypeORM,
 * Sequelize, Drizzle, SQLAlchemy) are intentionally excluded because their
 * backing database is configured elsewhere.
 */
const DEPENDENCY_PATTERNS: Record<string, DetectedServiceType> = {
  // PostgreSQL drivers.
  pg: 'postgresql',
  asyncpg: 'postgresql',
  psycopg2: 'postgresql',
  psycopg: 'postgresql',

  mysql2: 'mysql',
  asyncmy: 'mysql',
  aiomysql: 'mysql',
  pymysql: 'mysql',

  ioredis: 'redis',
  redis: 'redis',
  aioredis: 'redis',

  mongoose: 'mongodb',
  mongodb: 'mongodb',
  motor: 'mongodb',
  pymongo: 'mongodb',

  amqplib: 'rabbitmq',
  'amqp-connection-manager': 'rabbitmq',
  amqp: 'rabbitmq',
  pika: 'rabbitmq',
  aio_pika: 'rabbitmq',
};

/**
 * Environment variable patterns to detect service needs from .env files.
 * Maps env var patterns to service types.
 * Examples from plan: DATABASE_URL, REDIS_URL, MONGODB_URI
 */
const ENV_VAR_PATTERNS: Record<string, DetectedServiceType> = {
  DATABASE_URL: 'postgresql',
  POSTGRES_URL: 'postgresql',
  POSTGRES_HOST: 'postgresql',
  POSTGRES_PORT: 'postgresql',
  POSTGRES_USER: 'postgresql',
  POSTGRES_PASSWORD: 'postgresql',
  POSTGRES_DB: 'postgresql',
  POSTGRES_DATABASE: 'postgresql',

  MYSQL_URL: 'mysql',
  MYSQL_HOST: 'mysql',
  MYSQL_PORT: 'mysql',
  MYSQL_USER: 'mysql',
  MYSQL_PASSWORD: 'mysql',
  MYSQL_DATABASE: 'mysql',
  MYSQL_ROOT_PASSWORD: 'mysql',

  REDIS_URL: 'redis',
  REDIS_HOST: 'redis',
  REDIS_PORT: 'redis',
  REDIS_PASSWORD: 'redis',

  MONGODB_URI: 'mongodb',
  MONGO_URL: 'mongodb',
  MONGO_HOST: 'mongodb',
  MONGO_PORT: 'mongodb',
  MONGO_USER: 'mongodb',
  MONGO_PASSWORD: 'mongodb',
  MONGO_DATABASE: 'mongodb',
  MONGO_INITDB_ROOT_USERNAME: 'mongodb',
  MONGO_INITDB_ROOT_PASSWORD: 'mongodb',

  RABBITMQ_URL: 'rabbitmq',
  AMQP_URL: 'rabbitmq',
  RABBITMQ_HOST: 'rabbitmq',
  RABBITMQ_PORT: 'rabbitmq',
  RABBITMQ_DEFAULT_USER: 'rabbitmq',
  RABBITMQ_DEFAULT_PASS: 'rabbitmq',
};

function inferServiceTypeFromUrl(value: string): DetectedServiceType | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed || /^\$\{?[A-Z0-9_]+\}?$/i.test(trimmed)) {
    return null;
  }

  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  switch (scheme) {
    case 'postgres':
    case 'postgresql':
      return 'postgresql';
    case 'mysql':
    case 'mysql2':
    case 'mariadb':
      return 'mysql';
    case 'redis':
    case 'rediss':
      return 'redis';
    case 'mongodb':
    case 'mongo':
      return 'mongodb';
    case 'amqp':
    case 'amqps':
      return 'rabbitmq';
    default:
      return null;
  }
}

function inferServiceTypeFromPrismaProvider(provider: string): DetectedServiceType | null {
  switch (provider.trim().toLowerCase()) {
    case 'postgresql':
      return 'postgresql';
    case 'mysql':
      return 'mysql';
    case 'mongodb':
      return 'mongodb';
    default:
      return null;
  }
}

function inferEnvServiceType(key: string, rawValue: string): DetectedServiceType | null {
  if (key === 'DATABASE_URL') {
    return inferServiceTypeFromUrl(rawValue);
  }
  return ENV_VAR_PATTERNS[key] ?? null;
}

function connectViaForDetection(
  type: DetectedServiceType,
  detectedFrom: string,
): string | undefined {
  if (/^[A-Z_][A-Z0-9_]*$/.test(detectedFrom) && ENV_VAR_PATTERNS[detectedFrom]) {
    return detectedFrom;
  }

  switch (type) {
    case 'postgresql':
    case 'mysql':
      return 'DATABASE_URL';
    case 'redis':
      return 'REDIS_URL';
    case 'mongodb':
      return 'MONGODB_URI';
    case 'rabbitmq':
      return 'RABBITMQ_URL';
  }
}

/**
 * Files that contribute infrastructure-need evidence, listed in the order they
 * are processed inside `analyzeInfrastructure`. `detectedTypes` is first-hit-wins,
 * so this order is part of the observable contract — pinned by the
 * "processing order" test in `test/infra-analyzer.test.ts`.
 */
const SCANNED_DEP_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'schema.prisma',
] as const;

function findDepFiles(
  dir: string,
  filenames: readonly string[],
  maxDepth = 3,
): Map<string, string[]> {
  const targets = new Set(filenames);
  const results = new Map<string, string[]>();
  for (const name of filenames) results.set(name, []);

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(current).sort((left, right) => left.localeCompare(right));
    } catch (error) {
      log.debug({ err: error, current }, 'Could not read directory during dependency scan');
      return;
    }

    for (const entry of entries) {
      if (
        entry.startsWith('.') ||
        entry === 'node_modules' ||
        entry === 'vendor' ||
        entry === 'dist' ||
        entry === 'build'
      ) {
        continue;
      }

      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && targets.has(entry)) {
          // The map was seeded with every requested filename, so .get always
          // returns a list here; narrow explicitly instead of asserting.
          const list = results.get(entry);
          if (list) list.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch (error) {
        log.debug({ err: error, fullPath }, 'Could not stat entry during dependency scan');
        continue;
      }
    }
  }

  walk(dir, 0);

  for (const list of results.values()) {
    list.sort((left, right) => left.localeCompare(right));
  }
  return results;
}

/**
 * Analyze infrastructure needs from a repository.
 *
 * Scans package.json dependencies and .env.example/.env.sample files
 * to infer infrastructure requirements. Cross-references with existing
 * services to determine what is available and what is missing.
 *
 * @param repoPath - Root path of the repository to analyze
 * @param existingServices - List of already-provisioned services
 * @returns Analysis result with detected needs, available services, and missing services
 */
export function analyzeInfrastructure(
  repoPath: string,
  existingServices: ServiceRow[],
): InfrastructureAnalysisResult {
  const needs: InfrastructureNeed[] = [];
  const detectedTypes = new Map<DetectedServiceType, string>();

  // Walk the repo once for every dep-file kind. Processing order across kinds is
  // fixed by SCANNED_DEP_FILES — detectedTypes is first-hit-wins.
  const depFiles = findDepFiles(repoPath, SCANNED_DEP_FILES);

  // Analyze package.json dependencies
  const packageJsonPaths = depFiles.get('package.json') ?? [];
  for (const packageJsonPath of packageJsonPaths) {
    try {
      const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      for (const depName of Object.keys(allDeps)) {
        const serviceType = DEPENDENCY_PATTERNS[depName];
        if (serviceType && !detectedTypes.has(serviceType)) {
          detectedTypes.set(serviceType, depName);
        }
      }
    } catch (err) {
      log.debug({ err, packageJsonPath }, 'Could not analyze package.json');
    }
  }

  const requirementsPaths = depFiles.get('requirements.txt') ?? [];
  for (const requirementsPath of requirementsPaths) {
    try {
      const requirementsContent = readFileSync(requirementsPath, 'utf8').toLowerCase();

      for (const [pattern, serviceType] of Object.entries(DEPENDENCY_PATTERNS)) {
        if (requirementsContent.includes(pattern) && !detectedTypes.has(serviceType)) {
          detectedTypes.set(serviceType, pattern);
        }
      }
    } catch (err) {
      log.debug({ err, requirementsPath }, 'Could not analyze requirements.txt');
    }
  }

  const pyprojectPaths = depFiles.get('pyproject.toml') ?? [];
  for (const pyprojectPath of pyprojectPaths) {
    try {
      const pyprojectContent = readFileSync(pyprojectPath, 'utf8').toLowerCase();

      for (const [pattern, serviceType] of Object.entries(DEPENDENCY_PATTERNS)) {
        if (pyprojectContent.includes(pattern) && !detectedTypes.has(serviceType)) {
          detectedTypes.set(serviceType, pattern);
        }
      }
    } catch (err) {
      log.debug({ err, pyprojectPath }, 'Could not analyze pyproject.toml');
    }
  }

  const prismaSchemaPaths = depFiles.get('schema.prisma') ?? [];
  for (const prismaSchemaPath of prismaSchemaPaths) {
    try {
      const prismaContent = readFileSync(prismaSchemaPath, 'utf8');
      const providerMatches = prismaContent.matchAll(/\bprovider\s*=\s*["']([^"']+)["']/g);
      for (const match of providerMatches) {
        const provider = match[1];
        if (!provider) continue;
        const serviceType = inferServiceTypeFromPrismaProvider(provider);
        if (serviceType && !detectedTypes.has(serviceType)) {
          detectedTypes.set(serviceType, `schema.prisma:${provider}`);
        }
      }
    } catch (err) {
      log.debug({ err, prismaSchemaPath }, 'Could not analyze schema.prisma');
    }
  }

  // Analyze .env.example and .env.sample files (per plan scope)
  const envFileNames = ['.env.example', '.env.sample'];
  for (const envFileName of envFileNames) {
    try {
      const envPath = join(repoPath, envFileName);
      const envContent = readFileSync(envPath, 'utf8');

      // Extract env var assignments. DATABASE_URL is intentionally inferred
      // from its scheme; an empty placeholder does not imply PostgreSQL.
      const envVarPattern = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/gm;
      let match: RegExpExecArray | null;
      while ((match = envVarPattern.exec(envContent)) !== null) {
        const envKey = match[1];
        if (!envKey) continue;

        const envValue = match[2] ?? '';
        const serviceType = inferEnvServiceType(envKey, envValue);
        if (serviceType && !detectedTypes.has(serviceType)) {
          detectedTypes.set(serviceType, envKey);
        }
      }
    } catch (err) {
      log.debug({ err, envFileName }, 'Failed to read env file');
      // File doesn't exist or can't be read, continue
    }
  }

  // Build needs array with detectedFrom field
  for (const [type, detectedFrom] of detectedTypes.entries()) {
    needs.push({ type, detectedFrom });
  }

  // Cross-reference with existing services. Post-0012 the legacy
  // services.type column is dropped — `kind` is the canonical taxonomy.
  // Map canonical kind → DetectedServiceType so reuse detection still
  // matches infra needs (DATABASE_URL → postgresql, REDIS_URL → redis,
  // etc.). `git`/`image`/`compose`/`compose-child` kinds are non-managed
  // deployables and never satisfy infra needs, so map → null and filter.
  const existingTypes = new Set<DetectedServiceType>();
  const available: AvailableService[] = [];
  for (const s of existingServices) {
    const dt = kindToDetectedType(s.kind);
    if (dt === null) continue;
    existingTypes.add(dt);
    const evidence = detectedTypes.get(dt);
    if (evidence === undefined) continue;
    available.push({
      type: dt,
      name: s.name,
      id: s.id,
      connectVia: connectViaForDetection(dt, evidence),
      detectedFrom: evidence,
    });
  }

  const missing: MissingService[] = Array.from(detectedTypes.keys())
    .filter((type) => !existingTypes.has(type))
    .map((type) => ({
      type,
      suggestion: `Create a ${type} service to satisfy the detected dependency`,
      connectVia: connectViaForDetection(type, detectedTypes.get(type) ?? ''),
      detectedFrom: detectedTypes.get(type),
    }));

  return {
    needs,
    available,
    missing,
  };
}
