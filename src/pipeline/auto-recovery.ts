import { nanoid } from 'nanoid';

import type { ChatStreamEvent } from '../types/agent-events.js';
import type { BuildDebugger } from './build-debugger.js';
import type { Database } from '../db/index.js';
import { loadServiceViewRecord } from '../db/views/service-view.js';
import type { EventBus } from '../events/index.js';
import type { EventPayload } from '../events/index.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
import { createModuleLogger } from '../lib/logger.js';
import { buildContextSnapshot } from '../llm/context-assembler.js';
import { dispatchRecovery, type Locale, type RecoveryPlan } from './recovery-dispatch.js';
import { matchRecipe, type RecipeAction } from './recipes.js';
import type { DeployQueue } from './deploy-queue.js';
import type { DeployPipeline } from './deploy.js';
import type { OpenLanderConfig } from '../config/index.js';
import { ApprovalGate, type ApprovalGate as ApprovalGateType } from './approval-gate.js';
import { decisionEngine } from '../llm/decision.js';
import { buildArchiveDecisionContext } from '../llm/archive-decision-context.js';
import type { PendingFixPatch } from './deploy/helpers.js';
import { findMatchingPatterns, saveRecoveryPattern } from '../llm/memory.js';
import type { ConfigurableRecoveryStep, RecoveryAutomationPolicy } from '../monitor/ops-types.js';
import { withRecoveryStage } from '../monitor/recovery-policy.js';
import { isLlmUnreachableError } from '../errors.js';

const log = createModuleLogger('auto-recovery');

const RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS = 300_000;
const RECOVERY_OUTCOME_MAX_TIMEOUT_MS = 600_000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;

/**
 * 1.0 GA — when the LLM provider is unreachable, hold off all LLM-driven
 * recovery for this long before re-attempting. Prevents tight retry loops
 * against an offline Ollama / OpenAI endpoint and gives the user time to
 * restart the provider service. Per-process in-memory; resets on restart.
 *
 * 1.0.x backlog: persist via circuit-breaker DB row + emit
 * `recovery:blocked` event for UI surface.
 */
const LLM_UNREACHABLE_COOLDOWN_MS = 30 * 60 * 1000;
let llmUnreachableCooldownUntilMs = 0;

/**
 * Test-only helper: reset the in-memory LLM-unreachable cooldown so test
 * cases don't leak state between runs. Production code should never call
 * this — the cooldown is intentionally process-lifetime to throttle
 * recovery against an offline LLM endpoint.
 */
export function resetLlmUnreachableCooldownForTests(): void {
  llmUnreachableCooldownUntilMs = 0;
}

type RecoveryStrategy = 'recipe' | 'llm';

/** Maps high-risk tool names to their corresponding configurable recovery step. */
export const TOOL_TO_RECOVERY_STEP: Record<string, ConfigurableRecoveryStep> = {
  rollback_service: 'rollback',
  archive_service: 'rollback',
  remove_project: 'rollback',
  platform_force_remove: 'rollback',
  remove_service: 'rollback',
  // remove_volume intentionally excluded — permanent data deletion should always require approval
  create_database: 'apply_fixes',
  platform_cleanup_orphans: 'apply_fixes',
  platform_reconcile: 'apply_fixes',
};

interface GateCheckResult {
  blocked: boolean;
  reason?: 'infra-error';
}

