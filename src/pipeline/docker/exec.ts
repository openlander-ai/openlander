import { PassThrough } from 'node:stream';
import type { DockerContext } from './context.js';
import { withTimeout } from './helpers.js';
import { createModuleLogger } from '../../lib/logger.js';

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
