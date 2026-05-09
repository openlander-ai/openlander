import type { LanguageModel, ToolSet } from 'ai';
import type { Database } from '../db/index.js';
import { LLMConcurrencyExceededError } from '../errors.js';
import type { QuestionAnswer, QuestionBridge } from '../lib/question-bridge.js';
import type { ApprovalGate } from '../pipeline/approval-gate.js';
import { Agent } from './agent.js';
import type { ContextProvider, LLMProvider } from './prompts.js';

export const MAX_POOL_SIZE = 5;
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Tools that change project state and require serialization locking.
 * Only one session can execute these tools per project at a time.
 */
export const STATE_CHANGING_TOOLS = new Set([
  'deploy',
  'execute_plan',
  'deploy_service',
  'rollback_service',
  'stop_service',
  'archive_service',
  'remove_project',
  'restart_service',
]);

/**
 * Stale lock timeout: 30 minutes (1.0 GA — Codex Day 16 cumulative cross-check).
 *
 * Aligned with the DB-level `cleanExpiredDeployLocks` default AND
 * `recovery-policy.ts:DEFAULT_LOCK_STALE_MS` so the in-memory project
 * lock, persisted `deploy_lock_*` columns, and recovery-policy stale
 * window all expire in the same 30min window.
 *
 * Why 30min and not 15min: a slow first-build (Rails monolith with cold
 * `bundle install` + `assets:precompile`, or a Next.js project with a
 * fresh dependency tree on a low-end host) can take 20-25min. With a
 * 15min TTL, the in-memory lock evicts mid-build, a second user click
 * lets a duplicate redeploy start, and BUG-002 reappears. 30min covers
 * realistic worst-case builds for 1.0 GA. Anything beyond 30min is
 * documented in docs/launchpad/first-24h-runbook.md (force-release
 * workaround) until the 1.0.x heartbeat/lease-renewal lands.
 *
 * The watchdog (`RECOVERING_TIMEOUT_MS`) is intentionally longer (60min)
 * — it frees rows stuck in `recovering` state, not deploy locks.
 */
export const PROJECT_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

interface PoolEntry {
  agent: Agent;
  sessionId: string;
  lastAccessedAt: number;
  isActive: boolean;
}

export class AgentPool {
  private pool: Map<string, PoolEntry> = new Map();
  private recoveryAgent: Agent | null = null;
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();
  private tools: ToolSet = {};
  private questionBridge: QuestionBridge | null = null;
  private projectLocks = new Map<string, { sessionId: string; startedAt: number }>();

  constructor(
    private readonly model: LanguageModel,
    private readonly db: Database,
    private readonly contextProvider?: ContextProvider,
    private readonly provider?: LLMProvider,
    private readonly locale?: string,
    private readonly approvalGate?: ApprovalGate,
  ) {}

  getOrCreate(sessionId: string): Agent {
    const now = Date.now();
    const existing = this.pool.get(sessionId);
    if (existing) {
      existing.isActive = true;
      existing.lastAccessedAt = now;
      this.clearIdleTimer(sessionId);
      return existing.agent;
    }

    if (this.pool.size >= MAX_POOL_SIZE) {
      this.evictOldest();
      if (this.pool.size >= MAX_POOL_SIZE) {
        // Pool is full and every entry is active — refuse the new session
        // instead of silently spawning an unpooled Agent (which previously
        // bypassed the hard cap and let LLM concurrency / cost grow without
        // bound). Caller (e.g. chat-routes) maps this to HTTP 429.
        let activeCount = 0;
        for (const entry of this.pool.values()) {
          if (entry.isActive) activeCount += 1;
        }
        throw new LLMConcurrencyExceededError(MAX_POOL_SIZE, activeCount);
      }
    }

    const agent = this.createAgent();
    this.pool.set(sessionId, {
      agent,
      sessionId,
      lastAccessedAt: now,
      isActive: true,
    });

    return agent;
  }

