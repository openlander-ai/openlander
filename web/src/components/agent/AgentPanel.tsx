import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatLayout } from '@/components/agent/ChatLayout';
import { LlmGate } from '@/components/agent/LlmGate';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { AgentPanelInitialContext } from '@/contexts/agent-panel';
import { useStreamChat } from '@/hooks/use-stream-chat';
import { dismissQuestion, getSetupStatus, replyQuestion } from '@/lib/api';
import type { QuestionAnswer } from '@/lib/chat-types';

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
  const sentContextKeyRef = useRef<string | null>(null);
  const chat = useStreamChat();

  useEffect(() => {
    getSetupStatus()
      .then((status) => setLlmConfigured(status.llm.ok))
      .catch(() => setLlmConfigured(false));
  }, []);

  useEffect(() => {
    if (!open || !initialContext || !llmConfigured) {
      return;
    }

    const contextKey = JSON.stringify(initialContext);
    if (sentContextKeyRef.current === contextKey) {
      return;
    }

    chat.sendMessage(buildDiagnosticPrompt(initialContext));
    sentContextKeyRef.current = contextKey;
    onInitialContextConsumed();
  }, [open, initialContext, llmConfigured, chat, onInitialContextConsumed]);

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
            <div className="flex-1 min-w-0 min-h-0">
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
