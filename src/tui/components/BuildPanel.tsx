/**
 * BuildPanel — shown in deploy mode (right panel, bottom section).
 *
 * Features:
 * - Pipeline visualization: Clone ✅ → Build ◐ → Run ○ → Expose ○
 * - Real-time build log streaming via IPC streamBuildProgress()
 * - ScrollableLog for auto-scroll + manual browsing
 * - Build completion: total elapsed time display
 * - Build failure: error message highlighted
 */
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';
import type { OpenLanderClient, BuildProgressEvent } from '../../ipc/client.js';
import { buildSessionCount, selectedBuildIndex, scheduleDeployReturn } from '../state/mode.js';
import { ScrollableLog } from './ScrollableLog.js';
import type { LogLine } from './ScrollableLog.js';
import { Spinner } from './Spinner.js';

// Pipeline stages in order
const PIPELINE_STAGES = ['Clone', 'Build', 'Run', 'Expose'] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];
type StageStatus = 'pending' | 'active' | 'done' | 'error';

/** Map stage status to display icon */
function stageIcon(status: StageStatus): string {
  switch (status) {
    case 'done':
      return '✅';
    case 'active':
      return '◐';
    case 'error':
      return '❌';
    case 'pending':
    default:
      return '○';
  }
}

/** Map stage status to color */
function stageColor(status: StageStatus): string {
  switch (status) {
    case 'done':
      return theme.success;
    case 'active':
      return theme.warning;
    case 'error':
      return theme.error;
    case 'pending':
    default:
      return theme.textDim;
  }
}

/** Infer pipeline stage from build progress event message */
function inferStage(message: string): PipelineStage | null {
  const lower = message.toLowerCase();
  if (lower.includes('clone') || lower.includes('cloning') || lower.includes('git')) return 'Clone';
  if (
    lower.includes('build') ||
    lower.includes('docker') ||
    lower.includes('step') ||
    lower.includes('layer') ||
    lower.includes('npm') ||
    lower.includes('yarn') ||
    lower.includes('pip') ||
    lower.includes('cargo')
  )
    return 'Build';
  if (lower.includes('start') || lower.includes('container') || lower.includes('running'))
    return 'Run';
  if (
    lower.includes('expose') ||
    lower.includes('port') ||
    lower.includes('proxy') ||
    lower.includes('domain') ||
    lower.includes('route')
  )
    return 'Expose';
  return null;
}

interface BuildPanelProps {
  projectId: string;
  client: OpenLanderClient | null;
  height: number;
  /** Whether this panel has keyboard focus */
  focus?: boolean;
}

