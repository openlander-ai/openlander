import { Command } from 'commander';
import pc from 'picocolors';
import { join } from 'node:path';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { createModuleLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { getProjectUrl, getLanIp } from '../pipeline/traefik.js';

const log = createModuleLogger('cli');

const program = new Command();

// ── Default command: openlander (Web mode — default) ─────────────────────────

program
  .name('openlander')
  .description('AI agent that deploys your app from a chat')
  .version(VERSION)
  .option('-p, --port <port>', 'Port to listen on', '10114')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .option('--tui', 'Launch legacy TUI mode instead of web UI')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options: { port: string; host: string; tui?: boolean; open?: boolean }) => {
    const port = parseInt(options.port, 10);

    // Step 1: Ensure Docker is ready
    const { ensureDocker } = await import('./onboard.js');
    await ensureDocker();

    // Step 2: Onboarding handled by Web UI (SetupScreen)
    // CLI no longer runs LLM/Git setup — just start the server

    // Step 3: Load config & create app context
    const { loadConfig, getDbPath, getDataDir } = await import('../config/index.js');

    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    // Register tools with agent (including MCP presets + external MCP tools)
    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const { initializeMcpTools } = await import('../mcp/client-manager.js');
      const builtinTools = createTools(ctx, ctx.questionBridge);
      const tools = await initializeMcpTools(ctx, builtinTools);
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

    if (options.tui) {
      // ── Legacy TUI mode ──
      process.env['OPENLANDER_TUI'] = '1';

      const { startDaemon } = await import('../web/server.js');
      const socketPath = join(getDataDir(), 'openlander.sock');
      await startDaemon({ socketPath }, ctx);

      const { startTUI } = await import('../tui/index.js');
      startTUI(ctx);
    } else {
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
  .description('Start daemon only (no TUI, background)')
  .action(async () => {
    const { loadConfig, getDbPath, getDataDir } = await import('../config/index.js');
    const config = loadConfig();

    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    // Register tools with agent (including MCP presets + external MCP tools)
    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const { initializeMcpTools } = await import('../mcp/client-manager.js');
      const builtinTools = createTools(ctx, ctx.questionBridge);
      const tools = await initializeMcpTools(ctx, builtinTools);
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
      const { initializeMcpTools } = await import('../mcp/client-manager.js');
      const builtinTools = createTools(ctx, ctx.questionBridge);
      const tools = await initializeMcpTools(ctx, builtinTools);
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
        const url = p.assigned_port ? getProjectUrl(p.name) : '';
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
      const { initializeMcpTools } = await import('../mcp/client-manager.js');
      const builtinTools = createTools(ctx, ctx.questionBridge);
      const tools = await initializeMcpTools(ctx, builtinTools);
      ctx.agent.setTools(tools);
    }

    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(ctx);
  });

// ── openlander deploy <repo> ─────────────────────────────────────────────────

program
  .command('deploy <repo>')
  .description('Deploy a repo (shorthand for web API call)')
  .option('-b, --branch <branch>', 'Branch to deploy', 'main')
  .option('-n, --name <name>', 'Project name')
  .option('-p, --port <port>', 'API port', '10114')
  .action(async (repo: string, opts: { branch: string; name?: string; port: string }) => {
    const base = `http://localhost:${opts.port}`;
    const name =
      opts.name ??
      repo
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') ??
      'project';

    console.log(pc.dim(`  Deploying ${repo} (branch: ${opts.branch})...`));

    try {
      const res = await fetch(`${base}/api/projects/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repo, branch: opts.branch, name }),
      });
      const data = (await res.json()) as { project?: { id: string; name: string }; error?: string };
      if (!res.ok) {
        console.error(pc.red(`  Deploy failed: ${data.error ?? res.statusText}`));
        process.exit(1);
      }
      console.log(pc.green(`  ✓ Project created: ${data.project?.name ?? name}`));
      console.log(pc.dim(`    ID: ${data.project?.id ?? '—'}`));
      console.log(pc.dim(`    Web: ${base}/projects/${data.project?.id ?? ''}`));
    } catch {
      console.error(pc.red('  Could not connect to OpenLander daemon.'));
      console.error(pc.dim('  Make sure `openlander` is running.'));
      process.exit(1);
    }
  });

// ── openlander logs <project> ────────────────────────────────────────────────

program
  .command('logs <project>')
  .description('Stream logs for a project')
  .option('-p, --port <port>', 'API port', '10114')
  .option('-n, --lines <n>', 'Number of lines', '100')
  .action(async (project: string, opts: { port: string; lines: string }) => {
    const base = `http://localhost:${opts.port}`;

    // Resolve project name to ID
    const projectId = await resolveProjectId(base, project);
    if (!projectId) {
      console.error(pc.red(`  Project "${project}" not found.`));
      process.exit(1);
    }

    try {
      const res = await fetch(`${base}/api/projects/${projectId}/logs?lines=${opts.lines}`);
      if (!res.ok) {
        console.error(pc.red(`  Failed to fetch logs: ${res.statusText}`));
        process.exit(1);
      }
      const data = (await res.json()) as { logs?: string };
      if (data.logs) {
        process.stdout.write(data.logs);
      } else {
        console.log(pc.dim('  No logs available.'));
      }
    } catch {
      console.error(pc.red('  Could not connect to OpenLander daemon.'));
      process.exit(1);
    }
  });

// ── openlander open <project> ────────────────────────────────────────────────

program
  .command('open <project>')
  .description('Open project URL in browser')
  .option('-p, --port <port>', 'API port', '10114')
  .action(async (project: string, opts: { port: string }) => {
    const base = `http://localhost:${opts.port}`;

    const projectId = await resolveProjectId(base, project);
    if (!projectId) {
      console.error(pc.red(`  Project "${project}" not found.`));
      process.exit(1);
    }

    try {
      const res = await fetch(`${base}/api/projects/${projectId}`);
      const data = (await res.json()) as { name?: string; url?: string; publicUrl?: string };
      const url = data.publicUrl ?? data.url;
      if (!url) {
        console.error(pc.yellow(`  Project "${data.name ?? project}" has no URL yet.`));
        process.exit(1);
      }

      console.log(pc.dim(`  Opening ${url}...`));
      const { exec } = await import('node:child_process');
      const openCmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      exec(`${openCmd} ${url}`, (err) => {
        if (err) console.error(pc.yellow('  Could not open browser.'));
      });
    } catch {
      console.error(pc.red('  Could not connect to OpenLander daemon.'));
      process.exit(1);
    }
  });

// ── openlander projects ──────────────────────────────────────────────────────

const projectsCmd = program.command('projects').description('Manage projects');

projectsCmd
  .command('ls')
  .description('List all projects')
  .option('-p, --port <port>', 'API port', '10114')
  .action(async (opts: { port: string }) => {
    const base = `http://localhost:${opts.port}`;

    try {
      const res = await fetch(`${base}/api/projects`);
      if (!res.ok) {
        console.error(pc.red(`  Failed: ${res.statusText}`));
        process.exit(1);
      }
      const projects = (await res.json()) as Array<{
        id: string;
        name: string;
        status: string;
        url?: string;
        publicUrl?: string;
      }>;

      if (projects.length === 0) {
        console.log(pc.dim('  No projects deployed yet.'));
        return;
      }

      console.log(pc.bold(`\n  Projects (${String(projects.length)}):\n`));
      for (const p of projects) {
        const icon =
          p.status === 'running' ? pc.green('●') : p.status === 'error' ? pc.red('●') : pc.dim('○');
        const url = p.publicUrl ?? p.url ?? '';
        console.log(`  ${icon} ${pc.bold(p.name)}  ${pc.dim(p.status)}  ${pc.cyan(url)}`);
      }
      console.log();
    } catch {
      console.error(pc.red('  Could not connect to OpenLander daemon.'));
      console.error(pc.dim('  Make sure `openlander` is running.'));
      process.exit(1);
    }
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveProjectId(base: string, nameOrId: string): Promise<string | null> {
  try {
    const res = await fetch(`${base}/api/projects`);
    if (!res.ok) return null;
    const projects = (await res.json()) as Array<{ id: string; name: string }>;
    // Match by ID first, then by name (case-insensitive)
    const match =
      projects.find((p) => p.id === nameOrId) ??
      projects.find((p) => p.name.toLowerCase() === nameOrId.toLowerCase());
    return match?.id ?? null;
  } catch {
    return null;
  }
}

program.parse();
