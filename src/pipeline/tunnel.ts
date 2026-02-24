import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { TunnelStartError, CloudflaredNotFoundError } from '../errors.js';

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

  get url(): string | null {
    return this._url;
  }

  /**
   * Start a TryCloudflare quick tunnel.
   * Returns the public URL (e.g., https://shy-tiger-abc123.trycloudflare.com).
   */
  async start(localPort: number, timeoutMs = 30_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new TunnelStartError(`Tunnel failed to start within ${String(timeoutMs)}ms`));
      }, timeoutMs);

      this.process = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${String(localPort)}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderrBuffer = '';

      this.process.stderr?.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();

        // cloudflared outputs the URL to stderr
        const urlMatch = stderrBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (urlMatch?.[0]) {
          clearTimeout(timeout);
          this._url = urlMatch[0];
          resolve(urlMatch[0]);
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        if (err.message.includes('ENOENT')) {
          reject(new CloudflaredNotFoundError());
        } else {
          reject(new TunnelStartError(err.message));
        }
      });

      this.process.on('exit', (code) => {
        if (!this._url) {
          clearTimeout(timeout);
          reject(new TunnelStartError(`cloudflared exited with code ${String(code)}`));
        }
      });
    });
  }

  /** Stop the tunnel process. */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      this._url = null;
    }
  }
}
