import { existsSync, writeFileSync } from 'node:fs';
import { nanoid } from 'nanoid';

import { createModuleLogger } from '../../lib/logger.js';
import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import type { Docker } from '../docker.js';
import type { AutoDetector } from '../auto-detect.js';
import type { ComposePipeline } from '../compose.js';
import type { EnvManager } from '../env.js';
import { ensureDockerfile, detectFramework, parseDockerfileExposePort } from '../dockerfile-gen.js';
import { resolveEnvVars, resolveEnvVarsForBuild } from '../resolve-env.js';
import { cloneRepo } from '../git.js';
import { detectNewEnvKeys } from '../env-inject.js';
import { analyzeBuildDiff, formatDiffForPrompt } from '../diff-analysis.js';
import { scanForSecrets } from '../secret-scan.js';
import { persistDeployConfig } from '../config-snapshot.js';
import type { JobManager } from '../job-manager.js';
import { JobManager as JobManagerClass } from '../job-manager.js';
import { DockerfileNotFoundError } from '../../errors.js';
import { resolveDockerfilePath } from './helpers.js';
import type { BuildExecutor } from './build-step.js';
import type { ContainerRunner } from './run-step.js';
import type { DeployResult, ProjectConfig } from '../deploy-core.js';

const log = createModuleLogger('deploy');

export interface DeployOrchestrationDeps {
  docker: Docker;
  db: Database;
  env: EnvManager;
  buildExecutor: BuildExecutor;
  containerRunner: ContainerRunner;
  composePipeline?: ComposePipeline;
  autoDetector?: AutoDetector;
  jobManager?: JobManager;
  applyPendingFix: (projectId: string, clonePath: string) => string | null;
  exposeTunnel: (projectId: string, port: number) => Promise<string>;
}

export async function cloneAndAnalyze(
  deps: DeployOrchestrationDeps,
  params: {
    projectId: string;
    projectName: string;
    environmentId: string;
    repoUrl: string;
    branch?: string;
    sshKeyPath?: string;
  },
): Promise<{ clonePath: string; commitSha: string; buildLog: string; diffContext?: string }> {
  const { projectId, projectName, environmentId, repoUrl, branch, sshKeyPath } = params;
  let buildLog = '';
  let diffContext: string | undefined;

  const cloneResult = await cloneRepo({ repoUrl, branch, sshKeyPath });

  await eventBus.emit('deploy:clone', {
    projectId,
    path: cloneResult.path,
    commitSha: cloneResult.commitSha,
  });

  buildLog += `[clone] ${repoUrl} @ ${cloneResult.commitSha.slice(0, 8)}\n`;

  const pendingFixFile = deps.applyPendingFix(projectId, cloneResult.path);
  if (pendingFixFile) {
    buildLog += `[pending-fix] Applied ${pendingFixFile}\n`;
  }

  const previousDeploy = deps.db.getLastDeployLog(projectId, environmentId);
  const previousSha = previousDeploy?.commit_sha;

  if (previousSha && previousSha !== cloneResult.commitSha) {
    const diffAnalysis = await analyzeBuildDiff(cloneResult.path, previousSha);
    if (diffAnalysis) {
      diffContext = formatDiffForPrompt(diffAnalysis);
      buildLog += `[diff] ${diffAnalysis.summary}\n`;
      log.info(
        {
          projectId,
          totalChanged: diffAnalysis.totalChangedFiles,
          buildImpact: diffAnalysis.buildImpactFiles.length,
        },
        'Pre-build diff analysis complete',
      );
      await eventBus.emit('deploy:diff-analyzed', {
        projectId,
        previousSha: diffAnalysis.previousSha,
        currentSha: diffAnalysis.currentSha,
        totalChanged: diffAnalysis.totalChangedFiles,
        buildImpactFiles: diffAnalysis.buildImpactFiles,
        envTemplateChanged: diffAnalysis.envTemplateChanged,
        dockerChanged: diffAnalysis.dockerChanged,
        depsChanged: diffAnalysis.depsChanged,
      });
    }
  }

  const storedVars = deps.env.getAll(projectId, environmentId);
  const storedKeys = Object.keys(storedVars);
  const detection = detectNewEnvKeys(cloneResult.path, storedKeys);
  if (detection) {
    await eventBus.emit('env:new-keys-detected', {
      projectId,
      projectName,
      newKeys: detection.newKeys,
      templateFile: detection.templateFile,
    });
  }

  const secretFindings = scanForSecrets(cloneResult.path);
  if (secretFindings.length > 0) {
    await eventBus.emit('secret:detected', {
      projectId,
      projectName,
      secrets: secretFindings,
    });
  }

  return {
    clonePath: cloneResult.path,
    commitSha: cloneResult.commitSha,
    buildLog,
    diffContext,
  };
}

