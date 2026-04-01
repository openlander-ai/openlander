/**
 * GitHub OAuth Device Flow client.
 *
 * Implements the Device Authorization Grant flow for CLI applications.
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
 */

import { exec } from 'node:child_process';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('github-oauth');

// GitHub OAuth Device Flow endpoints
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEFAULT_SCOPE = 'repo read:user read:org';

/**
 * OpenLander's GitHub OAuth App Client ID.
 * This is a PUBLIC identifier (not a secret) — same pattern as gh CLI.
 * Register at: https://github.com/settings/applications/new
 * Required: Enable "Device Flow" in the OAuth App settings.
 */
const GITHUB_CLIENT_ID = 'Ov23li02IG5j6nSWFxUe';

/**
 * Get the GitHub OAuth Client ID.
 * Uses the hardcoded app ID, with env var override for development.
 */
export function getGitHubClientId(): string {
  return process.env.OPENLANDER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
}

/**
 * Response from the device code request.
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Response from the access token polling request.
 */
interface AccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/**
 * Callbacks for Device Flow UI updates.
 */
export interface DeviceFlowCallbacks {
  onCode: (userCode: string, verificationUri: string) => void;
  onPolling: () => void;
  onError: (error: string) => void;
}

/**
 * Request a device code from GitHub.
 * Step 1 of the Device Flow.
 *
 * @param clientId - GitHub OAuth App Client ID
 * @param scope - OAuth scopes (default: 'repo read:user')
 * @returns Device code response with user_code and verification_uri
 */
export async function requestDeviceCode(
  clientId: string,
  scope: string = DEFAULT_SCOPE,
): Promise<DeviceCodeResponse> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to request device code: ${String(response.status)} ${text}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('Invalid device code response from GitHub');
  }

  log.debug({ userCode: data.user_code, expiresIn: data.expires_in }, 'Device code requested');
  return data;
}

/**
 * Poll for access token after user authorizes the device.
 * Step 2 of the Device Flow.
 *
 * @param clientId - GitHub OAuth App Client ID
 * @param deviceCode - The device_code from requestDeviceCode
 * @param interval - Polling interval in seconds
 * @param signal - Optional AbortSignal for cancellation
 * @returns Access token string on success
 * @throws Error on expired_token, access_denied, or other fatal errors
 */
export async function pollForAccessToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  signal?: AbortSignal,
): Promise<string> {
  let currentInterval = interval;

  for (;;) {
    // Check for cancellation before each poll
    if (signal?.aborted) {
      throw new Error('Polling cancelled');
    }

    // Wait for the interval
    await sleep(currentInterval * 1000, signal);

    // Check again after sleep
    if (signal?.aborted) {
      throw new Error('Polling cancelled');
    }

    const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.debug({ status: response.status, text }, 'Token poll failed, retrying');
      continue;
    }

    const data = (await response.json()) as AccessTokenResponse;

    // Handle errors
    if (data.error) {
      switch (data.error) {
        case 'authorization_pending':
          // User hasn't authorized yet, keep polling
          log.debug('Authorization pending, continuing to poll');
          continue;

        case 'slow_down':
          // Increase interval by 5 seconds
          currentInterval += 5;
          log.debug({ newInterval: currentInterval }, 'Received slow_down, increasing interval');
          continue;

        case 'expired_token':
          throw new Error('Device code expired. Please restart the auth flow.');

        case 'access_denied':
          throw new Error('Authorization denied by user.');

        default:
          throw new Error(`OAuth error: ${data.error} - ${data.error_description ?? 'Unknown'}`);
      }
    }

    // Success!
    if (data.access_token) {
      log.info('GitHub OAuth access token received');
      return data.access_token;
    }

    // Unexpected response without error or token
    log.debug({ data }, 'Unexpected token response, continuing to poll');
  }
}

/**
 * Open a URL in the system's default browser.
 * Platform-aware implementation using child_process.exec.
 *
 * @param url - The URL to open
 */
export function openInBrowser(url: string): void {
  let cmd: string;

  switch (process.platform) {
    case 'darwin':
      cmd = `open ${url}`;
      break;
    case 'win32':
      cmd = `start ${url}`;
      break;
    default:
      // Linux and others
      cmd = `xdg-open ${url}`;
      break;
  }

  exec(cmd, (error) => {
    if (error) {
      log.debug({ error, url }, 'Failed to open browser');
    } else {
      log.debug({ url }, 'Opened URL in browser');
    }
  });
}

/**
 * Sleep for a specified duration.
 * Supports cancellation via AbortSignal.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Polling cancelled'));
      return;
    }

    const timeout = setTimeout(() => {
      resolve();
    }, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('Polling cancelled'));
    });
  });
}
