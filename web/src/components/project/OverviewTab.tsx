import { useEffect, useRef, useState } from 'react';
import { TimelineFeed } from '@/components/timeline/TimelineFeed';
import { PostmortemCard } from '@/components/timeline/PostmortemCard';
import { LogPreview } from '@/components/timeline/LogPreview';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatInput } from '@/components/assistant/ChatInput';
import { UserActionCard } from '@/components/assistant/UserActionCard';
import { InputRequestCard } from '@/components/timeline/InputRequestCard';
import { MarkdownMessage } from '@/components/assistant/MarkdownMessage';
import { Brain, Bot, User, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { TimelineItem } from '@/lib/event-types';
import type { PostmortemData } from '@/lib/api';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

interface OverviewTabProps {
  projectId: string;
  projectStatus: string;
  // Timeline props
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  postmortem: PostmortemData | null;
  fixingItemId: string | null;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onInsightAction: (projectId: string, action: string) => Promise<void>;
  onFixWithAI: (errorMessage?: string, timelineItemId?: string) => void;
  onOpenLogs: () => void;
  // Assistant props
  assistantItems: AssistantItem[];
  isAssistantStreaming: boolean;
  onSendMessage: (message: string) => void;
}

function ToolCallItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-2 rounded-md border border-agent/20 bg-agent/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-agent hover:bg-agent/10 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5" />
          Calling {item.toolName}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && item.toolArgs && (
        <div className="px-3 py-2 border-t border-agent/10 bg-bg-app/50">
          <pre className="text-[10px] font-mono text-muted-ol whitespace-pre-wrap break-all">
            {JSON.stringify(item.toolArgs, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolResultItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = item.toolSuccess !== false;
  return (
    <div
      className={cn(
        'my-2 rounded-md border overflow-hidden',
        isSuccess ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-xs font-mono transition-colors',
          isSuccess ? 'text-success hover:bg-success/10' : 'text-error hover:bg-error/10',
        )}
      >
        <span className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {item.toolName} {isSuccess ? 'completed' : 'failed'}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-black/10 bg-bg-app/50">
          <pre
            className={cn(
              'text-[10px] font-mono whitespace-pre-wrap break-all',
              isSuccess ? 'text-success/80' : 'text-error/80',
            )}
          >
            {item.toolError || JSON.stringify(item.toolResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function OverviewTab({
  projectId,
  projectStatus,
  timelineItems,
  isTimelineStreaming,
  postmortem,
  fixingItemId,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
  onFixWithAI,
  onOpenLogs,
  assistantItems,
  isAssistantStreaming,
  onSendMessage,
}: OverviewTabProps) {
  const { language } = useLanguage();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());

  // Auto-scroll assistant to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [assistantItems]);

  const handleDismissAction = (id: string) => {
    setDismissedActions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* Left pane: Timeline + Log Preview */}
      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 space-y-4 border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
        {postmortem && (
          <PostmortemCard
            projectId={postmortem.projectId}
            projectName={postmortem.projectName}
            markdown={postmortem.markdown}
            generatedAt={postmortem.generatedAt}
          />
        )}
        <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden flex flex-col h-[500px]">
          <TimelineFeed
            items={timelineItems}
            isStreaming={isTimelineStreaming}
            projectStatus={projectStatus}
            onSubmitAnswer={onSubmitAnswer}
            onSkipQuestion={onSkipQuestion}
            onInsightAction={onInsightAction}
            onFixWithAI={onFixWithAI}
            fixingItemId={fixingItemId}
          />
        </section>

        {projectId && (
          <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
            <LogPreview projectId={projectId} status={projectStatus} onOpenLogs={onOpenLogs} />
          </section>
        )}
      </div>

      {/* Right pane: AI Assistant (always visible) */}
      <div className="w-full md:w-[380px] shrink-0 flex flex-col bg-bg-panel min-h-0">
        {/* AI Panel Header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border))] text-agent">
          <Brain className="h-4 w-4" />
          <span className="text-sm font-display font-medium">AI Assistant</span>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {assistantItems.length === 0 && !isAssistantStreaming && (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-agent/10 flex items-center justify-center">
                  <Brain className="h-6 w-6 text-agent" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-body text-primary-ol">How can I help?</p>
                  <p className="text-xs font-body text-muted-ol max-w-[200px]">
                    Ask me to analyze logs, fix errors, or explain the deployment.
                  </p>
                </div>
              </div>
            )}

            {assistantItems.map((item) => {
              if (item.type === 'needs_user_action') {
                if (dismissedActions.has(item.id)) return null;
                return (
                  <UserActionCard
                    key={item.id}
                    category={item.category || 'Action Required'}
                    message={item.content || ''}
                    detail={item.detail}
                    locale={language}
                    onDismiss={() => handleDismissAction(item.id)}
                  />
                );
              }

              if (item.type === 'thinking') {
                return (
                  <div key={item.id} className="flex items-center gap-3 text-agent/80">
                    <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-agent/10 border border-agent/20 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-agent animate-pulse" />
                    </div>
                    <span className="text-xs font-mono uppercase tracking-widest">
                      AI is thinking...
                    </span>
                  </div>
                );
              }

              if (item.type === 'tool_call') {
                return <ToolCallItem key={item.id} item={item} />;
              }

              if (item.type === 'tool_result') {
                return <ToolResultItem key={item.id} item={item} />;
              }

              if (item.type === 'question' && item.questions && item.questionId) {
                return (
                  <div key={item.id} className="my-4">
                    <InputRequestCard
                      questionId={item.questionId}
                      questions={item.questions}
                      onSubmit={onSubmitAnswer}
                      onSkip={onSkipQuestion}
                    />
                  </div>
                );
              }

              if (item.type === 'error') {
                return (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm font-body"
                  >
                    {item.content}
                  </div>
                );
              }

              // Message or text_delta
              const isUser = item.role === 'user';
              return (
                <div
                  key={item.id}
                  className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
                >
                  <div
                    className={cn(
                      'shrink-0 w-6 h-6 rounded-full flex items-center justify-center border',
                      isUser
                        ? 'bg-bg-subtle border-[hsl(var(--border))] text-secondary-ol'
                        : 'bg-agent/10 border-agent/20 text-agent',
                    )}
                  >
                    {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                  </div>
                  <div
                    className={cn(
                      'px-3 py-2 rounded-lg max-w-[85%] text-sm font-body',
                      isUser
                        ? 'bg-bg-subtle text-primary-ol rounded-tr-none whitespace-pre-wrap'
                        : 'bg-transparent text-primary-ol',
                    )}
                  >
                    {isUser || item.type === 'text_delta' ? (
                      <span className="whitespace-pre-wrap">{item.content}</span>
                    ) : (
                      <MarkdownMessage content={item.content || ''} />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Footer / Input */}
        <div className="shrink-0 flex flex-col">
          <ChatInput
            onSend={onSendMessage}
            disabled={isAssistantStreaming}
            placeholder="Ask AI Assistant..."
          />
          <div className="px-4 py-2 bg-bg-panel border-t border-[hsl(var(--border))] text-center">
            <span className="text-[10px] font-body text-muted-ol">
              This uses your LLM tokens. AI can make mistakes.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
