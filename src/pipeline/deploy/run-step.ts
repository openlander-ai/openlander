import type { Database } from '../../db/index.js';
import { getPolicy } from '../../config/index.js';
import type { OpenLanderEnv } from '../../config/index.js';
import type { Docker } from '../docker.js';
import { allocatePort, clearPortScanCache, releasePortReservation } from '../port.js';
import { buildTraefikLabels, getEnvironmentProjectHostname } from '../traefik.js';

export interface RunConfig {
  imageTag: string;
  projectName: string;
  containerName?: string;
  projectId: string;
  environmentType?: OpenLanderEnv;
  environmentId?: string;
  envVars: Record<string, string>;
  imageCmd?: string[];
  containerPort?: number;
  preferredPort?: number;
  secretFiles?: Array<{ filename: string; content: string; mountPath: string }>;
}

export class ContainerRunner {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  async run(config: RunConfig): Promise<{ containerId: string; port: number; url: string }> {
    const envType: OpenLanderEnv = 'production';
    let port = await allocatePort(
      this.db,
      this.docker,
      {
        preferredPort: config.preferredPort,
      },
      envType,
    );

    const containerName = `ol-${config.containerName ?? config.projectName}`;
    await this.docker.removeContainer(containerName);

    for (let attempt = 0; attempt < 2; attempt++) {
      const configuredContainerPort = config.containerPort;
      const containerPort =
        typeof configuredContainerPort === 'number' &&
        Number.isInteger(configuredContainerPort) &&
        configuredContainerPort > 0
          ? configuredContainerPort
          : port;
      const traefikLabels = buildTraefikLabels(
        config.projectName,
        containerPort,
        undefined,
        envType,
      );

      try {
        const containerId = await this.docker.runContainer({
          imageTag: config.imageTag,
          name: containerName,
          port,
          containerPort,
          envVars: config.envVars,
          cmd: config.imageCmd,
          traefikLabels,
          network: getPolicy(envType).networkName,
          secretFiles: config.secretFiles,
        });

        releasePortReservation(port);
        const url = `http://${getEnvironmentProjectHostname(config.projectName, envType)}`;
        return {
          containerId,
          port,
          url,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isPortConflict =
          message.includes('port is already allocated') ||
          message.includes('address already in use');
        if (attempt === 0 && isPortConflict) {
          releasePortReservation(port);
          clearPortScanCache();
          port = await allocatePort(this.db, this.docker, {}, envType);
          continue;
        }
        releasePortReservation(port);
        throw error;
      }
    }

    throw new Error('Port allocation retry exhausted');
  }
}
