import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { join } from 'node:path';
import type { AppContext } from '../app.js';
import { isOnboarded, getDataDir } from '../config/index.js';
import { useExit } from './context/exit.js';
import { useDaemon } from './hooks/useDaemon.js';
import { Onboarding } from './onboarding/index.js';
import { Layout } from './components/Layout.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { ChatPanel } from './components/ChatPanel.js';
import { DashboardPanel } from './components/DashboardPanel.js';

// Socket path for daemon connection
const SOCKET_PATH = join(getDataDir(), 'openlander.sock');

interface AppProps {
  ctx: AppContext;
}

export function App(props: AppProps): JSX.Element {
  // App mode: setup or dashboard
  const [mode, setMode] = createSignal<'setup' | 'dashboard'>(
    isOnboarded() ? 'dashboard' : 'setup',
  );

  // Panel state
  const [showHelp, setShowHelp] = createSignal(false);
  const [activePanel, setActivePanel] = createSignal<'left' | 'right'>('left');

  // Ctrl+C tracking for double-press quit
  const [ctrlCCount, setCtrlCCount] = createSignal(0);
  const [showCtrlCWarning, setShowCtrlCWarning] = createSignal(false);
  const { exit } = useExit();

  // Daemon connection
  const { client, status } = useDaemon(SOCKET_PATH);

  // Terminal dimensions
  const dimensions = useTerminalDimensions();
  const columns = () => (dimensions as any)()?.columns ?? 80;
  const rows = () => (dimensions as any)()?.rows ?? 24;
  const isWideMode = () => columns() >= 100;

  // Stats for status bar (received from DashboardPanel via callback)
  const [projectCount, setProjectCount] = createSignal(0);
  const [cpuPercent, setCpuPercent] = createSignal<number | null>(null);
  const [buildingCount, setBuildingCount] = createSignal(0);

  // Setup completion handler
  const handleSetupComplete = () => {
    setMode('dashboard');
  };

  // Receive stats from DashboardPanel (no duplicate polling)
  const handleStatsUpdate = (data: {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
  }) => {
    setProjectCount(data.projectCount);
    setCpuPercent(data.cpuPercent);
    setBuildingCount(data.buildingCount);
  };

  // Reset Ctrl+C count after 2 seconds
  createEffect(() => {
    if (ctrlCCount() === 0) {
      setShowCtrlCWarning(false);
      return;
    }
    setShowCtrlCWarning(true);
    const timer = setTimeout(() => {
      setCtrlCCount(0);
      setShowCtrlCWarning(false);
    }, 2000);
    onCleanup(() => clearTimeout(timer));
  });

  // Global keyboard shortcuts
  useKeyboard((evt) => {
    // Don't handle shortcuts during setup
    if (mode() === 'setup') return;

    // Help overlay shortcuts
    if (showHelp()) {
      if (evt.key === 'escape') {
        setShowHelp(false);
      }
      return;
    }

    // Ctrl+C: first press shows warning, second press quits
    if (evt.ctrl && evt.char === 'c') {
      if (ctrlCCount() >= 1) {
        exit();
      } else {
        setCtrlCCount((prev) => prev + 1);
      }
      return;
    }

    // Tab: panel switch
    if (evt.key === 'tab') {
      setActivePanel((prev) => (prev === 'left' ? 'right' : 'left'));
      return;
    }

    // ? for help
    if (evt.char === '?') {
      setShowHelp(true);
      return;
    }

    // q to quit (only when dashboard panel is focused, not during chat input)
    if (evt.char === 'q' && activePanel() === 'right') {
      exit();
      return;
    }
  });

  // Setup mode — onboarding wizard
  if (mode() === 'setup') {
    return <Onboarding ctx={props.ctx} onComplete={handleSetupComplete} />;
  }

  // Dashboard mode — split-panel layout
  const panelMode = () => (isWideMode() ? 'split' : 'single');
  const contentHeight = () => rows() - 1; // reserve 1 row for status bar

  // Left panel: Chat
  const chatPanel = (
    <ChatPanel
      client={status() === 'connected' ? client() : null}
      height={contentHeight()}
      focus={activePanel() === 'left'}
      onModal={(_modal: string) => {
        setShowHelp(true);
      }}
    />
  );

  // Right panel: Dashboard
  const dashboardPanel = (
    <DashboardPanel
      client={status() === 'connected' ? client() : null}
      height={contentHeight()}
      focus={activePanel() === 'right'}
      onStatsUpdate={handleStatsUpdate}
    />
  );

  // Status bar
  const statusBar = (
    <StatusBar
      panelMode={panelMode()}
      activePanel={activePanel()}
      projectCount={projectCount()}
      cpuPercent={cpuPercent()}
      buildingCount={buildingCount()}
    />
  );

  // Help overlay
  const overlay = showHelp() ? (
    <HelpOverlay
      onClose={() => {
        setShowHelp(false);
      }}
    />
  ) : undefined;

  return (
    <>
      <Layout
        left={chatPanel}
        right={dashboardPanel}
        statusBar={statusBar}
        overlay={overlay}
        activePanel={activePanel()}
      />
      {showCtrlCWarning() && (
        <box
          position="absolute"
          width={columns()}
          height={rows()}
          flexDirection="column"
          justifyContent="flex-end"
          alignItems="center"
          paddingBottom={2}
        >
          <text backgroundColor="red" color="white" bold={true}>
            {' '}
            Press Ctrl+C again to quit{' '}
          </text>
        </box>
      )}
    </>
  );
}
