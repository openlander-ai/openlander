import type { AppContext } from '../app.js';
import { createModuleLogger } from '../lib/logger.js';
import type { OpsConfig, OpsEvent } from './ops-types.js';
import { DEFAULT_OPS_CONFIG } from './ops-types.js';

const log = createModuleLogger('ops-agent');

export class OpsAgent {
  private readonly ctx: AppContext;
  private config: OpsConfig;
  private queue: OpsEvent[] = [];
  private processing = false;
  private running = false;
  private readonly llmCallsPerProject = new Map<string, number[]>();
  private readonly llmCallsGlobal: number[] = [];
  private readonly maxConcurrentLLM = 3;
  private readonly maxConcurrentRecovery = 5;

  constructor(ctx: AppContext, config?: Partial<OpsConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_OPS_CONFIG, ...config };
    void this.ctx;
    void this.running;
    void this.maxConcurrentLLM;
    void this.maxConcurrentRecovery;
    void this.processQueue;
    void this.handleCrashEvent;
    void this.handleHealthDegraded;
    void this.handleDeployFailed;
    void this.handleRecoveryExhausted;
    void this.handleInactiveProject;
  }

  start(): Promise<void> {
    log.info('OpsAgent starting');
    this.running = true;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    log.info('OpsAgent stopping');
    this.running = false;
    return Promise.resolve();
  }

  enqueue(event: OpsEvent): void {
    this.queue.push(event);
  }

  private processQueue(): Promise<void> {
    void this.processing;
    return Promise.resolve();
  }

  private handleCrashEvent(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleHealthDegraded(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleDeployFailed(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleRecoveryExhausted(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleInactiveProject(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  generateDigest(): Promise<void> {
    void this.processing;
    return Promise.resolve();
  }

  isLlmRateLimited(projectId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3_600_000;
    const projectCalls = (this.llmCallsPerProject.get(projectId) ?? []).filter((t) => t > hourAgo);
    const globalCalls = this.llmCallsGlobal.filter((t) => t > hourAgo);
    return projectCalls.length >= 3 || globalCalls.length >= 20;
  }

  recordLlmCall(projectId: string): void {
    const now = Date.now();
    const existing = this.llmCallsPerProject.get(projectId) ?? [];
    this.llmCallsPerProject.set(projectId, [...existing, now]);
    this.llmCallsGlobal.push(now);
  }

  getConfig(): OpsConfig {
    return this.config;
  }

  reloadConfig(config: Partial<OpsConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
