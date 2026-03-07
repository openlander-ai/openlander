import type BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { ProjectAlreadyExistsError } from '../errors.js';

import { createDrizzleDatabase, type DrizzleClient } from './drizzle.js';
import { SCHEMA } from './schema.js';
import {
  chatHistory,
  deployLogs,
  domainMappings,
  envVars,
  globalSecrets,
  oauthTokens,
  projects,
  webhookConfigs,
} from './schema.drizzle.js';

// --- Row types (match DB schema) ---

export interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  visibility: 'internal' | 'quick-share' | 'production';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  parent_project_id: string | null;
  dockerfile_path: string;
  created_at: string;
  updated_at: string;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
}

export interface DeployLogRow {
  id: string;
  project_id: string;
  status: 'success' | 'failed' | 'cancelled';
  trigger: 'chat' | 'webhook' | 'api';
  commit_sha: string | null;
  build_log: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ChatHistoryRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: string | null;
  created_at: string;
}

export interface DomainMappingRow {
  id: string;
  project_id: string;
  domain: string;
  cloudflare_zone_id: string | null;
  cloudflare_dns_record_id: string | null;
  status: 'active' | 'pending' | 'error';
  created_at: string;
}

export interface OAuthTokenRow {
  id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  token_type: string;
  auth_method: string | null;
  user_email: string | null;
  iv: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookConfigRow {
  id: string;
  project_id: string;
  source: 'github' | 'gitlab' | 'bitbucket';
  secret: string;
  branch_filter: string;
  enabled: 0 | 1;
  created_at: string;
}

// --- Database class ---

/**
 * SQLite database for OpenLander state.
 *
 * Stores: projects, env vars, deploy logs, chat history, domain mappings.
 * Uses WAL mode for better concurrent read performance.
 */
export class Database {
  private sqlite: BetterSqlite3.Database;
  private db: DrizzleClient;

  constructor(dbPath: string) {
    // Ensure directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    const { sqlite, db } = createDrizzleDatabase(dbPath);
    this.sqlite = sqlite;
    this.db = db;

    this.initialize();
  }

