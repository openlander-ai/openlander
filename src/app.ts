import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './llm/agent.js';
import { DeployQueue } from './pipeline/deploy-queue.js';
import { QuestionBridge } from './lib/question-bridge.js';
import { createModel } from './llm/index.js';
import { HealthMonitor } from './monitor/health.js';
import { WebhookManager } from './webhook/index.js';
import { CloudflareTunnelManager } from './pipeline/cloudflare.js';
import { BlueGreenDeployer } from './pipeline/blue-green.js';
import { DatabaseProvisioner } from './pipeline/db-provision.js';
import { ServiceManager } from './pipeline/service-manager.js';
import { BuildDebugger } from './pipeline/build-debugger.js';
import { ChannelManager } from './channels/base.js';
import { PreviewDeployer } from './pipeline/preview.js';
import { JobManager } from './pipeline/job-manager.js';
import { ComposePipeline } from './pipeline/compose.js';
import { AutoDetector } from './pipeline/auto-detect.js';
import { AlertMonitor } from './monitor/alerts.js';
import { IncidentReporter } from './monitor/incident-reporter.js';
import {
  PostmortemGenerator,
  setPostmortemInstance,
  getPostmortemInstance,
} from './monitor/postmortem.js';
import { RollbackWatcher } from './monitor/rollback-watcher.js';
import { McpClientManager } from './mcp/client-manager.js';
import { PlanEngine } from './pipeline/deploy-plan/engine.js';
import { eventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';
import type { LanguageModel } from 'ai';
import { buildContextSnapshot } from './llm/prompts.js';
import { createModuleLogger } from './lib/logger.js';
import { setupAutoRecovery } from './pipeline/auto-recovery.js';

const log = createModuleLogger('app');

let activeIncidentReporter: IncidentReporter | null = null;
let activeRollbackWatcher: RollbackWatcher | null = null;

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
  agent: Agent | null;
  deployQueue: DeployQueue;
  // v0.2 modules
  healthMonitor: HealthMonitor;
  webhookManager: WebhookManager;
  cloudflare: CloudflareTunnelManager;
  // v0.3 modules
  blueGreen: BlueGreenDeployer;
  dbProvisioner: DatabaseProvisioner;
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
  // v1.0 modules
  mcpClientManager: McpClientManager;
  planEngine: PlanEngine;
}

