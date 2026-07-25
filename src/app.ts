import { Database } from './db/index.js';
import { loadServiceViewRecord } from './db/views/service-view.js';
import { Docker } from './pipeline/docker.js';
import type { ServerContext } from './pipeline/server-context.js';
import { createLocalServerContext } from './pipeline/server-context.js';
import { serializeConfig, deserializeConfig, CONFIG_VERSION } from './pipeline/config-snapshot.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { appRouteProviderForTraefikMode, TraefikManager } from './pipeline/traefik.js';
import { containerName as projectContainerName } from './pipeline/helpers.js';
import { EnvManager } from './pipeline/env.js';
import type { Agent } from './llm/agent.js';
import { DeployQueue } from './pipeline/deploy-queue.js';
import { QuestionBridge } from './lib/question-bridge.js';
import { ModelRegistry } from './llm/model-registry.js';
import { LlmCircuitBreaker } from './llm/llm-circuit-breaker.js';
import { ProviderHealthMonitor } from './llm/provider-health-monitor.js';
import { CloudflareTunnelManager } from './pipeline/cloudflare.js';
import type { RuntimeBackend } from './pipeline/runtime/index.js';

import { ServiceManager } from './pipeline/service-manager.js';
import type { BuildDebugger } from './pipeline/build-debugger.js';
import { ChannelManager } from './channels/base.js';
import { PreviewDeployer } from './pipeline/preview.js';
import { JobManager } from './pipeline/job-manager.js';
import { ComposePipeline } from './pipeline/compose.js';
import { AutoDetector } from './pipeline/auto-detect.js';
import { AlertMonitor } from './monitor/alerts.js';
import { DockerEventListener } from './monitor/docker-events.js';
import { IncidentReporter } from './monitor/incident-reporter.js';
import type { ProjectHealthMonitor } from './monitor/project-health-monitor.js';
import { createProjectHealthMonitor } from './monitor/project-health-monitor.js';
import { ContainerStateReconciler } from './monitor/container-state-reconciler.js';
import type { ServiceHealthMonitor } from './monitor/service-health-monitor.js';
import { createServiceHealthMonitor } from './monitor/service-health-monitor.js';
import type { SystemMaintenanceMonitor } from './monitor/system-maintenance-monitor.js';
import { createSystemMaintenanceMonitor } from './monitor/system-maintenance-monitor.js';
import type { PostmortemGenerator } from './monitor/postmortem.js';
import { getPostmortemInstance } from './monitor/postmortem.js';
import { RollbackWatcher } from './monitor/rollback-watcher.js';
import { ActivityLogger } from './monitor/activity-logger.js';
import { AiUsageListener } from './monitor/ai-usage-listener.js';
import { AiOpsBriefingTrigger } from './monitor/ai-ops-briefing-trigger.js';
import { ProjectStateManager } from './monitor/project-state-manager.js';
import { McpClientManager } from './mcp/client-manager.js';
import { PlanEngine } from './pipeline/deploy-plan/engine.js';
import { RecoveryCoordinator } from './_ai-ops/recovery-coordinator.js';
import { handleDestructiveMcpApproval } from './mcp/destructive-executor.js';
import { eventBus } from './events/index.js';
import type { EventBus } from './events/index.js';
import { normalizeLlmConfig, type OpenLanderConfig } from './config/index.js';
import type { LanguageModel } from 'ai';
import { createModuleLogger } from './lib/logger.js';
import type { AgentPool } from './_ai-ops/agent-pool.js';
import { ApprovalGate } from './pipeline/approval-gate.js';
import type { OpsAgent } from './_ai-ops/ops-agent.js';
import { GitCredentialManager, setActiveGitCredentialManager } from './git-credentials/manager.js';
import { ArtifactStore } from './delivery/artifact-store.js';
import { DeliveryService } from './delivery/delivery-service.js';

const log = createModuleLogger('app');

let activeIncidentReporter: IncidentReporter | null = null;
let activeActivityLogger: ActivityLogger | null = null;
let activeAiUsageListener: AiUsageListener | null = null;
let activeActivityLogCleanupInterval: ReturnType<typeof setInterval> | null = null;