  /** Create tables if they don't exist. */
  private initialize(): void {
    this.sqlite.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    const columns = this.sqlite.prepare("PRAGMA table_info('projects')").all() as Array<{
      name: string;
    }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('parent_project_id')) {
      this.sqlite.exec(
        'ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE',
      );
    }
    if (!colNames.has('dockerfile_path')) {
      this.sqlite.exec("ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT 'Dockerfile'");
    }
    if (!colNames.has('deploy_lock_session')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_session TEXT DEFAULT NULL');
    }
    if (!colNames.has('deploy_lock_at')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_at DATETIME DEFAULT NULL');
    }

    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)',
    );

    // deploy_logs migrations
    const dlCols = this.sqlite.prepare("PRAGMA table_info('deploy_logs')").all() as Array<{
      name: string;
    }>;
    const dlColNames = new Set(dlCols.map((c) => c.name));

    if (!dlColNames.has('trigger_source')) {
      this.sqlite.exec(
        "ALTER TABLE deploy_logs ADD COLUMN trigger_source TEXT CHECK(trigger_source IN ('chat', 'webhook', 'api'))",
      );
    }

    // global_secrets table (v0.0.10)
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS global_secrets (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      encrypted_value TEXT NOT NULL,
      iv TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key)');
  }

  // ===== Projects =====

  /** Create a new project. */
  createProject(project: {
    id: string;
    name: string;
    repoUrl: string;
    branch?: string;
    parentProjectId?: string;
    dockerfilePath?: string;
  }): ProjectRow {
    try {
      this.db
        .insert(projects)
        .values({
          id: project.id,
          name: project.name,
          repo_url: project.repoUrl,
          branch: project.branch ?? 'main',
          parent_project_id: project.parentProjectId ?? null,
          dockerfile_path: project.dockerfilePath ?? 'Dockerfile',
        })
        .run();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ProjectAlreadyExistsError(project.name);
      }
      throw error;
    }

    const created = this.getProject(project.id);
    if (!created) throw new Error(`Failed to create project ${project.id}`);
    return created;
  }

  /** Get a project by ID. */
  getProject(id: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get() as
      | ProjectRow
      | undefined;
  }

  /** Get a project by name. */
  getProjectByName(name: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.name, name)).get() as
      | ProjectRow
      | undefined;
  }

  /** List all projects, optionally filtered by status. */
  listProjects(status?: ProjectRow['status']): ProjectRow[] {
    if (status) {
      return this.db
        .select()
        .from(projects)
        .where(eq(projects.status, status))
        .orderBy(desc(projects.updated_at))
        .all() as ProjectRow[];
    }
    return this.db.select().from(projects).orderBy(desc(projects.updated_at)).all() as ProjectRow[];
  }

  /** Update project fields. Only provided fields are updated. */
  updateProject(
    id: string,
    updates: Partial<{
      status: ProjectRow['status'];
      visibility: ProjectRow['visibility'];
      assignedPort: number | null;
      containerId: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      publicUrl: string | null;
      parentProjectId: string | null;
      dockerfilePath: string;
    }>,
  ): void {
    const setValues: Partial<typeof projects.$inferInsert> = {};

    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.visibility !== undefined) {
      setValues.visibility = updates.visibility;
    }
    if (updates.assignedPort !== undefined) {
      setValues.assigned_port = updates.assignedPort;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }
    if (updates.imageTag !== undefined) {
      setValues.image_tag = updates.imageTag;
    }
    if (updates.previousImageTag !== undefined) {
      setValues.previous_image_tag = updates.previousImageTag;
    }
    if (updates.publicUrl !== undefined) {
      setValues.public_url = updates.publicUrl;
    }
    if (updates.parentProjectId !== undefined) {
      setValues.parent_project_id = updates.parentProjectId;
    }
    if (updates.dockerfilePath !== undefined) {
      setValues.dockerfile_path = updates.dockerfilePath;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(projects)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .run();
  }

  /** Delete a project and all associated data (cascading). */
  deleteProject(id: string): void {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }

  /** Get child projects (services) of a parent project. */
  getChildProjects(parentId: string): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.parent_project_id, parentId))
      .orderBy(asc(projects.name))
      .all() as ProjectRow[];
  }

  /** Check if a project is a parent (has children). */
  isParentProject(id: string): boolean {
    const row = this.db
      .select({ cnt: count() })
      .from(projects)
      .where(eq(projects.parent_project_id, id))
      .get();
    return (row?.cnt ?? 0) > 0;
  }

  // ===== Ports =====

  /** Get all ports currently assigned to projects. */
  getUsedPorts(): number[] {
    const rows = this.db
      .select({ assigned_port: projects.assigned_port })
      .from(projects)
      .where(isNotNull(projects.assigned_port))
      .all();
    return rows.flatMap((r) => (r.assigned_port === null ? [] : [r.assigned_port]));
  }

  // ===== Environment Variables =====

  /** Get environment variables for a project. */
  getEnvVars(projectId: string): Record<string, string> {
    const rows = this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(eq(envVars.project_id, projectId))
      .all();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Set an environment variable for a project (upsert). */
  setEnvVar(projectId: string, key: string, value: string): void {
    this.db
      .insert(envVars)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        project_id: projectId,
        key,
        value,
      })
      .onConflictDoUpdate({
        target: [envVars.project_id, envVars.key],
        set: { value },
      })
      .run();
  }

  /** Set multiple env vars at once (transactional). */
  setEnvVarsBulk(projectId: string, vars: Record<string, string>): void {
    const transaction = this.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(vars)) {
        this.db
          .insert(envVars)
          .values({
            id: sql<string>`lower(hex(randomblob(8)))`,
            project_id: projectId,
            key,
            value,
          })
          .onConflictDoUpdate({
            target: [envVars.project_id, envVars.key],
            set: { value },
          })
          .run();
      }
    });

    transaction();
  }

  /** Delete an environment variable. */
  deleteEnvVar(projectId: string, key: string): void {
    this.db
      .delete(envVars)
      .where(and(eq(envVars.project_id, projectId), eq(envVars.key, key)))
      .run();
  }

  /** Find all projects that have a specific env var key. */
  findProjectsByEnvKey(key: string): string[] {
    const rows = this.db
      .selectDistinct({ project_id: envVars.project_id })
      .from(envVars)
      .where(eq(envVars.key, key))
      .all();
    return rows.map((r: { project_id: string }) => r.project_id);
  }

  // ===== Global Secrets =====

  /** Get all global secrets (encrypted values — caller must decrypt). */
  getGlobalSecrets(): Array<{
    id: string;
    key: string;
    encrypted_value: string;
    iv: string;
    description: string | null;
    created_at: string | null;
    updated_at: string | null;
  }> {
    return this.db.select().from(globalSecrets).orderBy(asc(globalSecrets.key)).all();
  }

  /** Get a single global secret by key. */
  getGlobalSecret(key: string):
    | {
        id: string;
        key: string;
        encrypted_value: string;
        iv: string;
        description: string | null;
      }
    | undefined {
    return this.db.select().from(globalSecrets).where(eq(globalSecrets.key, key)).get();
  }

  /** Upsert a global secret (values must already be encrypted). */
  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string): void {
    this.db
      .insert(globalSecrets)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        key,
        encrypted_value: encryptedValue,
        iv,
        description: description ?? null,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: globalSecrets.key,
        set: {
          encrypted_value: encryptedValue,
          iv,
          description: description ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  /** Delete a global secret by key. Returns true if it existed. */
  deleteGlobalSecret(key: string): boolean {
    const existing = this.getGlobalSecret(key);
    if (!existing) return false;
    this.db.delete(globalSecrets).where(eq(globalSecrets.key, key)).run();
    return true;
  }

  // ===== Deploy Logs =====

  /** Record a deployment log entry. */
  createDeployLog(log: {
    id: string;
    projectId: string;
    status: DeployLogRow['status'];
    trigger: DeployLogRow['trigger'];
    commitSha?: string;
    buildLog?: string;
    durationMs?: number;
  }): void {
    this.db
      .insert(deployLogs)
      .values({
        id: log.id,
        project_id: log.projectId,
        status: log.status,
        trigger: log.trigger,
        commit_sha: log.commitSha ?? null,
        build_log: log.buildLog ?? null,
        duration_ms: log.durationMs ?? null,
      })
      .run();
  }

  /** Get deploy logs for a project, most recent first. */
  getDeployLogs(projectId: string, limit = 20): DeployLogRow[] {
    return this.db
      .select()
      .from(deployLogs)
      .where(eq(deployLogs.project_id, projectId))
      .orderBy(desc(sql`rowid`))
      .limit(limit)
      .all() as DeployLogRow[];
  }

  /** Get the most recent deploy log for a project. */
  getLastDeployLog(projectId: string): DeployLogRow | undefined {
    return this.db
      .select()
      .from(deployLogs)
      .where(eq(deployLogs.project_id, projectId))
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get() as DeployLogRow | undefined;
  }

  /** Get a single deploy log by ID. */
  getDeployLog(deployId: string): DeployLogRow | undefined {
    return this.db.select().from(deployLogs).where(eq(deployLogs.id, deployId)).get() as
      | DeployLogRow
      | undefined;
  }

  // ===== Chat History =====

  /** Save a chat message. */
  saveChatMessage(msg: {
    id: string;
    sessionId: string;
    role: ChatHistoryRow['role'];
    content: string;
    toolCalls?: unknown;
  }): void {
    this.db
      .insert(chatHistory)
      .values({
        id: msg.id,
        session_id: msg.sessionId,
        role: msg.role,
        content: msg.content,
        tool_calls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      })
      .run();
  }

  /** Get chat history for a session. */
  getChatHistory(sessionId: string, limit = 50): ChatHistoryRow[] {
    return this.db
      .select()
      .from(chatHistory)
      .where(eq(chatHistory.session_id, sessionId))
      .orderBy(asc(chatHistory.created_at))
      .limit(limit)
      .all() as ChatHistoryRow[];
  }

  /** List active chat sessions. */
  listChatSessions(): Array<{ session_id: string; message_count: number; last_message: string }> {
    return this.db
      .select({
        session_id: chatHistory.session_id,
        message_count: count(),
        last_message: sql<string>`max(${chatHistory.created_at})`,
      })
      .from(chatHistory)
      .groupBy(chatHistory.session_id)
      .orderBy(desc(sql`max(${chatHistory.created_at})`))
      .all() as Array<{
      session_id: string;
      message_count: number;
      last_message: string;
    }>;
  }

  // ===== Domain Mappings (v0.2 forward-compat) =====

  /** Create a domain mapping. */
  createDomainMapping(mapping: {
    id: string;
    projectId: string;
    domain: string;
    cloudflareZoneId?: string;
    cloudflareDnsRecordId?: string;
  }): void {
    this.db
      .insert(domainMappings)
      .values({
        id: mapping.id,
        project_id: mapping.projectId,
        domain: mapping.domain,
        cloudflare_zone_id: mapping.cloudflareZoneId ?? null,
        cloudflare_dns_record_id: mapping.cloudflareDnsRecordId ?? null,
      })
      .run();
  }

  /** Get domain mappings for a project. */
  getDomainMappings(projectId: string): DomainMappingRow[] {
    return this.db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.project_id, projectId))
      .all() as DomainMappingRow[];
  }

  /** Get all domain mappings. */
  listDomainMappings(): DomainMappingRow[] {
    return this.db
      .select({
        id: domainMappings.id,
        project_id: domainMappings.project_id,
        domain: domainMappings.domain,
        cloudflare_zone_id: domainMappings.cloudflare_zone_id,
        cloudflare_dns_record_id: domainMappings.cloudflare_dns_record_id,
        status: domainMappings.status,
        created_at: domainMappings.created_at,
        project_name: projects.name,
      })
      .from(domainMappings)
      .innerJoin(projects, eq(domainMappings.project_id, projects.id))
      .orderBy(desc(domainMappings.created_at))
      .all() as DomainMappingRow[];
  }

  /** Delete a domain mapping. */
  deleteDomainMapping(id: string): void {
    this.db.delete(domainMappings).where(eq(domainMappings.id, id)).run();
  }

  getOAuthTokens(provider: string): OAuthTokenRow | undefined {
    return this.db.select().from(oauthTokens).where(eq(oauthTokens.provider, provider)).get() as
      | OAuthTokenRow
      | undefined;
  }

  upsertOAuthTokens(token: {
    id: string;
    provider: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
    tokenType: string;
    authMethod?: string;
    userEmail?: string | null;
    iv?: string;
  }): void {
    this.db
      .insert(oauthTokens)
      .values({
        id: token.id,
        provider: token.provider,
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
        token_type: token.tokenType,
        auth_method: token.authMethod ?? 'manual',
        user_email: token.userEmail ?? null,
        iv: token.iv ?? null,
      })
      .onConflictDoUpdate({
        target: oauthTokens.provider,
        set: {
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          expires_at: token.expiresAt,
          token_type: token.tokenType,
          auth_method: token.authMethod ?? 'manual',
          user_email: token.userEmail ?? null,
          iv: token.iv ?? null,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  deleteOAuthTokens(provider: string): void {
    this.db.delete(oauthTokens).where(eq(oauthTokens.provider, provider)).run();
  }

  getWebhookConfig(
    projectId: string,
    source: WebhookConfigRow['source'],
  ): WebhookConfigRow | undefined {
    return this.db
      .select()
      .from(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)))
      .limit(1)
      .get() as WebhookConfigRow | undefined;
  }

  setWebhookConfig(config: {
    id: string;
    projectId: string;
    source: WebhookConfigRow['source'];
    secret: string;
    branchFilter?: string;
    enabled?: boolean;
  }): void {
    this.db
      .insert(webhookConfigs)
      .values({
        id: config.id,
        project_id: config.projectId,
        source: config.source,
        secret: config.secret,
        branch_filter: config.branchFilter ?? 'main',
        enabled: config.enabled === false ? 0 : 1,
      })
      .onConflictDoUpdate({
        target: [webhookConfigs.project_id, webhookConfigs.source],
        set: {
          secret: config.secret,
          branch_filter: config.branchFilter ?? 'main',
          enabled: config.enabled === false ? 0 : 1,
        },
      })
      .run();
  }

  setWebhookEnabled(id: string, enabled: boolean): void {
    this.db
      .update(webhookConfigs)
      .set({ enabled: enabled ? 1 : 0 })
      .where(eq(webhookConfigs.id, id))
      .run();
  }

  // ===== Deploy Lock =====

  /** Acquire a deploy lock for a project. Returns true if lock was acquired. */
  acquireDeployLock(projectId: string, sessionId: string): boolean {
    this.cleanExpiredDeployLocks();
    const project = this.getProject(projectId);
    if (!project) return false;
    if (project.deploy_lock_session && project.deploy_lock_session !== sessionId) {
      return false;
    }
    this.db
      .update(projects)
      .set({
        deploy_lock_session: sessionId,
        deploy_lock_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projects.id, projectId))
      .run();
    return true;
  }

  /** Release a deploy lock for a project. */
  releaseDeployLock(projectId: string): void {
    this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, projectId))
      .run();
  }

  /** Get deploy lock info for a project. */
  getDeployLockInfo(projectId: string): { session: string; lockedAt: string } | null {
    const project = this.getProject(projectId);
    if (!project?.deploy_lock_session || !project.deploy_lock_at) return null;
    return { session: project.deploy_lock_session, lockedAt: project.deploy_lock_at };
  }

  /** Clean expired deploy locks (default: 10 min timeout). Returns count of cleaned locks. */
  cleanExpiredDeployLocks(timeoutMinutes = 10): number {
    this.db
      .update(projects)
      .set({ deploy_lock_session: null, deploy_lock_at: null })
      .where(
        sql`${projects.deploy_lock_session} IS NOT NULL AND ${projects.deploy_lock_at} < datetime('now', '-' || ${timeoutMinutes} || ' minutes')`,
      )
      .run();
    const row = this.sqlite.prepare('SELECT changes() as changes').get() as {
      changes: number;
    } | null;
    return row?.changes ?? 0;
  }
  // ===== Utility =====

  /** Run a function inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }

  /** Close the database connection. */
  close(): void {
    this.sqlite.close();
  }
}
