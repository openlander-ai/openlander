import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatImageId,
  formatRelativeTime,
  formatUptime,
} from '../src/tui/components/project-info-utils.js';

describe('ProjectInfo helpers', () => {
  const now = new Date('2026-02-28T12:00:00.000Z');

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatUptime', () => {
    it('formats minutes as Xh Ym', () => {
      expect(formatUptime('2026-02-28T11:41:00.000Z')).toBe('0h 19m');
    });

    it('formats hours as Xh Ym', () => {
      expect(formatUptime('2026-02-28T08:30:00.000Z')).toBe('3h 30m');
    });

    it('formats days as Xd Yh', () => {
      expect(formatUptime('2026-02-24T22:00:00.000Z')).toBe('3d 14h');
    });

    it('returns fallback for invalid input', () => {
      expect(formatUptime('not-a-date')).toBe('—');
    });
  });

  describe('formatRelativeTime', () => {
    it('formats minutes as Xm ago', () => {
      expect(formatRelativeTime('2026-02-28T11:45:00.000Z')).toBe('15m ago');
    });

    it('formats hours as Xh ago', () => {
      expect(formatRelativeTime('2026-02-28T10:00:00.000Z')).toBe('2h ago');
    });

    it('formats days as Xd ago', () => {
      expect(formatRelativeTime('2026-02-26T12:00:00.000Z')).toBe('2d ago');
    });

    it('returns fallback for invalid input', () => {
      expect(formatRelativeTime('bad-date')).toBe('—');
    });
  });

  describe('formatImageId', () => {
    it('truncates containerId to 12 chars with ellipsis', () => {
      expect(formatImageId('sha256:a3f2b9c8d7e6f5a4')).toBe('sha256:a3f2b...');
    });

    it('returns fallback when containerId is missing', () => {
      expect(formatImageId()).toBe('—');
      expect(formatImageId('')).toBe('—');
    });
  });
});
