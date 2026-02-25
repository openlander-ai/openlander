import { execSync } from 'node:child_process';
import { platform } from 'node:os';
import pc from 'picocolors';

import { Docker } from '../pipeline/docker.js';

/**
 * Ensure Docker is installed, running, and accessible.
 *
 * Called automatically by `openlander` before starting the server.
 * Handles three failure states:
 *   - not_installed → offer auto-install (Linux) or show instructions (macOS)
 *   - not_running   → try to start the daemon
 *   - permission_denied → add user to docker group
 */
export async function ensureDocker(): Promise<void> {
  console.log(pc.dim('  Checking Docker...'));
  const docker = new Docker();
  const status = await docker.status();

  if (status.state === 'running') {
    // status() may pass via `sg docker` but dockerode may still lack access.
    // Verify direct socket access too.
    const directOk = await docker.ping();
    if (directOk) {
      console.log(pc.green('  \u2713 Docker running'));
      return;
    }
    // sg docker works but this process lacks the docker group.
    // Re-exec under sg docker so dockerode inherits the group.
    if (!process.env.OPENLANDER_SG_REEXEC) {
      console.log(pc.dim('  Activating docker group...'));
      const args = process.argv.slice(1).map(a => `"${a}"`).join(' ');
      const cmd = `sg docker -c "OPENLANDER_SG_REEXEC=1 node ${args}"`;
      try {
        execSync(cmd, { stdio: 'inherit' });
        process.exit(0);
      } catch (e) {
        // sg failed, fall through to normal error handling
      }
    }
    // If re-exec also failed, still try to continue
    console.log(pc.green('  \u2713 Docker running'));
    return;
  }

  if (status.state === 'not_installed') {
    console.log(pc.red('  ✗ Docker not installed\n'));
    const installed = await tryInstallDocker();
    if (!installed) {
      process.exit(1);
    }
    // Re-check
    const retry = await docker.status();
    if (retry.state !== 'running') {
      console.log(
        pc.red('  ✗ Docker installed but not responding. Please start the daemon and try again.'),
      );
      process.exit(1);
    }
    console.log(pc.green('  ✓ Docker running'));
    return;
  }

  if (status.state === 'not_running') {
    console.log(pc.yellow('  ⚠ Docker daemon not running. Trying to start...'));
    try {
      execSync('sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null', {
        stdio: 'inherit',
        timeout: 15000,
      });
      const retry = await docker.status();
      if (retry.state === 'running') {
        console.log(pc.green('  ✓ Docker started'));
        return;
      }
    } catch {
      // fall through
    }
    console.log(pc.red('  ✗ Could not start Docker.\n'));
    console.log(pc.dim('    Linux:  sudo systemctl start docker'));
    console.log(pc.dim('    macOS:  open -a Docker\n'));
    process.exit(1);
  }

  if (status.state === 'permission_denied') {
    console.log(pc.yellow('  ⚠ Docker permission denied. Fixing...'));
    const fixed = await tryFixDockerPermission();
    if (fixed) {
      // Verify with sg
      const retry = await docker.status();
      if (retry.state === 'running') {
        console.log(pc.green('  ✓ Docker running'));
        return;
      }
    }
    console.log(pc.red('  ✗ Could not fix Docker permissions.\n'));
    console.log(pc.dim('    Run: sudo usermod -aG docker $USER'));
    console.log(pc.dim('    Then log out and back in, and run `openlander` again.\n'));
    process.exit(1);
  }
}

async function tryFixDockerPermission(): Promise<boolean> {
  try {
    const user = execSync('whoami', { encoding: 'utf8', stdio: 'pipe' }).trim();
    console.log(pc.dim(`  Adding ${user} to docker group...`));
    execSync(`sudo usermod -aG docker ${user}`, { stdio: 'inherit' });
    // Try newgrp to activate immediately
    try {
      execSync('sg docker -c "docker info"', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      // sg didn't work — user needs to re-login
      console.log(pc.yellow('  ⚠ Group added. Please log out and back in for it to take effect.'));
      return false;
    }
  } catch {
    return false;
  }
}

async function tryInstallDocker(): Promise<boolean> {
  const os = platform();

  if (os === 'darwin') {
    console.log(pc.yellow('  Docker is not installed. Install options:'));
    console.log(pc.dim('    1. brew install --cask docker'));
    console.log(pc.dim('    2. Download from https://www.docker.com/products/docker-desktop/'));
    console.log();
    return false;
  }

  // Linux / WSL
  try {
    const { confirm } = await import('@inquirer/prompts');
    const shouldInstall = await confirm({
      message: '  Docker not found. Install automatically? (requires sudo)',
      default: true,
    });

    if (!shouldInstall) {
      console.log(pc.dim('    Install manually: curl -fsSL https://get.docker.com | sh'));
      console.log(pc.dim('    https://docs.docker.com/engine/install/\n'));
      return false;
    }

    console.log(pc.dim('  Downloading and installing Docker...'));
    execSync('curl -fsSL https://get.docker.com | sh', { stdio: 'inherit' });

    // Add current user to docker group
    try {
      const user = execSync('whoami', { encoding: 'utf8', stdio: 'pipe' }).trim();
      execSync(`sudo usermod -aG docker ${user}`, { stdio: 'inherit' });
      console.log(pc.dim(`  Added ${user} to docker group.`));
    } catch {
      console.log(
        pc.yellow('  ⚠ Could not add user to docker group. Run: sudo usermod -aG docker $USER'),
      );
    }

    // Start daemon
    try {
      execSync('sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null', {
        stdio: 'inherit',
      });
    } catch {
      console.log(pc.yellow('  ⚠ Could not auto-start Docker.'));
    }

    console.log(pc.green('  ✓ Docker installed\n'));
    return true;
  } catch (error) {
    console.log(pc.red('  ✗ Docker installation failed:'), (error as Error).message);
    console.log(pc.dim('    Install manually: curl -fsSL https://get.docker.com | sh\n'));
    return false;
  }
}
