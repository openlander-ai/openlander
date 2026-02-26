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

  // Terminal dimensions (safe — returns default 80x24 if renderer not ready)
  let dims: ReturnType<typeof useTerminalDimensions>;
  try {
    dims = useTerminalDimensions();
  } catch {
    // Renderer not ready yet during initial Solid reactivity pass.
    // Return a dummy accessor; the real one will be used on re-render.
    dims = (() => ({ width: 80, height: 24 })) as ReturnType<typeof useTerminalDimensions>;
  }
  const columns = () => dims().width;
  const rows = () => dims().height;
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
    onCleanup(() => {
      clearTimeout(timer);
    });
  });

  // Global keyboard shortcuts (safe — no-op if renderer not ready)
  try {
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
  } catch {
    /* Renderer not ready during initial reactivity pass */
  }

  // Reactive render — must wrap in arrow function for Solid.js reactivity
  const renderContent = (): JSX.Element => {
    // Setup mode — onboarding wizard
    if (mode() === 'setup') {
      return <Onboarding ctx={props.ctx} onComplete={handleSetupComplete} />;
    }

    // Dashboard mode — split-panel layout
    const panelMode = isWideMode() ? 'split' : 'single';
    const contentHeight = rows() - 1; // reserve 1 row for status bar
    const connectedClient = status() === 'connected' ? client : null;

    return (
      <>
        <Layout
          left={
            <ChatPanel
              client={connectedClient}
              height={contentHeight}
              focus={activePanel() === 'left'}
              onModal={(_modal: string) => {
                setShowHelp(true);
              }}
            />
          }
          right={
            <DashboardPanel
              client={connectedClient}
              height={contentHeight}
              focus={activePanel() === 'right'}
              onStatsUpdate={handleStatsUpdate}
            />
          }
          statusBar={
            <StatusBar
              panelMode={panelMode}
              activePanel={activePanel()}
              projectCount={projectCount()}
              cpuPercent={cpuPercent()}
              buildingCount={buildingCount()}
            />
          }
          overlay={
            showHelp() ? (
              <HelpOverlay
                onClose={() => {
                  setShowHelp(false);
                }}
              />
            ) : undefined
          }
          activePanel={activePanel()}
          columns={columns()}
          rows={rows()}
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
            <text backgroundColor="red" fg="white" bold={true}>
              {' '}
              Press Ctrl+C again to quit{' '}
            </text>
          </box>
        )}
      </>
    );
  };

  return <>{renderContent()}</>;
}
