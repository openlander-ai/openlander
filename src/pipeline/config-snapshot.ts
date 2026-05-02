import type { ProjectConfig } from './deploy-core.js';
import type { Database } from '../db/index.js';
import { buildResourceLimitConfig, type ResourceLimitConfig } from './docker/types.js';

/**
 * Version of the config snapshot format.
 * Increment when the snapshot structure changes.
 */
export const CONFIG_VERSION = 1;

/**
 * Allowlisted fields that are persisted in the deploy_configs table.
 * These are deployment-specific settings that should be preserved across redeploys.
 */
export const PERSISTED_FIELDS = [
  'sshKeyPath',
  'composeServices',
  'preferDockerfile',
  'environment',
  'dockerfilePath',
  'dockerTarget',
  'buildContext',
  'imageCmd',
  'resourceProfile',
  'memoryLimitBytes',
] as const;

/**
 * Snapshot of deployment configuration.
 * Contains only allowlisted fields that should be persisted.
 * All fields are optional to allow partial snapshots.
 */
export interface DeployConfigSnapshot {
  /** SSH key path for private repos */
  sshKeyPath?: string;
  /** Specific docker-compose services to deploy */
  composeServices?: string[];
  /** Prefer Dockerfile over docker-compose */
  preferDockerfile?: boolean;
  /** Target environment (e.g., production, development) */
  environment?: string;
  /** Custom dockerfile path */
  dockerfilePath?: string;
  /** Docker build target stage */
  dockerTarget?: string;
  /** Docker build context directory */
  buildContext?: string;
  /** Command override array for container entrypoint */
  imageCmd?: string[];
  /** Resource profile for memory/CPU limits */
  resourceProfile?: 'micro' | 'small' | 'medium' | 'large' | 'custom' | null;
  /** Memory limit in bytes */
  memoryLimitBytes?: number | null;
}

/**
 * Stored config with version and timestamp.
 * This is the format persisted in the database.
 */
export interface StoredDeployConfig {
  version: number;
  snapshot: DeployConfigSnapshot;
  savedAt: string;
}

/**
 * Extract allowlisted fields from ProjectConfig into a snapshot.
 * Excludes runtime fields, per-invocation fields, and database-managed fields.
 *
 * @param config - The full ProjectConfig
 * @returns A snapshot containing only allowlisted fields
 */
export function createSnapshot(config: ProjectConfig): DeployConfigSnapshot {
  const snapshot: DeployConfigSnapshot = {};

  // Only include fields that are in PERSISTED_FIELDS and are defined
  if (config.sshKeyPath !== undefined) {
    snapshot.sshKeyPath = config.sshKeyPath;
  }
  if (config.composeServices !== undefined) {
    snapshot.composeServices = config.composeServices;
  }
  if (config.preferDockerfile !== undefined) {
    snapshot.preferDockerfile = config.preferDockerfile;
  }
  if (config.environment !== undefined) {
    snapshot.environment = config.environment;
  }
  if (config.dockerfilePath !== undefined) {
    snapshot.dockerfilePath = config.dockerfilePath;
  }
  if (config.dockerTarget !== undefined) {
    snapshot.dockerTarget = config.dockerTarget;
  }
  if (config.buildContext !== undefined) {
    snapshot.buildContext = config.buildContext;
  }
  if (config.imageCmd !== undefined) {
    snapshot.imageCmd = config.imageCmd;
  }
  if (config.resourceProfile !== undefined) {
    snapshot.resourceProfile = config.resourceProfile;
  }
  if (config.memoryLimitBytes !== undefined) {
    snapshot.memoryLimitBytes = config.memoryLimitBytes;
  }

  return snapshot;
}

/**
 * Serialize a snapshot into a JSON string with version and timestamp.
 *
 * @param snapshot - The config snapshot to serialize
 * @returns JSON string representation of StoredDeployConfig
 */
export function serializeConfig(snapshot: DeployConfigSnapshot): string {
  const stored: StoredDeployConfig = {
    version: CONFIG_VERSION,
    snapshot,
    savedAt: new Date().toISOString(),
  };
  return JSON.stringify(stored);
}

/**
 * Deserialize a JSON string into a StoredDeployConfig.
 * Returns null if the JSON is invalid or the version is unsupported.
 *
 * @param json - The JSON string to deserialize
 * @returns StoredDeployConfig or null if deserialization fails
 */
export function deserializeConfig(json: string): StoredDeployConfig | null {
  try {
    const parsed: unknown = JSON.parse(json);

    // Validate structure
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.version !== 'number') {
      return null;
    }

    // Check version compatibility
    if (obj.version !== CONFIG_VERSION) {
      return null;
    }

    if (!obj.snapshot || typeof obj.snapshot !== 'object') {
      return null;
    }

    if (typeof obj.savedAt !== 'string') {
      return null;
    }

    return {
      version: obj.version,
      snapshot: obj.snapshot,
      savedAt: obj.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Validate a stored config JSON string.
 * Alias for deserializeConfig with explicit type checking.
 *
 * @param json - The JSON string to validate
 * @returns StoredDeployConfig or null if validation fails
 */
export function validateStoredConfig(json: string): StoredDeployConfig | null {
  return deserializeConfig(json);
}

export async function persistDeployConfig(params: {
  projectId: string;
  config: ProjectConfig;
  db: Database;
}): Promise<void> {
  const snapshot = createSnapshot(params.config);
  const json = serializeConfig(snapshot);
  await params.db.saveDeployConfig(params.projectId, json, CONFIG_VERSION);
}

/**
 * Load resource limits for a project from deploy_configs.
 * Returns null if no config exists or no resource profile is set.
 */
export async function loadResourceLimitsForProject(
  db: Database,
  projectId: string,
): Promise<ResourceLimitConfig | null> {
  const configRow = await db.loadDeployConfig(projectId);
  if (!configRow) return null;
  const stored = deserializeConfig(configRow.config_json);
  if (!stored?.snapshot) return null;
  return buildResourceLimitConfig(
    stored.snapshot.resourceProfile ?? null,
    stored.snapshot.memoryLimitBytes ?? null,
  );
}
