import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
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

    const containerId = await this.docker.runContainer({
      imageTag: config.imageTag,
      name: `ol-${config.containerName ?? config.projectName}`,
      port,
      containerPort,
      envVars: config.envVars,
      traefikLabels,
      secretFiles: config.secretFiles,
    });

    const url = `http://${getEnvironmentProjectHostname(config.projectName, environmentType)}`;

    const healthResult = await this.docker.waitForHealthy(containerId, 20000);
    await eventBus.emit('monitor:healthcheck', {
      projectId: config.projectId,
      healthy: healthResult.healthy,
      responseTimeMs: 0,
    });

    if (!healthResult.healthy) {
      const containerLogs = await this.docker
        .getLogs(containerId, 50)
        .catch(() => '(no logs available)');

      this.updateStatus(config, 'error', {
        assignedPort: port,
        containerId,
        imageTag: config.imageTag,
      });

      await eventBus.emit('deploy:crash', {
        projectId: config.projectId,
        containerId,
        error: healthResult.error,
        exitCode: healthResult.exitCode,
      });

      throw new Error(
        `Container crashed after start: ${healthResult.error ?? 'unknown'}\n\nContainer logs:\n${containerLogs}`,
      );
    }

    this.updateStatus(config, 'running', {
      assignedPort: port,
      containerId,
      imageTag: config.imageTag,
    });

    return {
      containerId,
      port,
      url,
    };
  }

  private updateStatus(
    config: RunConfig,
    status: 'running' | 'error',
    details: { assignedPort: number; containerId: string; imageTag: string },
  ): void {
    if (config.environmentId) {
      this.db.updateEnvironment(config.environmentId, {
        status,
        assignedPort: details.assignedPort,
        containerId: details.containerId,
        imageTag: details.imageTag,
      });
      return;
    }

    this.db.updateProject(config.projectId, {
      status,
      assignedPort: details.assignedPort,
      containerId: details.containerId,
      imageTag: details.imageTag,
    });
  }
}
