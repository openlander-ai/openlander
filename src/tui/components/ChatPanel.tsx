import { createSignal, createEffect, createMemo, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { overlayActive } from '../state/overlay.js';
import { enterDebugMode } from '../state/mode.js';
import { Prompt } from './Prompt.js';
import { Logo } from './Logo.js';
import { Spinner } from './Spinner.js';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { ChatStreamEvent } from '../../agent/index.js';
import { ChatMessage, type DisplayMessage } from './ChatMessage.js';
import { SlashCommandPicker, getMatchCount, getMatchAt } from './SlashCommandPicker.js';
import { parseSlashCommand, type SlashCommandResult } from '../commands/registry.js';
import { theme } from '../theme.js';
import { detectChoices, type DetectedChoice } from './ChoicePicker.js';
import { VERSION } from '../../version.js';

// ---------------------------------------------------------------------------
// Compaction Helpers
// ---------------------------------------------------------------------------

/** Format messages for context summarization. */
function formatMessagesForCompaction(msgs: DisplayMessage[]): string {
  return msgs
    .filter(
      (m) =>
        m.type === 'text' || m.type === undefined || m.type === 'error' || m.type === 'tool_result',
    )
    .map((m) => {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      let line = `[${role}]: ${m.content}`;
      if (m.toolName) line += ` (tool: ${m.toolName})`;
      return line;
    })
    .join('\n');
}

/** Prompt for summarizing a deployment conversation. */
const COMPACTION_PROMPT = `You are summarizing a deployment conversation for OpenLander, an AI-powered deployment tool.

Analyze the conversation above and provide a structured summary that enables seamless continuation. This summary will replace all previous messages — it must contain everything needed to continue working.

IMPORTANT RULES:
- User Requests must be VERBATIM (exact wording, not paraphrased)
- Constraints must be VERBATIM (only what the user actually said)
- Do NOT invent or assume constraints that weren't explicitly stated
- Be specific about infrastructure state (container names, ports, URLs)
- Include error messages verbatim if they are still relevant

Use this template:

## User Requests (As-Is)
[List each user request exactly as stated — do NOT paraphrase]

## Deployments
[What repos were deployed, container names, ports, URLs, health status]
[If no deployments yet, write "None"]

## Infrastructure State
[Running containers, active domains/tunnels, configured env vars, build status]
[If not applicable, write "N/A"]

## Work Completed
[What actions were taken, what was accomplished]

## Decisions Made
[Technical decisions with rationale — Dockerfile choices, environment config, network setup, etc.]

## Pending Tasks
[What remains to be done, known issues, next steps]
[If nothing pending, write "None"]

## User Constraints (Verbatim Only)
[ONLY constraints explicitly stated by the user — do NOT invent]
[If none, write "None"]`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  onModal?: (modal: string) => void;
  onClear?: () => void;
  onExit?: () => void;
  onCommandResult?: (result: SlashCommandResult) => void;
  /** External system messages injected from outside (e.g. deploy progress). */
  externalMessages?: DisplayMessage[];
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
  const [streamingStatus, setStreamingStatus] = createSignal('Thinking');
  const [streamingStep, setStreamingStep] = createSignal(0);
  const [toolCallCount, setToolCallCount] = createSignal(0);
  const [inputValue, setInputValue] = createSignal('');
  let sessionIdRef = `tui-${Date.now().toString(36)}`;
  // Captures text before textarea's submit action clears it (OpenTUI timing issue)
  let pendingSubmitText: string | null = null;

  // --- External message injection (deploy progress, etc.) ---
  let lastExternalCount = 0;
  createEffect(() => {
    const ext = props.externalMessages;
    if (!ext || ext.length <= lastExternalCount) return;
    const newMsgs = ext.slice(lastExternalCount);
    lastExternalCount = ext.length;
    setMessages((prev) => [...prev, ...newMsgs]);
  });

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
  // --- Choice detection for agent clarification questions (T-AGENT-01) ---
  const detectedChoices = createMemo((): DetectedChoice[] => {
    const msgs = messages();
    if (isStreaming()) return [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (!msg) continue;
      if (msg.role === 'user') return [];
      if (msg.role === 'assistant' && msg.type !== 'tool_start' && msg.type !== 'tool_result') {
        const choices = detectChoices(msg.content);
        if (choices.length >= 2) return choices;
      }
    }
    return [];
  });

  const submitChoice = (choice: DetectedChoice) => {
    void sendMessage(String(choice.number));
  };
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
        // Reset step tracking for new conversation turn
        setStreamingStep(0);
        setToolCallCount(0);
        setStreamingStatus('Thinking');
        break;
      case 'thinking': {
        setIsStreaming(true);
        const prevStep = streamingStep();
        setStreamingStep(prevStep + 1);
        setStreamingStatus(
          prevStep > 0 ? `Analyzing results (step ${String(prevStep + 1)})` : 'Thinking',
        );
        break;
      }
      case 'tool_call': {
        setToolCallCount((c) => c + 1);
        setStreamingStatus(`Running ${event.toolName}`);
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

        // T-DEBUG-01: Intercept get_logs → enter debug mode
        if (event.toolName === 'get_logs') {
          const projectName = args.project_name ?? args.projectName ?? '';
          const c = client();
          if (projectName && c) {
            void c
              .listProjects()
              .then((resp) => {
                const found = resp.projects.find(
                  (p) => p.name.toLowerCase() === projectName.toLowerCase(),
                );
                if (found) {
                  enterDebugMode(found.id, found.name);
                }
              })
              .catch(() => {
                /* ignore lookup failure */
              });
          }
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
          // Find the LAST tool_start with this name (not first) to handle repeated tool calls
          let lastToolIdx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            const m = updated[i];
            if (
              m &&
              (m.type === 'tool_start' || m.type === 'command' || m.type === 'file_edit') &&
              m.toolName === event.toolName
            ) {
              lastToolIdx = i;
              break;
            }
          }
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
        setStreamingStep(0);
        setToolCallCount(0);
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
        setStreamingStep(0);
        setToolCallCount(0);
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
        setStreamingStep(0);
        setToolCallCount(0);
        break;
    }
  };

  // --- Send message function ---
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    // Auto-scroll to bottom when user sends a message
    scrollToBottom();

    // ── Slash commands: execute without adding to chat history ──
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
          case 'compact': {
            if (!client()) break;
            const c = client();
            if (!c) break;

            const currentMessages = messages();
            if (currentMessages.length === 0) {
              // Nothing to compact
              setMessages([
                {
                  id: `system-${String(Date.now())}`,
                  role: 'system',
                  content: 'Nothing to compact — chat is empty.',
                  type: 'text',
                  timestamp: Date.now(),
                },
              ]);
              break;
            }

            // Format context and build compaction message
            const context = formatMessagesForCompaction(currentMessages);
            const compactionMessage = `${context}\n\n---\n\n${COMPACTION_PROMPT}`;

            // Show compacting indicator
            setMessages([
              {
                id: `system-${String(Date.now())}`,
                role: 'system',
                content: '⟳ Compacting context...',
                type: 'text',
                timestamp: Date.now(),
              },
            ]);

            // Reset session for fresh start
            sessionIdRef = `tui-${Date.now().toString(36)}`;

            // Send compaction prompt to LLM in the new session
            setIsStreaming(true);
            try {
              await c.chatStream(compactionMessage, sessionIdRef, handleStreamEvent);
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
            break;
          }
        }
        return;
      }
    }

    // ── Normal chat message: add to messages + history, send to LLM ──
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
    // Use pre-captured text if available (textarea submit clears content before onSubmit fires)
    const text = pendingSubmitText ?? inputValue();
    pendingSubmitText = null;
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
      name?: string;
      ctrl?: boolean;
      preventDefault?: () => void;
    };
    const key = evt.name ?? '';

    // Capture text on Enter before textarea's submit action can clear it
    if (key === 'enter' || key === 'return') {
      pendingSubmitText = inputValue();
    }

    // ── When command picker is visible, intercept navigation keys ──
    if (showCommandPicker()) {
      // Enter/Return: select the highlighted command (prevent textarea submit!)
      if (key === 'enter' || key === 'return') {
        evt.preventDefault?.();
        const text = pendingSubmitText ?? inputValue();
        const matchCount = getMatchCount(text);
        if (matchCount > 0) {
          const commandName = getMatchAt(text, commandPickerIndex());
          if (commandName) {
            pendingSubmitText = null;
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
  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (overlayActive() || !focus()) return;
    if (evt.ctrl && evt.name === 'l') {
      setMessages([]);
      props.onClear?.();
      return;
    }
    // Ctrl+J: jump to bottom (dismiss new messages indicator)
    if (evt.ctrl && evt.name === 'j') {
      scrollToBottom();
      return;
    }
    // Page Up / Page Down for manual scrolling
    if (evt.name === 'pageup') {
      setScrollOffset((prev) => Math.max(0, prev - messageAreaHeight()));
      setIsAtBottom(false);
      return;
    }
    if (evt.name === 'pagedown') {
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
    // Number keys (1-9) for quick choice selection (T-AGENT-01)
    const choices = detectedChoices();
    if (choices.length > 0 && evt.name && /^[1-9]$/.test(evt.name)) {
      const num = parseInt(evt.name, 10);
      const choice = choices.find((c) => c.number === num);
      if (choice) {
        submitChoice(choice);
        return;
      }
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
            <box flexShrink={0}>
              <Logo />
            </box>

            <box height={1} minHeight={0} flexShrink={1} />

            {/* Version + hint */}
            <box flexShrink={0} flexDirection="column" alignItems="center">
              <text fg={theme.textMuted}>v{VERSION}</text>
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
                <SlashCommandPicker
                  input={inputValue()}
                  selectedIndex={commandPickerIndex()}
                  onSelect={(name) => {
                    clearTextarea();
                    setShowCommandPicker(false);
                    void sendMessage(`/${name}`);
                  }}
                  onHover={(index) => setCommandPickerIndex(index)}
                />
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
                  cursorColor={showCommandPicker() ? theme.backgroundElement : undefined}
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
                <text fg={theme.textMuted}>
                  {streamingStatus()}
                  {toolCallCount() > 0 ? ` (${String(toolCallCount())} tools used)` : ''}…
                </text>
              </box>
            </Show>
          </box>

          {/* New messages indicator */}
          <Show when={hasNewMessages()}>
            <box justifyContent="center" flexShrink={0}>
              <text backgroundColor={theme.primary} fg={theme.text} bold={true}>
                {' '}
                ↓ New messages — press Enter or Ctrl+J to scroll down{' '}
              </text>
            </box>
          </Show>

          {/* Slash command picker */}
          <Show when={showCommandPicker()}>
            <box flexShrink={0}>
              <SlashCommandPicker
                input={inputValue()}
                selectedIndex={commandPickerIndex()}
                onSelect={(name) => {
                  clearTextarea();
                  setShowCommandPicker(false);
                  void sendMessage(`/${name}`);
                }}
                onHover={(index) => setCommandPickerIndex(index)}
              />
            </box>
          </Show>

          {/* Choice picker for agent clarification questions */}
          <Show when={detectedChoices().length > 0}>
            <box flexShrink={0} paddingLeft={3} flexDirection="row" gap={2}>
              <text fg={theme.textDim}>Pick:</text>
              <For each={detectedChoices()}>
                {(choice) => (
                  <box flexDirection="row" gap={0}>
                    <text backgroundColor={theme.backgroundElement} fg={theme.warning}>
                      {` ${String(choice.number)} `}
                    </text>
                    <text fg={theme.textMuted}>
                      {' '}
                      {choice.label.length > 30 ? choice.label.slice(0, 29) + '…' : choice.label}
                    </text>
                  </box>
                )}
              </For>
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
                cursorColor={showCommandPicker() ? theme.backgroundElement : undefined}
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
