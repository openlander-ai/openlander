import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildEventToAssistantItem,
  chatEventToAssistantItem,
} from '../web/src/hooks/assistant-event-mapper';
import type { BuildStreamEvent } from '../web/src/lib/event-types';
import type { ChatStreamEvent } from '../web/src/types';

describe('buildEventToAssistantItem', () => {
  const base: BuildStreamEvent = {
    message: 'test message',
    projectId: 'p1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'status',
  };

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps needs_user_action with category and userDetail', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'needs_user_action',
      category: 'CLONE_AUTH_FAILURE',
      userDetail: 'SSH key not found',
    });
    expect(item).not.toBeNull();
    expect(item!.type).toBe('needs_user_action');
    expect(item!.content).toBe('test message');
    expect(item!.category).toBe('CLONE_AUTH_FAILURE');
    expect(item!.detail).toBe('SSH key not found');
  });

  it('uses event.id when provided for needs_user_action', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'needs_user_action',
      id: 'custom-id-1',
      category: 'DOCKERFILE_SYNTAX',
    });
    expect(item!.id).toBe('custom-id-1');
  });

  it('maps error event', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'error',
      detail: 'Build failed at step 3',
    });
    expect(item!.type).toBe('error');
    expect(item!.content).toBe('test message');
    expect(item!.detail).toBe('Build failed at step 3');
  });

  it('maps agent_thinking event', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'agent_thinking',
    });
    expect(item!.type).toBe('thinking');
    expect(item!.id).toBe('thinking-1000');
  });

  it('maps agent_tool_call event', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'agent_tool_call',
      toolName: 'readFile',
      toolArguments: { path: '/tmp/test' },
    });
    expect(item!.type).toBe('tool_call');
    expect(item!.toolName).toBe('readFile');
    expect(item!.toolArgs).toEqual({ path: '/tmp/test' });
  });

  it('maps agent_tool_result event', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'agent_tool_result',
      toolName: 'readFile',
      toolResult: 'file contents',
      toolSuccess: true,
      toolError: null,
    });
    expect(item!.type).toBe('tool_result');
    expect(item!.toolName).toBe('readFile');
    expect(item!.toolResult).toBe('file contents');
    expect(item!.toolSuccess).toBe(true);
    expect(item!.toolError).toBeUndefined();
  });

  it('maps agent_message event using content field', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'agent_message',
      content: 'Analysis complete',
    });
    expect(item!.type).toBe('message');
    expect(item!.role).toBe('agent');
    expect(item!.content).toBe('Analysis complete');
  });

  it('maps agent_message falling back to message when content is undefined', () => {
    const item = buildEventToAssistantItem({
      ...base,
      type: 'agent_message',
      message: 'fallback message',
    });
    expect(item!.type).toBe('message');
    expect(item!.content).toBe('fallback message');
  });

  it('maps question_pending event', () => {
    const questions = [
      { question: 'Pick a port', options: [{ label: '3000' }, { label: '8080' }] },
    ];
    const item = buildEventToAssistantItem({
      ...base,
      type: 'question_pending',
      questionId: 'q-1',
      questions,
    });
    expect(item!.type).toBe('question');
    expect(item!.questionId).toBe('q-1');
    expect(item!.questions).toEqual(questions);
    expect(item!.questionData).toEqual(questions[0]);
    expect(item!.content).toBe('test message');
  });

  it('preserves question metadata from question_pending event', () => {
    const questions = [
      {
        question: 'Apply this Dockerfile fix?',
        options: [{ label: 'Apply' }, { label: 'Skip' }],
        metadata: {
          fixType: 'dockerfile',
          filePath: 'Dockerfile',
          changes: ['Updated base image'],
        },
      },
    ];
    const item = buildEventToAssistantItem({
      ...base,
      type: 'question_pending',
      questionId: 'q-meta-1',
      questions,
    });

    expect(item).not.toBeNull();
    expect(item!.type).toBe('question');
    expect(item!.questionData?.metadata).toEqual({
      fixType: 'dockerfile',
      filePath: 'Dockerfile',
      changes: ['Updated base image'],
    });
  });

  it('returns null for status event', () => {
    expect(buildEventToAssistantItem({ ...base, type: 'status' })).toBeNull();
  });

  it('returns null for complete event', () => {
    expect(buildEventToAssistantItem({ ...base, type: 'complete' })).toBeNull();
  });

  it('returns null for insight event', () => {
    expect(buildEventToAssistantItem({ ...base, type: 'insight' })).toBeNull();
  });
});

