/**
 * LogViewer — Round 4 PR3 (further split in PR7-F).
 *
 * Two-axis FSM:
 *
 *   connState: IDLE → CONNECTING → LIVE
 *              LIVE ⇄ RECONNECTING → BACKFILLING → LIVE
 *              LIVE → ENDED      (clean close — success OR fail)
 *              LIVE → CANCELLED  (user kill — terminal)
 *              any  → ERRORED    (transport failure)
 *
 *   viewState: FOLLOWING | PAUSED
 *
 * Build outcome (success/fail) is independent of connState — it's
 * derived from the final log lines / the `outcome` prop.
 *
 * Virtualization: @tanstack/react-virtual handles row windowing. Phase
 * headers and log lines share the same flat row list; the virtualizer
 * supports variable-size rows so headers (taller) don't break offsets.
 *
 * 10k line cap: when the buffer exceeds RENDER_CAP, we keep only the
 * last RENDER_CAP entries and render a one-line notice above the stream
 * pointing at the bulk-download CTA.
 *
 * Terminal cards (FailureSummary / SuccessSummary / CancelledSummary)
 * render as siblings of the scroll area inside <LogViewerSummaryCards>
 * so they can never be hidden below-fold no matter where the user
 * scrolled.
 *
 * PR7-F: derivation logic moved to `lib/logRows.ts`; terminal cards to
 * `LogViewerSummaryCards`; viewState reset uses the "compare-prev-key
 * during render" pattern instead of a setState-in-effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  Info,
  StopCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { cancelDeployment } from '@/lib/api';
import { LOG_SCRIPT_BASE, LOG_SCRIPT_FAIL, type LogEntry } from '@/lib/logScripts';
import { LogPayload } from '@/lib/logAnsi';
import { buildLogRows, derivePhaseStatus, RENDER_CAP, ROW_LINE_HEIGHT } from '@/lib/logRows';
import { PhaseRail, type PhaseId } from './PhaseRail';
import {
  HeaderPill,
  FsmBadge,
  HeaderActionButton,
  type ConnState as ConnStateType,
  type ViewState as ViewStateType,
} from './LogViewerHeader';
import { LogViewerSummaryCards } from './LogViewerSummaryCards';
import { useDeployLogStream } from '@/hooks/use-deploy-log-stream';
import { useMockLogStream } from '@/hooks/use-mock-log-stream';
import './LogViewer.css';

const OVERSCAN = 24;

// ConnState + ViewState are defined in ./LogViewerHeader and re-exported
// here so existing import paths keep working.
export type ConnState = ConnStateType;
export type ViewState = ViewStateType;

export type LogVariant = 'deploy' | 'runtime';

export interface LogViewerProps {
  variant?: LogVariant;
  /**
   * Real backend deployment id. When set AND `mockMode` is false, the
   * LogViewer subscribes to `/api/deployments/:id/log/stream` (SSE).
   * When null/undefined or `mockMode` is true, the mock simulator runs.
   */
  deploymentId?: string | number | null;
  /**
   * Force the in-component mock simulator regardless of `deploymentId`.
   * Used for tests, storybook, and the ServiceDetailV2 deploy overlay
   * when a persisted deployment id is not available yet.
   */
  mockMode?: boolean;
  /** Force a particular connState for demos (RECONNECTING, BACKFILLING, CANCELLED) */
  forceConnState?: ConnState | null;
  /** Drives which mock script runs (success or fail) */
  outcome?: 'success' | 'fail';
  /** Override the script (e.g. large synthetic log) */
  scriptOverride?: LogEntry[];
  /** When `outcome === 'fail'`, error class id displayed in FailureSummary */
  errorClass?: string;
  /** Service display name (used by SuccessSummary) */
  serviceName?: string;
  /** Public URL (used by SuccessSummary) */
  publicUrl?: string | null;
  /** Internal port (used by SuccessSummary) */
  internalPort?: number | null;
  /** Render every line synchronously (used by print pages) */
  instant?: boolean;
  /** Header back button click */
  onClose?: () => void;
  /** Title row text — e.g. "hotdeal-tracker / api · Deploy #7" */
  headerTitle?: React.ReactNode;
  /** Subtitle row — e.g. trigger chip + branch + commit message */
  headerSubtitle?: React.ReactNode;
  /**
   * Optional Download click handler. Production wires this to download
   * the persisted `deployment.buildLog` text (PR #259's "Download은
   * 기존 deployment detail buildLog 사용" guidance). When omitted the
   * Download button hides — storybook / mock mode has no real log to
   * export.
   */
  onDownload?: () => void;
  /**
   * Translated copy for the destructive-action `window.confirm` prompt
   * before firing the cancel POST. Defaults to English. Production
   * (DeploymentDetail) passes the i18n value (`t('deploy.killConfirm')`)
   * — Codex round-3 P3 flagged the hard-coded string as an i18n debt.
   */
  confirmKillMessage?: string;
}

