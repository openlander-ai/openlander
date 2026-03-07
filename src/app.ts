import { nanoid } from 'nanoid';

import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './agent/index.js';
import { QuestionBridge } from './agent/question-bridge.js';
import { createModel } from './llm/index.js';
import { HealthMonitor } from './monitor/health.js';
import { WebhookManager } from './webhook/index.js';
import { CloudflareTunnelManager } from './pipeline/cloudflare.js';
import { BlueGreenDeployer } from './pipeline/blue-green.js';
import { DatabaseProvisioner } from './pipeline/db-provision.js';
import { BuildDebugger } from './agent/debugger.js';
import { ChannelManager } from './channels/base.js';
import { PreviewDeployer } from './pipeline/preview.js';
import { JobManager } from './pipeline/job-manager.js';
import { ComposePipeline } from './pipeline/compose.js';
import { AutoDetector } from './pipeline/auto-detect.js';
import { AlertMonitor } from './monitor/alerts.js';
import { eventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';
import type { LanguageModel } from 'ai';
import { buildContextSnapshot } from './agent/prompts.js';
import { createModuleLogger } from './lib/logger.js';

const log = createModuleLogger('app');

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
}

/** Create the application context from config. */
export function createAppContext(config: OpenLanderConfig, dbPath: string): AppContext {
  const db = new Database(dbPath);
  const docker = new Docker(config.docker.socketPath);
  const jobManager = new JobManager();
  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager);
  const traefik = new TraefikManager(docker);
  const env = new EnvManager(db);

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
      buildDebugger = new BuildDebugger(model);
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

  // Auto-recovery: trigger agent on deploy failure
  if (agent) {
    const recoveryAttempts = new Map<string, { count: number; lastError: string }>();
    const MAX_RECOVERY_ATTEMPTS = 3;

    const handleAutoRecovery = async (projectId: string, error: string) => {
      const attempts = recoveryAttempts.get(projectId) ?? { count: 0, lastError: '' };

      // Guard: max retries
      if (attempts.count >= MAX_RECOVERY_ATTEMPTS) {
        log.info(
          { projectId, attempts: attempts.count },
          'Auto-recovery exhausted, manual intervention needed',
        );
        return;
      }

      // Guard: same error repeating (stuck loop)
      if (attempts.lastError === error && attempts.count > 0) {
        log.info({ projectId, error }, 'Same error repeating, stopping auto-recovery');
        return;
      }

      // Guard: infrastructure errors (not fixable by agent)
      const infraPatterns = [
        /docker daemon/i,
        /cannot connect to docker/i,
        /permission denied.*docker/i,
        /disk space/i,
        /out of memory/i,
      ];
      if (infraPatterns.some((p) => p.test(error))) {
        log.info({ projectId }, 'Infrastructure error detected, skipping auto-recovery');
        return;
      }

      attempts.count++;
      attempts.lastError = error;
      recoveryAttempts.set(projectId, attempts);

      log.info({ projectId, attempt: attempts.count }, 'Starting auto-recovery');

      // Re-activate question bridge for this project
      questionBridge.setActiveProject(projectId);

      const project = db.getProject(projectId);
      const projectName = project?.name ?? projectId;

      // Emit timeline event so user sees activity
      await eventBus.emit('agent:event', {
        projectId,
        event: {
          type: 'message',
          content: 'AI is analyzing the failure and attempting to fix it...',
          timestamp: new Date().toISOString(),
        },
      });

      try {
        const sessionId = nanoid(12);
        const recoveryMessage = `Deploy of "${projectName}" failed with error:\n\n${error}\n\nAnalyze this error. If you can fix it (e.g., by setting environment variables, fixing configuration), do so and redeploy. Use get_deploy_status to see the full error, ask_user_question if you need information from the user, set_env_vars to configure variables, and deploy_project to redeploy.`;

        log.info({ projectId, sessionId }, 'Auto-recovery: calling agent.chatStream');
        await agent.chatStream(
          recoveryMessage,
          async (event) => {
            log.info({ projectId, eventType: event.type }, 'Auto-recovery: agent event');
            await eventBus.emit('agent:event', {
              projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          sessionId,
        );
        log.info({ projectId }, 'Auto-recovery: agent.chatStream completed');
      } catch (err) {
        log.error({ err, projectId }, 'Auto-recovery agent call failed');
      }
    };

    eventBus.on('deploy:failed', (payload) => {
      // Small delay to let deploy log persist before agent reads it
      setTimeout(() => {
        void handleAutoRecovery(payload.projectId, payload.error);
      }, 2000);
    });

    eventBus.on('compose:failed', (payload) => {
      setTimeout(() => {
        void handleAutoRecovery(payload.projectId, payload.error);
      }, 2000);
    });
  }

  // v0.2: Health monitoring
  const healthMonitor = new HealthMonitor(docker, db, eventBus, {
    intervalMs: config.monitoring.healthcheckIntervalSec * 1000,
  });

  // v0.2: Webhook auto-redeploy
  const webhookManager = new WebhookManager(pipeline, db, eventBus);

  // v0.2: Cloudflare production tunnels
  const cloudflare = new CloudflareTunnelManager(config.cloudflare, db, eventBus);

  // v0.3: Blue-green deployer
  const blueGreen = new BlueGreenDeployer(docker, db, env, eventBus);

  // v0.3: Database provisioner
  const dbProvisioner = new DatabaseProvisioner(docker, db);

  // (Build debugger moved above pipeline creation)

  // v0.4: Channel manager
  const channelManager = new ChannelManager({
    config,
    db,
    docker,
    pipeline,
    composePipeline,
    traefik,
    env,
    agent,
    healthMonitor,
    webhookManager,
    cloudflare,
    blueGreen,
    dbProvisioner,
    buildDebugger,
    jobManager,
  } as AppContext);

  // v0.4: Preview deployer
  const previewDeployer = new PreviewDeployer(docker, db);

  // v0.5: Alert monitor
  const alertMonitor = new AlertMonitor(docker, db, eventBus);

  const ctx: AppContext = {
    config,
    db,
    docker,
    pipeline,
    composePipeline,
    traefik,
    env,
    agent,
    healthMonitor,
    webhookManager,
    cloudflare,
    blueGreen,
    dbProvisioner,
    buildDebugger,
    channelManager,
    previewDeployer,
    jobManager,
    autoDetector,
    alertMonitor,
    questionBridge,
  };

  // Re-assign the channelManager's context reference (it was created with partial context)
  // ChannelManager already holds the reference, no update needed

  return ctx;
}

/** Shutdown the application context. */
export function shutdownAppContext(ctx: AppContext): void {
  ctx.healthMonitor.stop();
  ctx.alertMonitor.stop();
  void ctx.channelManager.stop();
  void ctx.previewDeployer.cleanupAll();
  ctx.db.close();
}
