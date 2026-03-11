import { useEffect, useRef, useState } from 'react';
import { Brain, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatInput } from './ChatInput';
import { UserActionCard } from './UserActionCard';
import { InputRequestCard } from '@/components/timeline/InputRequestCard';
import { MarkdownMessage } from './MarkdownMessage';
import { ToolCallItem, ToolResultItem } from './ToolCallGroup';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

export interface ChatMessageListProps {
  assistantItems: AssistantItem[];
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
}

export function ChatMessageList({
  assistantItems,
  isStreaming,
  onSendMessage,
  onSubmitAnswer,
  onSkipQuestion,
}: ChatMessageListProps) {
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
    <div className="w-full md:w-[380px] shrink-0 flex flex-col bg-bg-panel min-h-0">
      {/* AI Panel Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border))] text-agent">
        <Brain className="h-4 w-4" />
        <span className="text-sm font-display font-medium">AI Assistant</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {assistantItems.length === 0 && !isStreaming && (
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
              return <ThinkingIndicator key={item.id} />;
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
          disabled={isStreaming}
          placeholder="Ask AI Assistant..."
        />
        <div className="px-4 py-2 bg-bg-panel border-t border-[hsl(var(--border))] text-center">
          <span className="text-[10px] font-body text-muted-ol">
            This uses your LLM tokens. AI can make mistakes.
          </span>
        </div>
      </div>
    </div>
  );
}
