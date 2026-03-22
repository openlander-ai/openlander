import { PassThrough } from 'node:stream';

import type { ServiceRow } from '../../db/index.js';
import type { Docker } from '../docker.js';
import type { ContainerExecResult, ServiceCredentials } from './types.js';

export async function execInServiceContainer(
  docker: Docker,
  service: ServiceRow,
  command: string[],
  options?: { throwOnNonZeroExit?: boolean },
): Promise<ContainerExecResult> {
  const client = docker.getClient();
  const containerId = service.container_id ?? service.container_name;
  const container = client.getContainer(containerId);
  const exec = await container.exec({
    Cmd: command,
    AttachStdin: false,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await exec.start({ hijack: false, stdin: false });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();

  stdoutStream.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  stderrStream.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  client.modem.demuxStream(stream, stdoutStream, stderrStream);

  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
  });

  const info = await exec.inspect();
  const exitCode = info.ExitCode;
  if (typeof exitCode !== 'number') {
    throw new Error(`Container command did not report an exit code for service: ${service.id}`);
  }

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  if (options?.throwOnNonZeroExit !== false && exitCode !== 0) {
    const commandText = command.join(' ');
    const output = stderr.trim() || stdout.trim();
    throw new Error(
      `Container command failed (${commandText}) with exit code ${String(exitCode)}${output ? `: ${output}` : ''}`,
    );
  }

  return { stdout, stderr, exitCode };
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

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
