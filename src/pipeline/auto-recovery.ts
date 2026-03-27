import { nanoid } from 'nanoid';

import type { ChatStreamEvent } from '../types/agent-events.js';
import type { BuildDebugger } from './build-debugger.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
import { createModuleLogger } from '../lib/logger.js';
import { dispatchRecovery, type Locale, type RecoveryPlan } from './recovery-dispatch.js';
import { matchRecipe } from './recipes.js';
import type { DeployQueue } from './deploy-queue.js';
import type { DeployPipeline } from './deploy.js';

const log = createModuleLogger('auto-recovery');

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_OUTCOME_TIMEOUT_MS = 300_000;

export interface AutoRecoveryAgent {
  chatStream(
    input: string,
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    sessionId?: string,
  ): Promise<void>;
}

export interface SetupAutoRecoveryParams {
  eventBus: EventBus;
  agent: AutoRecoveryAgent | null;
  db: Database;
  buildDebugger: BuildDebugger | null;
  deployQueue: DeployQueue;
  pipeline: DeployPipeline;
  questionBridge: QuestionBridge;
  language: Locale;
}

function normalizeError(error: string): string {
  return error
    .replace(/[0-9a-f]{8,}/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
    .replace(/:\d{4,5}/g, ':<port>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function emitTimelineMessage(
  eventBus: EventBus,
  projectId: string,
  content: string,
): Promise<void> {
  const event: ChatStreamEvent & { timestamp: string } = {
    type: 'message',
    content,
    timestamp: new Date().toISOString(),
  };

  await eventBus.emit('agent:event', {
    projectId,
    event,
  });
}

function waitForRecoveryOutcome(eventBus: EventBus, projectId: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finalize = (recovered: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      unsubscribeSuccess();
      unsubscribeFailed();
      resolve(recovered);
    };

    const unsubscribeSuccess = eventBus.on('deploy:success', (payload) => {
      if (payload.projectId === projectId) {
        finalize(true);
      }
    });

    const unsubscribeFailed = eventBus.on('deploy:failed', (payload) => {
      if (payload.projectId === projectId) {
        finalize(false);
      }
    });

    const timer = setTimeout(() => {
      finalize(false);
    }, RECOVERY_OUTCOME_TIMEOUT_MS);
  });
}

function mapFailStep(step?: string): 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime' {
  if (step === 'clone' || step === 'dockerfile' || step === 'build' || step === 'run') {
    return step;
  }

  return 'runtime';
}

/**
 * Registers automatic recovery handlers for deploy/runtime failures.
 *
 * - LLM mode (`agent !== null`): streams agent-driven analysis and recovery.
 * - Programmatic mode (`agent === null`): recipe match + optional debugger + single redeploy retry.
 */
const mcpDeployTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function markMcpDeploy(projectId: string): void {
  const existing = mcpDeployTimers.get(projectId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => mcpDeployTimers.delete(projectId), 10 * 60 * 1000);
  mcpDeployTimers.set(projectId, timer);
}

