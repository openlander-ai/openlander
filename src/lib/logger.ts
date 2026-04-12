import pino from 'pino';
import { Writable } from 'node:stream';
import { getLogBuffer } from './log-buffer.js';

const isTest = process.env['NODE_ENV'] === 'test';

function parseLogLine(line: string):
  | Partial<{
      level: number;
      module: string;
      msg: string;
      time: number;
      timestamp: number;
    }>
  | undefined {
  try {
    return JSON.parse(line) as Partial<{
      level: number;
      module: string;
      msg: string;
      time: number;
      timestamp: number;
    }>;
  } catch (_parseError) {
    return undefined;
  }
}

class LogCaptureStream extends Writable {
  constructor(private readonly output?: NodeJS.WritableStream) {
    super();
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (parsed === undefined) {
        continue;
      }

      if (typeof parsed.level === 'number' && typeof parsed.msg === 'string') {
        getLogBuffer().push({
          level: parsed.level,
          module: typeof parsed.module === 'string' ? parsed.module : undefined,
          msg: parsed.msg,
          timestamp:
            typeof parsed.time === 'number'
              ? parsed.time
              : typeof parsed.timestamp === 'number'
                ? parsed.timestamp
                : Date.now(),
        });
      }
    }

    if (this.output !== undefined) {
      this.output.write(text);
    }

    callback();
  }
}

export const logger = pino(
  {
    level: isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
  },
  new LogCaptureStream(isTest ? undefined : process.stdout),
);

export function createModuleLogger(module: string): pino.Logger {
  return logger.child({ module });
}
