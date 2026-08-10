/**
 * ActivityLogger — persists EventBus events to the activity_log table.
 *
 * Subscribes to all monitored event types and writes each event
 * as an activity_log row via Database.insertActivityLog().
 *
 * CRITICAL: handlers return void (not Promise) to avoid blocking
 * the EventBus emit chain. Persistence is fire-and-forget.
 */

import type { Database } from '../db/index.js';
import type { EventBus, EventType, EventPayload } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { buildActivityEvent } from './activity-event-mapper.js';

const log = createModuleLogger('activity-logger');

/** All event types that should be persisted to activity_log. */
const PERSISTED_EVENT_TYPES: EventType[] = [
  'deploy:start',
  'deploy:clone',
  'deploy:build',
  'deploy:run',
  'deploy:success',
  'deploy:failed',
  'deploy:crash',
  'deploy:rollback',
  'container:start',
  'container:stop',
  'container:remove',
  'container:health',
  'container:die',
  'container:oom',
  'container:missing',
  'tunnel:start',
  'tunnel:stop',
  'tunnel:url',
  'env:set',
  'env:delete',
  'public-access:enabled',
  'public-access:disabled',
  'public-access:code-rotated',
  'public-access:verification-failed',
  'compose:start',
  'compose:up',
  'compose:failed',
  'monitor:inactive',
  'health:degraded',
  'recovery:start',
  'recovery:success',
  'recovery:failed',
  'recovery:exhausted',
  'recovery:approval-needed',
  'recovery:approval-auto-skipped',
  'recovery:approval-resolved',
  'recovery:blocked',
  'recovery:degraded',
  'recovery:stopped',
  'recovery:started',
  'ai:invoked',
  'ai:completed',
  'alert:new',
  'alert:resolved',
  // Day 9 F5: surface webhook policy-skips so operators see the inbound push.
  'webhook:skipped',
];

export class ActivityLogger {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly db: Database,
  ) {}

  /** Subscribe to all monitored event types and start persisting. */
  start(): void {
    for (const eventType of PERSISTED_EVENT_TYPES) {
      const unsub = this.eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
        // Defer insert via queueMicrotask to avoid blocking the EventBus emit path
        queueMicrotask(() => {
          void (async () => {
            try {
              const activity = await buildActivityEvent(this.db, eventType, payload);
              if (!activity) return;

              // Extract correlationId from payload when available
              const correlationId =
                activity.correlationId ??
                (payload as { correlationId?: string }).correlationId ??
                undefined;

              const metadata: Record<string, unknown> = {};
              if (activity.incidentId) metadata.incidentId = activity.incidentId;
              if (activity.actionRunId) metadata.actionRunId = activity.actionRunId;
              if (activity.aiMetadata) metadata.aiMetadata = activity.aiMetadata;
              if (activity.reason) metadata.reason = activity.reason;
              const serviceId = (payload as { serviceId?: unknown }).serviceId;
              if (typeof serviceId === 'string') metadata.service_id = serviceId;

              await this.db.insertActivityLog({
                event_type: eventType,
                activity_type: activity.type,
                severity: activity.severity,
                project_id: activity.projectId,
                correlation_id: correlationId ?? null,
                title: activity.title,
                description: activity.description,
                status: activity.status,
                metadata: JSON.stringify(metadata),
              });
            } catch (err) {
              log.error({ err, eventType }, 'Failed to persist activity event');
            }
          })();
        });
      });
      this.unsubscribers.push(unsub);
    }

    log.info(
      { eventCount: PERSISTED_EVENT_TYPES.length },
      'ActivityLogger started — persisting events to activity_log',
    );
  }

  /** Unsubscribe from all events. */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    log.info('ActivityLogger stopped');
  }
}