export function LogViewer({
  variant = 'deploy',
  deploymentId = null,
  mockMode = false,
  forceConnState = null,
  outcome = 'success',
  scriptOverride,
  errorClass = 'BUILD_CONTEXT_MISMATCH',
  serviceName = 'web',
  publicUrl = null,
  internalPort = null,
  instant = false,
  onClose,
  headerTitle,
  headerSubtitle,
  onDownload,
  confirmKillMessage = 'Stop this deploy?',
}: LogViewerProps) {
  const isRuntime = variant === 'runtime';
  const baseScript = useMemo<LogEntry[]>(() => {
    if (scriptOverride) return scriptOverride;
    return outcome === 'fail' ? LOG_SCRIPT_FAIL : LOG_SCRIPT_BASE;
  }, [scriptOverride, outcome]);

  // ─── Stream source selection ───────────────────────────────────────────
  // Both stream hooks are mounted unconditionally to satisfy rules-of-
  // hooks; the dormant one short-circuits via its enabled/null param.
  // The active one supplies the rendered state.
  const useReal = !mockMode && deploymentId != null;
  const mockStream = useMockLogStream({
    enabled: !useReal,
    baseScript,
    outcome,
    instant,
  });
  const sseStream = useDeployLogStream(useReal ? deploymentId : null);
  const stream = useReal ? sseStream : mockStream;

  // ─── View state ────────────────────────────────────────────────────────
  const [viewState, setViewState] = useState<ViewState>('FOLLOWING');
  const followingRef = useRef(true);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    followingRef.current = viewState === 'FOLLOWING';
  }, [viewState]);

  // Reset view state when the underlying stream restarts (deploymentId
  // swap or mockMode toggle). PR7-G: replaced the `setState-in-effect`
  // pattern with React's "store-information-from-previous-renders"
  // recipe — comparing a ref to the new key during render and calling
  // the setter eagerly is documented as the lower-cost alternative
  // because it skips a wasted render.
  const streamKey = `${deploymentId ?? '_mock'}|${mockMode ? 'mock' : 'sse'}`;
  const lastStreamKeyRef = useRef(streamKey);
  if (lastStreamKeyRef.current !== streamKey) {
    lastStreamKeyRef.current = streamKey;
    setViewState('FOLLOWING');
  }

  const lines = stream.lines;
  const progressByLineNum = stream.progressByLineNum;
  const buildOutcome = stream.buildOutcome;

  // ─── Force connection state (demos) ────────────────────────────────────
  // forceConnState is a debug/demo affordance that overlays a particular
  // connState on top of whatever the stream is doing. The real stream
  // continues underneath; only the displayed state is forced.
  const [forcedDisplayConn, setForcedDisplayConn] = useState<ConnState | null>(null);
  useEffect(() => {
    if (!forceConnState) {
      setForcedDisplayConn(null);
      return undefined;
    }
    if (forceConnState === 'RECONNECTING') {
      setForcedDisplayConn('RECONNECTING');
      const t1 = setTimeout(() => setForcedDisplayConn('BACKFILLING'), 1800);
      const t2 = setTimeout(() => setForcedDisplayConn(null), 3200);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    setForcedDisplayConn(forceConnState);
    return undefined;
  }, [forceConnState]);

  const connState: ConnState = forcedDisplayConn ?? stream.connState;

  // CCG (Gemini) decision: SSE-derived errorClass overrides prop.
  // In mock mode the SSE stream is disabled and `stream.errorClass` is
  // undefined, so the prop fallback wins as before.
  const resolvedErrorClass = stream.errorClass ?? errorClass;

  // ─── Phase status (derived) ────────────────────────────────────────────
  const phaseStatus = useMemo(() => derivePhaseStatus(lines, buildOutcome), [lines, buildOutcome]);

  // ─── Virtual rows ──────────────────────────────────────────────────────
  const { rows, totalLines, capped } = useMemo(
    () => buildLogRows(lines, progressByLineNum, phaseStatus, buildOutcome),
    [lines, progressByLineNum, phaseStatus, buildOutcome],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => rows[index]?.height ?? ROW_LINE_HEIGHT,
    overscan: OVERSCAN,
  });

  // ─── Auto-follow (snap to bottom on new lines if FOLLOWING) ────────────
  useEffect(() => {
    if (viewState === 'FOLLOWING' && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows.length, viewState, virtualizer]);

  // ─── Detect manual scroll → switch to PAUSED / FOLLOWING ──────────────
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (!atBottom && followingRef.current) setViewState('PAUSED');
    if (atBottom && !followingRef.current) setViewState('FOLLOWING');
  }, []);

  // ─── Header pill ───────────────────────────────────────────────────────
  // Recompute on each new line (the elapsed clock advances per line in
  // mock mode and per Date.now() read in SSE mode). The freeze on
  // terminal events happens automatically inside getElapsedSec() via
  // the SSE hook's elapsedFrozenRef.
  const liveDur = useMemo(() => {
    if (lines.length === 0) return '0s';
    const s = stream.getElapsedSec();
    if (s < 60) return `${s.toFixed(0)}s`;
    return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  }, [lines.length, stream]);

  const showReconNotice = connState === 'RECONNECTING' || connState === 'BACKFILLING';

  // ─── Cancel handler ────────────────────────────────────────────────────
  // Two paths:
  //   - Real SSE stream backed by `useDeployLogStream`: POST
  //     `/api/deployments/:id/cancel` (PR #259 contract). The backend
  //     terminates the docker build, the active SSE emits the
  //     `{ type: 'end', outcome: 'cancelled' }` frame, and the local
  //     stream hook flips connState to ENDED via its terminal handler
  //     — no need to call `stream.kill()` ourselves.
  //   - Mock stream (no `deploymentId` or `mockMode=true`): drive the
  //     in-component cancel via `stream.kill()` so the mock simulator
  //     stops emitting and surfaces the CANCELLED card. This keeps the
  //     storybook / test path working without a backend.
  //
  // Real-path failures (e.g. 409 DEPLOYMENT_NOT_ACTIVE if the build is
  // already terminal) bubble up as a console warning + a state-local
  // error string so the operator sees something instead of a silent
  // no-op. Codex CCG round-1 should validate that the toast surface
  // is the right vehicle here.
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const onKill = useCallback(async () => {
    if (isCancelling) return;
    if (!useReal || deploymentId == null) {
      // Mock path — stream.kill() drives the simulator's CANCELLED branch.
      stream.kill();
      return;
    }
    // Destructive action — confirm with the operator before firing the
    // cancel POST. `window.confirm` is synchronous so it cannot interleave
    // with later state writes. Per Gemini round-2 P1: a one-click Kill
    // on a 10-minute build is the kind of foot-gun we need a guardrail
    // around even at v0.1.
    if (typeof window !== 'undefined' && !window.confirm(confirmKillMessage)) {
      return;
    }
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelDeployment(String(deploymentId));
      // Don't reset `isCancelling` on the success path — the backend
      // confirms the kill _later_ via the SSE `end` frame (connState →
      // CANCELLED), which is what the Kill-button visibility guard
      // already keys off (the connState !== LIVE / CONNECTING / ...
      // branch hides the button on terminal frames). Resetting here
      // would briefly re-enable the button between the POST 200 and
      // the SSE terminal — Codex round-2 P2 carryover.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel deployment';
      setCancelError(message);
      setIsCancelling(false);
      console.warn('[LogViewer] cancelDeployment failed:', message);
    }
  }, [confirmKillMessage, deploymentId, isCancelling, stream, useReal]);

  return (
    <div className="ol-log-pane relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[color:var(--log-header-border)] bg-[color:var(--log-header-bg)] px-4 py-2.5">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--log-header-muted)] transition-colors hover:bg-[color:var(--log-header-border)] hover:text-[color:var(--log-header-text)]"
            aria-label="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            {headerTitle ?? (
              <span className="font-medium text-[color:var(--log-header-text)]">
                {isRuntime ? 'Runtime container logs' : 'Deploy log'}
              </span>
            )}
            <HeaderPill connState={connState} buildOutcome={buildOutcome} liveDur={liveDur} />
            <FsmBadge connState={connState} viewState={viewState} />
          </div>
          {headerSubtitle && (
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-[color:var(--log-header-muted)]">
              {headerSubtitle}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <HeaderActionButton icon={<Copy className="h-3.5 w-3.5" />} title="Copy visible range">
            Copy
          </HeaderActionButton>
          {onDownload && (
            <HeaderActionButton
              icon={<Download className="h-3.5 w-3.5" />}
              title="Download full log"
              onClick={onDownload}
            >
              Download
            </HeaderActionButton>
          )}
          {(connState === 'LIVE' ||
            connState === 'RECONNECTING' ||
            connState === 'BACKFILLING' ||
            connState === 'CONNECTING') &&
            !isRuntime && (
              <button
                type="button"
                onClick={onKill}
                disabled={isCancelling}
                title={cancelError ?? undefined}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--log-error)] bg-[color-mix(in_oklch,var(--log-error)_20%,var(--log-header-bg))] px-2.5 py-1 text-[11.5px] font-medium text-[color:var(--log-error)] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <StopCircle className="h-3.5 w-3.5" />
                {isCancelling ? 'Cancelling…' : 'Kill build'}
              </button>
            )}
        </div>
      </div>

      {/* Phase rail (deploy variant only) */}
      {!isRuntime && <PhaseRail status={phaseStatus} />}

      {/* Reconnect notice */}
      {showReconNotice && (
        <div className="ol-recon-notice" role="status" aria-live="polite">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>
            {connState === 'RECONNECTING'
              ? 'Connection lost — reconnecting…'
              : 'Reconnected — backfilling missed lines. Earlier lines may not be captured.'}
          </span>
        </div>
      )}

      {/* Virtualized scroll area */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-label={isRuntime ? 'Runtime log stream' : 'Build log stream'}
        className="relative flex-1 overflow-auto py-2"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            return (
              <div
                key={row.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {row.kind === 'notice' && capped > 0 && (
                  <div className="ol-older-slabs">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Showing the most recent <b>{RENDER_CAP.toLocaleString()}</b> of{' '}
                      <b>{totalLines.toLocaleString()}</b> lines.{' '}
                      <button type="button" className="underline">
                        Download full log
                      </button>{' '}
                      for the complete record.
                    </span>
                  </div>
                )}
                {row.kind === 'header' && row.phase != null && (
                  <PhaseHeaderInline phase={row.phase} status={row.headerStatus ?? ''} />
                )}
                {row.kind === 'line' && row.entry && row.num != null && (
                  <LogLine entry={row.entry} num={row.num} progress={row.progress} />
                )}
              </div>
            );
          })}
        </div>

        {/* Jump-to-latest pill — only when paused with content available */}
        {viewState === 'PAUSED' && rows.length > 0 && (
          <button
            type="button"
            className="ol-jump-pill"
            onClick={() => {
              setViewState('FOLLOWING');
              virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
            }}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Jump to latest
          </button>
        )}
      </div>

      {/* Terminal cards — render OUTSIDE the scroll so they're always visible */}
      <LogViewerSummaryCards
        variant={variant}
        connState={connState}
        buildOutcome={buildOutcome}
        errorClass={resolvedErrorClass}
        serviceName={serviceName}
        publicUrl={publicUrl}
        internalPort={internalPort}
        duration={liveDur}
      />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

