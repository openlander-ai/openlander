import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ChatLayout } from '@/components/agent/ChatLayout';
import { ChatSidebar } from '@/components/agent/ChatSidebar';
import { LlmGate } from '@/components/agent/LlmGate';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useChatSessions } from '@/contexts/chat-sessions';
import type { AgentPanelInitialContext } from '@/contexts/agent-panel';
import { useStreamChat } from '@/hooks/use-stream-chat';
import { dismissQuestion, getSetupStatus, replyQuestion } from '@/lib/api';
import type { QuestionAnswer } from '@/lib/chat-types';
import { cn } from '@/lib/utils';

interface AgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContext: AgentPanelInitialContext | null;
  onInitialContextConsumed: () => void;
}

function buildDiagnosticPrompt(context: AgentPanelInitialContext): string {
  const chunks: string[] = ['Please diagnose this deployment issue and propose a fix plan.'];

  if (context.projectId) {
    chunks.push(`Project ID: ${context.projectId}`);
  }
  if (context.deployId) {
    chunks.push(`Deployment ID: ${context.deployId}`);
  }
  if (context.errorMessage) {
    chunks.push(`Error message:\n${context.errorMessage}`);
  }
  if (context.logLines?.length) {
    chunks.push(`Relevant log lines:\n${context.logLines.join('\n')}`);
  }

  return chunks.join('\n\n');
}

export function AgentPanel({
  open,
  onOpenChange,
  initialContext,
  onInitialContextConsumed,
}: AgentPanelProps) {
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(true);
  const sentContextKeyRef = useRef<string | null>(null);
  const [searchParams] = useSearchParams();

  const sessions = useChatSessions();
  const chat = useStreamChat(sessions.activeSessionId);
  const { activeSessionId, isLoading, createSession, loadSessionMessages, refreshSessions } =
    sessions;
  const { abort, clearMessages, setMessages } = chat;

  useEffect(() => {
    getSetupStatus()
      .then((status) => setLlmConfigured(status.llm.ok))
      .catch(() => setLlmConfigured(false));
  }, []);

  useEffect(() => {
    if (open && llmConfigured && !isLoading && !activeSessionId && !searchParams.get('session')) {
      createSession();
    }
  }, [open, llmConfigured, isLoading, activeSessionId, createSession, searchParams]);

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

  useEffect(() => {
    if (!open || !initialContext || !llmConfigured || !activeSessionId) {
      return;
    }

    const contextKey = JSON.stringify(initialContext);
    if (sentContextKeyRef.current === contextKey) {
      return;
    }

    chat.sendMessage(buildDiagnosticPrompt(initialContext));
    sentContextKeyRef.current = contextKey;
    onInitialContextConsumed();
  }, [open, initialContext, llmConfigured, activeSessionId, chat, onInitialContextConsumed]);

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

  const panelTitle = useMemo(() => 'Agent Chat Panel', []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideOverlay
        className="p-0 w-full sm:max-w-[480px] bg-bg-panel border-l border-[hsl(var(--border))] shadow-[-4px_0_24px_rgba(0,0,0,0.05)]"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{panelTitle}</SheetTitle>

        {llmConfigured === null ? (
          <div className="flex items-center justify-center h-full">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-agent border-t-transparent" />
          </div>
        ) : !llmConfigured ? (
          <div data-testid="agent-panel" className="h-full flex flex-col">
            <LlmGate />
          </div>
        ) : (
          <div data-testid="agent-panel" className="h-full min-h-0 flex">
            {!sessionsCollapsed ? (
              <aside className="w-[220px] shrink-0 border-r border-border min-h-0">
                <ChatSidebar
                  sessions={sessions.sessions}
                  activeSessionId={sessions.activeSessionId}
                  onNewChat={() => createSession()}
                  onSelectSession={(id) => sessions.switchSession(id)}
                  onDeleteSession={(id) => void sessions.deleteSession(id)}
                />
              </aside>
            ) : null}

            <div className="flex-1 min-w-0 min-h-0 relative">
              <button
                type="button"
                onClick={() => setSessionsCollapsed((prev) => !prev)}
                className={cn(
                  'absolute left-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-panel/90 backdrop-blur-sm shadow-sm px-2.5 py-1.5 text-[11px] font-medium text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle transition-all',
                  sessionsCollapsed ? 'left-3' : undefined,
                )}
                title={sessionsCollapsed ? 'Show sessions' : 'Hide sessions'}
              >
                {sessionsCollapsed ? (
                  <PanelLeft className="h-3.5 w-3.5" />
                ) : (
                  <PanelLeftClose className="h-3.5 w-3.5" />
                )}
                <span>{sessionsCollapsed ? 'Sessions' : 'Collapse'}</span>
              </button>

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
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
