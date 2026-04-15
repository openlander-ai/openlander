/**
 * AiUsageListener — persists ai:usage EventBus events to the ai_usage_log table.
 *
 * Subscribes to the 'ai:usage' event and writes each event as an ai_usage_log row
 * via Database.createAiUsageLog().
 *
 * CRITICAL: handler returns void (not Promise) to avoid blocking
 * the EventBus emit chain. Persistence is fire-and-forget.
 */

import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { AiUsageLogRow } from '../db/schema.drizzle.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ai-usage-listener');

export class AiUsageListener {
  private unsubscriber: (() => void) | null = null;

  constructor(
    private readonly db: Database,
    private readonly eventBus: EventBus,
  ) {}

  /** Subscribe to ai:usage events and start persisting. */
  start(): void {
    this.unsubscriber = this.eventBus.on('ai:usage', (payload: EventPayload['ai:usage']) => {
      // Defer insert via queueMicrotask to avoid blocking the EventBus emit path
      queueMicrotask(() => {
        try {
          const actionType = payload.actionType ?? 'system';
          const source = payload.source ?? null;

          this.db.createAiUsageLog({
            action_type: actionType as AiUsageLogRow['action_type'],
            source: source as AiUsageLogRow['source'],
            model_name: payload.modelName,
            provider: payload.provider,
            input_tokens: payload.inputTokens,
            output_tokens: payload.outputTokens,
            total_tokens: payload.totalTokens,
            cost_usd: payload.costUsd ?? null,
            project_id: payload.projectId ?? null,
            session_id: payload.sessionId ?? null,
            tools_called: JSON.stringify(payload.toolsCalled ?? []),
            result: payload.result,
            duration_ms: payload.durationMs,
            user_id: null,
            tenant_id: null,
          });
        } catch (err) {
          log.warn({ err }, 'Failed to persist ai:usage event');
        }
      });
    });

    log.info('AiUsageListener started — persisting events to ai_usage_log');
  }

  /** Unsubscribe from ai:usage events. */
  stop(): void {
    if (this.unsubscriber) {
      this.unsubscriber();
      this.unsubscriber = null;
    }
    log.info('AiUsageListener stopped');
  }
}
