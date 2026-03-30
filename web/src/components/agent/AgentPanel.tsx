import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { LlmGate } from '@/components/agent/LlmGate';
import { MessageList } from '@/components/agent/MessageList';
import { StreamError } from '@/components/agent/EmptyState';
import { ThinkingIndicator } from '@/components/agent/ThinkingIndicator';
import { StepProgress } from '@/components/agent/StepProgress';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { AgentPanelInitialContext } from '@/contexts/agent-panel';
import { useStreamChat } from '@/hooks/use-stream-chat';
import { getSetupStatus } from '@/lib/api';
import { useLanguage } from '@/i18n/context.js';

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
  const { t } = useLanguage();
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

    chat.sendMessage(buildDiagnosticPrompt(initialContext), initialContext.projectId);
    sentContextKeyRef.current = contextKey;
    onInitialContextConsumed();
  }, [open, initialContext, llmConfigured, chat, onInitialContextConsumed]);

  const panelTitle = useMemo(() => t('agent.aiDiagnosis'), [t]);

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
              <div className="flex flex-col h-full">
                <div className="shrink-0 px-4 py-3.5 border-b border-border/50 bg-bg-panel backdrop-blur-sm">
                  <h2 className="text-sm font-medium text-primary-ol">{t('agent.aiDiagnosis')}</h2>
                </div>

                {chat.messages.some((message) => message.role !== 'system') || chat.isStreaming ? (
                  <MessageList messages={chat.messages}>
                    {chat.isStreaming && chat.currentStep > 0 ? (
                      <StepProgress step={chat.currentStep} toolName={chat.currentToolName} />
                    ) : null}
                    {chat.isStreaming ? <ThinkingIndicator /> : null}
                  </MessageList>
                ) : (
                  <div className="flex-1 flex items-center justify-center px-6">
                    <div className="text-center space-y-2">
                      <div className="mx-auto h-12 w-12 rounded-full bg-bg-subtle flex items-center justify-center">
                        <Bot className="h-6 w-6 text-muted-ol" />
                      </div>
                      <h3 className="text-sm font-medium text-primary-ol">진단 준비 중</h3>
                      <p className="text-xs text-muted-ol">
                        Diagnose 버튼으로 전달된 에러 컨텍스트를 분석합니다.
                      </p>
                    </div>
                  </div>
                )}

                {chat.error ? <StreamError error={chat.error} /> : null}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
