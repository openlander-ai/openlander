/**
 * TUI mode state management.
 *
 * Three operational modes control the right panel content:
 * - monitoring: System + Projects + Activity + Alerts (default)
 * - deploying:  Compact monitoring + Build panel (auto-enter on build start)
 * - debugging:  Project info + Log viewer (enter via project selection)
 */
import { createSignal } from 'solid-js';

export type TuiMode = 'monitoring' | 'deploying' | 'debugging';

export interface DeployingState {
  projectId: string;
  projectName: string;
}

export interface DebuggingState {
  projectId: string;
  projectName: string;
}

// --- Signals ---
const [mode, setMode] = createSignal<TuiMode>('monitoring');
const [deployingState, setDeployingState] = createSignal<DeployingState | null>(null);
const [debuggingState, setDebuggingState] = createSignal<DebuggingState | null>(null);

// --- Transition Functions ---

/** Enter deploy mode — called when a build starts. */
export function enterDeployMode(projectId: string, projectName: string): void {
  setDeployingState({ projectId, projectName });
  setMode('deploying');
}

/** Enter debug mode — called when user selects a project in Status panel. */
export function enterDebugMode(projectId: string, projectName: string): void {
  setDebuggingState({ projectId, projectName });
  setMode('debugging');
}

/** Return to monitoring mode from any other mode. */
export function returnToMonitoring(): void {
  setMode('monitoring');
  setDeployingState(null);
  setDebuggingState(null);
}

// --- Auto-return timer for deploy mode ---
let deployReturnTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule auto-return to monitoring after deploy completes. */
export function scheduleDeployReturn(delaySec = 3): void {
  if (deployReturnTimer) clearTimeout(deployReturnTimer);
  deployReturnTimer = setTimeout(() => {
    if (mode() === 'deploying') returnToMonitoring();
    deployReturnTimer = null;
  }, delaySec * 1000);
}

/** Cancel a pending auto-return (e.g. if user interacts with build panel). */
export function cancelDeployReturn(): void {
  if (deployReturnTimer) {
    clearTimeout(deployReturnTimer);
    deployReturnTimer = null;
  }
}

export { mode, deployingState, debuggingState };
