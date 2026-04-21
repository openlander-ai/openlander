/**
 * Event Bus for OpenLander.
 *
 * Central event system that decouples modules.
 * v0.1 uses it for deploy lifecycle events.
 * v0.2+ adds monitoring, webhook, and channel events.
 *
 * Pattern inspired by OpenClaw's hooks system but simplified
 * for single-agent architecture.
 */

import { createModuleLogger } from '../lib/logger.js';
import type { BuildTier } from '../pipeline/build-recovery.js';
import type { ChatStreamEvent } from '../types/agent-events.js';
import type { Question } from '../lib/question-bridge.js';
import type { Alert } from '../monitor/alerts.js';
import type { RequestIdentity } from '../types/identity.js';
import type { LlmErrorType } from '../llm/llm-error-types.js';

const log = createModuleLogger('events');

// --- Event types ---
export type EventType =
  // Deploy lifecycle
  | 'deploy:start'
  | 'deploy:clone'
  | 'deploy:build'
  | 'deploy:run'
  | 'deploy:auto-detect'
  | 'deploy:success'
  | 'deploy:failed'
  | 'deploy:needs-user-action'
  | 'deploy:crash'
  | 'deploy:rollback'
  | 'build:suggest'
  | 'build:inform'
  | 'build:output'
  | 'compose:start'
  | 'compose:up'
  | 'compose:down'
  | 'compose:orphans-cleaned'
  | 'compose:failed'
  | 'orchestration:plan'
  | 'orchestration:service-start'
  | 'orchestration:service-healthy'
  | 'orchestration:service-failed'
  | 'orchestration:complete'
  // Container lifecycle
  | 'container:start'
  | 'container:stop'
  | 'container:remove'
  | 'project:status-changed'
  | 'project:archive'
  | 'project:unarchive'
  | 'container:missing'
  | 'container:health'
  | 'container:die'
  | 'container:oom'
  // Tunnel
  | 'tunnel:start'
  | 'tunnel:stop'
  | 'tunnel:url'
  // Config changes
  | 'env:set'
  | 'env:delete'
  // v0.2: Monitoring
  | 'monitor:healthcheck'
  | 'monitor:inactive'
  // v0.3: MCP
  | 'mcp:connect'
  | 'mcp:disconnect'
  // v0.4: Channels
  | 'channel:message'
  | 'channel:connect'
  // v0.5: Alerts
  | 'alert:new'
  | 'alert:resolved'
  | 'alert:dismissed'
  // v0.7: Agent questions
  | 'question:pending'
  | 'question:answered'
  // v0.2.0: Agent events (deploy UX fix)
  | 'agent:event'
  | 'ai:invoked'
  | 'ai:completed'
  | 'ai:usage'
  | 'health:degraded'
  | 'recovery:blocked'
  | 'recovery:degraded'
  | 'recovery:stopped'
  | 'recovery:started'
  | 'recovery:start'
  | 'recovery:success'
  | 'recovery:failed'
  | 'recovery:exhausted'
  | 'recovery:approval-needed'
  | 'recovery:approval-auto-skipped'
  | 'recovery:approval-resolved'
  | 'env:new-keys-detected'
  | 'rollback:suggested'
  | 'secret:detected'
  | 'deploy:diff-analyzed';

