import { rm } from 'node:fs/promises';
import type { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { loadServiceViewRecords } from '../../db/views/service-view.js';
import { eventBus } from '../../events/index.js';
import { classifyDeployError } from '../../pipeline/error-classifier.js';
import { scanRepoEnvVars } from '../../pipeline/env-scan.js';
import { cloneRepo } from '../../pipeline/git.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

type TerminalFailureInput = {
  step: 'deploy-start' | 'monorepo' | 'orchestrate';
  failedStep: string;
  error: string;
  /**
   * 16-key ErrorClass union value from `classifyDeployError`. Forwarded
   * onto the `deploy:failed` event payload so the SSE log-stream can
   * surface it on the terminal `event: end` for v4 ErrorSurface.
   * Phase E_NEW.
   */
  errorClass?: string;
};

export type PlanExecutionDeps = {
  ctx: AppContext;
  projectId: string;
  projectName: string;
  isKorean: boolean;
  repoUrl: string;
  branch?: string;
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share';
  environment?: string;
  sshKeyPath: string | null;
  trigger: string;
  write: (message: string) => Promise<void>;
  source?: 'git' | 'image';
  imageUrl?: string;
  imageCmd?: string[];
  containerPort?: number;
};

export type FailureHandlerDeps = {
  ctx: AppContext;
  projectId: string;
  projectName: string;
  isKorean: boolean;
  write: (message: string) => Promise<void>;
  startPlanExecution: () => Promise<void>;
};

export async function startPlanExecution(deps: PlanExecutionDeps): Promise<void> {
  await deps.write(deps.isKorean ? '배포 계획 생성 중...' : 'Creating deployment plan...');

  const plan = await deps.ctx.planEngine.createPlan({
    repoUrl: deps.repoUrl,
    branch: deps.branch,
    name: deps.projectName,
    envVars: deps.envVars,
    visibility: deps.visibility,
    environment: 'production',
    sshKeyPath: deps.sshKeyPath || undefined,
    trigger: deps.trigger,
    source: deps.source,
    imageUrl: deps.imageUrl,
    imageCmd: deps.imageCmd,
    containerPort: deps.containerPort,
  });

  await deps.write(deps.isKorean ? '배포 계획 실행 중...' : 'Executing deployment plan...');

  const executionResult = await deps.ctx.planEngine.executePlan(plan.plan_id);
  if (executionResult.status === 'failed') {
    throw new Error(executionResult.error ?? 'Plan execution failed');
  }
}

export async function handleTerminalFailure(
  deps: FailureHandlerDeps,
  input: TerminalFailureInput,
  state: { hasRetriedAfterTerminalFailure: boolean },
): Promise<void> {
  if (!deps.ctx.buildDebugger) {
    await eventBus.emit('deploy:failed', {
      projectId: deps.projectId,
      step: input.step,
      error: input.error,
      errorClass: input.errorClass,
    });
    return;
  }

  await deps.write(
    deps.isKorean
      ? '실패 원인과 다음 조치를 정리합니다...'
      : 'Summarizing the failure root cause and next steps...',
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
    const existing = await deps.ctx.db.getProjectByName(deps.projectName);
    diagnosis = await deps.ctx.buildDebugger.diagnose({
      buildLog: input.error,
      projectName: deps.projectName,
      imageTag: existing?.image_tag ?? `openlander/${deps.projectName}:latest`,
      failedStep: input.failedStep,
    });
  } catch (diagnoseErr) {
    const diagnoseMsg = diagnoseErr instanceof Error ? diagnoseErr.message : String(diagnoseErr);
    await deps.write(
      deps.isKorean ? `실패 분석 실패: ${diagnoseMsg}` : `Failure analysis failed: ${diagnoseMsg}`,
    );
    await eventBus.emit('deploy:failed', {
      projectId: deps.projectId,
      step: input.step,
      error: input.error,
      errorClass: input.errorClass,
    });
    return;
  }

  await deps.write(deps.isKorean ? `요약: ${diagnosis.summary}` : `Summary: ${diagnosis.summary}`);
  await deps.write(
    deps.isKorean ? `근본 원인: ${diagnosis.rootCause}` : `Root cause: ${diagnosis.rootCause}`,
  );

  const topFixes = diagnosis.suggestedFixes.slice(0, 3);
  if (topFixes.length > 0) {
    await deps.write(deps.isKorean ? '추천 조치:' : 'Suggested fixes:');
    for (const [index, fix] of topFixes.entries()) {
      const locationText = fix.location ? ` (${fix.location})` : '';
      await deps.write(`  ${String(index + 1)}. ${fix.description}${locationText}`);
    }
  }

  const retryLabel = deps.isKorean ? '지금 배포 재시도' : 'Retry deployment now';
  const cancelLabel = deps.isKorean ? '취소' : 'Cancel';
  const manualFixLabelPrefix = deps.isKorean ? '수동 조치' : 'Manual follow-up';
  const suggestedFixOptions = topFixes.map((fix, index) => {
    const confidenceText = deps.isKorean
      ? `신뢰도 ${fix.confidence}`
      : `Confidence ${fix.confidence}`;
    const locationText = fix.location
      ? deps.isKorean
        ? `위치: ${fix.location}`
        : `Location: ${fix.location}`
      : deps.isKorean
        ? '위치 정보 없음'
        : 'No location provided';

    return {
      label: `${manualFixLabelPrefix} ${String(index + 1)}`,
      description: `${fix.description} (${confidenceText}; ${locationText})`,
      fix,
    };
  });
  const manualFixByLabel = new Map(suggestedFixOptions.map((option) => [option.label, option.fix]));

  let answers: Array<{ selectedLabels: string[] }> | null = null;
  try {
    answers = await deps.ctx.questionBridge.ask({
      id: nanoid(12),
      questions: [
        {
          header: deps.isKorean ? '배포 복구 선택' : 'Deployment Recovery',
          question: deps.isKorean ? '다음으로 어떤 작업을 진행할까요?' : 'What should we do next?',
          options: [
            {
              label: retryLabel,
              description: deps.isKorean
                ? '동일 설정으로 결정론적 배포 시작을 한 번 더 실행합니다.'
                : 'Retry deterministic deploy startup once with the same settings.',
            },
            ...suggestedFixOptions.map((option) => ({
              label: option.label,
              description: option.description,
            })),
            {
              label: cancelLabel,
              description: deps.isKorean
                ? '현재 실패 상태를 유지하고 배포를 종료합니다.'
                : 'Keep the current failed state and stop here.',
            },
          ],
          multiple: false,
          metadata: {
            questionType: 'deterministic_terminal_failure_recovery',
            projectId: deps.projectId,
            failedStep: input.failedStep,
          },
        },
      ],
    });
  } catch (askErr) {
    const askMsg = askErr instanceof Error ? askErr.message : String(askErr);
    await deps.write(
      deps.isKorean
        ? `사용자 응답 대기 중 오류가 발생해 배포를 종료합니다: ${askMsg}`
        : `Stopping deploy because user input failed: ${askMsg}`,
    );
    await eventBus.emit('deploy:failed', {
      projectId: deps.projectId,
      step: input.step,
      error: input.error,
      errorClass: input.errorClass,
    });
    return;
  }

  const selectedLabels = answers[0]?.selectedLabels ?? [];
  if (selectedLabels.includes(retryLabel) && !state.hasRetriedAfterTerminalFailure) {
    state.hasRetriedAfterTerminalFailure = true;
    await deps.write(
      deps.isKorean
        ? '사용자 선택: 배포를 결정론적으로 다시 시작합니다.'
        : 'User selected retry. Restarting deterministic deployment startup.',
    );

    void deps.startPlanExecution().catch(async (retryErr: unknown) => {
      const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
      await deps.write(
        deps.isKorean
          ? `❌ 재시도 배포 시작 실패: ${retryErrMsg}`
          : `❌ Failed to start retry deployment: ${retryErrMsg}`,
      );
      // Re-classify the retry's error — the retry may surface a different
      // failure mode than the original (e.g., transient network blip on
      // first attempt → CONFIG_MISSING on retry).
      const retryErrorClass = classifyDeployError(retryErr);
      await eventBus.emit('deploy:failed', {
        projectId: deps.projectId,
        step: 'deploy-start',
        error: retryErrMsg,
        errorClass: retryErrorClass,
      });
    });

    return;
  }

  if (selectedLabels.includes(retryLabel) && state.hasRetriedAfterTerminalFailure) {
    await deps.write(
      deps.isKorean
        ? '이미 한 번 재시도했기 때문에 추가 자동 재시도는 건너뜁니다.'
        : 'Retry was already attempted once. Skipping additional automatic retry.',
    );
  } else {
    const selectedManualFixLabel = selectedLabels.find((label) => manualFixByLabel.has(label));
    if (selectedManualFixLabel) {
      const selectedManualFix = manualFixByLabel.get(selectedManualFixLabel);
      if (selectedManualFix) {
        await deps.write(
          deps.isKorean
            ? `사용자 선택: 제안 ${selectedManualFixLabel}은(는) 자동 적용하지 않습니다. 수동 조치가 필요합니다.`
            : `User selected ${selectedManualFixLabel}. OpenLander will not auto-apply this fix; manual follow-up is required.`,
        );

        await deps.ctx.db.updateProject(deps.projectId, { status: 'error' });
        await eventBus.emit('deploy:needs-user-action', {
          projectId: deps.projectId,
          category: 'manual_followup_required',
          title: deps.isKorean ? '수동 조치 필요' : 'Manual fix required',
          description: deps.isKorean
            ? `다음 제안은 자동 적용되지 않았습니다: ${selectedManualFix.description}`
            : `This suggested fix was not auto-applied: ${selectedManualFix.description}`,
          userSteps: [
            {
              label: selectedManualFix.description,
            },
            {
              label: deps.isKorean
                ? '수동 조치 완료 후 배포를 다시 시도하세요.'
                : 'After completing the manual fix, retry deployment.',
            },
          ],
        });
        return;
      }
    }

    await deps.write(
      deps.isKorean ? '사용자 선택: 배포를 취소합니다.' : 'User selected cancel. Stopping deploy.',
    );
  }

  await eventBus.emit('deploy:failed', {
    projectId: deps.projectId,
    step: input.step,
    error: input.error,
    errorClass: input.errorClass,
  });
}

export async function emitTerminalMessage(
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

export function registerBuildProgressRoute(api: Hono, ctx: AppContext): void {
  api.get('/builds/:id/progress', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const unsubscribers: Array<() => void> = [];
    const progressHandlers: Array<{ event: string; payload: Record<string, unknown> }> = [
      {
        event: 'deploy:start',
        payload: { percent: 0, step: 'Starting deployment...', stepName: 'Preparing' },
      },
      {
        event: 'deploy:clone',
        payload: { percent: 15, step: 'Cloning repository...', stepName: 'Clone' },
      },
      {
        event: 'deploy:build',
        payload: { percent: 60, step: 'Building Docker image...', stepName: 'Build' },
      },
      {
        event: 'deploy:run',
        payload: { percent: 85, step: 'Starting container...', stepName: 'Start' },
      },
      {
        event: 'monitor:healthcheck',
        payload: { percent: 95, step: 'Running health checks...', stepName: 'Health Check' },
      },
    ];

    return stream(c, async (s) => {
      c.header('Content-Type', 'application/x-ndjson');

      for (const handler of progressHandlers) {
        unsubscribers.push(
          eventBus.on(handler.event as never, (payload: { projectId: string }) => {
            if (payload.projectId !== project.id) return;
            void s.write(`${JSON.stringify(handler.payload)}\n`);
          }),
        );
      }

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            `${JSON.stringify({ percent: 100, step: 'Complete', stepName: 'Complete' })}\n`,
          );
          void s.close();
        }),
      );
      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            `${JSON.stringify({
              percent: -1,
              step: payload.cancelled === true ? 'Cancelled' : 'Failed',
              error: payload.error,
              outcome: payload.cancelled === true ? 'cancelled' : 'fail',
            })}\n`,
          );
          void s.close();
        }),
      );
      unsubscribers.push(
        eventBus.on('deploy:needs-user-action', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            `${JSON.stringify({ percent: -1, step: 'User action required', error: payload.title, detail: payload.description, userSteps: payload.userSteps })}\n`,
          );
          void s.close();
        }),
      );

      s.onAbort(() => {
        for (const unsub of unsubscribers) unsub();
      });

      await Promise.resolve();
    });
  });
}

