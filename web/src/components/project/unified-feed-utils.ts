import type { TimelineItem } from '@/lib/event-types';
import { parseTimestamp } from '@/lib/time';

export type UnifiedItem = { type: 'timeline'; item: TimelineItem; ts: number };

export function mergeUnifiedFeed(timelineItems: TimelineItem[]): UnifiedItem[] {
  const unifiedItems: UnifiedItem[] = timelineItems.map((tItem) => ({
    type: 'timeline',
    item: tItem,
    ts: parseTimestamp(tItem.timestamp)?.getTime() ?? 0,
  }));

  unifiedItems.sort((a, b) => a.ts - b.ts);
  return unifiedItems;
}
