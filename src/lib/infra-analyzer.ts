import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createModuleLogger } from './logger.js';
import type { ServiceRow } from '../db/index.js';

const log = createModuleLogger('infra-analyzer');

/**
 * Service type that can be detected from dependencies or env vars.
 */
export type DetectedServiceType = 'postgresql' | 'mysql' | 'redis' | 'mongodb';

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
}

/**
 * Missing service that was detected but not provisioned.
 */
export interface MissingService {
  type: DetectedServiceType;
  suggestion: string;
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
 * Dependency patterns to detect service needs from package.json.
 * Maps package names to service types.
 * Exact list from plan: pg, mysql2, ioredis, redis, mongoose, mongodb, @prisma/client, typeorm, drizzle-orm, sequelize
 */
const DEPENDENCY_PATTERNS: Record<string, DetectedServiceType> = {
  // PostgreSQL: pg, @prisma/client, drizzle-orm, sequelize, typeorm
  pg: 'postgresql',
  '@prisma/client': 'postgresql',
  'drizzle-orm': 'postgresql',
  sequelize: 'postgresql',
  typeorm: 'postgresql',
  asyncpg: 'postgresql',
  psycopg2: 'postgresql',
  psycopg: 'postgresql',
  sqlalchemy: 'postgresql',

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
};

function findDepFiles(dir: string, filename: string, maxDepth = 3): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(current).sort((left, right) => left.localeCompare(right));
    } catch (error) {
      log.debug(
        { err: error, current, filename },
        'Could not read directory during dependency scan',
      );
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
        if (stat.isFile() && entry === filename) {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch (error) {
        log.debug(
          { err: error, fullPath, filename },
          'Could not stat entry during dependency scan',
        );
        continue;
      }
    }
  }

  walk(dir, 0);
  return results.sort((left, right) => left.localeCompare(right));
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

  // Analyze package.json dependencies
  const packageJsonPaths = findDepFiles(repoPath, 'package.json');
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

  const requirementsPaths = findDepFiles(repoPath, 'requirements.txt');
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

  const pyprojectPaths = findDepFiles(repoPath, 'pyproject.toml');
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

  // Analyze .env.example and .env.sample files (per plan scope)
  const envFileNames = ['.env.example', '.env.sample'];
  for (const envFileName of envFileNames) {
    try {
      const envPath = join(repoPath, envFileName);
      const envContent = readFileSync(envPath, 'utf8');

      // Extract env var keys (simple pattern: KEY=value or KEY)
      const envVarPattern = /^([A-Z_][A-Z0-9_]*)\s*=/gm;
      let match: RegExpExecArray | null;
      while ((match = envVarPattern.exec(envContent)) !== null) {
        const envKey = match[1];
        if (!envKey) continue;

        const serviceType = ENV_VAR_PATTERNS[envKey];
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

  // Cross-reference with existing services
  const existingTypes = new Set(existingServices.map((s) => s.type as DetectedServiceType));
  const available: AvailableService[] = existingServices
    .filter((s) => detectedTypes.has(s.type as DetectedServiceType))
    .map((s) => ({
      type: s.type as DetectedServiceType,
      name: s.name,
      id: s.id,
    }));

  const missing: MissingService[] = Array.from(detectedTypes.keys())
    .filter((type) => !existingTypes.has(type))
    .map((type) => ({
      type,
      suggestion: `Create a ${type} service to satisfy the detected dependency`,
    }));

  return {
    needs,
    available,
    missing,
  };
}
