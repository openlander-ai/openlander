import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { isNotNull } from 'drizzle-orm';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('db-migration');
import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from './drizzle.js';
import { environments, services } from './schema.drizzle.js';
import { ProjectRepo } from './repos/project.repo.js';
import { EnvironmentRepo } from './repos/environment.repo.js';
import { EnvVarRepo } from './repos/env-var.repo.js';
import { GlobalSecretRepo } from './repos/global-secret.repo.js';
import { SecretFileRepo } from './repos/secret-file.repo.js';
import { ServiceRepo } from './repos/service.repo.js';
import { ServiceConnectionRepo } from './repos/service-connection.repo.js';
import { RuntimeIncidentRepo } from './repos/runtime-incident.repo.js';
import { DeployLogRepo } from './repos/deploy-log.repo.js';
import { McpSessionLogRepo } from './repos/mcp-session-log.repo.js';
import { TimelineRepo } from './repos/timeline.repo.js';
import { DomainMappingRepo } from './repos/domain-mapping.repo.js';
import { OAuthRepo } from './repos/oauth.repo.js';
import { WebhookRepo } from './repos/webhook.repo.js';
import { DeployPlanRepo } from './repos/deploy-plan.repo.js';
import { DeployConfigRepo } from './repos/deploy-config.repo.js';
import { AuthRepo } from './repos/auth.repo.js';
import { AiUsageLogRepo } from './repos/ai-usage-log.repo.js';
import { ActionRunRepo } from './repos/action-run.repo.js';
import { DeploymentPatternRepo } from './repos/deployment-pattern.repo.js';
import { OpsIncidentRepo } from './repos/ops-incident.repo.js';
import { OpsIncidentEventRepo } from './repos/ops-incident-event.repo.js';
import { CircuitBreakerRepo } from './repos/circuit-breaker.repo.js';
import { ProjectDependencyRepo } from './repos/project-dependency.repo.js';
import { ProjectOpsOverrideRepo } from './repos/project-ops-override.repo.js';
import { ActivityLogRepo } from './repos/activity-log.repo.js';
import { ServiceMetricRepo } from './repos/service-metric.repo.js';
import { SettingsRepo } from './repos/settings.repo.js';
import type { ProjectRow } from './types.js';
import type { AuthDatabase } from '../auth/auth-service.js';
import type { ProjectOpsOverride } from '../monitor/ops-types.js';

export type {
  EnvironmentType,
  ProjectRow,
  EnvironmentRow,
  DeployLogRow,
  TimelineEventRow,
  DomainMappingRow,
  OAuthTokenRow,
  WebhookConfigRow,
  ServiceRow,
  ServiceConnectionRow,
  RuntimeIncidentRow,
  PendingFixRow,
  DeployPlanRow,
  AuthRow,
  OpsIncidentRow,
  OpsIncidentEventRow,
  CircuitBreakerRow,
  ActivityLogRow,
} from './types.js';

type MigrationJournal = {
  entries: Array<{
    tag: string;
    when: number;
  }>;
};

type SqliteTableInfoRow = { name: string };

type LegacyProjectRuntimeRow = {
  id: string;
  branch?: string | null;
  status?: string | null;
  assigned_port?: number | null;
  container_id?: string | null;
  image_tag?: string | null;
  previous_image_tag?: string | null;
  public_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function getTableNames(sqlite: SqliteDatabase): Set<string> {
  return new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableInfoRow[]
    ).map((row) => row.name),
  );
}

function getTableColumns(sqlite: SqliteDatabase, tableName: string): Set<string> {
  return new Set(
    (sqlite.prepare(`PRAGMA table_info('${tableName}')`).all() as SqliteTableInfoRow[]).map(
      (row) => row.name,
    ),
  );
}

function applyIdempotentBaseline(sqlite: SqliteDatabase, migrationsFolder: string): void {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;
  const baseline = journal.entries[0];
  if (!baseline) return;

  const baselineSql = readFileSync(path.join(migrationsFolder, `${baseline.tag}.sql`), 'utf8');
  const statements = baselineSql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) =>
      statement
        .replace('CREATE TABLE `', 'CREATE TABLE IF NOT EXISTS `')
        .replace('CREATE UNIQUE INDEX `', 'CREATE UNIQUE INDEX IF NOT EXISTS `')
        .replace('CREATE INDEX `', 'CREATE INDEX IF NOT EXISTS `'),
    );

  for (const statement of statements) {
    try {
      sqlite.exec(statement);
    } catch (err) {
      log.debug({ err, sql: statement.slice(0, 120) }, 'baseline statement skipped');
    }
  }

  backfillMissingColumns(sqlite, statements);
}

function backfillMissingColumns(sqlite: SqliteDatabase, statements: string[]): void {
  const createTableRegex = /CREATE TABLE IF NOT EXISTS `(\w+)`\s*\(([\s\S]+)\)/;
  for (const statement of statements) {
    const match = createTableRegex.exec(statement);
    if (!match) continue;
    const tableName = match[1];
    const body = match[2];
    if (!tableName || !body) continue;

    const existingColumns = getTableColumns(sqlite, tableName);
    if (existingColumns.size === 0) continue;

    const columnDefs = body
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.startsWith('`'));

    for (const colDef of columnDefs) {
      const colMatch = /^`(\w+)`/.exec(colDef);
      if (!colMatch?.[1]) continue;
      const colName = colMatch[1];
      if (existingColumns.has(colName)) continue;

      const alterSql = `ALTER TABLE \`${tableName}\` ADD COLUMN ${colDef}`;
      try {
        sqlite.exec(alterSql);
        log.info({ table: tableName, column: colName }, 'backfilled missing column');
      } catch (err) {
        log.debug({ err, table: tableName, column: colName }, 'backfill column skipped');
      }
    }
  }
}

