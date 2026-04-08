import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isNotNull } from 'drizzle-orm';
import { createDrizzleDatabase, type DrizzleClient, type SqliteDatabase } from './drizzle.js';
import { initializeDatabase } from './migration.js';
import { environments, projects } from './schema.drizzle.js';
import { ProjectRepo } from './repos/project.repo.js';
import { EnvironmentRepo } from './repos/environment.repo.js';
import { EnvVarRepo } from './repos/env-var.repo.js';
import { GlobalSecretRepo } from './repos/global-secret.repo.js';
import { SecretFileRepo } from './repos/secret-file.repo.js';
import { ServiceRepo } from './repos/service.repo.js';
import { ServiceConnectionRepo } from './repos/service-connection.repo.js';
import { RuntimeIncidentRepo } from './repos/runtime-incident.repo.js';
import { DeployLogRepo } from './repos/deploy-log.repo.js';
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
} from './types.js';

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

    constructor(dbPath: string) {
      mkdirSync(dirname(dbPath), { recursive: true });
      const { sqlite, db } = createDrizzleDatabase(dbPath);
      this.sqlite = sqlite;
      this.db = db;
      initializeDatabase(this.sqlite);
      this.projectRepo = new ProjectRepo(this.db, this.sqlite);
      this.environmentRepo = new EnvironmentRepo(this.db, this.sqlite);
      this.envVarRepo = new EnvVarRepo(this.db, this.sqlite);
      this.globalSecretRepo = new GlobalSecretRepo(this.db, this.sqlite);
      this.secretFileRepo = new SecretFileRepo(this.db, this.sqlite);
       this.serviceRepo = new ServiceRepo(this.db, this.sqlite);
       this.serviceConnectionRepo = new ServiceConnectionRepo(this.db, this.sqlite);
       this.runtimeIncidentRepo = new RuntimeIncidentRepo(this.db, this.sqlite);
       this.deployLogRepo = new DeployLogRepo(this.db, this.sqlite);
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
        this.actionRunRepo.markStaleAsFailedOnStartup();
      }

  createProject(project: Parameters<ProjectRepo['createProject']>[0]): ProjectRow { const created = this.projectRepo.createProject(project); this.environmentRepo.createEnvironment({ id: `${project.id}-production`, projectId: created.id, type: 'production', branch: project.branch ?? 'main' }); return created; }
  getProject(id: string) { return this.projectRepo.getProject(id); }
  getProjectByName(name: string) { return this.projectRepo.getProjectByName(name); }
  listProjects(status?: ProjectRow['status'], opts?: { includeArchived?: boolean }) { return this.projectRepo.listProjects(status, opts); }
  archiveProject(id: string) { this.projectRepo.archiveProject(id); }
  unarchiveProject(id: string) { this.projectRepo.unarchiveProject(id); }
  listArchivedProjects() { return this.projectRepo.listArchivedProjects(); }
  isArchived(id: string) { return this.projectRepo.isArchived(id); }
  updateProject(id: string, updates: Parameters<ProjectRepo['updateProject']>[1]) { this.projectRepo.updateProject(id, updates); }
  setPendingFix(projectId: string, pendingFix: Parameters<ProjectRepo['setPendingFix']>[1]) { this.projectRepo.setPendingFix(projectId, pendingFix); }
  consumePendingFix(projectId: string) { return this.projectRepo.consumePendingFix(projectId); }
  deleteProject(id: string) { this.projectRepo.deleteProject(id); }
  getChildProjects(parentId: string) { return this.projectRepo.getChildProjects(parentId); }
  getPreviewProjects(parentProjectId: string) { return this.projectRepo.getPreviewProjects(parentProjectId); }
  isParentProject(id: string) { return this.projectRepo.isParentProject(id); }
  acquireDeployLock(projectId: string, sessionId: string) { return this.projectRepo.acquireDeployLock(projectId, sessionId); }
  releaseDeployLock(projectId: string) { this.projectRepo.releaseDeployLock(projectId); }
  getDeployLockInfo(projectId: string) { return this.projectRepo.getDeployLockInfo(projectId); }
  cleanExpiredDeployLocks(timeoutMinutes = 10) { return this.projectRepo.cleanExpiredDeployLocks(timeoutMinutes); }
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
   updateService(id: string, updates: Parameters<ServiceRepo['updateService']>[1]) { this.serviceRepo.updateService(id, updates); }
   deleteService(id: string) { this.serviceRepo.deleteService(id); }
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
    resolveRuntimeIncident(id: string) { this.runtimeIncidentRepo.resolveIncident(id); }
    updateRuntimeIncidentDiagnosis(id: string, diagnosis: string) { this.runtimeIncidentRepo.updateDiagnosis(id, diagnosis); }
    createDeployLog(log: Parameters<DeployLogRepo['createDeployLog']>[0]) { this.deployLogRepo.createDeployLog(log); }
  getDeployLogs(projectId: string, limit = 20, environmentId?: string) { return this.deployLogRepo.getDeployLogs(projectId, limit, environmentId); }
  getLastDeployLog(projectId: string, environmentId?: string) { return this.deployLogRepo.getLastDeployLog(projectId, environmentId); }
  getDeployLog(deployId: string) { return this.deployLogRepo.getDeployLog(deployId); }
  updateRuntimeLog(deployId: string, runtimeLog: string) { this.deployLogRepo.updateRuntimeLog(deployId, runtimeLog); }
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
    getUsedPorts(): number[] { const projectPorts = this.db.select({ assigned_port: projects.assigned_port }).from(projects).where(isNotNull(projects.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); const envPorts = this.db.select({ assigned_port: environments.assigned_port }).from(environments).where(isNotNull(environments.assigned_port)).all().flatMap((r: { assigned_port: number | null }) => (r.assigned_port === null ? [] : [r.assigned_port])); return [...new Set([...projectPorts, ...envPorts])]; }
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
     findActionRunPendingApproval(actionRunId: string) { return this.actionRunRepo.findPendingApproval(actionRunId); }
     getActionRunsByApprovalStatus(status: 'pending' | 'approved' | 'rejected', limit?: number) { return this.actionRunRepo.findByApprovalStatus(status, limit); }
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
      listOpsIncidentsByDateRange(from: number, to: number) { return this.opsIncidentRepo.findByDateRange(from, to); }
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
      transaction<T>(fn: () => T) { return this.sqlite.transaction(fn)(); }
      close() { this.sqlite.close(); }
    }