export interface EventPayload {
  'deploy:start': {
    projectId: string;
    repoUrl: string;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
    serverId?: string;
  };
  'deploy:clone': {
    projectId: string;
    path: string;
    commitSha: string;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
  };
  'deploy:build': {
    projectId: string;
    imageTag: string;
    durationMs: number;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
  };
  'deploy:run': {
    projectId: string;
    containerId: string;
    port: number;
    url: string;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
  };
  'deploy:auto-detect': { projectId: string; framework: string; type: 'dockerfile' | 'compose' };
  'deploy:success': {
    projectId: string;
    url: string;
    totalDurationMs: number;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
    planId?: string;
    /** Deploy lock session ID — enables session-scoped lock release in event handlers. */
    sessionId?: string;
    serverId?: string;
  };
  'deploy:failed': {
    projectId: string;
    step: string;
    error: string;
    buildLog?: string;
    diffContext?: string;
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
    durationMs?: number;
    /** When 'mcp', auto-recovery is skipped — the MCP client agent handles failure. */
    source?: 'mcp' | 'dashboard' | 'webhook';
    /** Deploy lock session ID — enables session-scoped lock release in event handlers. */
    sessionId?: string;
    serverId?: string;
  };
  'deploy:needs-user-action': {
    projectId: string;
    category: string;
    title: string;
    description: string;
    userSteps: Array<{ label: string; actionUrl?: string }>;
  };
  'deploy:crash': { projectId: string; containerId: string; error?: string; exitCode?: number };
  'deploy:rollback': { projectId: string; fromImage: string; toImage: string };
  'build:suggest': { projectId: string; suggestion: string; diff?: string };
  'build:inform': { projectId: string; summary: string; tier: BuildTier };
  'build:output': {
    projectId: string;
    line: string;
    stream: 'stdout' | 'error';
    parentProjectId?: string;
    phase?: string;
    scope?: string;
    status?: 'pending' | 'in_progress' | 'success' | 'failed';
    message?: string;
    durationMs?: number;
    logChunk?: string;
  };
  'compose:start': { projectId: string; composePath: string; serviceCount: number };
  'compose:up': { projectId: string; services: string[]; sessionId?: string };
  'compose:down': { projectId: string };
  'compose:orphans-cleaned': { projectId: string; removed: string[] };
  'compose:failed': { projectId: string; error: string; sessionId?: string };
  'orchestration:plan': {
    topology: {
      services: Array<{
        name: string;
        dockerfile?: string;
        composePath?: string;
        dependsOn: string[];
        port?: number;
        envVars?: Record<string, string>;
      }>;
      executionOrder: string[][];
      repoUrl: string;
      branch?: string;
      clonePath: string;
      commitSha: string;
    };
  };
  'orchestration:service-start': { serviceName: string };
  'orchestration:service-healthy': { serviceName: string };
  'orchestration:service-failed': { serviceName: string; error: string };
  'orchestration:complete': {
    result: {
      success: boolean;
      services: Array<{
        name: string;
        status:
          | 'deployed'
          | 'failed'
          | 'rolled_back'
          | 'skipped'
          | 'rollback_skipped'
          | 'rollback_failed_due_to_policy';
        projectId?: string;
        url?: string;
        error?: string;
        duration?: number;
      }>;
      totalDuration: number;
    };
  };
  'container:start': { projectId: string; containerId: string; serverId?: string };
  'container:stop': { projectId: string; containerId: string; serverId?: string };
  'container:remove': { projectId: string; containerId: string };
  'project:status-changed': {
    projectId: string;
    from: string;
    to: string;
    reason: string;
  };
  'project:archive': { projectId: string };
  'project:unarchive': { projectId: string; port: number };
  'container:missing': {
    projectId: string;
    projectName: string;
    containerId: string;
    suggestion: string;
    serverId?: string;
  };
  'container:health': { projectId: string; healthy: boolean };
  'container:die': {
    projectId: string;
    containerId: string;
    containerName: string;
    exitCode: number;
    serverId?: string;
  };
  'container:oom': {
    projectId: string;
    containerId: string;
    containerName: string;
    serverId?: string;
  };
  'tunnel:start': { projectId: string; localPort: number };
  'tunnel:stop': { projectId: string };
  'tunnel:url': { projectId: string; url: string };
  'env:set': { projectId: string; key: string };
  'env:delete': { projectId: string; key: string };
  'monitor:healthcheck': { projectId: string; healthy: boolean; responseTimeMs: number };
  'monitor:inactive': { projectId: string; daysSinceLastAccess: number };
  'mcp:connect': { clientId: string };
  'mcp:disconnect': { clientId: string };
  'channel:message': { channelType: string; content: string; sender: string };
  'channel:connect': { channelType: string };
  'alert:new': { alert: Alert };
  'alert:resolved': { alertId: string; type: Alert['type'] };
  'alert:dismissed': { alertId: string };
  'question:pending': { projectId: string; requestId: string; questions: Question[] };
  'question:answered': { projectId: string; requestId: string };
  'agent:event': {
    projectId: string;
    event: ChatStreamEvent & { timestamp: string };
    identity?: RequestIdentity;
  };
  'ai:invoked': {
    projectId: string;
    source: string;
    model: string;
    action: string;
    correlationId?: string;
  };
  'ai:completed': {
    projectId: string;
    source: string;
    model: string;
    action: string;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    success: boolean;
    correlationId?: string;
  };
  'ai:usage': {
    modelName: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number | null;
    durationMs: number;
    result: 'success' | 'failure' | 'partial';
    projectId?: string;
    sessionId?: string;
    actionType?: string;
    source?: string;
    toolsCalled?: string[];
    errorMessage?: string;
    errorType?: LlmErrorType;
  };
  'health:degraded': {
    projectId: string;
    consecutiveFailures: number;
    lastError: string | null;
    serverId?: string;
  };
  'recovery:blocked': {
    projectId: string;
    reason: string;
    serverId?: string;
  };
  'recovery:degraded': {
    projectId: string;
    stage: 'enqueue' | 'transition' | 'emit' | 'execute';
    reason: string;
    metadata?: Record<string, unknown>;
    serverId?: string;
  };
  'recovery:stopped': {
    projectId: string;
    reason: string;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:started': {
    projectId: string;
    trigger: string;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:start': {
    projectId: string;
    error: string;
    attempt: number;
    source?: string;
    identity?: RequestIdentity;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:success': {
    projectId: string;
    attempt: number;
    durationMs: number;
    lastError?: string;
    source?: string;
    identity?: RequestIdentity;
    tokenCount?: number;
    costUsd?: number | null;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:failed': {
    projectId: string;
    error: string;
    attempt: number;
    source?: string;
    identity?: RequestIdentity;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:exhausted': {
    projectId: string;
    totalAttempts: number;
    lastError: string;
    source?: string;
    identity?: RequestIdentity;
    correlationId?: string;
    serverId?: string;
  };
  'recovery:approval-needed': {
    projectId: string;
    actionRunId: string;
    toolName: string;
    attempt: number;
    source?: string;
    identity?: RequestIdentity;
    correlationId?: string;
  };
  'recovery:approval-auto-skipped': {
    projectId: string;
    actionRunId: string;
    toolName: string;
    recoveryStep: string;
    correlationId?: string;
  };
  'recovery:approval-resolved': {
    actionRunId: string;
    approved: boolean;
    projectId?: string;
    correlationId?: string;
  };
  'env:new-keys-detected': {
    projectId: string;
    projectName: string;
    newKeys: string[];
    templateFile: string;
  };
  'rollback:suggested': {
    projectId: string;
    projectName: string;
    consecutiveFailures: number;
    previousImageTag: string;
  };
  'secret:detected': {
    projectId: string;
    projectName: string;
    secrets: Array<{ file: string; line: number; pattern: string; type: string }>;
  };
  'deploy:diff-analyzed': {
    projectId: string;
    previousSha: string;
    currentSha: string;
    totalChanged: number;
    buildImpactFiles: string[];
    envTemplateChanged: boolean;
    dockerChanged: boolean;
    depsChanged: boolean;
  };
}

