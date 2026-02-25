import { Command } from 'commander';
import pc from 'picocolors';
import { join } from 'node:path';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('cli');

const program = new Command();

// ── Default command: openlander (TUI mode) ─────────────────────────────────────

program
  .name('openlander')
  .description('AI agent that deploys your app from a chat')
  .version('0.4.0')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .action(async (options: { port: string; host: string }) => {
    const port = parseInt(options.port, 10);

    // Step 1: Ensure Docker is ready
    const { ensureDocker } = await import('./onboard.js');
    await ensureDocker();

    // Step 2: Load config & create app context
    const { loadConfig, getDbPath, getDataDir } = await import('../config/index.js');

    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    // Register tools with agent
    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const tools = createTools(ctx);
      ctx.agent.setTools(tools);
    }

    // Step 3: Traefik (auto-start, non-blocking)
    const traefikOk = await ctx.traefik.isRunning();
    if (!traefikOk) {
      try {
        await ctx.traefik.start();
        console.log(pc.green('  ✓ Traefik started'));
      } catch (err) {
        log.debug({ err }, 'Traefik start failed');
        console.log(pc.yellow('  ⚠ Traefik could not start'));
      }
    }

    // Step 4: Start daemon (Unix socket) for TUI client
    const { startDaemon } = await import('../web/server.js');
    const socketPath = join(getDataDir(), 'openlander.sock');
    await startDaemon({ socketPath }, ctx);


    // Step 6: Launch TUI
    const { startTUI } = await import('../tui/index.js');
    startTUI(ctx);

    // Graceful shutdown
    const { shutdownAppContext } = await import('../app.js');
    const shutdown = () => {
      console.log(pc.dim('\n  Shutting down...'));
      shutdownAppContext(ctx);
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ── openlander start ─────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start daemon only (no TUI, background)')
  .action(async () => {
    const { loadConfig, getDbPath, getDataDir } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    // Register tools with agent
    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const tools = createTools(ctx);
      ctx.agent.setTools(tools);
    }

    // Start daemon on Unix socket
    const { startDaemon } = await import('../web/server.js');
    const socketPath = join(getDataDir(), 'openlander.sock');
    await startDaemon({ socketPath }, ctx);

    console.log(pc.green('Daemon started.'), pc.dim(`Socket: ${socketPath}`));

    // Keep process running
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  });

// ── openlander stop ──────────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop daemon')
  .action(async () => {
    const { getDataDir } = await import('../config/index.js');
    const { OpenLanderClient } = await import('../ipc/client.js');

    const socketPath = join(getDataDir(), 'openlander.sock');
    const pidPath = join(getDataDir(), 'openlander.pid');

    // Check if socket exists
    if (!existsSync(socketPath)) {
      console.log(pc.yellow('Daemon not running.'));
      process.exit(0);
    }

    // Try to connect via IPC client
    const client = new OpenLanderClient(socketPath);
    try {
      await client.ping();
      // Daemon is running — need to stop it
      // For now, use PID file approach
      if (existsSync(pidPath)) {
        const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 'SIGTERM');
          console.log(pc.green('Daemon stopped.'));
        } catch (err) {
          log.debug({ err, pid }, 'Failed to kill daemon process');
          console.log(pc.yellow('Could not stop daemon (permission denied or already stopped).'));
        }
        // Clean up socket file
        if (existsSync(socketPath)) {
          try {
            unlinkSync(socketPath);
          } catch (err) {
            log.debug({ err, socketPath }, 'Failed to clean up socket file');
            // Ignore cleanup errors
          }
        }
      } else {
        // No PID file — try removing socket as fallback
        try {
          unlinkSync(socketPath);
          console.log(pc.green('Daemon socket cleaned up.'));
        } catch (err) {
          log.debug({ err, socketPath }, 'Failed to clean up socket file');
          console.log(pc.yellow('Could not clean up daemon socket.'));
        }
      }
    } catch (err) {
      log.debug({ err }, 'Daemon ping failed — cleaning up stale socket');
      // Daemon not responding — clean up stale socket
      try {
        unlinkSync(socketPath);
        console.log(pc.yellow('Daemon not running (cleaned up stale socket).'));
      } catch (err) {
        log.debug({ err, socketPath }, 'Failed to clean up stale socket');
        console.log(pc.yellow('Daemon not running.'));
      }
    }
  });

// ── openlander restart ───────────────────────────────────────────────────────