export async function buildProject(
  deps: DeployOrchestrationDeps,
  params: {
    projectId: string;
    environmentId: string;
    branch?: string;
    routeName: string;
    trigger: 'chat' | 'webhook' | 'api';
    imageTag: string;
    repoUrl: string;
    startTime: number;
    shouldSyncProjectState: boolean;
    config: Partial<ProjectConfig>;
    clonePath: string;
    commitSha: string;
    buildLog: string;
  },
): Promise<
  | {
      type: 'compose';
      result: DeployResult;
      buildLog: string;
    }
  | {
      type: 'docker';
      dockerfilePath: string;
      buildLog: string;
    }
> {
  const {
    projectId,
    environmentId,
    branch,
    routeName,
    trigger,
    imageTag,
    repoUrl,
    startTime,
    shouldSyncProjectState,
    config,
    clonePath,
    commitSha,
  } = params;
  let { buildLog } = params;

  const hasExplicitDockerfilePath =
    typeof config.dockerfilePath === 'string' && config.dockerfilePath.trim().length > 0;
  const preferDockerfile = config.preferDockerfile === true || hasExplicitDockerfilePath;

  const composePipeline = deps.composePipeline;
  const composePath = preferDockerfile ? null : composePipeline?.detectComposeFile(clonePath);
  const isCompose = Boolean(composePath && composePipeline);
  try {
    deps.db.updateProject(projectId, {
      buildMethod: isCompose ? 'compose' : 'dockerfile',
    });
  } catch (err) {
    log.debug({ err, projectId }, 'Failed to store build_method - column may not exist');
  }
  const composeEnvVars = resolveEnvVars(
    { projectId, environmentId, inlineEnvVars: config.envVars },
    { env: deps.env },
  );
  if (isCompose && composePath && composePipeline) {
    log.info({ composePath }, 'Compose file detected — delegating to ComposePipeline');
    const result = await composePipeline.deployCompose({
      repoUrl,
      branch,
      clonePath,
      composePath,
      profiles: [],
      services: config.composeServices,
      name: routeName,
      trigger,
      envVars: composeEnvVars,
      _parentId: projectId,
    });

    if (result.success) {
      await handlePostDeploy(deps, {
        projectId,
        environmentId,
        config,
        repoUrl,
        trigger,
        startTime,
        buildLog,
        commitSha,
        shouldSyncProjectState,
        skipDeployLog: true,
        skipSuccessEvent: true,
        skipPhaseUpdate: true,
      });
    }

    return {
      type: 'compose',
      result: {
        success: result.success,
        projectId: result.parentProjectId,
        projectName: result.parentName,
        buildDurationMs: result.buildDurationMs,
        error: result.error,
      },
      buildLog,
    };
  }

  const dockerfilePath = resolveDockerfilePath(clonePath, config.dockerfilePath);
  const usingExplicitDockerfile = hasExplicitDockerfilePath;
  const dockerfileResult = usingExplicitDockerfile ? null : ensureDockerfile(clonePath);

  let autoDetected = false;
  if (
    !usingExplicitDockerfile &&
    dockerfileResult &&
    !dockerfileResult.generated &&
    !existsSync(dockerfilePath)
  ) {
    const autoDetectResult = (await deps.autoDetector?.generateDockerfile(clonePath)) ?? null;
    if (autoDetectResult?.generated && autoDetectResult.type === 'dockerfile') {
      const dockerfileContent = autoDetectResult.content.trim();
      if (dockerfileContent.length > 0) {
        writeFileSync(dockerfilePath, `${dockerfileContent}\n`, 'utf8');
        const framework = detectFramework(clonePath).framework;
        await eventBus.emit('deploy:auto-detect', {
          projectId,
          framework,
          type: 'dockerfile',
        });
        buildLog += `[dockerfile] Auto-generated by LLM (${framework})\n`;
        autoDetected = true;
      }
    }
  }

  if (!existsSync(dockerfilePath)) {
    throw new DockerfileNotFoundError(clonePath);
  }

  if (usingExplicitDockerfile) {
    buildLog += `[dockerfile] Using ${config.dockerfilePath as string}\n`;
  } else if (!autoDetected && dockerfileResult?.generated && dockerfileResult.detection) {
    buildLog += `[dockerfile] Auto-generated for ${dockerfileResult.detection.framework} (${dockerfileResult.detection.language})\n`;
  } else if (!autoDetected) {
    buildLog += '[dockerfile] Found Dockerfile\n';
  }

  const buildTimeVars = resolveEnvVarsForBuild(
    { projectId, environmentId, inlineEnvVars: config.envVars },
    { env: deps.env },
  );
  const buildStart = Date.now();
  let lastBuildOutputEmit = 0;
  let dockerBuildOutput = '';

  deps.jobManager?.updatePhase(projectId, 'building');
  await deps.buildExecutor.build(
    {
      clonePath,
      projectId,
      imageTag,
      dockerfilePath: config.dockerfilePath,
      buildArgs: buildTimeVars,
      noCache: config._noCacheBuild === true,
      buildContext: config.buildContext,
      dockerTarget: config.dockerTarget,
    },
    (line) => {
      dockerBuildOutput += line + '\n';
      const stepInfo = JobManagerClass.parseDockerBuildStep(line);
      if (stepInfo) {
        deps.jobManager?.updateBuildStep(projectId, stepInfo.step, stepInfo.total, stepInfo.desc);
      }
      const now = Date.now();
      if (now - lastBuildOutputEmit <= 50) return;
      lastBuildOutputEmit = now;
      void eventBus.emit('build:output', {
        projectId,
        line,
        stream: 'stdout',
      });
    },
  );

  if (dockerBuildOutput) {
    buildLog += '--- Docker build output ---\n' + dockerBuildOutput;
  }

  const buildDuration = Date.now() - buildStart;
  await eventBus.emit('deploy:build', {
    projectId,
    imageTag,
    durationMs: buildDuration,
  });

  buildLog += `[build] ${imageTag} (${String(buildDuration)}ms)\n`;
  return {
    type: 'docker',
    dockerfilePath,
    buildLog,
  };
}

