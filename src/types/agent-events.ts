import type { QuestionRequest } from '../lib/question-bridge.js';

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentResponse {
  message: string;
  toolResults?: ToolResult[];
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

export type ChatStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' }
  | { type: 'step_progress'; step: number; toolName?: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown>; stepIndex: number }
  | {
      type: 'tool_result';
      toolName: string;
      success: boolean;
      result?: unknown;
      error?: string;
      stepIndex: number;
    }
  | { type: 'message'; content: string }
  | { type: 'question'; request: QuestionRequest }
  | { type: 'done'; toolResults?: ToolResult[]; usage?: UsageSummary }
  | { type: 'error'; error: string };
