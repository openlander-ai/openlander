import { useEffect, useRef, useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown, Bot, User, Copy, Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';

import type { TimelineItem } from '@/lib/event-types';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

import { TimelineItemCard } from '@/components/timeline/TimelineItem';
import { ChatInput } from '@/components/assistant/ChatInput';
import { UserActionCard } from '@/components/assistant/UserActionCard';
import { InputRequestCard } from '@/components/timeline/InputRequestCard';
import { MarkdownMessage } from '@/components/assistant/MarkdownMessage';
import { CollapsedToolGroup } from '@/components/assistant/ToolCallGroup';
import { ThinkingIndicator } from '@/components/assistant/ThinkingIndicator';
import { mergeUnifiedFeed } from './unified-feed-utils';

interface UnifiedBriefingFeedProps {
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  projectStatus?: string;
  fixingItemId?: string | null;
  onFixWithAI?: (errorMessage?: string, timelineItemId?: string) => void;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onInsightAction: (projectId: string, action: string) => Promise<void>;

  assistantItems: AssistantItem[];
  isAssistantStreaming: boolean;
  onSendMessage: (message: string) => void;
}

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
      className="absolute top-1.5 right-1.5 p-1 rounded-md text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle/80 opacity-0 group-hover/msg:opacity-100"
      title="Copy message"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function UnifiedBriefingFeed({
  timelineItems,
  isTimelineStreaming,
  projectStatus,
  fixingItemId,
  onFixWithAI,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
  assistantItems,
  isAssistantStreaming,
  onSendMessage,
}: UnifiedBriefingFeedProps) {
  const { t, language } = useLanguage();
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());

  const handleDismissAction = (id: string) => {
    setDismissedActions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!autoFollow) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timelineItems, assistantItems, autoFollow]);

  // Detect manual scroll up → disable auto-follow
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null;
    if (!viewport) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 60;
      setAutoFollow(isNearBottom);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  const unifiedItems = mergeUnifiedFeed(timelineItems, assistantItems);

  const progressItems = timelineItems.filter((item) => item.type === 'progress');
  const latestProgress = progressItems.length > 0 ? progressItems[progressItems.length - 1] : null;
  const lastThinkingId = [...assistantItems].reverse().find((i) => i.type === 'thinking')?.id;

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-panel" data-testid="unified-briefing-feed">
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4 relative">
          {/* Vertical connector line for timeline items */}
          <div className="absolute left-[29px] top-6 bottom-6 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent pointer-events-none" />

          {/* Progress Header */}
          {latestProgress &&
            projectStatus !== 'running' &&
            projectStatus !== 'stopped' &&
            projectStatus !== 'error' && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-white/5 relative z-10">
                <div className="flex justify-between items-center text-[10px] font-mono text-agent/80 uppercase tracking-wider mb-2">
                  <span>{'System Progress'}</span>
                  <span>{latestProgress.percent}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-bg-subtle overflow-hidden border border-white/5 relative">
                  <div
                    className="absolute top-0 left-0 h-full rounded-full bg-agent progress-stripes progress-glow"
                    style={{ width: `${latestProgress.percent}%` }}
                  />
                </div>
                {latestProgress.stepName && (
                  <div className="mt-3 text-xs font-mono text-muted-ol space-y-1">
                    <div className="flex gap-2 items-center flex-wrap">
                      {['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'].map(
                        (step) => (
                          <div key={step} className="flex items-center gap-1">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-mono',
                                latestProgress.stepName === step
                                  ? 'bg-agent/30 text-agent font-semibold'
                                  : 'text-muted-ol',
                              )}
                            >
                              {step}
                            </span>
                            {step !== 'Complete' && <span className="text-muted-ol">→</span>}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xs font-body text-primary-ol">{latestProgress.title}</div>
              </div>
            )}

          {/* Status Badge */}
          {projectStatus && ['running', 'stopped', 'error'].includes(projectStatus) && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-white/5 flex items-center gap-3 relative z-10">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  projectStatus === 'running'
                    ? 'bg-success'
                    : projectStatus === 'stopped'
                      ? 'bg-muted-ol'
                      : 'bg-error',
                )}
              />
              <span className="text-xs font-mono uppercase tracking-wider text-primary-ol">
                {projectStatus}
              </span>
            </div>
          )}

          {unifiedItems.map((uItem, index) => {
            if (uItem.type === 'timeline') {
              const isLatest = index === unifiedItems.length - 1 && isTimelineStreaming;
              return (
                <div key={uItem.item.id} className="relative z-10">
                  <TimelineItemCard
                    item={uItem.item}
                    isLatest={isLatest}
                    onFixWithAI={
                      uItem.item.type === 'error'
                        ? () => onFixWithAI?.(uItem.item.title, uItem.item.id)
                        : undefined
                    }
                    isFixWithAILoading={fixingItemId === uItem.item.id}
                    onSubmitAnswer={onSubmitAnswer}
                    onSkipQuestion={onSkipQuestion}
                    onInsightAction={onInsightAction}
                  />
                </div>
              );
            }

            if (uItem.type === 'assistant_group') {
              return (
                <div key={uItem.id} className="relative z-10 ml-10">
                  <CollapsedToolGroup items={uItem.items} />
                </div>
              );
            }

            const item = uItem.item;

            if (item.type === 'needs_user_action') {
              if (dismissedActions.has(item.id)) return null;
              return (
                <div key={item.id} className="relative z-10 ml-10">
                  <UserActionCard
                    category={item.category || 'Action Required'}
                    message={item.content || ''}
                    detail={item.detail}
                    locale={language}
                    onDismiss={() => handleDismissAction(item.id)}
                  />
                </div>
              );
            }

            if (item.type === 'thinking') {
              if (!isAssistantStreaming || item.id !== lastThinkingId) return null;
              return (
                <div key={item.id} className="relative z-10 ml-10">
                  <ThinkingIndicator />
                </div>
              );
            }

            if (item.type === 'question' && item.questions && item.questionId) {
              return (
                <div key={item.id} className="my-3 relative z-10 ml-10">
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
                  className="p-3 rounded-lg bg-error/10 border border-error/20 text-error text-sm font-body relative z-10 ml-10"
                >
                  {item.content}
                </div>
              );
            }

            // Message or text_delta
            const isUser = item.role === 'user';
            const timeStr = item.timestamp ? formatTime(item.timestamp) : '';
            const time = timeStr ? timeStr.split(':').slice(0, 2).join(':') : '';

            return (
              <div
                key={item.id}
                data-testid={isUser ? 'user-message' : 'ai-message'}
                className={cn(
                  'flex gap-2.5 relative z-10 ml-10',
                  isUser ? 'flex-row-reverse' : 'flex-row',
                )}
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

          {/* Streaming indicator for timeline */}
          {isTimelineStreaming && timelineItems.length > 0 && (
            <div className="flex items-center gap-4 py-4 px-5 relative overflow-hidden rounded-lg border border-agent/10 bg-agent/5 mt-2 z-10">
              <div className="absolute inset-0 bg-grid-pattern opacity-20" />
              <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-agent/50 to-transparent scanline" />

              <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-agent/10 border border-agent/20 shrink-0">
                <div className="absolute inset-0 rounded-full border border-agent/30" />
                <div className="w-2 h-2 rounded-full bg-agent" />
              </div>

              <div className="relative flex flex-col">
                <span className="text-xs font-mono text-agent/90 uppercase tracking-widest flex items-center gap-2">
                  {'System Active'}
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-agent/70" />
                    <span className="w-1 h-1 rounded-full bg-agent/70" />
                    <span className="w-1 h-1 rounded-full bg-agent/70" />
                  </span>
                </span>
                <span className="text-[10px] font-mono text-muted-ol mt-0.5">
                  {t('timeline.awaitingInstruction')}
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Follow button when scrolled up */}
      {!autoFollow && (isTimelineStreaming || isAssistantStreaming) && (
        <button
          onClick={() => {
            setAutoFollow(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className={cn(
            'absolute bottom-20 left-1/2 -translate-x-1/2 z-20',
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'bg-bg-panel border border-[hsl(var(--border))] shadow-lg',
            'text-[11px] font-body text-secondary-ol hover:text-primary-ol',
          )}
        >
          <ArrowDown className="h-3 w-3" />
          {'Follow'}
        </button>
      )}

      {/* Footer / Input */}
      <div className="shrink-0 relative border-t border-[hsl(var(--border))]">
        <ChatInput
          onSend={onSendMessage}
          disabled={isAssistantStreaming}
          placeholder="Ask AI Assistant..."
        />
        <div
          className="absolute top-1 right-1 p-1"
          title="Uses your LLM tokens. Responses are generated by your configured LLM provider. AI can make mistakes — verify important information."
        >
          <Info className="h-3 w-3 text-muted-ol hover:text-primary-ol cursor-help" />
        </div>
      </div>
    </div>
  );
}