function createEnvironmentsTable(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      branch TEXT DEFAULT 'main' NOT NULL,
      status TEXT DEFAULT 'idle',
      assigned_port INTEGER,
      container_id TEXT,
      image_tag TEXT,
      previous_image_tag TEXT,
      public_url TEXT,
      container_port INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      server_id TEXT NOT NULL DEFAULT 'local',
      CONSTRAINT environments_type_check CHECK(type IN ('production', 'development')),
      CONSTRAINT environments_status_check CHECK(status IN ('running', 'stopped', 'building', 'error', 'idle'))
    )
  `);
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS environments_assigned_port_unique ON environments(assigned_port)',
  );
  // Post-0012: environments uses service_id instead of project_id; skip legacy
  // project_id index creation if the column was already dropped by migration 0012.
  const envCols = getTableColumns(sqlite, 'environments');
  if (envCols.has('project_id')) {
    sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS environments_project_type_unique ON environments(project_id, type)',
    );
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)');
  }
}

function backfillProductionEnvironments(sqlite: SqliteDatabase): void {
  // Post-0012: environments uses service_id; the legacy project_id backfill
  // path is only valid for pre-0009 schemas. Skip if already migrated.
  const envCols = getTableColumns(sqlite, 'environments');
  if (!envCols.has('project_id')) return;

  // Post-0009: service_id column exists on environments. The INSERT must
  // populate it (= project_id || '__svc') so that 0012 Phase A's NULL-orphan
  // assertion does not fire on rows inserted here (e.g. __orphan_managed).
  const hasServiceIdCol = envCols.has('service_id');

  // When service_id col exists (post-0009), only backfill projects that have a
  // corresponding __svc service row. The synthetic __orphan_managed group row
  // has no __svc service row and must be skipped to avoid FK orphans post-0012.
  const projectsToBackfill = hasServiceIdCol
    ? (sqlite
        .prepare(
          `SELECT p.* FROM projects p
           WHERE EXISTS (SELECT 1 FROM services s WHERE s.id = (p.id || '__svc'))`,
        )
        .all() as LegacyProjectRuntimeRow[])
    : (sqlite.prepare('SELECT * FROM projects').all() as LegacyProjectRuntimeRow[]);

  const insertEnvironment = hasServiceIdCol
    ? sqlite.prepare(`
        INSERT OR IGNORE INTO environments (
          id,
          project_id,
          service_id,
          type,
          branch,
          status,
          assigned_port,
          container_id,
          image_tag,
          previous_image_tag,
          public_url,
          container_port,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    : sqlite.prepare(`
        INSERT OR IGNORE INTO environments (
          id,
          project_id,
          type,
          branch,
          status,
          assigned_port,
          container_id,
          image_tag,
          previous_image_tag,
          public_url,
          container_port,
          created_at,
          updated_at
        ) VALUES (?, ?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

  for (const project of projectsToBackfill) {
    if (hasServiceIdCol) {
      insertEnvironment.run(
        `${project.id}-production`,
        project.id,
        `${project.id}__svc`,
        project.branch ?? 'main',
        project.status ?? 'idle',
        project.assigned_port ?? null,
        project.container_id ?? null,
        project.image_tag ?? null,
        project.previous_image_tag ?? null,
        project.public_url ?? null,
        null,
        project.created_at ?? new Date().toISOString(),
        project.updated_at ?? new Date().toISOString(),
      );
    } else {
      insertEnvironment.run(
        `${project.id}-production`,
        project.id,
        project.branch ?? 'main',
        project.status ?? 'idle',
        project.assigned_port ?? null,
        project.container_id ?? null,
        project.image_tag ?? null,
        project.previous_image_tag ?? null,
        project.public_url ?? null,
        null,
        project.created_at ?? new Date().toISOString(),
        project.updated_at ?? new Date().toISOString(),
      );
    }
  }
}

function rebuildLegacyEnvVars(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE env_vars__legacy_bridge (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlite.exec(`
    INSERT INTO env_vars__legacy_bridge (id, project_id, environment_id, key, value, created_at)
    SELECT id, project_id, NULL, key, value, created_at
    FROM env_vars
  `);
  sqlite.exec('DROP TABLE env_vars');
  sqlite.exec('ALTER TABLE env_vars__legacy_bridge RENAME TO env_vars');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON env_vars(environment_id)');
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_env_vars_project_key_global ON env_vars(project_id, key) WHERE environment_id IS NULL',
  );
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_env_vars_project_env_key ON env_vars(project_id, environment_id, key) WHERE environment_id IS NOT NULL',
  );
}

function rebuildLegacyDeployLogs(sqlite: SqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE deploy_logs__legacy_bridge (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
      status TEXT,
      trigger_source TEXT,
      trigger_detail TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      build_log TEXT,
      runtime_log TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      server_id TEXT NOT NULL DEFAULT 'local',
      CONSTRAINT deploy_logs_status_check CHECK(status IN ('success', 'failed', 'cancelled')),
      CONSTRAINT deploy_logs_trigger_check CHECK(trigger_source IN ('chat', 'webhook', 'api'))
    )
  `);
  sqlite.exec(`
    INSERT INTO deploy_logs__legacy_bridge (
      id,
      project_id,
      environment_id,
      status,
      trigger_source,
      trigger_detail,
      commit_sha,
      commit_message,
      build_log,
      runtime_log,
      duration_ms,
      created_at,
      server_id
    )
    SELECT id, project_id, NULL, status, trigger_source, NULL, commit_sha, NULL, build_log, NULL, duration_ms, created_at, 'local'
    FROM deploy_logs
  `);
  sqlite.exec('DROP TABLE deploy_logs');
  sqlite.exec('ALTER TABLE deploy_logs__legacy_bridge RENAME TO deploy_logs');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_deploy_logs_project ON deploy_logs(project_id)');
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id)',
  );
}

