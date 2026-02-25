import { useState, useCallback, useRef } from 'react';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { ChatStreamEvent } from '../../agent/index.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallInfo[];
  isStreaming?: boolean;
}

export interface ToolCallInfo {
  name: string;
  status: 'running' | 'success' | 'error';
  duration?: number;
  result?: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  sendMessage: (text: string) => void;
  clearMessages: () => void;
}

/**
 * Manage chat state via IPC client (daemon architecture).
 * Streams chat events for real-time UI updates.
 */
export function useChat(client: OpenLanderClient | null): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const toolCallsRef = useRef<ToolCallInfo[]>([]);
  const toolStartTimeRef = useRef<number>(0);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = null;
    toolCallsRef.current = [];
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      if (!client || !text.trim() || isLoading) return;

      const userMsgId = Date.now().toString(36);
      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: text.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setIsStreaming(true);

      // Generate session ID on first message if not set
      if (!sessionIdRef.current) {
        sessionIdRef.current = `tui-${Date.now().toString(36)}`;
      }

      // Reset tool calls tracking
      toolCallsRef.current = [];

      // Create assistant message placeholder
      const assistantMsgId = `${userMsgId}-assistant`;
      let currentContent = '';
      let hasAssistantMsg = false;

      const onEvent = (event: ChatStreamEvent) => {
        switch (event.type) {
          case 'session':
            // Update session ID from server if provided
            sessionIdRef.current = event.sessionId;
            break;

          case 'thinking':
            // Could show a thinking indicator here
            break;

          case 'tool_call':
            // Start tracking this tool call
            toolStartTimeRef.current = Date.now();
            toolCallsRef.current.push({
              name: event.toolName,
              status: 'running',
            });
            // Update assistant message with tool calls
            setMessages((prev) => {
              if (!hasAssistantMsg) {
                hasAssistantMsg = true;
                return [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: '',
                    toolCalls: [...toolCallsRef.current],
                    isStreaming: true,
                  },
                ];
              }
              return prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, toolCalls: [...toolCallsRef.current] } : msg,
              );
            });
            break;

          case 'tool_result': {
            // Update tool call status
            const duration = Date.now() - toolStartTimeRef.current;
            const toolIndex = toolCallsRef.current.findIndex(
              (t) => t.name === event.toolName && t.status === 'running',
            );
            if (toolIndex !== -1) {
              toolCallsRef.current[toolIndex] = {
                name: event.toolName,
                status: event.success ? 'success' : 'error',
                duration,
                result: event.success ? JSON.stringify(event.result) : event.error,
              };
            }
            // Update message with tool result
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, toolCalls: [...toolCallsRef.current] } : msg,
              ),
            );
            break;
          }

          case 'message':
            // Append text content
            currentContent += event.content;
            setMessages((prev) => {
              if (!hasAssistantMsg) {
                hasAssistantMsg = true;
                return [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: currentContent,
                    toolCalls:
                      toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
                    isStreaming: true,
                  },
                ];
              }
              return prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, content: currentContent } : msg,
              );
            });
            break;

          case 'error':
            // Show error as assistant message
            setMessages((prev) => {
              if (!hasAssistantMsg) {
                return [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: `Error: ${event.error}`,
                    isStreaming: false,
                  },
                ];
              }
              return prev.map((msg) =>
                msg.id === assistantMsgId
                  ? { ...msg, content: `Error: ${event.error}`, isStreaming: false }
                  : msg,
              );
            });
            setIsLoading(false);
            setIsStreaming(false);
            break;

          case 'done':
            // Mark streaming complete
            setMessages((prev) =>
              prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg)),
            );
            setIsLoading(false);
            setIsStreaming(false);
            break;
        }
      };

      client.chatStream(text.trim(), sessionIdRef.current, onEvent).catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setMessages((prev) => {
          if (!hasAssistantMsg) {
            return [
              ...prev,
              {
                id: assistantMsgId,
                role: 'assistant',
                content: `Error: ${errorMsg}`,
                isStreaming: false,
              },
            ];
          }
          return prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: `Error: ${errorMsg}`, isStreaming: false }
              : msg,
          );
        });
        setIsLoading(false);
        setIsStreaming(false);
      });
    },
    [client, isLoading],
  );

  return { messages, isLoading, isStreaming, sendMessage, clearMessages };
}