  release(sessionId: string): void {
    const entry = this.pool.get(sessionId);
    if (!entry) {
      return;
    }

    entry.isActive = false;
    entry.lastAccessedAt = Date.now();
    this.startIdleTimer(sessionId);
  }

  invalidateAll(): void {
    for (const sessionId of this.idleTimers.keys()) {
      this.clearIdleTimer(sessionId);
    }
    this.pool.clear();
    this.recoveryAgent = null;
  }

  getRecoveryAgent(): Agent {
    if (!this.recoveryAgent) {
      this.recoveryAgent = this.createRecoveryAgent();
    }
    return this.recoveryAgent;
  }

  getStats(): { active: number; idle: number; total: number } {
    let active = 0;
    let idle = 0;

    for (const entry of this.pool.values()) {
      if (entry.isActive) {
        active += 1;
      } else {
        idle += 1;
      }
    }

    return {
      active,
      idle,
      total: this.pool.size,
    };
  }

  setTools(tools: ToolSet): void {
    this.tools = tools;
    for (const entry of this.pool.values()) {
      entry.agent.setTools(tools);
    }
    if (this.recoveryAgent) {
      this.recoveryAgent.setTools(tools);
    }
  }

  setQuestionBridge(bridge: QuestionBridge): void {
    this.questionBridge = bridge;
    for (const entry of this.pool.values()) {
      entry.agent.setQuestionBridge(bridge);
    }
    if (this.recoveryAgent) {
      this.recoveryAgent.setQuestionBridge(bridge);
    }
  }

  /**
   * Reply to a pending question on whichever active Agent has it.
   *
   * The shared QuestionBridge now multiplexes pending entries by `requestId`,
   * so concurrent agent streams no longer trample each other's resolve
   * handler. Walks every pooled Agent's bridge (plus the recovery agent and
   * the shared fallback) and asks each to deliver the answer if it matches
   * its own pending state. Returns true if any bridge accepted it.
   */
  replyToQuestion(requestId: string, answers: QuestionAnswer[]): boolean {
    let delivered = false;
    const tryDeliver = (bridge: QuestionBridge | null): void => {
      if (!bridge || !bridge.hasPending(requestId)) return;
      bridge.reply(requestId, answers);
      delivered = true;
    };

    for (const entry of this.pool.values()) {
      tryDeliver(entry.agent.getQuestionBridge());
    }
    if (this.recoveryAgent) {
      tryDeliver(this.recoveryAgent.getQuestionBridge());
    }
    tryDeliver(this.questionBridge);
    return delivered;
  }

  /**
   * Reject a pending question on whichever active Agent has it. With no
   * `requestId`, walks every Agent's bridge and the shared bridge to clear
   * all pending entries (preserves legacy single-slot dismiss semantics).
   */
  rejectQuestion(requestId?: string): boolean {
    let touched = false;
    const reject = (bridge: QuestionBridge | null): void => {
      if (!bridge) return;
      if (requestId === undefined) {
        if (bridge.hasPending()) {
          bridge.reject();
          touched = true;
        }
        return;
      }
      if (bridge.hasPending(requestId)) {
        bridge.reject(requestId);
        touched = true;
      }
    };

    for (const entry of this.pool.values()) {
      reject(entry.agent.getQuestionBridge());
    }
    if (this.recoveryAgent) {
      reject(this.recoveryAgent.getQuestionBridge());
    }
    reject(this.questionBridge);
    return touched;
  }

  /** True if any Agent (or the shared fallback bridge) has a pending question. */
  hasPendingQuestion(requestId?: string): boolean {
    for (const entry of this.pool.values()) {
      if (entry.agent.getQuestionBridge()?.hasPending(requestId)) return true;
    }
    if (this.recoveryAgent?.getQuestionBridge()?.hasPending(requestId)) {
      return true;
    }
    if (this.questionBridge?.hasPending(requestId)) return true;
    return false;
  }

