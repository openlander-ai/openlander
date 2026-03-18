import type { Database } from '../db/index.js';
import { encrypt, decrypt } from '../env/crypto.js';

/**
 * Environment variable management for deployed projects.
 *
 * Handles two scopes:
 *   - **Project env vars**: per-project, stored as plaintext in `env_vars` table.
 *   - **Global secrets**: shared across all projects, AES-256-GCM encrypted in `global_secrets` table.
 *
 * At deploy time, global secrets and project env vars are merged (project overrides global).
 */
export class EnvManager {
  constructor(private readonly db: Database) {}

  private getProductionEnvironmentId(projectId: string): string | undefined {
    const production = this.db
      .getEnvironmentsByProject(projectId)
      .find((environment) => environment.type === 'production');
    return production?.id;
  }

  // ===== Project Env Vars (existing) =====

  /** Get all env vars for a project (values are raw, not masked). */
  getAll(projectId: string, environmentId?: string): Record<string, string> {
    return this.db.getEnvVars(projectId, environmentId);
  }

  /** Get all env vars for a project with masked values. */
  getAllMasked(projectId: string, environmentId?: string): Record<string, string> {
    const vars = this.db.getEnvVars(projectId, environmentId);
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      masked[key] = EnvManager.mask(value);
    }
    return masked;
  }

  /** Set a single env var. Returns true if container needs restart. */
  set(projectId: string, key: string, value: string, environmentId?: string): boolean {
    const existing = this.db.getEnvVars(projectId, environmentId);
    const changed = existing[key] !== value;
    if (changed) {
      this.db.setEnvVar(projectId, key, value, environmentId);
    }
    return changed;
  }

  /** Set multiple env vars at once. Returns true if any changed. */
  setBulk(projectId: string, vars: Record<string, string>, environmentId?: string): boolean {
    const existing = this.db.getEnvVars(projectId, environmentId);
    let changed = false;

    for (const [key, value] of Object.entries(vars)) {
      if (existing[key] !== value) {
        changed = true;
        break;
      }
    }

    for (const key of Object.keys(existing)) {
      if (!(key in vars)) {
        changed = true;
        break;
      }
    }

    if (changed) {
      this.db.setEnvVarsBulk(projectId, vars, environmentId);
    }
    return changed;
  }

  /** Delete an env var. Returns true if container needs restart. */
  delete(projectId: string, key: string, environmentId?: string): boolean {
    const existing = this.db.getEnvVars(projectId, environmentId);
    if (key in existing) {
      this.db.deleteEnvVar(projectId, key, environmentId);
      return true;
    }
    return false;
  }

  getAllWithInheritance(projectId: string, environmentId: string): Record<string, string> {
    const projectVars = this.db.getEnvVars(projectId);
    const productionEnvironmentId = this.getProductionEnvironmentId(projectId);
    const productionVars =
      productionEnvironmentId === undefined
        ? {}
        : this.db.getEnvVars(projectId, productionEnvironmentId);

    if (productionEnvironmentId === environmentId) {
      return { ...projectVars, ...productionVars };
    }

    const environmentVars = this.db.getEnvVars(projectId, environmentId);
    return { ...projectVars, ...productionVars, ...environmentVars };
  }

  getInheritanceInfo(
    projectId: string,
    environmentId: string,
  ): Record<
    string,
    {
      value: string;
      source: 'global' | 'project' | 'production' | 'environment';
      isOverride?: boolean;
    }
  > {
    const globalVars = this.getGlobalSecrets();
    const projectVars = this.db.getEnvVars(projectId);
    const productionEnvironmentId = this.getProductionEnvironmentId(projectId);
    const productionVars =
      productionEnvironmentId === undefined
        ? {}
        : this.db.getEnvVars(projectId, productionEnvironmentId);
    const environmentVars =
      productionEnvironmentId === environmentId ? {} : this.db.getEnvVars(projectId, environmentId);

    const inherited: Record<
      string,
      {
        value: string;
        source: 'global' | 'project' | 'production' | 'environment';
        isOverride?: boolean;
      }
    > = {};

    for (const [key, value] of Object.entries(globalVars)) {
      inherited[key] = { value, source: 'global' };
    }
    for (const [key, value] of Object.entries(projectVars)) {
      inherited[key] = { value, source: 'project' };
    }
    for (const [key, value] of Object.entries(productionVars)) {
      inherited[key] = { value, source: 'production' };
    }
    for (const [key, value] of Object.entries(environmentVars)) {
      const isOverride = key in inherited;
      inherited[key] = { value, source: 'environment', isOverride };
    }

    return inherited;
  }

  /** Find all projects using a specific env var key. */
  findProjectsWithKey(key: string): string[] {
    return this.db.findProjectsByEnvKey(key);
  }

  // ===== Global Secrets (v0.0.10) =====

  /** Set a global secret (encrypts before storing). */
  setGlobalSecret(key: string, value: string, description?: string): void {
    const { encrypted, iv } = encrypt(value);
    this.db.setGlobalSecret(key, encrypted, iv, description);
  }

  /** Get all global secrets as decrypted key-value pairs. */
  getGlobalSecrets(): Record<string, string> {
    const rows = this.db.getGlobalSecrets();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = decrypt(row.encrypted_value, row.iv);
    }
    return result;
  }

  /** Get all global secrets with masked values (for display). */
  getGlobalSecretsMasked(): Array<{
    key: string;
    maskedValue: string;
    description: string | null;
  }> {
    const rows = this.db.getGlobalSecrets();
    return rows.map((row) => {
      const plaintext = decrypt(row.encrypted_value, row.iv);
      return {
        key: row.key,
        maskedValue: EnvManager.mask(plaintext),
        description: row.description,
      };
    });
  }

  /** Delete a global secret. Returns true if it existed. */
  deleteGlobalSecret(key: string): boolean {
    return this.db.deleteGlobalSecret(key);
  }

  /**
   * Get merged env vars for deployment.
   * Global secrets form the base, project-level env vars override.
   */
  getMergedForDeploy(projectId: string, environmentId?: string): Record<string, string> {
    const globalVars = this.getGlobalSecrets();
    const projectVars =
      environmentId === undefined
        ? this.db.getEnvVars(projectId)
        : this.getAllWithInheritance(projectId, environmentId);
    return { ...globalVars, ...projectVars };
  }

  // ===== Secret Files =====

  uploadSecretFile(
    projectId: string | null,
    filename: string,
    content: string,
    mountPath: string = '/run/secrets',
  ): void {
    const { encrypted, iv } = encrypt(content);
    this.db.upsertSecretFile(projectId, filename, encrypted, iv, mountPath);
  }

  listSecretFiles(
    projectId: string | null,
  ): Array<{ filename: string; mountPath: string; scope: 'project' | 'global' }> {
    const rows = this.db.getSecretFiles(projectId);
    return rows.map((r) => ({
      filename: r.filename,
      mountPath: `${r.mount_path}/${r.filename}`,
      scope: r.project_id ? 'project' : 'global',
    }));
  }

  removeSecretFile(projectId: string | null, filename: string): boolean {
    return this.db.deleteSecretFile(projectId, filename);
  }

  getSecretFilesForDeploy(projectId: string): Array<{
    filename: string;
    content: string;
    mountPath: string;
  }> {
    const rows = this.db.getSecretFilesForDeploy(projectId);
    return rows.map((r) => ({
      filename: r.filename,
      content: decrypt(r.encrypted_content, r.iv),
      mountPath: `${r.mount_path}/${r.filename}`,
    }));
  }

  // ===== Masking =====

  /** Mask a value for display: sk-1234567890 → sk-****7890 */
  static mask(value: string): string {
    if (value.length <= 8) return '****';
    return value.slice(0, 3) + '****' + value.slice(-4);
  }

  /** Check if a key name suggests it's a secret. */
  static isSensitiveKey(key: string): boolean {
    const patterns = [
      /_SECRET$/i,
      /_KEY$/i,
      /_TOKEN$/i,
      /_PASSWORD$/i,
      /^SECRET_/i,
      /^API_KEY/i,
      /^AUTH_/i,
      /_DSN$/i,
    ];
    return patterns.some((p) => p.test(key));
  }
}
