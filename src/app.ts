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
import { eventBus } from './events/index.js';
import type { OpenLanderConfig } from './config/index.js';

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
}

/** Create the application context from config. */
export function createAppContext(config: OpenLanderConfig, dbPath: string): AppContext {
  const db = new Database(dbPath);
  const docker = new Docker(config.docker.socketPath);
  const pipeline = new DeployPipeline(docker, db);
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
      agent = new Agent(llm, db);
    } catch {
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
    } catch {
      // LLM not available
    }
  }

  return { config, db, docker, pipeline, traefik, env, agent, healthMonitor, webhookManager, cloudflare, blueGreen, dbProvisioner, buildDebugger };
}

/** Shutdown the application context. */
export function shutdownAppContext(ctx: AppContext): void {
  ctx.healthMonitor.stop();
  ctx.db.close();
}
