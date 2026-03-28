import { useState, useEffect, useRef, useCallback } from 'react';
import { type TimelineItem, type BuildStreamEvent, toTimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';
import { getProjectTimeline } from '@/lib/api';

interface UseTimelineOptions {
  projectId: string | undefined;
  enabled?: boolean;
  /** Change this value to force timeline reset + stream reconnect (e.g. on redeploy) */
  runKey?: number;
  /** Called when the build stream completes or errors — use to refetch project data */
  onSettled?: () => void;
  onRawEvent?: (event: BuildStreamEvent) => void;
}

interface UseTimelineReturn {
  items: TimelineItem[];
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
  disconnected: boolean;
  submitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => Promise<void>;
  skipQuestion: (questionId: string) => Promise<void>;
  executeAction: (projectId: string, action: string) => Promise<void>;
}

const MAX_RETRIES = 5;
const RETRY_DELAY = 3000;

function shouldTreatEventAsActiveBuild(event: BuildStreamEvent): boolean {
  if (event.type === 'complete') {
    return false;
  }

  if (event.type === 'status') {
    return /build in progress/i.test(event.message);
  }

  return true;
}

export function useTimeline({
  projectId,
  enabled = true,
  runKey = 0,
  onSettled,
  onRawEvent,
}: UseTimelineOptions): UseTimelineReturn {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const retriesRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const onSettledRef = useRef(onSettled);
  const onRawEventRef = useRef(onRawEvent);
  onSettledRef.current = onSettled;
  onRawEventRef.current = onRawEvent;

  const getEventKey = useCallback((event: BuildStreamEvent): string => {
    if (event.id) return event.id;
    return `${event.type}|${event.timestamp}|${event.message}`;
  }, []);

  const appendEvent = useCallback(
    (event: BuildStreamEvent) => {
      const key = getEventKey(event);
      if (seenEventKeysRef.current.has(key)) {
        return;
      }
      seenEventKeysRef.current.add(key);

      onRawEventRef.current?.(event);

      const item = toTimelineItem(event);
      setItems((prev) => {
        const isProgress = item.type === 'progress';
        if (isProgress) {
          return [...prev.filter((p) => p.type !== 'progress'), item];
        }
        return [...prev, item];
      });
    },
    [getEventKey],
  );

  const connect = useCallback(async () => {
    if (!projectId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setError(null);
    setDisconnected(false);

    try {
      const freshStartQuery = runKey > 0 ? '?fresh_start=1' : '';
      const response = await fetch(`/api/projects/${projectId}/build/stream${freshStartQuery}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      retriesRef.current = 0; // Reset retries on successful connection
      let sawActiveBuildEvent = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: BuildStreamEvent = JSON.parse(line);
            appendEvent(event);
            if (shouldTreatEventAsActiveBuild(event)) {
              sawActiveBuildEvent = true;
            }

            if (event.type === 'complete') {
              setIsComplete(true);
              setIsStreaming(false);
              onSettledRef.current?.();
              return;
            }
            if (event.type === 'error') {
              setError(event.message);
              // Do NOT return — auto-recovery may send more events after failure
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      if (sawActiveBuildEvent && retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1;
        setDisconnected(true);
        setIsStreaming(false);
        setTimeout(() => {
          if (!controller.signal.aborted) {
            connect();
          }
        }, RETRY_DELAY);
        return;
      }

      setDisconnected(false);
      setIsStreaming(false);
    } catch (err) {
      if (controller.signal.aborted) return;

      const message = err instanceof Error ? err.message : 'Stream failed';
      setError(message);
      setDisconnected(true);
      setIsStreaming(false);

      // Auto-retry on disconnect
      if (retriesRef.current < MAX_RETRIES) {
        retriesRef.current += 1;
        setTimeout(() => {
          if (!controller.signal.aborted) {
            connect();
          }
        }, RETRY_DELAY);
      }
    }
  }, [projectId, appendEvent, runKey]);

  useEffect(() => {
    if (!enabled || !projectId) return;

    setItems([]);
    setIsComplete(false);
    setError(null);
    retriesRef.current = 0;
    seenEventKeysRef.current.clear();

    let cancelled = false;
    void (async () => {
      if (runKey === 0) {
        try {
          const history = await getProjectTimeline(projectId);
          if (cancelled) return;
          for (const event of history) {
            appendEvent(event);
          }
        } catch (err) {
          void err;
        }
      }

      if (!cancelled) {
        void connect();
      }
    })();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [projectId, enabled, runKey, connect, appendEvent]);

  /** Mark a question item as answered in the timeline */
  const markAnswered = useCallback((questionId: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.type === 'question' && item.questionId === questionId
          ? { ...item, answered: true }
          : item,
      ),
    );
  }, []);

  /** Submit answers to a pending agent question */
  const submitAnswer = useCallback(
    async (questionId: string, answers: QuestionAnswerPayload[]) => {
      try {
        const res = await fetch('/api/question/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: questionId,
            answers: answers.map((a) => ({
              questionIndex: a.questionIndex,
              selectedLabels: a.selectedLabels,
              customText: a.customText,
            })),
          }),
        });
        if (res.ok) {
          markAnswered(questionId);
        }
      } catch {
        // Network error — question card stays active for retry
      }
    },
    [markAnswered],
  );

  /** Skip a question (sends empty reply) */
  const skipQuestion = useCallback(
    async (questionId: string) => {
      try {
        const res = await fetch('/api/question/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: questionId }),
        });
        if (res.ok) {
          markAnswered(questionId);
        }
      } catch {
        // Network error — question card stays active for retry
      }
    },
    [markAnswered],
  );

  /** Execute an insight action button (e.g. cleanup_stale, view_logs) */
  const executeAction = useCallback(
    async (_itemId: string, action: string) => {
      if (!projectId) return;

      // view_logs is a frontend-only action — no API call needed
      // The frontend will handle tab switching via onAction callback

      try {
        const res = await fetch(`/api/projects/${projectId}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          console.error('Action failed:', res.status);
        }
      } catch {
        // Network error — user can retry
      }
    },
    [projectId],
  );

  return {
    items,
    isStreaming,
    isComplete,
    error,
    disconnected,
    submitAnswer,
    skipQuestion,
    executeAction,
  };
}
