import { Hono } from 'hono';
import { rm } from 'node:fs/promises';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AppContext } from '../../app.js';
import { PreflightCheckError, ProjectNotFoundError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { extractProjectName } from '../../pipeline/helpers.js';
import { preflightCheckOrThrow } from '../../pipeline/preflight.js';
import { generatePostDeployInsights } from '../../pipeline/post-deploy-insight.js';
import type { ProjectRow } from '../../db/types.js';

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

/**
 * Scan a cloned repository to detect its shape:
 * - Dockerfiles at various depths
 * - docker-compose files at root
 * Returns structured info for deploy mode classification.
 */
interface RepoShape {
  dockerfiles: string[];
  composeFiles: string[];
  hasRootDockerfile: boolean;
  hasRootCompose: boolean;
}

function scanRepoShape(clonePath: string): RepoShape {
  const dockerfiles: string[] = [];
  const composeFiles: string[] = [];

  // Scan for Dockerfiles (depth <= 3)
  function walkForDockerfiles(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === 'Dockerfile') {
          dockerfiles.push(fullPath);
        } else if (stat.isDirectory()) {
          walkForDockerfiles(fullPath, depth + 1);
        }
      } catch {
        continue;
      }
    }
  }

  walkForDockerfiles(clonePath, 0);

  // Scan for compose files at root
  const composeFilenames = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ];
  for (const filename of composeFilenames) {
    const candidatePath = join(clonePath, filename);
    try {
      if (statSync(candidatePath).isFile()) {
        composeFiles.push(candidatePath);
      }
    } catch {
      continue;
    }
  }

  const hasRootDockerfile = dockerfiles.some((df) => df === join(clonePath, 'Dockerfile'));
  const hasRootCompose = composeFiles.length > 0;

  return {
    dockerfiles,
    composeFiles,
    hasRootDockerfile,
    hasRootCompose,
  };
}

/**
 * Classify the deploy mode based on repo shape.
 * Returns one of: 'compose' | 'monorepo' | 'single'
 */
interface DeployModeResult {
  mode: 'compose' | 'monorepo' | 'single';
  reason: string;
  dockerfileCount: number;
  composeFileCount: number;
}

interface ServiceSelectionOption {
  label: string;
  description: string;
  dockerfile: string;
  serviceName: string;
}

function buildServiceSelectionOptions(dockerfiles: string[]): ServiceSelectionOption[] {
  return dockerfiles.map((dockerfilePath) => {
    const serviceName =
      dockerfilePath === 'Dockerfile' ? 'root' : dockerfilePath.replace(/\/Dockerfile$/, '');
    const label = `${serviceName} (${dockerfilePath})`;
    return {
      label,
      description: `Deploy only ${serviceName} from ${dockerfilePath}`,
      dockerfile: dockerfilePath,
      serviceName,
    };
  });
}

function classifyDeployMode(shape: RepoShape): DeployModeResult {
  const dockerfileCount = shape.dockerfiles.length;
  const composeFileCount = shape.composeFiles.length;

  // Compose mode: has docker-compose file(s) at root
  if (composeFileCount > 0) {
    return {
      mode: 'compose',
      reason: `Found ${String(composeFileCount)} compose file(s) at root`,
      dockerfileCount,
      composeFileCount,
    };
  }

  // Monorepo mode: multiple Dockerfiles at different depths
  if (dockerfileCount > 1) {
    return {
      mode: 'monorepo',
      reason: `Found ${String(dockerfileCount)} Dockerfiles at different paths`,
      dockerfileCount,
      composeFileCount,
    };
  }

  // Single mode: one Dockerfile (or none, will auto-generate)
  return {
    mode: 'single',
    reason:
      dockerfileCount === 1 ? 'Single Dockerfile at root or subdirectory' : 'No Dockerfile found',
    dockerfileCount,
    composeFileCount,
  };
}

// Mark helpers as used for Task 2 consumption (no-op at runtime)
void [emitTerminalMessage, scanRepoShape, classifyDeployMode];

