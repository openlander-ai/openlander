import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { createModuleLogger } from '../../lib/logger.js';
import { assertUrlSafetyOrThrow, MCP_ALLOWED_SCHEMES } from '../../lib/url-safety.js';

const log = createModuleLogger('api');

const WEBHOOK_KEY = 'notification_webhook';

interface WebhookConfig {
  url: string;
  events: string[];
}

/**
 * Strip embedded user/password from a URL before returning it to the
 * caller. The webhook URL may legitimately contain credentials (`https://
 * user:pass@host/path`) since some platforms accept basic-auth that way,
 * but we don't want to leak the secret on a settings GET. The check
 * itself happens at write time (`assertUrlSafetyOrThrow`); this is a
 * defense-in-depth read-time scrub for previously-stored values.
 */
function redactUserInfo(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.username || u.password) {
      return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Phase E_NEW Task 7 — notifications webhook persistence.
 * Single-row keyed on `'notification_webhook'` in the `settings` table.
 * Value is JSON-stringified `{ url: string, events: string[] }`.
 *
 * GET    → 404 when no row exists, else { url, events[] }
 * POST   → upsert single row, return 200 with saved object
 * DELETE → idempotent 200 (no error if key absent)
 */
export function createNotificationsRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/settings/notifications/webhook', async (c) => {
    try {
      const row = await ctx.db.getSetting(WEBHOOK_KEY);
      if (!row) {
        return c.json({ error: 'NOT_FOUND', message: 'No webhook configured' }, 404);
      }

      const parsed = JSON.parse(row.value) as unknown;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('url' in parsed) ||
        typeof (parsed as Record<string, unknown>).url !== 'string'
      ) {
        return c.json(
          { error: 'INTERNAL_ERROR', message: 'Stored webhook config is malformed' },
          500,
        );
      }

      const config = parsed as WebhookConfig;
      return c.json({ url: redactUserInfo(config.url), events: config.events });
    } catch (err) {
      log.debug({ err }, 'Get notification webhook failed');
      return c.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to fetch notification webhook' },
        500,
      );
    }
  });

  api.post('/settings/notifications/webhook', async (c) => {
    let body: { url?: unknown; events?: unknown };
    try {
      body = await c.req.json<{ url?: unknown; events?: unknown }>();
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be valid JSON' }, 400);
    }

    if (!body.url || typeof body.url !== 'string' || !body.url.trim()) {
      return c.json({ error: 'MISSING_FIELD', message: 'url is required' }, 400);
    }

    if (!Array.isArray(body.events) || !body.events.every((e) => typeof e === 'string')) {
      return c.json({ error: 'INVALID_FIELD', message: 'events must be an array of strings' }, 400);
    }

    const trimmedUrl = body.url.trim();

    // SSRF guard — refuse loopback / link-local / RFC1918 / cloud
    // metadata hosts and non-http(s) schemes. Same allowlist as the MCP
    // HTTP/SSE transport so an authenticated user can't pivot the
    // daemon into another tenant or the IMDS endpoint via a webhook.
    try {
      assertUrlSafetyOrThrow(trimmedUrl, { allowedSchemes: MCP_ALLOWED_SCHEMES });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unsafe URL';
      return c.json(
        { error: 'INVALID_FIELD', message: `url is not a safe webhook target: ${reason}` },
        400,
      );
    }

    const config: WebhookConfig = {
      url: trimmedUrl,
      events: body.events,
    };

    try {
      await ctx.db.upsertSetting(WEBHOOK_KEY, JSON.stringify(config));
      return c.json(config);
    } catch (err) {
      log.debug({ err }, 'Save notification webhook failed');
      return c.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to save notification webhook' },
        500,
      );
    }
  });

  api.delete('/settings/notifications/webhook', async (c) => {
    try {
      await ctx.db.deleteSetting(WEBHOOK_KEY);
      return c.json({ status: 'deleted' });
    } catch (err) {
      log.debug({ err }, 'Delete notification webhook failed');
      return c.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to delete notification webhook' },
        500,
      );
    }
  });

  return api;
}
