import type { JSX } from 'solid-js';
import { For, Show, createSignal, onCleanup } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { theme } from '../theme.js';
import { OverlayContainer } from './OverlayContainer.js';
import {
  requestDeviceCode,
  pollForAccessToken,
  openInBrowser,
  getGitHubClientId,
} from '../../git-providers/github-oauth.js';

interface GitOverlayProps {
  currentProviders: Record<string, { connected: boolean; username: string; authMethod?: string }>;
  onConnect: (
    provider: string,
    token: string,
    authMethod?: 'oauth' | 'pat',
  ) => Promise<{ valid: boolean; username?: string; error?: string }>;
  onDisconnect: (provider: string) => void;
  onClose: () => void;
}

type GitOverlayState =
  | 'select-provider'
  | 'select-auth-method'
  | 'device-flow'
  | 'connected-status'
  | 'enter-token'
  | 'validating'
  | 'result';

interface ProviderInfo {
  id: string;
  label: string;
}

interface AuthMethod {
  id: 'oauth' | 'token';
  label: string;
  description: string;
  enabled: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
];

function getAuthMethods(providerId: string): AuthMethod[] {
  if (providerId === 'github') {
    return [
      {
        id: 'oauth',
        label: 'Auth',
        description: 'Login via browser',
        enabled: true,
      },
      { id: 'token', label: 'Token', description: 'Enter PAT manually', enabled: true },
    ];
  }
  // GitLab and others - only token auth for now
  return [{ id: 'token', label: 'Token', description: 'Enter PAT manually', enabled: true }];
}

