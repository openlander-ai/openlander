import type { Database } from '../db/index.js';
import type { EnvVarChange } from '../db/repos/env-var.repo.js';
import { encrypt, decrypt } from '../env/crypto.js';

export type EnvVarChangeResult = EnvVarChange;

/**
 * Environment variable management for deployable services.
 *
 * Handles two scopes:
 *   - **Service env vars**: per-service, stored as plaintext in `env_vars` table.
 *   - **Group compatibility env vars**: project-scoped rows used only for empty groups/legacy API.
 *   - **Global secrets**: shared across all projects, AES-256-GCM encrypted in `global_secrets` table.
 *
 * At deploy time, global secrets and service env vars are merged (service overrides global).
 */
export class EnvManager {
  constructor(private readonly db: Database) {}

  private async getProductionEnvironmentId(projectId: string): Promise<string | undefined> {
    const environments = await this.db.getEnvironmentsByProject(projectId);
    const production = environments.find((environment) => environment.type === 'production');
    return production?.id;
  }

  // ===== Group compatibility Env Vars =====

  /** Get all env vars for a project (values are raw, not masked). */
  getAll(projectId: string, environmentId?: string): Promise<Record<string, string>> {
    return this.db.getEnvVars(projectId, environmentId);
  }

  /** Get all env vars for a project with masked values. */
  async getAllMasked(projectId: string, environmentId?: string): Promise<Record<string, string>> {
    const vars = await this.db.getEnvVars(projectId, environmentId);
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      masked[key] = EnvManager.maskForKey(key, value);
    }
    return masked;
  }

  /** Get all env vars for a deployable service (values are raw, not masked). */
  getAllForService(projectId: string, serviceId: string): Promise<Record<string, string>> {
    return this.db.getEnvVarsForService(projectId, serviceId);
  }

  /** Get all env vars for a deployable service with masked values. */
  async getAllForServiceMasked(
    projectId: string,
    serviceId: string,
  ): Promise<Record<string, string>> {
    const vars = await this.db.getEnvVarsForService(projectId, serviceId);
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      masked[key] = EnvManager.maskForKey(key, value);
    }
    return masked;
  }

  /** Get all env vars for a project with inheritance (project + production) with masked values. */
  async getAllWithInheritanceMasked(projectId: string): Promise<Record<string, string>> {
    const productionEnvironmentId = await this.getProductionEnvironmentId(projectId);
    const vars = await this.getAllWithInheritance(projectId, productionEnvironmentId || '');
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      masked[key] = EnvManager.maskForKey(key, value);
    }
    return masked;
  }

  /** Set a single env var. Returns true if container needs restart. */
  async set(
    projectId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<boolean> {
    const existing = await this.db.getEnvVars(projectId, environmentId);
    const changed = existing[key] !== value;
    if (changed) {
      await this.db.setEnvVar(projectId, key, value, environmentId);
    }
    return changed;
  }

  /** Set multiple env vars at once (merge — existing keys not in `vars` are preserved). Returns true if any changed. */
  async setBulk(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<boolean> {
    const changes = await this.setBulkDetailed(projectId, vars, environmentId);
    return changes.some((change) => change.op !== 'noop');
  }

  async setBulkDetailed(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<EnvVarChangeResult[]> {
    void environmentId;
    return await this.db.mergeEnvVarsDetailed(projectId, vars);
  }

  async setBulkForService(
    projectId: string,
    serviceId: string,
    vars: Record<string, string>,
  ): Promise<boolean> {
    const changes = await this.setBulkForServiceDetailed(projectId, serviceId, vars);
    return changes.some((change) => change.op !== 'noop');
  }

  async setBulkForServiceDetailed(
    projectId: string,
    serviceId: string,
    vars: Record<string, string>,
  ): Promise<EnvVarChangeResult[]> {
    return await this.db.mergeEnvVarsForServiceDetailed(projectId, serviceId, vars);
  }

  async verifyRoundTrip(
    projectId: string,
    expected: Record<string, string>,
    environmentId?: string,
  ): Promise<string[]> {
    const stored = await this.db.getEnvVars(projectId, environmentId);
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (stored[key] !== value) {
        mismatches.push(key);
      }
    }
    return mismatches;
  }

  async verifyRoundTripForService(
    projectId: string,
    serviceId: string,
    expected: Record<string, string>,
  ): Promise<string[]> {
    const stored = await this.db.getEnvVarsForService(projectId, serviceId);
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      if (stored[key] !== value) {
        mismatches.push(key);
      }
    }
    return mismatches;
  }

  /** Delete an env var. Returns true if container needs restart. */
  async delete(projectId: string, key: string, environmentId?: string): Promise<boolean> {
    const existing = await this.db.getEnvVars(projectId, environmentId);
    if (key in existing) {
      await this.db.deleteEnvVar(projectId, key, environmentId);
      return true;
    }
    return false;
  }

  async deleteForService(projectId: string, serviceId: string, key: string): Promise<boolean> {
    const existing = await this.db.getEnvVarsForService(projectId, serviceId);
    if (key in existing) {
      await this.db.deleteEnvVarForService(projectId, serviceId, key);
      return true;
    }
    return false;
  }

  async deleteBulk(
    projectId: string,
    keys: string[],
    environmentId?: string,
  ): Promise<{ deleted: string[]; notFound: string[]; changed: boolean }> {
    const existing = await this.db.getEnvVars(projectId, environmentId);
    const deleted: string[] = [];
    const notFound: string[] = [];

    for (const key of keys) {
      if (key in existing) {
        await this.db.deleteEnvVar(projectId, key, environmentId);
        deleted.push(key);
      } else {
        notFound.push(key);
      }
    }

    return { deleted, notFound, changed: deleted.length > 0 };
  }

  async deleteBulkForService(
    projectId: string,
    serviceId: string,
    keys: string[],
  ): Promise<{ deleted: string[]; notFound: string[]; changed: boolean }> {
    const existing = await this.db.getEnvVarsForService(projectId, serviceId);
    const deleted: string[] = [];
    const notFound: string[] = [];

    for (const key of keys) {
      if (key in existing) {
        await this.db.deleteEnvVarForService(projectId, serviceId, key);
        deleted.push(key);
      } else {
        notFound.push(key);
      }
    }

    return { deleted, notFound, changed: deleted.length > 0 };
  }

  async getAllWithInheritance(
    projectId: string,
    environmentId: string,
  ): Promise<Record<string, string>> {
    const projectVars = await this.db.getEnvVars(projectId);
    const productionEnvironmentId = await this.getProductionEnvironmentId(projectId);
    const productionVars =
      productionEnvironmentId === undefined
        ? {}
        : await this.db.getEnvVars(projectId, productionEnvironmentId);

    if (productionEnvironmentId === environmentId) {
      return { ...projectVars, ...productionVars };
    }

    const environmentVars = await this.db.getEnvVars(projectId, environmentId);
    return { ...projectVars, ...productionVars, ...environmentVars };
  }

  async getInheritanceInfo(
    projectId: string,
    environmentId: string,
  ): Promise<
    Record<
      string,
      {
        value: string;
        source: 'global' | 'project' | 'production' | 'environment';
        isOverride?: boolean;
      }
    >
  > {
    const globalVars = await this.getGlobalSecrets();
    const projectVars = await this.db.getEnvVars(projectId);
    const productionEnvironmentId = await this.getProductionEnvironmentId(projectId);
    const productionVars =
      productionEnvironmentId === undefined
        ? {}
        : await this.db.getEnvVars(projectId, productionEnvironmentId);
    const environmentVars =
      productionEnvironmentId === environmentId
        ? {}
        : await this.db.getEnvVars(projectId, environmentId);

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
  findProjectsWithKey(key: string): Promise<string[]> {
    return this.db.findProjectsByEnvKey(key);
  }

  // ===== Global Secrets (v0.0.10) =====

  /** Set a global secret (encrypts before storing). */
  async setGlobalSecret(key: string, value: string, description?: string): Promise<void> {
    const { encrypted, iv } = encrypt(value);
    await this.db.setGlobalSecret(key, encrypted, iv, description);
  }

  /** Get all global secrets as decrypted key-value pairs. */
  async getGlobalSecrets(): Promise<Record<string, string>> {
    const rows = await this.db.getGlobalSecrets();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = decrypt(row.encrypted_value, row.iv);
    }
    return result;
  }

  /** Get all global secrets with masked values (for display). */
  async getGlobalSecretsMasked(): Promise<
    Array<{
      key: string;
      maskedValue: string;
      description: string | null;
    }>
  > {
    const rows = await this.db.getGlobalSecrets();
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
  deleteGlobalSecret(key: string): Promise<boolean> {
    return this.db.deleteGlobalSecret(key);
  }

  /**
   * Get merged env vars for deployment.
   * Global secrets form the base, project-level env vars override.
   * @deprecated Use resolveEnvVars() instead.
   */
  async getMergedForDeploy(
    projectId: string,
    environmentId?: string,
  ): Promise<Record<string, string>> {
    const globalVars = await this.getGlobalSecrets();
    const projectVars =
      environmentId === undefined
        ? await this.db.getEnvVars(projectId)
        : await this.getAllWithInheritance(projectId, environmentId);
    return { ...globalVars, ...projectVars };
  }

  // ===== Secret Files =====

  async uploadSecretFile(
    projectId: string | null,
    filename: string,
    content: string,
    mountPath: string = '/run/secrets',
  ): Promise<void> {
    const { encrypted, iv } = encrypt(content);
    await this.db.upsertSecretFile(projectId, filename, encrypted, iv, mountPath);
  }

  async listSecretFiles(
    projectId: string | null,
  ): Promise<Array<{ filename: string; mountPath: string; scope: 'project' | 'global' }>> {
    const rows = await this.db.getSecretFiles(projectId);
    return rows.map((r) => ({
      filename: r.filename,
      mountPath: `${r.mount_path}/${r.filename}`,
      scope: r.project_id ? 'project' : 'global',
    }));
  }

  removeSecretFile(projectId: string | null, filename: string): Promise<boolean> {
    return this.db.deleteSecretFile(projectId, filename);
  }

  async getSecretFilesForDeploy(projectId: string): Promise<
    Array<{
      filename: string;
      content: string;
      mountPath: string;
    }>
  > {
    const rows = await this.db.getSecretFilesForDeploy(projectId);
    return rows.map((r) => ({
      filename: r.filename,
      content: decrypt(r.encrypted_content, r.iv),
      mountPath: `${r.mount_path}/${r.filename}`,
    }));
  }

  // ===== Masking =====

  /** Mask a value for display: sk-1234567890 → sk-****7890 */
  static mask(value: string): string {
    if (value === '') return '""';
    if (value.length <= 8) return '****';
    return value.slice(0, 3) + '****' + value.slice(-4);
  }

  static maskForKey(key: string, value: string): string {
    if (value === '') return '""';
    if (EnvManager.isPublicKey(key)) return value;
    return EnvManager.mask(value);
  }

  static isPublicKey(key: string): boolean {
    return (
      key.startsWith('NEXT_PUBLIC_') ||
      key.startsWith('PUBLIC_') ||
      key.startsWith('VITE_PUBLIC_') ||
      key.startsWith('NUXT_PUBLIC_')
    );
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