// --- Event handler type ---

type EventHandler<T extends EventType> = (payload: EventPayload[T]) => void | Promise<void>;

// --- Event Bus ---

export class EventBus {
  private handlers = new Map<EventType, Set<EventHandler<EventType>>>();
  private captureHook?: (event: string, payload: unknown) => void;

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T extends EventType>(event: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    const handlerSet = this.handlers.get(event);
    if (!handlerSet) {
      return () => {
        /* noop */
      };
    }
    handlerSet.add(handler as EventHandler<EventType>);

    return () => {
      handlerSet.delete(handler as EventHandler<EventType>);
    };
  }

  /** Subscribe to an event — fires only once, then auto-unsubscribes. */
  once<T extends EventType>(event: T, handler: EventHandler<T>): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      return handler(payload);
    });
    return unsubscribe;
  }

  /** Emit an event to all subscribers. Errors in handlers are caught and logged. */
  async emit<T extends EventType>(event: T, payload: EventPayload[T]): Promise<void> {
    if (this.captureHook) {
      try {
        this.captureHook(event, payload);
      } catch {
        // Swallow capture hook errors to never break emit flow
      }
    }

    const handlerSet = this.handlers.get(event);
    if (!handlerSet || handlerSet.size === 0) return;

    const promises: Promise<void>[] = [];

    for (const handler of handlerSet) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err: unknown) => {
              log.error({ err, event }, 'Error in handler');
            }),
          );
        }
      } catch (err) {
        log.error({ err, event }, 'Error in handler');
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /** Remove all handlers for an event (or all events if no event specified). */
  clear(event?: EventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /** Get count of handlers for an event. Useful for testing. */
  listenerCount(event: EventType): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /** Set a capture hook that receives all emitted events. */
  setCaptureHook(hook: (event: string, payload: unknown) => void): void {
    this.captureHook = hook;
  }

  /** Remove the capture hook. */
  removeCaptureHook(): void {
    this.captureHook = undefined;
  }
}

/** Singleton event bus instance for the application. */
export const eventBus = new EventBus();
