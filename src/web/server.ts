import { serve, createAdaptorServer } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, unlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { createApiRoutes } from './api/routes.js';
import { createWebhookRoutes } from './api/webhook-routes.js';
import { createDomainRoutes } from './api/domain-routes.js';
import { createSetupRoutes } from './api/setup-routes.js';
import { SlackChannel, createSlackWebhookHandler } from '../channels/slack.js';
import { DiscordChannel, createDiscordInteractionHandler } from '../channels/discord.js';
import { TelegramChannel, createTelegramWebhookHandler } from '../channels/telegram.js';
import type { AppContext } from '../app.js';
const log = createModuleLogger('web');

import { createModuleLogger } from '../lib/logger.js';

// --- Uptime Tracking ---

let serverStartTime = Date.now();

/**
 * Format uptime in human-readable form (e.g., "14d 3h", "2h 45m", "5m 12s").
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  if (mins > 0) parts.push(`${String(mins)}m`);
  if (parts.length === 0) parts.push(`${String(secs)}s`);

  return parts.join(' ');
}

/** Get seconds since server start. */
export function getServerUptime(): number {
  return Math.floor((Date.now() - serverStartTime) / 1000);
}

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
// --- Shared Hono app builder ---

/**
 * Build the Hono application with all routes and middleware.
 * Shared by both TCP createServer and Unix socket startDaemon.
 */
function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  // Middleware — suppress HTTP request logs when TUI is active
  if (!process.env['OPENLANDER_TUI']) {
    app.use('*', logger());
  }
  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );

  // Health check (enhanced with uptime)
  app.get('/health', async (c) => {
    const uptimeSeconds = getServerUptime();
    const uptime = formatUptime(uptimeSeconds);

    let dockerContainers = 0;
    try {
      const containers = await ctx.docker.getClient().listContainers({
        filters: { label: ['openlander.managed=true'] },
      });
      dockerContainers = containers.length;
    } catch (err) {
      log.debug({ err }, 'Docker container list failed during health check');
      // Docker not accessible
    }

    return c.json({
      status: 'ok',
      version: '0.4.0',
      llmConfigured: ctx.agent !== null,
      timestamp: new Date().toISOString(),
      uptime,
      dockerContainers,
    });
  });

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

  // Root endpoint — server info
  app.get('/', (c) =>
    c.json({
      name: 'OpenLander',
      version: '0.4.0',
      mode: 'headless',
      docs: '/health',
      api: '/api',
    }),
  );

  return app;
}

// --- TCP Server (existing behavior) ---

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
  serverStartTime = Date.now();
  const app = createApp(ctx);

  // Start server
  serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.host,
  });

  // v0.2: Start health monitoring
  ctx.healthMonitor.start();
  ctx.alertMonitor.start();

  // v0.4: Start channel connections
  void ctx.channelManager.start();
}

// --- Unix Socket Daemon ---

export interface DaemonOptions {
  socketPath: string;
}

/**
 * Start the OpenLander daemon, listening on a Unix socket.
 *
 * Used by `openlander start` for the daemon/client architecture.
 * TUI clients connect via the Unix socket to interact with the daemon.
 */
export function startDaemon(options: DaemonOptions, ctx: AppContext): Promise<void> {
  serverStartTime = Date.now();
  const app = createApp(ctx);

  // Ensure socket directory exists
  mkdirSync(dirname(options.socketPath), { recursive: true });

  // Clean up stale socket file
  if (existsSync(options.socketPath)) {
    unlinkSync(options.socketPath);
  }

  // Create HTTP server bound to Unix socket
  const server = createAdaptorServer(app);

  const ready = new Promise<void>((resolve) => {
    server.listen(options.socketPath, () => {
      chmodSync(options.socketPath, 0o666);
      log.debug({ socketPath: options.socketPath }, 'Daemon listening');
      resolve();
    });
  });

  // v0.2: Start health monitoring
  ctx.healthMonitor.start();
  ctx.alertMonitor.start();

  // v0.4: Start channel connections
  void ctx.channelManager.start();

  // Handle graceful shutdown
  const cleanup = (): void => {
    log.info('Daemon shutting down');
    server.close();
    if (existsSync(options.socketPath)) {
      unlinkSync(options.socketPath);
    }
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return ready;
}