export interface AutoRecoveryAgent {
  chatStream(
    input: string,
    onEvent: (event: ChatStreamEvent) => Promise<void>,
    sessionId?: string,
    scope?: { type: string; projectId?: string },
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
  shouldContinue?: (projectId: string) => boolean | Promise<boolean>;
  getAutomationPolicy?: (
    projectId: string,
  ) => RecoveryAutomationPolicy | null | Promise<RecoveryAutomationPolicy | null>;
  /**
   * Optional per-project lock provider. 1.0 GA replaces the global
   * DeployQueue with `AgentPool.acquireProjectLock` so two different
   * projects can recover in parallel. Recovery for the same project still
   * serializes through this lock (and the pipeline boundary's
   * `withDeployLock`).
   */
  acquireProjectLock?: (projectId: string, sessionId: string) => boolean;
  releaseProjectLock?: (projectId: string, sessionId: string) => void;
}

export interface AutoRecoveryHandlers {
  handleDeploymentRecovery(
    projectId: string,
    error: string,
    step?: string,
    buildLog?: string,
    eventType?: 'deploy:failed' | 'compose:failed',
  ): Promise<void>;
  handleEnvNewKeysDetected(payload: EventPayload['env:new-keys-detected']): Promise<void>;
  handleSecretDetected(payload: EventPayload['secret:detected']): Promise<void>;
  handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void>;
  resolveApproval(actionRunId: string, approved: boolean): void;
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

async function getDynamicOutcomeTimeoutMs(db: Database, projectId: string): Promise<number> {
  const logs = await db.getDeployLogs(projectId, 10);
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
  const infraPatterns = [
    /docker daemon/i,
    /cannot connect to docker/i,
    /permission denied.*docker/i,
  ];
  if (infraPatterns.some((pattern) => pattern.test(error))) {
    return { blocked: true, reason: 'infra-error' };
  }

  void projectId;
  void db;

  return { blocked: false };
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
    let unsubscribeSuccess: () => void = () => undefined;
    let unsubscribeFailed: () => void = () => undefined;
    const subscribeOnce = eventBus['once'].bind(eventBus);

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

    const waitForSuccess = (): void => {
      unsubscribeSuccess = subscribeOnce('deploy:success', (payload) => {
        if (payload.projectId === projectId) {
          finalize(true, false);
          return;
        }

        waitForSuccess();
      });
    };

    const waitForFailure = (): void => {
      unsubscribeFailed = subscribeOnce('deploy:failed', (payload) => {
        if (payload.projectId === projectId) {
          finalize(false, false);
          return;
        }

        waitForFailure();
      });
    };

    waitForSuccess();
    waitForFailure();

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

export function consumeMcpDeploy(projectId: string): boolean {
  const existing = mcpDeployTimers.get(projectId);
  if (!existing) {
    return false;
  }

  clearTimeout(existing);
  mcpDeployTimers.delete(projectId);
  return true;
}

export function setupAutoRecovery(params: SetupAutoRecoveryParams): AutoRecoveryHandlers {
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
    shouldContinue: providedShouldContinue,
    getAutomationPolicy,
    acquireProjectLock,
    releaseProjectLock,
  } = params;
  // `deployQueue` is retained for backward compatibility with the
  // SetupAutoRecoveryParams shape — it's no longer the primary lock since
  // 1.0 GA. The per-project `acquireProjectLock` parameter is preferred.
  void deployQueue;

  const approvalGate = providedApprovalGate ?? new ApprovalGate();
  const shouldContinue =
    providedShouldContinue ??
    (async (projectId: string) => {
      const project = await db.getProject(projectId);
      if (!project) return false;
      const status = (await loadServiceViewRecord(db, project)).view.status;
      return status === 'running' && !project.archived_at;
    });

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
      if (gate.reason === 'infra-error') {
        log.info({ projectId }, 'Infrastructure error detected, skipping auto-recovery');
        return;
      }
    }

    const nowMs = Date.now();
    const recentFailedCount = (await db.getActionRunsByProject(projectId, 20)).filter(
      (run) => run.status === 'failed' && isRecent(run.created_at, nowMs),
    ).length;

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

    const attempt = recentFailedCount + 1;
    const normalizedError = normalizeError(error);
    const recoveryStartTime = Date.now();

