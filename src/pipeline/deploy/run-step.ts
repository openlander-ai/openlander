import type { Database } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { allocatePort } from '../port.js';
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
    const port = await allocatePort(this.db, this.docker, {
      preferredPort: config.preferredPort,
    });

    const environmentType = config.environmentType === 'development' ? 'development' : 'production';
    const containerPort = config.containerPort ?? port;
    const traefikLabels = buildTraefikLabels(
      config.projectName,
      containerPort,
      undefined,
      environmentType,
    );
    const containerName = `ol-${config.containerName ?? config.projectName}`;
    await this.docker.removeContainer(containerName);

    const containerId = await this.docker.runContainer({
      imageTag: config.imageTag,
      name: containerName,
      port,
      containerPort,
      envVars: config.envVars,
      traefikLabels,
      secretFiles: config.secretFiles,
    });

    const url = `http://${getEnvironmentProjectHostname(config.projectName, environmentType)}`;

    return {
      containerId,
      port,
      url,
    };
  }
}
