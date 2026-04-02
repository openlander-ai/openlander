import { join } from 'node:path';
import { nanoid } from 'nanoid';

import { createModuleLogger } from '../../lib/logger.js';
import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import { parseDockerfileExposePort } from '../dockerfile-gen.js';
import { filterBuildTimeVars } from '../build-args.js';
import { getCommitSubject } from '../git.js';
import { resolveEnvVars } from '../resolve-env.js';
import { JobManager as JobManagerClass } from '../job-manager.js';
import type { Docker } from '../docker.js';
import type { EnvManager } from '../env.js';
import type { JobManager } from '../job-manager.js';
import type { BuildExecutor } from './build-step.js';
import type { ContainerRunner } from './run-step.js';
import type { DeployResult, MonorepoConfig } from '../deploy-core.js';
import type { OrchestrationResult, ServiceNode } from '../orchestrator.js';

const log = createModuleLogger('deploy');

export interface MonorepoOrchestrationDeps {
  docker: Docker;
  db: Database;
  env: EnvManager;
  buildExecutor: BuildExecutor;
  containerRunner: ContainerRunner;
  jobManager?: JobManager;
}

export async function deployMonorepoService(
  deps: MonorepoOrchestrationDeps,
  params: {
    service: ServiceNode;
    parentId: string;
    parentName: string;
    config: MonorepoConfig;
    trigger: 'chat' | 'webhook' | 'api';
    resultByService: Map<string, DeployResult>;
  },
): Promise<{ success: boolean; projectId?: string; url?: string; error?: string }> {
  const { service, parentId, parentName, config, trigger, resultByService } = params;
  const dockerfilePath = service.dockerfile;
  const childName = `${parentName}/${service.name}`;
  const childId = nanoid(12);
  const imageTag = `openlander/${childName.replace('/', '-')}:latest`;
  const childStartTime = Date.now();
  const commitMessage = await getCommitSubject(config.clonePath, config.commitSha);

  deps.db.createProject({
    id: childId,
    name: childName,
    repoUrl: config.repoUrl,
    branch: config.branch,
    parentProjectId: parentId,
    dockerfilePath,
  });
  deps.db.updateProject(childId, { status: 'building' });
  deps.jobManager?.trackJob(childId, childName);

  await eventBus.emit('deploy:start', {
    projectId: childId,
    parentProjectId: parentId,
    repoUrl: config.repoUrl,
    phase: 'build',
    scope: service.name,
    status: 'in_progress',
    message: `[${service.name}] Starting service deployment`,
  });

  if (!dockerfilePath) {
    const noDockerfileError = `Service ${service.name} has no Dockerfile path`;
    await eventBus.emit('deploy:failed', {
      projectId: childId,
      parentProjectId: parentId,
      step: 'dockerfile',
      error: noDockerfileError,
      phase: 'build',
      scope: service.name,
      status: 'failed',
      message: `[${service.name}] ${noDockerfileError}`,
    });
    const failed: DeployResult = {
      success: false,
      projectId: childId,
      projectName: childName,
      error: noDockerfileError,
      buildDurationMs: Date.now() - childStartTime,
    };
    resultByService.set(service.name, failed);
    return {
      success: false,
      projectId: childId,
      error: failed.error,
    };
  }

  let dockerBuildOutput = '';

  try {
    deps.jobManager?.updatePhase(childId, 'building');
    const envVars = resolveEnvVars(
      {
        projectId: childId,
        inlineEnvVars: config.envVars,
        serviceEnvVars: service.envVars,
      },
      { env: deps.env },
    );
    const buildTimeVarsForChild = filterBuildTimeVars(envVars);
    let lastBuildOutputEmit = 0;
    await deps.buildExecutor.build(
      {
        clonePath: config.clonePath,
        projectId: childId,
        imageTag,
        dockerfilePath,
        buildArgs: buildTimeVarsForChild,
      },
      (line) => {
        dockerBuildOutput += line + '\n';
        const stepInfo = JobManagerClass.parseDockerBuildStep(line);
        if (stepInfo) {
          deps.jobManager?.updateBuildStep(childId, stepInfo.step, stepInfo.total, stepInfo.desc);
        }
        const now = Date.now();
        if (now - lastBuildOutputEmit <= 50) return;
        lastBuildOutputEmit = now;

        void eventBus.emit('build:output', {
          projectId: childId,
          parentProjectId: parentId,
          line,
          stream: 'stdout',
          phase: 'build',
          scope: service.name,
          status: 'in_progress',
          message: line,
          logChunk: line,
        });
      },
    );

    await eventBus.emit('deploy:build', {
      projectId: childId,
      parentProjectId: parentId,
      imageTag,
      durationMs: Date.now() - childStartTime,
      phase: 'build',
      scope: service.name,
      status: 'success',
      message: `[${service.name}] Docker image built`,
    });

    deps.jobManager?.updatePhase(childId, 'starting');
    const childDockerfilePath = join(config.clonePath, dockerfilePath);
    const childContainerPort = parseDockerfileExposePort(childDockerfilePath) ?? undefined;
    const runResult = await deps.containerRunner.run({
      imageTag,
      projectName: childName.replace('/', '-'),
      containerName: childName.replace('/', '-'),
      projectId: childId,
      containerPort: childContainerPort,
      envVars,
      secretFiles: deps.env.getSecretFilesForDeploy(childId),
      restartPolicy: { Name: 'unless-stopped' },
    });
    const { containerId, port, url: internalUrl } = runResult;

    await eventBus.emit('deploy:run', {
      projectId: childId,
      parentProjectId: parentId,
      containerId,
      port,
      url: internalUrl,
      phase: 'run',
      scope: service.name,
      status: 'success',
      message: `[${service.name}] Service running on port ${String(port)}`,
    });

    deps.db.updateProject(childId, {
      status: 'running',
      assignedPort: port,
      containerId,
      imageTag,
      visibility: config.visibility ?? 'internal',
    });

    deps.db.createDeployLog({
      id: nanoid(12),
      projectId: childId,
      status: 'success',
      trigger,
      commitSha: config.commitSha,
      commitMessage,
      buildLog: `[monorepo] ${dockerfilePath} → ${imageTag}\n`,
      durationMs: Date.now() - childStartTime,
    });

    deps.jobManager?.updatePhase(childId, 'done');

    await eventBus.emit('deploy:success', {
      projectId: childId,
      parentProjectId: parentId,
      url: internalUrl,
      totalDurationMs: Date.now() - childStartTime,
      phase: 'complete',
      scope: service.name,
      status: 'success',
      message: `[${service.name}] Service deploy complete`,
    });

    const successResult: DeployResult = {
      success: true,
      projectId: childId,
      projectName: childName,
      containerId,
      url: internalUrl,
      port,
      commitSha: config.commitSha,
      buildDurationMs: Date.now() - childStartTime,
    };
    resultByService.set(service.name, successResult);
    return {
      success: true,
      projectId: childId,
      url: internalUrl,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const buildLogWithOutput = dockerBuildOutput
      ? `--- Docker build output ---\n${dockerBuildOutput}[error] [monorepo] ${dockerfilePath} FAILED: ${errorMsg}\n`
      : `[monorepo] ${dockerfilePath} FAILED: ${errorMsg}\n`;

    deps.db.updateProject(childId, { status: 'error' });
    deps.jobManager?.updatePhase(childId, 'failed', errorMsg);

    await eventBus.emit('deploy:failed', {
      projectId: childId,
      parentProjectId: parentId,
      step: 'service-deploy',
      error: errorMsg,
      buildLog: buildLogWithOutput,
      phase: 'build',
      scope: service.name,
      status: 'failed',
      message: `[${service.name}] ${errorMsg}`,
      durationMs: Date.now() - childStartTime,
    });

    deps.db.createDeployLog({
      id: nanoid(12),
      projectId: childId,
      status: 'failed',
      trigger,
      commitSha: config.commitSha,
      commitMessage,
      buildLog: buildLogWithOutput,
      durationMs: Date.now() - childStartTime,
    });

    const failedResult: DeployResult = {
      success: false,
      projectId: childId,
      projectName: childName,
      error: errorMsg,
      buildDurationMs: Date.now() - childStartTime,
    };
    resultByService.set(service.name, failedResult);

    return {
      success: false,
      projectId: childId,
      error: errorMsg,
    };
  }
}

export async function rollbackMonorepoService(
  deps: MonorepoOrchestrationDeps,
  params: {
    service: { name: string; projectId?: string; url?: string };
    trigger: 'chat' | 'webhook' | 'api';
    startTime: number;
  },
): Promise<void> {
  const { service, trigger, startTime } = params;
  if (!service.projectId) {
    return;
  }
  const project = deps.db.getProject(service.projectId);
  if (!project) {
    return;
  }

  if (project.container_id) {
    try {
      await deps.docker.stopContainer(project.container_id);
      await deps.docker.removeContainer(project.container_id);
    } catch (error) {
      log.warn({ err: error, service: service.name }, 'Monorepo rollback container cleanup failed');
    }
  }

  deps.db.updateProject(service.projectId, {
    status: 'error',
    containerId: null,
    assignedPort: null,
  });

  deps.jobManager?.updatePhase(
    service.projectId,
    'failed',
    'Rolled back due to dependency deployment failure',
  );

  deps.db.createDeployLog({
    id: nanoid(12),
    projectId: service.projectId,
    status: 'failed',
    trigger,
    commitMessage: undefined,
    buildLog: `[monorepo] ${service.name} ROLLED_BACK: dependency deployment failure\n`,
    durationMs: Date.now() - startTime,
  });
}

export function buildMonorepoResults(params: {
  services: ServiceNode[];
  parentName: string;
  resultByService: Map<string, DeployResult>;
  orchestration: OrchestrationResult;
  startTime: number;
}): DeployResult[] {
  const { services, parentName, resultByService, orchestration, startTime } = params;
  const orchestrationByService = new Map(
    orchestration.services.map((service) => [service.name, service]),
  );
  return services.map((service) => {
    const result = resultByService.get(service.name);
    const orchestrationStatus = orchestrationByService.get(service.name);
    const projectName = `${parentName}/${service.name}`;

    if (!result) {
      return {
        success: false,
        projectId: '',
        projectName,
        error: orchestrationStatus?.error ?? 'Service did not produce a deploy result',
        buildDurationMs: Date.now() - startTime,
      };
    }

    if (orchestrationStatus?.status === 'rolled_back') {
      return {
        ...result,
        success: false,
        error: result.error ?? 'Rolled back due to dependency deployment failure',
      };
    }

    if (orchestrationStatus?.status === 'skipped') {
      return {
        ...result,
        success: false,
        error: result.error ?? 'Skipped due to dependency deployment failure',
      };
    }

    return result;
  });
}
