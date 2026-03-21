import type { TimelineItem } from '@/lib/event-types';

export type UnifiedItem = { type: 'timeline'; item: TimelineItem; ts: number };

export function mergeUnifiedFeed(timelineItems: TimelineItem[]): UnifiedItem[] {
  const unifiedItems: UnifiedItem[] = timelineItems.map((tItem) => ({
    type: 'timeline',
    item: tItem,
    ts: new Date(tItem.timestamp).getTime(),
  }));

  unifiedItems.sort((a, b) => a.ts - b.ts);
  return unifiedItems;
}
