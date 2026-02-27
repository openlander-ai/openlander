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

// --- Multi-build session tracking (T-DEPLOY-05) ---
const [buildSessions, setBuildSessions] = createSignal<DeployingState[]>([]);
const [selectedBuildIndex, setSelectedBuildIndex] = createSignal(0);

/** The currently active/viewed build session. */
export const activeBuildSession = () => {
  const sessions = buildSessions();
  const idx = selectedBuildIndex();
  return sessions[idx] ?? null;
};

/** Total number of concurrent build sessions. */
export const buildSessionCount = () => buildSessions().length;

// --- Transition Functions ---

/** Enter deploy mode — called when a build starts. Adds to build session list. */
export function enterDeployMode(projectId: string, projectName: string): void {
  const session: DeployingState = { projectId, projectName };
  setBuildSessions((prev) => {
    // Don't add duplicate sessions for same project
    const exists = prev.some((s) => s.projectId === projectId);
    if (exists) return prev;
    return [...prev, session];
  });
  // Select the newly added (or existing) session
  const sessions = buildSessions();
  const idx = sessions.findIndex((s) => s.projectId === projectId);
  if (idx >= 0) setSelectedBuildIndex(idx);
  // Set legacy single-project state for backward compat
  setDeployingState(session);
  setMode('deploying');
}

/** Switch to next build session (→ key). */
export function nextBuildSession(): void {
  const count = buildSessions().length;
  if (count <= 1) return;
  setSelectedBuildIndex((prev) => (prev + 1) % count);
  const active = activeBuildSession();
  if (active) setDeployingState(active);
}

/** Switch to previous build session (← key). */
export function prevBuildSession(): void {
  const count = buildSessions().length;
  if (count <= 1) return;
  setSelectedBuildIndex((prev) => (prev - 1 + count) % count);
  const active = activeBuildSession();
  if (active) setDeployingState(active);
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
  // Clear build sessions when leaving deploy mode
  setBuildSessions([]);
  setSelectedBuildIndex(0);
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

export { mode, deployingState, debuggingState, buildSessions, selectedBuildIndex };