const POSTMORTEM_STABILITY_WINDOW_MS = 5 * 60 * 1000;
const ACTIVITY_LOG_TTL_DAYS = 30;
const ACTIVITY_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const POSTMORTEM_CANCEL_EVENTS = [
  'recovery:failed',
  'recovery:exhausted',
  'deploy:failed',
] as const;

type PostmortemProjectLookup = Pick<Database, 'getProject' | 'getDeployableForProject'>;
type PostmortemGeneratorLike = Pick<PostmortemGenerator, 'generatePostmortem'>;

interface RecoveryPostmortemAutomationOptions {
  eventBus: EventBus;
  db: PostmortemProjectLookup;
  getPostmortem: () => PostmortemGeneratorLike | null;
  isEligible?: (projectId: string) => boolean | Promise<boolean>;
  delayMs?: number;
}

export function setupRecoveryPostmortemAutomation({
  eventBus,
  db,
  getPostmortem,
  isEligible,
  delayMs = POSTMORTEM_STABILITY_WINDOW_MS,
}: RecoveryPostmortemAutomationOptions): () => void {
  const postmortemTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelTimer = (projectId: string): void => {
    const existingTimer = postmortemTimers.get(projectId);
    if (!existingTimer) {
      return;
    }

    clearTimeout(existingTimer);
    postmortemTimers.delete(projectId);
  };

  const unsubscribeRecoverySuccess = eventBus.on('recovery:success', (payload) => {
    cancelTimer(payload.projectId);

    const timer = setTimeout(() => {
      void (async () => {
        postmortemTimers.delete(payload.projectId);

        const project = await db.getProject(payload.projectId);
        const status = project ? (await loadServiceViewRecord(db, project)).view.status : null;
        if (!project || status !== 'running') {
          return;
        }

        if (isEligible && !(await isEligible(payload.projectId))) {
          log.info({ projectId: payload.projectId }, 'Auto-postmortem skipped: not eligible');
          return;
        }

        const postmortem = getPostmortem();
        if (!postmortem) {
          return;
        }

        try {
          await postmortem.generatePostmortem(payload.projectId);
          log.info({ projectId: payload.projectId }, 'Auto-postmortem generated after recovery');
        } catch (err) {
          log.error({ err, projectId: payload.projectId }, 'Auto-postmortem generation failed');
        }
      })();
    }, delayMs);

    postmortemTimers.set(payload.projectId, timer);
  });

  const unsubscribeCancels = POSTMORTEM_CANCEL_EVENTS.map((eventName) =>
    eventBus.on(eventName, (payload) => {
      cancelTimer(payload.projectId);
    }),
  );

  return () => {
    unsubscribeRecoverySuccess();
    for (const unsubscribe of unsubscribeCancels) {
      unsubscribe();
    }
    for (const timer of postmortemTimers.values()) {
      clearTimeout(timer);
    }
    postmortemTimers.clear();
  };
}

/**
 * Application context — wires all modules together.
 *
 * Created once at startup. Passed to API routes and CLI commands.
 * This is the single source of truth for all runtime instances.
 */
