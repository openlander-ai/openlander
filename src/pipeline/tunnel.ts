import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';

import { TunnelStartError, CloudflaredNotFoundError } from '../errors.js';
import { DYNAMIC_CONFIG_DIR } from './traefik.js';

/**
 * TryCloudflare tunnel for Quick Share mode.
 *
 * Spawns `cloudflared tunnel --url http://localhost:{port}`
 * and parses the generated public URL from stderr.
 *
 * Pattern from PawanOsman/ChatGPT and RunMaestro/Maestro.
 */
export class CloudflareTunnel {
  private process: ChildProcess | null = null;
  private _url: string | null = null;
  private host: string | null = null;
  private projectName: string | null = null;

  get url(): string | null {
    return this._url;
  }

  /**
   * Start a TryCloudflare quick tunnel with automatic retry.
   * TryCloudflare can return transient 500 errors, so we retry up to 3 times.
   * Returns the public URL (e.g., https://shy-tiger-abc123.trycloudflare.com).
   */
  async start(projectName: string, timeoutMs = 30_000): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.tryStart(projectName, timeoutMs);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isRetryable =
          !(err instanceof CloudflaredNotFoundError) &&
          lastError.message.includes('exited with code');
        if (!isRetryable || attempt === maxRetries) throw lastError;
        // Wait before retry (2s, 4s)
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    throw lastError as Error;
  }

  private tryStart(projectName: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new TunnelStartError(`Tunnel failed to start within ${String(timeoutMs)}ms`));
      }, timeoutMs);

      this.projectName = projectName;

      this.process = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:80'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuffer = '';
      let settled = false;

      this.process.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();

        // cloudflared outputs the URL to stderr
        const urlMatch = stderrBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (urlMatch?.[0] && !settled) {
          settled = true;
          clearTimeout(timeout);
          this._url = urlMatch[0];
          this.host = extractHostname(this._url);
          try {
            writeYamlConfig(projectName, generateQuickShareYaml(projectName, this.host));
            resolve(urlMatch[0]);
          } catch (err) {
            this.stop();
            const message = err instanceof Error ? err.message : String(err);
            reject(new TunnelStartError(`Failed to write tunnel config: ${message}`));
          }
        }
      });

      this.process.on('error', (err) => {
        settled = true;
        clearTimeout(timeout);
        if (err.message.includes('ENOENT')) {
          reject(new CloudflaredNotFoundError());
        } else {
          reject(new TunnelStartError(err.message));
        }
      });

      this.process.on('exit', (code) => {
        if (!settled && !this._url) {
          settled = true;
          clearTimeout(timeout);
          const stderr = stderrBuffer.trim();
          const detail = stderr
            ? `cloudflared exited with code ${String(code)}: ${stderr.slice(-500)}`
            : `cloudflared exited with code ${String(code)}`;
          reject(new TunnelStartError(detail));
        }
      });
    });
  }

  /** Stop the tunnel process. */
  stop(): void {
    if (this.projectName) {
      deleteYamlConfig(this.projectName);
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    this._url = null;
    this.host = null;
    this.projectName = null;
  }

  enableSharedMode(projectName: string, accessCode: string): void {
    if (!this.host) return;
    writeYamlConfig(projectName, generateSharedYaml(projectName, this.host, accessCode));
  }

  disableSharedMode(projectName: string): void {
    if (!this.host) return;
    writeYamlConfig(projectName, generateQuickShareYaml(projectName, this.host));
  }
}

/** @internal */
export function extractHostname(url: string): string {
  return new URL(url).hostname;
}

/** @internal */
export function generateQuickShareYaml(projectName: string, host: string): string {
  return `http:\n  routers:\n    qs-${projectName}:\n      rule: "Host(\`${host}\`)"\n      entryPoints:\n        - web\n      service: ol-${projectName}@docker\n`;
}

/** @internal */
export function generateSharedYaml(projectName: string, host: string, accessCode: string): string {
  const bcryptHash = hashSync(accessCode, 5);
  return `http:\n  routers:\n    qs-${projectName}:\n      rule: "Host(\`${host}\`)"\n      entryPoints:\n        - web\n      service: ol-${projectName}@docker\n      middlewares:\n        - qs-auth-${projectName}\n  middlewares:\n    qs-auth-${projectName}:\n      basicAuth:\n        users:\n          - "viewer:${bcryptHash}"\n`;
}

function writeYamlConfig(projectName: string, yaml: string): void {
  const filename = `qs-${projectName}.yaml`;
  const tempPath = join(DYNAMIC_CONFIG_DIR, `.${filename}.tmp`);
  const targetPath = join(DYNAMIC_CONFIG_DIR, filename);

  mkdirSync(DYNAMIC_CONFIG_DIR, { recursive: true });
  writeFileSync(tempPath, yaml, 'utf8');
  renameSync(tempPath, targetPath);
}

function deleteYamlConfig(projectName: string): void {
  const yamlPath = join(DYNAMIC_CONFIG_DIR, `qs-${projectName}.yaml`);
  try {
    unlinkSync(yamlPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }
}
