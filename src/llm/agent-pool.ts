import type { LanguageModel, ToolSet } from 'ai';
import type { Database } from '../db/index.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
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
  'redeploy_project',
  'rollback_project',
  'stop_project',
  'remove_project',
  'deploy_blue_green',
  'restart_project',
]);

/**
 * Stale lock timeout: 5 minutes.
 * If a lock is older than this, it's considered abandoned and can be evicted.
 */
export const PROJECT_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

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
        return this.createAgent();
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

  private createAgent(): Agent {
    const agent = new Agent(this.model, this.db, this.contextProvider, this.provider, this.locale);
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