// HeaderPill / FsmBadge / HeaderActionButton / Dot were extracted to
// ./LogViewerHeader in PR4-C. They're imported above.

function PhaseHeaderInline({
  phase,
  status,
}: {
  phase: PhaseId;
  status: 'active' | 'success' | 'failed' | '';
}) {
  const labels: Record<PhaseId, string> = {
    clone: 'Cloning repository',
    image_pull: 'Pulling base images',
    build: 'Building images',
    container_create: 'Creating containers',
    container_start: 'Starting containers',
    healthcheck_wait: 'Waiting for health',
  };
  return <div className={cn('ol-phase-header', status)}>{labels[phase]}</div>;
}

interface LogLineProps {
  entry: LogEntry;
  num: number;
  progress?: number;
}

function LogLine({ entry, num, progress }: LogLineProps) {
  const isError = entry.prefix === 'error';
  return (
    <div className={cn('ol-log-line', isError && 'error')} style={{ minHeight: ROW_LINE_HEIGHT }}>
      <span className="ol-log-num">{num}</span>
      <span className={cn('ol-log-prefix', entry.prefix)} title={entry.prefix}>
        {entry.prefix}
      </span>
      <span className="ol-log-payload">
        <LogPayload entry={entry} progress={progress} />
      </span>
    </div>
  );
}
