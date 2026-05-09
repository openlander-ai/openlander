import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import {
  InvalidProjectTargetError,
  InvalidSourceFieldsError,
  PreflightCheckError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { classifyDeployError } from '../../pipeline/error-classifier.js';
import { extractProjectName } from '../../pipeline/helpers.js';
import { parseImageUrl } from '../../pipeline/image-utils.js';
import { preflightCheckOrThrow } from '../../pipeline/preflight.js';
import {
  emitTerminalMessage,
  handleTerminalFailure,
  registerBuildProgressRoute,
  registerEnvScanRoutes,
  startPlanExecution,
} from './deploy-failure-handler.js';
import { registerDeployLogStreamRoutes } from './deploy-log-stream-routes.js';

const log = createModuleLogger('api');

const NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

async function uniqueDeployName(ctx: AppContext, base: string): Promise<string> {
  const normalized = normalizeName(base) || `service-${nanoid(6)}`;
  const existingServices =
    typeof ctx.db.getServices === 'function' ? await ctx.db.getServices() : [];
  const serviceNames = new Set(existingServices.map((service) => service.name));

  const isTaken = async (candidate: string): Promise<boolean> =>
    Boolean(await ctx.db.getProjectByName(candidate)) ||
    serviceNames.has(candidate) ||
    serviceNames.has(`${candidate}__svc`);

  if (!(await isTaken(normalized))) {
    return normalized;
  }
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${normalized}-${String(i)}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
  return `${normalized}-${nanoid(6)}`;
}

export function createDeployStreamRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  registerBuildProgressRoute(api, ctx);

  api.post('/services/deploy', async (c) => {
    const body = await c.req.json<{
      source?: unknown;
      repo_url?: string;
      image_url?: string;
      image_cmd?: string | string[];
      port?: number;
      branch?: string | null;
      project_id?: string;
      project_name?: string;
      service_name?: string;
      env_vars?: Record<string, string>;
      visibility?: 'internal' | 'quick-share';
      dockerfile_path?: string;
      docker_target?: string;
      build_context?: string;
    }>();

    const source = body.source;
    if (source !== 'git' && source !== 'image') {
      return c.json(new InvalidSourceFieldsError('source must be "git" or "image"').toJSON(), 400);
    }
    if (source === 'git') {
      if (!body.repo_url || body.image_url) {
        return c.json(
          new InvalidSourceFieldsError(
            'source="git" requires repo_url and forbids image_url',
          ).toJSON(),
          400,
        );
      }
    } else {
      if (!body.image_url || body.repo_url) {
        return c.json(
          new InvalidSourceFieldsError(
            'source="image" requires image_url and forbids repo_url',
          ).toJSON(),
          400,
        );
      }
      if (!parseImageUrl(body.image_url)) {
        return c.json(
          {
            error: 'INVALID_IMAGE_URL',
            code: 'INVALID_IMAGE_URL',
            message: 'Invalid Docker image URL format',
          },
          400,
        );
      }
    }

    let targetProject = body.project_id ? await ctx.db.getProject(body.project_id) : undefined;
    if (body.project_id && !targetProject) {
      return c.json(
        {
          error: 'PROJECT_NOT_FOUND',
          code: 'PROJECT_NOT_FOUND',
          message: `Project not found: ${body.project_id}`,
        },
        404,
      );
    }

    if (targetProject && body.project_name && targetProject.name !== body.project_name) {
      return c.json(
        new InvalidProjectTargetError(
          targetProject.id,
          targetProject.name,
          body.project_name,
        ).toJSON(),
        400,
      );
    }

    if (!targetProject && body.project_name) {
      targetProject = await ctx.db.getProjectByName(body.project_name);
      if (!targetProject) {
        targetProject = await ctx.db.createProjectGroup({
          id: crypto.randomUUID(),
          name: body.project_name,
        });
      }
    }

    const sourceName =
      source === 'image'
        ? extractProjectName(body.image_url ?? 'image')
        : extractProjectName(body.repo_url ?? 'service');
    const groupName = targetProject?.name ?? normalizeName(body.project_name ?? sourceName);
    const serviceName = normalizeName(body.service_name ?? sourceName);
    if (!NAME_REGEX.test(groupName) || !NAME_REGEX.test(serviceName)) {
      return c.json(
        {
          error: 'INVALID_PROJECT_NAME',
          code: 'INVALID_PROJECT_NAME',
          message: 'Names must contain only lowercase letters, numbers, and hyphens',
        },
        400,
      );
    }

    const deployName = targetProject
      ? await uniqueDeployName(ctx, serviceName)
      : await uniqueDeployName(ctx, groupName);
    const result =
      source === 'image'
        ? await ctx.pipeline.deploy({
            repoUrl: '',
            source: 'image',
            imageUrl: body.image_url,
            containerPort: body.port,
            imageCmd:
              typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
            name: deployName,
            envVars: body.env_vars,
            visibility: body.visibility,
            trigger: 'api',
            environment: 'production',
          })
        : await ctx.pipeline.deploy({
            repoUrl: body.repo_url ?? '',
            branch: body.branch ?? undefined,
            name: deployName,
            envVars: body.env_vars,
            visibility: body.visibility,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
            trigger: 'api',
            environment: 'production',
            dockerfilePath: body.dockerfile_path,
            dockerTarget: body.docker_target,
            buildContext: body.build_context,
          });

    let projectId = result.projectId;
    if (result.success && targetProject && result.projectId) {
      await ctx.db.attachServiceToProject(`${result.projectId}__svc`, targetProject.id);
      projectId = targetProject.id;
    }

    return c.json({ ...result, projectId, serviceName: deployName }, result.success ? 200 : 500);
  });

  api.post('/projects/deploy', async (c) => {
    const body = await c.req.json<{
      source?: 'git' | 'image';
      repo_url?: string;
      image_url?: string;
      image_cmd?: string | string[];
      port?: number;
      branch?: string;
      name?: string;
      env_vars?: Record<string, string>;
      visibility?: 'internal' | 'quick-share';
      environment?: string;
    }>();

    const source = body.source ?? 'git';
    const environment = 'production';

    let imageUrl: string | undefined;
    let repoUrl: string | undefined;

    if (source === 'image') {
      if (!body.image_url) {
        return c.json(
          { error: 'MISSING_FIELD', message: 'image_url is required for image source' },
          400,
        );
      }
      const parsed = parseImageUrl(body.image_url);
      if (!parsed) {
        return c.json(
          { error: 'INVALID_IMAGE_URL', message: 'Invalid Docker image URL format' },
          400,
        );
      }
      imageUrl = body.image_url;
    } else {
      if (!body.repo_url) {
        return c.json(
          { error: 'MISSING_FIELD', message: 'repo_url is required for git source' },
          400,
        );
      }
      repoUrl = body.repo_url;
    }

    // Fallback: no agent (LLM not configured) → direct pipeline call
    if (!ctx.agent) {
      // 1.0 GA: route the no-agent fallback through the per-project lock so
      // it participates in the same BUG-002 regression guard as the
      // agent-driven path. New-project deploys (no existing project row) get
      // a synthetic lock id from the requested name.
      const fallbackProject = await ctx.db.getProjectByName(
        body.name ??
          (source === 'image' && imageUrl
            ? extractProjectName(imageUrl)
            : repoUrl
              ? extractProjectName(repoUrl)
              : 'unknown'),
      );
      const fallbackLockKey =
        fallbackProject?.id ??
        body.name ??
        (source === 'image' && imageUrl
          ? extractProjectName(imageUrl)
          : repoUrl
            ? extractProjectName(repoUrl)
            : 'unknown');
      const fallbackSessionId = `deploy-fallback-${Date.now().toString(36)}-${nanoid(6)}`;
      const fallbackAcquired = ctx.agentPool
        ? ctx.agentPool.acquireProjectLock(fallbackLockKey, fallbackSessionId)
        : true;
      if (!fallbackAcquired) {
        const lock = ctx.agentPool?.getProjectLock(fallbackLockKey);
        return c.json(
          {
            success: false,
            error: 'DEPLOY_LOCKED',
            message: `Project is busy (held by ${lock?.sessionId ?? 'another session'})`,
          },
          409,
        );
      }
      try {
        if (source === 'image' && imageUrl) {
          const result = await ctx.pipeline.deploy({
            repoUrl: '',
            source: 'image',
            imageUrl,
            containerPort: body.port,
            imageCmd:
              typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
            name: body.name,
            envVars: body.env_vars,
            visibility: body.visibility,
            trigger: 'api',
            environment,
          });
          return c.json(result, result.success ? 200 : 500);
        } else if (repoUrl) {
          const result = await ctx.pipeline.deploy({
            repoUrl,
            branch: body.branch,
            name: body.name,
            envVars: body.env_vars,
            visibility: body.visibility,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
            trigger: 'api',
            environment,
          });
          return c.json(result, result.success ? 200 : 500);
        }
      } finally {
        if (ctx.agentPool) {
          ctx.agentPool.releaseProjectLock(fallbackLockKey, fallbackSessionId);
        }
      }
    }

    const projectName =
      body.name ??
      (source === 'image' && imageUrl
        ? extractProjectName(imageUrl)
        : repoUrl
          ? extractProjectName(repoUrl)
          : 'unknown');

    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (projectName && !PROJECT_NAME_REGEX.test(projectName)) {
      return c.json(
        {
          error: 'INVALID_PROJECT_NAME',
          message:
            'Project name must contain only lowercase letters, numbers, and hyphens, starting with a letter or number',
        },
        400,
      );
    }

    try {
      await preflightCheckOrThrow(ctx.db, ctx.docker, projectName);
    } catch (err) {
      if (err instanceof PreflightCheckError) {
        return c.json(
          {
            success: false,
            status: 'preflight_failed',
            error: err.message,
            preflightWarnings: err.result.warnings,
          },
          400,
        );
      }
      throw err;
    }

    const existing = await ctx.db.getProjectByName(projectName);
    const projectId = existing?.id ?? nanoid(12);

    if (!existing) {
      if (source === 'image' && imageUrl) {
        await ctx.db.createProject({
          id: projectId,
          name: projectName,
          repoUrl: '',
          source: 'image',
          imageUrl,
          imageCmd: typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
          containerPort: body.port,
        });
      } else if (repoUrl) {
        await ctx.db.createProject({
          id: projectId,
          name: projectName,
          repoUrl,
          branch: body.branch,
        });
      }
    }

    await ctx.db.updateProject(projectId, { status: 'building' });
    ctx.jobManager.trackJob(projectId, projectName);
    ctx.questionBridge.setActiveProject(projectId);

    if (body.env_vars && typeof body.env_vars === 'object') {
      for (const [key, value] of Object.entries(body.env_vars)) {
        if (typeof value === 'string' && value.trim()) {
          await ctx.env.set(projectId, key, value.trim());
        }
      }
    }

    const isKorean = ctx.config.language === 'ko';

    void (async () => {
      await emitTerminalMessage(
        projectId,
        isKorean ? '배포 준비 중...' : 'Preparing deployment...',
        isKorean,
      );

      await emitTerminalMessage(
        projectId,
        isKorean ? '배포 슬롯 확보 중...' : 'Acquiring deploy slot...',
        isKorean,
      );

      // Per-project lock (1.0 GA): different projects deploy concurrently.
      // Same-project double-deploy still blocks via the in-memory lock and
      // the pipeline boundary's `withDeployLock` second check.
      const lockSessionId = `deploy-${projectId}-${Date.now().toString(36)}`;
      const acquired = ctx.agentPool
        ? ctx.agentPool.acquireProjectLock(projectId, lockSessionId)
        : true;
      if (!acquired) {
        const lock = ctx.agentPool?.getProjectLock(projectId);
        await emitTerminalMessage(
          projectId,
          isKorean
            ? `❌ 같은 프로젝트가 이미 배포 중입니다 (세션: ${lock?.sessionId ?? 'unknown'})`
            : `❌ Project is already deploying (session: ${lock?.sessionId ?? 'unknown'})`,
          isKorean,
        );
        return;
      }
      const release = (): void => {
        if (ctx.agentPool) {
          ctx.agentPool.releaseProjectLock(projectId, lockSessionId);
        }
      };

      const retryState = { hasRetriedAfterTerminalFailure: false };
      const write = (message: string): Promise<void> =>
        emitTerminalMessage(projectId, message, isKorean);
      const planRepoUrl = source === 'image' && imageUrl ? imageUrl : repoUrl || '';
      const planDeps = {
        ctx,
        projectId,
        projectName,
        isKorean,
        repoUrl: planRepoUrl,
        branch: body.branch,
        envVars: body.env_vars,
        visibility: body.visibility,
        environment,
        sshKeyPath: ctx.config.git.sshKeyPath,
        trigger: 'api',
        write,
        source,
        imageUrl,
        imageCmd: typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
        containerPort: body.port,
      };
      const failureDeps = {
        ctx,
        projectId,
        projectName,
        isKorean,
        write,
        startPlanExecution: () => startPlanExecution(planDeps),
      };

      try {
        await startPlanExecution(planDeps);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Phase E_NEW: classify the failure into one of the 16 ErrorClass
        // keys so the SSE terminal event can render the v4 ErrorSurface
        // narrative. Default `RUNTIME_CRASH` when no rule matches.
        const errorClass = classifyDeployError(err);
        log.error({ err, projectId, errorClass }, 'Deterministic deploy orchestration failed');

        await emitTerminalMessage(
          projectId,
          isKorean
            ? `❌ 배포 오케스트레이션 실패: ${errMsg}`
            : `❌ Deploy orchestration failed: ${errMsg}`,
          isKorean,
        );
        await handleTerminalFailure(
          failureDeps,
          {
            step: 'orchestrate',
            failedStep: 'orchestrate',
            error: errMsg,
            errorClass,
          },
          retryState,
        );
      } finally {
        release();
      }
    })();

    return c.json({
      success: true,
      projectId,
      projectName,
      status: 'building',
      statusUrl: `/api/projects/${projectId}`,
    });
  });

  api.post('/deploy/start', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch?: string;
      name?: string;
      environment?: string;
      docker_target?: string;
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    // 1.0 GA: same per-project lock as the main /projects/deploy path so
    // /deploy/start does not bypass the BUG-002 regression guard.
    const startExisting = await ctx.db.getProjectByName(
      body.name ?? extractProjectName(body.repo_url),
    );
    const startLockKey = startExisting?.id ?? body.name ?? extractProjectName(body.repo_url);
    const startSessionId = `deploy-start-${Date.now().toString(36)}-${nanoid(6)}`;
    const startAcquired = ctx.agentPool
      ? ctx.agentPool.acquireProjectLock(startLockKey, startSessionId)
      : true;
    if (!startAcquired) {
      const lock = ctx.agentPool?.getProjectLock(startLockKey);
      return c.json(
        {
          success: false,
          error: 'DEPLOY_LOCKED',
          message: `Project is busy (held by ${lock?.sessionId ?? 'another session'})`,
        },
        409,
      );
    }
    try {
      const result = await ctx.pipeline.startDeploy({
        repoUrl: body.repo_url,
        branch: body.branch,
        name: body.name,
        dockerTarget: body.docker_target,
        sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        trigger: 'api',
        environment: 'production',
      });

      return c.json(result, 200);
    } finally {
      if (ctx.agentPool) {
        ctx.agentPool.releaseProjectLock(startLockKey, startSessionId);
      }
    }
  });

  registerDeployLogStreamRoutes(api, ctx);

  registerEnvScanRoutes(api, ctx);

  return api;
}
