import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';

// ── 1. ThinkingDisplay ──────────────────────────────────────────

interface ThinkingDisplayProps {
  label?: string;
}

export function ThinkingDisplay({
  label = 'Thinking...',
}: ThinkingDisplayProps): React.ReactElement {
  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={theme.primary}
    >
      <Text color={theme.primary} bold>
        <Spinner type="dots" />
      </Text>
      <Text color={theme.primary} bold>
        {' '}
        {label}
      </Text>
    </Box>
  );
}

// ── 2. CommandDisplay ───────────────────────────────────────────

interface CommandDisplayProps {
  command: string;
  output?: string;
  status?: 'running' | 'success' | 'error';
}

const MAX_OUTPUT_LINES = 10;

export function CommandDisplay({
  command,
  output,
  status,
}: CommandDisplayProps): React.ReactElement {
  const outputLines = output?.split('\n') ?? [];
  const truncated = outputLines.length > MAX_OUTPUT_LINES;
  const visibleLines = truncated ? outputLines.slice(0, MAX_OUTPUT_LINES) : outputLines;

  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={theme.toolBorder}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.muted}>{' └ '}</Text>
        <Text bold>Bash</Text>
      </Text>
      <Text>
        {'  '}
        <Text color={theme.secondary}>$ </Text>
        <Text color={theme.text}>{command}</Text>
      </Text>
      {(output || status === 'running') && (
        <>
          <Text color={theme.muted}>{'  ────────────────────'}</Text>
          {status === 'running' ? (
            <Text>
              {'  '}
              <Text color={theme.primary}>
                <Spinner type="dots" />
              </Text>
              <Text color={theme.muted}> Running...</Text>
            </Text>
          ) : (
            visibleLines.map((line, i) => (
              <Text
                key={`cmd-${String(i)}`}
                color={status === 'error' ? theme.error : undefined}
                dimColor={status !== 'error'}
              >
                {'  '}
                {line}
              </Text>
            ))
          )}
          {truncated && (
            <Text color={theme.muted}>
              {'  '}... ({String(outputLines.length - MAX_OUTPUT_LINES)} more lines)
            </Text>
          )}
        </>
      )}
    </Box>
  );
}

// ── 3. FileEditDisplay ──────────────────────────────────────────

interface FileEditDisplayProps {
  filePath: string;
  diff?: string;
  action?: 'edit' | 'create' | 'delete';
}

const MAX_DIFF_LINES = 15;

export function FileEditDisplay({
  filePath,
  diff,
  action = 'edit',
}: FileEditDisplayProps): React.ReactElement {
  const actionLabel = action === 'create' ? 'Create' : action === 'delete' ? 'Delete' : 'Edit';
  const diffLines = diff?.split('\n') ?? [];
  const truncated = diffLines.length > MAX_DIFF_LINES;
  const visibleLines = truncated ? diffLines.slice(0, MAX_DIFF_LINES) : diffLines;

  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={theme.toolBorder}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.muted}>{' └ '}</Text>
        <Text bold>{actionLabel}</Text>
        <Text color={theme.secondary}>: {filePath}</Text>
      </Text>
      {visibleLines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith('+')) color = theme.success;
        else if (line.startsWith('-')) color = theme.error;
        return (
          <Text key={`diff-${String(i)}`} color={color} dimColor={!color}>
            {'  '}
            {line}
          </Text>
        );
      })}
      {truncated && (
        <Text color={theme.muted}>
          {'  '}... ({String(diffLines.length - MAX_DIFF_LINES)} more lines)
        </Text>
      )}
    </Box>
  );
}

// ── 4. TodoListDisplay ──────────────────────────────────────────

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListDisplayProps {
  items: TodoItem[];
}

export function TodoListDisplay({ items }: TodoListDisplayProps): React.ReactElement {
  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={theme.primary}
      flexDirection="column"
    >
      <Text bold>Tasks</Text>
      {items.map((item, i) => {
        if (item.status === 'completed') {
          return (
            <Text key={`todo-${String(i)}`}>
              {'  '}
              <Text color={theme.success}>✓</Text> {item.content}
            </Text>
          );
        }
        if (item.status === 'in_progress') {
          return (
            <Text key={`todo-${String(i)}`}>
              {'  '}
              <Text color={theme.primary}>
                <Spinner type="dots" />
              </Text>{' '}
              <Text bold>{item.content}</Text>
            </Text>
          );
        }
        return (
          <Text key={`todo-${String(i)}`} color={theme.muted}>
            {'  '}○ {item.content}
          </Text>
        );
      })}
    </Box>
  );
}

// ── 5. BuildResultDisplay ───────────────────────────────────────

interface BuildResultDisplayProps {
  label: string;
  output: string;
  success: boolean;
  duration?: string;
}

const MAX_BUILD_LINES = 8;

export function BuildResultDisplay({
  label,
  output,
  success,
  duration,
}: BuildResultDisplayProps): React.ReactElement {
  const borderColor = success ? theme.success : theme.error;
  const statusText = success ? 'success' : 'failed';
  const durationText = duration ? ` (${duration})` : '';
  const outputLines = output.split('\n');
  const truncated = outputLines.length > MAX_BUILD_LINES;
  const visibleLines = truncated ? outputLines.slice(0, MAX_BUILD_LINES) : outputLines;

  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={borderColor}
      flexDirection="column"
    >
      <Text>
        <Text color={theme.muted}>{' └ '}</Text>
        <Text bold>{label}</Text>
        <Text color={success ? theme.success : theme.error}>
          : {statusText}
          {durationText}
        </Text>
      </Text>
      {visibleLines.map((line, i) => (
        <Text key={`build-${String(i)}`} dimColor>
          {'  '}
          {line}
        </Text>
      ))}
      {truncated && (
        <Text color={theme.muted}>
          {'  '}... ({String(outputLines.length - MAX_BUILD_LINES)} more lines)
        </Text>
      )}
    </Box>
  );
}

// ── 6. OrchestrationDisplay ─────────────────────────────────────

interface OrchestrationDisplayProps {
  title: string;
  steps: string[];
}

export function OrchestrationDisplay({
  title,
  steps,
}: OrchestrationDisplayProps): React.ReactElement {
  return (
    <Box
      borderStyle="bold"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor={theme.primary}
      flexDirection="column"
    >
      <Text bold>{title}</Text>
      {steps.map((step, i) => (
        <Text key={`step-${String(i)}`}>
          {'  '}
          {String(i + 1)}. {step}
        </Text>
      ))}
    </Box>
  );
}