/**
 * Backup-or-bust prelude for the 0012 schema-split migration.
 *
 * Plan §"PR 5 Backup-or-bust prelude": before the Drizzle migrator runs,
 * detect whether 0012 is pending and (if so) copy the DB file to a
 * timestamped `.pre-1.0-a-completion.bak` sidecar. If the copy fails, ABORT
 * the migration — the runtime must NOT proceed without a verified backup
 * because 0012 drops 25+6 columns and table-rebuilds 6 per-deployable
 * tables; a partial run would corrupt operational data.
 *
 * Backup retention: 7 days minimum (operator-managed). The file path is
 * logged at info level so the rollback runbook can locate it without
 * reaching into the dbPath directory directly.
 */
function backupOrBustForMigration0012(sqlite: SqliteDatabase, dbPath: string): string | null {
  // In-memory DBs are non-persistent and never need a backup; tests using
  // ':memory:' would otherwise fail trying to copyFileSync from a missing
  // path.
  if (dbPath === ':memory:' || !existsSync(dbPath)) {
    return null;
  }

  // Detect whether 0012 has already been applied. If __drizzle_migrations
  // doesn't exist or doesn't have a row count >= 12, assume 0012 is pending.
  let alreadyApplied = false;
  try {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      )
      .all() as Array<{ name: string }>;
    if (tables.length > 0) {
      const row = sqlite.prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations').get() as
        | { cnt: number }
        | undefined;
      // 0012 is index 12 in the journal; >= 13 entries means 0012 ran.
      alreadyApplied = (row?.cnt ?? 0) >= 13;
    }
  } catch (err) {
    log.debug({ err }, '0012 backup-or-bust pending-check failed; assuming pending');
  }

  if (alreadyApplied) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.pre-1.0-a-completion.${timestamp}.bak`;

  try {
    // WAL-safe backup via VACUUM INTO. SQLite is in WAL mode (src/db/drizzle.ts).
    // Plain copyFileSync would capture the main DB file without checkpointing,
    // potentially missing pages still in the -wal sidecar — restoring such a
    // copy yields an inconsistent database. VACUUM INTO acquires a read lock,
    // reads all pages including WAL-buffered ones, and writes a self-contained
    // copy to the destination atomically. No checkpoint dance needed.
    //
    // Note: BEGIN IMMEDIATE is intentionally not used here — Drizzle's migrator
    // manages its own BEGIN/COMMIT per migration file. The backup IS the rollback
    // path: if migrate() fails mid-flight, restore backupPath to dbPath to
    // return to the last consistent state.
    const escapedBackup = backupPath.replace(/'/g, "''");
    sqlite.exec(`VACUUM INTO '${escapedBackup}'`);
    log.info(
      { backupPath, dbPath },
      '[migrate:0012] backup-or-bust wrote WAL-safe pre-migration backup via VACUUM INTO',
    );
    return backupPath;
  } catch (err) {
    log.error(
      { err, dbPath, backupPath },
      '[migrate:0012] backup-or-bust FAILED — aborting migration',
    );
    throw new Error(
      `Backup-or-bust prelude failed: could not copy ${dbPath} -> ${backupPath}. ` +
        `Migration 0012 will not proceed without a verified backup. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function applyAndRecordAllMigrations(sqlite: SqliteDatabase, migrationsFolder: string): void {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const insert = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
  );
  for (const entry of journal.entries) {
    const migrationSql = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(migrationSql).digest('hex');
    const stmts = migrationSql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of stmts) {
      try {
        sqlite.exec(stmt);
      } catch (err) {
        log.debug(
          { err, sql: stmt.slice(0, 120) },
          'migration statement skipped (already applied)',
        );
      }
    }
    log.info({ tag: entry.tag }, 'migration recorded');
    insert.run(hash, entry.when);
  }
}

/**
 * bridgeLegacyDatabase runs BEFORE the Drizzle migrator. It backfills the
 * `environment_id` column on `env_vars` and `deploy_logs` for databases
 * that pre-date migration 0001. It does NOT touch `projects` or `services`
 * structure — those are owned by the regular migration sequence.
 *
 * The 0009_split_projects_services migration that follows in the next
 * migration step (rc.2 P1) is the canonical project/service split. The
 * bridge is unchanged: it sees the pre-0009 shape (legacy projects + legacy
 * services tables), and 0009 atomically transitions both to the new shape
 * inside its own transaction. Plan §6.5 verifies that the bridge does not
 * conflict with 0009.
 */
function bridgeLegacyDatabase(sqlite: SqliteDatabase, migrationsFolder: string): void {
  const tableNames = getTableNames(sqlite);
  if (!tableNames.has('projects')) {
    return;
  }

  // Post-migration guard: `__drizzle_migrations` exists ⇒ the database has
  // already gone through Drizzle's migrator at least once. The bridge's job
  // is purely to convert pre-0001 legacy schemas; running its idempotent
  // baseline pass on a post-migration DB causes `backfillMissingColumns` to
  // re-ADD columns that later migrations (notably 0012's schema split)
  // explicitly dropped. Observed regression: 35 cols on `projects` after
  // ~62 PM2 restarts post-0012 ship. Skip the bridge once Drizzle history
  // is present — the migrator handles forward progress on its own.
  if (tableNames.has('__drizzle_migrations')) {
    log.debug('bridge skipped: __drizzle_migrations present (post-migration DB)');
    return;
  }

  const needsEnvVarRebuild =
    tableNames.has('env_vars') && !getTableColumns(sqlite, 'env_vars').has('environment_id');
  const needsDeployLogRebuild =
    tableNames.has('deploy_logs') && !getTableColumns(sqlite, 'deploy_logs').has('environment_id');
  const needsMigrationRecord = !tableNames.has('__drizzle_migrations');

  log.info(
    { needsEnvVarRebuild, needsDeployLogRebuild, needsMigrationRecord },
    'bridging legacy database',
  );

  sqlite.transaction(() => {
    applyIdempotentBaseline(sqlite, migrationsFolder);
    createEnvironmentsTable(sqlite);
    backfillProductionEnvironments(sqlite);
    if (needsEnvVarRebuild) {
      log.info('rebuilding legacy env_vars');
      rebuildLegacyEnvVars(sqlite);
    }
    if (needsDeployLogRebuild) {
      log.info('rebuilding legacy deploy_logs');
      rebuildLegacyDeployLogs(sqlite);
    }
    if (needsMigrationRecord) {
      log.info('recording all migrations as applied');
      applyAndRecordAllMigrations(sqlite, migrationsFolder);
    }
  })();

  log.info('legacy bridge complete');
}

