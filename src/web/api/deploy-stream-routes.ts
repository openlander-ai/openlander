import { Hono } from 'hono';
import { rm } from 'node:fs/promises';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { PreflightCheckError, ProjectNotFoundError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { extractProjectName } from '../../pipeline/helpers.js';
import { preflightCheckOrThrow } from '../../pipeline/preflight.js';
import { registerDeployTimelineStreamRoutes } from './deploy-timeline-stream-routes.js';

const log = createModuleLogger('api');

// ============================================================================
// DETERMINISTIC DEPLOY HELPERS
// ============================================================================
// These helpers are extracted for Task 2 (orchestration replacement).
// They will be consumed when agent.chatStream() is replaced with deterministic execution.

/**
 * Emit a terminal-style status message via eventBus.
 * Used to send progress updates to the timeline/build stream UI.
 */
async function emitTerminalMessage(
  projectId: string,
  message: string,
  _isKorean: boolean,
): Promise<void> {
  await eventBus.emit('agent:event', {
    projectId,
    event: {
      type: 'message',
      content: message,
      timestamp: new Date().toISOString(),
    },
  });
}

export function createDeployStreamRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/builds/:id/progress', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const unsubscribers: Array<() => void> = [];

    return stream(c, async (s) => {
      c.header('Content-Type', 'application/x-ndjson');

      unsubscribers.push(
        eventBus.on('deploy:start', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: 0, step: 'Starting deployment...', stepName: 'Preparing' }) +
              '\n',
          );
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: 15, step: 'Cloning repository...', stepName: 'Clone' }) +
              '\n',
          );
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: 60, step: 'Building Docker image...', stepName: 'Build' }) +
              '\n',
          );
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: 85, step: 'Starting container...', stepName: 'Start' }) +
              '\n',
          );
        }),
      );

      unsubscribers.push(
        eventBus.on('monitor:healthcheck', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({
              percent: 95,
              step: 'Running health checks...',
              stepName: 'Health Check',
            }) + '\n',
          );
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: 100, step: 'Complete', stepName: 'Complete' }) + '\n',
          );
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: -1, step: 'Failed', error: payload.error }) + '\n',
          );
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:needs-user-action', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({
              percent: -1,
              step: 'User action required',
              error: payload.title,
              detail: payload.description,
              userSteps: payload.userSteps,
            }) + '\n',
          );
          void s.close();
        }),
      );

      s.onAbort(() => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      });

      await Promise.resolve();
    });
  });

  api.post('/projects/deploy', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch?: string;
      name?: string;
      env_vars?: Record<string, string>;
      visibility?: 'internal' | 'quick-share';
      environment?: string;
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    // Fallback: no agent (LLM not configured) → direct pipeline call
    if (!ctx.agent) {
      const result = await ctx.pipeline.deploy({
        repoUrl: body.repo_url,
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

    const projectName = body.name ?? extractProjectName(body.repo_url);

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
      ctx.db.createProject({
        id: projectId,
        name: projectName,
        repoUrl: body.repo_url,
        branch: body.branch,
      });
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

      let hasRetriedAfterTerminalFailure = false;

      const startPlanExecution = async (): Promise<void> => {
        await emitTerminalMessage(
          projectId,
          isKorean ? '배포 계획 생성 중...' : 'Creating deployment plan...',
          isKorean,
        );

        const plan = await ctx.planEngine.createPlan({
          repoUrl: body.repo_url,
          branch: body.branch,
          name: projectName,
          envVars: body.env_vars,
          visibility: body.visibility,
          environment: body.environment,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          trigger: 'api',
        });

        await emitTerminalMessage(
          projectId,
          isKorean ? '배포 계획 실행 중...' : 'Executing deployment plan...',
          isKorean,
        );

        const executionResult = await ctx.planEngine.executePlan(plan.plan_id);
        if (executionResult.status === 'failed') {
          throw new Error(executionResult.error ?? 'Plan execution failed');
        }
      };

      const handleTerminalFailure = async (input: {
        step: 'deploy-start' | 'monorepo' | 'orchestrate';
        failedStep: string;
        error: string;
      }): Promise<void> => {
        if (!ctx.buildDebugger) {
          await eventBus.emit('deploy:failed', {
            projectId,
            step: input.step,
            error: input.error,
          });
          return;
        }

        await emitTerminalMessage(
          projectId,
          isKorean
            ? 'AI 분석을 실행해 실패 원인과 다음 조치를 정리합니다...'
            : 'Running AI analysis for root cause and next steps...',
          isKorean,
        );

        let diagnosis: {
          summary: string;
          rootCause: string;
          suggestedFixes: Array<{
            description: string;
            location?: string;
            confidence: 'high' | 'medium' | 'low';
          }>;
        } | null = null;

        try {
          diagnosis = await ctx.buildDebugger.diagnose({
            buildLog: input.error,
            projectName,
            imageTag: existing?.image_tag ?? `openlander/${projectName}:latest`,
            failedStep: input.failedStep,
          });
        } catch (diagnoseErr) {
          const diagnoseMsg =
            diagnoseErr instanceof Error ? diagnoseErr.message : String(diagnoseErr);
          await emitTerminalMessage(
            projectId,
            isKorean ? `AI 분석 실패: ${diagnoseMsg}` : `AI analysis failed: ${diagnoseMsg}`,
            isKorean,
          );
          await eventBus.emit('deploy:failed', {
            projectId,
            step: input.step,
            error: input.error,
          });
          return;
        }

        await emitTerminalMessage(
          projectId,
          isKorean ? `AI 요약: ${diagnosis.summary}` : `AI summary: ${diagnosis.summary}`,
          isKorean,
        );
        await emitTerminalMessage(
          projectId,
          isKorean ? `근본 원인: ${diagnosis.rootCause}` : `Root cause: ${diagnosis.rootCause}`,
          isKorean,
        );

        const topFixes = diagnosis.suggestedFixes.slice(0, 3);
        if (topFixes.length > 0) {
          await emitTerminalMessage(
            projectId,
            isKorean ? '추천 조치:' : 'Suggested fixes:',
            isKorean,
          );
          for (const [index, fix] of topFixes.entries()) {
            const locationText = fix.location ? ` (${fix.location})` : '';
            await emitTerminalMessage(
              projectId,
              `  ${String(index + 1)}. ${fix.description}${locationText}`,
              isKorean,
            );
          }
        }

        const retryLabel = isKorean ? '지금 배포 재시도' : 'Retry deployment now';
        const cancelLabel = isKorean ? '취소' : 'Cancel';
        const manualFixLabelPrefix = isKorean ? '수동 조치' : 'Manual follow-up';
        const suggestedFixOptions = topFixes.map((fix, index) => {
          const confidenceText = isKorean
            ? `신뢰도 ${fix.confidence}`
            : `Confidence ${fix.confidence}`;
          const locationText = fix.location
            ? isKorean
              ? `위치: ${fix.location}`
              : `Location: ${fix.location}`
            : isKorean
              ? '위치 정보 없음'
              : 'No location provided';

          return {
            label: `${manualFixLabelPrefix} ${String(index + 1)}`,
            description: `${fix.description} (${confidenceText}; ${locationText})`,
            fix,
          };
        });
        const manualFixByLabel = new Map(
          suggestedFixOptions.map((option) => [option.label, option.fix]),
        );

        let answers: Array<{ selectedLabels: string[] }> | null = null;
        try {
          answers = await ctx.questionBridge.ask({
            id: nanoid(12),
            questions: [
              {
                header: isKorean ? '배포 복구 선택' : 'Deployment Recovery',
                question: isKorean ? '다음으로 어떤 작업을 진행할까요?' : 'What should we do next?',
                options: [
                  {
                    label: retryLabel,
                    description: isKorean
                      ? '동일 설정으로 결정론적 배포 시작을 한 번 더 실행합니다.'
                      : 'Retry deterministic deploy startup once with the same settings.',
                  },
                  ...suggestedFixOptions.map((option) => ({
                    label: option.label,
                    description: option.description,
                  })),
                  {
                    label: cancelLabel,
                    description: isKorean
                      ? '현재 실패 상태를 유지하고 배포를 종료합니다.'
                      : 'Keep the current failed state and stop here.',
                  },
                ],
                multiple: false,
                metadata: {
                  questionType: 'deterministic_terminal_failure_recovery',
                  projectId,
                  failedStep: input.failedStep,
                },
              },
            ],
          });
        } catch (askErr) {
          const askMsg = askErr instanceof Error ? askErr.message : String(askErr);
          await emitTerminalMessage(
            projectId,
            isKorean
              ? `사용자 응답 대기 중 오류가 발생해 배포를 종료합니다: ${askMsg}`
              : `Stopping deploy because user input failed: ${askMsg}`,
            isKorean,
          );
          await eventBus.emit('deploy:failed', {
            projectId,
            step: input.step,
            error: input.error,
          });
          return;
        }

        const selectedLabels = answers[0]?.selectedLabels ?? [];
        if (selectedLabels.includes(retryLabel) && !hasRetriedAfterTerminalFailure) {
          hasRetriedAfterTerminalFailure = true;
          await emitTerminalMessage(
            projectId,
            isKorean
              ? '사용자 선택: 배포를 결정론적으로 다시 시작합니다.'
              : 'User selected retry. Restarting deterministic deployment startup.',
            isKorean,
          );

          void startPlanExecution().catch(async (retryErr: unknown) => {
            const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            await emitTerminalMessage(
              projectId,
              isKorean
                ? `❌ 재시도 배포 시작 실패: ${retryErrMsg}`
                : `❌ Failed to start retry deployment: ${retryErrMsg}`,
              isKorean,
            );
            await eventBus.emit('deploy:failed', {
              projectId,
              step: 'deploy-start',
              error: retryErrMsg,
            });
          });

          return;
        }

        if (selectedLabels.includes(retryLabel) && hasRetriedAfterTerminalFailure) {
          await emitTerminalMessage(
            projectId,
            isKorean
              ? '이미 한 번 재시도했기 때문에 추가 자동 재시도는 건너뜁니다.'
              : 'Retry was already attempted once. Skipping additional automatic retry.',
            isKorean,
          );
        } else {
          const selectedManualFixLabel = selectedLabels.find((label) =>
            manualFixByLabel.has(label),
          );
          if (selectedManualFixLabel) {
            const selectedManualFix = manualFixByLabel.get(selectedManualFixLabel);
            if (selectedManualFix) {
              await emitTerminalMessage(
                projectId,
                isKorean
                  ? `사용자 선택: 제안 ${selectedManualFixLabel}은(는) 자동 적용하지 않습니다. 수동 조치가 필요합니다.`
                  : `User selected ${selectedManualFixLabel}. OpenLander will not auto-apply this fix; manual follow-up is required.`,
                isKorean,
              );

              ctx.db.updateProject(projectId, { status: 'error' });
              await eventBus.emit('deploy:needs-user-action', {
                projectId,
                category: 'manual_followup_required',
                title: isKorean ? '수동 조치 필요' : 'Manual fix required',
                description: isKorean
                  ? `다음 제안은 자동 적용되지 않았습니다: ${selectedManualFix.description}`
                  : `This suggested fix was not auto-applied: ${selectedManualFix.description}`,
                userSteps: [
                  {
                    label: selectedManualFix.description,
                  },
                  {
                    label: isKorean
                      ? '수동 조치 완료 후 배포를 다시 시도하세요.'
                      : 'After completing the manual fix, retry deployment.',
                  },
                ],
              });
              return;
            }
          }

          await emitTerminalMessage(
            projectId,
            isKorean ? '사용자 선택: 배포를 취소합니다.' : 'User selected cancel. Stopping deploy.',
            isKorean,
          );
        }

        await eventBus.emit('deploy:failed', {
          projectId,
          step: input.step,
          error: input.error,
        });
      };

      try {
        await startPlanExecution();
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
        await handleTerminalFailure({
          step: 'orchestrate',
          failedStep: 'orchestrate',
          error: errMsg,
        });
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

  // POST /api/env/scan — scan a repo for env var usage (initial deploy)
  api.post('/env/scan', async (c) => {
    const body = await c.req.json<{ repo_url: string; branch?: string }>();
    if (!body.repo_url) {
      return c.json({ error: 'repo_url is required' }, 400);
    }

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({ repoUrl: body.repo_url, branch: body.branch });
      clonePath = cloneResult.path;
      const result = scanForEnvUsage(clonePath);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  // POST /api/projects/:id/env/scan — scan existing project repo (redeploy)
  api.post('/projects/:id/env/scan', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (!project.repo_url) return c.json({ error: 'Project has no repo URL' }, 400);

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({ repoUrl: project.repo_url, branch: project.branch });
      clonePath = cloneResult.path;
      const result = scanForEnvUsage(clonePath);

      const allStoredKeys = new Set<string>();
      for (const key of Object.keys(ctx.env.getAll(project.id))) allStoredKeys.add(key);
      for (const key of Object.keys(ctx.env.getGlobalSecrets())) allStoredKeys.add(key);
      for (const env of ctx.db.getEnvironmentsByProject(project.id)) {
        for (const key of Object.keys(ctx.env.getAll(project.id, env.id))) allStoredKeys.add(key);
      }
      const newVars = result.vars.filter((v) => !allStoredKeys.has(v.key));
      const existingVars = result.vars.filter((v) => allStoredKeys.has(v.key)).map((v) => v.key);

      return c.json({
        vars: result.vars,
        newVars,
        existingVars,
        hasEnvExample: result.hasEnvExample,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return api;
}