export function registerEnvScanRoutes(api: Hono, ctx: AppContext): void {
  api.post('/env/scan', async (c) => {
    const body = await c.req.json<{ repo_url: string; branch?: string }>();
    if (!body.repo_url) return c.json({ error: 'repo_url is required' }, 400);

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({ repoUrl: body.repo_url, branch: body.branch });
      clonePath = cloneResult.path;
      return c.json(scanRepoEnvVars(clonePath));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  api.post('/projects/:id/env/scan', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const serviceRecords = await loadServiceViewRecords(ctx.db, [project]);
    const deployable = serviceRecords.get(project.id)?.service;
    if (!deployable?.repo_url) {
      return c.json({ error: 'SERVICE_SOURCE_MISSING', code: 'SERVICE_SOURCE_MISSING' }, 400);
    }

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({
        repoUrl: deployable.repo_url,
        branch: deployable.branch ?? undefined,
      });
      clonePath = cloneResult.path;
      // PR 4 canonical-first: dockerfile_path on the deployable services
      // row supersedes the legacy projects column post-0012.
      const dockerfilePath = deployable.dockerfile_path ?? project.dockerfile_path;
      const scanResult = scanRepoEnvVars(clonePath, {
        dockerfilePath: dockerfilePath ?? undefined,
      });

      const allStoredKeys = new Set<string>();
      for (const key of Object.keys(ctx.env.getAll(project.id))) allStoredKeys.add(key);
      for (const key of Object.keys(ctx.env.getGlobalSecrets())) allStoredKeys.add(key);
      for (const env of await ctx.db.getEnvironmentsByProject(project.id)) {
        for (const key of Object.keys(ctx.env.getAll(project.id, env.id))) allStoredKeys.add(key);
      }

      const vars = scanResult.vars;
      const newVars = vars.filter((v) => !allStoredKeys.has(v.key) && !v.optional);
      const existingVars = vars.filter((v) => allStoredKeys.has(v.key)).map((v) => v.key);

      return c.json({ vars, newVars, existingVars, hasEnvExample: scanResult.hasEnvExample });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
