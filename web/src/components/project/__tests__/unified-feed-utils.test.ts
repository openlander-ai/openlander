import { describe, it, expect } from 'vitest';
import { mergeUnifiedFeed } from '../unified-feed-utils';
import type { TimelineItem } from '@/lib/event-types';

describe('mergeUnifiedFeed', () => {
  it('returns timeline items sorted by timestamp', () => {
    const timelineItems: TimelineItem[] = [
      {
        id: 't1',
        type: 'progress',
        timestamp: '2023-01-01T00:00:00Z',
        title: 'Progress 1',
        percent: 10,
      },
      { id: 't3', type: 'error', timestamp: '2023-01-01T00:00:02Z', title: 'Error 1', percent: -1 },
    ];

    const result = mergeUnifiedFeed(timelineItems);

    expect(result.length).toBe(2);

    expect(result[0].type).toBe('timeline');
    if (result[0].type === 'timeline') expect(result[0].item.id).toBe('t1');

    expect(result[1].type).toBe('timeline');
    if (result[1].type === 'timeline') expect(result[1].item.id).toBe('t3');
  });
});
