import { createMemo, For, Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { ProgressBar } from './ProgressBar.js';
import { Spinner } from './Spinner.js';
import { theme, SplitBorder } from '../theme.js';
import { parseMarkdown } from '../markdown.js';
import type { MarkdownToken, InlineSpan } from '../markdown.js';
import { highlightCode } from '../syntax-highlight.js';
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
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error';
  toolDuration?: number;
  progress?: number;
  command?: string;
  output?: string;
  filePath?: string;
  diff?: string;
  fileAction?: 'edit' | 'create' | 'delete';
  todoItems?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  buildSuccess?: boolean;
  buildDuration?: string;
  orchestrationSteps?: string[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToolDescription(toolName: string): string {
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDuration(seconds: number): string {
  if (seconds < 1) return `${String(Math.round(seconds * 1000))}ms`;
  return `${seconds.toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ChatMessageProps {
  message: DisplayMessage;
  isFirst?: boolean;
}

export function ChatMessage(props: ChatMessageProps): JSX.Element {
  const role = () => props.message.role;
  const content = () => props.message.content;
  const type = () => props.message.type;
  const toolName = () => props.message.toolName;
  const toolStatus = () => props.message.toolStatus;
  const toolDuration = () => props.message.toolDuration;
  const progress = () => props.message.progress;

  // Memoize markdown parsing — only re-runs when content string actually changes
  const parsedTokens = createMemo(() => {
    const c = content();
    if (!c) return [];
    return parseMarkdown(c);
  });

  // AgentDisplay types render their own borders
  const isAgentDisplayType = () =>
    ['command', 'file_edit', 'thinking', 'todo', 'build_result', 'orchestration'].includes(
      type() || '',
    );

  if (isAgentDisplayType()) {
    return <box paddingLeft={1}>{renderAgentContent()}</box>;
  }

  // User messages — OpenCode style: left pipe border + background panel
  if (role() === 'user') {
    return (
      <box
        {...SplitBorder}
        borderColor={theme.secondary}
        marginTop={props.isFirst ? 0 : 1}
        flexShrink={0}
      >
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          backgroundColor={theme.backgroundPanel}
          flexShrink={0}
        >
          <text fg={theme.text}>{content()}</text>
        </box>
      </box>
    );
  }

  // System messages
  if (role() === 'system') {
    return (
      <box paddingLeft={3} marginTop={1}>
        <text fg={theme.textMuted} dim={true}>
          {content()}
        </text>
      </box>
    );
  }

  // Assistant messages by type
  return renderAssistantContent();

  function renderAgentContent(): JSX.Element {
    switch (type()) {
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
      default:
        return <></>;
    }
  }

  function renderAssistantContent(): JSX.Element {
    switch (type()) {
      case 'tool_start':
        return (
          <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>
              <Spinner color={theme.textMuted} />
            </text>
            <text fg={theme.textMuted}>
              {toolName() ? formatToolDescription(toolName() ?? '') : content()}
            </text>
          </box>
        );

      case 'tool_result': {
        if (toolStatus() === 'error') {
          return (
            <box paddingLeft={3} marginTop={1}>
              <text fg={theme.error}>
                <span style={{ fg: theme.error }}>✗ </span>
                <span>{toolName() ? formatToolDescription(toolName() ?? '') : content()}</span>
              </text>
            </box>
          );
        }
        const durationText =
          toolDuration() !== undefined ? ` (${formatDuration(toolDuration() ?? 0)})` : '';
        return (
          <box paddingLeft={3} marginTop={1}>
            <text fg={theme.success}>
              <span style={{ fg: theme.success }}>▣ </span>
              <span>
                {toolName() ? formatToolDescription(toolName() ?? '') : content()}
                {durationText}
              </span>
            </text>
          </box>
        );
      }

      case 'progress':
        return (
          <box paddingLeft={3} marginTop={1}>
            <ProgressBar percent={progress() ?? 0} label={content() || undefined} />
          </box>
        );

      case 'url':
        return (
          <box paddingLeft={3} marginTop={1}>
            <text fg={theme.info}>
              <u>{content()}</u>
            </text>
          </box>
        );

      case 'warning':
        return (
          <box paddingLeft={3} marginTop={1}>
            <text fg={theme.warning}>
              <span style={{ fg: theme.warning }}>△ </span>
              <span>{content()}</span>
            </text>
          </box>
        );

      case 'error':
        return (
          <box
            {...SplitBorder}
            borderColor={theme.error}
            marginTop={1}
            paddingLeft={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={theme.textMuted}>{content()}</text>
          </box>
        );

      case 'text':
      default: {
        if (!content()) return <></>;
        return (
          <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
            <MarkdownContent tokens={parsedTokens()} />
          </box>
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown Rendering Components
// ---------------------------------------------------------------------------

function InlineContent(props: { spans: InlineSpan[] }): JSX.Element {
  return (
    <box flexDirection="row" flexWrap="wrap">
      <For each={props.spans}>
        {(span) => {
          switch (span.type) {
            case 'bold':
              return (
                <text bold={true} fg={theme.text}>
                  {span.text}
                </text>
              );
            case 'code':
              return (
                <text fg={theme.accent} backgroundColor={theme.backgroundElement}>
                  {` ${span.text} `}
                </text>
              );
            case 'link':
              return (
                <text fg={theme.secondary} underline={true}>
                  {span.url}
                </text>
              );
            case 'text':
            default:
              return <text fg={theme.text}>{span.text}</text>;
          }
        }}
      </For>
    </box>
  );
}

function CodeBlock(props: { code: string; language: string }): JSX.Element {
  const highlighted = createMemo(() => highlightCode(props.code, props.language));
  return (
    <box
      marginTop={1}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundElement}
      flexDirection="column"
    >
      <Show when={props.language}>
        <text fg={theme.textDim} dim={true}>
          {props.language}
        </text>
      </Show>
      <box flexDirection="row" flexWrap="wrap">
        <For each={highlighted()}>{(span) => <text fg={span.color}>{span.text}</text>}</For>
      </box>
    </box>
  );
}

function MarkdownContent(props: { tokens: MarkdownToken[] }): JSX.Element {
  return (
    <For each={props.tokens}>
      {(token) => {
        switch (token.type) {
          case 'heading':
            return (
              <box marginTop={1}>
                <text
                  bold={true}
                  fg={
                    token.level === 1
                      ? theme.primary
                      : token.level === 2
                        ? theme.secondary
                        : theme.text
                  }
                >
                  {token.text}
                </text>
              </box>
            );
          case 'paragraph':
            return (
              <box marginTop={0}>
                <InlineContent spans={token.spans} />
              </box>
            );
          case 'code_block':
            return <CodeBlock code={token.code} language={token.language} />;
          case 'list_item':
            return (
              <box paddingLeft={2} flexDirection="row">
                <text fg={theme.textMuted}>
                  {token.ordered ? `${String(token.index)}. ` : '• '}
                </text>
                <InlineContent spans={token.spans} />
              </box>
            );
          case 'hr':
            return (
              <box marginTop={1} marginBottom={1}>
                <text fg={theme.borderSubtle}>{'─'.repeat(40)}</text>
              </box>
            );
          default:
            return <></>;
        }
      }}
    </For>
  );
}
