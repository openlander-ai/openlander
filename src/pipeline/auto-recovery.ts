import { nanoid } from 'nanoid';

import type { ChatStreamEvent } from '../types/agent-events.js';
import type { BuildDebugger } from './build-debugger.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
import { createModuleLogger } from '../lib/logger.js';
import { buildContextSnapshot } from '../llm/context-assembler.js';
import { dispatchRecovery, type Locale, type RecoveryPlan } from './recovery-dispatch.js';
import { matchRecipe, type RecipeAction } from './recipes.js';
import type { DeployQueue } from './deploy-queue.js';
import type { DeployPipeline } from './deploy.js';
import type { OpenLanderConfig } from '../config/index.js';
import { ApprovalGate, type ApprovalGate as ApprovalGateType } from './approval-gate.js';
import type { PendingFixPatch } from './deploy/helpers.js';
import { findMatchingPatterns, saveRecoveryPattern } from '../llm/memory.js';

const log = createModuleLogger('auto-recovery');

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS = 300_000;
const RECOVERY_OUTCOME_MAX_TIMEOUT_MS = 600_000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const HIGH_RISK_TOOLS = ['rollback_project', 'remove_project', 'remove_service', 'create_database'];

type RecoveryStrategy = 'recipe' | 'llm';

interface GateCheckResult {
  blocked: boolean;
  reason?: 'already-running' | 'max-attempts' | 'infra-error';
  recentFailedCount: number;
  lastFailedError?: string;
}

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
  approvalGate?: ApprovalGateType;
  language: Locale;
  config: OpenLanderConfig;
}

function normalizeError(error: string): string {
  return error
    .replace(/[0-9a-f]{8,}/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
    .replace(/:\d{4,5}/g, ':<port>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecent(createdAt: string, nowMs: number): boolean {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) {
    return false;
  }
  return ts > nowMs - RECOVERY_WINDOW_MS;
}

function getDynamicOutcomeTimeoutMs(db: Database, projectId: string): number {
  const logs = db.getDeployLogs(projectId, 10);
  const durations = logs
    .map((logRow) => logRow.duration_ms)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0);

  if (durations.length === 0) {
    return RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS;
  }

  const averageDuration =
    durations.reduce((sum, duration) => sum + duration, 0) / Math.max(durations.length, 1);

  const buffered = Math.round(averageDuration * 1.5);
  return Math.min(
    Math.max(buffered, RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS),
    RECOVERY_OUTCOME_MAX_TIMEOUT_MS,
  );
}

function runGateChecks(projectId: string, error: string, db: Database): GateCheckResult {
  const running = db.getRunningActionRuns(projectId);
  if (running.length > 0) {
    return { blocked: true, reason: 'already-running', recentFailedCount: 0 };
  }

  const infraPatterns = [
    /docker daemon/i,
    /cannot connect to docker/i,
    /permission denied.*docker/i,
  ];
  if (infraPatterns.some((pattern) => pattern.test(error))) {
    return { blocked: true, reason: 'infra-error', recentFailedCount: 0 };
  }

  const nowMs = Date.now();
  const recent = db.getActionRunsByProject(projectId, 20);
  const recentFailed = recent.filter(
    (run) => run.status === 'failed' && isRecent(run.created_at, nowMs),
  );
  if (recentFailed.length >= MAX_RECOVERY_ATTEMPTS) {
    return {
      blocked: true,
      reason: 'max-attempts',
      recentFailedCount: recentFailed.length,
      lastFailedError: recentFailed[0]?.error_message ?? normalizeError(error),
    };
  }

  return {
    blocked: false,
    recentFailedCount: recentFailed.length,
    lastFailedError: recentFailed[0]?.error_message ?? undefined,
  };
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

function waitForRecoveryOutcome(
  eventBus: EventBus,
  projectId: string,
  timeoutMs: number,
): Promise<{ success: boolean; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;

    const finalize = (success: boolean, timedOut: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      unsubscribeSuccess();
      unsubscribeFailed();
      resolve({ success, timedOut });
    };

    const unsubscribeSuccess = eventBus.on('deploy:success', (payload) => {
      if (payload.projectId === projectId) {
        finalize(true, false);
      }
    });

    const unsubscribeFailed = eventBus.on('deploy:failed', (payload) => {
      if (payload.projectId === projectId) {
        finalize(false, false);
      }
    });

    const timer = setTimeout(() => {
      finalize(false, true);
    }, timeoutMs);
  });
}

function mapFailStep(step?: string): 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime' {
  if (step === 'clone' || step === 'dockerfile' || step === 'build' || step === 'run') {
    return step;
  }

  return 'runtime';
}

function selectRecoveryStrategy(recipeMatched: boolean, hasAgent: boolean): RecoveryStrategy {
  if (recipeMatched || !hasAgent) {
    return 'recipe';
  }

  return 'llm';
}

