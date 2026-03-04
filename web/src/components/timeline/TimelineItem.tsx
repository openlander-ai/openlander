import type { TimelineItem as TItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { ExternalLink, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { InputRequestCard, type QuestionAnswerPayload } from './InputRequestCard';

interface TimelineItemProps {
  item: TItem;
  isLatest?: boolean;
  onFixWithAI?: () => void;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function TimelineItemCard({
  item,
  isLatest,
  onFixWithAI,
  onSubmitAnswer,
  onSkipQuestion,
}: TimelineItemProps) {
  const isProgress = item.type === 'progress';
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isQuestion = item.type === 'question';

  // Question items render via InputRequestCard
  if (isQuestion && item.questionId && item.questions) {
    return (
      <InputRequestCard
        questionId={item.questionId}
        questions={item.questions}
        answered={item.answered}
        onSubmit={onSubmitAnswer ?? (() => {})}
        onSkip={onSkipQuestion ?? (() => {})}
      />
    );
  }

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg transition-all duration-300 timeline-item-enter',
        isLatest && isProgress && 'bg-bg-subtle/50',
        isSuccess && 'bg-success/5 glow-success',
        isError && 'bg-error/5',
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        {isProgress && (
          <div className={cn('p-1 rounded-md', isLatest ? 'bg-agent/15' : 'bg-bg-subtle')}>
            <Loader2 className={cn('h-3.5 w-3.5 text-agent', isLatest && 'animate-spin')} />
          </div>
        )}
        {isSuccess && (
          <div className="p-1 rounded-md bg-success/15">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          </div>
        )}
        {isError && (
          <div className="p-1 rounded-md bg-error/15">
            <AlertCircle className="h-3.5 w-3.5 text-error" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-body leading-snug',
              isSuccess && 'text-success',
              isError && 'text-error',
              isProgress && 'text-primary-ol',
            )}
          >
            {item.title}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {/* Progress Bar */}
        {isProgress && item.percent >= 0 && (
          <div className="mt-2 h-1 w-full rounded-full bg-bg-subtle overflow-hidden">
            <div
              className="h-full rounded-full bg-agent transition-all duration-700 ease-out"
              style={{ width: `${item.percent}%` }}
            />
          </div>
        )}

        {/* Success URL */}
        {isSuccess && item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-1.5 text-xs font-mono text-agent hover:text-agent/80 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {item.url.replace(/^https?:\/\//, '')}
          </a>
        )}

        {/* Error Action */}
        {isError && onFixWithAI && (
          <button
            onClick={onFixWithAI}
            className="mt-2 px-2.5 py-1 rounded text-[11px] font-body bg-error/10 text-error hover:bg-error/20 border border-error/20 transition-colors"
          >
            Fix with AI
          </button>
        )}
      </div>
    </div>
  );
}