    // U-P0-9 — surface lookup failures via recovery:degraded so they're
    // visible in metrics, not silently swallowed. Default fallback is empty
    // matches so the rest of the pipeline proceeds with the LLM/recipe path.
    const lookupResult = await withRecoveryStage(
      'execute',
      { events: eventBus, projectId, metadata: { phase: 'pattern-lookup' } },
      () => findMatchingPatterns(db, projectId, error),
    );
    const matchingPatterns: Awaited<ReturnType<typeof findMatchingPatterns>> = lookupResult.ok
      ? lookupResult.value
      : [];

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

    const latestDeployLog =
      buildLog === undefined ? await db.getLastDeployLog(projectId) : undefined;
    const latestBuildLog = buildLog ?? latestDeployLog?.build_log;
    const combinedForMatch = `${error}\n${latestBuildLog ?? ''}`;
    const recipe = matchRecipe(combinedForMatch);
    const strategy = selectRecoveryStrategy(recipe !== null, agent !== null);
    const fixActionStr = recipe
      ? JSON.stringify({ strategy, recipe: recipe.title })
      : JSON.stringify({ strategy });
    // U-P0-10 — wrap save so persistence failures are surfaced via
    // recovery:degraded rather than silently swallowed. Caller (success/fail
    // branches below) is fire-and-forget by design.
    const trySavePattern = (success: boolean): void => {
      void withRecoveryStage(
        'execute',
        { events: eventBus, projectId, metadata: { phase: 'pattern-save', success } },
        () => saveRecoveryPattern(db, projectId, error, fixActionStr, success, plan.category),
      ).catch((err: unknown) => {
        log.error({ err, projectId }, 'unhandled rejection in trySavePattern');
      });
    };
    const actionRunId = await db.createActionRun({
      projectId,
      triggerSource: 'auto_recovery',
      recoveryStrategy: matchingPatterns.length > 0 ? 'memory' : strategy,
      correlationId: projectId,
    });

    await eventBus.emit('recovery:start', {
      projectId,
      error,
      attempt,
      correlationId: projectId,
    });

    questionBridge.setActiveProject(projectId);

    const project = await db.getProject(projectId);
    const projectName = project?.name ?? projectId;