/** Create the application context from config. */
export function createAppContext(config: OpenLanderConfig, dbPath: string): AppContext {
  const db = new Database(dbPath);
  const docker = new Docker(config.docker.socketPath || undefined, config.docker.networkName);
  const jobManager = new JobManager();
  const env = new EnvManager(db);
  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager, env);
  const traefik = new TraefikManager(docker, config.server.port);

  let model: LanguageModel | null = null;
  if (config.llm.apiKey || config.llm.authToken || config.llm.provider === 'ollama') {
    try {
      model = createModel({
        provider: config.llm.provider,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        authToken: config.llm.authToken || undefined,
        ollamaBaseUrl: config.llm.ollamaEndpoint || undefined,
      });
    } catch (err) {
      log.debug({ err }, 'LLM model creation failed — LLM-powered features disabled');
    }
  }

  const autoDetector = new AutoDetector(model);

  // v0.3: Build debugger (requires LLM) — created before pipeline so it can be injected
  let buildDebugger: BuildDebugger | null = null;
  if (model) {
    try {
      buildDebugger = new BuildDebugger(model, config.language);
    } catch (err) {
      log.debug({ err }, 'Build debugger creation failed');
    }
  }

  const pipeline = new DeployPipeline(
    docker,
    db,
    env,
    jobManager,
    composePipeline,
    autoDetector,
    buildDebugger ?? undefined,
  );

  // Create agent only if LLM is configured
  let agent: Agent | null = null;
  if (model) {
    try {
      // contextProvider: lazily captures `ctx` — resolved when chat() is called, not here
      agent = new Agent(
        model,
        db,
        async () => buildContextSnapshot(db, docker),
        config.llm.provider,
        config.language,
      );
    } catch (err) {
      log.debug({ err }, 'Agent creation failed — agent will be null');
    }
  }

  // v0.7: Question bridge (agent ↔ UI)
  const questionBridge = new QuestionBridge();
  questionBridge.setEventBus(eventBus);
  if (agent) {
    agent.setQuestionBridge(questionBridge);
  }

  const deployQueue = new DeployQueue();

  // Track active project for question events
  eventBus.on('deploy:start', (payload) => {
    questionBridge.setActiveProject(payload.projectId);
  });
  eventBus.on('deploy:success', () => {
    questionBridge.setActiveProject(null);
  });
  eventBus.on('deploy:failed', () => {
    questionBridge.setActiveProject(null);
  });

  setupAutoRecovery({
    eventBus,
    agent,
    db,
    buildDebugger,
    deployQueue,
    pipeline,
    questionBridge,
    language: config.language,
  });

  // v0.2: Health monitoring
  const healthMonitor = new HealthMonitor(docker, db, eventBus, {
    intervalMs: config.monitoring.healthcheckIntervalSec * 1000,
  });

  // v0.2: Webhook auto-redeploy
  const webhookManager = new WebhookManager(pipeline, db, eventBus);

  // v0.2: Cloudflare production tunnels
  const cloudflare = new CloudflareTunnelManager(config.cloudflare, db, eventBus);

  // v0.3: Blue-green deployer
  const blueGreen = new BlueGreenDeployer(docker, db, env, eventBus, jobManager);

  // v0.3: Database provisioner
  const dbProvisioner = new DatabaseProvisioner(docker, db);
  const serviceManager = new ServiceManager(docker, db);

  // (Build debugger moved above pipeline creation)

  // v0.4: Preview deployer
  const previewDeployer = new PreviewDeployer(docker, db);

  // v0.5: Alert monitor
  const alertMonitor = new AlertMonitor(docker, db, eventBus);

  // Status sync: update project status when container crashes or health checks fail
  // AlertMonitor detects crashes but only creates alerts — this bridges alerts to status.
  const crashFailureCounts = new Map<string, number>();
  const HEALTH_FAILURE_THRESHOLD = 3;

  eventBus.on('alert:new', ({ alert }) => {
    if (alert.type === 'container-crash') {
      const projectId = alert.details['projectId'];
      if (typeof projectId === 'string') {
        const project = db.getProject(projectId);
        if (project && project.status === 'running') {
          db.updateProject(projectId, { status: 'error' });
          log.info({ projectId }, 'Project status set to error (container crash detected)');
        }
      }
    }
  });

  eventBus.on('monitor:healthcheck', ({ projectId, healthy }) => {
    if (healthy) {
      crashFailureCounts.delete(projectId);
      return;
    }
    const count = (crashFailureCounts.get(projectId) ?? 0) + 1;
    crashFailureCounts.set(projectId, count);
    if (count >= HEALTH_FAILURE_THRESHOLD) {
      const project = db.getProject(projectId);
      if (project && project.status === 'running') {
        db.updateProject(projectId, { status: 'error' });
        log.info(
          { projectId, failures: count },
          'Project status set to error (health check failures)',
        );
      }
      crashFailureCounts.delete(projectId);
    }
  });

  // Reset failure counts on successful deploy
  eventBus.on('deploy:success', (payload) => {
    crashFailureCounts.delete(payload.projectId);
  });

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
  const partialCtx = {
    config,
    db,
    docker,
    pipeline,
    composePipeline,
    traefik,
    env,
    agent,
    deployQueue,
    healthMonitor,
    webhookManager,
    cloudflare,
    blueGreen,
    dbProvisioner,
    buildDebugger,
    previewDeployer,
    jobManager,
    autoDetector,
    alertMonitor,
    questionBridge,
    serviceManager,
    mcpClientManager,
    planEngine,
  };

  // v0.4: ChannelManager needs AppContext but never self-references channelManager.
  // We cast partialCtx which is structurally complete for ChannelManager's actual usage.
  const channelManager = new ChannelManager(partialCtx as AppContext);
  const incidentReporter = new IncidentReporter(channelManager, eventBus, db, config);
  incidentReporter.start();
  activeIncidentReporter = incidentReporter;

  if (agent) {
    const postmortem = new PostmortemGenerator(eventBus, db, agent, config);
    postmortem.start();
    setPostmortemInstance(postmortem);
  }

  const rollbackWatcher = new RollbackWatcher(eventBus, db, pipeline);
  rollbackWatcher.start();
  activeRollbackWatcher = rollbackWatcher;

  return { ...partialCtx, channelManager };
}

/** Shutdown the application context. */
export function shutdownAppContext(ctx: AppContext): void {
  activeIncidentReporter?.stop();
  activeRollbackWatcher?.stop();
  activeIncidentReporter = null;
  activeRollbackWatcher = null;
  getPostmortemInstance()?.stop();
  ctx.healthMonitor.stop();
  ctx.alertMonitor.stop();
  void ctx.channelManager.stop();
  void ctx.previewDeployer.cleanupAll();
  ctx.db.close();
  void ctx.mcpClientManager.disconnectAll();
}
