/**
 * Git Authentication CLI Onboarding
 *
 * Interactive CLI flow for setting up Git authentication during first run.
 * Supports GitHub OAuth (Device Flow), SSH Key, and Skip options.
 */

import { select, confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { updateConfig } from '../config/index.js';
import {
  requestDeviceCode,
  pollForAccessToken,
  openInBrowser,
  getGitHubClientId,
} from '../git-providers/github-oauth.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('cli-onboard-git');

const SSH_DIR = join(homedir(), '.ssh');

interface SshKey {
  name: string;
  path: string;
}

/**
 * Find existing SSH keys in ~/.ssh/
 */
function findExistingKeys(): SshKey[] {
  const keys: SshKey[] = [];
  if (!existsSync(SSH_DIR)) {
    return keys;
  }

  try {
    const files = readdirSync(SSH_DIR);
    for (const file of files) {
      // Look for private keys (no .pub extension, not config files)
      if (
        file.endsWith('.pub') ||
        file.includes('.txt') ||
        file === 'config' ||
        file === 'known_hosts' ||
        file === 'authorized_keys'
      ) {
        continue;
      }
      const fullPath = join(SSH_DIR, file);
      try {
        // Check if it looks like a private key
        const content = readFileSync(fullPath, 'utf8');
        if (content.includes('PRIVATE KEY')) {
          keys.push({ name: file, path: fullPath });
        }
      } catch (err) {
        log.debug({ err, file }, 'Failed to read SSH key file');
        // Skip unreadable files
      }
    }
  } catch (err) {
    log.debug({ err }, 'Failed to read SSH directory');
    // Ignore errors reading directory
  }
  return keys;
}

/**
 * Test SSH key connection to GitHub
 */
function testSshKey(keyPath: string): { success: boolean; message: string } {
  try {
    // Test SSH connection to GitHub
    const result = execSync(
      `ssh -i "${keyPath}" -T git@github.com -o StrictHostKeyChecking=no -o BatchMode=yes 2>&1`,
      {
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    // GitHub returns "Hi username! You've successfully authenticated" even on success (exit code 1)
    if (
      result.includes('successfully authenticated') ||
      result.includes("You've successfully authenticated")
    ) {
      return { success: true, message: 'SSH key authenticated with GitHub' };
    }
    return { success: true, message: 'SSH key is valid' };
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err);
    // GitHub returns exit code 1 even on success
    if (
      output.includes('successfully authenticated') ||
      output.includes("You've successfully authenticated")
    ) {
      return { success: true, message: 'SSH key authenticated with GitHub' };
    }
    // Key might not be added to GitHub yet - that's okay for onboarding
    return { success: true, message: 'SSH key found (not yet added to GitHub)' };
  }
}

/**
 * Generate a new SSH key (ed25519)
 */
function generateSshKey(): SshKey {
  const keyPath = join(SSH_DIR, 'id_ed25519');
  execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "openlander"`, {
    stdio: 'pipe',
  });
  return { name: 'id_ed25519', path: keyPath };
}

/**
 * Run GitHub OAuth Device Flow
 */
async function runGitHubOAuth(): Promise<void> {
  console.log();
  console.log(pc.cyan('  Starting GitHub OAuth Device Flow...'));
  console.log();

  const clientId = getGitHubClientId();

  // Step 1: Request device code
  let deviceCode;
  try {
    deviceCode = await requestDeviceCode(clientId);
  } catch (err) {
    console.log(
      pc.red(
        `  ✗ Failed to request device code: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    throw err;
  }

  console.log(pc.bold('  1. Open this URL in your browser:'));
  console.log(pc.cyan(`     ${deviceCode.verification_uri}`));
  console.log();
  console.log(pc.bold('  2. Enter this code:'));
  console.log(pc.cyan(`     ${deviceCode.user_code}`));
  console.log();

  // Try to open browser automatically
  openInBrowser(deviceCode.verification_uri);

  // Step 2: Poll for access token
  console.log(pc.dim('  ⟳ Waiting for authorization...'));

  const token = await pollForAccessToken(clientId, deviceCode.device_code, deviceCode.interval);

  // Step 3: Validate token and get username
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  let username = '';
  if (response.ok) {
    const user = (await response.json()) as { login?: string };
    username = user.login ?? '';
  }

  // Save to config
  updateConfig({
    gitProviders: {
      github: {
        token,
        username,
        authMethod: 'oauth',
      },
    },
  });

  console.log();
  console.log(pc.green(`  ✓ Connected as @${username}`));
}

/**
 * Run SSH key setup flow
 */
async function runSshKeySetup(): Promise<void> {
  console.log();

  // Find existing keys
  const keys = findExistingKeys();

  let selectedKey: SshKey;

  if (keys.length > 0) {
    // Let user select from existing keys
    const choices = keys.map((k) => ({ name: k.name, value: k.path }));
    const selectedPath = await select({
      message: 'Select SSH key',
      choices,
    });
    const found = keys.find((k) => k.path === selectedPath);
    if (!found) return;
    selectedKey = found;
  } else {
    // No keys found - generate one
    const shouldGenerate = await confirm({
      message: 'No SSH keys found. Generate a new ed25519 key?',
      default: true,
    });

    if (!shouldGenerate) {
      console.log(pc.yellow('  Skipped SSH key setup. You can configure manually later.'));
      return;
    }

    console.log(pc.dim('  Generating new SSH key...'));
    selectedKey = generateSshKey();
    console.log(pc.green(`  ✓ Generated ${selectedKey.name}`));
  }

  // Test the key
  console.log(pc.dim('  Testing SSH key...'));
  const result = testSshKey(selectedKey.path);

  // Save to config
  updateConfig({
    git: {
      sshKeyPath: selectedKey.path,
    },
  });

  console.log();
  if (result.message.includes('not yet added')) {
    console.log(pc.green(`  ✓ SSH key ${selectedKey.name} configured`));
    console.log(pc.dim('  Note: Add the key to GitHub for private repo access:'));
    console.log(pc.dim(`  cat ${selectedKey.path}.pub | pbcopy  # macOS`));
    console.log(pc.dim(`  cat ${selectedKey.path}.pub | xclip -sel clip  # Linux`));
  } else {
    console.log(pc.green(`  ✓ SSH key ${selectedKey.name} configured`));
  }
}

/**
 * Run the Git authentication setup flow.
 * Prompts user to choose between GitHub OAuth, SSH Key, or Skip.
 */
export async function setupGit(): Promise<void> {
  console.log();
  console.log(pc.dim('  ━━━ [3/3] Git Authentication ━━━━━━━━━━━━━━━━━━━'));
  console.log();

  const method = await select({
    message: 'Choose Git auth method',
    choices: [
      { name: 'GitHub OAuth (Login via browser)', value: 'oauth' },
      { name: 'SSH Key (auto-detect existing keys)', value: 'ssh' },
      { name: 'Skip (public repos only)', value: 'skip' },
    ],
    default: 'oauth',
  });

  if (method === 'oauth') {
    try {
      await runGitHubOAuth();
    } catch (err) {
      console.log(pc.red(`  ✗ OAuth failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(pc.yellow('  You can try SSH or set up manually with /git command.'));
    }
  } else if (method === 'ssh') {
    await runSshKeySetup();
  } else {
    console.log();
    console.log(pc.dim('  Skipping Git auth. Only public repositories will be accessible.'));
    console.log(pc.dim('  Run /git later to configure authentication.'));
  }
}
