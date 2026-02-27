import type { JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

interface GitOverlayProps {
  currentProviders: Record<string, { connected: boolean; username: string }>;
  onConnect: (
    provider: string,
    token: string,
  ) => Promise<{ valid: boolean; username?: string; error?: string }>;
  onClose: () => void;
}

type ConnectState = 'select-provider' | 'enter-token' | 'validating' | 'result';

interface ProviderInfo {
  id: string;
  label: string;
  icon: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'github', label: 'GitHub', icon: '✦' },
  { id: 'gitlab', label: 'GitLab', icon: '◈' },
  { id: 'bitbucket', label: 'Bitbucket', icon: '◆' },
  { id: 'gitea', label: 'Gitea', icon: '◎' },
];

export function GitOverlay(props: GitOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  const [state, setState] = createSignal<ConnectState>('select-provider');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [tokenInput, setTokenInput] = createSignal('');
  const [validationResult, setValidationResult] = createSignal<{
    valid: boolean;
    username?: string;
    error?: string;
  } | null>(null);

  let textareaRef: { plainText: string } | undefined;

  const selectedProvider = () => PROVIDERS[selectedIndex()];

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    if (state() === 'select-provider') {
      if (evt.name === 'escape') {
        props.onClose();
      } else if (evt.name === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.name === 'down') {
        setSelectedIndex((prev) => Math.min(PROVIDERS.length - 1, prev + 1));
      } else if (evt.name === 'enter') {
        setState('enter-token');
      }
    } else if (state() === 'enter-token') {
      if (evt.name === 'escape') {
        setState('select-provider');
        setTokenInput('');
      }
      // Enter is handled by textarea's onSubmit
    } else if (state() === 'result') {
      if (evt.name === 'escape' || evt.name === 'enter') {
        props.onClose();
      }
    }
    // Prevent background components from receiving this event
    evt.stopPropagation?.();
  });
  const handleTokenSubmit = () => {
    const token = tokenInput().trim();
    const provider = selectedProvider();
    if (!token || !provider) return;
    setState('validating');
    void props.onConnect(provider.id, token).then((result) => {
      setValidationResult(result);
      setState('result');
    });
  };

  const contentWidth = 60;

  return (
    <box
      flexDirection="column"
      width={columns()}
      height={rows()}
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme.background}
    >
      <box
        flexDirection="column"
        border="round"
        borderColor={theme.borderActive}
        paddingX={2}
        paddingY={1}
        width={contentWidth}
        backgroundColor={theme.backgroundMenu}
      >
        {/* Header */}
        <box marginBottom={1} justifyContent="center">
          <text bold={true} fg={theme.text}>
            Connect Git Provider
          </text>
        </box>

        <Show when={state() === 'select-provider'}>
          {/* Provider list */}
          <box flexDirection="column" gap={0}>
            <For each={PROVIDERS}>
              {(provider, index) => {
                const info = () =>
                  props.currentProviders[provider.id] ?? {
                    connected: false,
                    username: '',
                  };
                const isSelected = () => selectedIndex() === index();

                return (
                  <box>
                    <text
                      backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                      fg={isSelected() ? theme.secondary : theme.text}
                      bold={isSelected()}
                    >
                      {isSelected() ? ' ▶ ' : '   '}
                      {info().connected ? '●' : '○'} {provider.icon} {provider.label}
                    </text>
                    {info().connected ? (
                      <text fg={theme.success}> Connected ({info().username || 'unknown'})</text>
                    ) : (
                      <text fg={theme.textDim}> Not connected</text>
                    )}
                  </box>
                );
              }}
            </For>
          </box>
          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>[↑↓ Navigate] [Enter Select] [Esc Close]</text>
          </box>
        </Show>

        <Show when={state() === 'enter-token'}>
          <box flexDirection="column" gap={1}>
            <text fg={theme.text}>
              Enter Personal Access Token for {selectedProvider()?.label}:
            </text>
            <box>
              <textarea
                ref={textareaRef}
                minHeight={1}
                maxHeight={1}
                width={contentWidth - 4}
                fg={theme.text}
                backgroundColor={theme.backgroundElement}
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
          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>[Enter Submit] [Esc Back]</text>
          </box>
        </Show>

        <Show when={state() === 'validating'}>
          <box flexDirection="column" alignItems="center" gap={1}>
            <text fg={theme.warning}>⟳ Validating token...</text>
          </box>
        </Show>

        <Show when={state() === 'result'}>
          <box flexDirection="column" alignItems="center" gap={1}>
            {validationResult()?.valid ? (
              <>
                <text fg={theme.success}>✓ Token valid</text>
                <text fg={theme.text}>
                  Connected as {validationResult()?.username ?? 'unknown'}
                </text>
              </>
            ) : (
              <>
                <text fg={theme.error}>✗ Token invalid</text>
                <text fg={theme.textMuted}>{validationResult()?.error ?? 'Unknown error'}</text>
              </>
            )}
          </box>
          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>[Enter/Esc Close]</text>
          </box>
        </Show>
      </box>
    </box>
  );
}
