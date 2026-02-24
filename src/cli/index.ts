import { Command } from 'commander';
import pc from 'picocolors';

const program = new Command();

program
  .name('openlander')
  .description('AI agent that deploys your app from a chat')
  .version('0.1.0');

program
  .command('onboard')
  .description('Interactive setup: Docker check, Traefik, API keys')
  .action(async () => {
    const { runOnboard } = await import('./onboard.js');
    await runOnboard();
  });

program
  .command('start')
  .description('Start the OpenLander server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--host <host>', 'Host to bind to', '0.0.0.0')
  .action(async (options: { port: string; host: string }) => {
    const port = parseInt(options.port, 10);

    console.log(pc.bold(pc.cyan('\n  🛬 OpenLander')), pc.dim(`v0.1.0\n`));

    // Load config
    const { loadConfig, getDbPath, isOnboarded } = await import('../config/index.js');

    if (!isOnboarded()) {
      console.log(pc.yellow('  ⚠ Not configured yet. Run `openlander onboard` first.\n'));
      console.log(pc.dim('  Starting with defaults (no LLM configured)...\n'));
    }

    const config = loadConfig();
    config.server.port = port;
    config.server.host = options.host;

    // Create app context
    const { createAppContext } = await import('../app.js');
    const ctx = createAppContext(config, getDbPath());

    // Register tools with agent
    if (ctx.agent) {
      const { createTools } = await import('../agent/tools.js');
      const tools = createTools(ctx);
      ctx.agent.setTools(tools);
    }

    // Check Docker
    const dockerOk = await ctx.docker.ping();
    if (!dockerOk) {
      console.log(
        pc.yellow('  ⚠ Docker is not running. Deployment features will be unavailable.\n'),
      );
    } else {
      console.log(pc.green('  ✓ Docker connected'));
    }

    // Check Traefik
    const traefikOk = await ctx.traefik.isRunning();
    if (!traefikOk) {
      console.log(pc.yellow('  ⚠ Traefik not running. Run `openlander onboard` to set it up.'));
    } else {
      console.log(pc.green('  ✓ Traefik running'));
    }

    // LLM status
    if (ctx.agent) {
      console.log(pc.green(`  ✓ LLM: ${config.llm.provider} (${config.llm.model})`));
    } else {
      console.log(pc.yellow('  ⚠ No LLM configured — chat features unavailable'));
    }

    // Start server
    const { createServer } = await import('../web/server.js');
    createServer({ port, host: options.host }, ctx);

    console.log(pc.green(`\n  \u2713 Server running at ${pc.bold(`http://${options.host}:${String(port)}`)}`));
    console.log(pc.dim(`  API: http://localhost:${String(port)}/api`));
    console.log(pc.dim(`  Health: http://localhost:${String(port)}/health\n`));

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
  .command('status')
  .description('Show running projects and system stats')
  .action(async () => {
    const { loadConfig, getDbPath } = await import('../config/index.js');
    const { Database } = await import('../db/index.js');
    const { getSystemStats, formatStatsSummary } = await import('../monitor/stats.js');

    const config = loadConfig();
    const db = new Database(getDbPath());

    console.log(pc.bold(pc.cyan('\n  🛬 OpenLander Status\n')));

    // System stats
    const stats = getSystemStats();
    console.log(pc.bold('  System:'));
    console.log('  ' + formatStatsSummary(stats).split('\n').join('\n  '));
    console.log();

    // Projects
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

    // LLM status
    if (config.llm.apiKey) {
      console.log(pc.green(`  LLM: ${config.llm.provider} (${config.llm.model})`));
    } else {
      console.log(pc.yellow('  LLM: not configured'));
    }

    console.log();
    db.close();
  });

program.parse();
