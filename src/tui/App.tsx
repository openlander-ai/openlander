import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { join } from 'node:path';
import type { AppContext } from '../app.js';
import { isOnboarded, getDataDir, saveConfig } from '../config/index.js';
import type { LLMProviderConfig } from '../config/index.js';
import { useExit } from './context/exit.js';
import { useDaemon } from './hooks/useDaemon.js';
import { Onboarding } from './onboarding/index.js';
import { Layout } from './components/Layout.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { ModelOverlay } from './components/ModelOverlay.js';
import { ConnectOverlay } from './components/ConnectOverlay.js';
import { RepoOverlay } from './components/RepoOverlay.js';
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
  const [showModelSelector, setShowModelSelector] = createSignal(false);
  const [activePanel, setActivePanel] = createSignal<'left' | 'right'>('left');
  const [currentProvider, setCurrentProvider] = createSignal(props.ctx.config.llm.provider);
  const [currentModel, setCurrentModel] = createSignal(props.ctx.config.llm.model);

  // Connect/Repo overlay state
  const [showConnect, setShowConnect] = createSignal(false);
  const [showRepo, setShowRepo] = createSignal(false);
  const [repos, setRepos] = createSignal<
    Array<{
      name: string;
      fullName: string;
      description: string | null;
      isPrivate: boolean;
      provider: string;
    }>
  >([]);
  const [reposLoading, setReposLoading] = createSignal(false);
  const [reposError, setReposError] = createSignal<string | null>(null);
  // Handle model selection
  const handleModelSelect = (provider: string, model: string) => {
    // Update config
    props.ctx.config.llm.provider = provider as LLMProviderConfig['provider'];
    props.ctx.config.llm.model = model;
    // Save config to disk
    saveConfig(props.ctx.config);
    // Update local state
    setCurrentProvider(provider as LLMProviderConfig['provider']);
    setCurrentModel(model);
    // Close overlay
    setShowModelSelector(false);
  };
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

  // Connected providers computation
  const connectedProviders = () => ({
    github: {
      connected: !!props.ctx.config.gitProviders.github.token,
      username: props.ctx.config.gitProviders.github.username,
    },
  });

  // Handle git provider connection
  const handleConnect = (provider: string, token: string) => {
    if (provider === 'github') {
      props.ctx.config.gitProviders.github.token = token;
    }
    saveConfig(props.ctx.config);
    setShowConnect(false);
  };

  // Load repositories from connected providers
  const handleShowRepo = async () => {
    setShowRepo(true);
    setReposLoading(true);
    setReposError(null);
    try {
      const githubConfig = props.ctx.config.gitProviders.github;
      if (!githubConfig.token) {
        setReposError('No Git provider connected. Use /connect first.');
        setReposLoading(false);
        return;
      }
      // Dynamic import to avoid loading at startup
      const { createGitProvider } = await import('../git-providers/index.js');
      const provider = createGitProvider('github', {
        token: githubConfig.token,
        username: githubConfig.username,
      });
      const result = await provider.listRepos({ perPage: 30, sort: 'pushed' });
      setRepos(
        result.repos.map((r) => ({
          name: r.name,
          fullName: r.fullName,
          description: r.description,
          isPrivate: r.isPrivate,
          provider: 'github',
        })),
      );
    } catch (err) {
      setReposError(err instanceof Error ? err.message : String(err));
    }
    setReposLoading(false);
  };

  // Handle repo selection
  const handleRepoSelect = (_repoFullName: string) => {
    setShowRepo(false);
    // TODO: Insert deploy command into chat or trigger deployment
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

      // Help/Model/Connect/Repo overlay shortcuts
      if (showHelp() || showModelSelector() || showConnect() || showRepo()) {
        if (evt.key === 'escape') {
          setShowHelp(false);
          setShowModelSelector(false);
          setShowConnect(false);
          setShowRepo(false);
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
              onModal={(modal: string) => {
                if (modal === 'help') setShowHelp(true);
                if (modal === 'model') setShowModelSelector(true);
                if (modal === 'connect') setShowConnect(true);
                if (modal === 'repo') void handleShowRepo();
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
            ) : showModelSelector() ? (
              <ModelOverlay
                currentProvider={currentProvider()}
                currentModel={currentModel()}
                onSelect={handleModelSelect}
                onClose={() => setShowModelSelector(false)}
              />
            ) : showConnect() ? (
              <ConnectOverlay
                currentProviders={connectedProviders()}
                onConnect={(p, t) => {
                  handleConnect(p, t);
                }}
                onClose={() => setShowConnect(false)}
              />
            ) : showRepo() ? (
              <RepoOverlay
                repos={repos()}
                loading={reposLoading()}
                error={reposError()}
                onSelect={handleRepoSelect}
                onClose={() => setShowRepo(false)}
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
