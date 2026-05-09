import { Command } from 'commander';
import pc from 'picocolors';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { createModuleLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { getLanIp } from '../pipeline/traefik.js';
import type { ToolSet } from 'ai';

const log = createModuleLogger('cli');

const program = new Command();

/**
 * 1.0 GA: shared unhandledRejection handler used by both `openlander` and
 * `openlander start`. Logs the reason but keeps the host process alive so a
 * transient async failure (e.g. background LLM probe, Docker hiccup) does
 * not crash-loop under systemd / pm2 / docker. Errors that should bubble
 * to the user are surfaced through their own typed-error paths.
 */
function registerUnhandledRejectionHandler(): void {
  process.on('unhandledRejection', (reason) => {
    log.error(
      { reason },
      'Unhandled promise rejection — process will continue (check for LLM/Docker connectivity issues)',
    );
  });
}

// ── Default command: openlander (Web mode — default) ─────────────────────────

program
  .name('openlander')
  .description('AI agent that deploys your app from a chat')
  .version(VERSION)
  .option('-p, --port <port>', 'Port to listen on', '10114')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port: string; host: string; open?: boolean }) => {
    const port = parseInt(options.port, 10);

    // Step 1: Ensure Docker is ready
    const { ensureDocker } = await import('./onboard.js');
    await ensureDocker();

    // Step 2: Onboarding handled by Web UI (SetupScreen)
    // CLI no longer runs LLM/Git setup — just start the server

    // Step 3: Load config & create app context
    const { loadConfig, getDatabaseUrl } = await import('../config/index.js');

    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDatabaseUrl());

    registerUnhandledRejectionHandler();

    // Register tools with agent (including external MCP tools)
    if (ctx.agent) {
      const { createTools } = await import('../tools/index.js');
      const { mergeWithMcpTools } = await import('../mcp/client-manager.js');
      let tools: ToolSet = createTools(ctx, ctx.questionBridge);
      if (ctx.config.mcp.enabled && ctx.config.mcp.servers.length > 0) {
        await ctx.mcpClientManager.connectAll(ctx.config.mcp.servers);
        tools = await mergeWithMcpTools(tools, ctx.mcpClientManager);
      }
      ctx.agent.setTools(tools);
    }

    // Step 3: Traefik (auto-start or upgrade if config is outdated)
    try {
      await ctx.traefik.start();
    } catch (err) {
      log.debug({ err }, 'Traefik start failed');
      console.log(pc.yellow('  ⚠ Traefik could not start'));
    }

    // ── Web mode (default) ──
    const { createServer } = await import('../web/server.js');
    createServer({ port, host: options.host }, ctx);

    const lanIp = getLanIp();
    const localUrl = `http://localhost:${String(port)}`;
    const networkUrl = lanIp ? `http://${lanIp}:${String(port)}` : null;

    console.log();
    console.log(pc.bold(pc.cyan('  🛬 OpenLander')));
    console.log();
    console.log(pc.dim('  Local:   ') + pc.cyan(localUrl));
    if (networkUrl) {
      console.log(pc.dim('  Network: ') + pc.cyan(networkUrl));
    }
    console.log();

    // Open browser (unless --no-open)
    if (options.open !== false) {
      const { exec } = await import('node:child_process');
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${openCmd} ${localUrl}`, (err) => {
        if (err) log.debug({ err }, 'Failed to open browser');
      });
    }

    // Graceful shutdown
    const { shutdownAppContext } = await import('../app.js');
    const shutdown = (): void => {
      console.log(pc.dim('\n  Shutting down...'));
      void shutdownAppContext(ctx)
        .catch((err: unknown) => {
          log.warn({ err }, 'Failed to shutdown app context cleanly');
        })
        .finally(() => {
          process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ── openlander start ─────────────────────────────────────────────────────────
//
// 1.0 GA: OpenLander runs in the foreground only. The previous "background
// daemon" path silently bypassed PID-file management — `stop`/`restart` could
// not actually stop a running process and would happily double-start. The
// supported way to run OpenLander as a service is via systemd, pm2, Docker,
// or any other process supervisor of your choice.

program
  .command('start')
  .description('Start OpenLander in the foreground (use systemd/pm2/docker for background)')
  .option('-p, --port <port>', 'Port to listen on', '10114')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port: string; host: string; open?: boolean }) => {
    // `start` is now an alias for the default command — same behavior, clearer
    // intent. Background mode is intentionally not supported by the CLI; use a
    // process supervisor (systemd unit, pm2 ecosystem.config.cjs, Docker, ...)
    // to run OpenLander as a long-lived service.
    console.log(
      pc.dim(
        '  Foreground mode. To run in the background, use systemd, pm2, or docker.\n' +
          '  See README.md for sample systemd unit and pm2 ecosystem files.\n',
      ),
    );

    const port = parseInt(options.port, 10);

    const { ensureDocker } = await import('./onboard.js');
    await ensureDocker();

    const { loadConfig, getDatabaseUrl } = await import('../config/index.js');
    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDatabaseUrl());

    registerUnhandledRejectionHandler();

    if (ctx.agent) {
      const { createTools } = await import('../tools/index.js');
      const { mergeWithMcpTools } = await import('../mcp/client-manager.js');
      let tools: ToolSet = createTools(ctx, ctx.questionBridge);
      if (ctx.config.mcp.enabled && ctx.config.mcp.servers.length > 0) {
        await ctx.mcpClientManager.connectAll(ctx.config.mcp.servers);
        tools = await mergeWithMcpTools(tools, ctx.mcpClientManager);
      }
      ctx.agent.setTools(tools);
    }

    try {
      await ctx.traefik.start();
    } catch (err) {
      log.debug({ err }, 'Traefik start failed');
      console.log(pc.yellow('  ⚠ Traefik could not start'));
    }

    const { createServer } = await import('../web/server.js');
    createServer({ port, host: options.host }, ctx);

    const lanIp = getLanIp();
    const localUrl = `http://localhost:${String(port)}`;
    const networkUrl = lanIp ? `http://${lanIp}:${String(port)}` : null;

    console.log();
    console.log(pc.bold(pc.cyan('  🛬 OpenLander')));
    console.log();
    console.log(pc.dim('  Local:   ') + pc.cyan(localUrl));
    if (networkUrl) {
      console.log(pc.dim('  Network: ') + pc.cyan(networkUrl));
    }
    console.log();

    if (options.open !== false) {
      const { exec } = await import('node:child_process');
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${openCmd} ${localUrl}`, (err) => {
        if (err) log.debug({ err }, 'Failed to open browser');
      });
    }

    const { shutdownAppContext } = await import('../app.js');
    const shutdown = (): void => {
      console.log(pc.dim('\n  Shutting down...'));
      void shutdownAppContext(ctx)
        .catch((err: unknown) => {
          log.warn({ err }, 'Failed to shutdown app context cleanly');
        })
        .finally(() => {
          process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ── openlander stop ──────────────────────────────────────────────────────────
//
// OpenLander no longer self-manages a background daemon (see `start` above).
// `stop` cleans up any orphaned IPC socket file from older versions and
// points the user at the supported lifecycle tooling.

program
  .command('stop')
  .description('Inform the user how to stop OpenLander (no background daemon)')
  .action(async () => {
    const { getDataDir } = await import('../config/index.js');
    const socketPath = join(getDataDir(), 'openlander.sock');
    const pidPath = join(getDataDir(), 'openlander.pid');

    console.log(
      pc.yellow(
        'OpenLander does not run as a background daemon. Stop the foreground process directly,\n' +
          'or use your service manager (e.g. `systemctl stop openlander`, `pm2 stop openlander`,\n' +
          '`docker stop openlander`).',
      ),
    );

    // Best-effort cleanup of leftover artifacts from older daemon-mode installs.
    let cleaned = false;
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
        cleaned = true;
      } catch (err) {
        log.debug({ err, socketPath }, 'Failed to remove stale socket file');
      }
    }
    if (existsSync(pidPath)) {
      try {
        unlinkSync(pidPath);
        cleaned = true;
      } catch (err) {
        log.debug({ err, pidPath }, 'Failed to remove stale pid file');
      }
    }
    if (cleaned) {
      console.log(pc.dim('  (Cleaned up stale daemon artifacts from a previous install.)'));
    }

    process.exit(0);
  });

// ── openlander restart ───────────────────────────────────────────────────────
//
// Same rationale as `stop` — defer to the supervising process manager.

program
  .command('restart')
  .description('Inform the user how to restart OpenLander (no background daemon)')
  .action(() => {
    console.log(
      pc.yellow(
        'OpenLander does not run as a background daemon. Restart your supervising process\n' +
          '(e.g. `systemctl restart openlander`, `pm2 restart openlander`,\n' +
          '`docker restart openlander`), or stop the foreground process and run `openlander start`\n' +
          'again.',
      ),
    );
    process.exit(0);
  });

// ── openlander config ────────────────────────────────────────────────────────

program
  .command('config')
  .description('Manage configuration')
  .argument('[action]', 'Action: show (default), reset, or reset-password')
  .action(async (action) => {
    const { loadConfig, isOnboarded, getDataDir } = await import('../config/index.js');
    const configPath = join(getDataDir(), 'config.json');

    if (action === 'reset') {
      if (existsSync(configPath)) {
        try {
          unlinkSync(configPath);
          console.log(pc.green('Config reset. Run `openlander` to re-setup.'));
        } catch (err) {
          log.debug({ err, configPath }, 'Failed to reset config file');
          console.log(pc.red('Could not reset config. Check file permissions.'));
        }
      } else {
        console.log(pc.yellow('No config file found. Already reset.'));
      }
      return;
    }

    if (action === 'reset-password') {
      const { getDatabaseUrl } = await import('../config/index.js');
      const databaseUrl = getDatabaseUrl();

      if (!databaseUrl) {
        console.log(pc.red('No database URL configured. Set OPENLANDER_DATABASE_URL first.'));
        return;
      }

      const { password } = await import('@inquirer/prompts');

      const newPassword = await password({ message: 'New password:' });
      const confirmPassword = await password({ message: 'Confirm password:' });

      if (newPassword !== confirmPassword) {
        console.log(pc.red('Passwords do not match.'));
        return;
      }

      if (!newPassword) {
        console.log(pc.red('Password cannot be empty.'));
        return;
      }

      const { Database } = await import('../db/index.js');
      const { AuthService } = await import('../auth/auth-service.js');

      const db = await Database.connect(databaseUrl);
      const authService = new AuthService(db);
      await authService.resetPassword(newPassword);
      await db.close();

      console.log(pc.green('Password reset successfully.'));
      return;
    }

    // Default: show config
    if (!isOnboarded()) {
      console.log(pc.yellow('Not configured yet. Run `openlander` to start setup.'));
      return;
    }

    const config = loadConfig();

    console.log(pc.bold(pc.cyan('\n  OpenLander Configuration')));
    console.log(pc.dim(`  Config file: ${configPath}\n`));

    // Mask sensitive fields
    const masked = {
      ...config,
      llm: {
        ...config.llm,
        apiKey: config.llm.apiKey ? '***masked***' : '(not set)',
        authToken: config.llm.authToken ? '***masked***' : '(not set)',
      },
      cloudflare: {
        ...config.cloudflare,
        apiToken: config.cloudflare.apiToken ? '***masked***' : '(not set)',
      },
    };

    console.log(JSON.stringify(masked, null, 2));
    console.log();
  });

// ── openlander recover ──────────────────────────────────────────────────────

program
  .command('recover')
  .description('Recover containers after Docker migration (preserves data)')
  .option('--dry-run', 'Preview recovery actions without making changes')
  .action(async (options: { dryRun?: boolean }) => {
    const { loadConfig, getDatabaseUrl } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDatabaseUrl());

    const { recover } = await import('../pipeline/recover.js');
    const dryRun = options.dryRun ?? false;

    if (dryRun) {
      console.log(pc.dim('Dry run — no changes will be made.\n'));
    }

    console.log(pc.bold('Recovering platform...\n'));
    const result = await recover(ctx, { dryRun });

    // Networks
    console.log(pc.bold('Networks:'));
    for (const n of result.networks) {
      const icon =
        n.status === 'error' ? pc.red('✗') : n.status === 'created' ? pc.green('✓') : pc.dim('·');
      const label =
        n.status === 'created'
          ? pc.green('created')
          : n.status === 'error'
            ? pc.red(n.error ?? 'error')
            : pc.dim('ok');
      console.log(`  ${icon} ${n.name} ${label}`);
    }

    // Services
    console.log(pc.bold('\nServices:'));
    for (const s of result.services) {
      const icon =
        s.status === 'error'
          ? pc.red('✗')
          : s.status === 'recreated'
            ? pc.green('✓')
            : s.status === 'started'
              ? pc.yellow('↑')
              : pc.dim('·');
      const label =
        s.status === 'error'
          ? pc.red(s.error ?? 'error')
          : s.status === 'recreated'
            ? pc.green('recreated')
            : s.status === 'started'
              ? pc.yellow('started')
              : pc.dim('running');
      console.log(`  ${icon} ${s.name} ${label}`);
    }

    // Projects
    console.log(pc.bold('\nProjects:'));
    for (const p of result.projects) {
      const icon =
        // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
        p.status === 'error'
          ? pc.red('✗')
          : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            p.status === 'needs_redeploy'
            ? pc.yellow('!')
            : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
              p.status === 'recreated'
              ? pc.green('✓')
              : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
                p.status === 'started'
                ? pc.yellow('↑')
                : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
                  p.status === 'skipped'
                  ? pc.dim('-')
                  : pc.dim('·');
      const label =
        // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
        p.status === 'error'
          ? pc.red(p.error ?? 'error')
          : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            p.status === 'needs_redeploy'
            ? pc.yellow('needs redeploy (no image)')
            : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
              p.status === 'recreated'
              ? pc.green('recreated from image')
              : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
                p.status === 'started'
                ? pc.yellow('started')
                : // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
                  p.status === 'skipped'
                  ? pc.dim('skipped (stopped)')
                  : pc.dim('running');
      console.log(`  ${icon} ${p.name} ${label}`);
    }

    // Summary
    const svcRecovered = result.services.filter(
      (s) => s.status === 'recreated' || s.status === 'started',
    ).length;
    const prjRecovered = result.projects.filter(
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      (p) => p.status === 'recreated' || p.status === 'started',
    ).length;
    const errors = [...result.services, ...result.projects].filter(
      (x) => x.status === 'error',
    ).length;
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    const needsRedeploy = result.projects.filter((p) => p.status === 'needs_redeploy').length;

    console.log(
      `\n${pc.bold('Summary:')} ${pc.green(`${String(svcRecovered + prjRecovered)} recovered`)}` +
        (errors > 0 ? `, ${pc.red(`${String(errors)} errors`)}` : '') +
        (needsRedeploy > 0 ? `, ${pc.yellow(`${String(needsRedeploy)} need redeploy`)}` : ''),
    );

    process.exit(errors > 0 ? 1 : 0);
  });

// ── openlander mcp ───────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server (for Claude Code, Cursor, etc.)')
  .action(async () => {
    const { loadConfig, getDatabaseUrl, isOnboarded } = await import('../config/index.js');

    if (!isOnboarded()) {
      console.error('Not configured. Run `openlander` first.');
      process.exit(1);
    }

    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDatabaseUrl());

    if (ctx.agent) {
      const { createTools } = await import('../tools/index.js');
      const { mergeWithMcpTools } = await import('../mcp/client-manager.js');
      let tools: ToolSet = createTools(ctx, ctx.questionBridge);
      if (ctx.config.mcp.enabled && ctx.config.mcp.servers.length > 0) {
        await ctx.mcpClientManager.connectAll(ctx.config.mcp.servers);
        tools = await mergeWithMcpTools(tools, ctx.mcpClientManager);
      }
      ctx.agent.setTools(tools);
    }

    if (ctx.config.ai.operationalMonitoring.enabled) {
      ctx.alertMonitor.start();
    }

    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(ctx);
  });

program.parse();
