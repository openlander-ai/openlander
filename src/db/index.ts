import path from 'node:path';
import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { isNotNull } from 'drizzle-orm';
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

const log = createModuleLogger('db-migration');

function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../../drizzle'),
    path.resolve(import.meta.dirname, '../drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ];
  const cwdFallback = path.resolve(process.cwd(), 'drizzle');
  return candidates.find((p) => existsSync(path.join(p, 'meta/_journal.json'))) ?? cwdFallback;
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
  }

  static async connect(databaseUrl: string): Promise<Database> {
    const { client, db } = createDrizzleDatabase(databaseUrl);
    const migrationsFolder = resolveMigrationsFolder();
    await migrate(db, { migrationsFolder });
    log.info({ migrationsFolder }, 'Postgres migrations applied');
    const database = new Database(client, db);
    await database.actionRunRepo.markStaleAsFailedOnStartup();
    return database;
  }

  async createProject(project: Parameters<ProjectRepo['createProject']>[0]): Promise<ProjectRow> { const created = await this.projectRepo.createProject(project); await this.environmentRepo.createEnvironment({ id: `${project.id}-production`, projectId: created.id, type: 'production', branch: project.branch ?? 'main' }); return created; }
  getProject(id: string) { return this.projectRepo.getProject(id); }
  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
  listProjects(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
  listProjectsWithMetadata(status?: ProjectRow['status'] | null, opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjectsWithMetadata(status, opts); }
  getDeployableServiceCountsByProjectIds(projectIds: string[]) { return this.projectRepo.getDeployableServiceCountsByProjectIds(projectIds); }
  archiveProject(id: string) { return this.projectRepo.archiveProject(id); }
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
  // PROJECT_LOCK_TIMEOUT_MS (30min in src/llm/agent-pool.ts) AND
  // recovery-policy.ts:DEFAULT_LOCK_STALE_MS so in-memory + DB lock TTLs
  // + recovery stale window all share a single 30-min boundary.
  cleanExpiredDeployLocks(timeoutMinutes = 30) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
  createEnvironment(environment: Parameters<EnvironmentRepo['createEnvironment']>[0]) { return this.environmentRepo.createEnvironment(environment); }
  getEnvironment(id: string) { return this.environmentRepo.getEnvironment(id); }
  getEnvironmentsByProject(projectId: string) { return this.environmentRepo.getEnvironmentsByProject(projectId); }
  getEnvironmentsByProjectIds(projectIds: string[]) { return this.environmentRepo.getEnvironmentsByProjectIds(projectIds); }
  updateEnvironment(id: string, updates: Parameters<EnvironmentRepo['updateEnvironment']>[1]) { return this.environmentRepo.updateEnvironment(id, updates); }
  deleteEnvironment(id: string) { return this.environmentRepo.deleteEnvironment(id); }
  getEnvVars(projectId: string, environmentId?: string) { return this.envVarRepo.getEnvVars(projectId, environmentId); }
  setEnvVar(projectId: string, key: string, value: string, environmentId?: string) { return this.envVarRepo.setEnvVar(projectId, key, value, environmentId); }
  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.setEnvVarsBulk(projectId, vars, environmentId); }
  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string) { return this.envVarRepo.mergeEnvVars(projectId, vars, environmentId); }
  deleteEnvVar(projectId: string, key: string, environmentId?: string) { return this.envVarRepo.deleteEnvVar(projectId, key, environmentId); }
  assertEnvToolSchemaReady() { return this.envVarRepo.assertEnvToolSchemaReady(); }
  mergeEnvVarsDetailed(projectId: string, vars: Record<string, string>) { return this.envVarRepo.mergeEnvVarsDetailed(projectId, vars); }
  findProjectsByEnvKey(key: string) { return this.envVarRepo.findProjectsByEnvKey(key); }
  getGlobalSecrets() { return this.globalSecretRepo.getGlobalSecrets(); }
  getGlobalSecret(key: string) { return this.globalSecretRepo.getGlobalSecret(key); }
  setGlobalSecret(key: string, encryptedValue: string, iv: string, description?: string) { return this.globalSecretRepo.setGlobalSecret(key, encryptedValue, iv, description); }
  deleteGlobalSecret(key: string) { return this.globalSecretRepo.deleteGlobalSecret(key); }
  getSecretFiles(projectId: string | null) { return this.secretFileRepo.getSecretFiles(projectId); }
  getSecretFilesForDeploy(projectId: string) { return this.secretFileRepo.getSecretFilesForDeploy(projectId); }
  upsertSecretFile(projectId: string | null, filename: string, encryptedContent: string, iv: string, mountPath: string = '/run/secrets') { return this.secretFileRepo.upsertSecretFile(projectId, filename, encryptedContent, iv, mountPath); }
  deleteSecretFile(projectId: string | null, filename: string) { return this.secretFileRepo.deleteSecretFile(projectId, filename); }
  createService(service: Parameters<ServiceRepo['createService']>[0]) { return this.serviceRepo.createService(service); }
  adoptService(service: Parameters<ServiceRepo['adoptService']>[0]) { return this.serviceRepo.adoptService(service); }
  getService(id: string) { return this.serviceRepo.getService(id); }
  listServices() { return this.serviceRepo.listServices(); }
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
  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
  listRecentDeployLogsAcrossProjects(limit = 100) { return this.deployLogRepo.listRecentAcrossProjects(limit); }
  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
  updateRuntimeLog(deployId: string, runtimeLog: string) { return this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
  recordMcpSessionClose(opts: Parameters<McpSessionLogRepo['recordClose']>[0]) { return this.mcpSessionLogRepo.recordClose(opts); }
  listRecentClosedMcpSessions(limit = 50) { return this.mcpSessionLogRepo.listRecentClosed(limit); }
  createTimelineEvent(event: Parameters<TimelineRepo['createTimelineEvent']>[0]) { return this.timelineRepo.createTimelineEvent(event); }
  getTimelineEvents(projectId: string, limit = 200) { return this.timelineRepo.getTimelineEvents(projectId, limit); }
  deleteTimelineEvents(projectId: string) { return this.timelineRepo.deleteTimelineEvents(projectId); }
  createDomainMapping(mapping: Parameters<DomainMappingRepo['createDomainMapping']>[0]) { return this.domainMappingRepo.createDomainMapping(mapping); }
  getDomainMappings(projectId: string) { return this.domainMappingRepo.getDomainMappings(projectId); }
  listDomainMappings() { return this.domainMappingRepo.listDomainMappings(); }
  deleteDomainMapping(id: string) { return this.domainMappingRepo.deleteDomainMapping(id); }
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
  loadDeployConfig(projectId: string) { return this.deployConfigRepo.load(projectId); }
  deleteDeployConfig(projectId: string) { return this.deployConfigRepo.delete(projectId); }
  isPasswordSet() { return this.authRepo.isPasswordSet(); }
  getAuth() { return this.authRepo.getAuth(); }
  setPassword(hash: string) { return this.authRepo.setPassword(hash); }
  getApiToken() { return this.authRepo.getApiToken(); }
  setApiToken(encrypted: string, iv: string) { return this.authRepo.setApiToken(encrypted, iv); }
  getSession() { return this.authRepo.getSession(); }
  createSession(token: string, createdAt: number, expiresAt: number) { return this.authRepo.createSession(token, createdAt, expiresAt); }
  deleteSession() { return this.authRepo.deleteSession(); }
  async getUsedPorts(): Promise<number[]> { const serviceRows = await this.db.select({ assigned_port: services.assigned_port }).from(services).where(isNotNull(services.assigned_port)); const envRows = await this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)); const servicePorts = serviceRows.flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = envRows.flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...servicePorts, ...envPorts])]; }
  createAiUsageLog(data: Parameters<AiUsageLogRepo['create']>[0]) { return this.aiUsageLogRepo.create(data); }
  getAiUsageLogsByProject(projectId: string) { return this.aiUsageLogRepo.findByProjectId(projectId); }
  getAiUsageLogsByDateRange(from: Date, to: Date) { return this.aiUsageLogRepo.findByDateRange(from, to); }
  getAiTokenSummary(projectId?: string) { return this.aiUsageLogRepo.getTokenSummary(projectId); }
  getAiTokenSummaryFiltered(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.getTokenSummaryFiltered(opts); }
  getRecentAiUsageLogs(opts: { limit: number; projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.findRecent(opts); }
  countAiUsageLogs(opts?: { projectId?: string; from?: Date; to?: Date }) { return this.aiUsageLogRepo.countAll(opts); }
  createActionRun(data: Parameters<ActionRunRepo['create']>[0]) { return this.actionRunRepo.create(data); }
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
  findProjectDependents(targetProjectId?: string, targetServiceId?: string) { return this.projectDependencyRepo.findDependents(targetProjectId, targetServiceId); }
  findAllProjectDependencies() { return this.projectDependencyRepo.findAll(); }
  deleteProjectDependency(id: string) { return this.projectDependencyRepo.delete(id); }
  deleteProjectDependenciesByProject(projectId: string) { return this.projectDependencyRepo.deleteByProject(projectId); }
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
  hasAnyServiceMetrics(serviceId: string) { return this.serviceMetricRepo.hasAnyMetrics(serviceId); }
  getLastServiceMetricAt(serviceId: string) { return this.serviceMetricRepo.getLastSampleAt(serviceId); }
  getLatestServiceMetric(serviceId: string) { return this.serviceMetricRepo.getLatestSample(serviceId); }
  getSetting(key: string) { return this.settingsRepo.getSetting(key); }
  upsertSetting(key: string, value: string) { return this.settingsRepo.upsertSetting(key, value); }
  deleteSetting(key: string) { return this.settingsRepo.deleteSetting(key); }
  transaction<T>(fn: () => T | Promise<T>) { return this.db.transaction(async () => await fn()); }
  close() { return this.client.end({ timeout: 5 }); }
}
