import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { createApiRoutes } from './api/routes.js';
import { createWebhookRoutes } from './api/webhook-routes.js';
import { createDomainRoutes } from './api/domain-routes.js';
import { createAuthRoutes } from './api/auth-routes.js';
import { SlackChannel, createSlackWebhookHandler } from '../channels/slack.js';
import { DiscordChannel, createDiscordInteractionHandler } from '../channels/discord.js';
import { TelegramChannel, createTelegramWebhookHandler } from '../channels/telegram.js';
import type { AppContext } from '../app.js';

export interface ServerOptions {
  port: number;
  host: string;
}

/**
 * Create and start the OpenLander web server.
 *
 * Serves:
 * - REST API at /api/*
 * - Chat UI at / (static files from web/dist/)
 * - Health check at /health
 */
export function createServer(options: ServerOptions, ctx: AppContext): void {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );

  // Health check
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version: '0.4.0',
      llmConfigured: ctx.agent !== null,
      timestamp: new Date().toISOString(),
    }),
  );

  // API routes
  const apiRoutes = createApiRoutes(ctx);
  app.route('/api', apiRoutes);

  // v0.2: Webhook auto-redeploy routes
  const webhookRoutes = createWebhookRoutes(ctx);
  app.route('/api', webhookRoutes);

  // v0.2: Domain management routes
  const domainRoutes = createDomainRoutes(ctx);
  app.route('/api', domainRoutes);

  // v0.2: OAuth authentication routes
  const authRoutes = createAuthRoutes(ctx);
  app.route('/auth', authRoutes);

  // v0.4: Channel webhook routes
  if (ctx.config.channels.slack.enabled) {
    const slackChannel = new SlackChannel({
      token: ctx.config.channels.slack.token,
      signingSecret: ctx.config.channels.slack.signingSecret,
      channelManager: ctx.channelManager,
    });
    ctx.channelManager.register('slack', slackChannel);
    app.post('/webhooks/slack', createSlackWebhookHandler(slackChannel));
  }

  if (ctx.config.channels.discord.enabled) {
    const discordChannel = new DiscordChannel({
      applicationId: ctx.config.channels.discord.applicationId,
      publicKey: ctx.config.channels.discord.publicKey,
      token: ctx.config.channels.discord.token,
      channelManager: ctx.channelManager,
    });
    ctx.channelManager.register('discord', discordChannel);
    app.post('/webhooks/discord', createDiscordInteractionHandler(discordChannel));
  }

  if (ctx.config.channels.telegram.enabled) {
    const telegramChannel = new TelegramChannel({
      token: ctx.config.channels.telegram.token,
      channelManager: ctx.channelManager,
      webhookSecret: ctx.config.channels.telegram.webhookSecret || undefined,
    });
    ctx.channelManager.register('telegram', telegramChannel);
    app.post('/webhooks/telegram', createTelegramWebhookHandler(telegramChannel));
  }

  // Static file serving for Chat UI
  // Resolve web/dist relative to project root (2 levels up from src/web/)
  const webDistPath = resolveWebDist();

  if (webDistPath) {
    // Read index.html once at startup for SPA fallback
    const indexHtml = readFileSync(join(webDistPath, 'index.html'), 'utf-8');

    // Serve static assets (JS, CSS, images, etc.)
    app.use('/assets/*', serveStatic({ root: webDistPath }));

    // Serve other static files (favicon, etc.)
    app.use('/favicon*', serveStatic({ root: webDistPath }));

    // SPA fallback: serve index.html for all non-API, non-asset routes
    app.get('*', (c) => {
      return c.html(indexHtml);
    });
  } else {
    // No built frontend — show fallback page
    app.get('/', (c) => c.html(getFallbackHtml()));
  }

  // Start server
  serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.host,
  });

  // v0.2: Start health monitoring
  ctx.healthMonitor.start();

  // v0.4: Start channel connections
  void ctx.channelManager.start();
}

/**
 * Resolve the path to web/dist/ directory.
 * Checks multiple possible locations relative to the running process.
 */
function resolveWebDist(): string | null {
  const candidates = [
    // Running from project root (npm run dev / ts-node)
    resolve(process.cwd(), 'web', 'dist'),
    // Running from dist/ (compiled CLI)
    resolve(process.cwd(), '..', 'web', 'dist'),
    // Relative to this file's location
    resolve(new URL('.', import.meta.url).pathname, '..', '..', '..', 'web', 'dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return null;
}

/** Fallback HTML when no built frontend is available. */
function getFallbackHtml(): string {
  return `
    <!DOCTYPE html>
    <html>
      <head><title>OpenLander</title></head>
      <body>
        <h1>\uD83D\uDEEC OpenLander</h1>
        <p>Chat UI not built yet. Run <code>cd web && npm run build</code> first.</p>
        <h3>Quick Links</h3>
        <ul>
          <li><a href="/health">Health Check</a></li>
          <li><a href="/api/projects">List Projects</a></li>
          <li><a href="/api/system/stats">System Stats</a></li>
        </ul>
      </body>
    </html>
  `;
}
