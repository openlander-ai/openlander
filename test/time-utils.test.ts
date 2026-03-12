import { describe, expect, it, vi, afterEach } from 'vitest';

import { formatDateTime, formatRelativeTime, formatTime } from '../web/src/lib/time.js';

describe('time utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats relative time from normalized ISO timestamps', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-11T12:00:00.000Z').getTime());

    expect(formatRelativeTime('2026-03-11T11:00:00.000Z')).toBe('1h ago');
  });

  it('accepts legacy sqlite timestamps as UTC', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-11T12:00:00.000Z').getTime());

    expect(formatRelativeTime('2026-03-11 11:30:00')).toBe('30m ago');
    expect(formatTime('2026-03-11 11:30:00')).not.toBe('');
    expect(formatDateTime('2026-03-11 11:30:00')).toContain('2026');
  });

  it('returns safe fallback for invalid timestamps', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
    expect(formatTime('not-a-date')).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });
});