function buildPendingFixFromAction(
  action: RecipeAction,
): { filePath: string; patches: PendingFixPatch[] } | null {
  switch (action.type) {
    case 'dockerfile_replace_pattern':
      return {
        filePath: 'Dockerfile',
        patches: [{ pattern: action.pattern, replacement: action.replacement, flags: 'gm' }],
      };
    case 'dockerfile_add_line': {
      const insertBefore = action.position === 'before';
      const replacement = insertBefore ? `${action.line}\n$&` : `$&\n${action.line}`;
      return {
        filePath: 'Dockerfile',
        patches: [{ pattern: action.anchor, replacement, flags: 'm' }],
      };
    }
    case 'set_env':
    case 'retry_no_cache':
    case 'skip':
      return null;
  }
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
  const {
    eventBus,
    agent,
    db,
    buildDebugger,
    deployQueue,
    pipeline,
    questionBridge,
    approvalGate: providedApprovalGate,
    language,
    config,
  } = params;

  const approvalGate = providedApprovalGate ?? new ApprovalGate();

  let recoveryChain = Promise.resolve();

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
    const gate = runGateChecks(projectId, error, db);
    if (gate.blocked) {
      if (gate.reason === 'max-attempts') {
        await eventBus.emit('recovery:exhausted', {
          projectId,
          totalAttempts: gate.recentFailedCount,
          lastError: gate.lastFailedError ?? normalizeError(error),
        });
        log.info(
          { projectId, attempts: gate.recentFailedCount },
          'Auto-recovery exhausted, manual intervention needed',
        );
        return;
      }

      if (gate.reason === 'already-running') {
        log.info({ projectId }, 'Auto-recovery skipped: action run already in progress');
        return;
      }

      if (gate.reason === 'infra-error') {
        log.info({ projectId }, 'Infrastructure error detected, skipping auto-recovery');
        return;
      }
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

    const attempt = gate.recentFailedCount + 1;
    const normalizedError = normalizeError(error);
    const recoveryStartTime = Date.now();

    let matchingPatterns: ReturnType<typeof findMatchingPatterns> = [];
    try {
      matchingPatterns = findMatchingPatterns(db, projectId, error);
    } catch (patternErr) {
      log.warn({ err: patternErr, projectId }, 'Failed to lookup recovery patterns');
    }

    if (matchingPatterns.length > 0) {
      log.info(
        {
          projectId,
          matchedPatternCount: matchingPatterns.length,
          topPattern: matchingPatterns[0]?.error_signature,
        },
        'Matched deployment pattern before LLM recovery',
      );
    }

    const latestBuildLog = buildLog ?? db.getLastDeployLog(projectId)?.build_log;
    const combinedForMatch = `${error}\n${latestBuildLog ?? ''}`;
    const recipe = matchRecipe(combinedForMatch);
    const strategy = selectRecoveryStrategy(recipe !== null, agent !== null);
    const fixActionStr = recipe
      ? JSON.stringify({ strategy, recipe: recipe.title })
      : JSON.stringify({ strategy });
    const trySavePattern = (success: boolean): void => {
      try {
        saveRecoveryPattern(db, projectId, error, fixActionStr, success, plan.category);
      } catch (patternErr) {
        log.warn({ err: patternErr, projectId }, 'Failed to save recovery pattern');
      }
    };
    const actionRunId = db.createActionRun({
      projectId,
      triggerSource: 'auto_recovery',
      recoveryStrategy: matchingPatterns.length > 0 ? 'memory' : strategy,
    });

    await eventBus.emit('recovery:start', {
      projectId,
      error,
      attempt,
    });

    questionBridge.setActiveProject(projectId);

    const project = db.getProject(projectId);
    const projectName = project?.name ?? projectId;

    if (strategy === 'llm' && agent) {
      await emitTimelineMessage(
        eventBus,
        projectId,
        'AI is analyzing the failure and attempting to fix it...',
      );

      try {
        const sessionId = nanoid(12);
        const contextSnapshot = await buildContextSnapshot(db);
        const approvalState: { blocked: 'rejected' | 'timed_out' | null; toolName?: string } = {
          blocked: null,
        };
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

## Server Context Snapshot
${contextSnapshot}

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
            if (event.type === 'tool_call' && HIGH_RISK_TOOLS.includes(event.toolName)) {
              const approvalMetadata = {
                projectId,
                projectName,
                toolName: event.toolName,
                attempt,
                actionRunId,
                createdAt: new Date(),
              };

              await eventBus.emit('recovery:approval-needed', {
                projectId,
                actionRunId,
                toolName: event.toolName,
                attempt,
              });

              db.updateActionRunStatus(actionRunId, 'pending_approval');
              db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
              approvalState.toolName = event.toolName;
              const approvalResult = await approvalGate.waitForApproval(
                actionRunId,
                approvalMetadata,
              );

              if (approvalResult === 'rejected') {
                approvalState.blocked = 'rejected';
                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                return;
              }

              if (approvalResult === 'timed_out') {
                approvalState.blocked = 'timed_out';
                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                return;
              }

              db.updateActionRunStatus(actionRunId, 'running');
              db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
            }

            await eventBus.emit('agent:event', {
              projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          sessionId,
        );

        if (approvalState.blocked) {
          const failureReason = 'High-risk tool was rejected or timed out';
          db.updateActionRunStatus(actionRunId, 'failed', failureReason);
          await eventBus.emit('recovery:failed', {
            projectId,
            error: failureReason,
            attempt,
          });
          trySavePattern(false);
          return;
        }

        const timeoutMs = getDynamicOutcomeTimeoutMs(db, projectId);
        const outcome = await waitForRecoveryOutcome(eventBus, projectId, timeoutMs);
        const durationMs = Date.now() - recoveryStartTime;
        if (outcome.success) {
          db.updateActionRunStatus(actionRunId, 'succeeded');
          await eventBus.emit('recovery:success', {
            projectId,
            attempt,
            durationMs,
            lastError: normalizedError,
          });
          trySavePattern(true);
        } else {
          const failureReason = outcome.timedOut
            ? `Recovery verification timed out after ${String(Math.round(timeoutMs / 1000))}s`
            : error;
          db.updateActionRunStatus(actionRunId, 'failed', failureReason);
          await eventBus.emit('recovery:failed', {
            projectId,
            error: failureReason,
            attempt,
          });
          trySavePattern(false);
        }

        return;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : error;
        db.updateActionRunStatus(actionRunId, 'failed', errorMessage);
        log.error({ err, projectId }, 'Auto-recovery agent call failed');
        await eventBus.emit('recovery:failed', {
          projectId,
          error: errorMessage,
          attempt,
        });
        trySavePattern(false);
        return;
      }
    }

    try {
      await emitTimelineMessage(
        eventBus,
        projectId,
        agent
          ? 'Recipe-based recovery selected for known failure pattern.'
          : 'No API key detected - running programmatic recovery recipe.',
      );

      if (recipe) {
        await emitTimelineMessage(
          eventBus,
          projectId,
          `Recipe matched: ${recipe.title}. ${recipe.fix}`,
        );

        if (recipe.action && recipe.action.type !== 'skip') {
          if (recipe.action.type === 'set_env') {
            try {
              const productionEnvironment = db
                .getEnvironmentsByProject(projectId)
                .find((environment) => environment.type === 'production');
              db.setEnvVar(
                projectId,
                recipe.action.key,
                recipe.action.value,
                productionEnvironment?.id,
              );
              await emitTimelineMessage(
                eventBus,
                projectId,
                `Applied fix: set ${recipe.action.key} environment variable`,
              );
            } catch (err) {
              log.warn(
                { err, projectId, actionType: recipe.action.type },
                'Failed to apply set_env action, continuing with redeploy',
              );
            }
          } else {
            try {
              const pendingFix = buildPendingFixFromAction(recipe.action);
              if (pendingFix) {
                db.setPendingFix(projectId, pendingFix);
                await emitTimelineMessage(
                  eventBus,
                  projectId,
                  'Applied fix: Dockerfile patch prepared for next build',
                );
              }
            } catch (err) {
              log.warn(
                { err, projectId, actionType: recipe.action.type },
                'Failed to persist recipe Dockerfile patch, continuing with redeploy',
              );
            }
          }
        }
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

      const useNoCache = recipe?.action?.type === 'retry_no_cache';
      if (useNoCache) {
        await emitTimelineMessage(
          eventBus,
          projectId,
          'Retrying build with --no-cache to bypass corrupted cache.',
        );
      }

      const release = await deployQueue.acquire();
      let redeploySuccess = false;
      let redeployError = error;
      try {
        const retryResult = await pipeline.redeploy(
          projectId,
          useNoCache ? { noCache: true } : undefined,
        );
        redeploySuccess = retryResult.success;
        redeployError = retryResult.error ?? error;
      } finally {
        release();
      }

      const durationMs = Date.now() - recoveryStartTime;
      if (redeploySuccess) {
        db.updateActionRunStatus(actionRunId, 'succeeded');
        await eventBus.emit('recovery:success', {
          projectId,
          attempt,
          durationMs,
          lastError: normalizedError,
        });
        trySavePattern(true);
      } else {
        db.updateActionRunStatus(actionRunId, 'failed', redeployError);
        await eventBus.emit('recovery:failed', {
          projectId,
          error: redeployError,
          attempt,
        });
        trySavePattern(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : error;
      db.updateActionRunStatus(actionRunId, 'failed', errorMessage);
      log.error({ err, projectId }, 'Programmatic auto-recovery failed');
      await eventBus.emit('recovery:failed', {
        projectId,
        error: errorMessage,
        attempt,
      });
      trySavePattern(false);
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
    if (!config.ai.envDetection.enabled) return;
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
    if (!config.ai.secretScan.enabled) return;
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
    if (!config.ai.rollbackSuggestion.enabled) return;
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

  eventBus.on('recovery:approval-resolved', (payload) => {
    if (payload.approved) {
      approvalGate.approve(payload.actionRunId);
    } else {
      approvalGate.reject(payload.actionRunId);
    }
  });
}
