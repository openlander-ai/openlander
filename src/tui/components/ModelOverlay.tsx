import type { JSX } from 'solid-js';
import { For, createSignal, createMemo } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

interface ModelOverlayProps {
  currentProvider: string;
  currentModel: string;
  onSelect: (provider: string, model: string) => void;
  onClose: () => void;
}

interface ModelEntry {
  provider: string;
  model: string;
}

const MODELS: ModelEntry[] = [
  // Gemini
  { provider: 'gemini', model: 'gemini-2.0-flash' },
  { provider: 'gemini', model: 'gemini-2.5-pro' },
  { provider: 'gemini', model: 'gemini-2.5-flash' },
  // Anthropic
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  { provider: 'anthropic', model: 'claude-haiku-3-20250414' },
  // OpenAI
  { provider: 'openai', model: 'gpt-4o' },
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'openai', model: 'o3-mini' },
  // OpenRouter
  { provider: 'openrouter', model: 'google/gemini-2.0-flash-exp:free' },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-20250514' },
  // Ollama
  { provider: 'ollama', model: 'llama3.2' },
  { provider: 'ollama', model: 'codellama' },
  { provider: 'ollama', model: 'mistral' },
];

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

const PROVIDER_ICONS: Record<string, string> = {
  gemini: '✦',
  anthropic: '◈',
  openai: '◆',
  openrouter: '◇',
  ollama: '◎',
};

export function ModelOverlay(props: ModelOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  const [selectedIndex, setSelectedIndex] = createSignal(0);

  // Group models by provider for display
  const groupedModels = createMemo(() => {
    const groups: { provider: string; label: string; models: ModelEntry[] }[] = [];
    let currentProvider = '';

    for (const entry of MODELS) {
      if (entry.provider !== currentProvider) {
        currentProvider = entry.provider;
        groups.push({
          provider: currentProvider,
          label: PROVIDER_LABELS[currentProvider] ?? currentProvider,
          models: [],
        });
      }
      const currentGroup = groups[groups.length - 1];
      if (currentGroup) {
        currentGroup.models.push(entry);
      }
    }

    return groups;
  });

  // Find the index of the currently selected model
  const currentModelIndex = createMemo(() => {
    const idx = MODELS.findIndex(
      (m) => m.provider === props.currentProvider && m.model === props.currentModel,
    );
    return idx >= 0 ? idx : 0;
  });

  // Initialize selection to current model
  createMemo(() => {
    const idx = currentModelIndex();
    setSelectedIndex(idx);
  });

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    if (evt.name === 'escape') {
      props.onClose();
    } else if (evt.name === 'up') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (evt.name === 'down') {
      setSelectedIndex((prev) => Math.min(MODELS.length - 1, prev + 1));
    } else if (evt.name === 'enter') {
      const entry = MODELS[selectedIndex()];
      if (entry) {
        props.onSelect(entry.provider, entry.model);
      }
    }
    // Prevent background components from receiving this event
    evt.stopPropagation?.();
  });

  const contentWidth = 60;

  // Build flat list with provider headers for rendering
  const renderItems = createMemo(() => {
    const items: (
      | { type: 'header'; provider: string; label: string }
      | { type: 'model'; entry: ModelEntry; modelIndex: number }
    )[] = [];
    let modelIdx = 0;

    for (const group of groupedModels()) {
      items.push({ type: 'header', provider: group.provider, label: group.label });
      for (const entry of group.models) {
        items.push({ type: 'model', entry, modelIndex: modelIdx });
        modelIdx++;
      }
    }

    return items;
  });

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
            Select Model
          </text>
        </box>

        {/* Model list */}
        <box flexDirection="column" gap={0}>
          <For each={renderItems()}>
            {(item) => {
              if (item.type === 'header') {
                return (
                  <box marginTop={item.provider === 'gemini' ? 0 : 1}>
                    <text bold={true} fg={theme.secondary}>
                      {item.label}
                    </text>
                  </box>
                );
              }

              const isSelected = () => selectedIndex() === item.modelIndex;
              const isCurrent = () =>
                item.entry.provider === props.currentProvider &&
                item.entry.model === props.currentModel;
              const icon = PROVIDER_ICONS[item.entry.provider] ?? '•';

              return (
                <box>
                  <text
                    backgroundColor={isSelected() ? theme.primary : undefined}
                    fg={isSelected() ? theme.text : theme.text}
                    bold={isSelected()}
                  >
                    {' '}
                    {isCurrent() ? '●' : ' '}
                    {icon} {item.entry.model}
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
      </box>
    </box>
  );
}
