import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatLayout } from '@/components/agent/ChatLayout';
import { LlmGate } from '@/components/agent/LlmGate';
import { useStreamChat } from '@/hooks/use-stream-chat';
import { useChatSessions } from '@/contexts/chat-sessions';
import { getSetupStatus, replyQuestion, dismissQuestion } from '@/lib/api';
import type { QuestionAnswer } from '@/lib/chat-types';

export function AgentPage() {
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    getSetupStatus()
      .then((status) => setLlmConfigured(status.llm.ok))
      .catch(() => setLlmConfigured(false));
  }, []);

  const sessions = useChatSessions();
  const chat = useStreamChat(sessions.activeSessionId);
  const { activeSessionId, isLoading, createSession, loadSessionMessages, refreshSessions } =
    sessions;
  const { abort, clearMessages, setMessages } = chat;

  useEffect(() => {
    if (llmConfigured && !isLoading && !activeSessionId && !searchParams.get('session')) {
      createSession();
    }
  }, [llmConfigured, isLoading, activeSessionId, createSession, searchParams]);

  useEffect(() => {
    const sessionId = activeSessionId;
    if (!sessionId) {
      abort();
      clearMessages();
      return;
    }

    let cancelled = false;
    abort();
    clearMessages();

    void loadSessionMessages(sessionId)
      .then((sessionMessages) => {
        if (!cancelled && activeSessionId === sessionId) {
          setMessages(sessionMessages);
        }
      })
      .catch(() => {
        if (!cancelled && activeSessionId === sessionId) {
          setMessages([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, abort, clearMessages, loadSessionMessages, setMessages]);

  useEffect(() => {
    if (!chat.isStreaming) {
      void refreshSessions();
    }
  }, [chat.isStreaming, refreshSessions]);

  const handleReply = useCallback((requestId: string, answers: QuestionAnswer[]) => {
    void replyQuestion(requestId, answers).catch((error) => {
      console.error('Failed to reply to question:', error);
    });
  }, []);

  const handleDismiss = useCallback(() => {
    void dismissQuestion().catch((error) => {
      console.error('Failed to dismiss question:', error);
    });
  }, []);

  if (llmConfigured === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-agent border-t-transparent" />
      </div>
    );
  }

  if (!llmConfigured) {
    return (
      <div data-testid="agent-page" className="flex flex-col h-full">
        <LlmGate />
      </div>
    );
  }

  return (
    <div data-testid="agent-page" className="flex flex-col h-full">
      <ChatLayout
        messages={chat.messages}
        isStreaming={chat.isStreaming}
        error={chat.error}
        pendingQuestion={chat.pendingQuestion}
        onSendMessage={chat.sendMessage}
        onAbort={chat.abort}
        onReply={handleReply}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
