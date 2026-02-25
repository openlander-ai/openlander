import BetterSqlite3 from 'better-sqlite3';
import type BetterSqlite3Type from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { SCHEMA } from './schema.js';

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
  private db: BetterSqlite3Type.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new BetterSqlite3(dbPath);

    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.initialize();
  }

  /** Create tables if they don't exist. */
  private initialize(): void {
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    const columns = this.db
      .prepare("PRAGMA table_info('projects')")
      .all() as Array<{ name: string }>;
    const colNames = new Set(columns.map((c) => c.name));

    if (!colNames.has('parent_project_id')) {
      this.db.exec('ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE');
    }
    if (!colNames.has('dockerfile_path')) {
      this.db.exec("ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT 'Dockerfile'");
    }

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)');
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
    this.db
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, parent_project_id, dockerfile_path)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.repoUrl,
        project.branch ?? 'main',
        project.parentProjectId ?? null,
        project.dockerfilePath ?? 'Dockerfile',
      );

    const created = this.getProject(project.id);
    if (!created) throw new Error(`Failed to create project ${project.id}`);
    return created;
  }

  /** Get a project by ID. */
  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  /** Get a project by name. */
  getProjectByName(name: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | ProjectRow
      | undefined;
  }

  /** List all projects, optionally filtered by status. */
  listProjects(status?: ProjectRow['status']): ProjectRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC')
        .all(status) as ProjectRow[];
    }
    return this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[];
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
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.visibility !== undefined) {
      setClauses.push('visibility = ?');
      values.push(updates.visibility);
    }
    if (updates.assignedPort !== undefined) {
      setClauses.push('assigned_port = ?');
      values.push(updates.assignedPort);
    }
    if (updates.containerId !== undefined) {
      setClauses.push('container_id = ?');
      values.push(updates.containerId);
    }
    if (updates.imageTag !== undefined) {
      setClauses.push('image_tag = ?');
      values.push(updates.imageTag);
    }
    if (updates.previousImageTag !== undefined) {
      setClauses.push('previous_image_tag = ?');
      values.push(updates.previousImageTag);
    }
    if (updates.publicUrl !== undefined) {
      setClauses.push('public_url = ?');
      values.push(updates.publicUrl);
    }
    if (updates.parentProjectId !== undefined) {
      setClauses.push('parent_project_id = ?');
      values.push(updates.parentProjectId);
    }
    if (updates.dockerfilePath !== undefined) {
      setClauses.push('dockerfile_path = ?');
      values.push(updates.dockerfilePath);
    }

    if (setClauses.length === 0) return;

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Delete a project and all associated data (cascading). */
  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  /** Get child projects (services) of a parent project. */
  getChildProjects(parentId: string): ProjectRow[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE parent_project_id = ? ORDER BY name ASC')
      .all(parentId) as ProjectRow[];
  }

  /** Check if a project is a parent (has children). */
  isParentProject(id: string): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM projects WHERE parent_project_id = ?')
      .get(id) as { cnt: number };
    return row.cnt > 0;
  }

  // ===== Ports =====

  /** Get all ports currently assigned to projects. */
  getUsedPorts(): number[] {
    const rows = this.db
      .prepare('SELECT assigned_port FROM projects WHERE assigned_port IS NOT NULL')
      .all() as Array<{ assigned_port: number }>;
    return rows.map((r) => r.assigned_port);
  }

  // ===== Environment Variables =====

  /** Get environment variables for a project. */
  getEnvVars(projectId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM env_vars WHERE project_id = ?')
      .all(projectId) as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Set an environment variable for a project (upsert). */
  setEnvVar(projectId: string, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO env_vars (id, project_id, key, value)
         VALUES (lower(hex(randomblob(8))), ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(projectId, key, value);
  }

  /** Set multiple env vars at once (transactional). */
  setEnvVarsBulk(projectId: string, vars: Record<string, string>): void {
    const stmt = this.db.prepare(
      `INSERT INTO env_vars (id, project_id, key, value)
       VALUES (lower(hex(randomblob(8))), ?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
    );

    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(vars)) {
        stmt.run(projectId, key, value);
      }
    });

    transaction();
  }

  /** Delete an environment variable. */
  deleteEnvVar(projectId: string, key: string): void {
    this.db.prepare('DELETE FROM env_vars WHERE project_id = ? AND key = ?').run(projectId, key);
  }

  /** Find all projects that have a specific env var key. */
  findProjectsByEnvKey(key: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT project_id FROM env_vars WHERE key = ?')
      .all(key) as Array<{ project_id: string }>;
    return rows.map((r) => r.project_id);
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
      .prepare(
        `INSERT INTO deploy_logs (id, project_id, status, trigger, commit_sha, build_log, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.projectId,
        log.status,
        log.trigger,
        log.commitSha ?? null,
        log.buildLog ?? null,
        log.durationMs ?? null,
      );
  }

  /** Get deploy logs for a project, most recent first. */
  getDeployLogs(projectId: string, limit = 20): DeployLogRow[] {
    return this.db
      .prepare('SELECT * FROM deploy_logs WHERE project_id = ? ORDER BY rowid DESC LIMIT ?')
      .all(projectId, limit) as DeployLogRow[];
  }

  /** Get the most recent deploy log for a project. */
  getLastDeployLog(projectId: string): DeployLogRow | undefined {
    return this.db
      .prepare('SELECT * FROM deploy_logs WHERE project_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(projectId) as DeployLogRow | undefined;
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
      .prepare(
        `INSERT INTO chat_history (id, session_id, role, content, tool_calls)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.sessionId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      );
  }

  /** Get chat history for a session. */
  getChatHistory(sessionId: string, limit = 50): ChatHistoryRow[] {
    return this.db
      .prepare('SELECT * FROM chat_history WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(sessionId, limit) as ChatHistoryRow[];
  }

  /** List active chat sessions. */
  listChatSessions(): Array<{ session_id: string; message_count: number; last_message: string }> {
    return this.db
      .prepare(
        `SELECT session_id, COUNT(*) as message_count, MAX(created_at) as last_message
         FROM chat_history
         GROUP BY session_id
         ORDER BY last_message DESC`,
      )
      .all() as Array<{ session_id: string; message_count: number; last_message: string }>;
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
      .prepare(
        `INSERT INTO domain_mappings (id, project_id, domain, cloudflare_zone_id, cloudflare_dns_record_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        mapping.id,
        mapping.projectId,
        mapping.domain,
        mapping.cloudflareZoneId ?? null,
        mapping.cloudflareDnsRecordId ?? null,
      );
  }

  /** Get domain mappings for a project. */
  getDomainMappings(projectId: string): DomainMappingRow[] {
    return this.db
      .prepare('SELECT * FROM domain_mappings WHERE project_id = ?')
      .all(projectId) as DomainMappingRow[];
  }

  /** Get all domain mappings. */
  listDomainMappings(): DomainMappingRow[] {
    return this.db
      .prepare(
        `SELECT dm.*, p.name as project_name
         FROM domain_mappings dm
         JOIN projects p ON dm.project_id = p.id
         ORDER BY dm.created_at DESC`,
      )
      .all() as DomainMappingRow[];
  }

  /** Delete a domain mapping. */
  deleteDomainMapping(id: string): void {
    this.db.prepare('DELETE FROM domain_mappings WHERE id = ?').run(id);
  }

  getOAuthTokens(provider: string): OAuthTokenRow | undefined {
    return this.db.prepare('SELECT * FROM oauth_tokens WHERE provider = ?').get(provider) as
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
  }): void {
    this.db
      .prepare(
        `INSERT INTO oauth_tokens (id, provider, access_token, refresh_token, expires_at, token_type)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           token_type = excluded.token_type,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        token.id,
        token.provider,
        token.accessToken,
        token.refreshToken,
        token.expiresAt,
        token.tokenType,
      );
  }

  deleteOAuthTokens(provider: string): void {
    this.db.prepare('DELETE FROM oauth_tokens WHERE provider = ?').run(provider);
  }

  getWebhookConfig(
    projectId: string,
    source: WebhookConfigRow['source'],
  ): WebhookConfigRow | undefined {
    return this.db
      .prepare('SELECT * FROM webhook_configs WHERE project_id = ? AND source = ? LIMIT 1')
      .get(projectId, source) as WebhookConfigRow | undefined;
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
      .prepare(
        `INSERT INTO webhook_configs (id, project_id, source, secret, branch_filter, enabled)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, source) DO UPDATE SET
           secret = excluded.secret,
           branch_filter = excluded.branch_filter,
           enabled = excluded.enabled`,
      )
      .run(
        config.id,
        config.projectId,
        config.source,
        config.secret,
        config.branchFilter ?? 'main',
        config.enabled === false ? 0 : 1,
      );
  }

  setWebhookEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE webhook_configs SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  // ===== Utility =====

  /** Run a function inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