program
  .command('restart')
  .description('Restart daemon')
  .action(async () => {
    // Stop
    const { getDataDir } = await import('../config/index.js');
    const socketPath = join(getDataDir(), 'openlander.sock');
    const pidPath = join(getDataDir(), 'openlander.pid');

    if (existsSync(socketPath)) {
      if (existsSync(pidPath)) {
        const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 'SIGTERM');
        } catch (err) {
          log.debug({ err, pid }, 'Failed to kill process during restart');
          // Ignore if already stopped
        }
      }
      try {
        unlinkSync(socketPath);
      } catch (err) {
        log.debug({ err, socketPath }, 'Failed to remove socket during restart');
        // Ignore
      }
    }

    // Wait briefly for cleanup
    await new Promise((r) => setTimeout(r, 500));

    // Start
    const { loadConfig, getDbPath } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const tools = createTools(ctx);
      ctx.agent.setTools(tools);
    }

    const { startDaemon } = await import('../web/server.js');
    await startDaemon({ socketPath }, ctx);

    console.log(pc.green('Daemon restarted.'), pc.dim(`Socket: ${socketPath}`));

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  });

// ── openlander config ────────────────────────────────────────────────────────

program
  .command('config')
  .description('Manage configuration')
  .argument('[action]', 'Action: show (default) or reset')
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
        tunnelSecret: config.cloudflare.tunnelSecret ? '***masked***' : '(not set)',
      },
    };

    console.log(JSON.stringify(masked, null, 2));
    console.log();
  });

// ── openlander status ────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show running projects and system stats')
  .action(async () => {
    const { loadConfig, getDbPath } = await import('../config/index.js');
    const { Database } = await import('../db/index.js');
    const { getSystemStats, formatStatsSummary } = await import('../monitor/stats.js');

    const config = loadConfig();
    const db = new Database(getDbPath());

    console.log(pc.bold(pc.cyan('\n  🛬 OpenLander Status\n')));

    const stats = getSystemStats();
    console.log(pc.bold('  System:'));
    console.log('  ' + formatStatsSummary(stats).split('\n').join('\n  '));
    console.log();

    const projects = db.listProjects();
    if (projects.length === 0) {
      console.log(pc.dim('  No projects deployed yet.\n'));
    } else {
      console.log(pc.bold(`  Projects (${String(projects.length)}):`));
      for (const p of projects) {
        const statusIcon = p.status === 'running' ? pc.green('●') : pc.red('○');
        const url = p.assigned_port ? `http://${p.name}.localhost` : '';
        console.log(`  ${statusIcon} ${pc.bold(p.name)} — ${p.status} ${pc.dim(url)}`);
        if (p.public_url) {
          console.log(`    ${pc.cyan('↗')} ${p.public_url}`);
        }
      }
      console.log();
    }

    if (config.llm.apiKey || config.llm.authToken) {
      console.log(pc.green(`  LLM: ${config.llm.provider} (${config.llm.model})`));
    } else {
      console.log(pc.yellow('  LLM: not configured'));
    }

    console.log(pc.bold('  Health Monitoring:'));
    console.log(
      pc.dim('    Healthcheck interval: ' + String(config.monitoring.healthcheckIntervalSec) + 's'),
    );

    const webhookProjects = projects.filter((p) => {
      const ghConfig = db.getWebhookConfig(p.id, 'github');
      const glConfig = db.getWebhookConfig(p.id, 'gitlab');
      const bbConfig = db.getWebhookConfig(p.id, 'bitbucket');
      return ghConfig || glConfig || bbConfig;
    });
    if (webhookProjects.length > 0) {
      console.log(pc.bold(`  Webhooks (${String(webhookProjects.length)} projects):`));
      for (const p of webhookProjects) {
        console.log(`    ${pc.bold(p.name)}`);
      }
    }

    const oauthProviders = ['anthropic', 'openai', 'google'] as const;
    const authenticatedProviders = oauthProviders.filter((p) => db.getOAuthTokens(p) != null);
    if (authenticatedProviders.length > 0) {
      console.log(pc.bold('  OAuth:'));
      for (const p of authenticatedProviders) {
        console.log(pc.green(`    ✓ ${p}`));
      }
    }

    console.log();
    db.close();
  });

// ── openlander mcp ───────────────────────────────────────────────────────────

program
  .command('mcp')
  .description('Start the MCP server (for Claude Code, Cursor, etc.)')
  .action(async () => {
    const { loadConfig, getDbPath, isOnboarded } = await import('../config/index.js');

    if (!isOnboarded()) {
      console.error('Not configured. Run `openlander` first.');
      process.exit(1);
    }

    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const tools = createTools(ctx);
      ctx.agent.setTools(tools);
    }

    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(ctx);
  });

program.parse();