export interface AppContext {
  config: OpenLanderConfig;
  db: Database;
  gitCredentials: GitCredentialManager;
  eventBus: EventBus;
  docker: Docker;
  runtime: RuntimeBackend;
  serverContext: ServerContext;
  pipeline: DeployPipeline;
  composePipeline: ComposePipeline;
  traefik: TraefikManager;
  env: EnvManager;
  agentPool: AgentPool | null;
  agent: Agent | null;
  modelRegistry: ModelRegistry;
  llmCircuitBreaker: LlmCircuitBreaker;
  model: LanguageModel | null;
  deployQueue: DeployQueue;
  // v0.2 modules
  projectHealthMonitor: ProjectHealthMonitor;
  containerStateReconciler: ContainerStateReconciler;
  serviceHealthMonitor: ServiceHealthMonitor;
  systemMaintenanceMonitor: SystemMaintenanceMonitor;
  dockerEventListener?: DockerEventListener;
  opsAgent?: OpsAgent;
  cloudflare: CloudflareTunnelManager;
  // v0.3 modules
  buildDebugger: BuildDebugger | null;
  // v0.4 modules
  channelManager: ChannelManager;
  previewDeployer: PreviewDeployer;
  jobManager: JobManager;
  autoDetector: AutoDetector;
  // v0.5 modules
  alertMonitor: AlertMonitor;
  aiOpsBriefingTrigger: AiOpsBriefingTrigger;
  questionBridge: QuestionBridge;
  serviceManager: ServiceManager;
  approvalGate: ApprovalGate;
  // v1.0 modules
  mcpClientManager: McpClientManager;
  planEngine: PlanEngine;
  artifactStore: ArtifactStore;
  deliveryService: DeliveryService;
  // v1.0: Recovery coordinator
  coordinator: RecoveryCoordinator;
  rollbackWatcher: RollbackWatcher;
  stateManager: ProjectStateManager;
  providerHealth: ProviderHealthMonitor;
  llmVerified: boolean;
}

function serviceNeedsManagedTraefikNetwork(service: {
  status: string | null;
  container_id: string | null;
  archived_at: string | null;
}): boolean {
  if (service.archived_at) return false;
  return (
    service.status === 'running' || (service.status === 'building' && Boolean(service.container_id))
  );
}

export async function syncManagedTraefikProjectNetworks(
  ctx: Pick<AppContext, 'config' | 'db' | 'traefik'>,
): Promise<void> {
  if (ctx.config.traefik.mode !== 'managed') {
    return;
  }

  const [projects, services] = await Promise.all([
    ctx.db.listProjects(undefined, { includeArchived: false }),
    ctx.db.listServices(),
  ]);
  const projectNamesById = new Map(projects.map((project) => [project.id, project.name]));
  const networkNames = new Set<string>();

  for (const service of services) {
    if (!serviceNeedsManagedTraefikNetwork(service)) {
      continue;
    }
    const projectName = projectNamesById.get(service.project_id);
    if (!projectName) {
      continue;
    }
    networkNames.add(projectContainerName(projectName));
  }

  for (const networkName of networkNames) {
    await ctx.traefik.connectToNetwork(networkName);
  }
}

/**
 * One-time data migration: set resourceProfile='small' as default for all
 * existing projects that have no resource config in deploy_configs.
 * Idempotent — safe to run on every startup.
 */
async function migrateDefaultResourceProfile(db: Database): Promise<void> {
  const allProjects = await db.listProjects(undefined, { includeArchived: true });
  let migratedCount = 0;
  let skippedCount = 0;

  for (const project of allProjects) {
    const service = (await loadServiceViewRecord(db, project)).service;
    if (!service) {
      skippedCount++;
      continue;
    }

    const configRow = await db.loadDeployConfigForService(service.id);
    if (!configRow) {
      const json = serializeConfig({ resourceProfile: 'small' });
      await db.saveDeployConfigForService(service.id, json, CONFIG_VERSION);
      migratedCount++;
    } else {
      const stored = deserializeConfig(configRow.config_json);
      if (stored && !stored.snapshot.resourceProfile) {
        const updatedSnapshot = { ...stored.snapshot, resourceProfile: 'small' as const };
        const json = serializeConfig(updatedSnapshot);
        await db.saveDeployConfigForService(service.id, json, CONFIG_VERSION);
        migratedCount++;
      }
    }
  }

  if (migratedCount > 0) {
    log.info({ migratedCount }, 'Migration: applied default resource profile to existing projects');
  }
  if (skippedCount > 0) {
    log.debug(
      { skippedCount },
      'Migration: skipped default resource profile for project groups without canonical deployable services',
    );
  }
}

