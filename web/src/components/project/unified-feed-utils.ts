import type { TimelineItem } from '@/lib/event-types';
import type { AssistantItem } from '@/hooks/use-assistant';

export type UnifiedItem =
  | { type: 'timeline'; item: TimelineItem; ts: number }
  | { type: 'assistant'; item: AssistantItem; ts: number }
  | { type: 'assistant_group'; items: AssistantItem[]; id: string; ts: number };

export function groupAssistantItems(
  items: AssistantItem[],
): Array<AssistantItem | { type: 'tool_group'; items: AssistantItem[]; id: string }> {
  const result: Array<AssistantItem | { type: 'tool_group'; items: AssistantItem[]; id: string }> =
    [];
  let toolBuffer: AssistantItem[] = [];

  const flushToolBuffer = () => {
    if (toolBuffer.length > 0) {
      result.push({
        type: 'tool_group',
        items: [...toolBuffer],
        id: `tool-group-${toolBuffer[0].id}`,
      });
      toolBuffer = [];
    }
  };

  for (const item of items) {
    if (item.type === 'tool_call' || item.type === 'tool_result') {
      toolBuffer.push(item);
    } else {
      flushToolBuffer();
      result.push(item);
    }
  }
  flushToolBuffer();
  return result;
}

export function mergeUnifiedFeed(
  timelineItems: TimelineItem[],
  assistantItems: AssistantItem[],
): UnifiedItem[] {
  const unifiedItems: UnifiedItem[] = [];

  const timelineAiTypes = new Set([
    'agent_thinking',
    'agent_tool_call',
    'agent_tool_result',
    'agent_message',
    'question',
    'needs_user_action',
  ]);

  const timelineErrors = new Set<string>();

  for (const tItem of timelineItems) {
    if (timelineAiTypes.has(tItem.type)) {
      continue;
    }
    if (tItem.type === 'error') {
      timelineErrors.add(tItem.timestamp);
    }
    unifiedItems.push({
      type: 'timeline',
      item: tItem,
      ts: new Date(tItem.timestamp).getTime(),
    });
  }

  const groupedAssistant = groupAssistantItems(assistantItems);
  for (const group of groupedAssistant) {
    if ('type' in group && group.type === 'tool_group') {
      unifiedItems.push({
        type: 'assistant_group',
        items: group.items,
        id: group.id,
        ts: new Date(group.items[0].timestamp).getTime(),
      });
    } else {
      const aItem = group as AssistantItem;
      if (aItem.type === 'error' && timelineErrors.has(aItem.timestamp)) {
        continue;
      }
      unifiedItems.push({
        type: 'assistant',
        item: aItem,
        ts: new Date(aItem.timestamp).getTime(),
      });
    }
  }

  unifiedItems.sort((a, b) => a.ts - b.ts);
  return unifiedItems;
}