export async function runAndVerify(
  deps: DeployOrchestrationDeps,
  params: {
    projectId: string;
    environmentId: string;
    projectName: string;
    routeName: string;
    environmentType: string;
    imageTag: string;
    dockerfilePath: string;
    previousEnvironmentImageTag: string | null;
    previousProjectImageTag: string | null;
    shouldSyncProjectState: boolean;
    config: Partial<ProjectConfig>;
    buildLog: string;
  },
): Promise<{ containerId: string; port: number; internalUrl: string; buildLog: string }> {
  const {
    projectId,
    environmentId,
    projectName,
    routeName,
    environmentType,
    imageTag,
    dockerfilePath,
    previousEnvironmentImageTag,
    previousProjectImageTag,
    shouldSyncProjectState,
    config,
  } = params;
  let { buildLog } = params;

  const containerPort = parseDockerfileExposePort(dockerfilePath) ?? undefined;
  const envVars = resolveEnvVars(
    { projectId, environmentId, inlineEnvVars: config.envVars },
    { env: deps.env },
  );

  deps.jobManager?.updatePhase(projectId, 'starting');
  const secretFilesMounts = deps.env.getSecretFilesForDeploy(projectId);
  const runResult = await deps.containerRunner.run({
    imageTag,
    projectName,
    containerName: routeName,
    projectId,
    environmentType,
    environmentId,
    preferredPort: config._preferredPort,
    containerPort,
    envVars,
    secretFiles: secretFilesMounts,
  });
  const { containerId, port, url: internalUrl } = runResult;

  await eventBus.emit('deploy:run', {
    projectId,
    containerId,
    port,
    url: internalUrl,
  });

  buildLog += `[run] ${containerId.slice(0, 12)} on port ${String(port)}\n`;

  const healthResult = await deps.docker.waitForHealthy(containerId, 20000);
  await eventBus.emit('monitor:healthcheck', {
    projectId,
    healthy: healthResult.healthy,
    responseTimeMs: 0,
  });

  if (!healthResult.healthy) {
    const containerLogs = await deps.docker
      .getLogs(containerId, 50)
      .catch(() => '(no logs available)');
    log.error(
      { projectId, error: healthResult.error, exitCode: healthResult.exitCode },
      'Container crashed after deploy',
    );

    deps.db.updateEnvironment(environmentId, {
      status: 'error',
      assignedPort: port,
      containerId,
      imageTag,
    });

    if (shouldSyncProjectState) {
      deps.db.updateProject(projectId, {
        status: 'error',
        assignedPort: port,
        containerId,
        imageTag,
        visibility: config.visibility ?? 'internal',
      });
    }

    await eventBus.emit('deploy:crash', {
      projectId,
      containerId,
      error: healthResult.error,
      exitCode: healthResult.exitCode,
    });

    throw new Error(
      `Container crashed after start: ${healthResult.error ?? 'unknown'}\n\nContainer logs:\n${containerLogs}`,
    );
  }

  deps.db.updateEnvironment(environmentId, {
    status: 'running',
    assignedPort: port,
    containerId,
    imageTag,
    previousImageTag: previousEnvironmentImageTag,
  });

  if (shouldSyncProjectState) {
    deps.db.updateProject(projectId, {
      status: 'running',
      assignedPort: port,
      containerId,
      imageTag,
      previousImageTag: previousProjectImageTag,
      visibility: config.visibility ?? 'internal',
    });
  }

  return {
    containerId,
    port,
    internalUrl,
    buildLog,
  };
}

