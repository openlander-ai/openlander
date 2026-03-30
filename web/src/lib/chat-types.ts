// ---------------------------------------------------------------------------
// Tool Result
// ---------------------------------------------------------------------------

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

// ---------------------------------------------------------------------------
// Question types (mirrors backend QuestionBridge)
// ---------------------------------------------------------------------------

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
  metadata?: Record<string, unknown>;
}

export interface QuestionRequest {
  id: string;
  questions: Question[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedLabels: string[];
  customText?: string;
}

// ---------------------------------------------------------------------------
// Chat Stream Events
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' }
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

// ---------------------------------------------------------------------------
// Chat Message
// ---------------------------------------------------------------------------

export interface ToolCallInfo {
  toolName: string;
  arguments: Record<string, unknown>;
  toolResult?: ToolResult;
  stepIndex?: number;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCallInfo[];
  createdAt?: string;
}