  private createAgent(): Agent {
    const agent = new Agent(
      this.model,
      this.db,
      this.contextProvider,
      this.provider,
      this.locale,
      'web_agent',
      this.approvalGate,
    );
    agent.setTools(this.tools);
    if (this.questionBridge) {
      agent.setQuestionBridge(this.questionBridge);
    }
    return agent;
  }

  private createRecoveryAgent(): Agent {
    const agent = new Agent(
      this.model,
      this.db,
      this.contextProvider,
      this.provider,
      this.locale,
      'auto_recovery',
    );
    agent.setTools(this.tools);
    if (this.questionBridge) {
      agent.setQuestionBridge(this.questionBridge);
    }
    return agent;
  }

  private evictOldest(): void {
    let oldestIdleEntry: PoolEntry | null = null;

    for (const entry of this.pool.values()) {
      if (entry.isActive) {
        continue;
      }

      if (!oldestIdleEntry || entry.lastAccessedAt < oldestIdleEntry.lastAccessedAt) {
        oldestIdleEntry = entry;
      }
    }

    if (!oldestIdleEntry) {
      return;
    }

    this.clearIdleTimer(oldestIdleEntry.sessionId);
    this.pool.delete(oldestIdleEntry.sessionId);
  }

  private startIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId);
    const timer = setTimeout(() => {
      const entry = this.pool.get(sessionId);
      if (!entry || entry.isActive) {
        return;
      }

      this.pool.delete(sessionId);
      this.idleTimers.delete(sessionId);
    }, IDLE_TIMEOUT_MS);
    this.idleTimers.set(sessionId, timer);
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(sessionId);
    }
  }

  /**
   * Acquire project-level lock for state-changing operations.
   * Returns true if lock acquired, false if project is busy.
   * Automatically releases stale locks older than PROJECT_LOCK_TIMEOUT_MS.
   */
  acquireProjectLock(projectId: string, sessionId: string): boolean {
    const existing = this.projectLocks.get(projectId);
    if (existing) {
      // Check if stale
      if (Date.now() - existing.startedAt < PROJECT_LOCK_TIMEOUT_MS) {
        return false; // Lock is still held
      }
      // Stale lock — evict and allow acquisition
    }
    this.projectLocks.set(projectId, { sessionId, startedAt: Date.now() });
    return true;
  }

  /**
   * Release project-level lock.
   * Only releases if the sessionId matches the current lock holder.
   */
  releaseProjectLock(projectId: string, sessionId: string): void {
    const existing = this.projectLocks.get(projectId);
    if (existing && existing.sessionId === sessionId) {
      this.projectLocks.delete(projectId);
    }
  }

  /**
   * Check if a project is locked by another session.
   * Returns the locked session info or null.
   */
  getProjectLock(projectId: string): { sessionId: string; startedAt: number } | null {
    const existing = this.projectLocks.get(projectId);
    if (!existing) return null;
    if (Date.now() - existing.startedAt >= PROJECT_LOCK_TIMEOUT_MS) {
      this.projectLocks.delete(projectId); // evict stale
      return null;
    }
    return existing;
  }

  /**
   * Execute a function with project-level locking for state-changing operations.
   * If the lock cannot be acquired, returns an error object.
   * Otherwise, acquires the lock, executes the function, and releases the lock.
   */
  async executeWithProjectLock<T>(
    sessionId: string,
    projectId: string,
    fn: () => Promise<T>,
  ): Promise<T | { error: 'project_busy'; sessionId: string; message: string }> {
    if (!this.acquireProjectLock(projectId, sessionId)) {
      const lock = this.getProjectLock(projectId);
      return {
        error: 'project_busy',
        sessionId: lock?.sessionId ?? 'unknown',
        message: `Project ${projectId} has an ongoing operation. Please wait.`,
      };
    }
    try {
      return await fn();
    } finally {
      this.releaseProjectLock(projectId, sessionId);
    }
  }
}
