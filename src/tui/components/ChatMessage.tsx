import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from './ProgressBar.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Message type for specialized rendering */
  type?: 'text' | 'tool_start' | 'tool_result' | 'url' | 'warning' | 'error' | 'progress';
  /** Tool name for tool_start/tool_result types */
  toolName?: string;
  /** Tool execution status */
  toolStatus?: 'running' | 'success' | 'error';
  /** Tool execution duration in seconds */
  toolDuration?: number;
  /** Progress percentage (0-100) for progress type */
  progress?: number;
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
    return `${Math.round(seconds * 1000)}ms`;
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

  // User messages
  if (role === 'user') {
    return (
      <Box paddingX={1}>
        <Text bold color={theme.user}>
          {'You: '}
        </Text>
        <Text color={theme.user}>{content}</Text>
      </Box>
    );
  }

  // System messages
  if (role === 'system') {
    return (
      <Box paddingX={1}>
        <Text dimColor>{content}</Text>
      </Box>
    );
  }

  // Assistant messages - render based on type
  switch (type) {
    case 'tool_start':
      return (
        <Box paddingX={1}>
          <Text color={theme.progress}>
            🔄 {toolName ? formatToolDescription(toolName) : content} 중...
          </Text>
        </Box>
      );

    case 'tool_result':
      if (toolStatus === 'error') {
        return (
          <Box paddingX={1}>
            <Text color={theme.error}>
              ❌ {toolName ? formatToolDescription(toolName) : content} 실패
            </Text>
          </Box>
        );
      }
      // Success
      const durationText = toolDuration !== undefined ? ` (${formatDuration(toolDuration)})` : '';
      return (
        <Box paddingX={1}>
          <Text color={theme.success}>
            ✅ {toolName ? formatToolDescription(toolName) : content} 완료{durationText}
          </Text>
        </Box>
      );

    case 'progress':
      return (
        <Box paddingX={1}>
          <ProgressBar percent={progress ?? 0} label={content || undefined} />
        </Box>
      );

    case 'url':
      return (
        <Box paddingX={1}>
          <Text color={theme.url} underline>
            {content}
          </Text>
        </Box>
      );

    case 'warning':
      return (
        <Box paddingX={1}>
          <Text color={theme.warning}>⚠️ {content}</Text>
        </Box>
      );

    case 'error':
      return (
        <Box paddingX={1}>
          <Text color={theme.error}>❌ {content}</Text>
        </Box>
      );

    case 'text':
    default:
      // Regular assistant text
      if (!content) {
        return <Box />;
      }
      // Wrap long lines similar to ChatView
      const lines = content.split('\n');
      return (
        <Box flexDirection="column" paddingX={1}>
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