/** Create the application context from config. */
export async function createAppContext(
  config: OpenLanderConfig,
  databaseUrl: string,
): Promise<AppContext> {
  const db = await Database.connect(databaseUrl);
  const artifactStore = new ArtifactStore();
  const deliveryService = new DeliveryService(db, artifactStore);
  const gitCredentials = new GitCredentialManager(db);
  setActiveGitCredentialManager(gitCredentials);
  await migrateDefaultResourceProfile(db);
  const docker = new Docker(config.docker.socketPath || undefined, config.docker.networkName);
  const runtime: RuntimeBackend = docker;
  const serverContext = createLocalServerContext(docker);

  const jobManager = new JobManager();
  const env = new EnvManager(db);
  const routeProvider = appRouteProviderForTraefikMode(config.traefik.mode);
  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager, env, routeProvider);
  const traefik = new TraefikManager(runtime, config.server.port, {
    networkName: config.docker.networkName,
  });

  const llmCircuitBreaker = new LlmCircuitBreaker();

  const modelRegistry = new ModelRegistry(
    normalizeLlmConfig(config.llm),
    eventBus,
    llmCircuitBreaker,
  );

  const model: LanguageModel | null = null;

  // OpenLander 0.1 disables built-in LLM/AI Ops. External MCP agents remain available.
  const autoDetector = new AutoDetector(null);
  const buildDebugger: BuildDebugger | null = null;

  // V0.2_REENABLE: built-in AI Ops is cold-storage in 0.1. The coordinator is
  // constructed for pipeline compatibility, but coordinator.start(), OpsAgent,
  // and automatic recovery wiring must stay off until the product surface and
  // tests are deliberately restored.
  const coordinator = new RecoveryCoordinator(db, eventBus, config);
  let pipelineCtx: AppContext | null = null;

  const pipeline = new DeployPipeline(
    runtime,
    db,
    env,
    config,
    {
      transition: async (projectId, targetStatus, reason, options) => {
        if (!pipelineCtx) {
          throw new Error('ProjectStateManager is not ready');
        }
        return pipelineCtx.stateManager.transition(projectId, targetStatus, reason, options);
      },
    },
    jobManager,
    composePipeline,
    autoDetector,
    coordinator,
  );
  const approvalGate = new ApprovalGate(config.monitoring.approvalTimeoutMs);

  // v0.7: Question bridge (agent ↔ UI)
  const questionBridge = new QuestionBridge();
  questionBridge.setEventBus(eventBus);

  const deployQueue = new DeployQueue();

  // Track active project for question events
  eventBus.on('deploy:start', (payload) => {
    try {
      questionBridge.setActiveProject(payload.projectId);
    } catch (error) {
      log.error({ error }, 'Unhandled error in deploy:start event handler');
    }
  });
  eventBus.on('deploy:success', () => {
    try {
      questionBridge.setActiveProject(null);
    } catch (error) {
      log.error({ error }, 'Unhandled error in deploy:success event handler');
    }
  });
  eventBus.on('deploy:failed', () => {
    try {
      questionBridge.setActiveProject(null);
    } catch (error) {
      log.error({ error }, 'Unhandled error in deploy:failed event handler');
    }
  });

  log.info('Built-in LLM/AI Ops disabled for OpenLander 0.1');

  // Recovery notifications — NotificationCenter integration
  eventBus.on('recovery:started', (payload) => {
    void ctx.channelManager
      .sendRecoveryNotification(
        `🔄 Recovery started for project "${payload.projectId}" (trigger: ${payload.trigger})`,
      )
      .catch((err: unknown) => {
        log.error({ err }, 'Failed to send recovery:started notification');
      });
  });

  eventBus.on('recovery:stopped', (payload) => {
    void ctx.channelManager
      .sendRecoveryNotification(
        `⛔ Recovery stopped for project "${payload.projectId}": ${payload.reason}`,
      )
      .catch((err: unknown) => {
        log.error({ err }, 'Failed to send recovery:stopped notification');
      });
  });

  eventBus.on('recovery:blocked', (payload) => {
    void ctx.channelManager
      .sendRecoveryNotification(
        `🚫 Recovery blocked for project "${payload.projectId}" (reason: ${payload.reason})`,
      )
      .catch((err: unknown) => {
        log.error({ err }, 'Failed to send recovery:blocked notification');
      });
  });

  // v0.2: Health monitoring
  const monitorIntervalMs = config.monitoring.healthcheckIntervalSec * 1000;
  const projectHealthMonitor = createProjectHealthMonitor(docker, db, eventBus, {
    intervalMs: monitorIntervalMs,
  });
  const containerStateReconciler = new ContainerStateReconciler(docker, db, eventBus, {
    intervalMs: monitorIntervalMs,
  });
  const systemMaintenanceMonitor = createSystemMaintenanceMonitor(docker, db, eventBus, {
    intervalMs: monitorIntervalMs,
  });

  // v0.2: Cloudflare production tunnels
  const cloudflare = new CloudflareTunnelManager(config.cloudflare, db, eventBus);

  const serviceManager = new ServiceManager(runtime, db);

  // ServiceHealthMonitor depends on serviceManager for the v4 sparkline
  // recorder hook (Phase E_NEW Task 5). Construct after serviceManager so
  // each tick can persist a sample into `service_metrics`.
  const serviceHealthMonitor = createServiceHealthMonitor(docker, db, eventBus, {
    intervalMs: monitorIntervalMs,
    serviceManager,
  });

  try {
    await traefik.ensureAllNetworks();
    await serviceManager.reconcileServiceNetworks();
  } catch (err) {
    log.warn({ err }, 'Service network reconciliation failed during startup');
  }

  // (Build debugger moved above pipeline creation)

  // v0.4: Preview deployer
  const previewDeployer = new PreviewDeployer(docker, db, routeProvider);

  // v0.5: Alert monitor
  const alertMonitor = new AlertMonitor(docker, db, eventBus);

  const dockerEventListener = new DockerEventListener(docker, db, eventBus);

  // Wire platform event capture (captures all eventBus emissions for platform_event_log tool)
  if (config.mcp.platformTools === true) {
    const { wireEventCapture } = await import('./tools/defs/platform-read.js');
    wireEventCapture(eventBus);
  }

  // v1.0: MCP client manager (connects to external MCP servers)
  // Connection and tool merging handled by callers (cli/index.ts, setup-routes.ts)
  const mcpClientManager = new McpClientManager();

  // v1.0: Plan engine (deployment planning and execution)
  const planEngine = new PlanEngine({
    db,
    pipeline,
    env,
    serviceManager,
    autoDetector,
    config,
    events: eventBus,
    composePipeline,
    docker,
  });

  const rollbackWatcher = new RollbackWatcher(eventBus, db, pipeline);

  const providerHealth = new ProviderHealthMonitor();

  // Build partial ctx without channelManager, then compose the full AppContext
  let mutableAgentPool: AgentPool | null = null;
  let mutableAgent: Agent | null = null;

  const partialCtx = {
    config,
    db,
    gitCredentials,
    eventBus,
    docker,
    runtime,
    serverContext,
    pipeline,
    composePipeline,
    traefik,
    env,
    get agentPool() {
      return mutableAgentPool;
    },
    set agentPool(value: AgentPool | null) {
      if (mutableAgentPool && value === null) {
        mutableAgentPool.invalidateAll();
      }
      mutableAgentPool = value;
    },
    get agent() {
      return mutableAgent ?? mutableAgentPool?.getRecoveryAgent() ?? null;
    },
    set agent(value: Agent | null) {
      mutableAgent = value;
    },
    modelRegistry,
    llmCircuitBreaker,
    providerHealth,
    model,
    deployQueue,
    projectHealthMonitor,
    containerStateReconciler,
    serviceHealthMonitor,
    systemMaintenanceMonitor,
    cloudflare,
    buildDebugger,
    previewDeployer,
    jobManager,
    autoDetector,
    alertMonitor,
    dockerEventListener,
    questionBridge,
    serviceManager,
    approvalGate,
    mcpClientManager,
    planEngine,
    artifactStore,
    deliveryService,
    coordinator,
    rollbackWatcher,
    llmVerified: false,
  };

  // v0.4: ChannelManager needs AppContext but never self-references channelManager.
  // We cast partialCtx which is structurally complete for ChannelManager's actual usage.
  const channelManager = new ChannelManager(partialCtx as AppContext);
  const ctx = { ...partialCtx, channelManager } as AppContext;
  ctx.aiOpsBriefingTrigger = new AiOpsBriefingTrigger({
    eventBus,
    db,
    runtime: docker,
    modelRegistry,
    channelManager,
    config,
  });
  ctx.stateManager = new ProjectStateManager(ctx);
  composePipeline.setStateManager(ctx.stateManager);
  pipelineCtx = ctx;
  coordinator.setStateManager(ctx.stateManager);
  ctx.containerStateReconciler.setStateManager(ctx.stateManager);

  eventBus.on('recovery:approval-resolved', (payload) => {
    void handleDestructiveMcpApproval(ctx, payload).catch((err: unknown) => {
      log.error({ err, actionRunId: payload.actionRunId }, 'Destructive MCP execution failed');
    });
  });

  try {
    const reconcileResult = await ctx.stateManager.reconcileAll();
    if (reconcileResult.reconciled > 0) {
      log.info(reconcileResult, 'Startup reconciliation completed');
    }
  } catch (err) {
    log.warn({ err }, 'Startup reconciliation failed — deferring to periodic reconciler');
  }

  coordinator.setConfigGetter(() => ctx.config);

  const incidentReporter = new IncidentReporter(channelManager, eventBus, db, config);
  incidentReporter.start();
  activeIncidentReporter = incidentReporter;

  // Activity log cleanup: purge records older than ACTIVITY_LOG_TTL_DAYS on startup and every 24h
  const runActivityLogCleanup = (): void => {
    try {
      const cutoff = new Date(
        Date.now() - ACTIVITY_LOG_TTL_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      void db
        .deleteActivityLogOlderThan(cutoff)
        .then((deleted) => {
          if (deleted > 0) log.info({ deleted }, 'Activity log cleanup completed');
        })
        .catch((err: unknown) => {
          log.error({ err }, 'Activity log cleanup failed');
        });
    } catch (err) {
      log.error({ err }, 'Activity log cleanup failed');
    }
  };
  runActivityLogCleanup();
  if (activeActivityLogCleanupInterval) clearInterval(activeActivityLogCleanupInterval);
  activeActivityLogCleanupInterval = setInterval(
    runActivityLogCleanup,
    ACTIVITY_LOG_CLEANUP_INTERVAL_MS,
  );

  // Activity event persistence subscriber
  activeActivityLogger?.stop();
  const activityLogger = new ActivityLogger(eventBus, db);
  activityLogger.start();
  activeActivityLogger = activityLogger;

  // AI usage persistence subscriber. This only records emitted usage events; it
  // does not invoke models or enable any automatic AI Ops workflow.
  activeAiUsageListener?.stop();
  const aiUsageListener = new AiUsageListener(db, eventBus);
  aiUsageListener.start();
  activeAiUsageListener = aiUsageListener;

  return ctx;
}

