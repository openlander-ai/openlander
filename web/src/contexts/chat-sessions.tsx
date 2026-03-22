import { createContext, useContext, type ReactNode } from 'react';
import { useChatSessions as useChatSessionsImpl } from '@/hooks/use-chat-sessions';

type ChatSessionsContextType = ReturnType<typeof useChatSessionsImpl>;

const ChatSessionsContext = createContext<ChatSessionsContextType | null>(null);

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const value = useChatSessionsImpl();
  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>;
}

export function useChatSessions(): ChatSessionsContextType {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) {
    throw new Error('useChatSessions must be used within a ChatSessionsProvider');
  }
  return ctx;
}
