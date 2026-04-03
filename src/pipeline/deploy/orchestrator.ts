import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { nanoid } from 'nanoid';

import { createModuleLogger } from '../../lib/logger.js';
import type { OpenLanderEnv } from '../../config/index.js';
import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import type { Docker } from '../docker.js';
import type { AutoDetector } from '../auto-detect.js';
import type { ComposePipeline } from '../compose.js';
import type { EnvManager } from '../env.js';
import { ensureDockerfile, detectFramework, parseDockerfileExposePort } from '../dockerfile-gen.js';
import { findDockerfiles } from '../../lib/repo-scanner.js';
import { resolveEnvVars, resolveEnvVarsForBuild } from '../resolve-env.js';
import { cloneRepo, getCommitSubject } from '../git.js';
import { detectNewEnvKeys } from '../env-inject.js';
import { analyzeBuildDiff, formatDiffForPrompt } from '../diff-analysis.js';
import { scanForSecrets } from '../secret-scan.js';
import { persistDeployConfig } from '../config-snapshot.js';
import type { JobManager } from '../job-manager.js';
import { JobManager as JobManagerClass } from '../job-manager.js';
import { DockerfileNotFoundError } from '../../errors.js';
import { resolveDockerfilePath } from './helpers.js';
import { checkDeployConnectivity } from './connectivity-check.js';
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
  secretScanEnabled: boolean;
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
): Promise<{
  clonePath: string;
  commitSha: string;
  commitMessage?: string;
  buildLog: string;
  diffContext?: string;
}> {
  const { projectId, projectName, environmentId, repoUrl, branch, sshKeyPath } = params;
  let buildLog = '';
  let diffContext: string | undefined;

  const cloneResult = await cloneRepo({ repoUrl, branch, sshKeyPath });
  const commitMessage = await getCommitSubject(cloneResult.path, cloneResult.commitSha);

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

  if (deps.secretScanEnabled) {
    const secretFindings = scanForSecrets(cloneResult.path);
    if (secretFindings.length > 0) {
      await eventBus.emit('secret:detected', {
        projectId,
        projectName,
        secrets: secretFindings,
      });
    }
  }

  return {
    clonePath: cloneResult.path,
    commitSha: cloneResult.commitSha,
    commitMessage,
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
    environmentType?: OpenLanderEnv;
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

  if (config.source === 'image') {
    return {
      type: 'docker',
      dockerfilePath: '',
      buildLog,
    };
  }

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
      commitSha,
      profiles: [],
      services: config.composeServices,
      name: routeName,
      trigger,
      envVars: composeEnvVars,
      environmentType: params.environmentType,
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

  let resolvedDockerfilePath = config.dockerfilePath;
  if (
    hasExplicitDockerfilePath &&
    !existsSync(resolveDockerfilePath(clonePath, resolvedDockerfilePath))
  ) {
    const discovered = findDockerfiles(clonePath);
    const { relative } = await import('node:path');
    const relDiscovered = discovered.map((d) => relative(clonePath, d));
    const rootDockerfile = relDiscovered.find((d) => d === 'Dockerfile');

    if (rootDockerfile) {
      resolvedDockerfilePath = rootDockerfile;
      buildLog += `[dockerfile] ${config.dockerfilePath as string} not found; falling back to ${resolvedDockerfilePath}\n`;
    } else if (relDiscovered.length === 1 && relDiscovered[0]) {
      resolvedDockerfilePath = relDiscovered[0];
      buildLog += `[dockerfile] ${config.dockerfilePath as string} not found; falling back to ${resolvedDockerfilePath}\n`;
    } else if (relDiscovered.length > 1) {
      throw new DockerfileNotFoundError(
        `${config.dockerfilePath as string} not found. Multiple Dockerfiles discovered: ${relDiscovered.join(', ')}. Use update_project_config to set the correct dockerfile_path.`,
      );
    }
  }
  const dockerfilePath = resolveDockerfilePath(clonePath, resolvedDockerfilePath);
  const usingExplicitDockerfile =
    hasExplicitDockerfilePath && resolvedDockerfilePath === config.dockerfilePath;
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

  try {
    const dfPreview = readFileSync(dockerfilePath, 'utf8');
    const keyLines = dfPreview
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => /^(RUN|CMD|ENTRYPOINT|EXPOSE)\s/i.test(l))
      .slice(0, 4);
    for (const line of keyLines) {
      const truncated = line.length > 120 ? line.slice(0, 117) + '...' : line;
      buildLog += `[dockerfile]   ${truncated}\n`;
    }
  } catch {
    /* validated above */
  }

  {
    const { relative: relPath } = await import('node:path');
    const usedDockerfile = relPath(clonePath, dockerfilePath);
    const allDockerfiles = findDockerfiles(clonePath).map((d: string) => relPath(clonePath, d));
    const changedDockerfiles = allDockerfiles.filter((df: string) => {
      if (df === usedDockerfile) return false;
      try {
        const diff = execSync(`git diff HEAD~1 --name-only -- "${df}" 2>/dev/null`, {
          cwd: clonePath,
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        return diff.length > 0;
      } catch {
        return false;
      }
    });
    for (const changed of changedDockerfiles) {
      buildLog += `[warning] Commit modified ${changed}, but build uses ${usedDockerfile}\n`;
      buildLog += `[warning]   → To change: update_project_config(dockerfile_path="${changed}")\n`;
    }
  }

  const buildTimeVars = resolveEnvVarsForBuild(
    { projectId, environmentId, inlineEnvVars: config.envVars },
    { env: deps.env },
  );
  const buildStart = Date.now();
  let lastBuildOutputEmit = 0;
  let dockerBuildOutput = '';

  deps.jobManager?.updatePhase(projectId, 'building');
  try {
    await deps.buildExecutor.build(
      {
        clonePath,
        projectId,
        imageTag,
        dockerfilePath: resolvedDockerfilePath,
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
  } catch (buildErr) {
    if (dockerBuildOutput) {
      buildLog += '--- Docker build output ---\n' + dockerBuildOutput;
    }
    const err = buildErr instanceof Error ? buildErr : new Error(String(buildErr));
    (err as Error & { buildLog?: string }).buildLog = buildLog;
    throw err;
  }

  const buildDuration = Date.now() - buildStart;
  const latestAlias = `openlander/${routeName}:latest`;
  const dockerWithTag = deps.docker as unknown as {
    tagImage?: (sourceTag: string, repo: string, newTag: string) => Promise<void>;
  };
  if (imageTag !== latestAlias && typeof dockerWithTag.tagImage === 'function') {
    await dockerWithTag.tagImage(imageTag, `openlander/${routeName}`, 'latest');
    buildLog += `[tag] ${latestAlias}\n`;
  }

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
    environmentType: OpenLanderEnv;
    imageTag: string;
    dockerfilePath?: string;
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

  const containerPort =
    config.containerPort ??
    (dockerfilePath && dockerfilePath.length > 0
      ? (parseDockerfileExposePort(dockerfilePath) ?? undefined)
      : undefined);
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
    imageCmd: config.imageCmd,
    secretFiles: secretFilesMounts,
    restartPolicy: { Name: 'unless-stopped' },
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

  try {
    const connectivityResults = await checkDeployConnectivity({
      docker: deps.docker,
      containerId,
      envVars,
    });

    if (connectivityResults.length === 0) {
      buildLog += '[connectivity] skipped (tools not available in container)\n';
    } else {
      for (const result of connectivityResults) {
        const endpoint =
          result.port !== undefined ? `${result.hostname}:${String(result.port)}` : result.hostname;
        const dnsStatus = result.dnsResolved ? 'DNS OK' : 'DNS FAIL';
        const tcpStatus =
          result.port === undefined ? 'TCP SKIP' : result.tcpReachable ? 'TCP OK' : 'TCP FAIL';
        const summary = `(${dnsStatus}, ${tcpStatus})`;
        const detail = result.error ? ` - ${result.error}` : '';
        const isHealthy = result.dnsResolved && (result.port === undefined || result.tcpReachable);
        buildLog += isHealthy
          ? `[connectivity] ✓ ${endpoint} ${summary}${detail}\n`
          : `[connectivity] ⚠ ${endpoint} ${summary}${detail}\n`;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    buildLog += `[connectivity] ⚠ check failed: ${message}\n`;
    log.warn({ projectId, containerId, err }, 'Post-deploy connectivity check failed');
  }

  deps.db.updateEnvironment(environmentId, {
    status: 'running',
    assignedPort: port,
    containerId,
    imageTag,
    ...(previousEnvironmentImageTag != null
      ? { previousImageTag: previousEnvironmentImageTag }
      : {}),
  });

  if (shouldSyncProjectState) {
    deps.db.updateProject(projectId, {
      status: 'running',
      assignedPort: port,
      containerId,
      imageTag,
      ...(previousProjectImageTag != null ? { previousImageTag: previousProjectImageTag } : {}),
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
    commitMessage?: string;
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
    commitMessage,
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
      commitMessage,
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
