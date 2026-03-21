import { useState, useCallback, useEffect } from 'react';
import { listChatSessions, deleteChatSession, getSessionMessages } from '@/lib/api';
import type { ChatSession, ChatMessage } from '@/lib/chat-types';

interface UseChatSessionsReturn {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isLoading: boolean;
  createSession: () => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadSessionMessages: (id: string) => Promise<ChatMessage[]>;
}

export function useChatSessions(): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await listChatSessions();
      setSessions(data);
    } catch (error) {
      console.error('Failed to fetch chat sessions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const createSession = useCallback(() => {
    const newId = `web-${Date.now()}`;
    setActiveSessionId(newId);
    return newId;
  }, []);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteChatSession(id);
        setSessions((prev) => prev.filter((s) => s.sessionId !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (error) {
        console.error('Failed to delete chat session:', error);
        throw error;
      }
    },
    [activeSessionId],
  );

  const loadSessionMessages = useCallback(async (id: string) => {
    try {
      return await getSessionMessages(id);
    } catch (error) {
      console.error('Failed to load session messages:', error);
      throw error;
    }
  }, []);

  return {
    sessions,
    activeSessionId,
    isLoading,
    createSession,
    switchSession,
    deleteSession,
    refreshSessions,
    loadSessionMessages,
  };
}
