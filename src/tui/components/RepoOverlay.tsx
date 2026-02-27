import type { JSX } from 'solid-js';
import { For, createMemo, createSignal } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { theme } from '../theme.js';
import { OverlayContainer } from './OverlayContainer.js';

interface RepoItem {
  name: string;
  fullName: string;
  description: string | null;
  isPrivate: boolean;
  provider: string;
}

interface RepoOverlayProps {
  repos: RepoItem[];
  loading: boolean;
  error: string | null;
  onSelect: (repoFullName: string) => void;
  onClose: () => void;
}

export function RepoOverlay(props: RepoOverlayProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const maxVisible = 15;
  const contentWidth = 70;

  // Calculate visible window for scrolling
  const visibleRange = createMemo(() => {
    const total = props.repos.length;
    if (total <= maxVisible) {
      return { start: 0, end: total };
    }

    // Center selection in window
    let start = Math.max(0, selectedIndex() - Math.floor(maxVisible / 2));
    const end = Math.min(total, start + maxVisible);

    // Adjust if we're near the end
    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }

    return { start, end };
  });

  const visibleRepos = createMemo(() => {
    const { start, end } = visibleRange();
    return props.repos.slice(start, end);
  });

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    if (evt.name === 'escape') {
      props.onClose();
    } else if (!props.loading && !props.error && props.repos.length > 0) {
      if (evt.name === 'up' || evt.name === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (evt.name === 'down' || evt.name === 'j') {
        setSelectedIndex((prev) => Math.min(props.repos.length - 1, prev + 1));
      } else if (evt.name === 'return') {
        const repo = props.repos[selectedIndex()];
        if (repo) {
          props.onSelect(repo.fullName);
        }
      }
    }
    // Prevent background components from receiving this event
    evt.stopPropagation?.();
  });

  // Truncate description to fit
  const truncateDesc = (desc: string | null, maxLen: number): string => {
    if (!desc) return '';
    if (desc.length <= maxLen) return desc;
    return desc.slice(0, maxLen - 1) + '…';
  };

  return (
    <OverlayContainer
      title="Repositories"
      width={contentWidth}
      footer={props.repos.length > 0 ? '[↑↓ Navigate] [Enter Deploy] [Esc Close]' : '[Esc Close]'}
    >
      {/* Content */}
      {props.loading ? (
        <box justifyContent="center">
          <text fg={theme.textMuted}>Loading repositories...</text>
        </box>
      ) : props.error ? (
        <box justifyContent="center">
          <text fg={theme.error}>{props.error}</text>
        </box>
      ) : props.repos.length === 0 ? (
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.textMuted}>No repositories found.</text>
          <text fg={theme.textDim}>Use /connect to add a provider.</text>
        </box>
      ) : (
        <box flexDirection="column" gap={0}>
          <For each={visibleRepos()}>
            {(repo, index) => {
              const { start } = visibleRange();
              const actualIndex = start + index();
              const isSelected = () => selectedIndex() === actualIndex;
              const icon = repo.isPrivate ? '●' : '○';
              const descWidth = contentWidth - repo.fullName.length - 8;
              const desc = truncateDesc(repo.description, descWidth);

              return (
                <box flexDirection="row">
                  <text
                    backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                    fg={isSelected() ? theme.secondary : theme.text}
                    bold={isSelected()}
                  >
                    {isSelected() ? ' ▶ ' : '   '}
                    {icon} {repo.fullName}
                  </text>
                  {desc ? (
                    <text fg={isSelected() ? theme.text : theme.textMuted}> {desc}</text>
                  ) : null}
                </box>
              );
            }}
          </For>
        </box>
      )}
    </OverlayContainer>
  );
}
