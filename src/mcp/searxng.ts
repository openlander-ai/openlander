import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from '../pipeline/docker.js';

const log = createModuleLogger('searxng');

const SEARXNG_CONTAINER_NAME = 'openlander-searxng';
const SEARXNG_IMAGE = 'searxng/searxng:latest';

/** Default internal port for SearXNG instance. */
export const SEARXNG_DEFAULT_PORT = 8888;

/**
 * SearXNG Docker container management.
 *
 * Manages a self-hosted SearXNG meta-search instance that the agent
 * uses for web search via the mcp-searxng MCP bridge.
 *
 * Follows the same lifecycle pattern as TraefikManager:
 *   isRunning() → start() → stop()
 */
export class SearxngManager {
  constructor(
    private readonly docker: Docker,
    private readonly port: number = SEARXNG_DEFAULT_PORT,
  ) {}

  /** Check if SearXNG container is running. */
  async isRunning(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const containers = await client.listContainers({
        filters: { name: [SEARXNG_CONTAINER_NAME] },
      });
      return containers.length > 0;
    } catch (err) {
      log.warn({ err }, 'Failed to check SearXNG status');
      return false;
    }
  }

  /**
   * Start the SearXNG search engine container.
   *
   * Runs on an internal port (default 8888), no external exposure needed.
   * The mcp-searxng MCP server connects to it via SEARXNG_URL env var.
   */
  async start(): Promise<void> {
    if (await this.isRunning()) {
      log.debug('SearXNG already running');
      return;
    }

    const client = this.docker.getClient();

    // Remove any existing stopped container
    try {
      const existing = client.getContainer(SEARXNG_CONTAINER_NAME);
      await existing.remove({ force: true });
      log.debug('Removed existing SearXNG container');
    } catch {
      // Container doesn't exist — expected on first run
    }

    // Pull image
    try {
      const stream = await client.pull(SEARXNG_IMAGE);
      await new Promise<void>((resolve, reject) => {
        client.modem.followProgress(stream, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      log.debug({ err }, 'SearXNG image pull failed — may already exist locally');
    }

    const container = await client.createContainer({
      Image: SEARXNG_IMAGE,
      name: SEARXNG_CONTAINER_NAME,
      ExposedPorts: { '8080/tcp': {} },
      HostConfig: {
        PortBindings: {
          '8080/tcp': [{ HostPort: String(this.port) }],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
      Env: [
        // Minimal SearXNG config for agent use
        'SEARXNG_BASE_URL=http://localhost:8080/',
      ],
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'searxng',
      },
    });

    await container.start();
    log.info({ port: this.port }, 'SearXNG started');
  }

  /** Stop and remove the SearXNG container. */
  async stop(): Promise<void> {
    try {
      await this.docker.removeContainer(SEARXNG_CONTAINER_NAME);
      log.debug('SearXNG stopped');
    } catch (err) {
      log.warn({ err }, 'Failed to remove SearXNG container');
    }
  }

  /** Get the internal URL for the mcp-searxng bridge. */
  getUrl(): string {
    return `http://localhost:${String(this.port)}`;
  }
}
