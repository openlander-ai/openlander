import type { JSX } from 'solid-js';
import { For, createMemo } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

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
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  // Selection state - must be at top level for reactivity
  let selectedIndex = 0;
  const maxVisible = 15;

  // Calculate visible window for scrolling
  const visibleRange = createMemo(() => {
    const total = props.repos.length;
    if (total <= maxVisible) {
      return { start: 0, end: total };
    }

    // Center selection in window
    let start = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
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

  useKeyboard((evt) => {
    if (evt.key === 'escape') {
      props.onClose();
    } else if (!props.loading && !props.error && props.repos.length > 0) {
      if (evt.key === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
      } else if (evt.key === 'down') {
        selectedIndex = Math.min(props.repos.length - 1, selectedIndex + 1);
      } else if (evt.key === 'enter') {
        const repo = props.repos[selectedIndex];
        if (repo) {
          props.onSelect(repo.fullName);
        }
      }
    }
  });

  const contentWidth = 70;

  // Truncate description to fit
  const truncateDesc = (desc: string | null, maxLen: number): string => {
    if (!desc) return '';
    if (desc.length <= maxLen) return desc;
    return desc.slice(0, maxLen - 1) + '…';
  };

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
            Repositories
          </text>
        </box>

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
                const isSelected = () => selectedIndex === actualIndex;
                const icon = repo.isPrivate ? '🔒' : '📂';
                const descWidth = contentWidth - repo.fullName.length - 8;
                const desc = truncateDesc(repo.description, descWidth);

                return (
                  <box>
                    <text
                      backgroundColor={isSelected() ? theme.primary : undefined}
                      fg={isSelected() ? theme.background : theme.text}
                      bold={isSelected()}
                    >
                      {' '}
                      {icon} {repo.fullName}
                      {desc ? (
                        <text fg={isSelected() ? theme.background : theme.textMuted}> {desc}</text>
                      ) : (
                        ''
                      )}
                      {isSelected() ? ' ' : ''}
                    </text>
                  </box>
                );
              }}
            </For>
          </box>
        )}

        {/* Footer hint */}
        <box marginTop={1} justifyContent="center">
          {props.repos.length > 0 ? (
            <text fg={theme.textDim}>[↑↓ Navigate] [Enter Deploy] [Esc Close]</text>
          ) : (
            <text fg={theme.textDim}>[Esc Close]</text>
          )}
        </box>
      </box>
    </box>
  );
}
