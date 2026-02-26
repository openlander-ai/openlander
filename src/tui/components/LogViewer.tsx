/**
 * LogViewer — shown in debug mode (bottom section).
 *
 * Streams real-time container logs via IPC streamLogs().
 * Uses ScrollableLog for auto-scroll + manual browsing.
 * Fetches initial 50 lines, then streams new lines as they arrive.
 */
import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';
import type { OpenLanderClient } from '../../ipc/client.js';
import { ScrollableLog } from './ScrollableLog.js';
import type { LogLine } from './ScrollableLog.js';

interface LogViewerProps {
  projectId: string;
  projectName: string;
  client: OpenLanderClient | null;
  height: number;
  /** Whether this component should handle keyboard input */
  focus?: boolean;
}

export function LogViewer(props: LogViewerProps): JSX.Element {
  const [logLines, setLogLines] = createSignal<LogLine[]>([]);
  const [streaming, setStreaming] = createSignal(false);

  let abortController: AbortController | null = null;
  let lineCounter = 0;

  const addLogLine = (text: string, stream: 'stdout' | 'stderr' = 'stdout', timestamp?: string) => {
    lineCounter++;
    setLogLines((prev) => [
      ...prev,
      {
        id: `log-${String(lineCounter)}`,
        text,
        stream,
        timestamp,
        color: stream === 'stderr' ? theme.error : undefined,
      },
    ]);
  };

  // Start streaming when projectId and client are available
  createEffect(() => {
    const projectId = props.projectId;
    const client = props.client;
    if (!projectId || !client) return;

    // Reset state for new project
    setLogLines([]);
    lineCounter = 0;

    // Start streaming logs
    abortController = new AbortController();
    setStreaming(true);

    void (async () => {
      try {
        for await (const entry of client.streamLogs(projectId, abortController.signal)) {
          const ts = entry.timestamp
            ? new Date(entry.timestamp).toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : undefined;
          addLogLine(entry.message, entry.stream, ts);
        }
      } catch {
        // Stream ended or aborted — normal
      } finally {
        setStreaming(false);
      }
    })();
  });

  // Cleanup on unmount
  onCleanup(() => {
    abortController?.abort();
  });

  return (
    <ScrollableLog
      lines={logLines()}
      height={props.height}
      focus={props.focus ?? false}
      title={`▸ Logs — ${props.projectName}`}
      statusText={streaming() ? 'streaming' : 'disconnected'}
    />
  );
}