    // 1.0 GA: when the LLM cooldown window is active, force the recipe path
    // so recovery still makes progress against an offline provider without
    // tight retry loops. Falls through to the existing programmatic path
    // below by short-circuiting the agent strategy.
    const llmCooldownActive = Date.now() < llmUnreachableCooldownUntilMs;
    if (strategy === 'llm' && agent && llmCooldownActive) {
      const remainingMs = llmUnreachableCooldownUntilMs - Date.now();
      log.warn(
        { projectId, remainingMs },
        'LLM provider in unreachable cooldown — skipping LLM recovery, falling back to programmatic path',
      );
      await emitTimelineMessage(
        eventBus,
        projectId,
        `LLM provider is unreachable. Skipping AI recovery for ${String(Math.ceil(remainingMs / 60000))} more minute(s); falling back to recipe-based recovery.`,
      );
    } else if (strategy === 'llm' && agent) {
      await emitTimelineMessage(
        eventBus,
        projectId,
        'AI is analyzing the failure and attempting to fix it...',
      );

      try {
        const sessionId = nanoid(12);
        const contextSnapshot = await buildContextSnapshot(db);
        // Snapshot automation policy at session start so mid-recovery config changes
        // don't affect the current session
        const policySnapshot = getAutomationPolicy ? await getAutomationPolicy(projectId) : null;
        const approvalState: {
          blocked: 'rejected' | 'timed_out' | 'aborted' | null;
          toolName?: string;
        } = { blocked: null };
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
1. If build log is provided above, analyze it directly. Otherwise call get_build_log("${projectName}").
2. After fixing, redeploy with create_deploy_plan and execute_deploy_plan.
3. Do NOT just suggest fixes - execute them.`;

        if (isAdvisory) {
          recoveryMessage +=
            "\n\nThis appears to be an infrastructure resource issue. You likely cannot fix this via tools alone. Diagnose the issue, explain it clearly, and suggest manual steps (e.g., docker system prune, increase memory). Do NOT retry the deploy unless you've confirmed the resource issue is resolved.";
        }

        await agent.chatStream(
          recoveryMessage,
          async (event) => {
            if (event.type === 'tool_call' && !(await shouldContinue(projectId))) {
              approvalState.blocked = 'aborted';
              log.info(
                { projectId },
                'shouldContinue: project no longer eligible, stopping recovery tool execution',
              );
              return;
            }

            const decisionContext =
              event.type === 'tool_call'
                ? await buildArchiveDecisionContext(db, event.toolName, { project_id: projectId })
                : undefined;

            if (
              event.type === 'tool_call' &&
              decisionEngine.classify(event.toolName, undefined, decisionContext) ===
                'REQUIRE_APPROVAL'
            ) {
              // Check automation policy before requiring manual approval
              const mappedStep = TOOL_TO_RECOVERY_STEP[event.toolName];
              if (policySnapshot && mappedStep) {
                const stepMode = policySnapshot[mappedStep];
                if (stepMode === 'auto') {
                  // Policy says auto — skip approval gate, emit audit event
                  await eventBus.emit('recovery:approval-auto-skipped', {
                    projectId,
                    actionRunId,
                    toolName: event.toolName,
                    recoveryStep: mappedStep,
                    correlationId: projectId,
                  });
                  log.info(
                    { projectId, toolName: event.toolName, recoveryStep: mappedStep },
                    'Approval skipped by automation policy (auto mode)',
                  );
                  // Fall through — no approval needed
                } else {
                  // Policy says confirm — existing approval behavior
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
                    correlationId: projectId,
                  });

                  await db.updateActionRunStatus(actionRunId, 'pending_approval');
                  await db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
                  approvalState.toolName = event.toolName;
                  const approvalResult = await approvalGate.waitForApproval(
                    actionRunId,
                    approvalMetadata,
                  );

                  if (approvalResult === 'rejected') {
                    approvalState.blocked = 'rejected';
                    await db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                    return;
                  }

                  if (approvalResult === 'timed_out') {
                    approvalState.blocked = 'timed_out';
                    await db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                    return;
                  }

                  await db.updateActionRunStatus(actionRunId, 'running');
                  await db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
                }
              } else {
                // No policy or tool not mapped — fall back to DecisionEngine behavior
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
                  correlationId: projectId,
                });

                await db.updateActionRunStatus(actionRunId, 'pending_approval');
                await db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
                approvalState.toolName = event.toolName;
                const approvalResult = await approvalGate.waitForApproval(
                  actionRunId,
                  approvalMetadata,
                );

                if (approvalResult === 'rejected') {
                  approvalState.blocked = 'rejected';
                  await db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                  return;
                }

                if (approvalResult === 'timed_out') {
                  approvalState.blocked = 'timed_out';
                  await db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
                  return;
                }

                await db.updateActionRunStatus(actionRunId, 'running');
                await db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
              }
            }

            await eventBus.emit('agent:event', {
              projectId,
              event: { ...event, timestamp: new Date().toISOString() },
            });
          },
          sessionId,
          { type: 'recovery', projectId },
        );

        if (approvalState.blocked) {
          const failureReason =
            approvalState.blocked === 'aborted'
              ? 'Recovery aborted because project is no longer eligible to continue'
              : 'High-risk tool was rejected or timed out';
          await db.updateActionRunStatus(actionRunId, 'failed', failureReason);
          if (approvalState.blocked === 'aborted') {
            await eventBus.emit('recovery:stopped', {
              projectId,
              reason: failureReason,
              correlationId: projectId,
            });
          } else {
            await eventBus.emit('recovery:failed', {
              projectId,
              error: failureReason,
              attempt,
              correlationId: projectId,
            });
          }
          trySavePattern(false);
          return;
        }

        const timeoutMs = await getDynamicOutcomeTimeoutMs(db, projectId);
        const outcome = await waitForRecoveryOutcome(eventBus, projectId, timeoutMs);
        const durationMs = Date.now() - recoveryStartTime;
        if (outcome.success) {
          await db.updateActionRunStatus(actionRunId, 'succeeded');
          await eventBus.emit('recovery:success', {
            projectId,
            attempt,
            durationMs,
            lastError: normalizedError,
            correlationId: projectId,
          });
          trySavePattern(true);
        } else {
          const failureReason = outcome.timedOut
            ? `Recovery verification timed out after ${String(Math.round(timeoutMs / 1000))}s`
            : error;
          await db.updateActionRunStatus(actionRunId, 'failed', failureReason);
          await eventBus.emit('recovery:failed', {
            projectId,
            error: failureReason,
            attempt,
            correlationId: projectId,
          });
          trySavePattern(false);
        }

        return;
      } catch (err) {
        if (isLlmUnreachableError(err)) {
          // 1.0 GA: open the LLM-unreachable cooldown so subsequent recovery
          // attempts skip the LLM path until the provider is reachable
          // again. Prevents the tight retry loop that crash-loops the host
          // process under a supervisor when local Ollama / OpenAI is down.
          llmUnreachableCooldownUntilMs = Date.now() + LLM_UNREACHABLE_COOLDOWN_MS;
          log.warn(
            { err, projectId, cooldownUntilMs: llmUnreachableCooldownUntilMs },
            `LLM unreachable — opening ${String(LLM_UNREACHABLE_COOLDOWN_MS / 60000)}min cooldown, will retry after`,
          );
          await db.updateActionRunStatus(
            actionRunId,
            'failed',
            'LLM provider unreachable — cooldown opened',
          );
          await eventBus.emit('recovery:failed', {
            projectId,
            error: `LLM provider unreachable — recovery paused for ${String(LLM_UNREACHABLE_COOLDOWN_MS / 60000)} minutes. Restart the LLM provider (e.g. \`ollama serve\`) and recovery will resume.`,
            attempt,
            correlationId: projectId,
          });
          return;
        }
        const errorMessage = err instanceof Error ? err.message : error;
        await db.updateActionRunStatus(actionRunId, 'failed', errorMessage);
        log.error({ err, projectId }, 'Auto-recovery agent call failed');
        await eventBus.emit('recovery:failed', {
          projectId,
          error: errorMessage,
          attempt,
          correlationId: projectId,
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
              const productionEnvironment = (await db.getEnvironmentsByProject(projectId)).find(
                (environment) => environment.type === 'production',
              );
              await db.setEnvVar(
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
                await db.setPendingFix(projectId, pendingFix);
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
        const debugView = project ? (await loadServiceViewRecord(db, project)).view : null;
        const diagnosis = await buildDebugger.diagnose({
          buildLog: latestBuildLog,
          projectName,
          imageTag: debugView?.imageTag ?? `openlander/${projectName}:latest`,
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

      // 1.0 GA: per-project lock instead of global queue. If another
      // session is already deploying this project (e.g. a manual user
      // redeploy raced ahead) we surface that as a recovery failure rather
      // than queue-waiting indefinitely.
      const recoveryLockSession = `auto-recovery-${projectId}-${Date.now().toString(36)}`;
      const memLockAcquired = acquireProjectLock
        ? acquireProjectLock(projectId, recoveryLockSession)
        : true;
      if (!memLockAcquired) {
        log.warn(
          { projectId },
          'Auto-recovery skipped: project lock already held by another session',
        );
        await db.updateActionRunStatus(actionRunId, 'failed', 'Project lock already held');
        await eventBus.emit('recovery:failed', {
          projectId,
          error: 'Project lock held by another session — recovery deferred',
          attempt,
        });
        trySavePattern(false);
        return;
      }
      let redeploySuccess = false;
      let redeployError = error;
      try {
        const retryResult = await pipeline.redeploy(
          projectId,
          useNoCache
            ? { noCache: true, allowMultiServiceProjectFallback: true }
            : { allowMultiServiceProjectFallback: true },
        );
        redeploySuccess = retryResult.success;
        redeployError = retryResult.error ?? error;
      } finally {
        if (releaseProjectLock) {
          releaseProjectLock(projectId, recoveryLockSession);
        }
      }

      const durationMs = Date.now() - recoveryStartTime;
      if (redeploySuccess) {
        await db.updateActionRunStatus(actionRunId, 'succeeded');
        await eventBus.emit('recovery:success', {
          projectId,
          attempt,
          durationMs,
          lastError: normalizedError,
        });
        trySavePattern(true);
      } else {
        await db.updateActionRunStatus(actionRunId, 'failed', redeployError);
        await eventBus.emit('recovery:failed', {
          projectId,
          error: redeployError,
          attempt,
        });
        trySavePattern(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : error;
      await db.updateActionRunStatus(actionRunId, 'failed', errorMessage);
      log.error({ err, projectId }, 'Programmatic auto-recovery failed');
      await eventBus.emit('recovery:failed', {
        projectId,
        error: errorMessage,
        attempt,
      });
      trySavePattern(false);
    }
  }

  async function handleDeploymentRecovery(
    projectId: string,
    error: string,
    step?: string,
    buildLog?: string,
    eventType: 'deploy:failed' | 'compose:failed' = 'deploy:failed',
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2000);
    });

    enqueueRecoveryCall(
      async () => {
        await handleAutoRecovery(projectId, error, step, buildLog);
      },
      { projectId, eventType },
    );

    await recoveryChain;
  }

  function handleEnvNewKeysDetected(payload: EventPayload['env:new-keys-detected']): Promise<void> {
    if (!config.ai.envDetection.enabled) return Promise.resolve();
    if (!agent) {
      return eventBus.emit('deploy:needs-user-action', {
        projectId: payload.projectId,
        category: 'env_missing',
        title: 'Environment values required',
        description: `New environment variables were detected for ${payload.projectName}.`,
        userSteps: payload.newKeys.map((key) => ({ label: `Set ${key}` })),
      });
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
          { type: 'recovery', projectId: payload.projectId },
        );
      },
      { projectId: payload.projectId, eventType: 'env:new-keys-detected' },
    );
    return Promise.resolve();
  }

