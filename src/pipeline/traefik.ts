import type { Docker } from './docker.js';

const TRAEFIK_CONTAINER_NAME = 'openlander-traefik';
const TRAEFIK_IMAGE = 'traefik:v3.3';
const TRAEFIK_NETWORK = 'web';

/**
 * Traefik reverse proxy management.
 *
 * OpenLander uses Traefik as a Docker-label-based reverse proxy.
 * Each deployed container gets Traefik labels that automatically
 * configure routing without touching any config files.
 */
export class TraefikManager {
  constructor(private readonly docker: Docker) {}

  /** Check if Traefik container is running. */
  async isRunning(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const containers = await client.listContainers({
        filters: { name: [TRAEFIK_CONTAINER_NAME] },
      });
      return containers.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the Docker network for Traefik exists.
   * All managed containers join this network.
   */
  async ensureNetwork(): Promise<void> {
    const client = this.docker.getClient();
    const networks = await client.listNetworks({
      filters: { name: [TRAEFIK_NETWORK] },
    });

    if (networks.length === 0) {
      await client.createNetwork({
        Name: TRAEFIK_NETWORK,
        Driver: 'bridge',
      });
    }
  }

  /**
   * Start the Traefik reverse proxy container.
   * Configured as Docker provider — reads labels from other containers.
   */
  async start(): Promise<void> {
    // Skip if already running
    if (await this.isRunning()) return;

    await this.ensureNetwork();

    const client = this.docker.getClient();

    // Pull image first
    try {
      const stream = await client.pull(TRAEFIK_IMAGE);
      await new Promise<void>((resolve, reject) => {
        client.modem.followProgress(stream, (err: Error | null) => { if (err) { reject(err); } else { resolve(); } });
      });
    } catch {
      // Image might already exist locally
    }

    const container = await client.createContainer({
      Image: TRAEFIK_IMAGE,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: [
        '--api.insecure=true',
        '--providers.docker=true',
        '--providers.docker.exposedbydefault=false',
        `--providers.docker.network=${TRAEFIK_NETWORK}`,
        '--entrypoints.web.address=:80',
      ],
      ExposedPorts: {
        '80/tcp': {},
        '8080/tcp': {}, // Traefik dashboard
      },
      HostConfig: {
        PortBindings: {
          '80/tcp': [{ HostPort: '80' }],
          '8080/tcp': [{ HostPort: '8080' }],
        },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        NetworkMode: TRAEFIK_NETWORK,
        RestartPolicy: { Name: 'unless-stopped' },
      },
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });

    await container.start();
  }

  /** Stop and remove the Traefik container. */
  async stop(): Promise<void> {
    try {
      await this.docker.removeContainer(TRAEFIK_CONTAINER_NAME);
    } catch {
      // Already removed
    }
  }
}

/**
 * Build Traefik labels for a project container.
 *
 * Pattern from Dokploy/openclaw-host-kit:
 *   traefik.http.routers.{name}.rule = Host(`{hostname}`)
 *   traefik.http.services.{name}.loadbalancer.server.port = {port}
 */
export function buildTraefikLabels(
  projectName: string,
  containerPort: number,
  hostname?: string,
): Record<string, string> {
  const routerName = `ol-${projectName}`;
  const host = hostname ?? `${projectName}.localhost`;

  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'web',
    [`traefik.http.routers.${routerName}.service`]: routerName,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(containerPort),
  };
}
