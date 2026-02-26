import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
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
  /** IPC client for daemon communication */
  client: OpenLanderClient | null;
  /** Height of the panel in terminal rows */
  height: number;
  /** Whether the panel has focus for keyboard input */
  focus: boolean;
  /** Callback when a slash command produces a modal action */
  onModal?: (modal: 'help') => void;
  /** Callback when clear command is issued */
  onClear?: () => void;
  /** Callback when exit command is issued */
  onExit?: () => void;
  /** Callback for slash command result actions */
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
const INPUT_HEIGHT = 3; // Height reserved for input area

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Unified chat panel combining message display and input.
 */
export function ChatPanel({
  client,
  height,
  focus,
  onModal,
  onClear,
  onExit,
  onCommandResult,
}: ChatPanelProps): JSX.Element {
  // --- Chat state ---
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');
  let sessionIdRef = `tui-${Date.now().toString(36)}`;

  // --- Chat history for ↑/↓ navigation ---
  const [chatHistory, setChatHistory] = createSignal<ChatHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = createSignal(-1);
  let historyRef = ''; // Temp storage when navigating history

  // --- Slash command autocomplete ---
  const [showCommandPicker, setShowCommandPicker] = createSignal(false);
  const [commandPickerIndex, setCommandPickerIndex] = createSignal(0);

  // --- Streaming state ---
  let currentAssistantMessageRef: DisplayMessage | null = null;

  // Calculate heights
  const messageAreaHeight = Math.max(5, height - INPUT_HEIGHT);

  // --- Auto-scroll offset ---
  const [, setScrollOffset] = createSignal(0);
  let messagesEndRef = 0;

  // Update scroll offset when messages change
  createEffect(() => {
    const totalLines = calculateMessageLines(messages());
    const maxOffset = Math.max(0, totalLines - messageAreaHeight);
    setScrollOffset(maxOffset);
    messagesEndRef = totalLines;
  });

  // --- Handle slash command picker visibility ---
  createEffect(() => {
    const val = inputValue();
    const isSlashInput = val.startsWith('/') && !val.includes(' ');
    setShowCommandPicker(isSlashInput && focus);
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
        const baseMsg: Partial<DisplayMessage> = {
          toolName: event.toolName,
        };

        if (
          event.toolName === 'execute_command' ||
          event.toolName === 'bash' ||
          event.toolName === 'run_command'
        ) {
          messageType = 'command';
          baseMsg.command = args.command ?? args.cmd ?? '';
          baseMsg.toolStatus = 'running';
        } else if (
          event.toolName === 'edit_file' ||
          event.toolName === 'write_file' ||
          event.toolName === 'create_file' ||
          event.toolName === 'delete_file'
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
                if (typeof event.result === 'string') {
                  updates.diff = event.result;
                }
              } else {
                updates.type = 'tool_result';
              }

              updated[lastToolIdx] = {
                ...item,
                ...updates,
              };
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
        currentAssistantMessageRef = null;
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

    const userMessage: DisplayMessage = {
      id: `user-${String(Date.now())}`,
      role: 'user',
      content: text,
      type: 'text',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    setChatHistory((prev) => {
      const newHistory = [...prev, { text, timestamp: Date.now() }].slice(-MAX_HISTORY_ENTRIES);
      return newHistory;
    });
    setHistoryIndex(-1);

    if (text.startsWith('/')) {
      const parsed = parseSlashCommand(text);
      if (parsed) {
        const result = parsed.command.handler(parsed.args);
        onCommandResult?.(result);

        switch (result.action) {
          case 'modal':
            onModal?.(result.modal);
            break;
          case 'clear':
            setMessages([]);
            onClear?.();
            break;
          case 'exit':
            onExit?.();
            break;
          case 'agent':
            if (client) {
              setIsStreaming(true);
              try {
                await client.chatStream(result.message, sessionIdRef, handleStreamEvent);
              } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `error-${String(Date.now())}`,
                    role: 'assistant',
                    content: errorMsg,
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

    if (!client) {
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
    try {
      await client.chatStream(text, sessionIdRef, handleStreamEvent);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${String(Date.now())}`,
          role: 'assistant',
          content: errorMsg,
          type: 'error',
          timestamp: Date.now(),
        },
      ]);
      setIsStreaming(false);
    }
  };

  // --- Handle input submit ---
  const handleSubmit = (text: string) => {
    if (!text.trim()) return;

    if (showCommandPicker()) {
      const matchCount = getMatchCount(text);
      if (matchCount > 0) {
        const commandName = getMatchAt(text, commandPickerIndex());
        if (commandName) {
          const completed = `/${commandName}`;
          setInputValue('');
          setShowCommandPicker(false);
          void sendMessage(completed);
          return;
        }
      }
    }

    setInputValue('');
    setShowCommandPicker(false);
    void sendMessage(text);
  };

  // --- Handle Tab completion for slash commands ---
  const handleTabComplete = () => {
    if (showCommandPicker()) {
      const commandName = getMatchAt(inputValue(), commandPickerIndex());
      if (commandName) {
        setInputValue(`/${commandName} `);
        setShowCommandPicker(false);
      }
    }
  };

  // --- Keyboard handling ---
  useKeyboard((evt) => {
    if (!focus) return;

    // Tab for autocomplete
    if (evt.key === 'tab' && showCommandPicker()) {
      handleTabComplete();
      return;
    }
    // Ctrl+L to clear
    if (evt.ctrl && evt.char === 'l') {
      setMessages([]);
      onClear?.();
      return;
    }

    // Up arrow - history navigation or command picker
    if (evt.key === 'up') {
      if (showCommandPicker()) {
        setCommandPickerIndex((i) => Math.max(0, i - 1));
      } else if (chatHistory().length > 0) {
        if (historyIndex() === -1) {
          historyRef = inputValue();
        }
        const newIndex = Math.min(chatHistory().length - 1, historyIndex() + 1);
        setHistoryIndex(newIndex);
        const historyEntry = chatHistory()[chatHistory().length - 1 - newIndex];
        if (historyEntry) {
          setInputValue(historyEntry.text);
        }
      }
      return;
    }

    // Down arrow - history navigation or command picker
    if (evt.key === 'down') {
      if (showCommandPicker()) {
        const matchCount = getMatchCount(inputValue());
        setCommandPickerIndex((i) => Math.min(matchCount - 1, i + 1));
      } else if (historyIndex() > 0) {
        const newIndex = historyIndex() - 1;
        setHistoryIndex(newIndex);
        const historyEntry = chatHistory()[chatHistory().length - 1 - newIndex];
        if (historyEntry) {
          setInputValue(historyEntry.text);
        }
      } else if (historyIndex() === 0) {
        setHistoryIndex(-1);
        setInputValue(historyRef);
      }
      return;
    }
  });

  // --- Render ---
  return (
    <box flexDirection="column" height={height}>
      {/* Message area */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <Show
          when={messages().length > 0 || isStreaming()}
          fallback={
            // Welcome message
            <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
              <text color={theme.primary} bold={true}>
                {'  ___                   _                    _           '}
              </text>
              <text color={theme.primary} bold={true}>
                {' / _ \\ _ __   ___ _ __ | |    __ _ _ __   __| | ___ _ __ '}
              </text>
              <text color={theme.primary} bold={true}>
                {"| | | | '_ \\ / _ \\ '_ \\| |   / _` | '_ \\ / _` |/ _ \\ '__|"}
              </text>
              <text color={theme.primary} bold={true}>
                {'| |_| | |_) |  __/ | | | |__| (_| | | | | (_| |  __/ |   '}
              </text>
              <text color={theme.primary} bold={true}>
                {' \\___/| .__/ \\___|_| |_|_____\\__,_|_| |_|\\__,_|\\___|_|   '}
              </text>
              <text color={theme.primary} bold={true}>
                {'      |_|                                                  '}
              </text>
              <text> </text>
              <text dim={true}>v0.1.0</text>
              <text> </text>
              {client ? (
                <>
                  <text dim={true}>Deploy anything with a chat. Type to get started.</text>
                  <text dim={true}>
                    Press <span color={theme.secondary}>/</span> for commands,{' '}
                    <span color={theme.secondary}>?</span> for help
                  </text>
                </>
              ) : (
                <text color={theme.warning}>
                  Daemon not connected. Run: <b>openlander daemon</b>
                </text>
              )}
            </box>
          }
        >
          {/* Message list */}
          <box flexDirection="column" flexGrow={1}>
            <For each={messages()}>{(msg) => <ChatMessage message={msg} />}</For>

            {/* Thinking indicator */}
            <Show when={isStreaming()}>
              <box paddingX={1} gap={1}>
                <text color={theme.primary}>
                  <Spinner color={theme.primary} />
                </text>
                <text color={theme.primary}>Thinking…</text>
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
      <box
        border="single"
        borderColor={theme.border}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        {!client ? (
          <text dim={true}>Chat unavailable — daemon not connected</text>
        ) : isStreaming() ? (
          <box gap={1}>
            <text color={theme.primary}>
              <Spinner color={theme.primary} />
            </text>
            <text dim={true}> Waiting for response...</text>
          </box>
        ) : (
          <box>
            <text color={theme.primary}>❯ </text>
            <TextInput
              value={inputValue()}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Ask the agent anything... (/help for commands)"
              showCursor={focus}
            />
          </box>
        )}
      </box>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate total lines needed to render messages */
function calculateMessageLines(messages: DisplayMessage[]): number {
  let lines = 0;
  for (const msg of messages) {
    lines += 1;
    if (msg.content) {
      const contentLines = msg.content.split('\n').length;
      lines += Math.ceil(contentLines * 0.5);
    }
    lines += 1;
  }
  return lines;
}
