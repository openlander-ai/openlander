import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { ProgressBar } from './ProgressBar.js';
import { Spinner } from './Spinner.js';
import { theme } from '../theme.js';
import {
  ThinkingDisplay,
  CommandDisplay,
  FileEditDisplay,
  TodoListDisplay,
  BuildResultDisplay,
  OrchestrationDisplay,
} from './AgentDisplay.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Message type for specialized rendering */
  type?:
    | 'text'
    | 'tool_start'
    | 'tool_result'
    | 'url'
    | 'warning'
    | 'error'
    | 'progress'
    | 'command'
    | 'file_edit'
    | 'thinking'
    | 'todo'
    | 'build_result'
    | 'orchestration';
  /** Tool name for tool_start/tool_result types */
  toolName?: string;
  /** Tool execution status */
  toolStatus?: 'running' | 'success' | 'error';
  /** Tool execution duration in seconds */
  toolDuration?: number;
  /** Progress percentage (0-100) for progress type */
  progress?: number;
  /** Command string for command type */
  command?: string;
  /** Command/build output text */
  output?: string;
  /** File path for file_edit type */
  filePath?: string;
  /** Diff text for file_edit type */
  diff?: string;
  /** File action for file_edit type */
  fileAction?: 'edit' | 'create' | 'delete';
  /** Todo items for todo type */
  todoItems?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  /** Build success flag */
  buildSuccess?: boolean;
  /** Build duration string */
  buildDuration?: string;
  /** Orchestration steps for orchestration type */
  orchestrationSteps?: string[];
  /** Timestamp in milliseconds */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format tool name into a human-readable description */
function formatToolDescription(toolName: string): string {
  // Convert snake_case to Title Case with spaces
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Format duration in seconds */
function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${String(Math.round(seconds * 1000))}ms`;
  }
  return `${seconds.toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ChatMessageProps {
  message: DisplayMessage;
}

/**
 * Individual message rendering with type-specific display.
 */
export function ChatMessage(props: ChatMessageProps): JSX.Element {
  const role = () => props.message.role;
  const content = () => props.message.content;
  const type = () => props.message.type;
  const toolName = () => props.message.toolName;
  const toolStatus = () => props.message.toolStatus;
  const toolDuration = () => props.message.toolDuration;
  const progress = () => props.message.progress;

  // Helper to render content based on type
  const renderContent = (): JSX.Element => {
    // User messages — inline "You: content"
    if (role() === 'user') {
      return (
        <text>
          <text bold={true} color={theme.secondary}>
            You:{' '}
          </text>
          <text>{content()}</text>
        </text>
      );
    }

    // System messages
    if (role() === 'system') {
      return <text dim={true}>{content()}</text>;
    }

    // Assistant messages
    switch (type()) {
      case 'tool_start':
        return (
          <text color={theme.progress}>
            <Spinner color={theme.primary} />{' '}
            {toolName() ? formatToolDescription(toolName()!) : content()} 중...
          </text>
        );

      case 'tool_result': {
        if (toolStatus() === 'error') {
          return (
            <text color={theme.error}>
              ❌ {toolName() ? formatToolDescription(toolName()!) : content()} 실패
            </text>
          );
        }
        const durationText =
          toolDuration() !== undefined ? ` (${formatDuration(toolDuration()!)})` : '';
        return (
          <text color={theme.success}>
            ✅ {toolName() ? formatToolDescription(toolName()!) : content()} 완료{durationText}
          </text>
        );
      }

      case 'progress':
        return <ProgressBar percent={progress() ?? 0} label={content() || undefined} />;

      case 'url':
        return (
          <text color={theme.url}>
            <u>{content()}</u>
          </text>
        );

      case 'warning':
        return <text color={theme.warning}>⚠️ {content()}</text>;

      case 'error':
        return <text color={theme.error}>❌ {content()}</text>;

      case 'command':
        return (
          <CommandDisplay
            command={props.message.command ?? ''}
            output={props.message.output}
            status={props.message.toolStatus}
          />
        );

      case 'file_edit':
        return (
          <FileEditDisplay
            filePath={props.message.filePath ?? ''}
            diff={props.message.diff}
            action={props.message.fileAction}
          />
        );

      case 'thinking':
        return <ThinkingDisplay label={content() || 'Thinking...'} />;

      case 'todo':
        return <TodoListDisplay items={props.message.todoItems ?? []} />;

      case 'build_result':
        return (
          <BuildResultDisplay
            label={props.message.toolName ?? 'Build'}
            output={props.message.output ?? ''}
            success={props.message.buildSuccess ?? false}
            duration={props.message.buildDuration}
          />
        );

      case 'orchestration':
        return (
          <OrchestrationDisplay
            title={content() || 'Plan'}
            steps={props.message.orchestrationSteps ?? []}
          />
        );

      case 'text':
      default: {
        // Regular assistant text
        if (!content()) {
          return <></>;
        }
        // Wrap long lines similar to ChatView
        const lines = content().split('\n');
        return (
          <box flexDirection="column">
            <For each={lines}>
              {(line, i) => (
                <text>
                  {i() === 0 ? '' : '  '}
                  {line}
                </text>
              )}
            </For>
          </box>
        );
      }
    }
  };

  // Check if it's an AgentDisplay type (these have their own borders)
  const isAgentDisplayType = () =>
    ['command', 'file_edit', 'thinking', 'todo', 'build_result', 'orchestration'].includes(
      type() || '',
    );

  // If it's an AgentDisplay type, render directly with padding but NO extra border
  if (isAgentDisplayType()) {
    return <box paddingX={1}>{renderContent()}</box>;
  }

  // Determine border color based on role and type
  const borderColor = (): string => {
    let color: string = theme.primary; // default: assistant orange
    if (role() === 'user') color = theme.secondary;
    else if (role() === 'system') color = theme.muted;

    if (type() === 'error') color = theme.error;
    else if (type() === 'warning') color = theme.warning;

    return color;
  };

  return (
    <box
      border="bold"
      borderLeft={true}
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={borderColor()}
      paddingLeft={1}
      flexDirection="column"
    >
      {renderContent()}
    </box>
  );
}
