import { Command } from 'commander';
import pc from 'picocolors';

const program = new Command();

program
  .name('openlander')
  .description('AI agent that deploys your app from a chat')
  .version('0.4.0')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .action(async (options: { port: string; host: string }) => {
    const port = parseInt(options.port, 10);

    console.log(pc.bold(pc.cyan('\n  🛬 OpenLander')), pc.dim('v0.4.0'));

    // ── Step 1: Ensure Docker is ready ───────────────────────────
    const { ensureDocker } = await import('./onboard.js');
    await ensureDocker();

    // ── Step 2: Load config & create app context ─────────────────
    const { loadConfig, getDbPath } = await import('../config/index.js');

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

    // ── Step 3: Traefik (auto-start, non-blocking) ───────────────
    const traefikOk = await ctx.traefik.isRunning();
    if (!traefikOk) {
      try {
        await ctx.traefik.start();
        console.log(pc.green('  ✓ Traefik started'));
      } catch {
        console.log(pc.yellow('  ⚠ Traefik could not start'));
      }
    }

    // ── Step 4: Start headless API server ─────────────────────────
    const { createServer } = await import('../web/server.js');
    createServer({ port, host: options.host }, ctx);
    console.log(pc.dim(`  API server on port ${String(port)}`));

    // ── Step 5: Launch Terminal UI ───────────────────────────────
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

program.parse();
