import type { Database } from '../../db/index.js';
import type { OpenLanderEnv } from '../../config/index.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { containerName as projectContainerName } from '../helpers.js';
import { allocatePort, clearPortScanCache, releasePortReservation } from '../port.js';
import {
  buildTraefikLabels,
  ensureManagedTraefikNetwork,
  getEnvironmentProjectHostname,
} from '../traefik.js';
import {
  deserializeConfig,
  loadResourceLimitsForProject,
  loadResourceLimitsForService,
  serializeConfig,
  CONFIG_VERSION,
} from '../config-snapshot.js';
import { buildResourceLimitConfig } from '../docker/types.js';

export interface RunConfig {
  imageTag: string;
  projectName: string;
  containerName?: string;
  networkProjectName?: string;
  projectId: string;
  serviceId?: string;
  environmentType?: OpenLanderEnv;
  environmentId?: string;
  envVars: Record<string, string>;
  imageCmd?: string[];
  containerPort?: number;
  preferredPort?: number;
  secretFiles?: Array<{ filename: string; content: string; mountPath: string }>;
  restartPolicy?: { Name: string; MaximumRetryCount?: number };
  removeExistingContainer?: boolean;
}

export class ContainerRunner {
  constructor(
    private readonly runtime: RuntimeBackend,
    private readonly db: Database,
  ) {}

  async run(config: RunConfig): Promise<{ containerId: string; port: number; url: string }> {
    const envType: OpenLanderEnv = 'production';
    let port = await allocatePort(
      this.db,
      this.runtime,
      {
        preferredPort: config.preferredPort,
      },
      envType,
    );

    let resourceLimits = config.serviceId
      ? await loadResourceLimitsForService(this.db, config.serviceId)
      : await loadResourceLimitsForProject(this.db, config.projectId);
    if (!resourceLimits) {
      resourceLimits = buildResourceLimitConfig('small', null);
      const configRow = config.serviceId
        ? await this.db.loadDeployConfigForService(config.serviceId)
        : await this.db.loadDeployConfig(config.projectId);
      const existingSnapshot = configRow
        ? (deserializeConfig(configRow.config_json)?.snapshot ?? {})
        : {};
      const json = serializeConfig({ ...existingSnapshot, resourceProfile: 'small' as const });
      if (config.serviceId) {
        await this.db.saveDeployConfigForService(config.serviceId, json, CONFIG_VERSION);
      } else {
        await this.db.saveDeployConfig(config.projectId, json, CONFIG_VERSION);
      }
    }

    const containerName = projectContainerName(config.containerName ?? config.projectName);
    if (config.removeExistingContainer !== false) {
      await this.runtime.safeRemoveContainer(containerName);
    }
    const networkProjectName = config.networkProjectName ?? config.projectName;
    const projectNetwork = await this.runtime.ensureProjectNetwork(networkProjectName);
    await ensureManagedTraefikNetwork(this.runtime, projectNetwork);

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
        projectNetwork,
      );

      try {
        const containerId = await this.runtime.runContainer({
          imageTag: config.imageTag,
          name: containerName,
          port,
          containerPort,
          envVars: config.envVars,
          cmd: config.imageCmd,
          traefikLabels,
          network: projectNetwork,
          aliases: [config.projectName],
          secretFiles: config.secretFiles,
          restartPolicy: config.restartPolicy,
          resourceLimits: resourceLimits ?? undefined,
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
          port = await allocatePort(this.db, this.runtime, {}, envType);
          continue;
        }
        releasePortReservation(port);
        throw error;
      }
    }

    throw new Error('Port allocation retry exhausted');
  }
}
