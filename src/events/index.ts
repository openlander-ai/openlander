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

const log = createModuleLogger('events');

// --- Event types ---
export type EventType =
  // Deploy lifecycle
  | 'deploy:start'
  | 'deploy:clone'
  | 'deploy:build'
  | 'deploy:run'
  | 'deploy:success'
  | 'deploy:failed'
  | 'deploy:rollback'
  // Container lifecycle
  | 'container:start'
  | 'container:stop'
  | 'container:remove'
  | 'container:health'
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
  | 'channel:connect';

export interface EventPayload {
  'deploy:start': { projectId: string; repoUrl: string };
  'deploy:clone': { projectId: string; path: string; commitSha: string };
  'deploy:build': { projectId: string; imageTag: string; durationMs: number };
  'deploy:run': { projectId: string; containerId: string; port: number; url: string };
  'deploy:success': { projectId: string; url: string; totalDurationMs: number };
  'deploy:failed': { projectId: string; step: string; error: string };
  'deploy:rollback': { projectId: string; fromImage: string; toImage: string };
  'container:start': { projectId: string; containerId: string };
  'container:stop': { projectId: string; containerId: string };
  'container:remove': { projectId: string; containerId: string };
  'container:health': { projectId: string; healthy: boolean };
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
}

// --- Event handler type ---

type EventHandler<T extends EventType> = (payload: EventPayload[T]) => void | Promise<void>;

// --- Event Bus ---

export class EventBus {
  private handlers = new Map<EventType, Set<EventHandler<EventType>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<T extends EventType>(event: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }

    const handlerSet = this.handlers.get(event);
    if (!handlerSet) {
      return () => { /* noop */ };
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
}

/** Singleton event bus instance for the application. */
export const eventBus = new EventBus();
