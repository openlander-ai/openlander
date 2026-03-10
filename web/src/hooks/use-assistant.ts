import { useState, useCallback, useRef } from 'react';
import { chatWithAgent } from '@/lib/api';
import type { BuildStreamEvent, ChatStreamEvent } from '@/lib/event-types';
import {
  buildEventToAssistantItem,
  chatEventToAssistantItem,
  type AssistantItem,
} from './assistant-event-mapper.js';

export type { AssistantItem } from './assistant-event-mapper.js';

export function useAssistant(projectId?: string) {
  const [items, setItems] = useState<AssistantItem[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const clearItems = useCallback(() => {
    setItems([]);
    sessionIdRef.current = undefined;
  }, []);

  const addDeployEvent = useCallback((event: BuildStreamEvent) => {
    const item = buildEventToAssistantItem(event);
    if (!item) return;
    if (item.type === 'needs_user_action' || item.type === 'error') {
      setIsOpen(true);
    }
    setItems((prev) => [...prev, item]);
  }, []);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setIsOpen(true);

      const userMessageId = `user-${Date.now()}`;
      setItems((prev) => [
        ...prev,
        {
          id: userMessageId,
          type: 'message',
          timestamp: new Date().toISOString(),
          role: 'user',
          content: message,
        },
      ]);

      try {
        await chatWithAgent(
          message,
          (event: ChatStreamEvent) => {
            if (event.type === 'session') {
              sessionIdRef.current = event.sessionId;
            } else if (event.type === 'text_delta') {
              // text_delta needs special merging logic (append to last item)
              setItems((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.type === 'text_delta') {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: (last.content || '') + event.text },
                  ];
                } else {
                  const item = chatEventToAssistantItem(event);
                  return item ? [...prev, item] : prev;
                }
              });
            } else if (event.type === 'message') {
              // message replaces accumulated text_delta
              setItems((prev) => {
                const last = prev[prev.length - 1];
                if (last && last.type === 'text_delta') {
                  return [
                    ...prev.slice(0, -1),
                    {
                      id: `message-${Date.now()}`,
                      type: 'message' as const,
                      timestamp: new Date().toISOString(),
                      role: 'agent' as const,
                      content: event.content,
                    },
                  ];
                }
                const item = chatEventToAssistantItem(event);
                return item ? [...prev, item] : prev;
              });
            } else if (event.type === 'done') {
              setIsStreaming(false);
            } else {
              const item = chatEventToAssistantItem(event);
              if (item) {
                setItems((prev) => [...prev, item]);
              }
            }
          },
          { projectId, sessionId: sessionIdRef.current, signal: controller.signal },
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setItems((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              type: 'error',
              timestamp: new Date().toISOString(),
              content: err instanceof Error ? err.message : 'Failed to send message',
            },
          ]);
          setIsStreaming(false);
        }
      }
    },
    [projectId],
  );

  return {
    items,
    isStreaming,
    isOpen,
    togglePanel,
    clearItems,
    addDeployEvent,
    sendMessage,
  };
}
