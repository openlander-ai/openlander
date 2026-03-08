import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import { OpenLanderError } from '../../errors.js';
import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
import { SessionStore } from '../session.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createDeployStreamRoutes } from './deploy-stream-routes.js';
import { createProjectRoutes } from './project-routes.js';
import { createSystemRoutes } from './system-routes.js';

const log = createModuleLogger('api');

interface ActivityEvent {
  type: string;
  project: string;
  user: string;
  status: string;
  detail?: string;
  time: string;
}

const activityBuffer: ActivityEvent[] = [];
const MAX_ACTIVITY = 100;

export function createApiRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // --- Error handler ---
  api.onError((err, c) => {
    if (err instanceof OpenLanderError) {
      return c.json(err.toJSON(), err.statusCode as 400);
    }
    log.error({ err }, 'API Error');
    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
  });

  // --- Session Store ---
  const sessionStore = new SessionStore(ctx.db);

  // --- Event Subscription for Activity Buffer ---

  const eventToStatus: Partial<Record<EventType, string>> = {
    'deploy:start': 'building',
    'deploy:clone': 'cloning',
    'deploy:build': 'building',
    'deploy:run': 'starting',
    'deploy:success': 'running',
    'deploy:failed': 'error',
    'deploy:rollback': 'rolling-back',
    'container:start': 'running',
    'container:stop': 'stopped',
    'container:remove': 'removed',
    'container:health': 'health-check',
    'compose:start': 'building',
    'compose:up': 'running',
    'compose:failed': 'error',
    'tunnel:start': 'tunnel-starting',
    'tunnel:stop': 'tunnel-stopped',
    'tunnel:url': 'tunnel-active',
    'env:set': 'env-updated',
    'env:delete': 'env-deleted',
  };

  const eventTypes: EventType[] = [
    'deploy:start',
    'deploy:clone',
    'deploy:build',
    'deploy:run',
    'deploy:success',
    'deploy:failed',
    'deploy:rollback',
    'container:start',
    'container:stop',
    'container:remove',
    'container:health',
    'tunnel:start',
    'tunnel:stop',
    'tunnel:url',
    'env:set',
    'env:delete',
    'compose:start',
    'compose:up',
    'compose:failed',
  ];

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
      const projectId = (payload as { projectId?: string }).projectId;
      if (!projectId) return;

      const project = ctx.db.getProject(projectId);
      const projectName = project?.name ?? projectId;
      const status = eventToStatus[eventType] ?? 'unknown';

      const activityEvent: ActivityEvent = {
        type: eventType,
        project: projectName,
        user: 'system',
        status,
        time: new Date().toISOString(),
      };

      if (eventType === 'deploy:failed') {
        activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
      } else if (eventType === 'tunnel:url') {
        activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
      } else if (eventType === 'compose:failed') {
        activityEvent.detail = (payload as EventPayload['compose:failed']).error;
      }

      activityBuffer.push(activityEvent);
      if (activityBuffer.length > MAX_ACTIVITY) {
        activityBuffer.shift();
      }
    });
  }

  // Auto-release deploy locks on completion/failure
  eventBus.on('deploy:success', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('deploy:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:up', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });

  // --- Activity Streaming ---

  api.get('/activity', (c) => {
    const follow = c.req.query('follow');

    if (follow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        const unsubscribers: Array<() => void> = [];
        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              const projectId = (payload as { projectId?: string }).projectId;
              if (!projectId) return;

              const project = ctx.db.getProject(projectId);
              const projectName = project?.name ?? projectId;
              const status = eventToStatus[eventType] ?? 'unknown';

              const activityEvent: ActivityEvent = {
                type: eventType,
                project: projectName,
                user: 'system',
                status,
                time: new Date().toISOString(),
              };

              if (eventType === 'deploy:failed') {
                activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
              } else if (eventType === 'tunnel:url') {
                activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
              }

              void s.write(JSON.stringify(activityEvent) + '\n');
            }),
          );
        }

        s.onAbort(() => {
          for (const unsub of unsubscribers) {
            unsub();
          }
        });

        await Promise.resolve();
      });
    }

    return c.json({ activities: activityBuffer.slice(-20) });
  });

  // --- Session Management ---

  api.get('/sessions', (c) => {
    const sessions = sessionStore.listSessions();
    return c.json({ sessions });
  });

  api.get('/sessions/:id/messages', (c) => {
    const sessionId = c.req.param('id');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit') ?? '50', 10) : undefined;
    const messages = sessionStore.getMessages(sessionId, limit);
    return c.json({ messages });
  });

  // --- Global Secrets ---

  api.get('/secrets', (c) => {
    const secrets = ctx.env.getGlobalSecretsMasked();
    return c.json({ secrets });
  });

  api.post('/secrets', async (c) => {
    const body = await c.req.json<{ key: string; value: string; description?: string }>();
    if (!body.key || !body.value) {
      return c.json({ error: 'MISSING_FIELD', message: 'key and value are required' }, 400);
    }
    ctx.env.setGlobalSecret(body.key, body.value, body.description);
    return c.json({ status: 'saved', key: body.key });
  });

  api.delete('/secrets/:key', (c) => {
    const key = c.req.param('key');
    const deleted = ctx.env.deleteGlobalSecret(key);
    if (!deleted) {
      return c.json({ error: 'NOT_FOUND', message: `Secret "${key}" not found` }, 404);
    }
    return c.json({ status: 'deleted', key });
  });

  api.route('/', createDeployStreamRoutes(ctx));
  api.route('/', createProjectRoutes(ctx));
  api.route('/', createSystemRoutes(ctx));

  return api;
}
