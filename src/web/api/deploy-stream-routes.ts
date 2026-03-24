import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { PreflightCheckError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
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
import { registerDeployTimelineStreamRoutes } from './deploy-timeline-stream-routes.js';

const log = createModuleLogger('api');

export function createDeployStreamRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  registerBuildProgressRoute(api, ctx);

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
      if (source === 'image' && imageUrl) {
        const result = await ctx.pipeline.deploy({
          repoUrl: '',
          source: 'image',
          imageUrl,
          containerPort: body.port,
          imageCmd: typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
          name: body.name,
          envVars: body.env_vars,
          visibility: body.visibility,
          trigger: 'api',
          environment: body.environment,
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
          environment: body.environment,
        });
        return c.json(result, result.success ? 200 : 500);
      }
    }

    const projectName =
      body.name ??
      (source === 'image' && imageUrl
        ? extractProjectName(imageUrl)
        : repoUrl
          ? extractProjectName(repoUrl)
          : 'unknown');

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

    const existing = ctx.db.getProjectByName(projectName);
    const projectId = existing?.id ?? nanoid(12);

    if (!existing) {
      if (source === 'image' && imageUrl) {
        ctx.db.createProject({
          id: projectId,
          name: projectName,
          repoUrl: '',
          source: 'image',
          imageUrl,
          imageCmd: typeof body.image_cmd === 'string' ? body.image_cmd.split(' ') : body.image_cmd,
          containerPort: body.port,
        });
      } else if (repoUrl) {
        ctx.db.createProject({
          id: projectId,
          name: projectName,
          repoUrl,
          branch: body.branch,
        });
      }
    }

    ctx.db.updateProject(projectId, { status: 'building' });
    ctx.jobManager.trackJob(projectId, projectName);
    ctx.questionBridge.setActiveProject(projectId);

    if (body.env_vars && typeof body.env_vars === 'object') {
      for (const [key, value] of Object.entries(body.env_vars)) {
        if (typeof value === 'string' && value.trim()) {
          ctx.env.set(projectId, key, value.trim());
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

      const release = await ctx.deployQueue.acquire();

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
        environment: body.environment,
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
        log.error({ err, projectId }, 'Deterministic deploy orchestration failed');

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
          },
          retryState,
        );
      } finally {
        release();
      }
    })();

    return c.json({ success: true, projectId, projectName, status: 'building' });
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

    const result = await ctx.pipeline.startDeploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      name: body.name,
      dockerTarget: body.docker_target,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
      trigger: 'api',
      environment: body.environment,
    });

    return c.json(result, 200);
  });

  registerDeployTimelineStreamRoutes(api, ctx);

  registerEnvScanRoutes(api, ctx);

  return api;
}
