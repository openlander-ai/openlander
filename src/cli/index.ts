import { Command } from 'commander';
import pc from 'picocolors';
import { join } from 'node:path';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { createModuleLogger } from '../lib/logger.js';
import { sleep } from '../lib/sleep.js';
import { VERSION } from '../version.js';
import { getLanIp } from '../pipeline/traefik.js';
import type { ToolSet } from 'ai';

const log = createModuleLogger('cli');

const program = new Command();

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
    const { loadConfig, getDbPath } = await import('../config/index.js');

    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDbPath());

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
  .description('Start daemon only (background)')
  .action(async () => {
    const { loadConfig, getDbPath, getDataDir } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDbPath());

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
    await sleep(500);

    // Start
    const { loadConfig, getDbPath } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = await createAppContext(config, getDbPath());

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
      const { getDbPath } = await import('../config/index.js');
      const dbPath = getDbPath();

      if (!existsSync(dbPath)) {
        console.log(pc.red('No database found. Run OpenLander first.'));
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

      const db = new Database(dbPath);
      const authService = new AuthService(db);
      authService.resetPassword(newPassword);

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
    const ctx = await createAppContext(config, getDbPath());

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

    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(ctx);
  });

program.parse();
