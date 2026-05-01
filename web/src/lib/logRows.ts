/**
 * logRows — pure derivation helpers extracted from LogViewer (PR7-F).
 *
 * Two responsibilities, both side-effect free:
 *
 *  1. `derivePhaseStatus` — walks the line buffer to compute the
 *     `Record<PhaseId, PhaseStatus>` the PhaseRail consumes. Handles
 *     pending → active → done transitions and back-fills "done" on
 *     successful builds for any phases earlier than the last emitted
 *     line.
 *
 *  2. `buildLogRows` — flattens phase-grouped lines into the flat
 *     virtual-row list the virtualizer renders. Inserts phase header
 *     rows when the phase changes and emits an "older slabs" notice
 *     row at the top when the buffer exceeds RENDER_CAP.
 *
 * Pulling these out of the LogViewer lets us:
 *   - keep LogViewer.tsx under ~440 lines (was 542)
 *   - unit-test the derivations without React renderers
 *   - reuse the row layout if a non-virtualized print view ever lands
 */
import type { LogEntry } from './logScripts';
import { PHASE_DEFS, type PhaseId, type PhaseStatus } from '@/components/Shell/PhaseRail';

export const ROW_LINE_HEIGHT = 22;
export const ROW_HEADER_HEIGHT = 38;
export const ROW_NOTICE_HEIGHT = 40;
export const RENDER_CAP = 10_000;

export type HeaderStatus = 'active' | 'success' | 'failed' | '';

export interface VirtualRow {
  /** Stable key — header rows use `h:<phase>:<seq>`, log rows use `l:<idx>` */
  key: string;
  kind: 'header' | 'line' | 'notice';
  height: number;
  // Header
  phase?: PhaseId;
  headerStatus?: HeaderStatus;
  // Line
  num?: number;
  entry?: LogEntry;
  progress?: number;
  // Notice (older-slabs banner pinned above first row)
  noticeText?: string;
  noticeTotal?: number;
}

/**
 * Walks `lines` left-to-right. The currently-emitting phase becomes
 * `active`; previous phases become `done`. On a failed build the last
 * touched phase becomes `failed`. On a successful build any phase
 * earlier than `lastPhase` that's still `pending` flips to `done`
 * (silent phases that the script skipped over).
 */
export function derivePhaseStatus(
  lines: LogEntry[],
  buildOutcome: 'success' | 'fail' | null,
): Record<PhaseId, PhaseStatus> {
  const st: Record<PhaseId, PhaseStatus> = {
    clone: 'pending',
    image_pull: 'pending',
    build: 'pending',
    container_create: 'pending',
    container_start: 'pending',
    healthcheck_wait: 'pending',
  };
  let lastPhase: PhaseId | null = null;
  for (const l of lines) {
    const p = l.phase as PhaseId;
    if (lastPhase && lastPhase !== p) st[lastPhase] = 'done';
    st[p] = 'active';
    lastPhase = p;
  }
  if (buildOutcome === 'fail' && lastPhase) {
    st[lastPhase] = 'failed';
  } else if (buildOutcome === 'success' && lastPhase) {
    st[lastPhase] = 'done';
    let seenLast = false;
    for (let i = PHASE_DEFS.length - 1; i >= 0; i--) {
      const id = PHASE_DEFS[i].id as PhaseId;
      if (id === lastPhase) seenLast = true;
      else if (seenLast && st[id] === 'pending') st[id] = 'done';
    }
  }
  return st;
}

export interface BuildLogRowsResult {
  rows: VirtualRow[];
  totalLines: number;
  capped: number;
}

/**
 * Flattens lines into the virtual-row sequence. The first row may be
 * the older-slabs notice; subsequent rows alternate between phase
 * headers (when the phase changes) and log lines. Header status is
 * derived from `phaseStatus` plus the special "failed" overlay on the
 * last emitted phase when the build outcome is fail.
 */
export function buildLogRows(
  lines: LogEntry[],
  progressByLineNum: Record<number, number>,
  phaseStatus: Record<PhaseId, PhaseStatus>,
  buildOutcome: 'success' | 'fail' | null,
): BuildLogRowsResult {
  const total = lines.length;
  const droppedCount = Math.max(0, total - RENDER_CAP);
  const slice = droppedCount > 0 ? lines.slice(droppedCount) : lines;
  const out: VirtualRow[] = [];
  if (droppedCount > 0) {
    out.push({
      key: 'older-slabs',
      kind: 'notice',
      height: ROW_NOTICE_HEIGHT,
      noticeText: `Showing the most recent ${RENDER_CAP.toLocaleString()} of ${total.toLocaleString()} lines.`,
      noticeTotal: total,
    });
  }
  let lastPhase: PhaseId | null = null;
  let headerSeq = 0;
  const lastEmittedPhase = lines[lines.length - 1]?.phase as PhaseId | undefined;
  slice.forEach((entry, i) => {
    const phase = entry.phase as PhaseId;
    if (phase !== lastPhase) {
      let headerStatus: HeaderStatus = '';
      const isLastEmittedPhase = phase === lastEmittedPhase;
      if (buildOutcome === 'fail' && isLastEmittedPhase) headerStatus = 'failed';
      else if (phaseStatus[phase] === 'done') headerStatus = 'success';
      else if (phaseStatus[phase] === 'active') headerStatus = 'active';
      out.push({
        key: `h:${phase}:${headerSeq++}`,
        kind: 'header',
        height: ROW_HEADER_HEIGHT,
        phase,
        headerStatus,
      });
      lastPhase = phase;
    }
    const num = droppedCount + i + 1;
    out.push({
      key: `l:${num}`,
      kind: 'line',
      height: ROW_LINE_HEIGHT,
      num,
      entry,
      progress: progressByLineNum[num],
    });
  });
  return { rows: out, totalLines: total, capped: droppedCount };
}
