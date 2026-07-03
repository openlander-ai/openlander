import type { ServiceRow } from '../../db/index.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { ServiceConfigError, ServiceOperationError } from '../../errors.js';
import type { ContainerExecResult, ServiceCredentials } from './types.js';

const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024; // 1 MB

export interface ExecOptions {
  throwOnNonZeroExit?: boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

export async function execInServiceContainer(
  runtime: RuntimeBackend,
  service: ServiceRow,
  command: string[],
  options?: ExecOptions,
): Promise<ContainerExecResult> {
  const containerId = service.container_id ?? service.container_name ?? '';
  const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const maxBytes = options?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let execResult: { exitCode: number; stdout: string; stderr: string };
  let timedOut = false;

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('exec timeout'));
      }, timeoutMs);
    });

    try {
      const env = options?.env
        ? Object.entries(options.env).map(([key, value]) => `${key}=${value}`)
        : undefined;
      const execPromise = env
        ? runtime.execSimple(containerId, command, { env })
        : runtime.execSimple(containerId, command);
      execResult = await Promise.race([execPromise, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    throw new ServiceOperationError(
      'execInServiceContainer',
      `Container command failed (${commandText}) with exit code ${String(execResult.exitCode)}${output ? `: ${output}` : ''}`,
      {
        serviceId: service.id,
        command: commandText,
        exitCode: execResult.exitCode,
      },
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
    throw new ServiceConfigError(`Service credentials not available: ${service.id}`, {
      serviceId: service.id,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(service.credentials);
  } catch (_err) {
    throw new ServiceConfigError(`Invalid service credentials: ${service.id}`, {
      serviceId: service.id,
    });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ServiceConfigError(`Incomplete service credentials: ${service.id}`, {
      serviceId: service.id,
    });
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record['user'] !== 'string' ||
    typeof record['password'] !== 'string' ||
    typeof record['database'] !== 'string'
  ) {
    throw new ServiceConfigError(`Incomplete service credentials: ${service.id}`, {
      serviceId: service.id,
    });
  }

  return {
    user: record['user'],
    password: record['password'],
    database: record['database'],
  };
}

export function assertSafeDatabaseName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new ServiceConfigError(`Invalid database name: ${name}`, { name });
  }
}

export function assertSafeUserName(username: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
    throw new ServiceConfigError(`Invalid username: ${username}`, { username });
  }
}

export function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export { sleep } from '../../lib/sleep.js';