export function setupAutoRecovery(params: SetupAutoRecoveryParams): void {
  const { eventBus, agent, db, buildDebugger, deployQueue, pipeline, questionBridge, language } =
    params;

  let recoveryChain = Promise.resolve();
  const recoveryAttempts = new Map<string, { count: number; lastError: string }>();

  function enqueueRecoveryCall(
    fn: () => Promise<void>,
    context: { projectId: string; eventType: string },
  ): void {
    recoveryChain = recoveryChain.then(fn).catch((err: unknown) => {
      log.error(
        { err, projectId: context.projectId, eventType: context.eventType },
        'Recovery operation failed in queue',
      );
    });
  }

  async function handleAutoRecovery(
    projectId: string,
    error: string,
    step?: string,
    buildLog?: string,
  ): Promise<void> {
    const attempts = recoveryAttempts.get(projectId) ?? { count: 0, lastError: '' };

    if (attempts.count >= MAX_RECOVERY_ATTEMPTS) {
      await eventBus.emit('recovery:exhausted', {
        projectId,
        totalAttempts: attempts.count,
        lastError: attempts.lastError,
      });
      log.info(
        { projectId, attempts: attempts.count },
        'Auto-recovery exhausted, manual intervention needed',
      );
      return;
    }

    if (attempts.lastError === normalizeError(error) && attempts.count > 0) {
      log.info({ projectId, error }, 'Same error repeating, stopping auto-recovery');
      return;
    }

    const infraPatterns = [
      /docker daemon/i,
      /cannot connect to docker/i,
      /permission denied.*docker/i,
    ];
    if (infraPatterns.some((pattern) => pattern.test(error))) {
      log.info({ projectId }, 'Infrastructure error detected, skipping auto-recovery');
      return;
    }

    const advisoryPatterns = [/disk space/i, /no space left/i, /out of memory/i, /killed/i];
    const isAdvisory = advisoryPatterns.some((pattern) => pattern.test(error));

    const plan: RecoveryPlan = dispatchRecovery(step ?? 'unknown', error, buildLog, language);

    if (plan.fixability === 'user' || plan.fixability === 'report') {
      await eventBus.emit('deploy:needs-user-action', {
        projectId,
        category: plan.category,
        title: plan.title,
        description: plan.description,
        userSteps: plan.userSteps,
      });
      log.info(
        { projectId, category: plan.category, fixability: plan.fixability },
        'Recovery dispatch: user action required, skipping auto-recovery action',
      );
      return;
    }

    attempts.count++;
    attempts.lastError = normalizeError(error);
    recoveryAttempts.set(projectId, attempts);
    const recoveryStartTime = Date.now();

    await eventBus.emit('recovery:start', {
      projectId,
      error,
      attempt: attempts.count,
    });

    questionBridge.setActiveProject(projectId);

    const project = db.getProject(projectId);
    const projectName = project?.name ?? projectId;

    if (agent) {
      await emitTimelineMessage(
        eventBus,
        projectId,
        'AI is analyzing the failure and attempting to fix it...',
      );

      try {
        const sessionId = nanoid(12);
        let recoveryMessage = `Deploy of "${projectName}" failed.

## Failure Context
- Project: ${projectName} (${projectId})
- Failed Step: ${step ?? 'unknown'}
- Error: ${error}${
          buildLog
            ? `

## Build Log (last 3000 chars)
${buildLog.slice(-3000)}`
            : ''
        }

${plan.agentGuidance}

## General Recovery Rules
1. If build log is provided above, analyze it directly. Otherwise call debug_build_error("${projectName}").
2. After fixing, redeploy with create_deploy_plan and execute_deploy_plan.
3. Do NOT just suggest fixes - execute them.`;

        if (isAdvisory) {
          recoveryMessage +=
            "\n\nThis appears to be an infrastructure resource issue. You likely cannot fix this via tools alone. Diagnose the issue, explain it clearly, and suggest manual steps (e.g., docker system prune, increase memory). Do NOT retry the deploy unless you've confirmed the resource issue is resolved.";
        }

        await agent.chatStream(
          recoveryMessage,
          async (event) => {
            await eventBus.emit('agent:event', {
              projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          sessionId,
        );

        const recovered = await waitForRecoveryOutcome(eventBus, projectId);
        const durationMs = Date.now() - recoveryStartTime;
        if (recovered) {
          await eventBus.emit('recovery:success', {
            projectId,
            attempt: attempts.count,
            durationMs,
            lastError: attempts.lastError,
          });
          recoveryAttempts.delete(projectId);
        } else {
          await eventBus.emit('recovery:failed', {
            projectId,
            error,
            attempt: attempts.count,
          });
        }

        return;
      } catch (err) {
        log.error({ err, projectId }, 'Auto-recovery agent call failed');
        await eventBus.emit('recovery:failed', {
          projectId,
          error: err instanceof Error ? err.message : error,
          attempt: attempts.count,
        });
        return;
      }
    }

    try {
      await emitTimelineMessage(
        eventBus,
        projectId,
        'No API key detected - running programmatic recovery recipe.',
      );

      const latestBuildLog = buildLog ?? db.getLastDeployLog(projectId)?.build_log;
      const combinedForMatch = `${error}\n${latestBuildLog ?? ''}`;
      const recipe = matchRecipe(combinedForMatch);
      if (recipe) {
        await emitTimelineMessage(
          eventBus,
          projectId,
          `Recipe matched: ${recipe.title}. ${recipe.fix}`,
        );
      } else {
        await emitTimelineMessage(
          eventBus,
          projectId,
          'No known recipe matched this failure. Proceeding with fallback analysis.',
        );
      }

      if (buildDebugger && latestBuildLog) {
        const diagnosis = await buildDebugger.diagnose({
          buildLog: latestBuildLog,
          projectName,
          imageTag: project?.image_tag ?? `openlander/${projectName}:latest`,
          failedStep: mapFailStep(step),
        });
        await emitTimelineMessage(eventBus, projectId, `Debug summary: ${diagnosis.summary}`);
      }

      const release = await deployQueue.acquire();
      let redeploySuccess = false;
      let redeployError = error;
      try {
        const retryResult = await pipeline.redeploy(projectId);
        redeploySuccess = retryResult.success;
        redeployError = retryResult.error ?? error;
      } finally {
        release();
      }

      const durationMs = Date.now() - recoveryStartTime;
      if (redeploySuccess) {
        await eventBus.emit('recovery:success', {
          projectId,
          attempt: attempts.count,
          durationMs,
          lastError: attempts.lastError,
        });
        recoveryAttempts.delete(projectId);
      } else {
        await eventBus.emit('recovery:failed', {
          projectId,
          error: redeployError,
          attempt: attempts.count,
        });
      }
    } catch (err) {
      log.error({ err, projectId }, 'Programmatic auto-recovery failed');
      await eventBus.emit('recovery:failed', {
        projectId,
        error: err instanceof Error ? err.message : error,
        attempt: attempts.count,
      });
    }
  }

  eventBus.on('deploy:failed', (payload) => {
    if (payload.source === 'mcp' || mcpDeployTimers.has(payload.projectId)) {
      mcpDeployTimers.delete(payload.projectId);
      log.info({ projectId: payload.projectId }, 'MCP-triggered deploy, skipping auto-recovery');
      return;
    }
    setTimeout(() => {
      enqueueRecoveryCall(
        async () => {
          const project = db.getProject(payload.projectId);
          if (!project || project.status === 'stopped' || project.monitoring_paused) {
            log.info(
              { projectId: payload.projectId },
              'Skipping recovery: project stopped or paused',
            );
            return;
          }

          await handleAutoRecovery(
            payload.projectId,
            payload.error,
            payload.step,
            payload.buildLog,
          );
        },
        { projectId: payload.projectId, eventType: 'deploy:failed' },
      );
    }, 2000);
  });

  eventBus.on('compose:failed', (payload) => {
    if (mcpDeployTimers.has(payload.projectId)) {
      mcpDeployTimers.delete(payload.projectId);
      log.info(
        { projectId: payload.projectId },
        'MCP-triggered compose deploy, skipping auto-recovery',
      );
      return;
    }
    setTimeout(() => {
      enqueueRecoveryCall(
        async () => {
          const project = db.getProject(payload.projectId);
          if (!project || project.status === 'stopped' || project.monitoring_paused) {
            log.info(
              { projectId: payload.projectId },
              'Skipping recovery: project stopped or paused',
            );
            return;
          }

          await handleAutoRecovery(payload.projectId, payload.error);
        },
        {
          projectId: payload.projectId,
          eventType: 'compose:failed',
        },
      );
    }, 2000);
  });

  eventBus.on('env:new-keys-detected', (payload) => {
    if (!agent) {
      void eventBus.emit('deploy:needs-user-action', {
        projectId: payload.projectId,
        category: 'env_missing',
        title: 'Environment values required',
        description: `New environment variables were detected for ${payload.projectName}.`,
        userSteps: payload.newKeys.map((key) => ({ label: `Set ${key}` })),
      });
      return;
    }

    const message = `New environment variables detected in ${payload.projectName}'s .env.example: ${payload.newKeys.join(', ')}. These keys are not set yet. Ask the user for values.`;
    enqueueRecoveryCall(
      async () => {
        await agent.chatStream(
          message,
          async (event) => {
            await eventBus.emit('agent:event', {
              projectId: payload.projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          `env-detect-${payload.projectId}`,
        );
      },
      { projectId: payload.projectId, eventType: 'env:new-keys-detected' },
    );
  });

  eventBus.on('secret:detected', (payload) => {
    if (!agent) {
      void eventBus.emit('deploy:needs-user-action', {
        projectId: payload.projectId,
        category: 'secret_detected',
        title: 'Hardcoded secrets detected',
        description: `Secrets were detected in ${payload.projectName}. Move them to environment variables.`,
        userSteps: payload.secrets.map((secret) => ({
          label: `${secret.file}:${String(secret.line)} (${secret.type})`,
        })),
      });
      return;
    }

    const list = payload.secrets
      .map(
        (secret) => `- ${secret.file}:${String(secret.line)} - ${secret.type} (${secret.pattern})`,
      )
      .join('\n');
    const message = `Hardcoded secrets detected in ${payload.projectName}:\n${list}\nAdvise user to move these to environment variables using set_env_vars.`;
    enqueueRecoveryCall(
      async () => {
        await agent.chatStream(
          message,
          async (event) => {
            await eventBus.emit('agent:event', {
              projectId: payload.projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          `secret-scan-${payload.projectId}`,
        );
      },
      { projectId: payload.projectId, eventType: 'secret:detected' },
    );
  });

  eventBus.on('rollback:suggested', (payload) => {
    if (!agent) {
      void eventBus.emit('deploy:needs-user-action', {
        projectId: payload.projectId,
        category: 'rollback_suggested',
        title: 'Rollback recommended',
        description: `${payload.projectName} has failing health checks after deployment.`,
        userSteps: [
          {
            label: `Review rollback to previous image ${payload.previousImageTag}`,
          },
        ],
      });
      return;
    }

    const message = `Health checks are failing for ${payload.projectName} after deployment. ${String(payload.consecutiveFailures)} consecutive failures. Previous version available (${payload.previousImageTag}). Ask the user if they want to rollback.`;
    enqueueRecoveryCall(
      async () => {
        const project = db.getProject(payload.projectId);
        if (!project || project.status === 'stopped' || project.monitoring_paused) {
          log.info(
            { projectId: payload.projectId },
            'Skipping recovery: project stopped or paused',
          );
          return;
        }

        await agent.chatStream(
          message,
          async (event) => {
            await eventBus.emit('agent:event', {
              projectId: payload.projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          `rollback-${payload.projectId}`,
        );
      },
      { projectId: payload.projectId, eventType: 'rollback:suggested' },
    );
  });
}
