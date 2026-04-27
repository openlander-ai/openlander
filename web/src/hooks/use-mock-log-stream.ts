/**
 * Mock log stream hook — Round 4 PR6 extraction.
 *
 * Lifted out of the LogViewer's previous in-component setTimeout
 * simulator. Same delays, same progress animation, same outcome
 * handoff. The split exists so LogViewer can swap between this hook
 * and `useDeployLogStream` without growing a giant branch in its own
 * effect.
 *
 * `enabled=false` short-circuits — the effect early-returns and the
 * returned state stays at its initial values. LogViewer mounts both
 * stream hooks in parallel and picks whichever one matches `mockMode +
 * deploymentId`, so the dormant hook MUST do nothing.
 *
 * `kill()` (per Codex CCG review): the previous version only flipped
 * `connState` to CANCELLED while timers kept firing — lines kept
 * arriving after kill. This version owns an `activeRef` that the
 * scheduler checks before invoking `next()` and clears all pending
 * timeouts/intervals so the simulation actually stops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../lib/logScripts';
import type { ConnState } from '../components/Shell/LogViewerHeader';

export interface UseMockLogStreamParams {
  enabled: boolean;
  baseScript: LogEntry[];
  outcome: 'success' | 'fail';
  instant: boolean;
}

export interface UseMockLogStreamResult {
  lines: LogEntry[];
  progressByLineNum: Record<number, number>;
  connState: ConnState;
  buildOutcome: 'success' | 'fail' | null;
  errorClass: string | undefined;
  getElapsedSec: () => number;
  kill: () => void;
}

interface ActiveSimRefs {
  active: boolean;
  timeouts: Set<ReturnType<typeof setTimeout>>;
  progressTimer: ReturnType<typeof setInterval> | null;
}

export function useMockLogStream({
  enabled,
  baseScript,
  outcome,
  instant,
}: UseMockLogStreamParams): UseMockLogStreamResult {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [progressByLineNum, setProgressByLineNum] = useState<Record<number, number>>({});
  const [connState, setConnState] = useState<ConnState>('CONNECTING');
  const [buildOutcome, setBuildOutcome] = useState<'success' | 'fail' | null>(null);

  const idxRef = useRef(0);
  const elapsedRef = useRef(0);
  const simRef = useRef<ActiveSimRefs | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Disabled — leave any prior state as-is. LogViewer reads the
      // OTHER stream when this one is dormant, so stale state is
      // invisible. Resetting here would be a setState-in-effect
      // anti-pattern with no payoff.
      idxRef.current = 0;
      elapsedRef.current = 0;
      simRef.current = null;
      return undefined;
    }

    // Reset on baseScript/outcome change — same escape hatch as the SSE
    // hook. The set-state-in-effect rule wants resets paired with
    // external sync; here the external sync is the setTimeout simulator
    // started below.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLines([]);
    setProgressByLineNum({});
    setConnState('CONNECTING');
    setBuildOutcome(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    idxRef.current = 0;
    elapsedRef.current = 0;

    if (instant) {
      setLines(baseScript.slice());
      const tp: Record<number, number> = {};
      baseScript.forEach((e, i) => {
        if (e.payload === '{progress}') tp[i + 1] = 1;
      });
      setProgressByLineNum(tp);
      idxRef.current = baseScript.length;
      setConnState('ENDED');
      setBuildOutcome(outcome);
      return undefined;
    }

    const sim: ActiveSimRefs = {
      active: true,
      timeouts: new Set(),
      progressTimer: null,
    };
    simRef.current = sim;

    let firstLineSeen = false;

    const stop = () => {
      sim.active = false;
      for (const t of sim.timeouts) clearTimeout(t);
      sim.timeouts.clear();
      if (sim.progressTimer) {
        clearInterval(sim.progressTimer);
        sim.progressTimer = null;
      }
    };

    const schedule = (fn: () => void, delay: number) => {
      const t = setTimeout(() => {
        sim.timeouts.delete(t);
        if (sim.active) fn();
      }, delay);
      sim.timeouts.add(t);
      return t;
    };

    const next = () => {
      if (!sim.active) return;
      const i = idxRef.current;
      if (i >= baseScript.length) {
        stop();
        setConnState('ENDED');
        setBuildOutcome(outcome);
        return;
      }
      const entry = baseScript[i];
      idxRef.current = i + 1;
      if (!firstLineSeen) {
        firstLineSeen = true;
        setConnState('LIVE');
      }
      if (entry.payload === '{progress}') {
        setLines((prev) => [...prev, entry]);
        const lineNum = idxRef.current;
        let p = 0;
        sim.progressTimer = setInterval(() => {
          if (!sim.active) return;
          p += 0.12 + Math.random() * 0.06;
          if (p >= 1) {
            p = 1;
            if (sim.progressTimer) {
              clearInterval(sim.progressTimer);
              sim.progressTimer = null;
            }
            schedule(next, 120);
          }
          setProgressByLineNum((tp) => ({ ...tp, [lineNum]: p }));
        }, 180);
        elapsedRef.current += 1.4;
        return;
      }
      setLines((prev) => [...prev, entry]);
      const fastMode = baseScript.length > 200;
      const baseDelay = fastMode
        ? entry.prefix === 'error'
          ? 60
          : 8 + Math.random() * 12
        : entry.phase === 'build' && entry.payload.startsWith('{step}')
          ? 240
          : entry.phase === 'healthcheck_wait'
            ? 600
            : entry.prefix === 'error'
              ? 80
              : 140 + Math.random() * 120;
      elapsedRef.current += baseDelay / 1000;
      schedule(next, baseDelay);
    };

    schedule(next, 350);

    return () => {
      stop();
      simRef.current = null;
    };
  }, [enabled, baseScript, instant, outcome]);

  const getElapsedSec = useCallback(() => elapsedRef.current, []);

  const kill = useCallback(() => {
    const sim = simRef.current;
    if (sim) {
      sim.active = false;
      for (const t of sim.timeouts) clearTimeout(t);
      sim.timeouts.clear();
      if (sim.progressTimer) {
        clearInterval(sim.progressTimer);
        sim.progressTimer = null;
      }
    }
    setConnState('CANCELLED');
  }, []);

  return {
    lines,
    progressByLineNum,
    connState,
    buildOutcome,
    errorClass: undefined,
    getElapsedSec,
    kill,
  };
}
