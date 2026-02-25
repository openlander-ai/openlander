import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useStdout, useApp } from 'ink';
import { join } from 'node:path';
import type { AppContext } from '../app.js';
import { isOnboarded, getDataDir } from '../config/index.js';
import { useDaemon } from './hooks/useDaemon.js';
import { Onboarding } from './onboarding/index.js';
import { Layout } from './components/Layout.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { ChatPanel } from './components/ChatPanel.js';
import { DashboardPanel } from './components/DashboardPanel.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('tui');

// Socket path for daemon connection
const SOCKET_PATH = join(getDataDir(), 'openlander.sock');

interface AppProps {
  ctx: AppContext;
}

export function App({ ctx }: AppProps): React.ReactElement {
  // App mode: setup or dashboard
  const [mode, setMode] = useState<'setup' | 'dashboard'>(() =>
    isOnboarded() ? 'dashboard' : 'setup',
  );

  // Panel state
  const [showHelp, setShowHelp] = useState(false);
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');

  // Ctrl+C tracking for double-press quit
  const [ctrlCCount, setCtrlCCount] = useState(0);
  const [showCtrlCWarning, setShowCtrlCWarning] = useState(false);
  const { exit } = useApp();

  // Daemon connection
  const { client, status } = useDaemon(SOCKET_PATH);

  // Terminal dimensions
  const { stdout } = useStdout();
  const columns = stdout.columns;
  const rows = stdout.rows;
  const isWideMode = columns >= 100;

  // Stats for status bar (polled from daemon)
  const [projectCount, setProjectCount] = useState(0);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [buildingCount, setBuildingCount] = useState(0);

  // Setup completion handler
  const handleSetupComplete = useCallback(() => {
    setMode('dashboard');
  }, []);

  // Poll stats from daemon for status bar
  useEffect(() => {
    if (status !== 'connected' || mode !== 'dashboard') return;

    const poll = async () => {
      try {
        const [projectsRes, stats] = await Promise.all([
          client.listProjects(),
          client.getSystemStats(),
        ]);
        setProjectCount(projectsRes.count);
        setCpuPercent(stats.cpu.usagePercent);
        const building = projectsRes.projects.filter((p) => p.status === 'building').length;
        setBuildingCount(building);
      } catch (err) {
        log.debug({ err }, 'Failed to poll stats from daemon');
        // daemon not connected or error — keep last values
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [client, status, mode]);

  // Reset Ctrl+C count after 2 seconds
  useEffect(() => {
    if (ctrlCCount === 0) {
      setShowCtrlCWarning(false);
      return;
    }
    setShowCtrlCWarning(true);
    const timer = setTimeout(() => {
      setCtrlCCount(0);
      setShowCtrlCWarning(false);
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [ctrlCCount]);

  // Global keyboard shortcuts
  useInput(
    (input, key) => {
      // Don't handle shortcuts during setup
      if (mode === 'setup') return;

      // Help overlay shortcuts
      if (showHelp) {
        if (key.escape) {
          setShowHelp(false);
        }
        return;
      }

      // Ctrl+C: first press shows warning, second press quits
      if (key.ctrl && input === 'c') {
        if (ctrlCCount >= 1) {
          exit();
        } else {
          setCtrlCCount((prev) => prev + 1);
        }
        return;
      }

      // Tab: panel switch
      if (key.tab) {
        setActivePanel((prev) => (prev === 'left' ? 'right' : 'left'));
        return;
      }

      // ? for help
      if (input === '?') {
        setShowHelp(true);
        return;
      }

      // q to quit (only when dashboard panel is focused, not during chat input)
      if (input === 'q' && activePanel === 'right') {
        exit();
        return;
      }
    },
    { isActive: mode === 'dashboard' },
  );

  // Setup mode — onboarding wizard
  if (mode === 'setup') {
    return <Onboarding ctx={ctx} onComplete={handleSetupComplete} />;
  }

  // Dashboard mode — split-panel layout
  const panelMode = isWideMode ? 'split' : 'single';
  const contentHeight = rows - 1; // reserve 1 row for status bar

  // Left panel: Chat
  const chatPanel = (
    <ChatPanel
      client={status === 'connected' ? client : null}
      height={contentHeight}
      focus={activePanel === 'left'}
      onModal={(_modal) => {
        setShowHelp(true);
      }}
    />
  );

  // Right panel: Dashboard
  const dashboardPanel = (
    <DashboardPanel
      client={status === 'connected' ? client : null}
      height={contentHeight}
      focus={activePanel === 'right'}
    />
  );

  // Status bar
  const statusBar = (
    <StatusBar
      panelMode={panelMode}
      activePanel={activePanel}
      projectCount={projectCount}
      cpuPercent={cpuPercent}
      buildingCount={buildingCount}
    />
  );

  // Help overlay
  const overlay = showHelp ? (
    <HelpOverlay
      onClose={() => {
        setShowHelp(false);
      }}
    />
  ) : (
    undefined
  );

  return (
    <>
      <Layout
        left={chatPanel}
        right={dashboardPanel}
        statusBar={statusBar}
        overlay={overlay}
        activePanel={activePanel}
      />
      {showCtrlCWarning && (
        <Box
          position="absolute"
          width={columns}
          height={rows}
          flexDirection="column"
          justifyContent="flex-end"
          alignItems="center"
          paddingBottom={2}
        >
          <Text backgroundColor="red" color="white" bold>
            {' '}
            Press Ctrl+C again to quit{' '}
          </Text>
        </Box>
      )}
    </>
  );
}
