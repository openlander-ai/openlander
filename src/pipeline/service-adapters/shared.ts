import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import type { ContainerExecResult, ServiceCredentials } from './types.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB

export interface ExecOptions {
  throwOnNonZeroExit?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export async function execInServiceContainer(
  docker: Docker,
  service: ServiceRow,
  command: string[],
  options?: ExecOptions,
): Promise<ContainerExecResult> {
  const containerId = service.container_id ?? service.container_name;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let execResult: { exitCode: number; stdout: string; stderr: string };
  let timedOut = false;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('exec timeout'));
      }, timeoutMs);
    });

    execResult = await Promise.race([docker.execSimple(containerId, command), timeoutPromise]);
  } catch (error) {
    if (error instanceof Error && error.message === 'exec timeout') {
      timedOut = true;
      execResult = { exitCode: -1, stdout: '', stderr: '' };
    } else {
      throw error;
    }
  }

  if (timedOut) {
    return { stdout: '', stderr: '', exitCode: -1, truncated: true };
  }

  const truncated = execResult.stdout.length > maxBytes || execResult.stderr.length > maxBytes;
  const stdout =
    execResult.stdout.length > maxBytes ? execResult.stdout.slice(0, maxBytes) : execResult.stdout;
  const stderr =
    execResult.stderr.length > maxBytes ? execResult.stderr.slice(0, maxBytes) : execResult.stderr;

  if (options?.throwOnNonZeroExit !== false && execResult.exitCode !== 0) {
    const commandText = command.join(' ');
    const output = stderr.trim() || stdout.trim();
    throw new Error(
      `Container command failed (${commandText}) with exit code ${String(execResult.exitCode)}${output ? `: ${output}` : ''}`,
    );
  }

  return {
    stdout,
    stderr,
    exitCode: execResult.exitCode,
    ...(truncated ? { truncated: true } : {}),
  };
}

export function parseServiceCredentials(service: ServiceRow): ServiceCredentials {
  if (!service.credentials) {
    throw new Error(`Service credentials not available: ${service.id}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(service.credentials);
  } catch (_err) {
    throw new Error(`Invalid service credentials: ${service.id}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Incomplete service credentials: ${service.id}`);
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record['user'] !== 'string' ||
    typeof record['password'] !== 'string' ||
    typeof record['database'] !== 'string'
  ) {
    throw new Error(`Incomplete service credentials: ${service.id}`);
  }

  return {
    user: record['user'],
    password: record['password'],
    database: record['database'],
  };
}

export function assertSafeDatabaseName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid database name: ${name}`);
  }
}

export function assertSafeUserName(username: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
    throw new Error(`Invalid username: ${username}`);
  }
}

export function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export { sleep } from '../../lib/sleep.js';
