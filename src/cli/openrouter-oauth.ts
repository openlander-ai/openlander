/**
 * OpenRouter OAuth PKCE Flow client.
 *
 * Implements PKCE (Proof Key for Code Exchange) OAuth flow for CLI/TUI applications.
 * Starts a local HTTP server to receive the OAuth callback.
 */

import { randomBytes, createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { openInBrowser } from '../git-providers/github-oauth.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('openrouter-oauth');

// OpenRouter OAuth endpoints
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys';

// OAuth timeout in milliseconds (120 seconds)
const OAUTH_TIMEOUT_MS = 120_000;

// Preferred port for local callback server
const PREFERRED_PORT = 19273;

/**
 * Generate PKCE code verifier and challenge.
 * Uses SHA256 with S256 challenge method.
 */
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Find an available port starting from the preferred port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(startPort, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          reject(new Error('Failed to get server port'));
        }
      });
    });
    server.on('error', (err) => {
      const errorCode = (err as NodeJS.ErrnoException).code;
      if (errorCode === 'EADDRINUSE' && startPort < 65535) {
        // Try next port
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Response from OpenRouter token exchange.
 */
interface TokenResponse {
  key?: string;
  error?: string;
}

/**
 * Exchange authorization code for API key.
 */
async function exchangeCodeForApiKey(code: string, verifier: string): Promise<string> {
  const response = await fetch(OPENROUTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to exchange code for API key: ${String(response.status)} ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  if (data.error) {
    throw new Error(`OpenRouter OAuth error: ${data.error}`);
  }

  if (!data.key) {
    throw new Error('Invalid response from OpenRouter: missing API key');
  }

  return data.key;
}

/**
 * Run the OpenRouter OAuth PKCE flow.
 *
 * 1. Generates PKCE verifier and challenge
 * 2. Starts a local HTTP server on an available port
 * 3. Opens browser to OpenRouter auth URL with callback
 * 4. Waits for callback with authorization code
 * 5. Exchanges code for API key
 *
 * @returns API key string on success
 * @throws Error on timeout, network error, or invalid response
 */
export async function openRouterOAuth(): Promise<string> {
  // Generate PKCE parameters
  const { verifier, challenge } = generatePkce();

  // Find an available port
  const port = await findAvailablePort(PREFERRED_PORT);
  log.debug({ port }, 'Found available port for OAuth callback');

  // Build callback URL
  const callbackUrl = `http://localhost:${String(port)}`;

  // Build auth URL
  const authUrl = new URL(OPENROUTER_AUTH_URL);
  authUrl.searchParams.set('callback_url', callbackUrl);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const authUrlString = authUrl.toString();

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let serverClosed = false;

    // Create local HTTP server
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Parse the request URL
      const reqUrl = new URL(req.url ?? '/', callbackUrl);
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');

      // Send response to browser
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Authentication Complete</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
  <div style="text-align: center;">
    <h1 style="color: #4ade80;">✓ Authentication Complete!</h1>
    <p>You can close this tab and return to OpenLander.</p>
  </div>
</body>
</html>`);

      // Close server after response
      res.socket?.end();

      // Handle the result
      if (error) {
        log.debug({ error }, 'OAuth error received');
        if (!serverClosed) {
          serverClosed = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          server.close(() => {
            reject(new Error(`OAuth error: ${error}`));
          });
        }
        return;
      }

      if (!code) {
        log.debug('No authorization code received');
        if (!serverClosed) {
          serverClosed = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          server.close(() => {
            reject(new Error('No authorization code received'));
          });
        }
        return;
      }

      log.debug('Authorization code received, exchanging for API key');

      // Exchange code for API key
      exchangeCodeForApiKey(code, verifier)
        .then((apiKey) => {
          if (!serverClosed) {
            serverClosed = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            server.close(() => {
              log.info('OpenRouter OAuth successful');
              resolve(apiKey);
            });
          }
        })
        .catch((err: unknown) => {
          if (!serverClosed) {
            serverClosed = true;
            if (timeoutId !== null) clearTimeout(timeoutId);
            server.close(() => {
              reject(err instanceof Error ? err : new Error(String(err)));
            });
          }
        });
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      if (!serverClosed) {
        serverClosed = true;
        server.close(() => {
          reject(new Error('OAuth timed out after 120 seconds. Please try again.'));
        });
      }
    }, OAUTH_TIMEOUT_MS);

    // Start listening
    server.listen(port, () => {
      log.debug({ port, authUrl: authUrlString }, 'OAuth callback server started');

      // Open browser
      openInBrowser(authUrlString);
      console.log(`\n  Opening browser for OpenRouter authentication...`);
      console.log(`  If the browser doesn't open, visit: ${authUrlString}`);
    });

    // Handle server errors
    server.on('error', (err: unknown) => {
      if (!serverClosed) {
        serverClosed = true;
        clearTimeout(timeoutId);
        reject(
          new Error(
            `Failed to start OAuth callback server: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  });
}