const ENV_STYLE_KEYS = new Set(['envvars', 'environmentvariables']);
const SECRET_FIELD_PATTERN =
  /(password|secret|token|credential|api[_-]?key|private[_-]?key|ssh[_-]?key|access[_-]?key|auth[_-]?token)/i;

function normalizeSecretKeyName(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

function isEnvStyleKey(key: string): boolean {
  return ENV_STYLE_KEYS.has(normalizeSecretKeyName(key));
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_FIELD_PATTERN.test(normalized);
}

function sanitizeToolResultForStream(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultForStream(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(source)) {
    if (isEnvStyleKey(key)) {
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        const maskedEnv: Record<string, string> = {};
        for (const envKey of Object.keys(nestedValue as Record<string, unknown>)) {
          maskedEnv[envKey] = '***';
        }
        sanitized[key] = maskedEnv;
      } else {
        sanitized[key] = '***';
      }
      continue;
    }

    if (isSecretLikeKey(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }

    sanitized[key] = sanitizeToolResultForStream(nestedValue);
  }

  return sanitized;
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

          void ctx.pipeline
            .deploy({
              repoUrl: body.repo_url,
              branch: body.branch,
              name: projectName,
              envVars: body.env_vars,
              visibility: body.visibility,
              sshKeyPath: ctx.config.git.sshKeyPath || undefined,
              trigger: 'api',
              environment: body.environment,
              _projectId: projectId,
            })
            .catch(async (retryErr: unknown) => {
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
        await emitTerminalMessage(
          projectId,
          isKorean
            ? '저장소 복제 및 구조 분석 중...'
            : 'Cloning repository and scanning project shape...',
          isKorean,
        );

        const cloneResult = await cloneRepo({
          repoUrl: body.repo_url,
          branch: body.branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        const shape = scanRepoShape(cloneResult.path);

        await emitTerminalMessage(
          projectId,
          isKorean ? '배포 모드 분류 중...' : 'Classifying deploy mode...',
          isKorean,
        );
        const deployMode = classifyDeployMode(shape);
        const dockerfiles = shape.dockerfiles.map((dockerfilePath) =>
          dockerfilePath.startsWith(`${cloneResult.path}/`)
            ? dockerfilePath.slice(cloneResult.path.length + 1)
            : dockerfilePath,
        );

        await emitTerminalMessage(
          projectId,
          isKorean
            ? `배포 전략 확정: ${deployMode.mode} (${deployMode.reason})`
            : `Deploy strategy selected: ${deployMode.mode} (${deployMode.reason})`,
          isKorean,
        );

        const startSingleDeploy = async (isFallback: boolean): Promise<void> => {
          if (isFallback) {
            await emitTerminalMessage(
              projectId,
              isKorean
                ? 'Compose/모노레포 배포를 시작하지 못해 단일 서비스 배포로 폴백합니다...'
                : 'Compose/monorepo could not start deployment. Falling back to single-service deploy...',
              isKorean,
            );
          }

          await emitTerminalMessage(
            projectId,
            isKorean ? '단일 서비스 배포를 시작합니다...' : 'Starting single-service deploy...',
            isKorean,
          );

          void ctx.pipeline
            .deploy({
              repoUrl: body.repo_url,
              branch: body.branch,
              name: projectName,
              envVars: body.env_vars,
              visibility: body.visibility,
              sshKeyPath: ctx.config.git.sshKeyPath || undefined,
              trigger: 'api',
              environment: body.environment,
              _projectId: projectId,
            })
            .catch(async (err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              await emitTerminalMessage(
                projectId,
                isKorean ? `❌ 배포 시작 실패: ${errMsg}` : `❌ Failed to start deploy: ${errMsg}`,
                isKorean,
              );
              await handleTerminalFailure({
                step: 'deploy-start',
                failedStep: 'deploy_start',
                error: errMsg,
              });
            });
        };

        const startMonorepoDeploy = async (isFallback: boolean): Promise<void> => {
          if (isFallback) {
            await emitTerminalMessage(
              projectId,
              isKorean
                ? 'Compose 배포가 시작되지 않아 모노레포 배포로 폴백합니다...'
                : 'Compose deploy failed before startup. Falling back to monorepo deploy...',
              isKorean,
            );
          }

          const allServicesLabel = isKorean ? '모든 서비스 배포' : 'Deploy all services';
          const serviceSelectionOptions = buildServiceSelectionOptions(dockerfiles);

          await emitTerminalMessage(
            projectId,
            isKorean
              ? `여러 서비스(${String(dockerfiles.length)}개)가 감지되어 배포 대상을 선택해야 합니다.`
              : `Detected ${String(dockerfiles.length)} services. Please choose what to deploy.`,
            isKorean,
          );

          const answers = await ctx.questionBridge.ask({
            id: nanoid(12),
            questions: [
              {
                header: isKorean ? '서비스 선택' : 'Service Selection',
                question: isKorean
                  ? '이번 배포에서 어떤 서비스를 배포할까요?'
                  : 'Which services should be deployed in this run?',
                options: [
                  {
                    label: allServicesLabel,
                    description: isKorean
                      ? `${String(dockerfiles.length)}개 서비스를 모두 배포합니다.`
                      : `Deploy all ${String(dockerfiles.length)} detected services.`,
                  },
                  ...serviceSelectionOptions.map((option) => ({
                    label: option.label,
                    description: option.description,
                  })),
                ],
                multiple: false,
                metadata: {
                  questionType: 'deterministic_service_selection',
                  projectId,
                  dockerfileByLabel: Object.fromEntries(
                    serviceSelectionOptions.map((option) => [option.label, option.dockerfile]),
                  ),
                },
              },
            ],
          });

          const selectedLabels = answers[0]?.selectedLabels ?? [];
          if (selectedLabels.length === 0) {
            await emitTerminalMessage(
              projectId,
              isKorean
                ? '❌ 서비스 선택이 없어 배포를 중단합니다. 선택 후 다시 시도해주세요.'
                : '❌ Deployment cancelled: no services were selected. Please choose a service and retry.',
              isKorean,
            );
            ctx.db.updateProject(projectId, { status: 'error' });
            await eventBus.emit('deploy:needs-user-action', {
              projectId,
              category: 'selection_required',
              title: isKorean ? '서비스 선택 필요' : 'Service selection required',
              description: isKorean
                ? '모노레포 배포를 시작하려면 배포할 서비스를 선택해야 합니다.'
                : 'Select at least one service to start this monorepo deployment.',
              userSteps: [
                {
                  label: isKorean
                    ? '다시 배포하고 서비스 선택하기'
                    : 'Retry deployment and select a service',
                },
              ],
            });
            return;
          }

          const selectedDockerfiles = selectedLabels.includes(allServicesLabel)
            ? dockerfiles
            : serviceSelectionOptions
                .filter((option) => selectedLabels.includes(option.label))
                .map((option) => option.dockerfile);

          if (selectedDockerfiles.length === 0) {
            await emitTerminalMessage(
              projectId,
              isKorean
                ? '❌ 선택한 서비스가 유효하지 않아 배포를 중단합니다.'
                : '❌ Deployment cancelled: selected service is invalid.',
              isKorean,
            );
            ctx.db.updateProject(projectId, { status: 'error' });
            await eventBus.emit('deploy:needs-user-action', {
              projectId,
              category: 'selection_invalid',
              title: isKorean ? '서비스 선택 확인 필요' : 'Service selection needs confirmation',
              description: isKorean
                ? '선택한 항목을 현재 저장소 서비스로 매핑하지 못했습니다.'
                : 'Could not map your selection to detected services in this repository.',
              userSteps: [
                {
                  label: isKorean
                    ? '다시 배포하고 서비스 재선택하기'
                    : 'Retry deployment and choose a listed service',
                },
              ],
            });
            return;
          }

          const selectedServiceNames = selectedLabels.includes(allServicesLabel)
            ? ['all services']
            : serviceSelectionOptions
                .filter((option) => selectedDockerfiles.includes(option.dockerfile))
                .map((option) => option.serviceName);

          await emitTerminalMessage(
            projectId,
            isKorean
              ? `선택 완료: ${selectedServiceNames.join(', ')} 서비스 배포를 시작합니다.`
              : `Selection confirmed: deploying ${selectedServiceNames.join(', ')}.`,
            isKorean,
          );

          await emitTerminalMessage(
            projectId,
            isKorean ? '모노레포 배포를 시작합니다...' : 'Starting monorepo deploy...',
            isKorean,
          );

          void ctx.pipeline
            .deployMonorepo({
              repoUrl: body.repo_url,
              branch: body.branch,
              clonePath: cloneResult.path,
              commitSha: cloneResult.commitSha,
              dockerfiles: selectedDockerfiles,
              envVars: body.env_vars,
              visibility: body.visibility,
              trigger: 'api',
              name: projectName,
              _parentId: projectId,
            })
            .catch(async (err: unknown) => {
              const errMsg = err instanceof Error ? err.message : String(err);
              await emitTerminalMessage(
                projectId,
                isKorean
                  ? `❌ 모노레포 배포 시작 실패: ${errMsg}`
                  : `❌ Failed to start monorepo deploy: ${errMsg}`,
                isKorean,
              );
              await handleTerminalFailure({
                step: 'monorepo',
                failedStep: 'monorepo_start',
                error: errMsg,
              });
            });
        };

        if (deployMode.mode === 'compose') {
          const composePath = shape.composeFiles[0];
          let composeError: string | null = null;

          if (!composePath) {
            composeError = 'Compose mode selected but no compose file found';
          } else {
            await emitTerminalMessage(
              projectId,
              isKorean ? 'Compose 배포를 시작합니다...' : 'Starting compose deploy...',
              isKorean,
            );

            try {
              const composeResult = await ctx.composePipeline.deployCompose({
                repoUrl: body.repo_url,
                branch: body.branch,
                clonePath: cloneResult.path,
                composePath,
                name: projectName,
                envVars: body.env_vars,
                trigger: 'api',
                _parentId: projectId,
              });

              if (composeResult.success) {
                return;
              }

              composeError = composeResult.error ?? 'Compose deploy failed before startup';
            } catch (err) {
              composeError = err instanceof Error ? err.message : String(err);
            }
          }

          await emitTerminalMessage(
            projectId,
            isKorean
              ? `❌ Compose 배포 실패: ${composeError}`
              : `❌ Compose deploy failed: ${composeError}`,
            isKorean,
          );

          if (dockerfiles.length > 1) {
            await emitTerminalMessage(
              projectId,
              isKorean
                ? 'Compose 실패로 인해 모노레포 폴백을 시도합니다.'
                : 'Compose failed before deployment startup. Attempting monorepo fallback.',
              isKorean,
            );
            await startMonorepoDeploy(true);
            return;
          }

          await emitTerminalMessage(
            projectId,
            isKorean
              ? '모노레포 조건이 충족되지 않아 단일 서비스 폴백을 시도합니다.'
              : 'Monorepo fallback not applicable. Attempting single-service fallback.',
            isKorean,
          );
          await startSingleDeploy(true);
          return;
        }

        if (deployMode.mode === 'monorepo') {
          await startMonorepoDeploy(false);
          return;
        }

        await startSingleDeploy(false);
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
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    const result = await ctx.pipeline.startDeploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      name: body.name,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
      trigger: 'api',
      environment: body.environment,
    });

    return c.json(result, 200);
  });

  api.get('/projects/:id/timeline', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const events = ctx.db.getTimelineEvents(project.id).reverse();

    return c.json({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        detail: event.detail,
        severity: event.severity,
        percent: event.percent,
        toolName: event.tool_name,
        actionButtons: (() => {
          if (!event.action_buttons) return undefined;
          try {
            return JSON.parse(event.action_buttons) as unknown;
          } catch (err) {
            void err;
            return undefined;
          }
        })(),
        projectId: event.project_id,
        timestamp: event.created_at,
      })),
    });
  });

  api.get('/projects/:id/build/stream', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const unsubscribers: Array<() => void> = [];

    return stream(c, async (s) => {
      c.header('Content-Type', 'application/x-ndjson');

      const cleanup = () => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      };

      const childProjectCache = new Map<string, ProjectRow | null>();

      const resolveScopedProject = (
        sourceProjectId: string,
        explicitScope?: unknown,
        explicitParentProjectId?: unknown,
      ): { scope: string; sourceProjectId: string; isChild: boolean } | null => {
        if (sourceProjectId === project.id) {
          const scope =
            typeof explicitScope === 'string' && explicitScope.trim().length > 0
              ? explicitScope
              : 'project';
          return { scope, sourceProjectId, isChild: false };
        }

        if (explicitParentProjectId === project.id) {
          const scope =
            typeof explicitScope === 'string' && explicitScope.trim().length > 0
              ? explicitScope
              : sourceProjectId;
          return { scope, sourceProjectId, isChild: true };
        }

        if (!childProjectCache.has(sourceProjectId)) {
          childProjectCache.set(sourceProjectId, ctx.db.getProject(sourceProjectId) ?? null);
        }

        const childProject = childProjectCache.get(sourceProjectId);
        if (!childProject || childProject.parent_project_id !== project.id) {
          return null;
        }

        const inferredScope =
          childProject.name.startsWith(`${project.name}/`) &&
          childProject.name.length > `${project.name}/`.length
            ? childProject.name.slice(project.name.length + 1)
            : childProject.name;
        const scope =
          typeof explicitScope === 'string' && explicitScope.trim().length > 0
            ? explicitScope
            : inferredScope;

        return { scope, sourceProjectId, isChild: true };
      };

      const write = (data: {
        type: string;
        message: string;
        projectId: string;
        id?: string;
        timestamp?: string;
        percent?: number;
        detail?: string | null;
        severity?: 'info' | 'warning' | 'error';
        toolName?: string;
        actionButtons?: unknown;
        [key: string]: unknown;
      }) => {
        void s.write(
          JSON.stringify({
            ...data,
            timestamp: data.timestamp ?? new Date().toISOString(),
          }) + '\n',
        );
      };

      const emitTimelineEvent = (data: {
        id?: string;
        type: string;
        message: string;
        projectId: string;
        timestamp?: string;
        detail?: string | null;
        severity?: 'info' | 'warning' | 'error';
        percent?: number;
        toolName?: string;
        actionButtons?: unknown;
        deployId?: string;
        [key: string]: unknown;
      }) => {
        const eventId = data.id ?? nanoid(16);
        const eventTimestamp = data.timestamp ?? new Date().toISOString();

        ctx.db.createTimelineEvent({
          id: eventId,
          projectId: data.projectId,
          deployId: data.deployId,
          type: data.type,
          message: data.message,
          detail: typeof data.detail === 'string' ? data.detail : undefined,
          severity: data.severity,
          percent: data.percent,
          toolName: data.toolName,
          actionButtons: data.actionButtons ? JSON.stringify(data.actionButtons) : undefined,
          createdAt: eventTimestamp,
        });

        write({
          ...data,
          id: eventId,
          timestamp: eventTimestamp,
        });
      };

      function formatRelativeTime(dateStr: string): string {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return `${String(diffSec)}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${String(diffMin)}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${String(diffHr)}h ago`;
        const diffDay = Math.floor(diffHr / 24);
        return `${String(diffDay)}d ago`;
      }

      unsubscribers.push(
        eventBus.on('deploy:start', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          emitTimelineEvent({
            type: scoped.isChild ? 'log' : 'status',
            message: payload.message ?? 'Starting deployment...',
            projectId: project.id,
            percent: scoped.isChild ? undefined : 0,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          emitTimelineEvent({
            type: scoped.isChild ? 'log' : 'status',
            message: payload.message ?? `Cloning repository (${payload.commitSha.slice(0, 7)})`,
            projectId: project.id,
            percent: scoped.isChild ? undefined : 15,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          emitTimelineEvent({
            type: scoped.isChild ? 'log' : 'status',
            message:
              payload.message ??
              `Docker image built (${String(Math.round(payload.durationMs / 1000))}s)`,
            projectId: project.id,
            percent: scoped.isChild ? undefined : 60,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            durationMs: payload.durationMs,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          emitTimelineEvent({
            type: scoped.isChild ? 'log' : 'status',
            message: payload.message ?? `Starting container on port ${String(payload.port)}`,
            projectId: project.id,
            percent: scoped.isChild ? undefined : 90,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;

          if (scoped.isChild) {
            emitTimelineEvent({
              type: 'log',
              message:
                payload.message ??
                `Service complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
              projectId: project.id,
              phase: payload.phase,
              scope: scoped.scope,
              status: payload.status,
              durationMs: payload.totalDurationMs,
              sourceProjectId: scoped.sourceProjectId,
            });
            return;
          }

          // Generate post-deploy insights before sending complete event
          void (async () => {
            try {
              const insights = await generatePostDeployInsights(
                {
                  projectId: payload.projectId,
                  totalDurationMs: payload.totalDurationMs,
                  url: payload.url,
                },
                ctx.docker,
                ctx.db,
                ctx.config.language,
              );

              // Send each insight as an NDJSON event
              for (const insight of insights) {
                emitTimelineEvent({
                  type: 'insight',
                  message: insight.title,
                  detail: insight.detail ?? null,
                  severity: insight.severity,
                  actionButtons: insight.actions.length > 0 ? insight.actions : undefined,
                  projectId: project.id,
                });
              }
            } catch (err) {
              log.warn({ err }, 'Post-deploy insight generation failed');
            }

            // Send complete event and close stream
            emitTimelineEvent({
              type: 'complete',
              message:
                payload.message ??
                `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
              projectId: project.id,
              percent: 100,
              phase: payload.phase,
              scope: scoped.scope,
              status: payload.status,
              durationMs: payload.totalDurationMs,
              sourceProjectId: scoped.sourceProjectId,
            });
            clearTimeout(streamTimeout);
            cleanup();
            void s.close();
          })();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          emitTimelineEvent({
            type: 'error',
            message: payload.message ?? `Deploy failed at ${payload.step}: ${payload.error}`,
            detail: payload.buildLog ?? null,
            projectId: project.id,
            percent: -1,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            durationMs: payload.durationMs,
            sourceProjectId: scoped.sourceProjectId,
          });
          // Do NOT close stream — auto-recovery may follow
        }),
      );

      // Build recovery events → show autofix/suggestion in timeline
      unsubscribers.push(
        eventBus.on('build:autofix', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Auto-fix applied: ${payload.action} (${payload.category})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:suggest', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Suggestion: ${payload.suggestion}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:inform', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Build analysis: ${payload.summary}`,
            projectId: project.id,
          });
        }),
      );

      // Dockerfile fix events → dockerfile_fixed in NDJSON stream
      unsubscribers.push(
        eventBus.on('build:dockerfile-fixed', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Dockerfile fixed (attempt ${String(payload.retryCount)}/3): ${payload.changes.join(', ')}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:needs-user-action', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'error',
            message: payload.title,
            detail: payload.description,
            projectId: project.id,
          });
        }),
      );

      // Compose lifecycle events
      unsubscribers.push(
        eventBus.on('compose:start', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Compose build starting (${String(payload.serviceCount)} service${payload.serviceCount > 1 ? 's' : ''})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:up', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'complete',
            message: `Compose deploy complete — ${String(payload.services.length)} service${payload.services.length > 1 ? 's' : ''} running`,
            projectId: project.id,
          });
          cleanup();
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'error',
            message: `Compose deploy failed: ${payload.error}`,
            projectId: project.id,
          });
          // Do NOT close stream — auto-recovery may follow
        }),
      );

      unsubscribers.push(
        eventBus.on('agent:event', (payload) => {
          if (payload.projectId !== project.id) return;
          const ev = payload.event;
          const base = { projectId: project.id, timestamp: ev.timestamp };

          switch (ev.type) {
            case 'thinking':
              emitTimelineEvent({
                ...base,
                type: 'agent_thinking',
                message: 'Agent is analyzing...',
              });
              break;
            case 'tool_call':
              emitTimelineEvent({
                ...base,
                type: 'agent_tool_call',
                message: `Calling ${ev.toolName}...`,
                toolName: ev.toolName,
                toolArguments: ev.arguments,
              });
              break;
            case 'tool_result':
              emitTimelineEvent({
                ...base,
                type: 'agent_tool_result',
                message: ev.success
                  ? `${ev.toolName} completed`
                  : `${ev.toolName} failed: ${ev.error ?? 'unknown'}`,
                toolName: ev.toolName,
                toolResult: ev.result === undefined ? null : sanitizeToolResultForStream(ev.result),
                toolSuccess: ev.success,
                toolError: ev.error ?? null,
              });
              break;
            case 'message':
              emitTimelineEvent({ ...base, type: 'agent_message', message: ev.content });
              break;
            case 'error':
              emitTimelineEvent({ ...base, type: 'error', message: ev.error || 'Agent error' });
              break;
            default:
              emitTimelineEvent({ ...base, type: 'status', message: `Agent: ${ev.type}` });
          }
        }),
      );

      // Agent question events → question_pending in NDJSON stream
      unsubscribers.push(
        eventBus.on('question:pending', (payload) => {
          if (payload.projectId !== project.id) return;
          const firstQuestion = payload.questions[0];
          emitTimelineEvent({
            id: payload.requestId,
            type: 'question_pending',
            message: firstQuestion?.question ?? 'Agent needs input',
            questionId: payload.requestId,
            questions: payload.questions,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:output', (payload) => {
          const scoped = resolveScopedProject(
            payload.projectId,
            payload.scope,
            payload.parentProjectId,
          );
          if (!scoped) return;
          write({
            type: 'log',
            message: payload.message ?? payload.line,
            projectId: project.id,
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            durationMs: payload.durationMs,
            logChunk: payload.logChunk ?? payload.line,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      // Auto-close stream after 5 min timeout (safety net for auto-recovery)
      const streamTimeout = setTimeout(
        () => {
          cleanup();
          void s.close();
        },
        5 * 60 * 1000,
      );

      s.onAbort(() => {
        clearTimeout(streamTimeout);
        cleanup();
      });

      // Emit initial status based on current project state (handles race with deploy:start)
      const fresh = ctx.db.getProject(project.id);
      if (fresh) {
        if (fresh.status === 'running' || fresh.status === 'error' || fresh.status === 'stopped') {
          const lastDeploy = ctx.db.getLastDeployLog(project.id);
          if (lastDeploy) {
            const ago = formatRelativeTime(lastDeploy.created_at);
            const duration = lastDeploy.duration_ms
              ? `${String(Math.round(lastDeploy.duration_ms / 1000))}s`
              : '';
            const trigger = lastDeploy.trigger;
            const commitInfo = lastDeploy.commit_sha
              ? ` (${lastDeploy.commit_sha.slice(0, 7)})`
              : '';

            write({
              id: `last-deploy-${lastDeploy.id}`,
              type: 'status',
              message: `Last deploy: ${trigger}${commitInfo} — ${ago}${duration ? `, took ${duration}` : ''}`,
              projectId: project.id,
            });
          }

          if (fresh.status === 'running') {
            write({
              id: 'current-running',
              type: 'complete',
              message: 'Currently running',
              projectId: project.id,
            });
          } else if (fresh.status === 'error') {
            write({
              id: 'current-error',
              type: 'error',
              message: 'Build failed',
              projectId: project.id,
            });
          } else {
            write({
              id: 'current-stopped',
              type: 'status',
              message: 'Stopped',
              projectId: project.id,
            });
          }
          cleanup();
          void s.close();
          return;
        }
        write({
          id: 'current-building',
          type: 'status',
          message: `Build in progress (${fresh.status})...`,
          projectId: project.id,
        });
      }

      // Keep stream alive — event handlers call s.close() on completion
      await new Promise(() => {
        /* never resolves — closed by event handlers or abort */
      });
    });
  });

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
