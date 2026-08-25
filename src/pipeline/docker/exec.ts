import { PassThrough } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { finished, pipeline } from 'node:stream/promises';
import type { DockerContext } from './context.js';
import { withTimeout } from './helpers.js';
import { createModuleLogger } from '../../lib/logger.js';
import { ServiceConfigError } from '../../errors.js';

const log = createModuleLogger('docker:exec');

export class ExecOps {
  constructor(private readonly ctx: DockerContext) {}

  /** Execute a non-interactive command in a container and return structured output. */
  async execSimple(
    containerId: string,
    cmd: string[],
    opts?: { env?: string[]; stdin?: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = this.ctx.client.getContainer(containerId);
    const hasStdin = opts?.stdin !== undefined;
    const exec = await container.exec({
      Cmd: cmd,
      ...(opts?.env ? { Env: opts.env } : {}),
      ...(hasStdin ? { AttachStdin: true } : {}),
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: hasStdin, stdin: hasStdin });
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

    this.ctx.client.modem.demuxStream(stream, stdoutStream, stderrStream);
    if (hasStdin) {
      stream.write(opts.stdin);
      stream.end();
    }

    await new Promise<void>((resolve, reject) => {
      stream.on('error', reject);
      stream.on('end', resolve);
    });

    const info = await withTimeout(exec.inspect(), 10_000, 'exec inspect');
    log.debug({ containerId, cmd, exitCode: info.ExitCode }, 'exec completed');
    return {
      exitCode: info.ExitCode ?? 0,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  /** Open an interactive TTY exec stream for WebSocket bridging. Returns duplex stream. */
  async execStream(
    containerId: string,
    cmd: string[],
    opts?: { tty?: boolean },
  ): Promise<NodeJS.ReadWriteStream> {
    const container = this.ctx.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: opts?.tty ?? true,
    });
    return await exec.start({ hijack: true, stdin: true });
  }

  async execToFile(
    containerId: string,
    cmd: string[],
    outputPath: string,
    opts?: { env?: string[] },
  ): Promise<void> {
    const container = this.ctx.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      ...(opts?.env ? { Env: opts.env } : {}),
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    stderrStream.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 64 * 1024) return;
      const retained = chunk.subarray(0, 64 * 1024 - stderrBytes);
      stderrChunks.push(retained);
      stderrBytes += retained.length;
    });
    this.ctx.client.modem.demuxStream(stream, stdoutStream, stderrStream);
    const outputPipeline = pipeline(stdoutStream, createWriteStream(outputPath, { mode: 0o600 }));
    const streamCompletion = finished(stream, { readable: true, writable: false }).finally(() => {
      if (!stdoutStream.destroyed) {
        stdoutStream.end();
      }
      if (!stderrStream.destroyed) {
        stderrStream.end();
      }
    });
    await Promise.all([streamCompletion, outputPipeline]);
    const info = await withTimeout(exec.inspect(), 10_000, 'exec-to-file inspect');
    if ((info.ExitCode ?? 1) !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      throw new ServiceConfigError(
        stderr || `Container command exited with code ${String(info.ExitCode)}`,
      );
    }
  }

  /** Stream a host file to a non-TTY container command without buffering it in memory. */
  async execFromFile(
    containerId: string,
    cmd: string[],
    inputPath: string,
    opts?: { env?: string[] },
  ): Promise<void> {
    const container = this.ctx.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      ...(opts?.env ? { Env: opts.env } : {}),
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true });
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    stdoutStream.resume();
    stderrStream.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 64 * 1024) return;
      const retained = chunk.subarray(0, 64 * 1024 - stderrBytes);
      stderrChunks.push(retained);
      stderrBytes += retained.length;
    });
    this.ctx.client.modem.demuxStream(stream, stdoutStream, stderrStream);
    const inputPipeline = pipeline(createReadStream(inputPath), stream);
    const streamCompletion = finished(stream, { readable: true, writable: false }).finally(() => {
      if (!stdoutStream.destroyed) stdoutStream.end();
      if (!stderrStream.destroyed) stderrStream.end();
    });
    await Promise.all([inputPipeline, streamCompletion]);
    const info = await withTimeout(exec.inspect(), 10_000, 'exec-from-file inspect');
    if ((info.ExitCode ?? 1) !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      throw new ServiceConfigError(
        stderr || `Container command exited with code ${String(info.ExitCode)}`,
      );
    }
  }

  /** Open an interactive terminal exec with resize support. Returns stream and resize function. */
  async execTerminal(
    containerId: string,
    cmd: string[],
  ): Promise<{
    stream: NodeJS.ReadWriteStream;
    resize: (size: { w: number; h: number }) => Promise<void>;
  }> {
    const container = this.ctx.client.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = (await exec.start({
      hijack: true,
      stdin: true,
    })) as unknown as NodeJS.ReadWriteStream;
    return {
      stream,
      resize: async (size: { w: number; h: number }) => {
        await exec.resize(size);
      },
    };
  }
}
