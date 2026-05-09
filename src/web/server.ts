import { createAdaptorServer } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync, unlinkSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

import { VERSION } from '../version.js';
import { createApiRoutes } from './api/routes.js';
import { createWebhookRoutes } from './api/webhook-routes.js';
import { createDomainRoutes } from './api/domain-routes.js';
import { createResourceRoutes } from './api/resource-routes.js';
import { createSetupRoutes } from './api/setup-routes.js';
import { createTerminalRoutes } from './api/terminal-routes.js';
import { createChatRoutes } from './api/chat-routes.js';
import { createLlmRoutes } from './api/llm-routes.js';
import { createAuthRoutes } from './api/auth-routes.js';
import { createAuthMiddleware, isAuthenticated } from './middleware/auth.js';
import { createCorsOriginPolicy } from './middleware/cors-policy.js';
import { AuthService } from '../auth/auth-service.js';
import { createMcpHttpRoutes } from '../mcp/server.js';
import { OpenLanderError } from '../errors.js';
import pc from 'picocolors';
import { SlackChannel, createSlackWebhookHandler } from '../channels/slack.js';
import { DiscordChannel, createDiscordInteractionHandler } from '../channels/discord.js';
import { TelegramChannel, createTelegramWebhookHandler } from '../channels/telegram.js';
import { EmailChannel } from '../channels/email.js';
import { shutdownAppContext } from '../app.js';
import type { AppContext } from '../app.js';
import type { NodeWebSocket } from '@hono/node-ws';
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
interface CreateAppOptions {
  app?: Hono;
  upgradeWebSocket?: UpgradeWebSocketHandler;
}

export type UpgradeWebSocketHandler = NodeWebSocket['upgradeWebSocket'];

/**
 * Print the one-time setup secret to the server console when no password has
 * been configured yet. The secret authorizes the very first call to
 * `/auth/setup-password`, preventing a third party on the same network from
 * silently claiming the admin account on a fresh install.
 *
 * Idempotent: returns the same secret if invoked multiple times before setup
 * completes; returns null (and prints nothing) once a password exists.
 */
async function announceSetupSecretIfNeeded(authService: AuthService): Promise<void> {
  const secret = await authService.getOrCreateSetupSecret();
  if (!secret) {
    return;
  }

  const banner = pc.cyan('═'.repeat(60));
  console.log();
  console.log(banner);
  console.log(pc.bold('  OpenLander first-run setup'));
  console.log(banner);
  console.log(`  ONE-TIME SETUP SECRET: ${pc.bold(pc.yellow(secret))}`);
  console.log('  Paste this into the setup form to claim the admin account.');
  console.log('  This value lives in memory only and rotates on restart.');
  console.log(
    pc.dim(
      '  Note: this secret and the initial password travel over plain HTTP.\n' +
        '  On an untrusted network, run setup over HTTPS or through an SSH tunnel.',
    ),
  );
  console.log(banner);
  console.log();
}

function startMonitoring(ctx: AppContext): void {
  ctx.dockerEventListener?.start();
  ctx.projectHealthMonitor.start();
  ctx.containerStateReconciler.start();
  ctx.serviceHealthMonitor.start();
  ctx.systemMaintenanceMonitor.start();
  ctx.alertMonitor.start();
}

