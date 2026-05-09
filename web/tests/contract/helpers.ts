/**
 * Shared helpers for contract tests.
 *
 * getBaseUrl()  — reads the port written by start-test-backend.mjs.
 * getApiToken() — reads the API token written by boot-test-server.mjs.
 * authedFetch() — wraps fetch() with the test Authorization header.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PORT_FILE = join(import.meta.dirname, '..', '..', '.test-backend-port');
const TOKEN_FILE = join(import.meta.dirname, '..', '..', '.test-backend-token');

export function getBaseUrl(): string {
  if (!existsSync(PORT_FILE)) {
    throw new Error('Contract tests require a running backend via pretest:contract.');
  }
  return `http://127.0.0.1:${readFileSync(PORT_FILE, 'utf8').trim()}`;
}

export function getApiToken(): string {
  if (!existsSync(TOKEN_FILE)) {
    throw new Error('.test-backend-token missing — boot-test-server.mjs must write it on startup.');
  }
  return readFileSync(TOKEN_FILE, 'utf8').trim();
}

/**
 * Authenticated fetch — adds Authorization: Bearer <token> to every request.
 * Accepts the same arguments as the global fetch().
 */
export async function authedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = getApiToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}