export async function handlePostDeploy(
  deps: DeployOrchestrationDeps,
  params: {
    projectId: string;
    environmentId: string;
    config: Partial<ProjectConfig>;
    repoUrl: string;
    trigger: 'chat' | 'webhook' | 'api';
    startTime: number;
    buildLog: string;
    commitSha?: string;
    shouldSyncProjectState: boolean;
    port?: number;
    internalUrl?: string;
    skipDeployLog?: boolean;
    skipSuccessEvent?: boolean;
    skipPhaseUpdate?: boolean;
  },
): Promise<{ publicUrl?: string; totalDuration: number; buildLog: string }> {
  const {
    projectId,
    environmentId,
    config,
    repoUrl,
    trigger,
    startTime,
    commitSha,
    shouldSyncProjectState,
    port,
    internalUrl,
    skipDeployLog,
    skipSuccessEvent,
    skipPhaseUpdate,
  } = params;
  let { buildLog } = params;

  let publicUrl: string | undefined;
  if (config.visibility === 'quick-share' && shouldSyncProjectState && port !== undefined) {
    publicUrl = await deps.exposeTunnel(projectId, port);
    buildLog += `[tunnel] ${publicUrl}\n`;
  }

  const totalDuration = Date.now() - startTime;

  if (!skipDeployLog) {
    deps.db.createDeployLog({
      id: nanoid(12),
      projectId,
      environmentId,
      status: 'success',
      trigger,
      commitSha,
      buildLog,
      durationMs: totalDuration,
    });
  }

  try {
    persistDeployConfig({ projectId, config: { ...config, repoUrl }, db: deps.db });
  } catch (err) {
    log.debug({ err, projectId }, 'Failed to persist deploy config snapshot');
  }

  if (!skipPhaseUpdate) {
    deps.jobManager?.updatePhase(projectId, 'done');
  }

  if (!skipSuccessEvent) {
    const successUrl = publicUrl ?? internalUrl;
    if (successUrl) {
      await eventBus.emit('deploy:success', {
        projectId,
        url: successUrl,
        totalDurationMs: totalDuration,
      });
    }
  }

  return { publicUrl, totalDuration, buildLog };
}