function createApp(
  ctx: AppContext,
  options: CreateAppOptions = {},
): {
  app: Hono;
  mcpRoutes: ReturnType<typeof createMcpHttpRoutes>;
  authService: AuthService;
} {
  const app = options.app ?? new Hono();

  // Global error handler — fallback for any router that doesn't define its own onError.
  // Sub-routers (e.g. createApiRoutes) may register their own onError; those take precedence.
  app.onError((err, c) => {
    if (err instanceof OpenLanderError) {
      return c.json(err.toJSON(), err.statusCode as 400);
    }
    log.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled route error');
    return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
  });

  app.use('*', logger());

  // Security response headers (Day 13 M1, narrowed by Day 14 follow-up).
  // Applied to every response so static HTML, JSON APIs, and webhook
  // endpoints all share the same baseline. CSP intentionally omits
  // 'unsafe-eval' and 'unsafe-inline' for scripts; styles allow inline
  // because Vite's build emits a small inline style for hashed asset
  // preloads.
  //
  // `connect-src` was originally `'self' ws: wss:` which permits any
  // WebSocket origin on the open internet — too broad for an admin UI.
  // Day 14 narrows it to `'self'` (same-origin XHR + WS) by default so
  // that ws/wss connections can only target the daemon itself. Operators
  // who run the UI behind a different origin (e.g. forward the daemon
  // from an SSH tunnel and proxy WS to it) can extend the policy via
  // `OPENLANDER_CSP_CONNECT_SRC` — that env var is appended verbatim, so
  // it can include `wss://other.example.com` etc.
  //
  // HSTS is only emitted when the request was forwarded over HTTPS —
  // bare HTTP installs (the default) must not strict-pin browsers to a
  // scheme they cannot serve.
  const cspExtraConnectSrc = (process.env['OPENLANDER_CSP_CONNECT_SRC'] ?? '').trim();
  const connectSrcDirective = cspExtraConnectSrc
    ? `connect-src 'self' ${cspExtraConnectSrc}`
    : "connect-src 'self'";
  const cspHeader =
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
    `script-src 'self'; ${connectSrcDirective}; frame-ancestors 'none'; ` +
    "base-uri 'self'; form-action 'self'";

  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('X-Content-Type-Options')) {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    }
    if (!c.res.headers.has('X-Frame-Options')) {
      c.res.headers.set('X-Frame-Options', 'DENY');
    }
    if (!c.res.headers.has('Referrer-Policy')) {
      c.res.headers.set('Referrer-Policy', 'no-referrer');
    }
    if (!c.res.headers.has('Content-Security-Policy')) {
      c.res.headers.set('Content-Security-Policy', cspHeader);
    }
    const forwardedProto = c.req.header('x-forwarded-proto');
    if (forwardedProto && forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https') {
      if (!c.res.headers.has('Strict-Transport-Security')) {
        c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    }
  });

  app.use(
    '/api/*',
    cors({
      origin: createCorsOriginPolicy(ctx.config.server.corsOrigin, ctx.config.server.baseUrl),
      credentials: false,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );

  const authService = new AuthService(ctx.db);
  app.use('*', createAuthMiddleware(authService));

  // Health check (enhanced with uptime)
  app.get('/health', async (c) => {
    const uptimeSeconds = getServerUptime();
    const uptime = formatUptime(uptimeSeconds);

    let dockerContainers = 0;
    try {
      const containers = await ctx.docker.listManagedContainers();
      dockerContainers = containers.length;
    } catch (err) {
      log.debug({ err }, 'Docker container list failed during health check');
      // Docker not accessible
    }

    return c.json({
      status: 'ok',
      version: VERSION,
      llmConfigured: false,
      llmStatus: 'offline',
      timestamp: new Date().toISOString(),
      uptime,
      dockerContainers,
      environments: ['production', 'development'] as const,
    });
  });

  const authRoutes = createAuthRoutes(authService, ctx);
  app.route('/api', authRoutes);

  const apiRoutes = createApiRoutes(ctx);
  app.route('/api', apiRoutes);

  const setupRoutes = createSetupRoutes(ctx);
  app.route('/api', setupRoutes);

  // Git-provider auto-deploy webhooks are intentionally disabled in 0.1.
  const webhookRoutes = createWebhookRoutes(ctx);
  app.route('/api', webhookRoutes);

  const terminalRoutes = createTerminalRoutes(ctx, options.upgradeWebSocket);
  app.route('/api', terminalRoutes);

  // v0.2: Domain management routes
  const domainRoutes = createDomainRoutes(ctx);
  app.route('/api', domainRoutes);

  // Resource limits management routes
  const resourceRoutes = createResourceRoutes(ctx);
  app.route('/api', resourceRoutes);

  const chatRoutes = createChatRoutes(ctx);
  app.route('/api', chatRoutes);

  const llmRoutes = createLlmRoutes(ctx);
  app.route('/api', llmRoutes);

  const mcpRoutes = createMcpHttpRoutes(ctx);
  app.route('/mcp', mcpRoutes);

  // v0.4: Channel webhook routes
  if (ctx.config.channels.slack.enabled) {
    const slackChannel = new SlackChannel({
      token: ctx.config.channels.slack.token,
      signingSecret: ctx.config.channels.slack.signingSecret,
      channelManager: ctx.channelManager,
      questionBridge: ctx.questionBridge,
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
      questionBridge: ctx.questionBridge,
    });
    ctx.channelManager.register('discord', discordChannel);
    app.post('/webhooks/discord', createDiscordInteractionHandler(discordChannel));
  }

  if (ctx.config.channels.telegram.enabled) {
    const telegramChannel = new TelegramChannel({
      token: ctx.config.channels.telegram.token,
      channelManager: ctx.channelManager,
      webhookSecret: ctx.config.channels.telegram.webhookSecret || undefined,
      questionBridge: ctx.questionBridge,
    });
    ctx.channelManager.register('telegram', telegramChannel);
    app.post('/webhooks/telegram', createTelegramWebhookHandler(telegramChannel));
  }

  if (ctx.config.channels.email.enabled && ctx.config.channels.email.host) {
    const emailChannel = new EmailChannel({
      host: ctx.config.channels.email.host,
      port: ctx.config.channels.email.port,
      secure: ctx.config.channels.email.secure,
      auth: ctx.config.channels.email.auth,
      from: ctx.config.channels.email.from,
      to: ctx.config.channels.email.to,
    });
    ctx.channelManager.register('email', emailChannel);
  }

  // /api/info exposes server name to anonymous callers but withholds
  // version/mode until the request is authenticated. Day 13 M5: a public
  // version banner makes CVE targeting trivial.
  app.get('/api/info', (c) => {
    if (isAuthenticated(c)) {
      return c.json({
        name: 'OpenLander',
        version: VERSION,
        mode: 'headless',
        docs: '/health',
        api: '/api',
      });
    }
    return c.json({ name: 'OpenLander' });
  });

  const WEB_DIST = join(dirname(new URL(import.meta.url).pathname), '../web/dist');

  const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
  };

  app.get('/assets/*', async (c) => {
    const filePath = join(WEB_DIST, c.req.path);
    if (existsSync(filePath)) {
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = readFileSync(filePath);
      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
    return c.notFound();
  });

  app.get('*', async (c) => {
    if (
      c.req.path.startsWith('/api/') ||
      c.req.path.startsWith('/webhooks/') ||
      c.req.path === '/health'
    ) {
      return c.notFound();
    }

    const indexPath = join(WEB_DIST, 'index.html');
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, 'utf-8');
      return c.html(html);
    }
    return c.json(
      { name: 'OpenLander', message: 'Web UI not built. Run: cd web && npm run build' },
      404,
    );
  });

  return { app, mcpRoutes, authService };
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
  const app = new Hono();
  const wsAdapter = createNodeWebSocket({ app });
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { injectWebSocket, upgradeWebSocket } = wsAdapter;
  const { app: appWithRoutes, authService } = createApp(ctx, { app, upgradeWebSocket });

  const server = createAdaptorServer(appWithRoutes);

  server.listen(options.port, options.host, () => {
    log.info({ version: VERSION, port: options.port }, `OpenLander v${VERSION} listening`);
    // Announce data-model alignment phase. 1.0 GA = full split:
    // schema migration 0009 (projects → groups + services with kind),
    // MCP composite namespace rename (openlander_service is now deployable-
    // vocab; today's managed-only moved to openlander_managed_service),
    // 17 frontend hook call sites rewired, REST handlers natively read the
    // new shape. See ralplan-data-model-full-migration for full runbook.
    log.info(
      {
        phase: '1.0',
        scope: 'GA-full-split',
        followup: 'legacy-column-drop in 1.0.x patch',
      },
      '[data-model-alignment] phase=1.0 (GA-full-split) followup=legacy-column-drop',
    );
    const host = options.host || 'localhost';
    console.log(`\n  OpenLander v${VERSION}\n  http://${host}:${String(options.port)}\n`);
    void announceSetupSecretIfNeeded(authService);
  });
  injectWebSocket(server);

  startMonitoring(ctx);

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
 * CLI and local clients connect via the Unix socket to interact with the daemon.
 */
export function startDaemon(options: DaemonOptions, ctx: AppContext): Promise<void> {
  serverStartTime = Date.now();
  const { app, mcpRoutes, authService } = createApp(ctx);

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
      chmodSync(options.socketPath, 0o660);
      log.debug({ socketPath: options.socketPath }, 'Daemon listening');
      void announceSetupSecretIfNeeded(authService);
      resolve();
    });
  });

  startMonitoring(ctx);

  // v0.4: Start channel connections
  void ctx.channelManager.start();

  // Handle graceful shutdown
  const cleanup = (): void => {
    log.info('Daemon shutting down');
    void shutdownAppContext(ctx).catch((err: unknown) => {
      log.warn({ err }, 'Failed to shutdown app context cleanly');
    });
    mcpRoutes.cleanup();
    server.close();
    if (existsSync(options.socketPath)) {
      unlinkSync(options.socketPath);
    }
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return ready;
}
