import { useEffect, useRef, useState, useCallback } from 'react';
import { Brain, Bot, User, Copy, Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatInput } from './ChatInput';
import { UserActionCard } from './UserActionCard';
import { InputRequestCard } from '@/components/timeline/InputRequestCard';
import { MarkdownMessage } from './MarkdownMessage';
import { CollapsedToolGroup } from './ToolCallGroup';
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

/** Format timestamp to HH:MM */
function formatMessageTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

/** Group consecutive tool_call/tool_result items into groups */
function groupItems(
  items: AssistantItem[],
): Array<AssistantItem | { type: 'tool_group'; items: AssistantItem[]; id: string }> {
  const result: Array<AssistantItem | { type: 'tool_group'; items: AssistantItem[]; id: string }> =
    [];
  let toolBuffer: AssistantItem[] = [];

  const flushToolBuffer = () => {
    if (toolBuffer.length > 0) {
      result.push({
        type: 'tool_group',
        items: [...toolBuffer],
        id: `tool-group-${toolBuffer[0].id}`,
      });
      toolBuffer = [];
    }
  };

  for (const item of items) {
    if (item.type === 'tool_call' || item.type === 'tool_result') {
      toolBuffer.push(item);
    } else {
      flushToolBuffer();
      result.push(item);
    }
  }
  flushToolBuffer();
  return result;
}

const SUGGESTIONS = ['Analyze build logs', 'Why did the deploy fail?', 'Show system status'];

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [content]);

  return (
    <button
      data-testid="copy-message"
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 p-1 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle/80 opacity-0 group-hover/msg:opacity-100 transition-all"
      title="Copy message"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
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

  const grouped = groupItems(assistantItems);

  return (
    <div className="w-full md:w-[380px] shrink-0 flex flex-col bg-bg-panel min-h-0">
      {/* AI Panel Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[hsl(var(--border))] text-agent">
        <Brain className="h-4 w-4" />
        <span className="text-sm font-display font-medium">AI Assistant</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {assistantItems.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
              <div className="h-14 w-14 rounded-full bg-agent/10 flex items-center justify-center">
                <Brain className="h-7 w-7 text-agent" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-display font-medium text-primary-ol">How can I help?</p>
                <p className="text-xs font-body text-muted-ol max-w-[220px] leading-relaxed">
                  Ask me to analyze logs, fix errors, or explain your deployment.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSendMessage(s)}
                    className="px-3 py-1.5 text-xs font-body text-agent bg-agent/5 hover:bg-agent/10 border border-agent/20 rounded-full transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {grouped.map((entry) => {
            // Tool call group (collapsed)
            if ('type' in entry && entry.type === 'tool_group') {
              return <CollapsedToolGroup key={entry.id} items={entry.items} />;
            }

            const item = entry as AssistantItem;

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

            if (item.type === 'question' && item.questions && item.questionId) {
              return (
                <div key={item.id} className="my-3">
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
            const time = formatMessageTime(item.timestamp);

            return (
              <div
                key={item.id}
                data-testid={isUser ? 'user-message' : 'ai-message'}
                className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : 'flex-row')}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'shrink-0 w-7 h-7 rounded-full flex items-center justify-center border mt-0.5',
                    isUser
                      ? 'bg-bg-subtle border-[hsl(var(--border))] text-secondary-ol'
                      : 'bg-agent/10 border-agent/20 text-agent',
                  )}
                >
                  {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>

                {/* Message bubble */}
                <div
                  className={cn(
                    'relative max-w-[85%] group/msg',
                    isUser ? 'text-right' : 'text-left',
                  )}
                >
                  <div
                    className={cn(
                      'px-3 py-2 rounded-xl text-sm font-body leading-relaxed',
                      isUser
                        ? 'bg-bg-subtle text-primary-ol rounded-tr-sm'
                        : 'bg-agent/5 border border-agent/10 text-primary-ol rounded-tl-sm',
                    )}
                  >
                    {isUser || item.type === 'text_delta' ? (
                      <span className="whitespace-pre-wrap">{item.content}</span>
                    ) : (
                      <MarkdownMessage content={item.content || ''} />
                    )}
                  </div>

                  {/* Copy button (AI messages only) */}
                  {!isUser && item.type !== 'text_delta' && item.content && (
                    <CopyButton content={item.content} />
                  )}

                  {/* Timestamp */}
                  {time && (
                    <span
                      className={cn(
                        'block mt-1 text-[10px] font-mono text-muted-ol',
                        isUser ? 'text-right pr-1' : 'text-left pl-1',
                      )}
                    >
                      {time}
                    </span>
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
        <div className="px-4 py-1.5 bg-bg-panel border-t border-[hsl(var(--border))] flex items-center justify-center gap-1">
          <Info className="h-3 w-3 text-muted-ol" />
          <span
            className="text-[10px] font-body text-muted-ol"
            title="Responses are generated by your configured LLM provider. AI can make mistakes — verify important information."
          >
            Uses your LLM tokens
          </span>
        </div>
      </div>
    </div>
  );
}
