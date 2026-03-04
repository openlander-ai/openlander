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
  type: 'status' | 'complete' | 'error' | 'question_pending' | 'insight';
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
  type: 'progress' | 'success' | 'error' | 'question' | 'insight';
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
