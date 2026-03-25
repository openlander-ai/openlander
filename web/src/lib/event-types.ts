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
  metadata?: Record<string, unknown>;
}

export interface FixSuggestion {
  description: string;
  location?: string;
  confidence: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Build stream events (NDJSON from backend)
// ---------------------------------------------------------------------------

/** Backend build stream raw event (NDJSON) */
export interface BuildStreamEvent {
  id?: string;
  type:
    | 'status'
    | 'log'
    | 'complete'
    | 'error'
    | 'agent_thinking'
    | 'agent_tool_call'
    | 'agent_tool_result'
    | 'agent_message'
    | 'question_pending'
    | 'insight'
    | 'dockerfile_fixed'
    | 'needs_user_action'
    | 'recovery_start'
    | 'recovery_success'
    | 'recovery_failed'
    | 'recovery_exhausted';
  message: string;
  projectId: string;
  timestamp: string;
  percent?: number;
  /** Pipeline step name (e.g., 'Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete') */
  stepName?: string;
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
  category?: string;
  userMessage?: string;
  userDetail?: string;
  phase?: string;
  scope?: string;
  status?: 'pending' | 'in_progress' | 'success' | 'failed';
  durationMs?: number;
  logChunk?: string;
  sourceProjectId?: string;
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
    | 'log'
    | 'success'
    | 'error'
    | 'question'
    | 'insight'
    | 'dockerfile_fixed'
    | 'agent_thinking'
    | 'agent_tool_call'
    | 'agent_tool_result'
    | 'agent_message'
    | 'needs_user_action'
    | 'recovery_start'
    | 'recovery_success'
    | 'recovery_failed'
    | 'recovery_exhausted';
  timestamp: string;
  title: string;
  detail?: string;
  percent: number;
  url?: string;
  /** Pipeline step name for progress items */
  stepName?: string;
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
  category?: string;
  phase?: string;
  scope?: string;
  status?: 'pending' | 'in_progress' | 'success' | 'failed';
  durationMs?: number;
  logChunk?: string;
  sourceProjectId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolResult?: unknown;
  toolError?: string;
  toolSuccess?: boolean;
  /** Present only for agent_thinking items — detailed thinking content */
  content?: string;
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

/**
 * Filter timeline items to show only the first recovery_start event.
 * Subsequent recovery_start events are skipped, but all recovery results
 * (success/failed/exhausted) are always shown.
 */
export function filterRecoveryEvents(items: TimelineItem[]): TimelineItem[] {
  let recoveryStartSeen = false;

  return items.filter((item) => {
    if (item.type === 'recovery_start') {
      if (recoveryStartSeen) {
        return false; // Skip subsequent recovery_start events
      }
      recoveryStartSeen = true;
      return true;
    }
    return true;
  });
}

/** Convert backend NDJSON event to frontend timeline item */
export function toTimelineItem(event: BuildStreamEvent): TimelineItem {
  idCounter += 1;
  const id = event.id ?? `tl-${idCounter}-${event.timestamp}`;
  const progressPercent = event.percent ?? estimatePercent(event.message);
  const scopedMeta = {
    phase: event.phase,
    scope: event.scope,
    status: event.status,
    durationMs: event.durationMs,
    logChunk: event.logChunk,
    sourceProjectId: event.sourceProjectId,
  };

  switch (event.type) {
    case 'log':
      return {
        id,
        type: 'log',
        timestamp: event.timestamp,
        title: event.message,
        percent: -1,
        ...scopedMeta,
      };
    case 'complete':
      return {
        id,
        type: 'success',
        timestamp: event.timestamp,
        title: event.message,
        percent: event.percent ?? 100,
        url: extractUrl(event.message),
        ...scopedMeta,
      };
    case 'error':
      return {
        id,
        type: 'error',
        timestamp: event.timestamp,
        title: event.message,
        detail: event.detail ?? undefined,
        percent: event.percent ?? -1,
        ...scopedMeta,
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
        ...scopedMeta,
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
        ...scopedMeta,
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
        ...scopedMeta,
      };

    case 'needs_user_action':
      return {
        id,
        type: 'needs_user_action',
        timestamp: event.timestamp,
        title: event.message,
        percent: -1,
        category: event.category,
        detail: event.userDetail ?? event.detail ?? undefined,
        ...scopedMeta,
      };
    case 'recovery_start':
    case 'recovery_success':
    case 'recovery_failed':
    case 'recovery_exhausted':
      return {
        id,
        type: event.type,
        timestamp: event.timestamp,
        title: event.message,
        detail: event.detail ?? undefined,
        percent: -1,
        retryCount: event.retryCount,
        actionButtons: event.actionButtons,
        ...scopedMeta,
      };
    default:
      return {
        id,
        type: 'progress',
        timestamp: event.timestamp,
        title: event.message,
        percent: progressPercent,
        stepName: event.stepName,
        ...scopedMeta,
      };
  }
}
