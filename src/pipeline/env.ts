import type { Database } from '../db/index.js';

/**
 * Environment variable management for deployed projects.
 *
 * Values are stored in SQLite with file-permission-level protection.
 * Displayed as masked in UI (sk-****xxxx).
 */
export class EnvManager {
  constructor(private readonly db: Database) {}

  /** Get all env vars for a project (values are raw, not masked). */
  getAll(projectId: string): Record<string, string> {
    return this.db.getEnvVars(projectId);
  }

  /** Get all env vars for a project with masked values. */
  getAllMasked(projectId: string): Record<string, string> {
    const vars = this.db.getEnvVars(projectId);
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      masked[key] = EnvManager.mask(value);
    }
    return masked;
  }

  /** Set a single env var. Returns true if container needs restart. */
  set(projectId: string, key: string, value: string): boolean {
    const existing = this.db.getEnvVars(projectId);
    const changed = existing[key] !== value;
    if (changed) {
      this.db.setEnvVar(projectId, key, value);
    }
    return changed;
  }

  /** Set multiple env vars at once. Returns true if any changed. */
  setBulk(projectId: string, vars: Record<string, string>): boolean {
    const existing = this.db.getEnvVars(projectId);
    let changed = false;

    for (const [key, value] of Object.entries(vars)) {
      if (existing[key] !== value) {
        changed = true;
        break;
      }
    }

    if (changed) {
      this.db.setEnvVarsBulk(projectId, vars);
    }
    return changed;
  }

  /** Delete an env var. Returns true if container needs restart. */
  delete(projectId: string, key: string): boolean {
    const existing = this.db.getEnvVars(projectId);
    if (key in existing) {
      this.db.deleteEnvVar(projectId, key);
      return true;
    }
    return false;
  }

  /** Mask a value for display: sk-1234567890 → sk-****7890 */
  static mask(value: string): string {
    if (value.length <= 8) return '****';
    return value.slice(0, 3) + '****' + value.slice(-4);
  }

  /**
   * Find all projects using a specific env var key.
   * Used for bulk key rotation.
   */
  findProjectsWithKey(key: string): string[] {
    return this.db.findProjectsByEnvKey(key);
  }
}
