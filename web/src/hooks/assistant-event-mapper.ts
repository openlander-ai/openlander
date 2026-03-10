import type { BuildStreamEvent, QuestionData } from '@/lib/event-types';
import type { ChatStreamEvent } from '../types/index.js';

export interface AssistantItem {
  id: string;
  type:
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'message'
    | 'text_delta'
    | 'question'
    | 'needs_user_action'
    | 'error';
  timestamp: string;
  role?: 'user' | 'agent';
  content?: string;
  questionId?: string;
  questions?: QuestionData[];
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  toolSuccess?: boolean;
  toolError?: string;
  category?: string;
  detail?: string;
  questionData?: QuestionData;
}

/**
 * Convert a BuildStreamEvent (from deploy NDJSON stream) to an AssistantItem.
 * Returns null if the event type is not relevant to the assistant panel.
 */
export function buildEventToAssistantItem(event: BuildStreamEvent): AssistantItem | null {
  switch (event.type) {
    case 'needs_user_action':
      return {
        id: event.id || `action-${Date.now()}`,
        type: 'needs_user_action',
        timestamp: event.timestamp,
        content: event.message,
        category: event.category,
        detail: event.userDetail || event.detail || undefined,
      };
    case 'error':
      return {
        id: event.id || `error-${Date.now()}`,
        type: 'error',
        timestamp: event.timestamp,
        content: event.message,
        detail: event.detail || undefined,
      };
    case 'agent_thinking':
      return {
        id: event.id || `thinking-${Date.now()}`,
        type: 'thinking',
        timestamp: event.timestamp,
      };
    case 'agent_tool_call':
      return {
        id: event.id || `tool_call-${Date.now()}`,
        type: 'tool_call',
        timestamp: event.timestamp,
        toolName: event.toolName,
        toolArgs: event.toolArguments,
      };
    case 'agent_tool_result':
      return {
        id: event.id || `tool_result-${Date.now()}`,
        type: 'tool_result',
        timestamp: event.timestamp,
        toolName: event.toolName,
        toolResult: event.toolResult,
        toolSuccess: event.toolSuccess,
        toolError: event.toolError || undefined,
      };
    case 'agent_message':
      return {
        id: event.id || `message-${Date.now()}`,
        type: 'message',
        timestamp: event.timestamp,
        role: 'agent',
        content: event.content || event.message,
      };
    case 'question_pending':
      return {
        id: event.id || `question-${Date.now()}`,
        type: 'question',
        timestamp: event.timestamp,
        questionId: event.questionId,
        questions: event.questions,
        content: event.message,
        questionData: event.questions?.[0],
      };
    default:
      return null;
  }
}

/**
 * Convert a ChatStreamEvent (from /api/agent/chat) to an AssistantItem.
 * Returns null for session/done events (handled by hook state).
 */
export function chatEventToAssistantItem(event: ChatStreamEvent): AssistantItem | null {
  const ts = new Date().toISOString();

  switch (event.type) {
    case 'thinking':
      return { id: `thinking-${Date.now()}`, type: 'thinking', timestamp: ts };
    case 'text_delta':
      return {
        id: `text_delta-${Date.now()}`,
        type: 'text_delta',
        timestamp: ts,
        content: event.text,
      };
    case 'message':
      return {
        id: `message-${Date.now()}`,
        type: 'message',
        timestamp: ts,
        role: 'agent',
        content: event.content,
      };
    case 'tool_call':
      return {
        id: `tool_call-${Date.now()}`,
        type: 'tool_call',
        timestamp: ts,
        toolName: event.toolName,
        toolArgs: event.arguments,
      };
    case 'tool_result':
      return {
        id: `tool_result-${Date.now()}`,
        type: 'tool_result',
        timestamp: ts,
        toolName: event.toolName,
        toolResult: event.result,
        toolSuccess: event.success,
        toolError: event.error,
      };
    case 'question':
      return {
        id: `question-${Date.now()}`,
        type: 'question',
        timestamp: ts,
        questionId: event.request.id,
        questions: event.request.questions as QuestionData[],
        questionData: event.request.questions[0] as QuestionData,
      };
    case 'error':
      return { id: `error-${Date.now()}`, type: 'error', timestamp: ts, content: event.error };
    case 'session':
    case 'done':
      return null;
  }
}