export function GitOverlay(props: GitOverlayProps): JSX.Element {
  // Find first connected provider or default to GitHub
  const getInitialProvider = (): string => {
    for (const provider of PROVIDERS) {
      const info = props.currentProviders[provider.id];
      if (info?.connected) {
        return provider.id;
      }
    }
    return 'github';
  };

  const getInitialState = (): GitOverlayState => {
    // Check if any provider is connected
    for (const provider of PROVIDERS) {
      if (props.currentProviders[provider.id]?.connected) {
        return 'connected-status';
      }
    }
    return 'select-provider';
  };

  const [state, setState] = createSignal<GitOverlayState>(getInitialState());
  const [selectedProvider, setSelectedProvider] = createSignal<string>(getInitialProvider());
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [tokenInput, setTokenInput] = createSignal('');
  const [validationResult, setValidationResult] = createSignal<{
    valid: boolean;
    username?: string;
    error?: string;
  } | null>(null);

  // Device flow state
  const [, setDeviceCode] = createSignal<string>('');
  const [userCode, setUserCode] = createSignal<string>('');
  const [verificationUri, setVerificationUri] = createSignal<string>('');
  const [deviceFlowError, setDeviceFlowError] = createSignal<string>('');

  let textareaRef: { plainText: string } | undefined;
  let pendingSubmitText: string | null = null;
  let abortController: AbortController | undefined;

  // Cleanup on unmount
  onCleanup(() => {
    abortController?.abort();
  });

  const currentProviderInfo = () => PROVIDERS.find((p) => p.id === selectedProvider());
  const authMethods = () => getAuthMethods(selectedProvider());
  const currentConnection = () =>
    props.currentProviders[selectedProvider()] ?? { connected: false, username: '' };
  const contentWidth = 60;

  // Get current list based on state
  const currentList = () => {
    const s = state();
    if (s === 'select-provider') {
      return PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        connected: props.currentProviders[p.id]?.connected ?? false,
      }));
    }
    if (s === 'select-auth-method') {
      return authMethods();
    }
    if (s === 'connected-status') {
      return [
        { id: 'reconnect', label: `Reconnect ${currentProviderInfo()?.label ?? ''}` },
        { id: 'disconnect', label: 'Disconnect' },
      ];
    }
    return [];
  };

  const getTitle = () => {
    const providerLabel = currentProviderInfo()?.label ?? '';
    switch (state()) {
      case 'select-provider':
        return 'Git';
      case 'select-auth-method':
        return providerLabel;
      case 'device-flow':
        return `${providerLabel} Auth`;
      case 'connected-status':
        return providerLabel;
      case 'enter-token':
        return providerLabel;
      case 'validating':
        return providerLabel;
      case 'result':
        return providerLabel;
      default:
        return 'Git';
    }
  };

  const footerText = () => {
    switch (state()) {
      case 'select-provider':
        return '[↑↓ Navigate] [Enter Select] [Esc Close]';
      case 'select-auth-method':
        return '[↑↓ Navigate] [Enter Select] [Esc Back]';
      case 'device-flow':
        return '[Esc Cancel]';
      case 'connected-status':
        return '[↑↓ Navigate] [Enter Select] [Esc Close]';
      case 'enter-token':
        return `[Enter Submit] [Esc ${currentConnection().connected ? 'Back' : 'Back'}]`;
      case 'result':
        return '[Enter/Esc Close]';
      default:
        return '';
    }
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId);
    if (props.currentProviders[providerId]?.connected) {
      setState('connected-status');
      setSelectedIndex(0);
    } else {
      setState('select-auth-method');
      setSelectedIndex(0);
    }
  };

  const handleAuthMethodSelect = (methodId: 'oauth' | 'token') => {
    if (methodId === 'oauth') {
      void startDeviceFlow();
    } else {
      setState('enter-token');
      setTokenInput('');
      pendingSubmitText = null;
    }
  };

  const startDeviceFlow = async () => {
    const clientId = getGitHubClientId();
    if (!clientId) {
      setDeviceFlowError('OAuth not configured. Set OPENLANDER_GITHUB_CLIENT_ID env var.');
      setState('device-flow');
      return;
    }

    setState('device-flow');
    setDeviceFlowError('');

    try {
      const response = await requestDeviceCode(clientId);
      setDeviceCode(response.device_code);
      setUserCode(response.user_code);
      setVerificationUri(response.verification_uri);

      // Open browser
      openInBrowser(response.verification_uri);

      // Start polling
      abortController = new AbortController();
      const accessToken = await pollForAccessToken(
        clientId,
        response.device_code,
        response.interval,
        abortController.signal,
      );

      // Validate the token
      setState('validating');
      const result = await props.onConnect(selectedProvider(), accessToken, 'oauth');
      setValidationResult(result);

      if (result.valid) {
        setState('result');
      } else {
        setDeviceFlowError(result.error ?? 'Validation failed');
        setState('device-flow');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Polling cancelled') {
        // User cancelled, go back
        setState('select-auth-method');
        setSelectedIndex(0);
      } else {
        setDeviceFlowError(message);
      }
    }
  };

  const cancelDeviceFlow = () => {
    abortController?.abort();
    abortController = undefined;
    setState('select-auth-method');
    setSelectedIndex(0);
    setDeviceFlowError('');
  };

  const handleTokenSubmit = () => {
    const token = (pendingSubmitText ?? tokenInput()).trim();
    pendingSubmitText = null;
    if (!token) return;

    setState('validating');
    void props.onConnect(selectedProvider(), token, 'pat').then((result) => {
      setValidationResult(result);
      setState('result');
    });
  };

  const handleConnectedAction = (actionId: string) => {
    if (actionId === 'reconnect') {
      setState('select-auth-method');
      setSelectedIndex(0);
    } else if (actionId === 'disconnect') {
      props.onDisconnect(selectedProvider());
      // Check if any other provider is connected
      const hasOtherConnected = PROVIDERS.some(
        (p) => p.id !== selectedProvider() && props.currentProviders[p.id]?.connected,
      );
      if (hasOtherConnected) {
        // Stay in connected-status, but might need to switch provider
      } else {
        setState('select-provider');
        setSelectedIndex(0);
      }
    }
  };

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    const s = state();

    if (s === 'select-provider') {
      const items = currentList();
      if (evt.name === 'escape') {
        props.onClose();
      } else if (evt.name === 'up' || evt.name === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
      } else if (evt.name === 'return') {
        const item = items[selectedIndex()];
        if (item) {
          handleProviderSelect(item.id);
        }
      }
    } else if (s === 'select-auth-method') {
      const items = currentList() as AuthMethod[];
      if (evt.name === 'escape') {
        setState('select-provider');
        setSelectedIndex(PROVIDERS.findIndex((p) => p.id === selectedProvider()));
      } else if (evt.name === 'up' || evt.name === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
      } else if (evt.name === 'return') {
        const item = items[selectedIndex()];
        if (item && item.enabled) {
          handleAuthMethodSelect(item.id);
        }
      }
    } else if (s === 'device-flow') {
      if (evt.name === 'escape') {
        cancelDeviceFlow();
      }
    } else if (s === 'connected-status') {
      const items = currentList();
      if (evt.name === 'escape') {
        props.onClose();
      } else if (evt.name === 'up' || evt.name === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
      } else if (evt.name === 'return') {
        const item = items[selectedIndex()];
        if (item) {
          handleConnectedAction(item.id);
        }
      }
    } else if (s === 'enter-token') {
      if (evt.name === 'escape') {
        pendingSubmitText = null;
        if (currentConnection().connected) {
          setState('connected-status');
          setSelectedIndex(0);
        } else {
          setState('select-auth-method');
          setSelectedIndex(0);
        }
      }
      // Enter is handled by textarea's onSubmit
    } else if (s === 'result') {
      if (evt.name === 'escape' || evt.name === 'return') {
        props.onClose();
      }
    }

    evt.stopPropagation?.();
  });

  return (
    <OverlayContainer title={getTitle()} footer={footerText()}>
      {/* Provider selection */}
      <Show when={state() === 'select-provider'}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.text}>Select a Git provider:</text>
          <box flexDirection="column">
            <For each={currentList()}>
              {(item, index) => {
                const isSelected = () => selectedIndex() === index();
                return (
                  <text
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    fg={isSelected() ? theme.secondary : theme.text}
                    bold={isSelected()}
                  >
                    {isSelected() ? ' ▶ ' : '   '}
                    {item.label}
                    {'connected' in item && item.connected ? ' ✓' : ''}
                  </text>
                );
              }}
            </For>
          </box>
        </box>
      </Show>

      {/* Auth method selection */}
      <Show when={state() === 'select-auth-method'}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.text}>Connect to {currentProviderInfo()?.label}:</text>
          <box flexDirection="column">
            <For each={currentList()}>
              {(item, index) => {
                const isSelected = () => selectedIndex() === index();
                const authItem = item as AuthMethod;
                return (
                  <text
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    fg={
                      authItem.enabled
                        ? isSelected()
                          ? theme.secondary
                          : theme.text
                        : theme.textMuted
                    }
                    bold={isSelected()}
                  >
                    {isSelected() ? ' ▶ ' : '   '}
                    {authItem.label}
                    {' - '}
                    {authItem.description}
                  </text>
                );
              }}
            </For>
          </box>
        </box>
      </Show>

      {/* Device flow */}
      <Show when={state() === 'device-flow'}>
        <box flexDirection="column" gap={1}>
          <Show when={deviceFlowError()}>
            <text fg={theme.error}>{deviceFlowError()}</text>
          </Show>
          <Show when={!deviceFlowError()}>
            <text fg={theme.text}>Open this URL in your browser:</text>
            <a href={verificationUri()} fg={theme.secondary}>
              {verificationUri()}
            </a>
            <text fg={theme.text}> </text>
            <text fg={theme.text}>And enter this code:</text>
            <text fg={theme.accent} bold>
              ████ {userCode()} ████
            </text>
            <text fg={theme.text}> </text>
            <text fg={theme.warning}>⟳ Waiting for authorization...</text>
          </Show>
        </box>
      </Show>

      {/* Connected status */}
      <Show when={state() === 'connected-status'}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.success}>Connected to {currentProviderInfo()?.label}</text>
          <text fg={theme.textMuted}>Account: {currentConnection().username || 'unknown'}</text>
          <Show when={currentConnection().authMethod}>
            <text fg={theme.textMuted}>
              Method: {currentConnection().authMethod === 'oauth' ? 'OAuth' : 'PAT'}
            </text>
          </Show>
          <text fg={theme.text}> </text>
          <box flexDirection="column">
            <For each={currentList()}>
              {(item, index) => {
                const isSelected = () => selectedIndex() === index();
                return (
                  <text
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    fg={isSelected() ? theme.secondary : theme.text}
                    bold={isSelected()}
                  >
                    {isSelected() ? ' ▶ ' : '   '}
                    {item.label}
                  </text>
                );
              }}
            </For>
          </box>
        </box>
      </Show>

      {/* Enter token */}
      <Show when={state() === 'enter-token'}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.text}>
            Enter Personal Access Token for {currentProviderInfo()?.label}:
          </text>
          <box>
            <textarea
              ref={textareaRef}
              focused={true}
              minHeight={1}
              maxHeight={1}
              width={contentWidth - 4}
              fg={theme.text}
              backgroundColor={theme.backgroundElement}
              keyBindings={[{ name: 'enter', action: 'submit' }]}
              onKeyDown={(event: unknown) => {
                const evt = event as { name?: string };
                if (evt.name === 'enter' || evt.name === 'return') {
                  pendingSubmitText = tokenInput();
                }
              }}
              onContentChange={() => {
                const ref = textareaRef as { plainText: string } | undefined;
                if (ref) {
                  setTokenInput(ref.plainText);
                }
              }}
              onSubmit={handleTokenSubmit}
            />
          </box>
          <text fg={theme.textMuted}>
            Token will be stored securely in ~/.openlander/config.json
          </text>
        </box>
      </Show>

      {/* Validating */}
      <Show when={state() === 'validating'}>
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.warning}>⟳ Validating token...</text>
        </box>
      </Show>

      {/* Result */}
      <Show when={state() === 'result'}>
        <box flexDirection="column" alignItems="center" gap={1}>
          {validationResult()?.valid ? (
            <>
              <text fg={theme.success}>✓ Token valid</text>
              <text fg={theme.text}>Connected as {validationResult()?.username ?? 'unknown'}</text>
            </>
          ) : (
            <>
              <text fg={theme.error}>✗ Token invalid</text>
              <text fg={theme.textMuted}>{validationResult()?.error ?? 'Unknown error'}</text>
            </>
          )}
        </box>
      </Show>
    </OverlayContainer>
  );
}
