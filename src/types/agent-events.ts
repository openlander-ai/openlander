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
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; success: boolean; result?: unknown; error?: string }
  | { type: 'message'; content: string }
  | { type: 'question'; request: QuestionRequest }
  | { type: 'done'; toolResults?: ToolResult[]; usage?: UsageSummary }
  | { type: 'error'; error: string };