// prettier-ignore
export class Database implements AuthDatabase {
  private sqlite: SqliteDatabase;
  private db: DrizzleClient;
  private readonly projectRepo: ProjectRepo;
  private readonly environmentRepo: EnvironmentRepo;
  private readonly envVarRepo: EnvVarRepo;
  private readonly globalSecretRepo: GlobalSecretRepo;
  private readonly secretFileRepo: SecretFileRepo;
  private readonly serviceRepo: ServiceRepo;
  private readonly serviceConnectionRepo: ServiceConnectionRepo;
  private readonly runtimeIncidentRepo: RuntimeIncidentRepo;
  private readonly deployLogRepo: DeployLogRepo;
  private readonly mcpSessionLogRepo: McpSessionLogRepo;
  private readonly timelineRepo: TimelineRepo;
  private readonly domainMappingRepo: DomainMappingRepo;
  private readonly oauthRepo: OAuthRepo;
  private readonly webhookRepo: WebhookRepo;
  private readonly deployPlanRepo: DeployPlanRepo;
  private readonly deployConfigRepo: DeployConfigRepo;
  private readonly authRepo: AuthRepo;
  private readonly aiUsageLogRepo: AiUsageLogRepo;
  private readonly actionRunRepo: ActionRunRepo;
  private readonly deploymentPatternRepo: DeploymentPatternRepo;
  private readonly opsIncidentRepo: OpsIncidentRepo;
  private readonly opsIncidentEventRepo: OpsIncidentEventRepo;
  private readonly circuitBreakerRepo: CircuitBreakerRepo;
  private readonly projectDependencyRepo: ProjectDependencyRepo;
  private readonly projectOpsOverrideRepo: ProjectOpsOverrideRepo;
  private readonly activityLogRepo: ActivityLogRepo;
  private readonly serviceMetricRepo: ServiceMetricRepo;
  private readonly settingsRepo: SettingsRepo;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const { sqlite, db } = createDrizzleDatabase(dbPath);
    const candidates = [
      path.resolve(import.meta.dirname, '../../drizzle'),
      path.resolve(import.meta.dirname, '../drizzle'),
      path.resolve(process.cwd(), 'drizzle'),
    ];
    const cwdFallback = path.resolve(process.cwd(), 'drizzle');
    const migrationsFolder = candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json')))
      ?? cwdFallback;
    this.sqlite = sqlite;
    this.db = db;
    this.sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      // Backup-or-bust prelude — runs FIRST, before any DB mutation. If
      // bridgeLegacyDatabase or migrate() fails midway, the on-disk
      // backup represents the original pre-mutation state, not a
      // partially-bridged hybrid. Pending-detection only reads
      // __drizzle_migrations row count, so it works without the bridge.
      backupOrBustForMigration0012(this.sqlite, dbPath);
      bridgeLegacyDatabase(this.sqlite, migrationsFolder);
      migrate(this.db as Parameters<typeof migrate>[0], {
        migrationsFolder,
      });
    } finally {
      this.sqlite.exec('PRAGMA foreign_keys = ON');
    }

    const fkViolations = this.sqlite.pragma('foreign_key_check') as unknown[];
    if (fkViolations.length > 0) {
      log.error(
        { violations: fkViolations },
        'Foreign key violations detected after migration',
      );
      throw new Error(
        `Foreign key violations detected after migration (${String(fkViolations.length)} rows). ` +
          `This indicates a migration caused orphaned references. Aborting startup. ` +
          `Run PRAGMA foreign_key_check manually to inspect: ${JSON.stringify(fkViolations.slice(0, 5))}`,
      );
    }

    this.projectRepo = new ProjectRepo(this.db, this.sqlite);
    this.environmentRepo = new EnvironmentRepo(this.db, this.sqlite);
    this.envVarRepo = new EnvVarRepo(this.db, this.sqlite);
    this.globalSecretRepo = new GlobalSecretRepo(this.db, this.sqlite);
    this.secretFileRepo = new SecretFileRepo(this.db, this.sqlite);
    this.serviceRepo = new ServiceRepo(this.db, this.sqlite);
    this.serviceConnectionRepo = new ServiceConnectionRepo(this.db, this.sqlite);
    this.runtimeIncidentRepo = new RuntimeIncidentRepo(this.db, this.sqlite);
    this.deployLogRepo = new DeployLogRepo(this.db, this.sqlite);
    this.mcpSessionLogRepo = new McpSessionLogRepo(this.db, this.sqlite);
    this.timelineRepo = new TimelineRepo(this.db, this.sqlite);
    this.domainMappingRepo = new DomainMappingRepo(this.db, this.sqlite);
    this.oauthRepo = new OAuthRepo(this.db, this.sqlite);
    this.webhookRepo = new WebhookRepo(this.db, this.sqlite);
    this.deployPlanRepo = new DeployPlanRepo(this.db, this.sqlite);
    this.deployConfigRepo = new DeployConfigRepo(this.db, this.sqlite);
    this.authRepo = new AuthRepo(this.db);
    this.aiUsageLogRepo = new AiUsageLogRepo(this.db, this.sqlite);
    this.actionRunRepo = new ActionRunRepo(this.db, this.sqlite);
    this.deploymentPatternRepo = new DeploymentPatternRepo(this.db, this.sqlite);
    this.opsIncidentRepo = new OpsIncidentRepo(this.db, this.sqlite);
    this.opsIncidentEventRepo = new OpsIncidentEventRepo(this.db, this.sqlite);
    this.circuitBreakerRepo = new CircuitBreakerRepo(this.db, this.sqlite);
    this.projectDependencyRepo = new ProjectDependencyRepo(this.db, this.sqlite);
    this.projectOpsOverrideRepo = new ProjectOpsOverrideRepo(this.db, this.sqlite);
    this.activityLogRepo = new ActivityLogRepo(this.db, this.sqlite);
    this.serviceMetricRepo = new ServiceMetricRepo(this.db, this.sqlite);
    this.settingsRepo = new SettingsRepo(this.db, this.sqlite);
    this.actionRunRepo.markStaleAsFailedOnStartup();
  }

  createProject(project: Parameters<ProjectRepo['createProject']>[0]): ProjectRow { const created = this.projectRepo.createProject(project); this.environmentRepo.createEnvironment({ id: `${project.id}-production`, projectId: created.id, type: 'production', branch: project.branch ?? 'main' }); return created; }
  getProject(id: string) { return this.projectRepo.getProject(id); }
  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
  listProjects(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
  listProjectsWithMetadata(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjectsWithMetadata(status, opts); }
  archiveProject(id: string) { this.projectRepo.archiveProject(id); }
  unarchiveProject(id: string) { this.projectRepo.unarchiveProject(id); }
  listArchivedProjects() { return this.projectRepo.listArchivedProjects(); }
  isArchived(id: string) { return this.projectRepo.isArchived(id); }
  updateProject(id: string, updates: Parameters<ProjectRepo['updateProject']>[1]) { this.projectRepo.updateProject(id, updates); }
  setPendingFix(projectId: string, pendingFix: Parameters<ProjectRepo['setPendingFix']>[1]) { this.projectRepo.setPendingFix(projectId, pendingFix); }
  consumePendingFix(projectId: string) { return this.projectRepo.consumePendingFix(projectId); }
  deleteProject(id: string) { this.projectRepo.deleteProject(id); }
  attachServiceToProject(serviceId: string, targetProjectId: string) { return this.projectRepo.attachServiceToProject(serviceId, targetProjectId); }
  getChildProjects(parentId: string) { return this.projectRepo.getChildProjects(parentId); }
  getPreviewProjects(parentProjectId: string) { return this.projectRepo.getPreviewProjects(parentProjectId); }
  isParentProject(id: string) { return this.projectRepo.isParentProject(id); }
  acquireDeployLock(projectId: string, sessionId: string) { return this.projectRepo.acquireDeployLock(projectId, sessionId); }
  releaseDeployLock(projectId: string, sessionId?: string) {
    return this.projectRepo.releaseDeployLock(projectId, sessionId);
  }
  getDeployLockInfo(projectId: string) { return this.projectRepo.getDeployLockInfo(projectId); }
  // 1.0 GA B3 + Codex Day 16 follow-up: default aligned with
  // PROJECT_LOCK_TIMEOUT_MS (30min in src/llm/agent-pool.ts) AND
  // recovery-policy.ts:DEFAULT_LOCK_STALE_MS so in-memory + DB lock TTLs
  // + recovery stale window all share a single 30-min boundary.
  cleanExpiredDeployLocks(timeoutMinutes = 30) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
  createEnvironment(environment: Parameters<EnvironmentRepo['createEnvironment']>[0]) { return this.environmentRepo.createEnvironment(environment); }
  getEnvironment(id: string) { return this.environmentRepo.getEnvironment(id); }
  getEnvironmentsByProject(projectId: string) { return this.environmentRepo.getEnvironmentsByProject(projectId); }
  updateEnvironment(id: string, updates: Parameters<EnvironmentRepo['updateEnvironment']>[1]) { this.environmentRepo.updateEnvironment(id, updates); }
  deleteEnvironment(id: string) { this.environmentRepo.deleteEnvironment(id); }
  getEnvVars(projectId: string, environmentId?: string) { return this.envVarRepo.getEnvVars(projectId, environmentId); }
  setEnvVar(projectId: string, key: string, value: string, environmentId?: string) { this.envVarRepo.setEnvVar(projectId, key, value, environmentId); }
  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.setEnvVarsBulk(projectId, vars, environmentId); }
  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string) { this.envVarRepo.mergeEnvVars(projectId, vars, environmentId); }
  deleteEnvVar(projectId: string, key: string, environmentId?: string) { this.envVarRepo.deleteEnvVar(projectId, key, environmentId); }
  findProjectsByEnvKey(key: string) { return this.envVarRepo.findProjectsByEnvKey(key); }
  getGlobalSecrets() { return this.globalSecretRepo.getGlobalSecrets(); }
  getGlobalSecret(key: string) { return this.globalSecretRepo.getGlobalSecret(key); }
  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string) { this.globalSecretRepo.setGlobalSecret(key, encryptedValue, iv, description); }
  deleteGlobalSecret(key: string) { return this.globalSecretRepo.deleteGlobalSecret(key); }
  getSecretFiles(projectId: string | null) { return this.secretFileRepo.getSecretFiles(projectId); }
  getSecretFilesForDeploy(projectId: string) { return this.secretFileRepo.getSecretFilesForDeploy(projectId); }
  upsertSecretFile(projectId: string | null, filename: string, encryptedContent: string, iv: string, mountPath: string = '/run/secrets') { this.secretFileRepo.upsertSecretFile(projectId, filename, encryptedContent, iv, mountPath); }
  deleteSecretFile(projectId: string | null, filename: string) { return this.secretFileRepo.deleteSecretFile(projectId, filename); }
  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
  getService(id: string) { return this.serviceRepo.getService(id); }
  listServices() { return this.serviceRepo.listServices(); }
  getServices(opts?: Parameters<ServiceRepo['getServices']>[0]) { return this.serviceRepo.getServices(opts); }
  updateService(id: string, updates: Parameters<ServiceRepo['updateService']>[1]) { this.serviceRepo.updateService(id, updates); }
  deleteService(id: string) { this.serviceRepo.deleteService(id); }
  getComposeChildren(parentServiceId: string) { return this.serviceRepo.getComposeChildren(parentServiceId); }
  /**
   * PR 2 helper: look up compose-child ProjectRows via services.parent_service_id.
   * Replaces `getChildProjects(parentId)` in pipeline code so the hierarchy
   * traversal goes through services table while downstream code still gets
   * ProjectRow (with container_id, status, etc. still on projects until PR 5).
   */
  getComposeChildProjects(parentProjectId: string): ProjectRow[] {
    const childServices = this.serviceRepo.getComposeChildren(`${parentProjectId}__svc`);
    return childServices
      .map((svc) => {
        const childProjectId = svc.id.replace(/__svc$/, '');
        return this.projectRepo.getProject(childProjectId);
      })
      .filter((p): p is ProjectRow => p !== undefined);
  }
  getDeployablesByGroup(projectId: string) { return this.serviceRepo.getDeployablesByGroup(projectId); }
  /**
   * PR 4 helper: resolve the auto-derived deployable services row for a
   * project group. Convention from `createProject`: deployable services use
   * id = `<projectId>__svc`. Used by web/api route handlers to read
   * canonical (kind/image_url/assigned_port/status/container_id/...)
   * fields with `??` fallback to the legacy `projects` columns through
   * migration 0012.
   */
  getDeployableForProject(projectId: string) { return this.serviceRepo.getService(`${projectId}__svc`); }
  createServiceConnection(opts: Parameters<ServiceConnectionRepo['createConnection']>[0]) { return this.serviceConnectionRepo.createConnection(opts); }
  getServiceConnection(id: string) { return this.serviceConnectionRepo.getConnection(id); }
  getServiceConnectionByProjectAndService(projectId: string, serviceId: string) { return this.serviceConnectionRepo.getConnectionByProjectAndService(projectId, serviceId); }
  listServiceConnectionsByProject(projectId: string, environmentId?: string) { return this.serviceConnectionRepo.listConnectionsByProject(projectId, environmentId); }
  listServiceConnectionsByService(serviceId: string) { return this.serviceConnectionRepo.listConnectionsByService(serviceId); }
  updateServiceConnection(id: string, updates: Parameters<ServiceConnectionRepo['updateConnection']>[1]) { this.serviceConnectionRepo.updateConnection(id, updates); }
  deleteServiceConnection(id: string) { this.serviceConnectionRepo.deleteConnection(id); }
  deleteServiceConnectionByProjectAndService(projectId: string, serviceId: string) { this.serviceConnectionRepo.deleteConnectionByProjectAndService(projectId, serviceId); }
  createRuntimeIncident(opts: Parameters<RuntimeIncidentRepo['createIncident']>[0]) { return this.runtimeIncidentRepo.createIncident(opts); }
  getRuntimeIncident(id: string) { return this.runtimeIncidentRepo.getIncident(id); }
  listRuntimeIncidentsByProject(projectId: string, opts?: Parameters<RuntimeIncidentRepo['listByProject']>[1]) { return this.runtimeIncidentRepo.listByProject(projectId, opts); }
  listUnresolvedRuntimeIncidents() { return this.runtimeIncidentRepo.listUnresolved(); }
  listRecentResolvedRuntimeIncidents(limit = 50) { return this.runtimeIncidentRepo.listRecentResolved(limit); }
  resolveRuntimeIncident(id: string) { this.runtimeIncidentRepo.resolveIncident(id); }
  updateRuntimeIncidentDiagnosis(id: string, diagnosis: string) { this.runtimeIncidentRepo.updateDiagnosis(id, diagnosis); }
  createDeployLog(log: Parameters<DeployLogRepo['createDeployLog']>[0]) { this.deployLogRepo.createDeployLog(log); }
  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
  listRecentDeployLogsAcrossProjects(limit = 100) { return this.deployLogRepo.listRecentAcrossProjects(limit); }
  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
  updateRuntimeLog(deployId: string, runtimeLog: string) { this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
  recordMcpSessionClose(opts: Parameters<McpSessionLogRepo['recordClose']>[0]) { this.mcpSessionLogRepo.recordClose(opts); }
  listRecentClosedMcpSessions(limit = 50) { return this.mcpSessionLogRepo.listRecentClosed(limit); }
  createTimelineEvent(event: Parameters<TimelineRepo['createTimelineEvent']>[0]) { this.timelineRepo.createTimelineEvent(event); }
  getTimelineEvents(projectId: string, limit = 200) { return this.timelineRepo.getTimelineEvents(projectId, limit); }
  deleteTimelineEvents(projectId: string) { this.timelineRepo.deleteTimelineEvents(projectId); }
  createDomainMapping(mapping: Parameters<DomainMappingRepo['createDomainMapping']>[0]) { this.domainMappingRepo.createDomainMapping(mapping); }
  getDomainMappings(projectId: string) { return this.domainMappingRepo.getDomainMappings(projectId); }
  listDomainMappings() { return this.domainMappingRepo.listDomainMappings(); }
  deleteDomainMapping(id: string) { this.domainMappingRepo.deleteDomainMapping(id); }
  getOAuthTokens(provider: string) { return this.oauthRepo.getOAuthTokens(provider); }
  upsertOAuthTokens(token: Parameters<OAuthRepo['upsertOAuthTokens']>[0]) { this.oauthRepo.upsertOAuthTokens(token); }
  deleteOAuthTokens(provider: string) { this.oauthRepo.deleteOAuthTokens(provider); }
  getWebhookConfig(projectId: string, source: Parameters<WebhookRepo['getWebhookConfig']>[1]) { return this.webhookRepo.getWebhookConfig(projectId, source); }
  setWebhookConfig(config: Parameters<WebhookRepo['setWebhookConfig']>[0]) { this.webhookRepo.setWebhookConfig(config); }
  setWebhookEnabled(id: string, enabled: boolean) { this.webhookRepo.setWebhookEnabled(id, enabled); }
  getWebhookConfigs(projectId: string) { return this.webhookRepo.getWebhookConfigs(projectId); }
  deleteWebhookConfig(projectId: string, source: Parameters<WebhookRepo['deleteWebhookConfig']>[1]) { this.webhookRepo.deleteWebhookConfig(projectId, source); }
  createDeployPlan(plan: Parameters<DeployPlanRepo['createDeployPlan']>[0]) { return this.deployPlanRepo.createDeployPlan(plan); }
  getDeployPlan(planId: string) { return this.deployPlanRepo.getDeployPlan(planId); }
  updateDeployPlan(planId: string, updates: Parameters<DeployPlanRepo['updateDeployPlan']>[1]) { this.deployPlanRepo.updateDeployPlan(planId, updates); }
  updateDeployPlanStatus(planId: string, status: string) { this.deployPlanRepo.updateDeployPlanStatus(planId, status); }
  listDeployPlans(projectName?: string) { return this.deployPlanRepo.listDeployPlans(projectName); }
  getLatestPlanForProject(projectName: string) { return this.deployPlanRepo.getLatestPlanForProject(projectName); }
  saveDeployConfig(projectId: string, configJson: string, configVersion: number) { this.deployConfigRepo.save(projectId, configJson, configVersion); }
  loadDeployConfig(projectId: string) { return this.deployConfigRepo.load(projectId); }
  deleteDeployConfig(projectId: string) { this.deployConfigRepo.delete(projectId); }
  isPasswordSet() { return this.authRepo.isPasswordSet(); }
  getAuth() { return this.authRepo.getAuth(); }
  setPassword(hash: string) { this.authRepo.setPassword(hash); }
  getApiToken() { return this.authRepo.getApiToken(); }
  setApiToken(encrypted: string, iv: string) { this.authRepo.setApiToken(encrypted, iv); }
  getSession() { return this.authRepo.getSession(); }
  createSession(token: string, createdAt: number, expiresAt: number) { this.authRepo.createSession(token, createdAt, expiresAt); }
  deleteSession() { this.authRepo.deleteSession(); }
  getUsedPorts(): number[] { const servicePorts = this.db.select({ assigned_port: services.assigned_port }).from(services).where(isNotNull(services.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...servicePorts, ...envPorts])]; }
  createAiUsageLog(data: Parameters<AiUsageLogRepo['create']>[0]) { return this.aiUsageLogRepo.create(data); }
  getAiUsageLogsByProject(projectId: string) { return this.aiUsageLogRepo.findByProjectId(projectId); }
  getAiUsageLogsByDateRange(from: Date, to: Date) { return this.aiUsageLogRepo.findByDateRange(from, to); }
  getAiTokenSummary(projectId?: string) { return this.aiUsageLogRepo.getTokenSummary(projectId); }
  getAiTokenSummaryFiltered(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.getTokenSummaryFiltered(opts); }
  getRecentAiUsageLogs(opts: { limit: number; projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.findRecent(opts); }
  countAiUsageLogs(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.countAll(opts); }
  createActionRun(data: Parameters<ActionRunRepo['create']>[0]) { return this.actionRunRepo.create(data); }
  updateActionRunStatus(id: string, status: 'running' | 'succeeded' | 'failed' | 'pending_approval', errorMessage?: string) { this.actionRunRepo.updateStatus(id, status, errorMessage); }
  updateActionRunStep(id: string, currentStep: number, totalSteps?: number) { this.actionRunRepo.updateStep(id, currentStep, totalSteps); }
  updateActionRunApproval(id: string, approvalStatus: 'pending' | 'approved' | 'rejected', approvalTool?: string) { this.actionRunRepo.updateApproval(id, approvalStatus, approvalTool); }
  updateActionRunRecoveryStrategy(id: string, strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null) { this.actionRunRepo.updateRecoveryStrategy(id, strategy); }
  updateActionRunPlan(id: string, plan: string) { this.actionRunRepo.updatePlan(id, plan); }
  getRunningActionRuns(projectId: string) { return this.actionRunRepo.findRunning(projectId); }
  getActionRunsByProject(projectId: string, limit?: number) { return this.actionRunRepo.findByProjectId(projectId, limit); }
  getRecentActionRuns(limit: number) { return this.actionRunRepo.findRecent(limit); }
  findActionRunPendingApproval(actionRunId: string) { return this.actionRunRepo.findPendingApproval(actionRunId); }
  getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
  listAllDeploymentPatterns() { return this.deploymentPatternRepo.findAll(); }
  findDeploymentPatternsByProject(projectId: string) { return this.deploymentPatternRepo.findByProject(projectId); }
  findDeploymentPatternBySignature(projectId: string, signature: string) { return this.deploymentPatternRepo.findBySignature(projectId, signature); }
  upsertDeploymentPattern(data: { project_id: string; pattern_type: string; error_signature: string; fix_action: string }) { return this.deploymentPatternRepo.upsertPattern(data); }
  recordDeploymentPatternSuccess(id: string) { this.deploymentPatternRepo.recordSuccess(id); }
  recordDeploymentPatternFailure(id: string) { this.deploymentPatternRepo.recordFailure(id); }
  getTopDeploymentPatterns(projectId: string, limit?: number) { return this.deploymentPatternRepo.getTopPatterns(projectId, limit); }
  createOpsIncident(data: Parameters<OpsIncidentRepo['create']>[0]) { return this.opsIncidentRepo.create(data); }
  getOpsIncident(id: string) { return this.opsIncidentRepo.findById(id); }
  listOpsIncidentsByProject(projectId: string, limit?: number) { return this.opsIncidentRepo.findByProjectId(projectId, limit); }
  getActiveOpsIncident(projectId: string) { return this.opsIncidentRepo.findActive(projectId); }
  listAllActiveOpsIncidents() { return this.opsIncidentRepo.findAllActive(); }
  updateOpsIncidentStatus(id: string, status: string, extra?: { resolved_at?: number; escalated_at?: number }) { this.opsIncidentRepo.updateStatus(id, status, extra); }
  updateOpsIncident(id: string, data: Parameters<OpsIncidentRepo['update']>[1]) { this.opsIncidentRepo.update(id, data); }
  addOpsIncidentEvent(data: Parameters<OpsIncidentEventRepo['addEvent']>[0]) { return this.opsIncidentEventRepo.addEvent(data); }
  listOpsIncidentEvents(incidentId: string) { return this.opsIncidentEventRepo.findByIncidentId(incidentId); }
  listOpsIncidentEventsByIncidentIds(incidentIds: string[]) { return this.opsIncidentEventRepo.findByIncidentIds(incidentIds); }
   listOpsIncidentsByDateRange(from: number, to: number, searchText?: string) { return this.opsIncidentRepo.findByDateRange(from, to, searchText); }
  getCircuitBreakerState(projectId: string) { return this.circuitBreakerRepo.getState(projectId); }
  upsertCircuitBreakerState(projectId: string, data: Parameters<CircuitBreakerRepo['upsert']>[1]) { this.circuitBreakerRepo.upsert(projectId, data); }
  incrementCircuitBreakerFailure(projectId: string) { return this.circuitBreakerRepo.incrementFailure(projectId); }
  openCircuitBreaker(projectId: string) { this.circuitBreakerRepo.openBreaker(projectId); }
  halfOpenCircuitBreaker(projectId: string) { this.circuitBreakerRepo.halfOpen(projectId); }
  resetCircuitBreaker(projectId: string) { this.circuitBreakerRepo.reset(projectId); }
  findAllOpenCircuitBreakers() { return this.circuitBreakerRepo.findAllOpen(); }
  listAllCircuitBreakers() { return this.circuitBreakerRepo.findAll(); }
  isCircuitBreakerOpen(projectId: string) { return this.circuitBreakerRepo.isOpen(projectId); }
  createProjectDependency(data: Parameters<ProjectDependencyRepo['create']>[0]) { return this.projectDependencyRepo.create(data); }
  findDependenciesByProject(projectId: string) { return this.projectDependencyRepo.findByProject(projectId); }
  findProjectDependents(targetProjectId?: string, targetServiceId?: string) { return this.projectDependencyRepo.findDependents(targetProjectId, targetServiceId); }
  findAllProjectDependencies() { return this.projectDependencyRepo.findAll(); }
  deleteProjectDependency(id: string) { this.projectDependencyRepo.delete(id); }
  deleteProjectDependenciesByProject(projectId: string) { this.projectDependencyRepo.deleteByProject(projectId); }
  syncDependenciesFromServiceConnections(serviceConnections: Parameters<ProjectDependencyRepo['syncFromServiceConnections']>[0]) { this.projectDependencyRepo.syncFromServiceConnections(serviceConnections); }
  getProjectOpsOverride(projectId: string) { return this.projectOpsOverrideRepo.load(projectId); }
  setProjectOpsOverride(projectId: string, overrides: ProjectOpsOverride) { this.projectOpsOverrideRepo.save(projectId, overrides); }
  deleteProjectOpsOverride(projectId: string) { this.projectOpsOverrideRepo.delete(projectId); }
  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }
  recordServiceMetricSample(sample: Parameters<ServiceMetricRepo['recordMetricSample']>[0]) { this.serviceMetricRepo.recordMetricSample(sample); }
  listServiceMetricsSince(serviceId: string, fromMs: number) { return this.serviceMetricRepo.listMetricsSince(serviceId, fromMs); }
  hasAnyServiceMetrics(serviceId: string) { return this.serviceMetricRepo.hasAnyMetrics(serviceId); }
  getLastServiceMetricAt(serviceId: string) { return this.serviceMetricRepo.getLastSampleAt(serviceId); }
  getLatestServiceMetric(serviceId: string) { return this.serviceMetricRepo.getLatestSample(serviceId); }
  getSetting(key: string) { return this.settingsRepo.getSetting(key); }
  upsertSetting(key: string, value: string) { this.settingsRepo.upsertSetting(key, value); }
  deleteSetting(key: string) { return this.settingsRepo.deleteSetting(key); }
  transaction<T>(fn: () => T) { return this.sqlite.transaction(fn)(); }
  close() { this.sqlite.close(); }
}
