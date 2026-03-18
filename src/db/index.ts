import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { ProjectAlreadyExistsError } from '../errors.js';

import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from './drizzle.js';
import { SCHEMA } from './schema.js';
import {
  chatHistory,
  deployLogs,
  domainMappings,
  environments,
  envVars,
  globalSecrets,
  oauthTokens,
  projects,
  secretFiles,
  services,
  timelineEvents,
  webhookConfigs,
} from './schema.drizzle.js';

// --- Row types (match DB schema) ---

export type EnvironmentType = 'production' | 'development';

export interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  visibility: 'internal' | 'quick-share' | 'shared' | 'production';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  parent_project_id: string | null;
  dockerfile_path: string;
  docker_target: string | null;
  pending_fix: string | null;
  created_at: string;
  updated_at: string;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
  access_code: string | null;
  access_code_iv: string | null;
  is_preview: 0 | 1;
  pr_number: number | null;
}

export interface EnvironmentRow {
  id: string;
  project_id: string;
  type: EnvironmentType;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeployLogRow {
  id: string;
  project_id: string;
  environment_id: string | null;
  status: 'success' | 'failed' | 'cancelled';
  trigger: 'chat' | 'webhook' | 'api';
  commit_sha: string | null;
  build_log: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface TimelineEventRow {
  id: string;
  project_id: string;
  deploy_id: string | null;
  type: string;
  message: string;
  detail: string | null;
  severity: string | null;
  percent: number | null;
  tool_name: string | null;
  action_buttons: string | null;
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

export interface ServiceRow {
  id: string;
  name: string;
  type: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  container_id: string | null;
  container_name: string;
  port: number;
  env_vars: string | null;
  credentials: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingFixRow {
  filePath: string;
  content: string;
}

// --- Database class ---

/**
 * SQLite database for OpenLander state.
 *
 * Stores: projects, env vars, deploy logs, chat history, domain mappings.
 * Uses WAL mode for better concurrent read performance.
 */
export class Database {
  private sqlite: SqliteDatabase;
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
    if (!colNames.has('docker_target')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN docker_target TEXT DEFAULT NULL');
    }
    if (!colNames.has('pending_fix')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN pending_fix TEXT DEFAULT NULL');
    }
    if (!colNames.has('deploy_lock_session')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_session TEXT DEFAULT NULL');
    }
    if (!colNames.has('deploy_lock_at')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_at DATETIME DEFAULT NULL');
    }
    if (!colNames.has('access_code')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN access_code TEXT');
    }
    if (!colNames.has('access_code_iv')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN access_code_iv TEXT');
    }
    if (!colNames.has('is_preview')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN is_preview INTEGER DEFAULT 0');
    }
    if (!colNames.has('pr_number')) {
      this.sqlite.exec('ALTER TABLE projects ADD COLUMN pr_number INTEGER');
    }

    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)',
    );

    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('production', 'development')),
      branch TEXT NOT NULL DEFAULT 'main',
      status TEXT DEFAULT 'idle' CHECK(status IN ('running', 'stopped', 'building', 'error', 'idle')),
      assigned_port INTEGER UNIQUE,
      container_id TEXT,
      image_tag TEXT,
      previous_image_tag TEXT,
      public_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, type)
    )`);
    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)',
    );

    const envVarColumns = this.sqlite.prepare("PRAGMA table_info('env_vars')").all() as Array<{
      name: string;
    }>;
    const envVarColumnNames = new Set(envVarColumns.map((c) => c.name));
    const envVarTable = this.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'env_vars'")
      .get() as { sql: string | null } | undefined;
    const hasLegacyProjectKeyUnique =
      typeof envVarTable?.sql === 'string' && envVarTable.sql.includes('UNIQUE(project_id, key)');

    if (hasLegacyProjectKeyUnique) {
      const environmentIdSelect = envVarColumnNames.has('environment_id')
        ? 'environment_id'
        : 'NULL AS environment_id';

      this.sqlite.exec(`CREATE TABLE env_vars_migrated (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      this.sqlite.exec(`INSERT INTO env_vars_migrated (
        id,
        project_id,
        environment_id,
        key,
        value,
        created_at
      ) SELECT
        id,
        project_id,
        ${environmentIdSelect},
        key,
        value,
        created_at
      FROM env_vars`);
      this.sqlite.exec('DROP TABLE env_vars');
      this.sqlite.exec('ALTER TABLE env_vars_migrated RENAME TO env_vars');
    } else if (!envVarColumnNames.has('environment_id')) {
      this.sqlite.exec(
        'ALTER TABLE env_vars ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
      );
    }

    this.sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_project');
    this.sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_environment');
    this.sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_key_global_unique ON env_vars(project_id, key) WHERE environment_id IS NULL',
    );
    this.sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_environment_key_unique ON env_vars(project_id, environment_id, key) WHERE environment_id IS NOT NULL',
    );
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)');
    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON env_vars(environment_id)',
    );

    this.sqlite.exec(`INSERT INTO environments (
      id,
      project_id,
      type,
      branch,
      status,
      assigned_port,
      container_id,
      image_tag,
      previous_image_tag,
      public_url
    )
    SELECT
      lower(hex(randomblob(8))),
      p.id,
      'production',
      COALESCE(p.branch, 'main'),
      COALESCE(p.status, 'idle'),
      p.assigned_port,
      p.container_id,
      p.image_tag,
      p.previous_image_tag,
      p.public_url
    FROM projects p
    WHERE NOT EXISTS (
      SELECT 1 FROM environments e
      WHERE e.project_id = p.id AND e.type = 'production'
    )`);

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
    if (!dlColNames.has('environment_id')) {
      this.sqlite.exec(
        'ALTER TABLE deploy_logs ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
      );
    }
    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id)',
    );

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

    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      image TEXT NOT NULL,
      status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
      container_id TEXT,
      container_name TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      env_vars TEXT,
      credentials TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      deploy_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT,
      severity TEXT,
      percent INTEGER,
      tool_name TEXT,
      action_buttons TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    this.sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at)',
    );

    const svcTable = this.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'services'")
      .get() as { sql: string | null } | undefined;
    const svcCols = this.sqlite.prepare("PRAGMA table_info('services')").all() as Array<{
      name: string;
    }>;
    const svcColNames = new Set(svcCols.map((c) => c.name));

    const hasLegacyTypeCheck =
      typeof svcTable?.sql === 'string' &&
      svcTable.sql.includes("CHECK(type IN ('postgresql', 'mysql', 'redis', 'mongodb'))");

    if (hasLegacyTypeCheck) {
      const envVarsSelect = svcColNames.has('env_vars') ? 'env_vars' : 'NULL';

      this.sqlite.exec(`CREATE TABLE services_migrated (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        image TEXT NOT NULL,
        status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
        container_id TEXT,
        container_name TEXT NOT NULL UNIQUE,
        port INTEGER NOT NULL,
        env_vars TEXT,
        credentials TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);
      this.sqlite.exec(`INSERT INTO services_migrated (
        id,
        name,
        type,
        image,
        status,
        container_id,
        container_name,
        port,
        env_vars,
        credentials,
        created_at,
        updated_at
      ) SELECT
        id,
        name,
        type,
        image,
        status,
        container_id,
        container_name,
        port,
        ${envVarsSelect},
        credentials,
        created_at,
        updated_at
      FROM services`);
      this.sqlite.exec('DROP TABLE services');
      this.sqlite.exec('ALTER TABLE services_migrated RENAME TO services');
      this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

      // secret_files table (v0.4.2)
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS secret_files (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      filename TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      mount_path TEXT NOT NULL DEFAULT '/run/secrets',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )`);
      this.sqlite.exec(
        'CREATE INDEX IF NOT EXISTS idx_secret_files_project ON secret_files(project_id)',
      );
      this.sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_secret_files_unique ON secret_files(project_id, filename)`,
      );
    } else if (!svcColNames.has('env_vars')) {
      this.sqlite.exec('ALTER TABLE services ADD COLUMN env_vars TEXT');
    }
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
    dockerTarget?: string;
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
          docker_target: project.dockerTarget ?? null,
        })
        .run();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('UNIQUE constraint failed')) {
        throw new ProjectAlreadyExistsError(project.name);
      }
      throw error;
    }

    this.createEnvironment({
      id: `${project.id}-production`,
      projectId: project.id,
      type: 'production',
      branch: project.branch ?? 'main',
    });

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
      dockerTarget: string | null;
      pendingFix: string | null;
      accessCode: string | null;
      accessCodeIv: string | null;
      isPreview: 0 | 1;
      prNumber: number | null;
      branch: string;
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
    if (updates.dockerTarget !== undefined) {
      setValues.docker_target = updates.dockerTarget;
    }
    if (updates.pendingFix !== undefined) {
      setValues.pending_fix = updates.pendingFix;
    }
    if (updates.accessCode !== undefined) {
      setValues.access_code = updates.accessCode;
    }
    if (updates.accessCodeIv !== undefined) {
      setValues.access_code_iv = updates.accessCodeIv;
    }
    if (updates.isPreview !== undefined) {
      setValues.is_preview = updates.isPreview;
    }
    if (updates.prNumber !== undefined) {
      setValues.pr_number = updates.prNumber;
    }
    if (updates.branch !== undefined) {
      setValues.branch = updates.branch;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(projects)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, id))
      .run();
  }

  setPendingFix(projectId: string, pendingFix: PendingFixRow): void {
    this.updateProject(projectId, {
      pendingFix: JSON.stringify(pendingFix),
    });
  }

  consumePendingFix(projectId: string): string | null {
    return this.transaction(() => {
      const project = this.getProject(projectId);
      const rawPendingFix = project?.pending_fix ?? null;
      if (!rawPendingFix) {
        return null;
      }
      this.updateProject(projectId, { pendingFix: null });
      return rawPendingFix;
    });
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

  getPreviewProjects(parentProjectId: string): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(and(eq(projects.parent_project_id, parentProjectId), eq(projects.is_preview, 1)))
      .orderBy(desc(projects.updated_at))
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

  createEnvironment(environment: {
    id: string;
    projectId: string;
    type: EnvironmentRow['type'];
    branch: string;
    status?: EnvironmentRow['status'];
    assignedPort?: number | null;
    containerId?: string | null;
    imageTag?: string | null;
    previousImageTag?: string | null;
    publicUrl?: string | null;
  }): EnvironmentRow {
    this.db
      .insert(environments)
      .values({
        id: environment.id,
        project_id: environment.projectId,
        type: environment.type,
        branch: environment.branch,
        status: environment.status ?? 'idle',
        assigned_port: environment.assignedPort ?? null,
        container_id: environment.containerId ?? null,
        image_tag: environment.imageTag ?? null,
        previous_image_tag: environment.previousImageTag ?? null,
        public_url: environment.publicUrl ?? null,
      })
      .run();

    const created = this.getEnvironment(environment.id);
    if (!created) throw new Error(`Failed to create environment ${environment.id}`);
    return created;
  }

  getEnvironment(id: string): EnvironmentRow | undefined {
    return this.db.select().from(environments).where(eq(environments.id, id)).get() as
      | EnvironmentRow
      | undefined;
  }

  getEnvironmentsByProject(projectId: string): EnvironmentRow[] {
    return this.db
      .select()
      .from(environments)
      .where(eq(environments.project_id, projectId))
      .orderBy(asc(environments.created_at))
      .all() as EnvironmentRow[];
  }

  updateEnvironment(
    id: string,
    updates: Partial<{
      branch: string;
      status: EnvironmentRow['status'];
      assignedPort: number | null;
      containerId: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      publicUrl: string | null;
    }>,
  ): void {
    const setValues: Partial<typeof environments.$inferInsert> = {};

    if (updates.branch !== undefined) {
      setValues.branch = updates.branch;
    }
    if (updates.status !== undefined) {
      setValues.status = updates.status;
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

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(environments)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(environments.id, id))
      .run();
  }

  deleteEnvironment(id: string): void {
    this.db.delete(environments).where(eq(environments.id, id)).run();
  }

  // ===== Ports =====

  /** Get all ports currently assigned to projects. */
  getUsedPorts(): number[] {
    const rows = this.db
      .select({ assigned_port: projects.assigned_port })
      .from(projects)
      .where(isNotNull(projects.assigned_port))
      .all();
    return rows.flatMap((r: { assigned_port: number | null }) =>
      r.assigned_port === null ? [] : [r.assigned_port],
    );
  }

  // ===== Environment Variables =====

  getEnvVars(projectId: string, environmentId?: string): Record<string, string> {
    const whereClause =
      environmentId === undefined
        ? and(eq(envVars.project_id, projectId), isNull(envVars.environment_id))
        : and(eq(envVars.project_id, projectId), eq(envVars.environment_id, environmentId));

    const rows = this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(whereClause)
      .all();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  setEnvVar(projectId: string, key: string, value: string, environmentId?: string): void {
    const whereClause =
      environmentId === undefined
        ? and(
            eq(envVars.project_id, projectId),
            isNull(envVars.environment_id),
            eq(envVars.key, key),
          )
        : and(
            eq(envVars.project_id, projectId),
            eq(envVars.environment_id, environmentId),
            eq(envVars.key, key),
          );

    const existing = this.db.select({ id: envVars.id }).from(envVars).where(whereClause).get() as
      | { id: string }
      | undefined;

    if (existing) {
      this.db.update(envVars).set({ value }).where(eq(envVars.id, existing.id)).run();
      return;
    }

    this.db
      .insert(envVars)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        project_id: projectId,
        environment_id: environmentId ?? null,
        key,
        value,
      })
      .run();
  }

  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string): void {
    const transaction = this.sqlite.transaction(() => {
      const existing = this.getEnvVars(projectId, environmentId);
      for (const key of Object.keys(existing)) {
        if (!(key in vars)) {
          this.deleteEnvVar(projectId, key, environmentId);
        }
      }
      for (const [key, value] of Object.entries(vars)) {
        this.setEnvVar(projectId, key, value, environmentId);
      }
    });

    transaction();
  }

  deleteEnvVar(projectId: string, key: string, environmentId?: string): void {
    const whereClause =
      environmentId === undefined
        ? and(
            eq(envVars.project_id, projectId),
            isNull(envVars.environment_id),
            eq(envVars.key, key),
          )
        : and(
            eq(envVars.project_id, projectId),
            eq(envVars.environment_id, environmentId),
            eq(envVars.key, key),
          );

    this.db.delete(envVars).where(whereClause).run();
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

  // ===== Secret Files =====

  getSecretFiles(projectId: string | null): Array<{
    id: string;
    project_id: string | null;
    filename: string;
    encrypted_content: string;
    iv: string;
    mount_path: string;
  }> {
    const condition =
      projectId === null ? isNull(secretFiles.project_id) : eq(secretFiles.project_id, projectId);
    return this.db.select().from(secretFiles).where(condition).all();
  }

  getSecretFilesForDeploy(projectId: string): Array<{
    filename: string;
    encrypted_content: string;
    iv: string;
    mount_path: string;
  }> {
    return this.db
      .select({
        filename: secretFiles.filename,
        encrypted_content: secretFiles.encrypted_content,
        iv: secretFiles.iv,
        mount_path: secretFiles.mount_path,
      })
      .from(secretFiles)
      .where(or(eq(secretFiles.project_id, projectId), isNull(secretFiles.project_id)))
      .all();
  }

  upsertSecretFile(
    projectId: string | null,
    filename: string,
    encryptedContent: string,
    iv: string,
    mountPath: string = '/run/secrets',
  ): void {
    this.db
      .insert(secretFiles)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        project_id: projectId,
        filename,
        encrypted_content: encryptedContent,
        iv,
        mount_path: mountPath,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: [secretFiles.project_id, secretFiles.filename],
        set: {
          encrypted_content: encryptedContent,
          iv,
          mount_path: mountPath,
          updated_at: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
  }

  deleteSecretFile(projectId: string | null, filename: string): boolean {
    const existing = this.db
      .select({ id: secretFiles.id })
      .from(secretFiles)
      .where(
        projectId === null
          ? and(isNull(secretFiles.project_id), eq(secretFiles.filename, filename))
          : and(eq(secretFiles.project_id, projectId), eq(secretFiles.filename, filename)),
      )
      .get();
    if (!existing) return false;
    this.db.delete(secretFiles).where(eq(secretFiles.id, existing.id)).run();
    return true;
  }

  createService(service: {
    id: string;
    name: string;
    type: string;
    image: string;
    containerName: string;
    port: number;
    envVars?: string;
    credentials?: string;
  }): ServiceRow {
    this.db
      .insert(services)
      .values({
        id: service.id,
        name: service.name,
        type: service.type,
        image: service.image,
        container_name: service.containerName,
        port: service.port,
        env_vars: service.envVars ?? null,
        credentials: service.credentials ?? null,
      })
      .run();

    const created = this.getService(service.id);
    if (!created) throw new Error(`Failed to create service ${service.id}`);
    return created;
  }

  getService(id: string): ServiceRow | undefined {
    return this.db.select().from(services).where(eq(services.id, id)).get() as
      | ServiceRow
      | undefined;
  }

  listServices(): ServiceRow[] {
    return this.db.select().from(services).orderBy(desc(services.updated_at)).all() as ServiceRow[];
  }

  updateService(
    id: string,
    updates: Partial<{
      status: ServiceRow['status'];
      containerId: string | null;
    }>,
  ): void {
    const setValues: Partial<typeof services.$inferInsert> = {};

    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(services)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(services.id, id))
      .run();
  }

  deleteService(id: string): void {
    this.db.delete(services).where(eq(services.id, id)).run();
  }

  // ===== Deploy Logs =====

  /** Record a deployment log entry. */
  createDeployLog(log: {
    id: string;
    projectId: string;
    environmentId?: string;
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
        environment_id: log.environmentId ?? null,
        status: log.status,
        trigger: log.trigger,
        commit_sha: log.commitSha ?? null,
        build_log: log.buildLog ?? null,
        duration_ms: log.durationMs ?? null,
      })
      .run();
  }

  /** Get deploy logs for a project, most recent first. */
  getDeployLogs(projectId: string, limit = 20, environmentId?: string): DeployLogRow[] {
    const whereClause = environmentId
      ? and(eq(deployLogs.project_id, projectId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.project_id, projectId);

    return this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
      .orderBy(desc(sql`rowid`))
      .limit(limit)
      .all() as DeployLogRow[];
  }

  /** Get the most recent deploy log for a project. */
  getLastDeployLog(projectId: string, environmentId?: string): DeployLogRow | undefined {
    const whereClause = environmentId
      ? and(eq(deployLogs.project_id, projectId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.project_id, projectId);

    return this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
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

  createTimelineEvent(event: {
    id: string;
    projectId: string;
    deployId?: string;
    type: string;
    message: string;
    detail?: string;
    severity?: string;
    percent?: number;
    toolName?: string;
    actionButtons?: string;
    createdAt?: string;
  }): void {
    this.db
      .insert(timelineEvents)
      .values({
        id: event.id,
        project_id: event.projectId,
        deploy_id: event.deployId ?? null,
        type: event.type,
        message: event.message,
        detail: event.detail ?? null,
        severity: event.severity ?? null,
        percent: event.percent ?? null,
        tool_name: event.toolName ?? null,
        action_buttons: event.actionButtons ?? null,
        created_at: event.createdAt ?? new Date().toISOString(),
      })
      .onConflictDoNothing({ target: timelineEvents.id })
      .run();

    this.sqlite
      .prepare(
        `DELETE FROM timeline_events
         WHERE project_id = ?
           AND id NOT IN (
             SELECT id
             FROM timeline_events
             WHERE project_id = ?
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 200
           )`,
      )
      .run(event.projectId, event.projectId);
  }

  getTimelineEvents(projectId: string, limit = 200): TimelineEventRow[] {
    return this.db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.project_id, projectId))
      .orderBy(desc(sql`datetime(${timelineEvents.created_at})`), desc(sql`rowid`))
      .limit(limit)
      .all() as TimelineEventRow[];
  }

  deleteTimelineEvents(projectId: string): void {
    this.db.delete(timelineEvents).where(eq(timelineEvents.project_id, projectId)).run();
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

  getWebhookConfigs(projectId: string): WebhookConfigRow[] {
    return this.db
      .select()
      .from(webhookConfigs)
      .where(eq(webhookConfigs.project_id, projectId))
      .all() as WebhookConfigRow[];
  }

  deleteWebhookConfig(projectId: string, source: WebhookConfigRow['source']): void {
    this.db
      .delete(webhookConfigs)
      .where(and(eq(webhookConfigs.project_id, projectId), eq(webhookConfigs.source, source)))
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
