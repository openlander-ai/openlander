import { normalizeLogText } from '@/lib/ansi';
import type { ConsoleLogLevel } from '@/types';

/** Detect log level from line content */
export function detectLevel(line: string): ConsoleLogLevel {
  const lower = normalizeLogText(line).toLowerCase();
  if (/\berror\b|\w+error\b|\bfatal\b|\bpanic\b|\bexception\b|\btraceback\b|\berrno\b/.test(lower))
    return 'error';
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\binfo\b/.test(lower)) return 'info';
  if (/\bdebug\b|\btrace\b/.test(lower)) return 'debug';
  return 'plain';
}

export const levelColors: Record<ConsoleLogLevel, string> = {
  error: 'text-error',
  warn: 'text-warning',
  info: '',
  debug: 'text-muted-ol',
  plain: '',
};
