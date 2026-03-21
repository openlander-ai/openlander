import type { TimelineItem } from '@/lib/event-types';

export type UnifiedItem = { type: 'timeline'; item: TimelineItem; ts: number };

export function mergeUnifiedFeed(timelineItems: TimelineItem[]): UnifiedItem[] {
  const unifiedItems: UnifiedItem[] = [];

  const timelineAiTypes = new Set([
    'agent_thinking',
    'agent_tool_call',
    'agent_tool_result',
    'agent_message',
    'question',
    'needs_user_action',
  ]);

  for (const tItem of timelineItems) {
    if (timelineAiTypes.has(tItem.type)) {
      continue;
    }
    unifiedItems.push({
      type: 'timeline',
      item: tItem,
      ts: new Date(tItem.timestamp).getTime(),
    });
  }

  unifiedItems.sort((a, b) => a.ts - b.ts);
  return unifiedItems;
}
