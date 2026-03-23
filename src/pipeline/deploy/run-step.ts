import type { Database } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { allocatePort, clearPortScanCache, releasePortReservation } from '../port.js';
import { buildTraefikLabels, getEnvironmentProjectHostname } from '../traefik.js';

export interface RunConfig {
  imageTag: string;
  projectName: string;
  containerName?: string;
  projectId: string;
  environmentType?: string;
  environmentId?: string;
  envVars: Record<string, string>;
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
    let port = await allocatePort(this.db, this.docker, {
      preferredPort: config.preferredPort,
    });

    const environmentType = config.environmentType === 'development' ? 'development' : 'production';
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
        environmentType,
      );

      try {
        const containerId = await this.docker.runContainer({
          imageTag: config.imageTag,
          name: containerName,
          port,
          containerPort,
          envVars: config.envVars,
          traefikLabels,
          secretFiles: config.secretFiles,
        });

        releasePortReservation(port);
        const url = `http://${getEnvironmentProjectHostname(config.projectName, environmentType)}`;
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
          port = await allocatePort(this.db, this.docker);
          continue;
        }
        releasePortReservation(port);
        throw error;
      }
    }

    throw new Error('Port allocation retry exhausted');
  }
}
