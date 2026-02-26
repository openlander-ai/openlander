import type { JSX } from 'solid-js';
import { createSignal, Show, For } from 'solid-js';
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
      <text fg={theme.textMuted}>
        <Spinner color={theme.textMuted} />
      </text>
      <text fg={theme.textMuted} dim={true}>
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
  const [collapsed, setCollapsed] = createSignal(false);
  const outputLines = () => props.output?.split('\n') ?? [];
  const truncated = () => outputLines().length > MAX_OUTPUT_LINES;
  const visibleLines = () =>
    truncated() ? outputLines().slice(0, MAX_OUTPUT_LINES) : outputLines();
  const hasOutput = () => Boolean(props.output) && outputLines().length > 0;

  return (
    <box
      {...SplitBorder}
      borderColor={theme.border}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span style={{ fg: theme.textMuted }}>$ </span>
        <b>Bash</b>
      </text>
      <text>
        {'  '}
        <span style={{ fg: theme.secondary }}>$ </span>
        <span style={{ fg: theme.text }}>{props.command}</span>
      </text>
      <Show when={props.output || props.status === 'running'}>
        <>
          <Show
            when={props.status === 'running'}
            fallback={
              <>
                <Show
                  when={!collapsed()}
                  fallback={
                    <text fg={theme.textDim} onClick={() => setCollapsed(false)}>
                      {'  '}
                      <span style={{ fg: theme.textMuted }}>▸</span> {String(outputLines().length)}{' '}
                      lines hidden
                    </text>
                  }
                >
                  <For each={visibleLines()}>
                    {(line) => (
                      <text
                        fg={props.status === 'error' ? theme.error : theme.textMuted}
                        dim={props.status !== 'error'}
                      >
                        {'  '}
                        {line}
                      </text>
                    )}
                  </For>
                </Show>
                <Show when={truncated() && !collapsed()}>
                  <text fg={theme.textDim}>
                    {'  '}… ({String(outputLines().length - MAX_OUTPUT_LINES)} more lines)
                  </text>
                </Show>
                <Show when={hasOutput() && props.status !== 'running'}>
                  <text fg={theme.textDim} onClick={() => setCollapsed(!collapsed())}>
                    {'  '}
                    <span style={{ fg: theme.textMuted }}>{collapsed() ? '▸' : '▾'}</span>
                    {collapsed() ? ' Show output' : ' Hide output'}
                  </text>
                </Show>
              </>
            }
          >
            <box paddingLeft={2} flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>
                <Spinner color={theme.textMuted} />
              </text>
              <text fg={theme.textMuted}>Running…</text>
            </box>
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
  const [collapsed, setCollapsed] = createSignal(false);
  const action = () => props.action ?? 'edit';
  const actionLabel = () =>
    action() === 'create' ? 'Create' : action() === 'delete' ? 'Delete' : 'Edit';
  const actionIcon = () => (action() === 'create' ? '←' : action() === 'delete' ? '✗' : '←');
  const diffLines = () => props.diff?.split('\n') ?? [];
  const truncated = () => diffLines().length > MAX_DIFF_LINES;
  const visibleLines = () => (truncated() ? diffLines().slice(0, MAX_DIFF_LINES) : diffLines());
  const hasDiff = () => diffLines().length > 0;

  return (
    <box
      {...SplitBorder}
      borderColor={theme.border}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span style={{ fg: theme.textMuted }}>{actionIcon()} </span>
        <b>{actionLabel()}</b>
        <span style={{ fg: theme.secondary }}> {props.filePath}</span>
      </text>
      <Show
        when={!collapsed()}
        fallback={
          <Show when={hasDiff()}>
            <text fg={theme.textDim} onClick={() => setCollapsed(false)}>
              {'  '}
              <span style={{ fg: theme.textMuted }}>▸</span> {String(diffLines().length)} lines
              hidden
            </text>
          </Show>
        }
      >
        <For each={visibleLines()}>
          {(line) => {
            let color: string | undefined;
            if (line.startsWith('+')) color = theme.diffAdded;
            else if (line.startsWith('-')) color = theme.diffRemoved;
            return (
              <text fg={color} dim={!color}>
                {'  '}
                {line}
              </text>
            );
          }}
        </For>
      </Show>
      <Show when={truncated() && !collapsed()}>
        <text fg={theme.textDim}>
          {'  '}… ({String(diffLines().length - MAX_DIFF_LINES)} more lines)
        </text>
      </Show>
      <Show when={hasDiff()}>
        <text fg={theme.textDim} onClick={() => setCollapsed(!collapsed())}>
          {'  '}
          <span style={{ fg: theme.textMuted }}>{collapsed() ? '▸' : '▾'}</span>
          {collapsed() ? ' Show diff' : ' Hide diff'}
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
      <text bold={true} fg={theme.text}>
        Tasks
      </text>
      <For each={props.items}>
        {(item) => {
          if (item.status === 'completed') {
            return (
              <text>
                {'  '}
                <span style={{ fg: theme.success }}>▣</span>
                <span style={{ fg: theme.text }}> {item.content}</span>
              </text>
            );
          }
          if (item.status === 'in_progress') {
            return (
              <box paddingLeft={2} flexDirection="row" gap={1}>
                <text fg={theme.primary}>
                  <Spinner color={theme.primary} />
                </text>
                <text bold={true} fg={theme.text}>
                  {item.content}
                </text>
              </box>
            );
          }
          return (
            <text fg={theme.textMuted}>
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
  const [collapsed, setCollapsed] = createSignal(false);
  const borderColor = () => (props.success ? theme.success : theme.error);
  const statusIcon = () => (props.success ? '▣' : '✗');
  const statusText = () => (props.success ? 'success' : 'failed');
  const durationText = () => (props.duration ? ` (${props.duration})` : '');
  const outputLines = () => props.output.split('\n');
  const truncated = () => outputLines().length > MAX_BUILD_LINES;
  const visibleLines = () =>
    truncated() ? outputLines().slice(0, MAX_BUILD_LINES) : outputLines();
  const hasOutput = () => outputLines().length > 0 && props.output.trim().length > 0;

  return (
    <box
      {...SplitBorder}
      borderColor={borderColor()}
      paddingLeft={2}
      marginTop={1}
      flexDirection="column"
    >
      <text>
        <span style={{ fg: props.success ? theme.success : theme.error }}>{statusIcon()} </span>
        <b>{props.label}</b>
        <span style={{ fg: props.success ? theme.success : theme.error }}>
          {' '}
          {statusText()}
          {durationText()}
        </span>
      </text>
      <Show
        when={!collapsed()}
        fallback={
          <Show when={hasOutput()}>
            <text fg={theme.textDim} onClick={() => setCollapsed(false)}>
              {'  '}
              <span style={{ fg: theme.textMuted }}>▸</span> {String(outputLines().length)} lines
              hidden
            </text>
          </Show>
        }
      >
        <For each={visibleLines()}>
          {(line) => (
            <text dim={true} fg={theme.textMuted}>
              {'  '}
              {line}
            </text>
          )}
        </For>
      </Show>
      <Show when={truncated() && !collapsed()}>
        <text fg={theme.textDim}>
          {'  '}… ({String(outputLines().length - MAX_BUILD_LINES)} more lines)
        </text>
      </Show>
      <Show when={hasOutput()}>
        <text fg={theme.textDim} onClick={() => setCollapsed(!collapsed())}>
          {'  '}
          <span style={{ fg: theme.textMuted }}>{collapsed() ? '▸' : '▾'}</span>
          {collapsed() ? ' Show output' : ' Hide output'}
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
      <text bold={true} fg={theme.text}>
        {props.title}
      </text>
      <For each={props.steps}>
        {(step, i) => (
          <text fg={theme.text}>
            {'  '}
            <span style={{ fg: theme.textMuted }}>{String(i() + 1)}.</span> {step}
          </text>
        )}
      </For>
    </box>
  );
}
