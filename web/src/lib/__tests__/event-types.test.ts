import { describe, it, expect } from 'vitest';
import { filterRecoveryEvents } from '../event-types';
import type { TimelineItem } from '../event-types';

describe('filterRecoveryEvents', () => {
  it('keeps the first recovery_start event', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'Starting recovery',
        percent: -1,
      },
      {
        id: '2',
        type: 'log',
        timestamp: '2025-01-01T10:00:01Z',
        title: 'Some log',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('recovery_start');
  });

  it('filters out subsequent recovery_start events', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'First recovery',
        percent: -1,
      },
      {
        id: '2',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:05Z',
        title: 'Second recovery',
        percent: -1,
      },
      {
        id: '3',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:10Z',
        title: 'Third recovery',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('always shows recovery_success events', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'Starting recovery',
        percent: -1,
      },
      {
        id: '2',
        type: 'recovery_success',
        timestamp: '2025-01-01T10:00:05Z',
        title: 'Recovery succeeded',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('recovery_success');
  });

  it('always shows recovery_failed events', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'Starting recovery',
        percent: -1,
      },
      {
        id: '2',
        type: 'recovery_failed',
        timestamp: '2025-01-01T10:00:05Z',
        title: 'Recovery failed',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('recovery_failed');
  });

  it('always shows recovery_exhausted events', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'Starting recovery',
        percent: -1,
      },
      {
        id: '2',
        type: 'recovery_exhausted',
        timestamp: '2025-01-01T10:00:05Z',
        title: 'Recovery exhausted',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('recovery_exhausted');
  });

  it('handles complex scenario with multiple recovery cycles', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'First recovery start',
        percent: -1,
      },
      {
        id: '2',
        type: 'log',
        timestamp: '2025-01-01T10:00:01Z',
        title: 'Analyzing error',
        percent: -1,
      },
      {
        id: '3',
        type: 'recovery_failed',
        timestamp: '2025-01-01T10:00:05Z',
        title: 'First recovery failed',
        percent: -1,
      },
      {
        id: '4',
        type: 'recovery_start',
        timestamp: '2025-01-01T10:00:06Z',
        title: 'Second recovery start',
        percent: -1,
      },
      {
        id: '5',
        type: 'recovery_success',
        timestamp: '2025-01-01T10:00:10Z',
        title: 'Second recovery succeeded',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
    expect(result[2].id).toBe('3');
    expect(result[3].id).toBe('5');
  });

  it('returns empty array for empty input', () => {
    const result = filterRecoveryEvents([]);
    expect(result).toEqual([]);
  });

  it('preserves non-recovery events', () => {
    const items: TimelineItem[] = [
      {
        id: '1',
        type: 'log',
        timestamp: '2025-01-01T10:00:00Z',
        title: 'Log message',
        percent: -1,
      },
      {
        id: '2',
        type: 'error',
        timestamp: '2025-01-01T10:00:01Z',
        title: 'Error occurred',
        percent: -1,
      },
      {
        id: '3',
        type: 'success',
        timestamp: '2025-01-01T10:00:02Z',
        title: 'Success',
        percent: -1,
      },
    ];

    const result = filterRecoveryEvents(items);
    expect(result).toEqual(items);
  });
});
