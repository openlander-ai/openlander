import pino from 'pino';

const isTest = process.env['NODE_ENV'] === 'test';
const isDev = process.env['NODE_ENV'] !== 'production';

export const logger = pino({
  level: isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
  transport:
    isDev && !isTest
      ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
      : undefined,
});

export function createModuleLogger(module: string): pino.Logger {
  return logger.child({ module });
}
