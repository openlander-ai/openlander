import pc from 'picocolors';

import { loadConfig, saveConfig, getConfigPath } from '../config/index.js';
import type { OpenLanderConfig } from '../config/index.js';
import { Docker } from '../pipeline/docker.js';
import { TraefikManager } from '../pipeline/traefik.js';

/**
 * Interactive onboarding wizard.
 *
 * Steps:
 * 1. Check Docker installation
 * 2. Set up Traefik reverse proxy container
 * 3. Configure LLM API key
 * 4. (Optional) Cloudflare tunnel token
 * 5. (Optional) SSH key for private repos
 */
export async function runOnboard(): Promise<void> {
  console.log(pc.bold(pc.cyan('\n  🛬 OpenLander Setup\n')));
  console.log(pc.dim('  Interactive onboarding — follow the prompts.\n'));

  const config = loadConfig();

  // Step 1: Check Docker
  console.log(pc.bold('  Step 1/5:'), 'Checking Docker...');
  const docker = new Docker();
  const dockerOk = await docker.ping();
  if (!dockerOk) {
    console.log(pc.red('  ✗ Docker is not running. Please install and start Docker first.'));
    console.log(pc.dim('    https://docs.docker.com/get-docker/\n'));
    process.exit(1);
  }
  console.log(pc.green('  ✓ Docker is running\n'));

  // Step 2: Set up Traefik
  console.log(pc.bold('  Step 2/5:'), 'Setting up Traefik reverse proxy...');
  const traefik = new TraefikManager(docker);
  const traefikRunning = await traefik.isRunning();
  if (traefikRunning) {
    console.log(pc.green('  ✓ Traefik is already running\n'));
  } else {
    try {
      await traefik.start();
      console.log(pc.green('  ✓ Traefik started\n'));
    } catch (error) {
      console.log(pc.red('  ✗ Failed to start Traefik:'), (error as Error).message);
      console.log(pc.dim('    You can set it up manually later.\n'));
    }
  }

  // Step 3: LLM API key
  console.log(pc.bold('  Step 3/5:'), 'Configure LLM provider...');
  await configureLLM(config);

  // Step 4: Cloudflare (optional)
  console.log(pc.bold('  Step 4/5:'), 'Cloudflare tunnel (optional)...');
  await configureCloudflare(config);

  // Step 5: SSH key (optional)
  console.log(pc.bold('  Step 5/5:'), 'SSH key for private repos (optional)...');
  await configureSSH(config);

  // Save config
  saveConfig(config);
  console.log(pc.green(`\n  ✓ Configuration saved to ${getConfigPath()}\n`));

  console.log(pc.bold(pc.cyan('  Setup complete! Start the server with:\n')));
  console.log(pc.bold('    openlander start\n'));
}

async function configureLLM(config: OpenLanderConfig): Promise<void> {
  try {
    const { select, input } = await import('@inquirer/prompts');

    const provider = await select({
      message: '  LLM Provider:',
      choices: [
        { name: 'Google Gemini (free tier available)', value: 'gemini' },
        { name: 'OpenRouter (free models, no credit card)', value: 'openrouter' },
        { name: 'Anthropic Claude', value: 'anthropic' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Skip (configure later)', value: 'skip' },
      ],
    });

    if (provider === 'skip') {
      console.log(pc.yellow('  ⚠ No LLM configured — chat features will be unavailable\n'));
      return;
    }

    config.llm.provider = provider as OpenLanderConfig['llm']['provider'];

    const apiKey = await input({
      message: '  API Key:',
      validate: (value) => (value.length > 0 ? true : 'API key is required'),
    });

    config.llm.apiKey = apiKey;

    // Set default model based on provider
    const modelDefaults: Record<string, string> = {
      gemini: 'gemini-2.0-flash',
      openrouter: 'google/gemini-2.0-flash-exp:free',
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o-mini',
    };

    config.llm.model = modelDefaults[provider] ?? 'gemini-2.0-flash';
    console.log(pc.green(`  ✓ ${provider} configured (${config.llm.model})\n`));
  } catch {
    console.log(pc.yellow('  ⚠ Skipped — configure LLM manually in ~/.openlander/config.json\n'));
  }
}

async function configureCloudflare(config: OpenLanderConfig): Promise<void> {
  try {
    const { confirm, input } = await import('@inquirer/prompts');

    const wantCloudflare = await confirm({
      message: '  Set up Cloudflare tunnel for public URLs?',
      default: false,
    });

    if (!wantCloudflare) {
      console.log(pc.dim('  Skipped — TryCloudflare (temporary URLs) still available\n'));
      return;
    }

    config.cloudflare.apiToken = await input({
      message: '  Cloudflare API Token:',
      validate: (value) => (value.length > 0 ? true : 'Token is required'),
    });

    console.log(pc.green('  ✓ Cloudflare configured\n'));
  } catch {
    console.log(pc.dim('  Skipped\n'));
  }
}

async function configureSSH(config: OpenLanderConfig): Promise<void> {
  try {
    const { input } = await import('@inquirer/prompts');
    const { existsSync } = await import('node:fs');

    const sshKeyPath = await input({
      message: '  SSH key path (for private repos):',
      default: config.git.sshKeyPath,
    });

    if (existsSync(sshKeyPath)) {
      config.git.sshKeyPath = sshKeyPath;
      console.log(pc.green(`  ✓ SSH key found at ${sshKeyPath}\n`));
    } else {
      console.log(
        pc.yellow(`  ⚠ SSH key not found at ${sshKeyPath}. Private repos may not work.\n`),
      );
    }
  } catch {
    console.log(pc.dim('  Skipped\n'));
  }
}