export function BuildPanel(props: BuildPanelProps): JSX.Element {
  const [logLines, setLogLines] = createSignal<LogLine[]>([]);
  const [stages, setStages] = createSignal<Record<PipelineStage, StageStatus>>({
    Clone: 'pending',
    Build: 'pending',
    Run: 'pending',
    Expose: 'pending',
  });
  const [buildComplete, setBuildComplete] = createSignal(false);
  const [buildError, setBuildError] = createSignal<string | null>(null);
  const [elapsedMs, setElapsedMs] = createSignal(0);
  const [streaming, setStreaming] = createSignal(false);

  let abortController: AbortController | null = null;
  let startTime = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let lineCounter = 0;

  const addLogLine = (text: string, color?: string, stream?: 'stdout' | 'stderr') => {
    lineCounter++;
    setLogLines((prev) => [
      ...prev,
      {
        id: `build-${String(lineCounter)}`,
        text,
        color,
        stream,
      },
    ]);
  };

  const advanceStage = (stage: PipelineStage, status: StageStatus) => {
    setStages((prev) => {
      const next = { ...prev };
      next[stage] = status;
      return next;
    });
  };

  const processEvent = (event: BuildProgressEvent) => {
    const inferredStage = inferStage(event.message);

    switch (event.type) {
      case 'status': {
        // Status events advance the pipeline
        if (inferredStage) {
          // Mark all previous stages as done
          const stageIdx = PIPELINE_STAGES.indexOf(inferredStage);
          setStages((prev) => {
            const next = { ...prev };
            for (let i = 0; i < stageIdx; i++) {
              const s = PIPELINE_STAGES[i] as PipelineStage;
              if (next[s] !== 'error') {
                next[s] = 'done';
              }
            }
            next[inferredStage] = 'active';
            return next;
          });
        }
        addLogLine(`▸ ${event.message}`, theme.info);
        break;
      }
      case 'log': {
        // Build output lines
        if (inferredStage) {
          advanceStage(inferredStage, 'active');
        }
        addLogLine(event.message);
        break;
      }
      case 'error': {
        if (inferredStage) {
          advanceStage(inferredStage, 'error');
        }
        setBuildError(event.message);
        addLogLine(`✗ ${event.message}`, theme.error, 'stderr');
        break;
      }
      case 'complete': {
        // Mark all stages as done
        setStages({
          Clone: 'done',
          Build: 'done',
          Run: 'done',
          Expose: 'done',
        });
        setBuildComplete(true);
        addLogLine(`✓ ${event.message}`, theme.success);
        // Auto-return to monitoring after 3 seconds
        scheduleDeployReturn(3);
        break;
      }
    }
  };

  // Start streaming when projectId and client are available
  createEffect(() => {
    const projectId = props.projectId;
    const client = props.client;
    if (!projectId || !client) return;

    // Reset state for new build
    setLogLines([]);
    setStages({
      Clone: 'pending',
      Build: 'pending',
      Run: 'pending',
      Expose: 'pending',
    });
    setBuildComplete(false);
    setBuildError(null);
    setElapsedMs(0);
    lineCounter = 0;

    // Start elapsed timer
    startTime = Date.now();
    elapsedTimer = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    // Start streaming
    abortController = new AbortController();
    setStreaming(true);

    void (async () => {
      try {
        for await (const event of client.streamBuildProgress(projectId, abortController.signal)) {
          processEvent(event);
        }
      } catch {
        // Stream ended or aborted — normal
      } finally {
        setStreaming(false);
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
    })();
  });

  // Cleanup on unmount
  onCleanup(() => {
    abortController?.abort();
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  });

  const formatElapsed = () => {
    const ms = elapsedMs();
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    if (mins > 0) return `${String(mins)}m ${String(remainSecs)}s`;
    return `${String(remainSecs)}s`;
  };

  // Pipeline height: 1 line for header, 1 for pipeline, 1 for separator = 3
  const pipelineHeight = 3;
  const logHeight = () => Math.max(3, props.height - pipelineHeight);

  return (
    <box flexDirection="column" height={props.height} paddingLeft={2} paddingRight={1}>
      {/* Pipeline header */}
      <box flexDirection="row" gap={1}>
        <text bold={true} fg={theme.warning}>
          ▸ Build
        </text>
        <Show when={buildSessionCount() > 1}>
          <text fg={theme.textMuted}>
            {` ${String(selectedBuildIndex() + 1)}/${String(buildSessionCount())} ←→`}
          </text>
        </Show>
        <Show when={streaming() && !buildComplete()}>
          <Spinner color={theme.warning} />
        </Show>
        <box flexGrow={1} />
        <text fg={theme.textDim}>{formatElapsed()}</text>
      </box>

      {/* Pipeline visualization: Clone ✅ → Build ◐ → Run ○ → Expose ○ */}
      <box flexDirection="row" paddingLeft={1}>
        {PIPELINE_STAGES.map((stage, idx) => (
          <>
            <text fg={stageColor(stages()[stage])}>
              {stageIcon(stages()[stage])} {stage}
            </text>
            {idx < PIPELINE_STAGES.length - 1 && <text fg={theme.textDim}> → </text>}
          </>
        ))}
      </box>

      {/* Build logs */}
      <ScrollableLog
        lines={logLines()}
        height={logHeight()}
        focus={props.focus ?? false}
        statusText={
          buildComplete()
            ? `✓ Complete in ${formatElapsed()}`
            : buildError()
              ? `✗ Failed at ${formatElapsed()}`
              : undefined
        }
      />
    </box>
  );
}
