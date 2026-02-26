import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from './ProgressBar.js';
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
 *
 * Renders different message types:
 * - user: bold cyan "You: {message}"
 * - assistant text: normal text
 * - tool_start: yellow "🔄 {tool} 중..."
 * - tool_result success: green "✅ {tool} 완료 ({duration}s)"
 * - tool_result error: red "❌ {tool} 실패"
 * - progress: ProgressBar component
 * - url: blue text
 * - warning: yellow "⚠️ {message}"
 * - error: red "❌ {message}"
 * - system: dimmed text
 */
export function ChatMessage({ message }: ChatMessageProps): React.ReactElement {
  const { role, content, type, toolName, toolStatus, toolDuration, progress } = message;

  // Helper to render content based on type
  const renderContent = () => {
    // User messages — inline "You: content"
    if (role === 'user') {
      return (
        <Text>
          <Text bold color={theme.secondary}>
            You:{' '}
          </Text>
          <Text>{content}</Text>
        </Text>
      );
    }

    // System messages
    if (role === 'system') {
      return <Text dimColor>{content}</Text>;
    }

    // Assistant messages
    switch (type) {
      case 'tool_start':
        return (
          <Text color={theme.progress}>
            🔄 {toolName ? formatToolDescription(toolName) : content} 중...
          </Text>
        );

      case 'tool_result': {
        if (toolStatus === 'error') {
          return (
            <Text color={theme.error}>
              ❌ {toolName ? formatToolDescription(toolName) : content} 실패
            </Text>
          );
        }
        const durationText = toolDuration !== undefined ? ` (${formatDuration(toolDuration)})` : '';
        return (
          <Text color={theme.success}>
            ✅ {toolName ? formatToolDescription(toolName) : content} 완료{durationText}
          </Text>
        );
      }

      case 'progress':
        return <ProgressBar percent={progress ?? 0} label={content || undefined} />;

      case 'url':
        return (
          <Text color={theme.url} underline>
            {content}
          </Text>
        );

      case 'warning':
        return <Text color={theme.warning}>⚠️ {content}</Text>;

      case 'error':
        return <Text color={theme.error}>❌ {content}</Text>;

      case 'command':
        return (
          <CommandDisplay
            command={message.command ?? ''}
            output={message.output}
            status={message.toolStatus}
          />
        );

      case 'file_edit':
        return (
          <FileEditDisplay
            filePath={message.filePath ?? ''}
            diff={message.diff}
            action={message.fileAction}
          />
        );

      case 'thinking':
        return <ThinkingDisplay label={content || 'Thinking...'} />;

      case 'todo':
        return <TodoListDisplay items={message.todoItems ?? []} />;

      case 'build_result':
        return (
          <BuildResultDisplay
            label={message.toolName ?? 'Build'}
            output={message.output ?? ''}
            success={message.buildSuccess ?? false}
            duration={message.buildDuration}
          />
        );

      case 'orchestration':
        return (
          <OrchestrationDisplay
            title={content || 'Plan'}
            steps={message.orchestrationSteps ?? []}
          />
        );

      case 'text':
      default: {
        // Regular assistant text
        if (!content) {
          return null;
        }
        // Wrap long lines similar to ChatView
        const lines = content.split('\n');
        return (
          <Box flexDirection="column">
            {lines.map((line, i) => (
              <Text key={`${message.id}-line-${String(i)}`}>
                {i === 0 ? '' : '  '}
                {line}
              </Text>
            ))}
          </Box>
        );
      }
    }
  };

  // Check if it's an AgentDisplay type (these have their own borders)
  const isAgentDisplayType = [
    'command',
    'file_edit',
    'thinking',
    'todo',
    'build_result',
    'orchestration',
  ].includes(type || '');

  // If it's an AgentDisplay type, render directly with padding but NO extra border
  if (isAgentDisplayType) {
    return <Box paddingX={1}>{renderContent()}</Box>;
  }

  // Determine border color based on role and type
  let borderColor: string = theme.primary; // default: assistant orange
  if (role === 'user') borderColor = theme.secondary;
  else if (role === 'system') borderColor = theme.muted;

  if (type === 'error') borderColor = theme.error;
  else if (type === 'warning') borderColor = theme.warning;

  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={borderColor}
      paddingLeft={1}
      flexDirection="column"
    >
      {renderContent()}
    </Box>
  );
}