/** Shutdown the application context. */
export async function shutdownAppContext(ctx: AppContext): Promise<void> {
  setActiveGitCredentialManager(null);
  activeIncidentReporter?.stop();
  activeActivityLogger?.stop();
  activeAiUsageListener?.stop();
  if (activeActivityLogCleanupInterval) {
    clearInterval(activeActivityLogCleanupInterval);
    activeActivityLogCleanupInterval = null;
  }
  activeIncidentReporter = null;
  activeActivityLogger = null;
  activeAiUsageListener = null;
  getPostmortemInstance()?.stop();
  ctx.providerHealth.stop();
  ctx.rollbackWatcher.stop();
  ctx.aiOpsBriefingTrigger.stop();
  ctx.alertMonitor.stop();
  ctx.systemMaintenanceMonitor.stop();
  ctx.serviceHealthMonitor.stop();
  ctx.containerStateReconciler.stop();
  ctx.projectHealthMonitor.stop();
  ctx.dockerEventListener?.stop();
  ctx.coordinator.stop();
  void ctx.opsAgent?.stop();
  void ctx.channelManager.stop();
  void ctx.previewDeployer.cleanupAll();
  ctx.approvalGate.dispose();
  await ctx.db.close();
  void ctx.mcpClientManager.disconnectAll();
}
