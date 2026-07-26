import path from 'node:path';
import { existsSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { isNotNull } from 'drizzle-orm';
import { OpenLanderError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { createDrizzleDatabase, type DrizzleClient, type PostgresClient } from './drizzle.js';
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
import { AiOpsBriefingRepo } from './repos/ai-ops-briefing.repo.js';
import { AiOpsPendingInputRepo } from './repos/ai-ops-pending-input.repo.js';
import { DataSourceAccessRepo } from './repos/data-source-access.repo.js';
import { AiOpsPolicyRepo } from './repos/ai-ops-policy.repo.js';
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
import { PatTokenRepo } from './repos/pat-token.repo.js';
import { GitCredentialRepo } from './repos/git-credential.repo.js';
import { DeliveryRepo } from './repos/delivery.repo.js';
import { EngagementRepo } from './repos/engagement.repo.js';
import { ApplicationOperationRepo } from './repos/application-operation.repo.js';
import { DeliveryAgentRunRepo } from './repos/delivery-agent-run.repo.js';
import { ProjectEnvironmentRepo } from './repos/project-environment.repo.js';
import { ReleaseRepo } from './repos/release.repo.js';
import { WeeklyReportRepo } from './repos/weekly-report.repo.js';
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
  AiOpsBriefingRow,
  AiOpsBriefingStatus,
  AiOpsPendingInputRow,
  AiOpsPendingInputStatus,
  DataSourceAccessRow,
  DataSourceAccessMode,
  AiOpsDedupeRow,
  AiOpsInstancePolicyRow,
  AiOpsProjectPolicyRow,
  AiOpsServiceOverrideRow,
  OpsIncidentRow,
  OpsIncidentEventRow,
  CircuitBreakerRow,
  ActivityLogRow,
  PatTokenRow,
  GitCredentialRow,
  GitCredentialStatus,
  GitCredentialServiceUsage,
} from './types.js';

export type {
  ProjectDeliverySettingsRow,
  ArtifactBlobRow,
  DeliveryRow,
  DeliveryArtifactRow,
  DeliveryExternalRefRow,
  DeliveryFeedbackSourceRow,
  DeliveryWorkItemRow,
  DeliveryApprovalRow,
  DeliveryGateRow,
  DeliveryDeployLinkRow,
  DeliveryReceiptRow,
  EngagementRow,
  EngagementProjectRow,
  ApplicationOperationInvocationRow,
  DeliveryAgentRunRow,
  DeliveryAgentRunEventRow,
  DeliveryRunCheckRow,
  ProjectEnvironmentRow,
  ProjectManifestStateRow,
  ReleaseRow,
  ReleaseArtifactRow,
  ReleasePromotionRow,
  EngagementWeeklyReportRow,
} from './schema.drizzle.js';

const log = createModuleLogger('db-migration');
const OPENLANDER_MIGRATION_LOCK_ID = 10114;

interface MigrationSqlClient {
  unsafe: PostgresClient['unsafe'];
}

function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../../drizzle'),
    path.resolve(import.meta.dirname, '../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];
  const cwdFallback = path.resolve(process.cwd(), 'drizzle');
  return candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json'))) ?? cwdFallback;
}

async function relationExists(client: MigrationSqlClient, relationName: string): Promise<boolean> {
  const rows = (await client.unsafe('SELECT to_regclass($1) IS NOT NULL AS "exists"', [
    relationName,
  ])) as ReadonlyArray<{ exists: boolean }>;
  return rows[0]?.exists === true;
}

async function columnExists(
  client: MigrationSqlClient,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = (await client.unsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
    ) AS "exists"`,
    [schemaName, tableName, columnName],
  )) as ReadonlyArray<{ exists: boolean }>;
  return rows[0]?.exists === true;
}

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function listDrizzleMigrationTables(
  client: MigrationSqlClient,
): Promise<Array<{ schema: string; name: string; rowCount: number }>> {
  const rows = (await client.unsafe(
    `SELECT "schema", "name"
     FROM (
       SELECT
         n.nspname AS "schema",
         c.relname AS "name",
         bool_or(a.attname = 'id') AS "hasId",
         bool_or(a.attname = 'hash' AND format_type(a.atttypid, a.atttypmod) = 'text') AS "hasHash",
         bool_or(
           a.attname = 'created_at'
           AND format_type(a.atttypid, a.atttypmod) IN ('bigint', 'integer', 'numeric', 'text')
         ) AS "hasCreatedAt"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       GROUP BY n.nspname, c.relname
     ) migration_like_tables
     WHERE "name" = '__drizzle_migrations'
        OR ("hasId" AND "hasHash" AND "hasCreatedAt")
     ORDER BY "schema", "name"`,
  )) as ReadonlyArray<{ schema: string; name: string }>;

  const tables: Array<{ schema: string; name: string; rowCount: number }> = [];
  for (const row of rows) {
    const tableRef = `${quotePgIdentifier(row.schema)}.${quotePgIdentifier(row.name)}`;
    const countRows = (await client.unsafe(
      `SELECT COUNT(*)::integer AS "count" FROM ${tableRef}`,
    )) as ReadonlyArray<{ count: number }>;
    tables.push({ schema: row.schema, name: row.name, rowCount: countRows[0]?.count ?? 0 });
  }

  return tables;
}

export async function assertV01BaselineCompatible(client: MigrationSqlClient): Promise<void> {
  const hasLegacyMigrationAudit = await relationExists(client, 'public.migration_0009_audit');
  const hasLegacyProjectsRepoUrl = await columnExists(client, 'public', 'projects', 'repo_url');
  const migrationTables = await listDrizzleMigrationTables(client);
  const migrationsFolder = resolveMigrationsFolder();
  const publicMigrationCount = readMigrationFiles({ migrationsFolder }).length;
  const officialMigrationTable = migrationTables.find(
    (table) => table.schema === 'drizzle' && table.name === '__drizzle_migrations',
  );
  const officialMigrationCount = officialMigrationTable?.rowCount ?? 0;
  const legacyMigrationTables = migrationTables.filter(
    (table) =>
      table.rowCount > 0 && !(table.schema === 'drizzle' && table.name === '__drizzle_migrations'),
  );
  const hasUnsupportedOfficialMigrationCount = officialMigrationCount > publicMigrationCount;

  // The public baseline stores migration history in drizzle.__drizzle_migrations.
  // Pre-public histories used extra/custom migration tables or more rows than
  // the current public journal contains.
  if (
    hasLegacyMigrationAudit ||
    hasLegacyProjectsRepoUrl ||
    legacyMigrationTables.length > 0 ||
    hasUnsupportedOfficialMigrationCount
  ) {
    throw new OpenLanderError(
      'This database was initialized with a pre-0.1 OpenLander migration history. OpenLander 0.1 uses a fresh Postgres baseline; start with a fresh database or export/import data manually before booting this release.',
      'DATABASE_BASELINE_RESET_REQUIRED',
      500,
      {
        hasLegacyMigrationAudit,
        hasLegacyProjectsRepoUrl,
        drizzleMigrationCount: migrationTables.reduce((total, table) => total + table.rowCount, 0),
        publicMigrationCount,
        migrationTables,
        remediation:
          'Back up the old database, create a fresh OpenLander 0.1 Postgres volume, then re-create projects/services through the supported API.',
      },
    );
  }
}

async function migrateWithV01BaselineGuard(
  client: PostgresClient,
  migrationsFolder: string,
): Promise<void> {
  await client.begin(async (txClient) => {
    await txClient.unsafe('SELECT pg_advisory_xact_lock($1)', [OPENLANDER_MIGRATION_LOCK_ID]);
    await assertV01BaselineCompatible(txClient);
    await runV01Migrations(txClient, migrationsFolder);
  });
}

async function runV01Migrations(
  client: MigrationSqlClient,
  migrationsFolder: string,
): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });

  await client.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const rows = (await client.unsafe(
    'SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
  )) as ReadonlyArray<{ id: number; hash: string; created_at: string | number }>;
  const lastDbMigration = rows[0];

  for (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
      for (const statement of migration.sql) {
        if (statement.trim().length === 0) continue;
        await client.unsafe(statement);
      }
      await client.unsafe(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES($1, $2)',
        [migration.hash, migration.folderMillis],
      );
    }
  }
}

// prettier-ignore
export class Database implements AuthDatabase {
  private client: PostgresClient;
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
  private readonly aiOpsBriefingRepo: AiOpsBriefingRepo;
  private readonly aiOpsPendingInputRepo: AiOpsPendingInputRepo;
  private readonly dataSourceAccessRepo: DataSourceAccessRepo;
  private readonly aiOpsPolicyRepo: AiOpsPolicyRepo;
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
  private readonly patTokenRepo: PatTokenRepo;
  private readonly gitCredentialRepo: GitCredentialRepo;
  private readonly deliveryRepo: DeliveryRepo;
  private readonly engagementRepo: EngagementRepo;
  private readonly applicationOperationRepo: ApplicationOperationRepo;
  private readonly deliveryAgentRunRepo: DeliveryAgentRunRepo;
  private readonly projectEnvironmentRepo: ProjectEnvironmentRepo;
  private readonly releaseRepo: ReleaseRepo;
  private readonly weeklyReportRepo: WeeklyReportRepo;

  private constructor(client: PostgresClient, db: DrizzleClient) {
    this.client = client;
    this.db = db;
    this.projectRepo = new ProjectRepo(this.db, this.client);
    this.environmentRepo = new EnvironmentRepo(this.db, this.client);
    this.envVarRepo = new EnvVarRepo(this.db, this.client);
    this.globalSecretRepo = new GlobalSecretRepo(this.db, this.client);
    this.secretFileRepo = new SecretFileRepo(this.db, this.client);
    this.serviceRepo = new ServiceRepo(this.db, this.client);
    this.serviceConnectionRepo = new ServiceConnectionRepo(this.db, this.client);
    this.runtimeIncidentRepo = new RuntimeIncidentRepo(this.db, this.client);
    this.deployLogRepo = new DeployLogRepo(this.db, this.client);
    this.mcpSessionLogRepo = new McpSessionLogRepo(this.db, this.client);
    this.timelineRepo = new TimelineRepo(this.db, this.client);
    this.domainMappingRepo = new DomainMappingRepo(this.db, this.client);
    this.oauthRepo = new OAuthRepo(this.db, this.client);
    this.webhookRepo = new WebhookRepo(this.db, this.client);
    this.deployPlanRepo = new DeployPlanRepo(this.db, this.client);
    this.deployConfigRepo = new DeployConfigRepo(this.db, this.client);
    this.authRepo = new AuthRepo(this.db);
    this.aiUsageLogRepo = new AiUsageLogRepo(this.db, this.client);
    this.aiOpsBriefingRepo = new AiOpsBriefingRepo(this.db, this.client);
    this.aiOpsPendingInputRepo = new AiOpsPendingInputRepo(this.db, this.client);
    this.dataSourceAccessRepo = new DataSourceAccessRepo(this.db, this.client);
    this.aiOpsPolicyRepo = new AiOpsPolicyRepo(this.db, this.client);
    this.actionRunRepo = new ActionRunRepo(this.db, this.client);
    this.deploymentPatternRepo = new DeploymentPatternRepo(this.db, this.client);
    this.opsIncidentRepo = new OpsIncidentRepo(this.db, this.client);
    this.opsIncidentEventRepo = new OpsIncidentEventRepo(this.db, this.client);
    this.circuitBreakerRepo = new CircuitBreakerRepo(this.db, this.client);
    this.projectDependencyRepo = new ProjectDependencyRepo(this.db, this.client);
    this.projectOpsOverrideRepo = new ProjectOpsOverrideRepo(this.db, this.client);
    this.activityLogRepo = new ActivityLogRepo(this.db, this.client);
    this.serviceMetricRepo = new ServiceMetricRepo(this.db, this.client);
    this.settingsRepo = new SettingsRepo(this.db, this.client);
    this.patTokenRepo = new PatTokenRepo(this.db, this.client);
    this.gitCredentialRepo = new GitCredentialRepo(this.db, this.client);
    this.deliveryRepo = new DeliveryRepo(this.db, this.client);
    this.engagementRepo = new EngagementRepo(this.db, this.client);
    this.applicationOperationRepo = new ApplicationOperationRepo(this.db, this.client);
    this.deliveryAgentRunRepo = new DeliveryAgentRunRepo(this.db, this.client);
    this.projectEnvironmentRepo = new ProjectEnvironmentRepo(this.db, this.client);
    this.releaseRepo = new ReleaseRepo(this.db, this.client);
    this.weeklyReportRepo = new WeeklyReportRepo(this.db, this.client);
  }

  static async connect(databaseUrl: string): Promise<Database> {
    const { client, db } = createDrizzleDatabase(databaseUrl);
    const migrationsFolder = resolveMigrationsFolder();
    try {
      await migrateWithV01BaselineGuard(client, migrationsFolder);
    } catch (err) {
      await client.end({ timeout: 5 }).catch((closeErr: unknown) => {
        // postgres-js timeout is seconds, not milliseconds.
        log.warn({ err: closeErr }, 'Failed to close database client after migration failure');
      });
      throw err;
    }
    log.info({ migrationsFolder }, 'Postgres migrations applied');
    const database = new Database(client, db);
    await database.actionRunRepo.markStaleAsFailedOnStartup();
    const interruptedOperations =
      await database.applicationOperationRepo.markRunningAsFailedOnStartup();
    if (interruptedOperations > 0) {
      log.warn({ interruptedOperations }, 'Marked interrupted application operations as failed');
    }
    const interruptedDelivery =
      await database.deliveryAgentRunRepo.reconcileInterruptedOnStartup();
    if (interruptedDelivery.pausedRuns > 0 || interruptedDelivery.cancelledChecks > 0) {
      log.warn(interruptedDelivery, 'Paused interrupted Agent Runs and cancelled active checks');
    }
    const interruptedRelease = await database.releaseRepo.reconcileInterruptedOnStartup();
    if (interruptedRelease.failedReleases > 0 || interruptedRelease.failedPromotions > 0) {
      log.warn(interruptedRelease, 'Failed interrupted Release and Promotion work');
    }
    const repairedManagedKinds = await database.serviceRepo.repairManagedServiceKindAliases();
    if (repairedManagedKinds > 0) {
      log.info(
        { repairedManagedKinds },
        'Repaired managed service rows stored with legacy image kind',
      );
    }
    return database;
  }

  async createProject(project: Parameters<ProjectRepo['createProject']>[0]): Promise<ProjectRow> {
    const created = await this.projectRepo.createProject(project);
    await this.environmentRepo.createEnvironment({
      id: `${project.id}-production`,
      projectId: created.id,
      type: 'production',
      branch: project.source === 'image' ? null : (project.branch ?? null),
    });
    return created;
  }
  createProjectGroup(project: Parameters<ProjectRepo['createProjectGroup']>[0]) {
    return this.projectRepo.createProjectGroup(project);
  }
  claimApplicationOperation(input: Parameters<ApplicationOperationRepo['claim']>[0]) { return this.applicationOperationRepo.claim(input); }
  getApplicationOperationById(id: string) { return this.applicationOperationRepo.findById(id); }
  retryFailedApplicationOperation(id: string) { return this.applicationOperationRepo.retryFailed(id); }
  succeedApplicationOperation(id: string, response: Record<string, unknown>) { return this.applicationOperationRepo.succeed(id, response); }
  failApplicationOperation(id: string, error: Record<string, unknown>) { return this.applicationOperationRepo.fail(id, error); }
  startDeliveryAgentRun(input: Parameters<DeliveryAgentRunRepo['start']>[0]) { return this.deliveryAgentRunRepo.start(input); }
  getDeliveryAgentRun(id: string) { return this.deliveryAgentRunRepo.get(id); }
  requireDeliveryAgentRun(id: string) { return this.deliveryAgentRunRepo.require(id); }
  listDeliveryAgentRuns(deliveryId: string) { return this.deliveryAgentRunRepo.listForDelivery(deliveryId); }
  listDeliveryAgentRunEventsForRuns(runIds: readonly string[]) { return this.deliveryAgentRunRepo.listEventsForRuns(runIds); }
  listDeliveryRunChecksForRuns(runIds: readonly string[]) { return this.deliveryAgentRunRepo.listChecksForRuns(runIds); }
  listDeliveryAgentRunEvents(id: string) { return this.deliveryAgentRunRepo.listEvents(id); }
  recordDeliveryAgentRunProgress(input: Parameters<DeliveryAgentRunRepo['recordProgress']>[0]) { return this.deliveryAgentRunRepo.recordProgress(input); }
  resumeDeliveryAgentRun(input: Parameters<DeliveryAgentRunRepo['resume']>[0]) { return this.deliveryAgentRunRepo.resume(input); }
  cancelDeliveryAgentRun(input: Parameters<DeliveryAgentRunRepo['cancel']>[0]) { return this.deliveryAgentRunRepo.cancel(input); }
  startDeliveryRunCheck(input: Parameters<DeliveryAgentRunRepo['startCheck']>[0]) { return this.deliveryAgentRunRepo.startCheck(input); }
  finishDeliveryRunCheck(input: Parameters<DeliveryAgentRunRepo['finishCheck']>[0]) { return this.deliveryAgentRunRepo.finishCheck(input); }
  listDeliveryRunChecks(runId: string) { return this.deliveryAgentRunRepo.listChecks(runId); }
  setDeliveryAgentRunRunnerDigest(runId: string, digest: string) { return this.deliveryAgentRunRepo.setRunnerImageDigest(runId, digest); }
  failDeliveryAgentRun(input: Parameters<DeliveryAgentRunRepo['fail']>[0]) { return this.deliveryAgentRunRepo.fail(input); }
  completeDeliveryAgentRun(input: Parameters<DeliveryAgentRunRepo['complete']>[0]) { return this.deliveryAgentRunRepo.complete(input); }
  ensureDeployableServiceForProject(projectId: string, input: Parameters<ProjectRepo['ensureDeployableServiceForProject']>[1]) {
    return this.projectRepo.ensureDeployableServiceForProject(projectId, input);
  }
  getProject(id: string) { return this.projectRepo.getProject(id); }
  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
  listProjects(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
  listProjectsWithMetadata(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjectsWithMetadata(status, opts); }
  getDeployableServiceCountsByProjectIds(projectIds: string[]) { return this.projectRepo.getDeployableServiceCountsByProjectIds(projectIds); }
  setProjectArchivedAt(id: string, archivedAt: string | null) { return this.projectRepo.setProjectArchivedAt(id, archivedAt); }
  archiveProject(id: string, archivedAt?: string) { return this.projectRepo.archiveProject(id, archivedAt); }
  unarchiveProject(id: string) { return this.projectRepo.unarchiveProject(id); }
  listArchivedProjects() { return this.projectRepo.listArchivedProjects(); }
  isArchived(id: string) { return this.projectRepo.isArchived(id); }
  updateProject(id: string, updates: Parameters<ProjectRepo['updateProject']>[1]) { return this.projectRepo.updateProject(id, updates); }
  setPendingFix(projectId: string, pendingFix: Parameters<ProjectRepo['setPendingFix']>[1]) { return this.projectRepo.setPendingFix(projectId, pendingFix); }
  consumePendingFix(projectId: string) { return this.projectRepo.consumePendingFix(projectId); }
  deleteProject(id: string) { return this.projectRepo.deleteProject(id); }
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
  // PROJECT_LOCK_TIMEOUT_MS (30min in src/_ai-ops/agent-pool.ts) AND
  // recovery-policy.ts:DEFAULT_LOCK_STALE_MS so in-memory + DB lock TTLs
  // + recovery stale window all share a single 30-min boundary.
  cleanExpiredDeployLocks(timeoutMinutes = 30) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
  createEnvironment(environment: Parameters<EnvironmentRepo['createEnvironment']>[0]) { return this.environmentRepo.createEnvironment(environment); }
  createProjectEnvironmentRuntime(environment: Parameters<EnvironmentRepo['createProjectEnvironmentRuntime']>[0]) { return this.environmentRepo.createProjectEnvironmentRuntime(environment); }
  getEnvironmentByServiceAndProjectEnvironment(serviceId: string, projectEnvironmentId: string) { return this.environmentRepo.getEnvironmentByServiceAndProjectEnvironment(serviceId, projectEnvironmentId); }
  getEnvironment(id: string) { return this.environmentRepo.getEnvironment(id); }
  getEnvironmentsByProject(projectId: string) { return this.environmentRepo.getEnvironmentsByProject(projectId); }
  getEnvironmentsByServiceId(serviceId: string) { return this.environmentRepo.getEnvironmentsByServiceId(serviceId); }
  getEnvironmentsByProjectIds(projectIds: string[]) { return this.environmentRepo.getEnvironmentsByProjectIds(projectIds); }
  updateEnvironment(id: string, updates: Parameters<EnvironmentRepo['updateEnvironment']>[1]) { return this.environmentRepo.updateEnvironment(id, updates); }
  deleteEnvironment(id: string) { return this.environmentRepo.deleteEnvironment(id); }
  syncProjectEnvironments(projectId: string, manifestSha256: string, inputs: Parameters<ProjectEnvironmentRepo['sync']>[2], manifestState?: Parameters<ProjectEnvironmentRepo['sync']>[3]) { return this.projectEnvironmentRepo.sync(projectId, manifestSha256, inputs, manifestState); }
  getProjectEnvironment(id: string) { return this.projectEnvironmentRepo.get(id); }
  listProjectEnvironments(projectId: string) { return this.projectEnvironmentRepo.list(projectId); }
  getProjectManifestState(projectId: string) { return this.projectEnvironmentRepo.getManifestState(projectId); }
  createRelease(input: Parameters<ReleaseRepo['create']>[0]) { return this.releaseRepo.create(input); }
  getRelease(id: string) { return this.releaseRepo.get(id); }
  requireRelease(id: string) { return this.releaseRepo.require(id); }
  listReleasesForDelivery(deliveryId: string) { return this.releaseRepo.listForDelivery(deliveryId); }
  setReleaseStatus(id: string, status: Parameters<ReleaseRepo['setStatus']>[1]) { return this.releaseRepo.setStatus(id, status); }
  addReleaseArtifact(input: Parameters<ReleaseRepo['addArtifact']>[0]) { return this.releaseRepo.addArtifact(input); }
  listReleaseArtifacts(releaseId: string) { return this.releaseRepo.listArtifacts(releaseId); }
  listReleaseArtifactsForReleases(releaseIds: readonly string[]) { return this.releaseRepo.listArtifactsForReleases(releaseIds); }
  listReleasePromotionsForReleases(releaseIds: readonly string[]) { return this.releaseRepo.listPromotionsForReleases(releaseIds); }
  createReleasePromotion(input: Parameters<ReleaseRepo['createPromotion']>[0]) { return this.releaseRepo.createPromotion(input); }
  updateReleasePromotion(id: string, patch: Parameters<ReleaseRepo['updatePromotion']>[1]) { return this.releaseRepo.updatePromotion(id, patch); }
  finalizeReleasePromotion(input: Parameters<ReleaseRepo['finalizePromotion']>[0]) { return this.releaseRepo.finalizePromotion(input); }
  getReleasePromotion(id: string) { return this.releaseRepo.getPromotion(id); }
  listReleasePromotions(releaseId: string) { return this.releaseRepo.listPromotionsForRelease(releaseId); }
  getLatestSuccessfulPromotion(projectEnvironmentId: string) { return this.releaseRepo.latestSuccessfulPromotion(projectEnvironmentId); }
  collectWeeklyReportEvidence(engagementId: string, periodStart: string, periodEnd: string) { return this.weeklyReportRepo.collectEvidence(engagementId, periodStart, periodEnd); }
  createWeeklyReport(input: Parameters<WeeklyReportRepo['create']>[0]) { return this.weeklyReportRepo.create(input); }
  getWeeklyReport(id: string) { return this.weeklyReportRepo.get(id); }
  listWeeklyReports(engagementId: string) { return this.weeklyReportRepo.list(engagementId); }
  publishWeeklyReport(input: Parameters<WeeklyReportRepo['publish']>[0]) { return this.weeklyReportRepo.publish(input); }
  getEnvVars(projectId: string, environmentId?: string) { return this.envVarRepo.getEnvVars(projectId, environmentId); }
  getEnvVarsForService(projectId: string, serviceId: string, environmentId?: string) { return this.envVarRepo.getEnvVarsForService(projectId, serviceId, environmentId); }
  setEnvVar(projectId: string, key: string, value: string, environmentId?: string) { return this.envVarRepo.setEnvVar(projectId, key, value, environmentId); }
  setEnvVarForService(projectId: string, serviceId: string, key: string, value: string, environmentId?: string) { return this.envVarRepo.setEnvVarForService(projectId, serviceId, key, value, environmentId); }
  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.setEnvVarsBulk(projectId, vars, environmentId); }
  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.mergeEnvVars(projectId, vars, environmentId); }
  deleteEnvVar(projectId: string, key: string, environmentId?: string) { return this.envVarRepo.deleteEnvVar(projectId, key, environmentId); }
  deleteEnvVarForService(projectId: string, serviceId: string, key: string, environmentId?: string) { return this.envVarRepo.deleteEnvVarForService(projectId, serviceId, key, environmentId); }
  assertEnvToolSchemaReady() { return this.envVarRepo.assertEnvToolSchemaReady(); }
  mergeEnvVarsDetailed(projectId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.mergeEnvVarsDetailed(projectId, vars, environmentId); }
  mergeEnvVarsForServiceDetailed(projectId: string, serviceId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.mergeEnvVarsForServiceDetailed(projectId, serviceId, vars, environmentId); }
  findProjectsByEnvKey(key: string) { return this.envVarRepo.findProjectsByEnvKey(key); }
  findServicesByEnvKey(key: string) { return this.envVarRepo.findServicesByEnvKey(key); }
  getGlobalSecrets() { return this.globalSecretRepo.getGlobalSecrets(); }
  getGlobalSecret(key: string) { return this.globalSecretRepo.getGlobalSecret(key); }
  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string) { return this.globalSecretRepo.setGlobalSecret(key, encryptedValue, iv, description); }
  deleteGlobalSecret(key: string) { return this.globalSecretRepo.deleteGlobalSecret(key); }
  getSecretFiles(projectId: string | null) { return this.secretFileRepo.getSecretFiles(projectId); }
  getSecretFilesForDeploy(projectId: string) { return this.secretFileRepo.getSecretFilesForDeploy(projectId); }
  upsertSecretFile(projectId: string | null, filename: string, encryptedContent: string, iv: string, mountPath: string = '/run/secrets') { return this.secretFileRepo.upsertSecretFile(projectId, filename, encryptedContent, iv, mountPath); }
  deleteSecretFile(projectId: string | null, filename: string) { return this.secretFileRepo.deleteSecretFile(projectId, filename); }
  createGitCredential(input: Parameters<GitCredentialRepo['create']>[0]) { return this.gitCredentialRepo.create(input); }
  getGitCredential(id: string) { return this.gitCredentialRepo.getById(id); }
  listGitCredentials(filters?: Parameters<GitCredentialRepo['list']>[0]) { return this.gitCredentialRepo.list(filters); }
  setGitCredentialVerification(id: string, result: Parameters<GitCredentialRepo['setVerification']>[1]) { return this.gitCredentialRepo.setVerification(id, result); }
  markGitCredentialUsed(id: string) { return this.gitCredentialRepo.markUsed(id); }
  listGitCredentialUsages(ids: readonly string[]) { return this.gitCredentialRepo.listUsages(ids); }
  deleteGitCredential(id: string) { return this.gitCredentialRepo.delete(id); }
  countGitCredentialsForRepository(repositoryKey: string) { return this.gitCredentialRepo.countForRepository(repositoryKey); }
  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
  adoptService(service: Parameters<ServiceRepo['adoptService']>[0]) { return this.serviceRepo.adoptService(service); }
  getService(id: string) { return this.serviceRepo.getService(id); }
  listServices() { return this.serviceRepo.listServices(); }
  repairManagedServiceKindAliases() { return this.serviceRepo.repairManagedServiceKindAliases(); }
  getServices(opts?: Parameters<ServiceRepo['getServices']>[0]) { return this.serviceRepo.getServices(opts); }
  updateService(id: string, updates: Parameters<ServiceRepo['updateService']>[1]) { return this.serviceRepo.updateService(id, updates); }
  deleteService(id: string) { return this.serviceRepo.deleteService(id); }
  getComposeChildren(parentServiceId: string) { return this.serviceRepo.getComposeChildren(parentServiceId); }
  /**
   * PR 2 helper: look up compose-child ProjectRows via services.parent_service_id.
   * Replaces `getChildProjects(parentId)` in pipeline code so the hierarchy
   * traversal goes through services table while downstream code still gets
   * ProjectRow (with container_id, status, etc. still on projects until PR 5).
   */
  async getComposeChildProjects(parentProjectId: string): Promise<ProjectRow[]> {
    const childServices = await this.serviceRepo.getComposeChildren(`${parentProjectId}__svc`);
    const rows = await Promise.all(childServices
      .map((svc) => {
        const childProjectId = svc.id.replace(/__svc$/, '');
        return this.projectRepo.getProject(childProjectId);
      }));
    return rows.filter((p): p is ProjectRow => p !== undefined);
  }
  getDeployablesByGroup(projectId: string) { return this.serviceRepo.getDeployablesByGroup(projectId); }
  getManagedServicesByGroup(projectId: string) { return this.serviceRepo.getManagedServicesByGroup(projectId); }
  getDeployablesByGroupIds(projectIds: readonly string[]) { return this.serviceRepo.getDeployablesByGroupIds(projectIds); }
  /**
   * PR 4 helper: resolve the auto-derived deployable services row for a
   * project group. Convention from `createProject`: deployable services use
   * id = `<projectId>__svc`. Used by web/api route handlers that still
   * accept project-level compatibility routes but need canonical service
   * fields (kind/image_url/assigned_port/status/container_id/...).
   */
  getDeployableForProject(projectId: string) { return this.serviceRepo.getService(`${projectId}__svc`); }
  createServiceConnection(opts: Parameters<ServiceConnectionRepo['createConnection']>[0]) { return this.serviceConnectionRepo.createConnection(opts); }
  upsertServiceConnection(opts: Parameters<ServiceConnectionRepo['upsertConnection']>[0]) { return this.serviceConnectionRepo.upsertConnection(opts); }
  getServiceConnection(id: string) { return this.serviceConnectionRepo.getConnection(id); }
  getServiceConnectionByProjectAndService(projectId: string, serviceId: string) { return this.serviceConnectionRepo.getConnectionByProjectAndService(projectId, serviceId); }
  listServiceConnectionsByProject(projectId: string, environmentId?: string) { return this.serviceConnectionRepo.listConnectionsByProject(projectId, environmentId); }
  listDataSourceAccessByProject(projectId: string) { return this.dataSourceAccessRepo.findByProject(projectId); }
  listDataSourceAccessByProjectAndServices(projectId: string, serviceIds: readonly string[]) { return this.dataSourceAccessRepo.findByProjectAndServices(projectId, serviceIds); }
  getDataSourceAccess(projectId: string, serviceId: string) { return this.dataSourceAccessRepo.findByProjectAndService(projectId, serviceId); }
  upsertDataSourceAccess(input: Parameters<DataSourceAccessRepo['upsert']>[0]) { return this.dataSourceAccessRepo.upsert(input); }
  listServiceConnectionsByService(serviceId: string) { return this.serviceConnectionRepo.listConnectionsByService(serviceId); }
  listServiceConsumersForProvider(serviceId: string) { return this.serviceConnectionRepo.listConsumersForProvider(serviceId); }
  updateServiceConnection(id: string, updates: Parameters<ServiceConnectionRepo['updateConnection']>[1]) { return this.serviceConnectionRepo.updateConnection(id, updates); }
  deleteServiceConnection(id: string) { return this.serviceConnectionRepo.deleteConnection(id); }
  deleteServiceConnectionByProjectAndService(projectId: string, serviceId: string) { return this.serviceConnectionRepo.deleteConnectionByProjectAndService(projectId, serviceId); }
  createRuntimeIncident(opts: Parameters<RuntimeIncidentRepo['createIncident']>[0]) { return this.runtimeIncidentRepo.createIncident(opts); }
  getRuntimeIncident(id: string) { return this.runtimeIncidentRepo.getIncident(id); }
  listRuntimeIncidentsByProject(projectId: string, opts?: Parameters<RuntimeIncidentRepo['listByProject']>[1]) { return this.runtimeIncidentRepo.listByProject(projectId, opts); }
  listUnresolvedRuntimeIncidents() { return this.runtimeIncidentRepo.listUnresolved(); }
  listRecentResolvedRuntimeIncidents(limit = 50) { return this.runtimeIncidentRepo.listRecentResolved(limit); }
  resolveRuntimeIncident(id: string) { return this.runtimeIncidentRepo.resolveIncident(id); }
  updateRuntimeIncidentDiagnosis(id: string, diagnosis: string) { return this.runtimeIncidentRepo.updateDiagnosis(id, diagnosis); }
  createDeployLog(log: Parameters<DeployLogRepo['createDeployLog']>[0]) { return this.deployLogRepo.createDeployLog(log); }
  createDeployLogForService(log: Parameters<DeployLogRepo['createDeployLogForService']>[0]) { return this.deployLogRepo.createDeployLogForService(log); }
  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
  getDeployLogsForService(serviceId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogsForService(serviceId, limit, environmentId); }
  listRecentDeployLogsAcrossProjects(limit = 100) { return this.deployLogRepo.listRecentAcrossProjects(limit); }
  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
  getLastDeployLogForService(serviceId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLogForService(serviceId, environmentId); }
  getLastDeployLogsForServices(serviceIds: readonly string[]) { return this.deployLogRepo.getLastDeployLogsForServices(serviceIds); }
  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
  updateRuntimeLog(deployId: string, runtimeLog: string) { return this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
  updateDeployLogRepresentativeTraffic(deployId: string, representativeTrafficJson: string) { return this.deployLogRepo.updateRepresentativeTraffic(deployId, representativeTrafficJson); }
  recordMcpSessionClose(opts: Parameters<McpSessionLogRepo['recordClose']>[0]) { return this.mcpSessionLogRepo.recordClose(opts); }
  listRecentClosedMcpSessions(limit = 50) { return this.mcpSessionLogRepo.listRecentClosed(limit); }
  createTimelineEvent(event: Parameters<TimelineRepo['createTimelineEvent']>[0]) { return this.timelineRepo.createTimelineEvent(event); }
  getTimelineEvents(projectId: string, limit = 200) { return this.timelineRepo.getTimelineEvents(projectId, limit); }
  deleteTimelineEvents(projectId: string) { return this.timelineRepo.deleteTimelineEvents(projectId); }
  createDomainMapping(mapping: Parameters<DomainMappingRepo['createDomainMapping']>[0]) { return this.domainMappingRepo.createDomainMapping(mapping); }
  createDomainMappingForService(mapping: Parameters<DomainMappingRepo['createForServiceId']>[0]) { return this.domainMappingRepo.createForServiceId(mapping); }
  getDomainMappings(projectId: string) { return this.domainMappingRepo.getDomainMappings(projectId); }
  getDomainMappingsForService(serviceId: string) { return this.domainMappingRepo.listByServiceId(serviceId); }
  listDomainMappingsForService(serviceId: string) { return this.domainMappingRepo.listDomainMappingsForService(serviceId); }
  findDomainMappingByHostAndPath(domain: string, pathPrefix?: string | null) { return this.domainMappingRepo.findByHostAndPath(domain, pathPrefix); }
  updateDomainMapping(id: string, patch: Parameters<DomainMappingRepo['updateDomainMapping']>[1]) { return this.domainMappingRepo.updateDomainMapping(id, patch); }
  listDomainMappings() { return this.domainMappingRepo.listDomainMappings(); }
  deleteDomainMapping(id: string) { return this.domainMappingRepo.deleteDomainMapping(id); }
  deleteDomainMappingByServiceAndDomain(serviceId: string, domain: string) { return this.domainMappingRepo.deleteByServiceIdAndDomain(serviceId, domain); }
  deleteDomainMappingsByService(serviceId: string) { return this.domainMappingRepo.deleteByServiceId(serviceId); }
  getOAuthTokens(provider: string) { return this.oauthRepo.getOAuthTokens(provider); }
  upsertOAuthTokens(token: Parameters<OAuthRepo['upsertOAuthTokens']>[0]) { return this.oauthRepo.upsertOAuthTokens(token); }
  deleteOAuthTokens(provider: string) { return this.oauthRepo.deleteOAuthTokens(provider); }
  getWebhookConfig(projectId: string, source: Parameters<WebhookRepo['getWebhookConfig']>[1]) { return this.webhookRepo.getWebhookConfig(projectId, source); }
  setWebhookConfig(config: Parameters<WebhookRepo['setWebhookConfig']>[0]) { return this.webhookRepo.setWebhookConfig(config); }
  setWebhookEnabled(id: string, enabled: boolean) { return this.webhookRepo.setWebhookEnabled(id, enabled); }
  getWebhookConfigs(projectId: string) { return this.webhookRepo.getWebhookConfigs(projectId); }
  deleteWebhookConfig(projectId: string, source: Parameters<WebhookRepo['deleteWebhookConfig']>[1]) { return this.webhookRepo.deleteWebhookConfig(projectId, source); }
  createDeployPlan(plan: Parameters<DeployPlanRepo['createDeployPlan']>[0]) { return this.deployPlanRepo.createDeployPlan(plan); }
  getDeployPlan(planId: string) { return this.deployPlanRepo.getDeployPlan(planId); }
  updateDeployPlan(planId: string, updates: Parameters<DeployPlanRepo['updateDeployPlan']>[1]) { return this.deployPlanRepo.updateDeployPlan(planId, updates); }
  updateDeployPlanStatus(planId: string, status: string) { return this.deployPlanRepo.updateDeployPlanStatus(planId, status); }
  listDeployPlans(projectName?: string) { return this.deployPlanRepo.listDeployPlans(projectName); }
  getLatestPlanForProject(projectName: string) { return this.deployPlanRepo.getLatestPlanForProject(projectName); }
  saveDeployConfig(projectId: string, configJson: string, configVersion: number) { return this.deployConfigRepo.save(projectId, configJson, configVersion); }
  saveDeployConfigForService(serviceId: string, configJson: string, configVersion: number) { return this.deployConfigRepo.saveByServiceId(serviceId, configJson, configVersion); }
  loadDeployConfig(projectId: string) { return this.deployConfigRepo.load(projectId); }
  loadDeployConfigForService(serviceId: string) { return this.deployConfigRepo.loadByServiceId(serviceId); }
  deleteDeployConfig(projectId: string) { return this.deployConfigRepo.delete(projectId); }
  deleteDeployConfigForService(serviceId: string) { return this.deployConfigRepo.deleteByServiceId(serviceId); }
  isPasswordSet() { return this.authRepo.isPasswordSet(); }
  getAuth() { return this.authRepo.getAuth(); }
  setPassword(hash: string) { return this.authRepo.setPassword(hash); }
  getApiToken() { return this.authRepo.getApiToken(); }
  setApiToken(encrypted: string, iv: string) { return this.authRepo.setApiToken(encrypted, iv); }
  getSession() { return this.authRepo.getSession(); }
  createSession(token: string, createdAt: number, expiresAt: number) { return this.authRepo.createSession(token, createdAt, expiresAt); }
  deleteSession() { return this.authRepo.deleteSession(); }
  getActiveScopeProjectId() { return this.authRepo.getActiveScopeProjectId(); }
  setActiveScopeProjectId(projectId: string | null) { return this.authRepo.setActiveScopeProjectId(projectId); }
  isDestructiveMcpUnlockEnabled() { return this.authRepo.isDestructiveMcpUnlockEnabled(); }
  setDestructiveMcpUnlock(enabled: boolean) { return this.authRepo.setDestructiveMcpUnlock(enabled); }
  createPatToken(input: Parameters<PatTokenRepo['create']>[0]) { return this.patTokenRepo.create(input); }
  findPatTokenByHash(tokenHash: string) { return this.patTokenRepo.findByHash(tokenHash); }
  findPatTokenById(id: string) { return this.patTokenRepo.findById(id); }
  findLegacyDefaultPatToken() { return this.patTokenRepo.findLegacyDefault(); }
  upsertLegacyDefaultPatToken(input: Parameters<PatTokenRepo['upsertLegacyDefault']>[0]) { return this.patTokenRepo.upsertLegacyDefault(input); }
  listPatTokens(options?: Parameters<PatTokenRepo['list']>[0]) { return this.patTokenRepo.list(options); }
  touchPatToken(id: string) { return this.patTokenRepo.touch(id); }
  revokePatToken(id: string) { return this.patTokenRepo.revoke(id); }
  async getUsedPorts(): Promise<number[]> { const serviceRows = await this.db.select({ assigned_port: services.assigned_port }).from(services).where(isNotNull(services.assigned_port)); const envRows = await this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)); const servicePorts = serviceRows.flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = envRows.flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...servicePorts, ...envPorts])]; }
  createAiUsageLog(data: Parameters<AiUsageLogRepo['create']>[0]) { return this.aiUsageLogRepo.create(data); }
  getAiUsageLogsByProject(projectId: string) { return this.aiUsageLogRepo.findByProjectId(projectId); }
  getAiUsageLogsByBriefing(briefingId: string) { return this.aiUsageLogRepo.findByBriefingId(briefingId); }
  getAiUsageLogsByDateRange(from: Date, to: Date) { return this.aiUsageLogRepo.findByDateRange(from, to); }
  getAiTokenSummary(projectId?: string) { return this.aiUsageLogRepo.getTokenSummary(projectId); }
  getAiTokenSummaryFiltered(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.getTokenSummaryFiltered(opts); }
  getRecentAiUsageLogs(opts: { limit: number; projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.findRecent(opts); }
  countAiUsageLogs(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.countAll(opts); }
  createAiOpsBriefing(data: Parameters<AiOpsBriefingRepo['create']>[0]) { return this.aiOpsBriefingRepo.create(data); }
  getAiOpsBriefing(id: string) { return this.aiOpsBriefingRepo.findById(id); }
  listRecentAiOpsBriefings(opts?: Parameters<AiOpsBriefingRepo['listRecent']>[0]) { return this.aiOpsBriefingRepo.listRecent(opts); }
  listAiOpsBriefingsByProject(projectId: string, opts?: Parameters<AiOpsBriefingRepo['listByProject']>[1]) { return this.aiOpsBriefingRepo.listByProject(projectId, opts); }
  listAiOpsBriefingsByService(serviceId: string, opts?: Parameters<AiOpsBriefingRepo['listByService']>[1]) { return this.aiOpsBriefingRepo.listByService(serviceId, opts); }
  updateAiOpsBriefingStatus(...args: Parameters<AiOpsBriefingRepo['updateStatus']>) { return this.aiOpsBriefingRepo.updateStatus(...args); }
  updateAiOpsBriefingLlmSummary(...args: Parameters<AiOpsBriefingRepo['updateLlmSummary']>) { return this.aiOpsBriefingRepo.updateLlmSummary(...args); }
  upsertAiOpsPendingInput(data: Parameters<AiOpsPendingInputRepo['upsertPending']>[0]) { return this.aiOpsPendingInputRepo.upsertPending(data); }
  listPendingAiOpsInputsForServiceKeys(...args: Parameters<AiOpsPendingInputRepo['listPendingForServiceKeys']>) { return this.aiOpsPendingInputRepo.listPendingForServiceKeys(...args); }
  listPendingAiOpsInputsForProjectKeys(...args: Parameters<AiOpsPendingInputRepo['listPendingForProjectKeys']>) { return this.aiOpsPendingInputRepo.listPendingForProjectKeys(...args); }
  resolveAiOpsPendingInputsForServiceKeys(...args: Parameters<AiOpsPendingInputRepo['resolveForServiceKeys']>) { return this.aiOpsPendingInputRepo.resolveForServiceKeys(...args); }
  resolveAiOpsPendingInputsForProjectKeys(...args: Parameters<AiOpsPendingInputRepo['resolveForProjectKeys']>) { return this.aiOpsPendingInputRepo.resolveForProjectKeys(...args); }
  resolveAiOpsPendingInputsForBriefing(...args: Parameters<AiOpsPendingInputRepo['resolveForBriefing']>) { return this.aiOpsPendingInputRepo.resolveForBriefing(...args); }
  getAiOpsInstancePolicy() { return this.aiOpsPolicyRepo.getInstancePolicy(); }
  setAiOpsInstancePolicy(input: Parameters<AiOpsPolicyRepo['setInstancePolicy']>[0]) { return this.aiOpsPolicyRepo.setInstancePolicy(input); }
  getAiOpsProjectPolicy(projectId: string) { return this.aiOpsPolicyRepo.getProjectPolicy(projectId); }
  setAiOpsProjectPolicy(projectId: string, input: Parameters<AiOpsPolicyRepo['setProjectPolicy']>[1]) { return this.aiOpsPolicyRepo.setProjectPolicy(projectId, input); }
  getAiOpsServiceOverride(serviceId: string) { return this.aiOpsPolicyRepo.getServiceOverride(serviceId); }
  setAiOpsServiceOverride(serviceId: string, input: Parameters<AiOpsPolicyRepo['setServiceOverride']>[1]) { return this.aiOpsPolicyRepo.setServiceOverride(serviceId, input); }
  resolveAiOpsServicePolicy(projectId: string, serviceId?: string | null) { return this.aiOpsPolicyRepo.resolveServicePolicy(projectId, serviceId); }
  getAiOpsBriefingBudgetStatus(projectId: string, now?: Date) { return this.aiOpsPolicyRepo.getBriefingBudgetStatus(projectId, now); }
  claimAiOpsDedupeWindow(input: Parameters<AiOpsPolicyRepo['claimDedupeWindow']>[0]) { return this.aiOpsPolicyRepo.claimDedupeWindow(input); }
  attachAiOpsDedupeBriefing(dedupeKey: string, briefingId: string) { return this.aiOpsPolicyRepo.attachDedupeBriefing(dedupeKey, briefingId); }
  getAiOpsDedupeByKey(dedupeKey: string) { return this.aiOpsPolicyRepo.getDedupeByKey(dedupeKey); }
  createActionRun(data: Parameters<ActionRunRepo['create']>[0]) { return this.actionRunRepo.create(data); }
  createPendingMcpApproval(data: Parameters<ActionRunRepo['createPendingMcpApproval']>[0]) { return this.actionRunRepo.createPendingMcpApproval(data); }
  recordDeployPlanApproval(data: Parameters<ActionRunRepo['recordDeployPlanApproval']>[0]) { return this.actionRunRepo.recordDeployPlanApproval(data); }
  updateActionRunStatus(id: string, status: 'running' | 'succeeded' | 'failed' | 'pending_approval', errorMessage?: string) { return this.actionRunRepo.updateStatus(id, status, errorMessage); }
  updateActionRunStep(id: string, currentStep: number, totalSteps?: number) { return this.actionRunRepo.updateStep(id, currentStep, totalSteps); }
  updateActionRunApproval(id: string, approvalStatus: 'pending' | 'approved' | 'rejected', approvalTool?: string) { return this.actionRunRepo.updateApproval(id, approvalStatus, approvalTool); }
  updateActionRunRecoveryStrategy(id: string, strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null) { return this.actionRunRepo.updateRecoveryStrategy(id, strategy); }
  updateActionRunPlan(id: string, plan: string) { return this.actionRunRepo.updatePlan(id, plan); }
  getRunningActionRuns(projectId: string) { return this.actionRunRepo.findRunning(projectId); }
  getActionRunsByProject(projectId: string, limit?: number) { return this.actionRunRepo.findByProjectId(projectId, limit); }
  getRecentActionRuns(limit: number) { return this.actionRunRepo.findRecent(limit); }
  findActionRunPendingApproval(actionRunId: string) { return this.actionRunRepo.findPendingApproval(actionRunId); }
  getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
  getActionRun(id: string) { return this.actionRunRepo.findById(id); }
  listAllDeploymentPatterns() { return this.deploymentPatternRepo.findAll(); }
  findDeploymentPatternsByProject(projectId: string) { return this.deploymentPatternRepo.findByProject(projectId); }
  findDeploymentPatternBySignature(projectId: string, signature: string) { return this.deploymentPatternRepo.findBySignature(projectId, signature); }
  upsertDeploymentPattern(data: { project_id: string; pattern_type: string; error_signature: string; fix_action: string }) { return this.deploymentPatternRepo.upsertPattern(data); }
  recordDeploymentPatternSuccess(id: string) { return this.deploymentPatternRepo.recordSuccess(id); }
  recordDeploymentPatternFailure(id: string) { return this.deploymentPatternRepo.recordFailure(id); }
  getTopDeploymentPatterns(projectId: string, limit?: number) { return this.deploymentPatternRepo.getTopPatterns(projectId, limit); }
  createOpsIncident(data: Parameters<OpsIncidentRepo['create']>[0]) { return this.opsIncidentRepo.create(data); }
  getOpsIncident(id: string) { return this.opsIncidentRepo.findById(id); }
  listOpsIncidentsByProject(projectId: string, limit?: number) { return this.opsIncidentRepo.findByProjectId(projectId, limit); }
  getActiveOpsIncident(projectId: string) { return this.opsIncidentRepo.findActive(projectId); }
  listAllActiveOpsIncidents() { return this.opsIncidentRepo.findAllActive(); }
  updateOpsIncidentStatus(id: string, status: string, extra?: { resolved_at?: number; escalated_at?: number }) { return this.opsIncidentRepo.updateStatus(id, status, extra); }
  updateOpsIncident(id: string, data: Parameters<OpsIncidentRepo['update']>[1]) { return this.opsIncidentRepo.update(id, data); }
  addOpsIncidentEvent(data: Parameters<OpsIncidentEventRepo['addEvent']>[0]) { return this.opsIncidentEventRepo.addEvent(data); }
  listOpsIncidentEvents(incidentId: string) { return this.opsIncidentEventRepo.findByIncidentId(incidentId); }
  listOpsIncidentEventsByIncidentIds(incidentIds: string[]) { return this.opsIncidentEventRepo.findByIncidentIds(incidentIds); }
   listOpsIncidentsByDateRange(from: number, to: number, searchText?: string) { return this.opsIncidentRepo.findByDateRange(from, to, searchText); }
  getCircuitBreakerState(projectId: string) { return this.circuitBreakerRepo.getState(projectId); }
  upsertCircuitBreakerState(projectId: string, data: Parameters<CircuitBreakerRepo['upsert']>[1]) { return this.circuitBreakerRepo.upsert(projectId, data); }
  incrementCircuitBreakerFailure(projectId: string) { return this.circuitBreakerRepo.incrementFailure(projectId); }
  openCircuitBreaker(projectId: string) { return this.circuitBreakerRepo.openBreaker(projectId); }
  halfOpenCircuitBreaker(projectId: string) { return this.circuitBreakerRepo.halfOpen(projectId); }
  resetCircuitBreaker(projectId: string) { return this.circuitBreakerRepo.reset(projectId); }
  findAllOpenCircuitBreakers() { return this.circuitBreakerRepo.findAllOpen(); }
  listAllCircuitBreakers() { return this.circuitBreakerRepo.findAll(); }
  isCircuitBreakerOpen(projectId: string) { return this.circuitBreakerRepo.isOpen(projectId); }
  createProjectDependency(data: Parameters<ProjectDependencyRepo['create']>[0]) { return this.projectDependencyRepo.create(data); }
  findDependenciesByProject(projectId: string) { return this.projectDependencyRepo.findByProject(projectId); }
  findDependenciesBySourceAndTargetService(sourceServiceId: string, targetServiceId: string) { return this.projectDependencyRepo.findBySourceAndTargetService(sourceServiceId, targetServiceId); }
  findProjectDependents(targetProjectId?: string, targetServiceId?: string) { return this.projectDependencyRepo.findDependents(targetProjectId, targetServiceId); }
  findAllProjectDependencies() { return this.projectDependencyRepo.findAll(); }
  deleteProjectDependency(id: string) { return this.projectDependencyRepo.delete(id); }
  deleteProjectDependenciesByProject(projectId: string) { return this.projectDependencyRepo.deleteByProject(projectId); }
  deleteProjectDependenciesByService(serviceId: string) { return this.projectDependencyRepo.deleteByService(serviceId); }
  syncDependenciesFromServiceConnections(serviceConnections: Parameters<ProjectDependencyRepo['syncFromServiceConnections']>[0]) { return this.projectDependencyRepo.syncFromServiceConnections(serviceConnections); }
  getProjectOpsOverride(projectId: string) { return this.projectOpsOverrideRepo.load(projectId); }
  setProjectOpsOverride(projectId: string, overrides: ProjectOpsOverride) { return this.projectOpsOverrideRepo.save(projectId, overrides); }
  deleteProjectOpsOverride(projectId: string) { return this.projectOpsOverrideRepo.delete(projectId); }
  insertActivityLog(data: Parameters<ActivityLogRepo['insert']>[0]) { return this.activityLogRepo.insert(data); }
  findActivityLogSince(lastUlid: string, limit?: number) { return this.activityLogRepo.findSince(lastUlid, limit); }
  findActivityLogByDateRange(from: string, to: string, filters?: { project_id?: string; activity_type?: string }, cursor?: string, limit?: number) { return this.activityLogRepo.findByDateRange(from, to, filters, cursor, limit); }
  findActivityLogRecent(limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findRecent(limit, filters); }
  findActivityLogSinceFiltered(lastUlid: string, limit?: number, filters?: { project_id?: string; activity_type?: string; severity?: string; correlation_id?: string }) { return this.activityLogRepo.findSinceFiltered(lastUlid, limit, filters); }
  deleteActivityLogOlderThan(isoDate: string) { return this.activityLogRepo.deleteOlderThan(isoDate); }
  recordServiceMetricSample(sample: Parameters<ServiceMetricRepo['recordMetricSample']>[0]) { return this.serviceMetricRepo.recordMetricSample(sample); }
  listServiceMetricsSince(serviceId: string, fromMs: number) { return this.serviceMetricRepo.listMetricsSince(serviceId, fromMs); }
  listServiceMetricsSinceForServices(serviceIds: readonly string[], fromMs: number) { return this.serviceMetricRepo.listMetricsSinceForServices(serviceIds, fromMs); }
  hasAnyServiceMetrics(serviceId: string) { return this.serviceMetricRepo.hasAnyMetrics(serviceId); }
  getLastServiceMetricAt(serviceId: string) { return this.serviceMetricRepo.getLastSampleAt(serviceId); }
  getLastServiceMetricAtByServiceIds(serviceIds: readonly string[]) { return this.serviceMetricRepo.getLastSampleAtByServiceIds(serviceIds); }
  getLatestServiceMetric(serviceId: string) { return this.serviceMetricRepo.getLatestSample(serviceId); }
  getSetting(key: string) { return this.settingsRepo.getSetting(key); }
  upsertSetting(key: string, value: string) { return this.settingsRepo.upsertSetting(key, value); }
  deleteSetting(key: string) { return this.settingsRepo.deleteSetting(key); }
  createDelivery(input: Parameters<DeliveryRepo['createDelivery']>[0]) { return this.deliveryRepo.createDelivery(input); }
  getDelivery(id: string) { return this.deliveryRepo.getDelivery(id); }
  requireDelivery(id: string) { return this.deliveryRepo.requireDelivery(id); }
  listDeliveries(projectId: string) { return this.deliveryRepo.listDeliveries(projectId); }
  updateDelivery(id: string, patch: Parameters<DeliveryRepo['updateDelivery']>[1]) { return this.deliveryRepo.updateDelivery(id, patch); }
  setDeliveryStatus(id: string, status: Parameters<DeliveryRepo['setDeliveryStatus']>[1]) { return this.deliveryRepo.setDeliveryStatus(id, status); }
  upsertArtifactBlob(input: Parameters<DeliveryRepo['upsertArtifactBlob']>[0]) { return this.deliveryRepo.upsertArtifactBlob(input); }
  getArtifactBlob(id: string) { return this.deliveryRepo.getArtifactBlob(id); }
  createDeliveryArtifact(input: Parameters<DeliveryRepo['createArtifact']>[0]) { return this.deliveryRepo.createArtifact(input); }
  getDeliveryArtifact(id: string) { return this.deliveryRepo.getArtifact(id); }
  listDeliveryArtifacts(deliveryId: string) { return this.deliveryRepo.listArtifacts(deliveryId); }
  updateDeliveryArtifact(id: string, patch: Parameters<DeliveryRepo['updateArtifact']>[1]) { return this.deliveryRepo.updateArtifact(id, patch); }
  createDeliveryExternalRef(input: Parameters<DeliveryRepo['createExternalRef']>[0]) { return this.deliveryRepo.createExternalRef(input); }
  listDeliveryExternalRefs(deliveryId: string) { return this.deliveryRepo.listExternalRefs(deliveryId); }
  createDeliveryFeedbackSource(input: Parameters<DeliveryRepo['createFeedbackSource']>[0]) { return this.deliveryRepo.createFeedbackSource(input); }
  listDeliveryFeedbackSources(deliveryId: string) { return this.deliveryRepo.listFeedbackSources(deliveryId); }
  createDeliveryWorkItems(deliveryId: string, items: Parameters<DeliveryRepo['createWorkItems']>[1]) { return this.deliveryRepo.createWorkItems(deliveryId, items); }
  listDeliveryWorkItems(deliveryId: string) { return this.deliveryRepo.listWorkItems(deliveryId); }
  updateDeliveryWorkItem(id: string, status: Parameters<DeliveryRepo['updateWorkItem']>[1], resolution?: string | null) { return this.deliveryRepo.updateWorkItem(id, status, resolution); }
  createDeliveryApproval(input: Parameters<DeliveryRepo['createApproval']>[0]) { return this.deliveryRepo.createApproval(input); }
  listDeliveryApprovals(deliveryId: string) { return this.deliveryRepo.listApprovals(deliveryId); }
  listDeliveryGates(deliveryId: string) { return this.deliveryRepo.listGates(deliveryId); }
  updateDeliveryGateTemplate(deliveryId: string, gateKey: string, patch: Parameters<DeliveryRepo['updateGateTemplate']>[2]) { return this.deliveryRepo.updateGateTemplate(deliveryId, gateKey, patch); }
  resetDeliveryGatesForType(deliveryId: string, deliveryType: Parameters<DeliveryRepo['resetGatesForType']>[1]) { return this.deliveryRepo.resetGatesForType(deliveryId, deliveryType); }
  recordDeliveryGateResult(input: Parameters<DeliveryRepo['recordGateResult']>[0]) { return this.deliveryRepo.recordGateResult(input); }
  linkDeliveryDeploy(input: Parameters<DeliveryRepo['linkDeploy']>[0]) { return this.deliveryRepo.linkDeploy(input); }
  unlinkDeliveryDeploy(deliveryId: string, deployId: string) { return this.deliveryRepo.unlinkDeploy(deliveryId, deployId); }
  listDeliveryDeployEvidence(deliveryId: string) { return this.deliveryRepo.listDeployEvidence(deliveryId); }
  getProjectDeliverySettings(projectId: string) { return this.deliveryRepo.getSettings(projectId); }
  upsertProjectDeliverySettings(projectId: string, input: Parameters<DeliveryRepo['upsertSettings']>[1]) { return this.deliveryRepo.upsertSettings(projectId, input); }
  getDeliveryReceipt(deliveryId: string) { return this.deliveryRepo.getReceipt(deliveryId); }
  recordDeliveryReceiptPreview(deliveryId: string, expectedEvidenceVersion: number) { return this.deliveryRepo.recordReceiptPreview(deliveryId, expectedEvidenceVersion); }
  finalizeDeliveryReceipt(input: Parameters<DeliveryRepo['finalizeReceipt']>[0]) { return this.deliveryRepo.finalizeReceipt(input); }
  getDeliveryProjectIdByArtifactId(artifactId: string) { return this.deliveryRepo.getDeliveryProjectIdByArtifactId(artifactId); }
  getDeliveryProjectIdsByDeployId(deployId: string) { return this.deliveryRepo.getDeliveryProjectIdByDeployId(deployId); }
  getDeliveryArtifactsByIds(ids: string[]) { return this.deliveryRepo.getArtifactsByIds(ids); }
  getArtifactProjectRowsByIds(ids: string[]) { return this.deliveryRepo.getArtifactProjectRowsByIds(ids); }
  listEngagements(includeArchived?: boolean) { return this.engagementRepo.list(includeArchived); }
  getEngagement(id: string) { return this.engagementRepo.get(id); }
  requireEngagement(id: string) { return this.engagementRepo.require(id); }
  createEngagement(input: Parameters<EngagementRepo['create']>[0]) { return this.engagementRepo.create(input); }
  bootstrapEngagement(input: Parameters<EngagementRepo['bootstrap']>[0]) { return this.engagementRepo.bootstrap(input); }
  updateEngagement(id: string, input: Parameters<EngagementRepo['update']>[1]) { return this.engagementRepo.update(id, input); }
  archiveEngagement(id: string, actor?: string) { return this.engagementRepo.archive(id, actor); }
  unarchiveEngagement(id: string, actor?: string) { return this.engagementRepo.unarchive(id, actor); }
  linkEngagementProject(engagementId: string, projectId: string, actor?: string) { return this.engagementRepo.linkProject(engagementId, projectId, actor); }
  unlinkEngagementProject(engagementId: string, projectId: string, actor?: string) { return this.engagementRepo.unlinkProject(engagementId, projectId, actor); }
  getProjectEngagement(projectId: string) { return this.engagementRepo.getProjectEngagement(projectId); }
  listUnassignedEngagementProjects() { return this.engagementRepo.listUnassignedProjects(); }
  getEngagementPortfolioRows(engagementIds: readonly string[]) { return this.engagementRepo.getPortfolioRows(engagementIds); }
  listEngagementRecentActivity(engagementId: string, projectIds: readonly string[], limit?: number) { return this.engagementRepo.listRecentActivity(engagementId, projectIds, limit); }
  transaction<T>(fn: () => T | Promise<T>) { return this.db.transaction(async () => await fn()); }
  close() { return this.client.end({ timeout: 5 }); }
}
