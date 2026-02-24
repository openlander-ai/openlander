import { useState, useCallback } from 'react';
import type { ChatMessage } from '../types';

export interface UIToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'success' | 'error';
  result?: unknown;
  error?: string;
}

export interface UIChatMessage extends Omit<ChatMessage, 'role'> {
  id: string;
  role: 'user' | 'assistant';
  isStreaming?: boolean;
  toolCalls?: UIToolCall[];
}

export interface UseChatReturn {
  messages: UIChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sessionId: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearChat: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      setIsStreaming(true);
      setError(null);

      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      const userMessage: UIChatMessage = {
        id: userMsgId,
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      const initialAssistantMessage: UIChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        toolCalls: [],
      };

      setMessages((prev) => [...prev, userMessage, initialAssistantMessage]);

      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, session_id: sessionId }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        if (!response.body) throw new Error('Response body is null');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;
            const lines = part.split('\n');
            const eventLine = lines.find((l) => l.startsWith('event: '));
            const dataLine = lines.find((l) => l.startsWith('data: '));

            if (eventLine && dataLine) {
              const eventType = eventLine.substring(7).trim();
              const dataContent = dataLine.substring(6).trim();

              try {
                const data = JSON.parse(dataContent);

                if (eventType === 'session') {
                  setSessionId(data.sessionId);
                }

                setMessages((prev) => {
                  const newMessages = [...prev];
                  const msgIndex = newMessages.findIndex((m) => m.id === assistantMsgId);
                  if (msgIndex === -1) return prev;

                  const msg = { ...newMessages[msgIndex] };

                  if (eventType === 'tool_call') {
                    msg.toolCalls = [
                      ...(msg.toolCalls || []),
                      {
                        toolName: data.toolName,
                        arguments: data.arguments,
                        status: 'pending',
                      },
                    ];
                  } else if (eventType === 'tool_result') {
                    if (msg.toolCalls) {
                      const callIndex = msg.toolCalls.findIndex(
                        (t) => t.toolName === data.toolName && t.status === 'pending',
                      );
                      if (callIndex !== -1) {
                        const newCalls = [...msg.toolCalls];
                        newCalls[callIndex] = {
                          ...newCalls[callIndex],
                          status: data.success ? 'success' : 'error',
                          result: data.result,
                          error: data.error,
                        };
                        msg.toolCalls = newCalls;
                      }
                    }
                  } else if (eventType === 'message') {
                    msg.content = (msg.content || '') + data.content;
                  } else if (eventType === 'done') {
                    msg.isStreaming = false;
                  } else if (eventType === 'error') {
                    msg.isStreaming = false;
                    setError(data.error);
                  }

                  newMessages[msgIndex] = msg;
                  return newMessages;
                });
              } catch (e) {
                console.error('Error parsing SSE data', e);
              }
            }
          }
        }
      } catch (err) {
        console.error('Stream error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m)),
        );
      } finally {
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m)),
        );
      }
    },
    [sessionId],
  );

  return { messages, isStreaming, error, sessionId, sendMessage, clearChat };
}
