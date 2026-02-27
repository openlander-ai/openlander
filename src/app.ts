import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './agent/index.js';
import { createLLMClient } from './llm/index.js';
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
import { AlertMonitor } from './monitor/alerts.js';
import { eventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';
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
  // v0.5 modules
  alertMonitor: AlertMonitor;
}

/** Create the application context from config. */
export function createAppContext(config: OpenLanderConfig, dbPath: string): AppContext {
  const db = new Database(dbPath);
  const docker = new Docker(config.docker.socketPath);
  const jobManager = new JobManager();
  const composePipeline = new ComposePipeline(docker, db, eventBus, jobManager);
  const pipeline = new DeployPipeline(docker, db, jobManager, composePipeline);
  const traefik = new TraefikManager(docker);
  const env = new EnvManager(db);

  // Create agent only if LLM is configured
  let agent: Agent | null = null;
  if (config.llm.apiKey || config.llm.authToken || config.llm.provider === 'ollama') {
    try {
      const llm = createLLMClient({
        provider: config.llm.provider,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        authToken: config.llm.authToken || undefined,
        ollamaBaseUrl: config.llm.ollamaEndpoint || undefined,
      });
      // contextProvider: lazily captures `ctx` — resolved when chat() is called, not here
      agent = new Agent(llm, db, () => buildContextSnapshot(db), config.llm.provider);
    } catch (err) {
      log.debug({ err }, 'LLM client creation failed — agent will be null');
      // LLM provider not available — agent will be null
    }
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
  const blueGreen = new BlueGreenDeployer(docker, db, eventBus);

  // v0.3: Database provisioner
  const dbProvisioner = new DatabaseProvisioner(docker, db);

  // v0.3: Build debugger (requires LLM)
  let buildDebugger: BuildDebugger | null = null;
  if (config.llm.apiKey || config.llm.authToken || config.llm.provider === 'ollama') {
    try {
      const llm = createLLMClient({
        provider: config.llm.provider,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        authToken: config.llm.authToken || undefined,
        ollamaBaseUrl: config.llm.ollamaEndpoint || undefined,
      });
      buildDebugger = new BuildDebugger(llm);
    } catch (err) {
      log.debug({ err }, 'Build debugger LLM client creation failed');
      // LLM not available
    }
  }

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
    alertMonitor,
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
