import type { LanguageModel, ToolSet } from 'ai';
import type { Database } from '../db/index.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
import { Agent } from './agent.js';
import type { ContextProvider, LLMProvider } from './prompts.js';

export const MAX_POOL_SIZE = 5;
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

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
      this.recoveryAgent = this.createAgent();
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
}
