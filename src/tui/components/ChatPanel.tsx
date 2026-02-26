import { createSignal, createEffect, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { Prompt } from './Prompt.js';
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

/** Minimal interface for textarea renderable ref. */
interface TextareaRef {
  readonly plainText: string;
  clear(): void;
  setText(text: string): void;
  replaceText(text: string): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_ENTRIES = 100;
/** Estimated prompt height for scroll area calculation */
const PROMPT_ESTIMATED_HEIGHT = 7;
/** Lines from the bottom to consider "at bottom" for smart scroll */
const SCROLL_BOTTOM_THRESHOLD = 3;

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

  // --- Smart auto-scroll ---
  const messageAreaHeight = () => Math.max(0, height() - PROMPT_ESTIMATED_HEIGHT);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const [hasNewMessages, setHasNewMessages] = createSignal(false);
  let prevMessageCount = 0;

  // --- Textarea ref for external control (history, clear) ---
  let textareaRef: TextareaRef | null = null;

  const setTextareaRefCallback = (r: unknown) => {
    textareaRef = r as TextareaRef;
  };

  /** Clear textarea and reset input signal. */
  const clearTextarea = () => {
    textareaRef?.clear();
    setInputValue('');
  };

  /** Set textarea text (for history navigation) and sync signal. */
  const setTextareaText = (text: string) => {
    textareaRef?.replaceText(text);
    setInputValue(text);
  };

  // Smart scroll: only auto-scroll when user is at the bottom
  createEffect(() => {
    const msgs = messages();
    const totalLines = calculateMessageLines(msgs);
    const maxOffset = Math.max(0, totalLines - messageAreaHeight());

    if (msgs.length > prevMessageCount) {
      // New messages arrived
      if (isAtBottom()) {
        // User was at bottom → keep scrolling down
        setScrollOffset(maxOffset);
      } else {
        // User scrolled up → show "new messages" indicator
        setHasNewMessages(true);
      }
    } else if (isAtBottom()) {
      // Content changed (e.g., streaming update) and user is at bottom
      setScrollOffset(maxOffset);
    }

    prevMessageCount = msgs.length;
  });

  // Jump to bottom helper
  const scrollToBottom = () => {
    const totalLines = calculateMessageLines(messages());
    const maxOffset = Math.max(0, totalLines - messageAreaHeight());
    setScrollOffset(maxOffset);
    setIsAtBottom(true);
    setHasNewMessages(false);
  };

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

    // Auto-scroll to bottom when user sends a message
    scrollToBottom();

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

  // --- Submit handler (reads text from signal, clears textarea) ---
  const handleSubmit = () => {
    if (isStreaming()) return; // Prevent double-submit during streaming
    const text = inputValue();
    if (!text.trim()) {
      if (hasNewMessages()) {
        scrollToBottom();
      }
      return;
    }
    if (showCommandPicker()) {
      const matchCount = getMatchCount(text);
      if (matchCount > 0) {
        const commandName = getMatchAt(text, commandPickerIndex());
        if (commandName) {
          clearTextarea();
          setShowCommandPicker(false);
          void sendMessage(`/${commandName}`);
          return;
        }
      }
    }
    clearTextarea();
    setShowCommandPicker(false);
    void sendMessage(text);
  };

  // --- Content change handler (syncs textarea → signal) ---
  const handleContentChange = (text: string) => {
    setInputValue(text);
  };

  // --- Tab complete ---
  const handleTabComplete = () => {
    if (showCommandPicker()) {
      const commandName = getMatchAt(inputValue(), commandPickerIndex());
      if (commandName) {
        setTextareaText(`/${commandName} `);
        setShowCommandPicker(false);
      }
    }
  };

  // --- Textarea key down (history, tab complete, picker interaction) ---
  const handlePromptKeyDown = (event: unknown) => {
    const evt = event as {
      key?: string;
      name?: string;
      ctrl?: boolean;
      char?: string;
      preventDefault?: () => void;
    };
    const key = evt.key ?? evt.name ?? '';

    // ── When command picker is visible, intercept navigation keys ──
    if (showCommandPicker()) {
      // Enter/Return: select the highlighted command (prevent textarea submit!)
      if (key === 'enter' || key === 'return') {
        evt.preventDefault?.();
        const text = inputValue();
        const matchCount = getMatchCount(text);
        if (matchCount > 0) {
          const commandName = getMatchAt(text, commandPickerIndex());
          if (commandName) {
            clearTextarea();
            setShowCommandPicker(false);
            void sendMessage(`/${commandName}`);
          }
        }
        return;
      }

      // Escape: close picker without sending
      if (key === 'escape') {
        evt.preventDefault?.();
        clearTextarea();
        setShowCommandPicker(false);
        return;
      }

      // Tab: autocomplete selected command
      if (key === 'tab') {
        evt.preventDefault?.();
        handleTabComplete();
        return;
      }

      // Up: navigate picker
      if (key === 'up') {
        evt.preventDefault?.();
        setCommandPickerIndex((i) => Math.max(0, i - 1));
        return;
      }

      // Down: navigate picker
      if (key === 'down') {
        evt.preventDefault?.();
        setCommandPickerIndex((i) => Math.min(getMatchCount(inputValue()) - 1, i + 1));
        return;
      }
    }

    // ── Normal mode (no picker) ──

    // Up: history navigation (single-line only)
    if (key === 'up' && !inputValue().includes('\n') && chatHistory().length > 0) {
      if (historyIndex() === -1) historyRef = inputValue();
      const newIndex = Math.min(chatHistory().length - 1, historyIndex() + 1);
      setHistoryIndex(newIndex);
      const entry = chatHistory()[chatHistory().length - 1 - newIndex];
      if (entry) setTextareaText(entry.text);
      return;
    }

    // Down: history navigation (single-line only)
    if (key === 'down' && !inputValue().includes('\n')) {
      if (historyIndex() > 0) {
        const newIndex = historyIndex() - 1;
        setHistoryIndex(newIndex);
        const entry = chatHistory()[chatHistory().length - 1 - newIndex];
        if (entry) setTextareaText(entry.text);
      } else if (historyIndex() === 0) {
        setHistoryIndex(-1);
        setTextareaText(historyRef);
      }
      return;
    }
  };

  // --- Global keyboard shortcuts (non-input-specific) ---
  useKeyboard((evt) => {
    if (!focus()) return;
    if (evt.ctrl && evt.char === 'l') {
      setMessages([]);
      props.onClear?.();
      return;
    }
    // Ctrl+J: jump to bottom (dismiss new messages indicator)
    if (evt.ctrl && evt.char === 'j') {
      scrollToBottom();
      return;
    }
    // Page Up / Page Down for manual scrolling
    if (evt.key === 'pageup') {
      setScrollOffset((prev) => Math.max(0, prev - messageAreaHeight()));
      setIsAtBottom(false);
      return;
    }
    if (evt.key === 'pagedown') {
      const totalLines = calculateMessageLines(messages());
      const maxOffset = Math.max(0, totalLines - messageAreaHeight());
      const newOffset = Math.min(maxOffset, scrollOffset() + messageAreaHeight());
      setScrollOffset(newOffset);
      if (newOffset >= maxOffset - SCROLL_BOTTOM_THRESHOLD) {
        setIsAtBottom(true);
        setHasNewMessages(false);
      }
      return;
    }
  });

  return (
    <box flexDirection="column" flexGrow={1}>
      <Show
        when={messages().length > 0 || isStreaming()}
        fallback={
          // ── EMPTY STATE: Centered logo + prompt ──────────────────
          <box
            flexGrow={1}
            flexDirection="column"
            alignItems="center"
            paddingLeft={2}
            paddingRight={2}
          >
            {/* Top spacer pushes content to center */}
            <box flexGrow={1} minHeight={0} />

            {/* Logo */}
            <box flexShrink={0} flexDirection="column">
              <For each={LOGO_LINES}>
                {(line) => (
                  <text fg={theme.primary} bold={true}>
                    {line}
                  </text>
                )}
              </For>
            </box>

            <box height={1} minHeight={0} flexShrink={1} />

            {/* Version + hint */}
            <box flexShrink={0} flexDirection="column" alignItems="center">
              <text fg={theme.textMuted}>v0.1.0</text>
              <Show
                when={client()}
                fallback={
                  <text fg={theme.warning}>
                    Daemon not connected. Run: <b>openlander daemon</b>
                  </text>
                }
              >
                <text fg={theme.textMuted}>Deploy anything with a chat. Type to get started.</text>
              </Show>
            </box>

            <box height={1} minHeight={0} flexShrink={1} />

            {/* Slash command picker (above prompt) */}
            <Show when={showCommandPicker()}>
              <box width="100%" maxWidth={75}>
                <SlashCommandPicker input={inputValue()} selectedIndex={commandPickerIndex()} />
              </box>
            </Show>

            {/* Centered Prompt */}
            <Show when={client()}>
              <box width="100%" maxWidth={75} flexShrink={0}>
                <Prompt
                  focused={focus()}
                  isStreaming={isStreaming()}
                  onSubmit={handleSubmit}
                  onContentChange={handleContentChange}
                  onKeyDown={handlePromptKeyDown}
                  textareaRef={setTextareaRefCallback}
                  placeholder="Ask anything... (/help for commands)"
                  agentName="Agent"
                />
              </box>
            </Show>

            {/* Bottom spacer mirrors top spacer for centering */}
            <box flexGrow={1} minHeight={0} />
          </box>
        }
      >
        {/* ── ACTIVE STATE: Messages + bottom prompt ─────────────── */}
        <box flexDirection="column" flexGrow={1}>
          {/* Messages area */}
          <box flexDirection="column" flexGrow={1} overflow="hidden" paddingTop={1}>
            <For each={messages()}>
              {(msg, i) => <ChatMessage message={msg} isFirst={i() === 0} />}
            </For>

            {/* Streaming indicator */}
            <Show when={isStreaming()}>
              <box paddingLeft={3} marginTop={1} flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>
                  <Spinner color={theme.textMuted} />
                </text>
                <text fg={theme.textMuted}>Thinking…</text>
              </box>
            </Show>
          </box>

          {/* New messages indicator */}
          <Show when={hasNewMessages()}>
            <box justifyContent="center" flexShrink={0}>
              <text backgroundColor={theme.primary} fg={theme.background} bold={true}>
                {' '}
                ↓ New messages — press Enter or Ctrl+J to scroll down{' '}
              </text>
            </box>
          </Show>

          {/* Slash command picker */}
          <Show when={showCommandPicker()}>
            <box>
              <SlashCommandPicker input={inputValue()} selectedIndex={commandPickerIndex()} />
            </box>
          </Show>

          {/* Bottom Prompt */}
          <box flexShrink={0}>
            <Show
              when={client()}
              fallback={
                <box paddingLeft={2}>
                  <text fg={theme.textDim}>Chat unavailable — daemon not connected</text>
                </box>
              }
            >
              <Prompt
                focused={focus()}
                isStreaming={isStreaming()}
                onSubmit={handleSubmit}
                onContentChange={handleContentChange}
                onKeyDown={handlePromptKeyDown}
                textareaRef={setTextareaRefCallback}
                placeholder="Ask anything... (/help for commands)"
                agentName="Agent"
              />
            </Show>
          </box>
        </box>
      </Show>
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
