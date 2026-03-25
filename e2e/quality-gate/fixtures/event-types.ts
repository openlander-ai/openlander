export interface TimelineEvent {
  id?: string;
  type: string;
  message?: string;
  projectId?: string;
  timestamp?: string;
  percent?: number;
  stepName?: string;
  scope?: string;
  url?: string;
  durationMs?: number;
  severity?: string;
  logChunk?: string;
  [key: string]: unknown;
}

export const STREAM_TYPES = {
  STATUS: 'status',
  LOG: 'log',
  COMPLETE: 'complete',
  ERROR: 'error',
  INSIGHT: 'insight',
} as const;

export const STEP_NAMES = {
  PREPARING: 'Preparing',
  CLONE: 'Clone',
  BUILD: 'Build',
  START: 'Start',
  COMPLETE: 'Complete',
} as const;
