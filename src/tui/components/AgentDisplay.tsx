import type { JSX } from 'solid-js';
import { Show, For } from 'solid-js';
import { Spinner } from './Spinner.js';
import { theme, SplitBorder } from '../theme.js';

// ── 1. ThinkingDisplay ──────────────────────────────────────────

interface ThinkingDisplayProps {
  label?: string;
}

export function ThinkingDisplay(props: ThinkingDisplayProps): JSX.Element {
  const label = () => props.label ?? 'Thinking...';

  return (
    <box
      {...SplitBorder}
      borderColor={theme.borderSubtle}
      paddingLeft={2}
      marginTop={1}
      flexDirection="row"
      gap={1}
    >
      <text color={theme.textMuted}>
        <Spinner color={theme.textMuted} />
      </text>
      <text color={theme.textMuted} dim={true}>
        {label()}
      </text>
    </box>
  );
}

// ── 2. CommandDisplay ───────────────────────────────────────────

interface CommandDisplayProps {
  command: string;
  output?: string;
  status?: 'running' | 'success' | 'error';
}

const MAX_OUTPUT_LINES = 10;

export function CommandDisplay(props: CommandDisplayProps): JSX.Element {
  const outputLines = () => props.output?.split('\n') ?? [];
  const truncated = () => outputLines().length > MAX_OUTPUT_LINES;
  const visibleLines = () =>
    truncated() ? outputLines().slice(0, MAX_OUTPUT_LINES) : outputLines();

  return (
    <box
      {...SplitBorder}
      borderColor={theme.border}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span color={theme.textMuted}>⚙ </span>
        <b>Bash</b>
      </text>
      <text>
        {'  '}
        <span color={theme.secondary}>$ </span>
        <span color={theme.text}>{props.command}</span>
      </text>
      <Show when={props.output || props.status === 'running'}>
        <>
          <Show
            when={props.status === 'running'}
            fallback={
              <For each={visibleLines()}>
                {(line) => (
                  <text
                    color={props.status === 'error' ? theme.error : theme.textMuted}
                    dim={props.status !== 'error'}
                  >
                    {'  '}
                    {line}
                  </text>
                )}
              </For>
            }
          >
            <box paddingLeft={2} flexDirection="row" gap={1}>
              <text color={theme.textMuted}>
                <Spinner color={theme.textMuted} />
              </text>
              <text color={theme.textMuted}>Running...</text>
            </box>
          </Show>
          <Show when={truncated()}>
            <text color={theme.textDim}>
              {'  '}... ({String(outputLines().length - MAX_OUTPUT_LINES)} more lines)
            </text>
          </Show>
        </>
      </Show>
    </box>
  );
}

// ── 3. FileEditDisplay ──────────────────────────────────────────

interface FileEditDisplayProps {
  filePath: string;
  diff?: string;
  action?: 'edit' | 'create' | 'delete';
}

const MAX_DIFF_LINES = 15;

export function FileEditDisplay(props: FileEditDisplayProps): JSX.Element {
  const action = () => props.action ?? 'edit';
  const actionLabel = () =>
    action() === 'create' ? 'Create' : action() === 'delete' ? 'Delete' : 'Edit';
  const diffLines = () => props.diff?.split('\n') ?? [];
  const truncated = () => diffLines().length > MAX_DIFF_LINES;
  const visibleLines = () => (truncated() ? diffLines().slice(0, MAX_DIFF_LINES) : diffLines());

  return (
    <box
      {...SplitBorder}
      borderColor={theme.border}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span color={theme.textMuted}>⚙ </span>
        <b>{actionLabel()}</b>
        <span color={theme.secondary}> {props.filePath}</span>
      </text>
      <For each={visibleLines()}>
        {(line) => {
          let color: string | undefined;
          if (line.startsWith('+')) color = theme.diffAdded;
          else if (line.startsWith('-')) color = theme.diffRemoved;
          return (
            <text color={color} dim={!color}>
              {'  '}
              {line}
            </text>
          );
        }}
      </For>
      <Show when={truncated()}>
        <text color={theme.textDim}>
          {'  '}... ({String(diffLines().length - MAX_DIFF_LINES)} more lines)
        </text>
      </Show>
    </box>
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

export function TodoListDisplay(props: TodoListDisplayProps): JSX.Element {
  return (
    <box
      {...SplitBorder}
      borderColor={theme.primary}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text bold={true} color={theme.text}>
        Tasks
      </text>
      <For each={props.items}>
        {(item) => {
          if (item.status === 'completed') {
            return (
              <text>
                {'  '}
                <span color={theme.success}>✓</span>
                <span color={theme.text}> {item.content}</span>
              </text>
            );
          }
          if (item.status === 'in_progress') {
            return (
              <box paddingLeft={2} flexDirection="row" gap={1}>
                <text color={theme.primary}>
                  <Spinner color={theme.primary} />
                </text>
                <text bold={true} color={theme.text}>
                  {item.content}
                </text>
              </box>
            );
          }
          return (
            <text color={theme.textMuted}>
              {'  '}○ {item.content}
            </text>
          );
        }}
      </For>
    </box>
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

export function BuildResultDisplay(props: BuildResultDisplayProps): JSX.Element {
  const borderColor = () => (props.success ? theme.success : theme.error);
  const statusText = () => (props.success ? 'success' : 'failed');
  const durationText = () => (props.duration ? ` (${props.duration})` : '');
  const outputLines = () => props.output.split('\n');
  const truncated = () => outputLines().length > MAX_BUILD_LINES;
  const visibleLines = () =>
    truncated() ? outputLines().slice(0, MAX_BUILD_LINES) : outputLines();

  return (
    <box
      {...SplitBorder}
      borderColor={borderColor()}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span color={theme.textMuted}>⚙ </span>
        <b>{props.label}</b>
        <span color={props.success ? theme.success : theme.error}>
          {' '}
          {statusText()}
          {durationText()}
        </span>
      </text>
      <For each={visibleLines()}>
        {(line) => (
          <text dim={true} color={theme.textMuted}>
            {'  '}
            {line}
          </text>
        )}
      </For>
      <Show when={truncated()}>
        <text color={theme.textDim}>
          {'  '}... ({String(outputLines().length - MAX_BUILD_LINES)} more lines)
        </text>
      </Show>
    </box>
  );
}

// ── 6. OrchestrationDisplay ─────────────────────────────────────

interface OrchestrationDisplayProps {
  title: string;
  steps: string[];
}

export function OrchestrationDisplay(props: OrchestrationDisplayProps): JSX.Element {
  return (
    <box
      {...SplitBorder}
      borderColor={theme.primary}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text bold={true} color={theme.text}>
        {props.title}
      </text>
      <For each={props.steps}>
        {(step, i) => (
          <text color={theme.text}>
            {'  '}
            <span color={theme.textMuted}>{String(i() + 1)}.</span> {step}
          </text>
        )}
      </For>
    </box>
  );
}
