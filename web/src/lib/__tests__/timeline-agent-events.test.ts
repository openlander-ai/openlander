import { describe, expect, it } from 'vitest';
import { toTimelineItem, type BuildStreamEvent, type TimelineItem } from '../event-types';

function makeEvent(
  type: BuildStreamEvent['type'],
  overrides: Partial<BuildStreamEvent> = {},
): BuildStreamEvent {
  return {
    type,
    message: `${type} message`,
    projectId: 'proj-1',
    timestamp: '2026-03-26T00:00:00.000Z',
    ...overrides,
  };
}

function appendLikeUseTimeline(prev: TimelineItem[], event: BuildStreamEvent): TimelineItem[] {
  const item = toTimelineItem(event);
  if (item.type === 'progress') {
    return [...prev.filter((p) => p.type !== 'progress'), item];
  }
  return [...prev, item];
}

describe('toTimelineItem agent event type preservation', () => {
  it('preserves agent_thinking type', () => {
    const item = toTimelineItem(makeEvent('agent_thinking', { message: 'Thinking deeply...' }));
    expect(item.type).toBe('agent_thinking');
    expect(item.content).toBe('Thinking deeply...');
  });

  it('preserves agent_tool_call type', () => {
    const item = toTimelineItem(
      makeEvent('agent_tool_call', { message: 'tool: deploy_project args={}' }),
    );
    expect(item.type).toBe('agent_tool_call');
  });

  it('preserves agent_tool_result type', () => {
    const item = toTimelineItem(
      makeEvent('agent_tool_result', { message: 'Tool finished successfully' }),
    );
    expect(item.type).toBe('agent_tool_result');
  });

  it('preserves agent_message type', () => {
    const item = toTimelineItem(makeEvent('agent_message', { detail: 'extra context' }));
    expect(item.type).toBe('agent_message');
    expect(item.detail).toBe('extra context');
  });

  it('maps status events to progress', () => {
    const item = toTimelineItem(makeEvent('status', { message: 'Build in progress' }));
    expect(item.type).toBe('progress');
  });
});

describe('timeline append behavior', () => {
  it('replaces older progress events with latest progress event', () => {
    let items: TimelineItem[] = [];
    items = appendLikeUseTimeline(items, makeEvent('status', { message: 'Starting deployment' }));
    items = appendLikeUseTimeline(items, makeEvent('status', { message: 'Cloning repository' }));

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('progress');
    expect(items[0].title).toBe('Cloning repository');
  });

  it('accumulates agent events instead of replacing them', () => {
    let items: TimelineItem[] = [];
    items = appendLikeUseTimeline(items, makeEvent('agent_thinking', { message: 'step 1' }));
    items = appendLikeUseTimeline(
      items,
      makeEvent('agent_tool_call', { message: 'tool: inspect_repo' }),
    );
    items = appendLikeUseTimeline(items, makeEvent('agent_tool_result', { message: 'done' }));
    items = appendLikeUseTimeline(items, makeEvent('agent_message', { message: 'final note' }));

    expect(items).toHaveLength(4);
    expect(items.map((item) => item.type)).toEqual([
      'agent_thinking',
      'agent_tool_call',
      'agent_tool_result',
      'agent_message',
    ]);
  });
});
