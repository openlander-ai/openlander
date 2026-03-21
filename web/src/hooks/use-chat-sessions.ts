import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const syncSessionInUrl = useCallback(
    (sessionId: string | null) => {
      setSearchParams(
        (previousParams) => {
          const nextParams = new URLSearchParams(previousParams);
          if (sessionId) {
            nextParams.set('session', sessionId);
          } else {
            nextParams.delete('session');
          }
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    const sessionInUrl = searchParams.get('session');
    setActiveSessionId((current) => {
      if (sessionInUrl === current) {
        return current;
      }
      return sessionInUrl;
    });
  }, [searchParams]);

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
    const placeholder: ChatSession = {
      sessionId: newId,
      messageCount: 0,
      lastActive: new Date().toISOString(),
      firstMessage: undefined,
    };
    setSessions((prev) => [placeholder, ...prev]);
    setActiveSessionId(newId);
    syncSessionInUrl(newId);
    return newId;
  }, [syncSessionInUrl]);

  const switchSession = useCallback(
    (id: string) => {
      setActiveSessionId(id);
      syncSessionInUrl(id);
    },
    [syncSessionInUrl],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      try {
        await deleteChatSession(id);
        setSessions((prev) => prev.filter((s) => s.sessionId !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          syncSessionInUrl(null);
        }
      } catch (error) {
        console.error('Failed to delete chat session:', error);
        throw error;
      }
    },
    [activeSessionId, syncSessionInUrl],
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
