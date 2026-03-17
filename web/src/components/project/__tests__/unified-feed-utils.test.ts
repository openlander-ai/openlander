import { describe, it, expect } from 'vitest';
import { mergeUnifiedFeed } from '../unified-feed-utils';
import type { TimelineItem } from '@/lib/event-types';
import type { AssistantItem } from '@/hooks/use-assistant';

describe('mergeUnifiedFeed', () => {
  it('merges timeline and assistant items correctly', () => {
    const timelineItems: TimelineItem[] = [
      {
        id: 't1',
        type: 'progress',
        timestamp: '2023-01-01T00:00:00Z',
        title: 'Progress 1',
        percent: 10,
      },
      {
        id: 't2',
        type: 'agent_thinking',
        timestamp: '2023-01-01T00:00:01Z',
        title: 'Thinking',
        percent: -1,
      },
      { id: 't3', type: 'error', timestamp: '2023-01-01T00:00:02Z', title: 'Error 1', percent: -1 },
    ];

    const assistantItems: AssistantItem[] = [
      { id: 'a1', type: 'thinking', timestamp: '2023-01-01T00:00:01Z' },
      { id: 'a2', type: 'error', timestamp: '2023-01-01T00:00:02Z', content: 'Error 1' },
      { id: 'a3', type: 'message', timestamp: '2023-01-01T00:00:03Z', content: 'Hello' },
    ];

    const result = mergeUnifiedFeed(timelineItems, assistantItems);

    // Should have:
    // 1. t1 (progress)
    // 2. a1 (thinking) - t2 is filtered out
    // 3. t3 (error) - a2 is filtered out because it has same timestamp as t3
    // 4. a3 (message)

    expect(result.length).toBe(4);

    expect(result[0].type).toBe('timeline');
    if (result[0].type === 'timeline') expect(result[0].item.id).toBe('t1');

    expect(result[1].type).toBe('assistant');
    if (result[1].type === 'assistant') expect(result[1].item.id).toBe('a1');

    expect(result[2].type).toBe('timeline');
    if (result[2].type === 'timeline') expect(result[2].item.id).toBe('t3');

    expect(result[3].type).toBe('assistant');
    if (result[3].type === 'assistant') expect(result[3].item.id).toBe('a3');
  });

  it('groups tool calls and results', () => {
    const timelineItems: TimelineItem[] = [];
    const assistantItems: AssistantItem[] = [
      { id: 'a1', type: 'tool_call', timestamp: '2023-01-01T00:00:01Z', toolName: 'test' },
      { id: 'a2', type: 'tool_result', timestamp: '2023-01-01T00:00:02Z', toolName: 'test' },
    ];

    const result = mergeUnifiedFeed(timelineItems, assistantItems);

    expect(result.length).toBe(1);
    expect(result[0].type).toBe('assistant_group');
    if (result[0].type === 'assistant_group') {
      expect(result[0].items.length).toBe(2);
      expect(result[0].items[0].id).toBe('a1');
      expect(result[0].items[1].id).toBe('a2');
    }
  });
});
