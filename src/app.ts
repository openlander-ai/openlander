import { Database } from './db/index.js';
import { Docker } from './pipeline/docker.js';
import { DeployPipeline } from './pipeline/deploy.js';
import { TraefikManager } from './pipeline/traefik.js';
import { EnvManager } from './pipeline/env.js';
import { Agent } from './agent/index.js';
import { createLLMClient } from './llm/index.js';
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
  agent: Agent | null; // null if no LLM configured
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
  if (config.llm.apiKey) {
    try {
      const llm = createLLMClient({
        provider: config.llm.provider,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
      });
      agent = new Agent(llm, db);
    } catch {
      // LLM provider not available — agent will be null
    }
  }

  return { config, db, docker, pipeline, traefik, env, agent };
}

/** Shutdown the application context. */
export function shutdownAppContext(ctx: AppContext): void {
  ctx.db.close();
}
