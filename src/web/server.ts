import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { createApiRoutes } from './api/routes.js';
import { createWebhookRoutes } from './api/webhook-routes.js';
import { createDomainRoutes } from './api/domain-routes.js';
import { createAuthRoutes } from './api/auth-routes.js';
import { createSetupRoutes } from './api/setup-routes.js';
import { SlackChannel, createSlackWebhookHandler } from '../channels/slack.js';
import { DiscordChannel, createDiscordInteractionHandler } from '../channels/discord.js';
import { TelegramChannel, createTelegramWebhookHandler } from '../channels/telegram.js';
import type { AppContext } from '../app.js';

export interface ServerOptions {
  port: number;
  host: string;
}

/**
 * Create and start the OpenLander headless API server.
 *
 * Serves:
 * - REST API at /api/*
 * - Health check at /health
 * - Webhook endpoints at /webhooks/*
 * - OAuth routes at /auth/*
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

  const setupRoutes = createSetupRoutes(ctx);
  app.route('/api', setupRoutes);

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

  // Root endpoint — headless API server info
  app.get('/', (c) =>
    c.json({
      name: 'OpenLander',
      version: '0.4.0',
      mode: 'headless',
      docs: '/health',
      api: '/api',
    }),
  );

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

