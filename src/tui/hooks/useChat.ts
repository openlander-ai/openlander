import { useState, useCallback, useRef } from 'react';
import type { Agent, AgentResponse } from '../../agent/index.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (text: string) => void;
  lastResponse: AgentResponse | null;
}

/**
 * Manage chat state — sends messages directly to the agent (same process).
 */
export function useChat(agent: Agent | null): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastResponse, setLastResponse] = useState<AgentResponse | null>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);

  const sendMessage = useCallback(
    (text: string) => {
      if (!agent || !text.trim() || isLoading) return;

      const userMsg: ChatMessage = { role: 'user', content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      // Generate session ID on first message
      if (!sessionIdRef.current) {
        sessionIdRef.current = `tui-${Date.now().toString(36)}`;
      }

      void agent.chat(text.trim(), sessionIdRef.current).then(
        (response) => {
          const assistantMsg: ChatMessage = { role: 'assistant', content: response.message };
          setMessages((prev) => [...prev, assistantMsg]);
          setLastResponse(response);
          setIsLoading(false);
        },
        (err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          const assistantMsg: ChatMessage = { role: 'assistant', content: `Error: ${errorMsg}` };
          setMessages((prev) => [...prev, assistantMsg]);
          setIsLoading(false);
        },
      );
    },
    [agent, isLoading],
  );

  return { messages, isLoading, sendMessage, lastResponse };
}
