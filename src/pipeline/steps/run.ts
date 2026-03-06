import type { Database } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { allocatePort } from '../port.js';
import { buildTraefikLabels, getProjectUrl } from '../traefik.js';

export interface RunStepConfig {
  docker: Docker;
  db: Database;
  projectId: string;
  imageTag: string;
  projectName: string;
  envVars?: Record<string, string>;
  /** Container-internal port (from Dockerfile EXPOSE). If omitted, uses the allocated host port. */
  containerPort?: number;
}

export interface RunStepResult {
  containerId: string;
  port: number;
  internalUrl: string;
}

export async function executeRunStep(config: RunStepConfig): Promise<RunStepResult> {
  const port = await allocatePort(config.db, config.docker);
  const cPort = config.containerPort ?? port;
  const envVars = { ...config.envVars, ...config.db.getEnvVars(config.projectId) };
  const traefikLabels = buildTraefikLabels(config.projectName, cPort);

  const containerId = await config.docker.runContainer({
    imageTag: config.imageTag,
    name: `ol-${config.projectName}`,
    port,
    containerPort: cPort,
    envVars,
    traefikLabels,
  });

  return {
    containerId,
    port,
    internalUrl: getProjectUrl(config.projectName),
  };
}
