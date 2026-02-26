import type { JSX } from 'solid-js';
import { For, createSignal } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

interface ConnectOverlayProps {
  currentProviders: Record<string, { connected: boolean; username: string }>;
  onConnect: (provider: string, token: string) => void;
  onClose: () => void;
}

type ConnectState = 'select-provider' | 'enter-token';

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

export function ConnectOverlay(props: ConnectOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  const [state, setState] = createSignal<ConnectState>('select-provider');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [tokenInput, setTokenInput] = createSignal('');

  let textareaRef: { plainText: string } | undefined;

  const selectedProvider = () => PROVIDERS[selectedIndex()];

  useKeyboard((evt) => {
    if (state() === 'select-provider') {
      if (evt.key === 'escape') {
        props.onClose();
      } else if (evt.key === 'up') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.key === 'down') {
        setSelectedIndex((prev) => Math.min(PROVIDERS.length - 1, prev + 1));
      } else if (evt.key === 'enter') {
        setState('enter-token');
      }
    } else if (state() === 'enter-token') {
      if (evt.key === 'escape') {
        setState('select-provider');
        setTokenInput('');
      }
      // Enter is handled by textarea's onSubmit
    }
  });

  const handleTokenSubmit = () => {
    const token = tokenInput().trim();
    const provider = selectedProvider();
    if (token && provider) {
      props.onConnect(provider.id, token);
    }
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

        {state() === 'select-provider' ? (
          <>
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
                        backgroundColor={isSelected() ? theme.primary : undefined}
                        fg={isSelected() ? theme.background : theme.text}
                        bold={isSelected()}
                      >
                        {' '}
                        {info().connected ? '●' : '○'} {provider.icon} {provider.label}
                        {info().connected ? (
                          <text fg={theme.success}>
                            {' '}
                            Connected ({info().username || 'unknown'})
                          </text>
                        ) : (
                          <text fg={theme.textDim}> Not connected</text>
                        )}
                        {isSelected() ? ' ' : ''}
                      </text>
                    </box>
                  );
                }}
              </For>
            </box>

            {/* Footer hint */}
            <box marginTop={1} justifyContent="center">
              <text fg={theme.textDim}>[↑↓ Navigate] [Enter Select] [Esc Close]</text>
            </box>
          </>
        ) : (
          <>
            {/* Token input */}
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

            {/* Footer hint */}
            <box marginTop={1} justifyContent="center">
              <text fg={theme.textDim}>[Enter Submit] [Esc Back]</text>
            </box>
          </>
        )}
      </box>
    </box>
  );
}
