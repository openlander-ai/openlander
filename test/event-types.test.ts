import { describe, it, expect } from 'vitest';
import { toTimelineItem } from '../web/src/lib/event-types';

describe('toTimelineItem', () => {
  it('maps agent_thinking event to progress item with default text', () => {
    const item = toTimelineItem({
      type: 'agent_thinking',
      message: '',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(item.type).toBe('agent_thinking');
    expect(item.title).toBe('Agent is analyzing...');
    expect(item.percent).toBe(-1);
    expect(item.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps agent_tool_call event and sanitizes arguments', () => {
    const item = toTimelineItem({
      type: 'agent_tool_call',
      message: 'Calling deploy',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      toolName: 'deploy',
      toolArguments: {
        repo_url: 'https://github.com/example/app',
        ssh_key_path: '/home/user/.ssh/id_rsa',
      },
    });

    expect(item.type).toBe('agent_tool_call');
    expect(item.title).toBe('Calling deploy');
    expect(item.toolName).toBe('deploy');
    expect(item.toolArguments).toEqual({
      repo_url: 'https://github.com/example/app',
      ssh_key_path: '[redacted]',
    });
  });

  it('maps agent_message event using provided content', () => {
    const item = toTimelineItem({
      type: 'agent_message',
      message: 'fallback',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      content: 'tool call done',
    });

    expect(item.type).toBe('agent_message');
    expect(item.title).toBe('tool call done');
  });
});
