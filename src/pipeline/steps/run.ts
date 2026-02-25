import type { Database } from '../../db/index.js';
import type { Docker } from '../docker.js';
import { allocatePort } from '../port.js';
import { buildTraefikLabels } from '../traefik.js';

export interface RunStepConfig {
  docker: Docker;
  db: Database;
  projectId: string;
  imageTag: string;
  projectName: string;
  envVars?: Record<string, string>;
}

export interface RunStepResult {
  containerId: string;
  port: number;
  internalUrl: string;
}

export async function executeRunStep(config: RunStepConfig): Promise<RunStepResult> {
  const port = allocatePort(config.db);
  const envVars = { ...config.envVars, ...config.db.getEnvVars(config.projectId) };
  const traefikLabels = buildTraefikLabels(config.projectName, port);

  const containerId = await config.docker.runContainer({
    imageTag: config.imageTag,
    name: `ol-${config.projectName}`,
    port,
    envVars,
    traefikLabels,
  });

  return {
    containerId,
    port,
    internalUrl: `http://${config.projectName}.localhost`,
  };
}
