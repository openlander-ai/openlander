import { useState, useEffect, useRef, useCallback } from 'react';

export interface LogEntry {
  id: number;
  line: string;
  stream: 'stdout' | 'stderr';
  time: string;
}

interface UseLogStreamOptions {
  projectId: string | undefined;
  follow: boolean;
  enabled?: boolean;
}

interface UseLogStreamReturn {
  entries: LogEntry[];
  isConnected: boolean;
  error: string | null;
  clear: () => void;
}

let logIdCounter = 0;

export function useLogStream({
  projectId,
  follow,
  enabled = true,
}: UseLogStreamOptions): UseLogStreamReturn {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  // Static log fetch (non-follow mode)
  const fetchStatic = useCallback(async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/logs?lines=500`);
      if (!res.ok) throw new Error(`Logs error: ${res.status}`);
      const data = await res.json();
      const logs: string = data.logs ?? '';
      const parsed: LogEntry[] = logs
        .split('\n')
        .filter((l: string) => l.trim())
        .map((line: string) => {
          logIdCounter += 1;
          return {
            id: logIdCounter,
            line,
            stream: 'stdout' as const,
            time: new Date().toISOString(),
          };
        });
      setEntries(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    }
  }, [projectId]);

  // Streaming log connection
  const connectStream = useCallback(async () => {
    if (!projectId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsConnected(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/logs?follow=true`, {
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Stream error: ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        const newEntries: LogEntry[] = [];
        for (const rawLine of lines) {
          if (!rawLine.trim()) continue;
          try {
            const parsed = JSON.parse(rawLine);
            if (parsed.error) {
              setError(parsed.error);
              continue;
            }
            logIdCounter += 1;
            newEntries.push({
              id: logIdCounter,
              line: parsed.line ?? rawLine,
              stream: parsed.stream === 'stderr' ? 'stderr' : 'stdout',
              time: parsed.time ?? new Date().toISOString(),
            });
          } catch {
            // Malformed JSON — treat as raw text
            logIdCounter += 1;
            newEntries.push({
              id: logIdCounter,
              line: rawLine,
              stream: 'stdout',
              time: new Date().toISOString(),
            });
          }
        }

        if (newEntries.length > 0) {
          setEntries((prev) => [...prev, ...newEntries]);
        }
      }

      setIsConnected(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Stream failed');
      setIsConnected(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!enabled || !projectId) return;

    setEntries([]);
    setError(null);

    if (follow) {
      connectStream();
    } else {
      fetchStatic();
    }

    return () => {
      abortRef.current?.abort();
    };
  }, [projectId, follow, enabled, connectStream, fetchStatic]);

  return { entries, isConnected, error, clear };
}
