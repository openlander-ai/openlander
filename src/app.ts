import { nanoid } from 'nanoid';

import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './agent/index.js';
import { DeployQueue } from './agent/deploy-queue.js';
import { QuestionBridge } from './agent/question-bridge.js';
import { createModel } from './llm/index.js';
import { HealthMonitor } from './monitor/health.js';
import { WebhookManager } from './webhook/index.js';
import { CloudflareTunnelManager } from './pipeline/cloudflare.js';
import { BlueGreenDeployer } from './pipeline/blue-green.js';
import { DatabaseProvisioner } from './pipeline/db-provision.js';
import { ServiceManager } from './pipeline/service-manager.js';
import { BuildDebugger } from './agent/debugger.js';
import { ChannelManager } from './channels/base.js';
import { PreviewDeployer } from './pipeline/preview.js';
import { JobManager } from './pipeline/job-manager.js';
import { ComposePipeline } from './pipeline/compose.js';
import { AutoDetector } from './pipeline/auto-detect.js';
import { dispatchRecovery, type RecoveryPlan } from './pipeline/recovery-dispatch.js';
import { AlertMonitor } from './monitor/alerts.js';
import { IncidentReporter } from './monitor/incident-reporter.js';
import {
  PostmortemGenerator,
  setPostmortemInstance,
  getPostmortemInstance,
} from './monitor/postmortem.js';
import { RollbackWatcher } from './monitor/rollback-watcher.js';
import { McpClientManager } from './mcp/client-manager.js';
import { eventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';
import type { LanguageModel } from 'ai';
import { buildContextSnapshot } from './agent/prompts.js';
import { createModuleLogger } from './lib/logger.js';

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

  // Auto-recovery: trigger agent on deploy failure
  if (agent) {
    let agentChain = Promise.resolve();
    function enqueueAgentCall(
      fn: () => Promise<void>,
      context: { projectId: string; eventType: string },
    ): void {
      agentChain = agentChain.then(fn).catch((err: unknown) => {
        log.error(
          { err, projectId: context.projectId, eventType: context.eventType },
          'Agent operation failed in queue',
        );
      });
    }

    function normalizeError(error: string): string {
      return error
        .replace(/[0-9a-f]{8,}/gi, '<id>')
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
        .replace(/:\d{4,5}/g, ':<port>')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const recoveryAttempts = new Map<string, { count: number; lastError: string }>();
    const MAX_RECOVERY_ATTEMPTS = 3;
    const RECOVERY_OUTCOME_TIMEOUT_MS = 300_000;

    const waitForRecoveryOutcome = (projectId: string): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;

        const finalize = (recovered: boolean): void => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          unsubscribeSuccess();
          unsubscribeFailed();
          resolve(recovered);
        };

        const unsubscribeSuccess = eventBus.on('deploy:success', (payload) => {
          if (payload.projectId === projectId) {
            finalize(true);
          }
        });

        const unsubscribeFailed = eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId === projectId) {
            finalize(false);
          }
        });

        const timer = setTimeout(() => {
          finalize(false);
        }, RECOVERY_OUTCOME_TIMEOUT_MS);
      });

    const handleAutoRecovery = async (
      projectId: string,
      error: string,
      step?: string,
      buildLog?: string,
    ) => {
      const attempts = recoveryAttempts.get(projectId) ?? { count: 0, lastError: '' };

      // Guard: max retries
      if (attempts.count >= MAX_RECOVERY_ATTEMPTS) {
        await eventBus.emit('recovery:exhausted', {
          projectId,
          totalAttempts: attempts.count,
          lastError: attempts.lastError,
        });
        log.info(
          { projectId, attempts: attempts.count },
          'Auto-recovery exhausted, manual intervention needed',
        );
        return;
      }

      // Guard: same error repeating (stuck loop)
      if (attempts.lastError === normalizeError(error) && attempts.count > 0) {
        log.info({ projectId, error }, 'Same error repeating, stopping auto-recovery');
        return;
      }

      // Guard: infrastructure errors (not fixable by agent)
      const infraPatterns = [
        /docker daemon/i,
        /cannot connect to docker/i,
        /permission denied.*docker/i,
      ];
      if (infraPatterns.some((p) => p.test(error))) {
        log.info({ projectId }, 'Infrastructure error detected, skipping auto-recovery');
        return;
      }

      const advisoryPatterns = [/disk space/i, /no space left/i, /out of memory/i, /killed/i];
      const isAdvisory = advisoryPatterns.some((p) => p.test(error));

      const plan: RecoveryPlan = dispatchRecovery(
        step ?? 'unknown',
        error,
        buildLog,
        config.language,
      );

      if (plan.fixability === 'user' || plan.fixability === 'report') {
        await eventBus.emit('deploy:needs-user-action', {
          projectId,
          category: plan.category,
          title: plan.title,
          description: plan.description,
          userSteps: plan.userSteps,
        });
        log.info(
          { projectId, category: plan.category, fixability: plan.fixability },
          'Recovery dispatch: user action required, skipping agent',
        );
        return;
      }

      attempts.count++;
      attempts.lastError = normalizeError(error);
      recoveryAttempts.set(projectId, attempts);
      const recoveryStartTime = Date.now();

      log.info({ projectId, attempt: attempts.count }, 'Starting auto-recovery');
      await eventBus.emit('recovery:start', {
        projectId,
        error,
        attempt: attempts.count,
      });

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
        let recoveryMessage = `Deploy of "${projectName}" failed.

## Failure Context
- Project: ${projectName} (${projectId})
- Failed Step: ${step ?? 'unknown'}
- Error: ${error}${
          buildLog
            ? `

## Build Log (last 3000 chars)
${buildLog.slice(-3000)}`
            : ''
        }

${plan.agentGuidance}

## General Recovery Rules
1. If build log is provided above, analyze it directly. Otherwise call debug_build_error("${projectName}").
2. After fixing, redeploy with deploy_project("${projectName}").
3. Do NOT just suggest fixes — execute them.`;

        if (isAdvisory) {
          recoveryMessage +=
            "\n\n⚠️ This appears to be an infrastructure resource issue. You likely cannot fix this via tools alone. Diagnose the issue, explain it clearly, and suggest manual steps (e.g., docker system prune, increase memory). Do NOT retry the deploy unless you've confirmed the resource issue is resolved.";
        }

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

        const recovered = await waitForRecoveryOutcome(projectId);
        const durationMs = Date.now() - recoveryStartTime;
        if (recovered) {
          await eventBus.emit('recovery:success', {
            projectId,
            attempt: attempts.count,
            durationMs,
            lastError: attempts.lastError,
          });
          recoveryAttempts.delete(projectId);
        } else {
          await eventBus.emit('recovery:failed', {
            projectId,
            error,
            attempt: attempts.count,
          });
        }
      } catch (err) {
        log.error({ err, projectId }, 'Auto-recovery agent call failed');
        await eventBus.emit('recovery:failed', {
          projectId,
          error: err instanceof Error ? err.message : error,
          attempt: attempts.count,
        });
      }
    };

    eventBus.on('deploy:failed', (payload) => {
      // Small delay to let deploy log persist before agent reads it
      setTimeout(() => {
        enqueueAgentCall(
          () =>
            handleAutoRecovery(payload.projectId, payload.error, payload.step, payload.buildLog),
          { projectId: payload.projectId, eventType: 'deploy:failed' },
        );
      }, 2000);
    });

    eventBus.on('compose:failed', (payload) => {
      setTimeout(() => {
        enqueueAgentCall(() => handleAutoRecovery(payload.projectId, payload.error), {
          projectId: payload.projectId,
          eventType: 'compose:failed',
        });
      }, 2000);
    });

    eventBus.on('env:new-keys-detected', (payload) => {
      const message = `New environment variables detected in ${payload.projectName}'s .env.example: ${payload.newKeys.join(', ')}. These keys are not set yet. Ask the user for values.`;
      enqueueAgentCall(
        async () => {
          await agent.chatStream(
            message,
            async (event) => {
              await eventBus.emit('agent:event', {
                projectId: payload.projectId,
                event: { ...event, timestamp: new Date().toISOString() },
              });
            },
            `env-detect-${payload.projectId}`,
          );
        },
        { projectId: payload.projectId, eventType: 'env:new-keys-detected' },
      );
    });

    eventBus.on('secret:detected', (payload) => {
      const list = payload.secrets
        .map((s) => `- ${s.file}:${String(s.line)} — ${s.type} (${s.pattern})`)
        .join('\n');
      const message = `Hardcoded secrets detected in ${payload.projectName}:\n${list}\nAdvise user to move these to environment variables using set_env_vars.`;
      enqueueAgentCall(
        async () => {
          await agent.chatStream(
            message,
            async (event) => {
              await eventBus.emit('agent:event', {
                projectId: payload.projectId,
                event: { ...event, timestamp: new Date().toISOString() },
              });
            },
            `secret-scan-${payload.projectId}`,
          );
        },
        { projectId: payload.projectId, eventType: 'secret:detected' },
      );
    });

    eventBus.on('rollback:suggested', (payload) => {
      const message = `Health checks are failing for ${payload.projectName} after deployment. ${String(payload.consecutiveFailures)} consecutive failures. Previous version available (${payload.previousImageTag}). Ask the user if they want to rollback.`;
      enqueueAgentCall(
        async () => {
          await agent.chatStream(
            message,
            async (event) => {
              await eventBus.emit('agent:event', {
                projectId: payload.projectId,
                event: { ...event, timestamp: new Date().toISOString() },
              });
            },
            `rollback-${payload.projectId}`,
          );
        },
        { projectId: payload.projectId, eventType: 'rollback:suggested' },
      );
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

  const rollbackWatcher = new RollbackWatcher(eventBus, db);
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