describe('chatEventToAssistantItem', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-06-01T00:00:00.000Z');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps thinking event', () => {
    const item = chatEventToAssistantItem({ type: 'thinking' });
    expect(item!.type).toBe('thinking');
    expect(item!.id).toBe('thinking-2000');
  });

  it('maps text_delta event', () => {
    const item = chatEventToAssistantItem({ type: 'text_delta', text: 'hello world' });
    expect(item!.type).toBe('text_delta');
    expect(item!.content).toBe('hello world');
  });

  it('maps message event', () => {
    const item = chatEventToAssistantItem({ type: 'message', content: 'done analyzing' });
    expect(item!.type).toBe('message');
    expect(item!.role).toBe('agent');
    expect(item!.content).toBe('done analyzing');
  });

  it('maps tool_call event', () => {
    const item = chatEventToAssistantItem({
      type: 'tool_call',
      toolName: 'deploy',
      arguments: { repo: 'https://github.com/test/app' },
    });
    expect(item!.type).toBe('tool_call');
    expect(item!.toolName).toBe('deploy');
    expect(item!.toolArgs).toEqual({ repo: 'https://github.com/test/app' });
  });

  it('maps tool_result event', () => {
    const item = chatEventToAssistantItem({
      type: 'tool_result',
      toolName: 'deploy',
      success: true,
      result: { url: 'http://app.local' },
      error: undefined,
    });
    expect(item!.type).toBe('tool_result');
    expect(item!.toolName).toBe('deploy');
    expect(item!.toolSuccess).toBe(true);
    expect(item!.toolResult).toEqual({ url: 'http://app.local' });
    expect(item!.toolError).toBeUndefined();
  });

  it('maps tool_result with error', () => {
    const item = chatEventToAssistantItem({
      type: 'tool_result',
      toolName: 'deploy',
      success: false,
      error: 'port conflict',
    });
    expect(item!.type).toBe('tool_result');
    expect(item!.toolSuccess).toBe(false);
    expect(item!.toolError).toBe('port conflict');
  });

  it('maps question event', () => {
    const item = chatEventToAssistantItem({
      type: 'question',
      request: {
        id: 'q-2',
        questions: [{ question: 'Select framework', options: [{ label: 'Next.js' }] }],
      },
    });
    expect(item!.type).toBe('question');
    expect(item!.questionId).toBe('q-2');
    expect(item!.questions).toHaveLength(1);
    expect(item!.questionData).toEqual({
      question: 'Select framework',
      options: [{ label: 'Next.js' }],
    });
  });

  it('preserves question metadata from chat question event', () => {
    const event: ChatStreamEvent = {
      type: 'question',
      request: {
        id: 'q-meta-2',
        questions: [
          {
            question: 'Apply this compose fix?',
            options: [{ label: 'Apply' }, { label: 'Show alternatives' }],
          },
        ],
      },
    };

    const firstQuestion = event.request.questions[0] as Record<string, unknown>;
    firstQuestion.metadata = {
      fixType: 'compose',
      errorType: 'env_file_missing',
    };

    const item = chatEventToAssistantItem(event);

    expect(item).not.toBeNull();
    expect(item!.type).toBe('question');
    expect(item!.questionData?.metadata).toEqual({
      fixType: 'compose',
      errorType: 'env_file_missing',
    });
  });

  it('maps error event', () => {
    const item = chatEventToAssistantItem({ type: 'error', error: 'connection lost' });
    expect(item!.type).toBe('error');
    expect(item!.content).toBe('connection lost');
  });

  it('returns null for session event', () => {
    expect(chatEventToAssistantItem({ type: 'session', sessionId: 's1' })).toBeNull();
  });

  it('returns null for done event', () => {
    expect(chatEventToAssistantItem({ type: 'done' })).toBeNull();
  });
});
