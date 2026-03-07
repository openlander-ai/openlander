import type { TimelineItem as TItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Brain,
  Wrench,
  MessageCircle,
} from 'lucide-react';
import { InputRequestCard, type QuestionAnswerPayload } from './InputRequestCard';
import { InsightCard } from './InsightCard';
import { DockerfileFixedCard } from './DockerfileFixedCard';

interface TimelineItemProps {
  item: TItem;
  isLatest?: boolean;
  onFixWithAI?: () => void;
  isFixWithAILoading?: boolean;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
  onInsightAction?: (projectId: string, action: string) => Promise<void>;
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
  isFixWithAILoading,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
}: TimelineItemProps) {
  const isProgress = item.type === 'progress';
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isQuestion = item.type === 'question';
  const isInsight = item.type === 'insight';
  const isDockerfileFix = item.type === 'dockerfile_fixed';
  const isAgentThinking = item.type === 'agent_thinking';
  const isAgentToolCall = item.type === 'agent_tool_call';
  const isAgentMessage = item.type === 'agent_message';
  const isAgentEvent = isAgentThinking || isAgentToolCall || isAgentMessage;

  // Insight items render via InsightCard
  if (isInsight) {
    return <InsightCard item={item} onAction={onInsightAction} />;
  }

  // Dockerfile fix items render via DockerfileFixedCard
  if (isDockerfileFix) {
    return <DockerfileFixedCard item={item} />;
  }

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
        'relative flex gap-3.5 py-3.5 px-4 rounded-lg transition-all duration-300 timeline-item-enter border border-transparent',
        isLatest && isProgress && 'bg-bg-subtle/40 border-white/5',
        isLatest && isAgentEvent && 'bg-agent/5 border-agent/10 glow-agent',
        isSuccess && 'bg-success/5 border-success/10 glow-success',
        isError && 'bg-error/5 border-error/10 glow-error',
        !isLatest && !isSuccess && !isError && 'hover:bg-bg-subtle/20',
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5 relative z-10">
        {isProgress && (
          <div
            className={cn(
              'p-1.5 rounded-md border',
              isLatest ? 'bg-agent/10 border-agent/20' : 'bg-bg-subtle border-white/5',
            )}
          >
            <Loader2 className={cn('h-3.5 w-3.5 text-agent', isLatest && 'animate-spin')} />
          </div>
        )}
        {isSuccess && (
          <div className="p-1.5 rounded-md bg-success/10 border border-success/20 relative">
            <div className="absolute inset-0 rounded-md bg-success/20 animate-ping opacity-20" />
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          </div>
        )}
        {isError && (
          <div className="p-1.5 rounded-md bg-error/10 border border-error/20">
            <AlertCircle className="h-3.5 w-3.5 text-error" />
          </div>
        )}
        {isAgentThinking && (
          <div className={cn('p-1.5 rounded-md bg-agent/10 border border-agent/20 relative')}>
            {isLatest && (
              <div className="absolute inset-0 rounded-md bg-agent/20 animate-ping opacity-20" />
            )}
            <Brain className={cn('h-3.5 w-3.5 text-agent', isLatest && 'animate-pulse')} />
          </div>
        )}
        {isAgentToolCall && (
          <div className="p-1.5 rounded-md bg-agent/10 border border-agent/20">
            <Wrench className="h-3.5 w-3.5 text-agent" />
          </div>
        )}
        {isAgentMessage && (
          <div className="p-1.5 rounded-md bg-agent/10 border border-agent/20">
            <MessageCircle className="h-3.5 w-3.5 text-agent" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-body leading-snug',
              isSuccess && 'text-success font-medium',
              isError && 'text-error font-medium',
              isProgress && 'text-primary-ol',
              isAgentEvent && 'text-agent/90',
            )}
          >
            {item.title}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5 opacity-70">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {/* Progress Bar */}
        {isProgress && item.percent >= 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] font-mono text-agent/80 uppercase tracking-wider">
              <span>System Progress</span>
              <span>{item.percent}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-bg-subtle overflow-hidden border border-white/5 relative">
              <div
                className="absolute top-0 left-0 h-full rounded-full bg-agent progress-stripes progress-glow transition-all duration-700 ease-out"
                style={{ width: `${item.percent}%` }}
              />
            </div>
          </div>
        )}

        {/* Success URL */}
        {isSuccess && item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-md bg-success/10 border border-success/20 text-xs font-mono text-success hover:bg-success/20 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {item.url.replace(/^https?:\/\//, '')}
          </a>
        )}

        {/* Agent tool call arguments */}
        {isAgentToolCall && item.toolArguments && (
          <div className="mt-2 text-[11px] font-mono text-muted-ol bg-[#0a0a0a] border border-white/5 rounded-md p-2.5 overflow-hidden relative group">
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-agent/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center gap-2 mb-1.5 text-agent/70">
              <span className="w-1.5 h-1.5 rounded-full bg-agent/50 animate-pulse" />
              <span>Executing: {item.toolName || 'tool'}</span>
            </div>
            <div className="pl-3.5 border-l border-white/10 space-y-1">
              {Object.entries(item.toolArguments).map(([key, value]) => (
                <div key={key} className="truncate">
                  <span className="text-secondary-ol">{key}</span>
                  <span className="text-muted-ol mx-1">=</span>
                  <span className="text-primary-ol">
                    {typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Action */}
        {isError && onFixWithAI && (
          <button
            onClick={onFixWithAI}
            disabled={isFixWithAILoading}
            className={cn(
              'mt-3 px-3 py-1.5 rounded-md text-[11px] font-body border transition-colors flex items-center gap-1.5',
              isFixWithAILoading
                ? 'bg-error/5 text-error/60 border-error/10 cursor-not-allowed'
                : 'bg-error/10 text-error hover:bg-error/20 border-error/20',
            )}
          >
            {isFixWithAILoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wrench className="h-3 w-3" />
            )}
            {isFixWithAILoading ? 'Analyzing with AI...' : 'Fix with AI'}
          </button>
        )}
      </div>
    </div>
  );
}
