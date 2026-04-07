import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './llm/agent.js';
import { DeployQueue } from './pipeline/deploy-queue.js';
import { QuestionBridge } from './lib/question-bridge.js';
import { ModelRegistry } from './llm/model-registry.js';
import { createModelProxy } from './llm/model-proxy.js';
import { HealthMonitor } from './monitor/health.js';
import { WebhookManager } from './webhook/index.js';
import { CloudflareTunnelManager } from './pipeline/cloudflare.js';

import { ServiceManager } from './pipeline/service-manager.js';
import { BuildDebugger } from './pipeline/build-debugger.js';
import { ChannelManager } from './channels/base.js';
import { PreviewDeployer } from './pipeline/preview.js';
import { JobManager } from './pipeline/job-manager.js';
import { ComposePipeline } from './pipeline/compose.js';
import { AutoDetector } from './pipeline/auto-detect.js';
import { AlertMonitor } from './monitor/alerts.js';
import { DockerEventListener } from './monitor/docker-events.js';
import { IncidentReporter } from './monitor/incident-reporter.js';
import {
  PostmortemGenerator,
  setPostmortemInstance,
  getPostmortemInstance,
} from './monitor/postmortem.js';
import { RollbackWatcher } from './monitor/rollback-watcher.js';
import { McpClientManager } from './mcp/client-manager.js';
import { PlanEngine } from './pipeline/deploy-plan/engine.js';
import { RecoveryCoordinator } from './monitor/recovery-coordinator.js';
import { eventBus } from './events/index.js';
import type { EventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';
import { normalizeLlmConfig } from './config/index.js';
import type { LanguageModel } from 'ai';
import { buildContextSnapshot } from './llm/prompts.js';
import { createModuleLogger } from './lib/logger.js';
import { setupAutoRecovery } from './pipeline/auto-recovery.js';
import { AgentPool } from './llm/agent-pool.js';
import { createTools } from './tools/index.js';
import { ApprovalGate } from './pipeline/approval-gate.js';
import type { OpsAgent } from './monitor/ops-agent.js';

const log = createModuleLogger('app');

let activeIncidentReporter: IncidentReporter | null = null;
let activeRollbackWatcher: RollbackWatcher | null = null;
let activePostmortemAutomationStop: (() => void) | null = null;

const POSTMORTEM_STABILITY_WINDOW_MS = 5 * 60 * 1000;
const POSTMORTEM_CANCEL_EVENTS = [
  'recovery:failed',
  'recovery:exhausted',
  'deploy:failed',
] as const;

type PostmortemProjectLookup = Pick<Database, 'getProject'>;
type PostmortemGeneratorLike = Pick<PostmortemGenerator, 'generatePostmortem'>;

interface RecoveryPostmortemAutomationOptions {
  eventBus: EventBus;
  db: PostmortemProjectLookup;
  getPostmortem: () => PostmortemGeneratorLike | null;
  isEligible?: (projectId: string) => boolean;
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

        const project = db.getProject(payload.projectId);
        if (!project || project.status !== 'running') {
          return;
        }

        if (isEligible && !isEligible(payload.projectId)) {
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
  docker: Docker;
  pipeline: DeployPipeline;
  composePipeline: ComposePipeline;
  traefik: TraefikManager;
  env: EnvManager;
  agentPool: AgentPool | null;
  agent: Agent | null;
  modelRegistry: ModelRegistry;
  model: LanguageModel | null;
  deployQueue: DeployQueue;
  // v0.2 modules
  healthMonitor: HealthMonitor;
  dockerEventListener?: DockerEventListener;
  opsAgent?: OpsAgent;
  webhookManager: WebhookManager;
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
  questionBridge: QuestionBridge;
  serviceManager: ServiceManager;
  approvalGate: ApprovalGate;
  // v1.0 modules
  mcpClientManager: McpClientManager;
  planEngine: PlanEngine;
  // v1.0: Recovery coordinator
  coordinator: RecoveryCoordinator;
  llmVerified: boolean;
}

/** Reset projects and environments stuck in 'building' status from a previous server run. */
async function cleanupStaleBuilds(db: Database, docker: Docker): Promise<void> {
  const staleProjects = db.listProjects('building', { includeArchived: true });
  if (staleProjects.length === 0) return;

  log.info({ count: staleProjects.length }, 'Found stale building projects — cleaning up');

  let runningContainerIds: Set<string>;
  try {
    const containers = await docker.listManagedContainers();
    runningContainerIds = new Set(
      containers.filter((c) => c.status === 'running').map((c) => c.id),
    );
  } catch (err) {
    log.warn({ err }, 'Docker unreachable during stale build cleanup — deferring reconciliation');
    return;
  }

  for (const project of staleProjects) {
    if (project.status !== 'building') continue;
    const isContainerRunning =
      project.container_id != null && runningContainerIds.has(project.container_id);
    const newStatus = isContainerRunning ? 'running' : 'stopped';
    db.updateProject(project.id, { status: newStatus });
    log.info(
      { projectId: project.id, name: project.name, from: 'building', to: newStatus },
      'Stale build status reset',
    );

    const envs = db.getEnvironmentsByProject(project.id);
    for (const env of envs) {
      if (env.status !== 'building') continue;
      const envContainerRunning =
        env.container_id != null && runningContainerIds.has(env.container_id);
      const envNewStatus = envContainerRunning ? 'running' : 'stopped';
      db.updateEnvironment(env.id, { status: envNewStatus });
      log.info(
        { envId: env.id, type: env.type, from: 'building', to: envNewStatus },
        'Stale environment status reset',
      );
    }
  }
}

/** Create the application context from config. */
export async function createAppContext(
  config: OpenLanderConfig,
  dbPath: string,
): Promise<AppContext> {
  const db = new Database(dbPath);
  const docker = new Docker(config.docker.socketPath || undefined, config.docker.networkName);

  await cleanupStaleBuilds(db, docker);
  const jobManager = new JobManager();
  const env = new EnvManager(db);
  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager, env);
  const traefik = new TraefikManager(docker, config.server.port, {
    networkName: config.docker.networkName,
  });

  const normalizedLlm = normalizeLlmConfig(config.llm);

  const hasLlmConfigured = (() => {
    if (Object.keys(normalizedLlm.providers).length === 0) {
      return false;
    }

    const defaultProvider = normalizedLlm.providers[normalizedLlm.defaultRoute.providerId];
    if (!defaultProvider) {
      return false;
    }

    return (
      defaultProvider.provider === 'ollama' ||
      !!(defaultProvider.apiKey || defaultProvider.authToken)
    );
  })();

  const modelRegistry = new ModelRegistry(
    hasLlmConfigured
      ? {
          providers: normalizedLlm.providers,
          defaultRoute: normalizedLlm.defaultRoute,
          routes: normalizedLlm.routes,
        }
      : { providers: {}, defaultRoute: { providerId: '__none__' } },
  );

  const model: LanguageModel | null = hasLlmConfigured
    ? createModelProxy(modelRegistry, 'default')
    : null;

  const autoDetector = new AutoDetector(
    hasLlmConfigured ? createModelProxy(modelRegistry, 'envDetection') : null,
  );

  const webAgentEnabled = config.ai.webAgent.enabled;
  const autoRecoveryEnabled = config.ai.autoRecovery.enabled;
  const buildDebuggerEnabled = config.ai.buildDebugger.enabled;

  // v0.3: Build debugger (requires LLM) — created before pipeline so it can be injected
  let buildDebugger: BuildDebugger | null = null;
  if (hasLlmConfigured && buildDebuggerEnabled) {
    try {
      buildDebugger = new BuildDebugger(
        createModelProxy(modelRegistry, 'buildDebugger'),
        config.language,
        db,
        config.llm.provider,
      );
    } catch (err) {
      log.debug({ err }, 'Build debugger creation failed');
    }
  }

  // v1.0: Recovery coordinator — single owner of all recovery decisions
  const coordinator = new RecoveryCoordinator(db, eventBus, config);
  coordinator.start();

  const pipeline = new DeployPipeline(
    docker,
    db,
    env,
    config,
    jobManager,
    composePipeline,
    autoDetector,
    coordinator,
  );
  const approvalGate = new ApprovalGate();

  let agentPool: AgentPool | null = null;
  let agent: Agent | null = null;
  if (hasLlmConfigured && webAgentEnabled) {
    try {
      agentPool = new AgentPool(
        createModelProxy(modelRegistry, 'webAgent'),
        db,
        async (scope) => buildContextSnapshot(db, docker, scope),
        config.llm.provider,
        config.language,
        approvalGate,
      );
    } catch (err) {
      log.debug({ err }, 'AgentPool creation failed — web agent disabled');
      agentPool = null;
    }
  }

  if (hasLlmConfigured && autoRecoveryEnabled) {
    if (agentPool) {
      agent = agentPool.getRecoveryAgent();
    } else {
      try {
        agent = new Agent(
          createModelProxy(modelRegistry, 'autoRecovery'),
          db,
          async (scope) => buildContextSnapshot(db, docker, scope),
          config.llm.provider,
          config.language,
          'auto_recovery',
        );
      } catch (err) {
        log.debug({ err }, 'Recovery agent creation failed — agent will be null');
      }
    }
  }

  // v0.7: Question bridge (agent ↔ UI)
  const questionBridge = new QuestionBridge();
  questionBridge.setEventBus(eventBus);
  if (agentPool) {
    agentPool.setQuestionBridge(questionBridge);
  }
  if (agent) {
    agent.setQuestionBridge(questionBridge);
  }

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

  const recoveryHandlers = setupAutoRecovery({
    eventBus,
    agent: autoRecoveryEnabled ? agent : null,
    db,
    buildDebugger: buildDebuggerEnabled ? buildDebugger : null,
    deployQueue,
    pipeline,
    questionBridge,
    approvalGate,
    language: config.language,
    config,
    shouldContinue: (projectId) => coordinator.shouldContinue(projectId),
  });
  coordinator.setDeploymentRecovery((projectId, error, step, buildLog) =>
    recoveryHandlers.handleDeploymentRecovery(projectId, error, step, buildLog),
  );

  eventBus.on('env:new-keys-detected', (payload) => {
    void recoveryHandlers.handleEnvNewKeysDetected(payload);
  });
  eventBus.on('secret:detected', (payload) => {
    void recoveryHandlers.handleSecretDetected(payload);
  });
  eventBus.on('rollback:suggested', (payload) => {
    void recoveryHandlers.handleRollbackSuggested(payload);
  });
  eventBus.on('recovery:approval-resolved', (payload) => {
    recoveryHandlers.resolveApproval(payload.actionRunId, payload.approved);
  });

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
  const healthMonitor = new HealthMonitor(docker, db, eventBus, {
    intervalMs: config.monitoring.healthcheckIntervalSec * 1000,
  });

  // v0.2: Webhook auto-redeploy
  const webhookManager = new WebhookManager(pipeline, db, eventBus);

  // v0.2: Cloudflare production tunnels
  const cloudflare = new CloudflareTunnelManager(config.cloudflare, db, eventBus);

  const serviceManager = new ServiceManager(docker, db);

  try {
    await traefik.ensureAllNetworks();
    await serviceManager.reconcileServiceNetworks();
  } catch (err) {
    log.warn({ err }, 'Service network reconciliation failed during startup');
  }

  // (Build debugger moved above pipeline creation)

  // v0.4: Preview deployer
  const previewDeployer = new PreviewDeployer(docker, db);

  // v0.5: Alert monitor
  const alertMonitor = new AlertMonitor(docker, db, eventBus);

  const dockerEventListener = new DockerEventListener(docker, db, eventBus);

  // Wire platform event capture (captures all eventBus emissions for platform_event_log tool)
  if (config.mcp.platformTools) {
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
  });

  // Build partial ctx without channelManager, then compose the full AppContext
  let mutableAgentPool = agentPool;
  let mutableAgent = agent;

  const partialCtx = {
    config,
    db,
    docker,
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
    model,
    deployQueue,
    healthMonitor,
    webhookManager,
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
    coordinator,
    llmVerified: false,
  };

  // v0.4: ChannelManager needs AppContext but never self-references channelManager.
  // We cast partialCtx which is structurally complete for ChannelManager's actual usage.
  const channelManager = new ChannelManager(partialCtx as AppContext);
  const ctx: AppContext = { ...partialCtx, channelManager };
  coordinator.setConfigGetter(() => ctx.config);

  if (ctx.agentPool) {
    const tools = createTools(ctx, ctx.questionBridge);
    ctx.agentPool.setTools(tools);
    ctx.agentPool.setQuestionBridge(ctx.questionBridge);
  }

  const incidentReporter = new IncidentReporter(channelManager, eventBus, db, config);
  incidentReporter.start();
  activeIncidentReporter = incidentReporter;

  if (agent) {
    const postmortem = new PostmortemGenerator(eventBus, db, agent, config);
    postmortem.start();
    setPostmortemInstance(postmortem);
  }

  activePostmortemAutomationStop?.();
  activePostmortemAutomationStop = setupRecoveryPostmortemAutomation({
    eventBus,
    db,
    getPostmortem: getPostmortemInstance,
    isEligible: (projectId) => coordinator.shouldContinue(projectId),
  });

  const rollbackWatcher = new RollbackWatcher(eventBus, db, pipeline);
  rollbackWatcher.start();
  activeRollbackWatcher = rollbackWatcher;

  dockerEventListener.start();

  return ctx;
}

/** Shutdown the application context. */
export function shutdownAppContext(ctx: AppContext): void {
  activeIncidentReporter?.stop();
  activeRollbackWatcher?.stop();
  activePostmortemAutomationStop?.();
  activeIncidentReporter = null;
  activeRollbackWatcher = null;
  activePostmortemAutomationStop = null;
  getPostmortemInstance()?.stop();
  ctx.dockerEventListener?.stop();
  ctx.coordinator.stop();
  void ctx.opsAgent?.stop();
  ctx.healthMonitor.stop();
  ctx.alertMonitor.stop();
  void ctx.channelManager.stop();
  void ctx.previewDeployer.cleanupAll();
  ctx.approvalGate.dispose();
  ctx.db.close();
  void ctx.mcpClientManager.disconnectAll();
}