  function handleSecretDetected(payload: EventPayload['secret:detected']): Promise<void> {
    if (!config.ai.secretScan.enabled) return Promise.resolve();
    if (!agent) {
      return eventBus.emit('deploy:needs-user-action', {
        projectId: payload.projectId,
        category: 'secret_detected',
        title: 'Hardcoded secrets detected',
        description: `Secrets were detected in ${payload.projectName}. Move them to environment variables.`,
        userSteps: payload.secrets.map((secret) => ({
          label: `${secret.file}:${String(secret.line)} (${secret.type})`,
        })),
      });
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
          { type: 'recovery', projectId: payload.projectId },
        );
      },
      { projectId: payload.projectId, eventType: 'secret:detected' },
    );
    return Promise.resolve();
  }

  function handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void> {
    if (!config.ai.rollbackSuggestion.enabled) return Promise.resolve();
    if (!agent) {
      return eventBus.emit('deploy:needs-user-action', {
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
          { type: 'recovery', projectId: payload.projectId },
        );
      },
      { projectId: payload.projectId, eventType: 'rollback:suggested' },
    );
    return Promise.resolve();
  }

  function resolveApproval(actionRunId: string, approved: boolean): void {
    if (approved) {
      approvalGate.approve(actionRunId);
    } else {
      approvalGate.reject(actionRunId);
    }
  }

  return {
    handleDeploymentRecovery,
    handleEnvNewKeysDetected,
    handleSecretDetected,
    handleRollbackSuggested,
    resolveApproval,
  };
}
