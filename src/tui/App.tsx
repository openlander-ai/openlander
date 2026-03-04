import { createSignal, createEffect, Show, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  useKeyboard,
  useTerminalDimensions,
  useSelectionHandler,
  useRenderer,
} from '@opentui/solid';
import { theme } from './theme.js';
import { join } from 'node:path';
import type { AppContext } from '../app.js';
import { getDataDir, saveConfig } from '../config/index.js';
import type { LLMProviderConfig } from '../config/index.js';
import { useExit } from './context/exit.js';
import { useDaemon } from './hooks/useDaemon.js';

import { Layout } from './components/Layout.js';
import { StatusBar } from './components/StatusBar.js';
import { HelpOverlay } from './components/HelpOverlay.js';
import { ModelOverlay } from './components/ModelOverlay.js';
import { GitOverlay } from './components/GitOverlay.js';
import { TunnelOverlay } from './components/TunnelOverlay.js';
import { EnvOverlay } from './components/EnvOverlay.js';
import { RepoOverlay } from './components/RepoOverlay.js';
import { ChatPanel } from './components/ChatPanel.js';
import { StatusPanel } from './components/StatusPanel.js';
import type { DisplayMessage } from './components/ChatMessage.js';
import type { StartDeployResponse, BuildProgressEvent } from '../ipc/client.js';
import {
  mode as tuiMode,
  deployingState,
  debuggingState,
  enterDeployMode,
  enterDebugMode,
  returnToMonitoring,
  scheduleDeployReturn,
  nextBuildSession,
  prevBuildSession,
  buildSessionCount,
  buildStage,
} from './state/mode.js';
import { focus, toggleFocus, focusChat } from './state/focus.js';
import { setOverlayActive } from './state/overlay.js';

// Socket path for daemon connection
const SOCKET_PATH = join(getDataDir(), 'openlander.sock');

/** Map build progress event type to terminal-native symbol. */
function getBuildEventSymbol(event: BuildProgressEvent): string {
  switch (event.type) {
    case 'status':
      return '▸';
    case 'log':
      return '▸';
    case 'error':
      return '✗';
    case 'complete':
      return '✓';
    default:
      return '▸';
  }
}
interface AppProps {
  ctx: AppContext;
}

