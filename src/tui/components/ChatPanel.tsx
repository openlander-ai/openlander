import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
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
 *
 * Features:
 * - Message list with auto-scroll
 * - Input area with slash command autocomplete
 * - IPC client streaming for real-time responses
 * - Chat history navigation (↑/↓)
 * - Thinking indicator during response generation
 */
export function ChatPanel({
  client,
  height,
  focus,
  onModal,
  onClear,
  onExit,
  onCommandResult,
}: ChatPanelProps): React.ReactElement {
  // --- Chat state (inline until useChat is ready) ---
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const sessionIdRef = useRef<string>(`tui-${Date.now().toString(36)}`);

  // --- Chat history for ↑/↓ navigation ---
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef<string>(''); // Temp storage when navigating history

  // --- Slash command autocomplete ---
  const [showCommandPicker, setShowCommandPicker] = useState(false);
  const [commandPickerIndex, setCommandPickerIndex] = useState(0);

  // --- Streaming state ---
  const currentAssistantMessageRef = useRef<DisplayMessage | null>(null);

  // Calculate heights
  const messageAreaHeight = Math.max(5, height - INPUT_HEIGHT);

  // --- Auto-scroll offset ---
  const [, setScrollOffset] = useState(0);
  const messagesEndRef = useRef<number>(0);

  // Update scroll offset when messages change
  useEffect(() => {
    const totalLines = calculateMessageLines(messages);
    const maxOffset = Math.max(0, totalLines - messageAreaHeight);
    setScrollOffset(maxOffset);
    messagesEndRef.current = totalLines;
  }, [messages, messageAreaHeight]);

  // --- Handle slash command picker visibility ---
  useEffect(() => {
    const isSlashInput = inputValue.startsWith('/') && !inputValue.includes(' ');
    setShowCommandPicker(isSlashInput && focus);
    if (isSlashInput) {
      setCommandPickerIndex(0);
    }
  }, [inputValue, focus]);

  // --- Handle chat stream events ---
  const handleStreamEvent = useCallback((event: ChatStreamEvent) => {
    switch (event.type) {
      case 'session':
        sessionIdRef.current = event.sessionId;
        break;

      case 'thinking':
        setIsStreaming(true);
        break;

      case 'tool_call':
        // Add tool_start message
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-${String(Date.now())}`,
            role: 'assistant',
            content: '',
            type: 'tool_start',
            toolName: event.toolName,
            timestamp: Date.now(),
          },
        ]);
        break;

      case 'tool_result':
        // Update the last tool_start message with result
        setMessages((prev) => {
          const updated = [...prev];
          const lastToolIdx = updated.findIndex(
            (m) => m.type === 'tool_start' && m.toolName === event.toolName,
          );
          if (lastToolIdx !== -1) {
            const item = updated[lastToolIdx];
            if (item) {
              updated[lastToolIdx] = {
                ...item,
                type: 'tool_result',
                toolStatus: event.success ? 'success' : 'error',
                toolDuration: event.success ? 0 : undefined, // Duration would need to be tracked
                content: event.error ?? '',
              };
            }
          }
          return updated;
        });
        break;

      case 'message':
        setIsStreaming(false);
        // Add assistant message
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
        currentAssistantMessageRef.current = null;
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
  }, []);

  // --- Send message function ---
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Add user message
      const userMessage: DisplayMessage = {
        id: `user-${String(Date.now())}`,
        role: 'user',
        content: text,
        type: 'text',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Add to history
      setChatHistory((prev) => {
        const newHistory = [...prev, { text, timestamp: Date.now() }].slice(-MAX_HISTORY_ENTRIES);
        return newHistory;
      });
      setHistoryIndex(-1);

      // Check for slash command
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
              // Send the agent message through the normal flow
              if (client) {
                setIsStreaming(true);
                try {
                  await client.chatStream(result.message, sessionIdRef.current, handleStreamEvent);
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
              // This would be handled by parent
              break;
          }
          return;
        }
      }

      // Regular chat message
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
        await client.chatStream(text, sessionIdRef.current, handleStreamEvent);
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
    },
    [client, handleStreamEvent, onModal, onClear, onExit, onCommandResult],
  );

  // --- Handle input submit ---
  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      // Check if we should autocomplete from picker
      if (showCommandPicker) {
        const matchCount = getMatchCount(text);
        if (matchCount > 0) {
          const commandName = getMatchAt(text, commandPickerIndex);
          if (commandName) {
            // Complete the command
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
    },
    [showCommandPicker, commandPickerIndex, sendMessage],
  );

  // --- Handle Tab completion for slash commands ---
  const handleTabComplete = useCallback(() => {
    if (showCommandPicker) {
      const commandName = getMatchAt(inputValue, commandPickerIndex);
      if (commandName) {
        setInputValue(`/${commandName} `);
        setShowCommandPicker(false);
      }
    }
  }, [showCommandPicker, inputValue, commandPickerIndex]);

  // --- Keyboard handling ---
  useInput(
    (_input, key) => {
      // Tab for autocomplete
      if (key.tab && showCommandPicker) {
        handleTabComplete();
        return;
      }

      // Enter to submit
      if (key.return) {
        handleSubmit(inputValue);
        return;
      }

      // Ctrl+L to clear
      if (key.ctrl && _input === 'l') {
        setMessages([]);
        onClear?.();
        return;
      }

      // Up arrow - history navigation or command picker
      if (key.upArrow) {
        if (showCommandPicker) {
          // Navigate command picker
          setCommandPickerIndex((i) => Math.max(0, i - 1));
        } else if (chatHistory.length > 0) {
          if (historyIndex === -1) {
            // Save current input
            historyRef.current = inputValue;
          }
          const newIndex = Math.min(chatHistory.length - 1, historyIndex + 1);
          setHistoryIndex(newIndex);
          const historyEntry = chatHistory[chatHistory.length - 1 - newIndex];
          if (historyEntry) {
            setInputValue(historyEntry.text);
          }
        }
        return;
      }

      // Down arrow - history navigation or command picker
      if (key.downArrow) {
        if (showCommandPicker) {
          const matchCount = getMatchCount(inputValue);
          setCommandPickerIndex((i) => Math.min(matchCount - 1, i + 1));
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          const historyEntry = chatHistory[chatHistory.length - 1 - newIndex];
          if (historyEntry) {
            setInputValue(historyEntry.text);
          }
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInputValue(historyRef.current);
        }
        return;
      }
    },
    { isActive: focus },
  );

  // --- Calculate visible messages (for scrolling) ---
  const visibleMessages = messages;

  // --- Render ---
  return (
    <Box flexDirection="column" height={height}>
      {/* Message area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.length === 0 && !isStreaming ? (
          // Welcome message
          <Box flexDirection="column" paddingX={1}>
            <Text color={theme.user} bold>
              Welcome to OpenLander
            </Text>
            <Text> </Text>
            {client ? (
              <>
                <Text dimColor>
                  Ask the agent anything — deploy a repo, check logs, manage projects.
                </Text>
                <Text dimColor>
                  Type <Text color={theme.user}>/help</Text> to see all slash commands.
                </Text>
              </>
            ) : (
              <Text color="yellow">
                Daemon not connected. Start with: <Text bold>openlander daemon</Text>
              </Text>
            )}
          </Box>
        ) : (
          // Message list
          <Box flexDirection="column" flexGrow={1}>
            {visibleMessages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}

            {/* Thinking indicator */}
            {isStreaming && (
              <Box paddingX={1} gap={1}>
                <Text color="yellow">
                  <Spinner type="dots" />
                </Text>
                <Text color="yellow">Thinking…</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Slash command picker */}
      {showCommandPicker && (
        <Box>
          <SlashCommandPicker input={inputValue} selectedIndex={commandPickerIndex} />
        </Box>
      )}

      {/* Input area */}
      <Box
        borderStyle="single"
        borderColor={theme.border}
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        {!client ? (
          <Text dimColor>Chat unavailable — daemon not connected</Text>
        ) : isStreaming ? (
          <Box gap={1}>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text dimColor> Waiting for response...</Text>
          </Box>
        ) : (
          <Box>
            <Text color={theme.user}>❯ </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Ask the agent anything... (/help for commands)"
              showCursor={focus}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate total lines needed to render messages */
function calculateMessageLines(messages: DisplayMessage[]): number {
  let lines = 0;
  for (const msg of messages) {
    // Each message takes at least 1 line
    lines += 1;
    // Content lines (rough estimate)
    if (msg.content) {
      const contentLines = msg.content.split('\n').length;
      // Add extra lines for long content
      lines += Math.ceil(contentLines * 0.5);
    }
    // Spacer
    lines += 1;
  }
  return lines;
}
