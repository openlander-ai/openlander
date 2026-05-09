import { normalizeLogText } from '@/lib/ansi';
import type { ConsoleLogLevel } from '@/types';

function parseStructuredLogLevel(line: string): ConsoleLogLevel | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const level = record.level;
    if (typeof level === 'string') {
      const normalized = level.toLowerCase();
      if (normalized === 'error' || normalized === 'fatal') return 'error';
      if (normalized === 'warn' || normalized === 'warning') return 'warn';
      if (normalized === 'info') return 'info';
      if (normalized === 'debug' || normalized === 'trace') return 'debug';
    }

    const errorValue = record.error;
    if (typeof errorValue === 'string' && errorValue.trim().length > 0) {
      return 'error';
    }

    return null;
  } catch {
    return null;
  }
}

/** Detect log level from line content */
export function detectLevel(line: string): ConsoleLogLevel {
  const normalizedLine = normalizeLogText(line);
  const structuredLevel = parseStructuredLogLevel(normalizedLine);
  if (structuredLevel) {
    return structuredLevel;
  }

  const lower = normalizedLine.toLowerCase();
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
  debug: 'text-muted-foreground',
  plain: '',
};
