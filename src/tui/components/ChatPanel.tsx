import { createSignal, createEffect, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import TextInput from './IMETextInput.js';
import { Spinner } from './Spinner.js';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { ChatStreamEvent } from '../../agent/index.js';
import { ChatMessage, type DisplayMessage } from './ChatMessage.js';
import { SlashCommandPicker, getMatchCount, getMatchAt } from './SlashCommandPicker.js';
import { parseSlashCommand, type SlashCommandResult } from '../commands/registry.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  onModal?: (modal: 'help') => void;
  onClear?: () => void;
  onExit?: () => void;
  onCommandResult?: (result: SlashCommandResult) => void;
}

interface ChatHistoryEntry {
  text: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 100;
const INPUT_HEIGHT = 3;

// ASCII art logo
const LOGO_LINES = [
  '  ___                   _                    _           ',
  ' / _ \\ _ __   ___ _ __ | |    __ _ _ __   __| | ___ _ __ ',
  "| | | | '_ \\ / _ \\ '_ \\| |   / _` | '_ \\ / _` |/ _ \\ '__|",
  '| |_| | |_) |  __/ | | | |__| (_| | | | | (_| |  __/ |   ',
  ' \\___/| .__/ \\___|_| |_|_____\\__,_|_| |_|\\__,_|\\___|_|   ',
  '      |_|                                                  ',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatPanel(props: ChatPanelProps): JSX.Element {
  const client = () => props.client;
  const height = () => props.height;
  const focus = () => props.focus;

  // --- Chat state ---
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  let sessionIdRef = `tui-${Date.now().toString(36)}`;

  // --- Chat history for up/down navigation ---
  const [chatHistory, setChatHistory] = createSignal<ChatHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  let historyRef = '';

  // --- Slash command autocomplete ---
  const [showCommandPicker, setShowCommandPicker] = createSignal(false);
  const [commandPickerIndex, setCommandPickerIndex] = createSignal(0);

  // --- Auto-scroll ---
  const messageAreaHeight = () => Math.max(0, height() - INPUT_HEIGHT);
  const [, setScrollOffset] = createSignal(0);

  createEffect(() => {
    const totalLines = calculateMessageLines(messages());
    const maxOffset = Math.max(0, totalLines - messageAreaHeight());
    setScrollOffset(maxOffset);
  });

  createEffect(() => {
    const val = inputValue();
    const isSlashInput = val.startsWith('/') && !val.includes(' ');
    setShowCommandPicker(isSlashInput && focus());
    if (isSlashInput) {
      setCommandPickerIndex(0);
    }
  });

  // --- Handle chat stream events ---
  const handleStreamEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'session':
        sessionIdRef = event.sessionId;
        break;
      case 'thinking':
        setIsStreaming(true);
        break;
      case 'tool_call': {
        const args = event.arguments as Record<string, string>;
        let messageType: DisplayMessage['type'] = 'tool_start';
        const baseMsg: Partial<DisplayMessage> = { toolName: event.toolName };

        if (['execute_command', 'bash', 'run_command'].includes(event.toolName)) {
          messageType = 'command';
          baseMsg.command = args.command ?? args.cmd ?? '';
          baseMsg.toolStatus = 'running';
        } else if (
          ['edit_file', 'write_file', 'create_file', 'delete_file'].includes(event.toolName)
        ) {
          messageType = 'file_edit';
          baseMsg.filePath = args.path ?? args.file ?? args.filePath ?? '';
          baseMsg.fileAction =
            event.toolName === 'create_file'
              ? 'create'
              : event.toolName === 'delete_file'
                ? 'delete'
                : 'edit';
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `tool-${String(Date.now())}`,
            role: 'assistant',
            content: '',
            type: messageType,
            timestamp: Date.now(),
            ...baseMsg,
          },
        ]);
        break;
      }
      case 'tool_result':
        setMessages((prev) => {
          const updated = [...prev];
          const lastToolIdx = updated.findIndex(
            (m) =>
              (m.type === 'tool_start' || m.type === 'command' || m.type === 'file_edit') &&
              m.toolName === event.toolName,
          );
          if (lastToolIdx !== -1) {
            const item = updated[lastToolIdx];
            if (item) {
              const updates: Partial<DisplayMessage> = {
                toolStatus: event.success ? 'success' : 'error',
                toolDuration: event.success ? 0 : undefined,
                content: event.error ?? '',
              };
              if (item.type === 'command') {
                updates.output =
                  typeof event.result === 'string'
                    ? event.result
                    : JSON.stringify(event.result, null, 2);
              } else if (item.type === 'file_edit') {
                if (typeof event.result === 'string') updates.diff = event.result;
              } else {
                updates.type = 'tool_result';
              }
              updated[lastToolIdx] = { ...item, ...updates };
            }
          }
          return updated;
        });
        break;
      case 'message':
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${String(Date.now())}`,
            role: 'assistant',
            content: event.content,
            type: 'text',
            timestamp: Date.now(),
          },
        ]);
        break;
      case 'error':
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${String(Date.now())}`,
            role: 'assistant',
            content: event.error,
            type: 'error',
            timestamp: Date.now(),
          },
        ]);
        break;
      case 'done':
        setIsStreaming(false);
        break;
    }
  };

  // --- Send message function ---
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `user-${String(Date.now())}`,
        role: 'user',
        content: text,
        type: 'text',
        timestamp: Date.now(),
      },
    ]);

    setChatHistory((prev) =>
      [...prev, { text, timestamp: Date.now() }].slice(-MAX_HISTORY_ENTRIES),
    );
    setHistoryIndex(-1);

    if (text.startsWith('/')) {
      const parsed = parseSlashCommand(text);
      if (parsed) {
        const result = parsed.command.handler(parsed.args);
        props.onCommandResult?.(result);
        switch (result.action) {
          case 'modal':
            props.onModal?.(result.modal);
            break;
          case 'clear':
            setMessages([]);
            props.onClear?.();
            break;
          case 'exit':
            props.onExit?.();
            break;
          case 'agent':
            if (client()) {
              const c = client();
              if (!c) return;
              setIsStreaming(true);
              try {
                await c.chatStream(result.message, sessionIdRef, handleStreamEvent);
              } catch (err) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${String(Date.now())}`,
                    role: 'assistant',
                    content: err instanceof Error ? err.message : String(err),
                    type: 'error',
                    timestamp: Date.now(),
                  },
                ]);
                setIsStreaming(false);
              }
            }
            break;
          case 'toggle-sidebar':
            break;
        }
        return;
      }
    }

    if (!client()) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${String(Date.now())}`,
          role: 'assistant',
          content: 'Daemon not connected. Start with: openlander daemon',
          type: 'error',
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    setIsStreaming(true);
    const c = client();
    if (!c) return;
    try {
      await c.chatStream(text, sessionIdRef, handleStreamEvent);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${String(Date.now())}`,
          role: 'assistant',
          content: err instanceof Error ? err.message : String(err),
          type: 'error',
          timestamp: Date.now(),
        },
      ]);
      setIsStreaming(false);
    }
  };

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    if (showCommandPicker()) {
      const matchCount = getMatchCount(text);
      if (matchCount > 0) {
        const commandName = getMatchAt(text, commandPickerIndex());
        if (commandName) {
          setInputValue('');
          setShowCommandPicker(false);
          void sendMessage(`/${commandName}`);
          return;
        }
      }
    }
    setInputValue('');
    setShowCommandPicker(false);
    void sendMessage(text);
  };

  const handleTabComplete = () => {
    if (showCommandPicker()) {
      const commandName = getMatchAt(inputValue(), commandPickerIndex());
      if (commandName) {
        setInputValue(`/${commandName} `);
        setShowCommandPicker(false);
      }
    }
  };

  useKeyboard((evt) => {
    if (!focus()) return;
    if (evt.key === 'tab' && showCommandPicker()) {
      handleTabComplete();
      return;
    }
    if (evt.ctrl && evt.char === 'l') {
      setMessages([]);
      props.onClear?.();
      return;
    }
    if (evt.key === 'up') {
      if (showCommandPicker()) {
        setCommandPickerIndex((i) => Math.max(0, i - 1));
      } else if (chatHistory().length > 0) {
        if (historyIndex() === -1) historyRef = inputValue();
        const newIndex = Math.min(chatHistory().length - 1, historyIndex() + 1);
        setHistoryIndex(newIndex);
        const entry = chatHistory()[chatHistory().length - 1 - newIndex];
        if (entry) setInputValue(entry.text);
      }
      return;
    }
    if (evt.key === 'down') {
      if (showCommandPicker()) {
        setCommandPickerIndex((i) => Math.min(getMatchCount(inputValue()) - 1, i + 1));
      } else if (historyIndex() > 0) {
        const newIndex = historyIndex() - 1;
        setHistoryIndex(newIndex);
        const entry = chatHistory()[chatHistory().length - 1 - newIndex];
        if (entry) setInputValue(entry.text);
      } else if (historyIndex() === 0) {
        setHistoryIndex(-1);
        setInputValue(historyRef);
      }
      return;
    }
  });

  return (
    <box flexDirection="column" height={height()}>
      {/* Message area */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <Show
          when={messages().length > 0 || isStreaming()}
          fallback={
            <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
              {/* Logo */}
              <For each={LOGO_LINES}>
                {(line) => (
                  <text color={theme.primary} bold={true}>
                    {line}
                  </text>
                )}
              </For>
              <text color={theme.textDim}> </text>
              <text color={theme.textMuted}>v0.1.0</text>
              <text color={theme.textDim}> </text>
              <Show
                when={client()}
                fallback={
                  <text color={theme.warning}>
                    Daemon not connected. Run: <b>openlander daemon</b>
                  </text>
                }
              >
                <text color={theme.textMuted}>
                  Deploy anything with a chat. Type to get started.
                </text>
                <text color={theme.textMuted}>
                  Press <span color={theme.secondary}>/</span> for commands,{' '}
                  <span color={theme.secondary}>?</span> for help
                </text>
              </Show>
            </box>
          }
        >
          <box flexDirection="column" flexGrow={1} paddingTop={1}>
            <For each={messages()}>
              {(msg, i) => <ChatMessage message={msg} isFirst={i() === 0} />}
            </For>

            {/* Streaming indicator */}
            <Show when={isStreaming()}>
              <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
                <text color={theme.textMuted}>
                  <Spinner color={theme.textMuted} />
                </text>
                <text color={theme.textMuted}>Thinking…</text>
              </box>
            </Show>
          </box>
        </Show>
      </box>

      {/* Slash command picker */}
      <Show when={showCommandPicker()}>
        <box>
          <SlashCommandPicker input={inputValue()} selectedIndex={commandPickerIndex()} />
        </box>
      </Show>

      {/* Input area */}
      <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
        <Show
          when={client()}
          fallback={<text color={theme.textDim}>Chat unavailable — daemon not connected</text>}
        >
          <Show
            when={!isStreaming()}
            fallback={
              <box flexDirection="row" gap={1}>
                <text color={theme.textMuted}>
                  <Spinner color={theme.textMuted} />
                </text>
                <text color={theme.textMuted}>Waiting for response...</text>
              </box>
            }
          >
            <box flexDirection="row">
              <text color={theme.primary}>❯ </text>
              <TextInput
                value={inputValue()}
                onChange={setInputValue}
                onSubmit={handleSubmit}
                placeholder="Ask the agent anything... (/help for commands)"
                showCursor={focus()}
              />
            </box>
          </Show>
        </Show>
      </box>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateMessageLines(messages: DisplayMessage[]): number {
  let lines = 0;
  for (const msg of messages) {
    lines += 1;
    if (msg.content) {
      lines += Math.ceil(msg.content.split('\n').length * 0.5);
    }
    lines += 1;
  }
  return lines;
}