export function App(props: AppProps): JSX.Element {
  // Panel state — focus is managed by state/focus.ts (chat | status)
  const [showHelp, setShowHelp] = createSignal(false);
  const [showModelSelector, setShowModelSelector] = createSignal(false);
  const [currentProvider, setCurrentProvider] = createSignal(props.ctx.config.llm.provider);
  const [currentModel, setCurrentModel] = createSignal(props.ctx.config.llm.model);

  // Overlay state: git (was connect), repo, tunnel, env
  const [showGit, setShowGit] = createSignal(false);
  const [showRepo, setShowRepo] = createSignal(false);
  const [showTunnel, setShowTunnel] = createSignal(false);
  const [showEnv, setShowEnv] = createSignal(false);

  // Clipboard copy toast notification
  const [showCopyToast, setShowCopyToast] = createSignal(false);
  let copyToastTimer: ReturnType<typeof setTimeout> | null = null;
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

  // Deploy progress messages injected into ChatPanel
  const [deployMessages, setDeployMessages] = createSignal<DisplayMessage[]>([], { equals: false });
  const [showBuildClosedOnDeployExit, setShowBuildClosedOnDeployExit] = createSignal(false);
  let deployAbortController: AbortController | null = null;

  const addBuildPanelClosedMessage = () => {
    setDeployMessages((prev) => {
      prev.push({
        id: `build-closed-${String(Date.now())}`,
        role: 'system' as const,
        content: '\u{1F4CB} Build panel closed',
        type: 'text' as const,
        timestamp: Date.now(),
      });
      return prev;
    });
  };

  // Abort deploy stream on unmount
  onCleanup(() => {
    deployAbortController?.abort();
  });
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
  const isWideMode = () => columns() >= 80;

  // Stats for status bar (received from DashboardPanel via callback)
  const [projectCount, setProjectCount] = createSignal(0);
  const [cpuPercent, setCpuPercent] = createSignal<number | null>(null);
  const [buildingCount, setBuildingCount] = createSignal(0);
  const [memDisplay, setMemDisplay] = createSignal('—');

  // Receive stats from DashboardPanel (no duplicate polling)
  const handleStatsUpdate = (data: {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
    memoryUsedMB: number | null;
  }) => {
    setProjectCount(data.projectCount);
    setCpuPercent(data.cpuPercent);
    setBuildingCount(data.buildingCount);
    // Format memory: >= 1024 → "X.YG", < 1024 → "XM"
    if (data.memoryUsedMB !== null) {
      setMemDisplay(
        data.memoryUsedMB >= 1024
          ? `${(data.memoryUsedMB / 1024).toFixed(1)}G`
          : `${String(Math.round(data.memoryUsedMB))}M`,
      );
    } else {
      setMemDisplay('—');
    }
  };

  // Handle project selection from StatusPanel — enter debug mode
  const handleProjectSelect = (
    projectId: string,
    projectName: string,
    port: number | null = null,
  ) => {
    enterDebugMode(projectId, projectName, port);
  };

  // Compute build progress from build stage
  const buildProgress = (): number | null => {
    const stage = buildStage();
    switch (stage) {
      case 'clone':
        return 25;
      case 'build':
        return 50;
      case 'run':
        return 75;
      case 'expose':
      case 'complete':
        return 100;
      default:
        return null;
    }
  };

  // Connected providers computation
  // Connected providers computation
  const connectedProviders = () => {
    const gh = props.ctx.config.gitProviders.github;
    const gl = props.ctx.config.gitProviders.gitlab;
    return {
      github: {
        connected: !!gh.token,
        username: gh.username,
        authMethod: gh.authMethod,
      },
      gitlab: {
        connected: !!gl.token,
        username: gl.username,
        authMethod: gl.authMethod,
      },
    };
  };

  // Handle git provider connection with token validation
  const handleConnect = async (
    provider: string,
    token: string,
    authMethod?: 'oauth' | 'pat',
  ): Promise<{ valid: boolean; username?: string; error?: string }> => {
    try {
      const { createGitProvider } = await import('../git-providers/index.js');
      const providerType = provider as 'github' | 'gitlab';
      const gitProvider = createGitProvider(providerType, { token, username: '' });
      const validation = await gitProvider.validateToken();
      if (validation.valid) {
        const entry = props.ctx.config.gitProviders[providerType];
        entry.token = token;
        entry.username = validation.user?.username ?? '';
        if (authMethod) entry.authMethod = authMethod;
        saveConfig(props.ctx.config);
        return { valid: true, username: validation.user?.username };
      }
      return { valid: false, error: validation.error ?? 'Token validation failed' };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const handleDisconnect = (provider: string) => {
    const providerType = provider as 'github' | 'gitlab';
    const entry = props.ctx.config.gitProviders[providerType];
    entry.token = '';
    entry.username = '';
    entry.authMethod = undefined;
    saveConfig(props.ctx.config);
  };

  // Load repositories from connected providers
  const handleShowRepo = async () => {
    setShowRepo(true);
    setReposLoading(true);
    setReposError(null);
    try {
      const githubConfig = props.ctx.config.gitProviders.github;
      if (!githubConfig.token) {
        setReposError('No Git provider connected. Use /git first.');
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

  // Handle repo selection — trigger deployment directly (no LLM)
  const handleRepoSelect = (repoFullName: string) => {
    setShowRepo(false);
    const c = status() === 'connected' ? client : null;
    if (!c) {
      setDeployMessages((prev) => {
        prev.push({
          id: `deploy-err-${String(Date.now())}`,
          role: 'system' as const,
          content: '\u2717 Cannot deploy \u2014 daemon not connected.',
          type: 'error' as const,
          timestamp: Date.now(),
        });
        return prev;
      });
      return;
    }

    // Construct repo URL from fullName (e.g. "user/repo" → "https://github.com/user/repo")
    const repoUrl = `https://github.com/${repoFullName}`;

    // Add initial deploy message
    setDeployMessages((prev) => {
      prev.push({
        id: `deploy-start-${String(Date.now())}`,
        role: 'system' as const,
        content: `\u27F3 Deploying ${repoFullName}...`,
        type: 'text' as const,
        timestamp: Date.now(),
      });
      return prev;
    });

    // Start non-blocking deploy and enter deploy mode immediately
    void (async () => {
      let startResult: StartDeployResponse;
      try {
        startResult = await c.startDeploy(repoUrl);
      } catch (err) {
        console.error('[deploy]', err instanceof Error ? err.message : String(err));
        setDeployMessages((prev) => {
          prev.push({
            id: `deploy-err-${String(Date.now())}`,
            role: 'system' as const,
            content: `\u2717 Deploy failed: ${err instanceof Error ? err.message : String(err)}`,
            type: 'error' as const,
            timestamp: Date.now(),
          });
          return prev;
        });
        return;
      }

      // Enter deploy mode IMMEDIATELY — right panel shows BuildPanel with streaming progress
      const projectName =
        startResult.projectName || (repoFullName.split('/').pop() ?? repoFullName);
      enterDeployMode(startResult.projectId, projectName);

      // System message in chat
      setDeployMessages((prev) => {
        prev.push({
          id: `deploy-mode-${String(Date.now())}`,
          role: 'system' as const,
          content: '[\u{1F4CB} Build panel opened]',
          type: 'text' as const,
          timestamp: Date.now(),
        });
        return prev;
      });

      // Stream build progress into chat messages (BuildPanel has its own stream)
      deployAbortController = new AbortController();
      try {
        for await (const event of c.streamBuildProgress(
          startResult.projectId,
          deployAbortController.signal,
        )) {
          const symbol = getBuildEventSymbol(event);
          setDeployMessages((prev) => {
            prev.push({
              id: `deploy-progress-${String(Date.now())}-${String(Math.random())}`,
              role: 'system' as const,
              content: `${symbol} ${event.message}`,
              type: event.type === 'error' ? ('error' as const) : ('text' as const),
              timestamp: Date.now(),
            });
            return prev;
          });

          if (event.type === 'complete') {
            setDeployMessages((prev) => {
              prev.push({
                id: `deploy-done-${String(Date.now())}`,
                role: 'system' as const,
                content: `\u2713 ${event.message}`,
                type: 'text' as const,
                timestamp: Date.now(),
              });
              return prev;
            });
            setShowBuildClosedOnDeployExit(true);
            // Auto-return to monitoring after 3 seconds
            scheduleDeployReturn(3);
          }
        }
      } catch {
        // Stream ended or aborted — normal when deploy completes quickly
      } finally {
        deployAbortController = null;
      }
    })();
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

  let previousMode = tuiMode();
  createEffect(() => {
    const currentMode = tuiMode();
    if (
      previousMode === 'deploying' &&
      currentMode === 'monitoring' &&
      showBuildClosedOnDeployExit()
    ) {
      addBuildPanelClosedMessage();
      setShowBuildClosedOnDeployExit(false);
    }
    previousMode = currentMode;
  });

  // Global keyboard shortcuts (safe — no-op if renderer not ready)
  try {
    useKeyboard((evt) => {
      // When overlays are open, only handle Escape at App level.
      // All other keys must pass through to overlay's own useKeyboard handler.
      if (
        showHelp() ||
        showModelSelector() ||
        showGit() ||
        showRepo() ||
        showTunnel() ||
        showEnv()
      ) {
        // Only Escape is handled here — overlay components handle everything else
        return;
      }

      // Ctrl+C: cancel active work first, then double-tap to quit
      if (evt.ctrl && evt.name === 'c') {
        // If there's an active deploy stream, abort it first
        if (deployAbortController) {
          deployAbortController.abort();
          deployAbortController = null;
          setShowBuildClosedOnDeployExit(false);
          returnToMonitoring();
          setDeployMessages((prev) => {
            prev.push({
              id: `deploy-cancel-${String(Date.now())}`,
              role: 'system' as const,
              content: '\u26A0 Deploy cancelled by user.',
              type: 'text' as const,
              timestamp: Date.now(),
            });
            return prev;
          });
          return;
        }
        // No active work — double-tap to quit
        if (ctrlCCount() >= 1) {
          exit();
        } else {
          setCtrlCCount((prev) => prev + 1);
        }
        return;
      }

      // Esc: mode-specific behavior
      if (evt.name === 'escape') {
        if (tuiMode() === 'deploying') {
          addBuildPanelClosedMessage();
          setShowBuildClosedOnDeployExit(false);
          returnToMonitoring();
          focusChat();
        } else if (tuiMode() === 'debugging') {
          returnToMonitoring();
          focusChat();
        }
        return;
      }

      if (tuiMode() === 'deploying' && evt.name === 'return' && focus() !== 'chat') {
        addBuildPanelClosedMessage();
        setShowBuildClosedOnDeployExit(false);
        returnToMonitoring();
        focusChat();
        return;
      }

      // Deploy mode: ←→ to switch between concurrent builds (T-DEPLOY-05)
      if (tuiMode() === 'deploying' && buildSessionCount() > 1) {
        if (evt.name === 'left' || evt.name === 'h') {
          prevBuildSession();
          return;
        }
        if (evt.name === 'right' || evt.name === 'l') {
          nextBuildSession();
          return;
        }
      }

      // Tab: panel focus switch
      if (evt.name === 'tab') {
        toggleFocus();
        return;
      }

      // ? for help (only when NOT in chat input)
      if (evt.name === '?' && focus() !== 'chat') {
        setShowHelp(true);
        return;
      }

      // q to quit (only when status panel is focused, not during chat input)
      if (evt.name === 'q' && focus() === 'status') {
        exit();
        return;
      }

      // Debugging mode shortcuts (r=redeploy, s=stop, d=domain/tunnel)
      if (tuiMode() === 'debugging' && focus() === 'status') {
        const dbgState = debuggingState();
        const c = status() === 'connected' ? client : null;
        if (dbgState && c) {
          if (evt.name === 'r') {
            // Redeploy the current debugging project
            void (async () => {
              try {
                await c.redeployProject(dbgState.projectId);
                setDeployMessages((prev) => {
                  prev.push({
                    id: `redeploy-${String(Date.now())}`,
                    role: 'system' as const,
                    content: `\u27F3 Redeploying ${dbgState.projectName}...`,
                    type: 'text' as const,
                    timestamp: Date.now(),
                  });
                  return prev;
                });
                // Enter deploy mode for this project
                enterDeployMode(dbgState.projectId, dbgState.projectName);
              } catch (err) {
                setDeployMessages((prev) => {
                  prev.push({
                    id: `redeploy-err-${String(Date.now())}`,
                    role: 'system' as const,
                    content: `\u2717 Redeploy failed: ${err instanceof Error ? err.message : String(err)}`,
                    type: 'error' as const,
                    timestamp: Date.now(),
                  });
                  return prev;
                });
              }
            })();
            return;
          }
          if (evt.name === 's') {
            // Stop the current debugging project
            void (async () => {
              try {
                await c.stopProject(dbgState.projectId);
                setDeployMessages((prev) => {
                  prev.push({
                    id: `stop-${String(Date.now())}`,
                    role: 'system' as const,
                    content: `\u25A0 ${dbgState.projectName} stopped.`,
                    type: 'text' as const,
                    timestamp: Date.now(),
                  });
                  return prev;
                });
                returnToMonitoring();
              } catch (err) {
                setDeployMessages((prev) => {
                  prev.push({
                    id: `stop-err-${String(Date.now())}`,
                    role: 'system' as const,
                    content: `\u2717 Stop failed: ${err instanceof Error ? err.message : String(err)}`,
                    type: 'error' as const,
                    timestamp: Date.now(),
                  });
                  return prev;
                });
              }
            })();
            return;
          }
          if (evt.name === 'd') {
            // Open tunnel overlay for domain configuration
            setShowTunnel(true);
            return;
          }
        }
      }

      if (focus() === 'status' && !evt.ctrl && !evt.meta && evt.name && evt.name.length === 1) {
        focusChat();
      }
    });
  } catch {
    /* Renderer not ready during initial reactivity pass */
  }

  // Drag-to-copy: auto-copy selected text to clipboard via OSC 52
  try {
    const renderer = useRenderer();
    useSelectionHandler((selection) => {
      if (!selection.isActive) return;
      const text = selection.getSelectedText();
      if (text) {
        renderer.copyToClipboardOSC52(text);
        // Show toast notification
        if (copyToastTimer) clearTimeout(copyToastTimer);
        setShowCopyToast(true);
        copyToastTimer = setTimeout(() => setShowCopyToast(false), 2000);
      }
    });
  } catch {
    /* Renderer not ready during initial reactivity pass */
  }

  // Reactive render — must wrap in arrow function for Solid.js reactivity
  const renderContent = (): JSX.Element => {
    // Dashboard mode — split-panel layout
    const panelMode = isWideMode() ? 'split' : 'single';
    const contentHeight = rows() - 1; // reserve 1 row for status bar
    const connectedClient = status() === 'connected' ? client : null;
    // Map focus to Layout's activePanel prop
    const activePanelForLayout = (): 'left' | 'right' => (focus() === 'chat' ? 'left' : 'right');

    // When any overlay is open, unfocus panels so textarea doesn't eat keyboard events
    const anyOverlayOpen = () =>
      showHelp() || showModelSelector() || showGit() || showRepo() || showTunnel() || showEnv();

    // Sync centralized overlay state so DashboardPanel/ChatPanel can check directly
    createEffect(() => {
      setOverlayActive(anyOverlayOpen());
    });

    return (
      <>
        <Layout
          left={
            <ChatPanel
              client={connectedClient}
              height={contentHeight}
              focus={focus() === 'chat' && !anyOverlayOpen()}
              externalMessages={deployMessages()}
              onModal={(modal: string) => {
                if (modal === 'help') setShowHelp(true);
                if (modal === 'model') setShowModelSelector(true);
                if (modal === 'git') setShowGit(true);
                if (modal === 'repo') void handleShowRepo();
                if (modal === 'tunnel') setShowTunnel(true);
                if (modal === 'env') setShowEnv(true);
              }}
            />
          }
          right={
            <StatusPanel
              client={connectedClient}
              height={contentHeight}
              focus={focus() === 'status' && !anyOverlayOpen()}
              mode={tuiMode()}
              deployingState={deployingState()}
              debuggingState={debuggingState()}
              onStatsUpdate={handleStatsUpdate}
              onProjectSelect={handleProjectSelect}
            />
          }
          statusBar={
            <StatusBar
              panelMode={panelMode}
              activePanel={activePanelForLayout()}
              projectCount={projectCount()}
              cpuPercent={cpuPercent()}
              buildingCount={buildingCount()}
              mode={tuiMode()}
              deployProjectName={deployingState()?.projectName}
              debugProjectName={debuggingState()?.projectName}
              memDisplay={memDisplay()}
              debugPort={debuggingState()?.port ?? null}
              buildProgress={buildProgress()}
            />
          }
          activePanel={activePanelForLayout()}
          columns={columns()}
          rows={rows()}
        />
        {/* Overlays rendered at App level for proper SolidJS lifecycle */}
        <Show when={showHelp()}>
          <box position="absolute" width={columns()} height={rows()} flexDirection="column">
            <HelpOverlay
              onClose={() => {
                setShowHelp(false);
              }}
            />
          </box>
        </Show>
        <Show when={showModelSelector()}>
          <box position="absolute" width={columns()} height={rows()} flexDirection="column">
            <ModelOverlay
              currentProvider={currentProvider()}
              currentModel={currentModel()}
              onSelect={handleModelSelect}
              onClose={() => setShowModelSelector(false)}
            />
          </box>
        </Show>
        <Show when={showGit()}>
          <box
            position="absolute"
            width={columns()}
            height={rows()}
            flexDirection="column"
            zIndex={100}
          >
            <GitOverlay
              currentProviders={connectedProviders()}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onClose={() => setShowGit(false)}
            />
          </box>
        </Show>
        <Show when={showRepo()}>
          <box position="absolute" width={columns()} height={rows()} flexDirection="column">
            <RepoOverlay
              repos={repos()}
              loading={reposLoading()}
              error={reposError()}
              onSelect={handleRepoSelect}
              onClose={() => setShowRepo(false)}
            />
          </box>
        </Show>
        <Show when={showTunnel()}>
          <box position="absolute" width={columns()} height={rows()} flexDirection="column">
            <TunnelOverlay onClose={() => setShowTunnel(false)} client={connectedClient} />
          </box>
        </Show>
        <Show when={showEnv()}>
          <box position="absolute" width={columns()} height={rows()} flexDirection="column">
            <EnvOverlay onClose={() => setShowEnv(false)} client={connectedClient} />
          </box>
        </Show>
        {showCopyToast() && (
          <box
            position="absolute"
            width={columns()}
            height={rows()}
            flexDirection="column"
            alignItems="flex-end"
            paddingRight={2}
            paddingTop={1}
          >
            <text backgroundColor={theme.primary} fg={theme.background} bold={true}>
              {' Copied to clipboard '}
            </text>
          </box>
        )}
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
