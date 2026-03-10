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

  it('maps needs_user_action event with category and detail', () => {
    const item = toTimelineItem({
      type: 'needs_user_action',
      message: 'Invalid credentials',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      category: 'CLONE_AUTH_FAILURE',
      userDetail: 'SSH key not found for this repository',
    });

    expect(item.type).toBe('needs_user_action');
    expect(item.title).toBe('Invalid credentials');
    expect(item.percent).toBe(-1);
    expect(item.category).toBe('CLONE_AUTH_FAILURE');
    expect(item.detail).toBe('SSH key not found for this repository');
  });

  it('maps needs_user_action event falling back to detail field', () => {
    const item = toTimelineItem({
      type: 'needs_user_action',
      message: 'Docker build failed',
      projectId: 'project-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      category: 'DOCKERFILE_SYNTAX',
      detail: 'Syntax error on line 5',
    });

    expect(item.type).toBe('needs_user_action');
    expect(item.title).toBe('Docker build failed');
    expect(item.category).toBe('DOCKERFILE_SYNTAX');
    expect(item.detail).toBe('Syntax error on line 5');
  });
});
