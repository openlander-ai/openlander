// ---------------------------------------------------------------------------
// Question types (mirrors backend QuestionBridge types)
// ---------------------------------------------------------------------------

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionData {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiple?: boolean;
}

// ---------------------------------------------------------------------------
// Build stream events (NDJSON from backend)
// ---------------------------------------------------------------------------

/** Backend build stream raw event (NDJSON) */
export interface BuildStreamEvent {
  type:
    | 'status'
    | 'complete'
    | 'error'
    | 'question_pending'
    | 'insight'
    | 'dockerfile_fixed'
    | 'agent_thinking'
    | 'agent_tool_call'
    | 'agent_message';
  message: string;
  projectId: string;
  timestamp: string;
  /** Present only for question_pending events */
  questionId?: string;
  questions?: QuestionData[];
  /** Present only for insight events */
  detail?: string | null;
  severity?: 'info' | 'warning' | 'error';
  actionButtons?: ActionButton[];
  /** Present only for dockerfile_fixed events */
  dockerfileChanges?: string[];
  retryCount?: number;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  content?: string;
}

/** Action button for insight/anomaly timeline items */
export interface ActionButton {
  label: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Frontend timeline items
// ---------------------------------------------------------------------------

/** Frontend timeline display item */
export interface TimelineItem {
  id: string;
  type:
    | 'progress'
    | 'success'
    | 'error'
    | 'question'
    | 'insight'
    | 'dockerfile_fixed'
    | 'agent_thinking'
    | 'agent_tool_call'
    | 'agent_message';
  timestamp: string;
  title: string;
  detail?: string;
  percent: number;
  url?: string;
  /** Present only for question items */
  questionId?: string;
  questions?: QuestionData[];
  answered?: boolean;
  /** Present only for insight items */
  actionButtons?: ActionButton[];
  severity?: 'info' | 'warning' | 'error';
  /** Present only for dockerfile_fixed items */
  dockerfileChanges?: string[];
  retryCount?: number;
  /** Present only for agent_tool_call items */
  toolName?: string;
  toolArguments?: Record<string, unknown>;
}

/** Message pattern → progress percentage mapping */
const progressPatterns: Array<{ pattern: RegExp; percent: number }> = [
  { pattern: /starting deployment/i, percent: 0 },
  { pattern: /cloning repository/i, percent: 25 },
  { pattern: /docker image built/i, percent: 60 },
  { pattern: /starting container/i, percent: 90 },
  { pattern: /build in progress/i, percent: 10 },
];

function estimatePercent(message: string): number {
  for (const { pattern, percent } of progressPatterns) {
    if (pattern.test(message)) return percent;
  }
  return 50; // unknown status → middle
}

/** Extract URL from complete message (e.g. "Deploy complete in 45s — http://...") */
function extractUrl(message: string): string | undefined {
  const match = message.match(/(https?:\/\/\S+)/);
  return match?.[1];
}

let idCounter = 0;

/** Convert backend NDJSON event to frontend timeline item */
export function toTimelineItem(event: BuildStreamEvent): TimelineItem {
  idCounter += 1;
  const id = `tl-${idCounter}-${event.timestamp}`;

  switch (event.type) {
    case 'complete':
      return {
        id,
        type: 'success',
        timestamp: event.timestamp,
        title: event.message,
        percent: 100,
        url: extractUrl(event.message),
      };
    case 'error':
      return {
        id,
        type: 'error',
        timestamp: event.timestamp,
        title: event.message,
        detail: event.detail ?? undefined,
        percent: -1,
      };
    case 'question_pending':
      return {
        id,
        type: 'question',
        timestamp: event.timestamp,
        title: event.message,
        percent: -1,
        questionId: event.questionId,
        questions: event.questions,
        answered: false,
      };
    case 'insight':
      return {
        id,
        type: 'insight',
        timestamp: event.timestamp,
        title: event.message,
        detail: event.detail ?? undefined,
        percent: -1,
        severity: event.severity ?? 'info',
        actionButtons: event.actionButtons,
      };
    case 'dockerfile_fixed':
      return {
        id,
        type: 'dockerfile_fixed',
        timestamp: event.timestamp,
        title: event.message,
        percent: -1,
        dockerfileChanges: event.dockerfileChanges,
        retryCount: event.retryCount,
      };
    case 'agent_thinking':
      return {
        id,
        type: 'agent_thinking',
        timestamp: event.timestamp,
        title: event.message || 'Agent is analyzing...',
        percent: -1,
      };
    case 'agent_tool_call':
      return {
        id,
        type: 'agent_tool_call',
        timestamp: event.timestamp,
        title: `Calling ${event.toolName ?? 'tool'}`,
        percent: -1,
        toolName: event.toolName,
        toolArguments: event.toolArguments ? sanitizeToolArguments(event.toolArguments) : undefined,
      };
    case 'agent_message':
      return {
        id,
        type: 'agent_message',
        timestamp: event.timestamp,
        title: event.content ?? event.message,
        percent: -1,
      };
    default:
      return {
        id,
        type: 'progress',
        timestamp: event.timestamp,
        title: event.message,
        percent: estimatePercent(event.message),
      };
  }
}

// ---------------------------------------------------------------------------
// Secret masking for tool_call arguments (spec §3.1, issue #9)
// ---------------------------------------------------------------------------

/** Keys whose values should be fully masked */
const SECRET_VALUE_KEYS = new Set(['env_vars', 'envVars', 'environment_variables']);

/** Keys whose values should be replaced with [redacted] */
const REDACTED_KEYS = new Set([
  'ssh_key_path',
  'sshKeyPath',
  'ssh_key',
  'private_key',
  'token',
  'api_key',
  'apiKey',
  'password',
  'secret',
]);

/**
 * Sanitize tool_call arguments for display.
 * - env_vars values → ***
 * - ssh_key_path etc. → [redacted]
 */
export function sanitizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_VALUE_KEYS.has(key) && typeof value === 'object' && value !== null) {
      // Mask all values in env_vars-like objects
      const masked: Record<string, string> = {};
      for (const envKey of Object.keys(value as Record<string, unknown>)) {
        masked[envKey] = '***';
      }
      sanitized[key] = masked;
    } else if (REDACTED_KEYS.has(key)) {
      sanitized[key] = '[redacted]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ---------------------------------------------------------------------------
// Agent SSE event → Timeline item converter
// ---------------------------------------------------------------------------

import type { ChatStreamEvent } from '../types';

/** Convert agent SSE event to a timeline item for Phase A display */
export function agentEventToTimelineItem(
  event: ChatStreamEvent & { timestamp?: string },
): TimelineItem | null {
  idCounter += 1;
  const ts = ((event as Record<string, unknown>).timestamp as string) ?? new Date().toISOString();
  const id = `agent-${idCounter}-${ts}`;

  switch (event.type) {
    case 'thinking':
      return {
        id,
        type: 'agent_thinking',
        timestamp: ts,
        title: 'Agent is analyzing...',
        percent: -1,
      };
    case 'tool_call':
      return {
        id,
        type: 'agent_tool_call',
        timestamp: ts,
        title: `Calling ${event.toolName}`,
        percent: -1,
        toolName: event.toolName,
        toolArguments: sanitizeToolArguments(event.arguments),
      };
    case 'message':
      return {
        id,
        type: 'agent_message',
        timestamp: ts,
        title: event.content,
        percent: -1,
      };
    case 'tool_result':
      return {
        id,
        type: event.success ? 'success' : 'error',
        timestamp: ts,
        title: event.success
          ? `${event.toolName} completed`
          : `${event.toolName} failed: ${event.error ?? 'unknown error'}`,
        percent: event.success ? 50 : -1,
      };
    case 'error':
      return {
        id,
        type: 'error',
        timestamp: ts,
        title: event.error,
        percent: -1,
      };
    default:
      return null;
  }
}
