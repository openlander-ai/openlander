import type { TimelineItem as TItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import {
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Wrench,
  MessageCircle,
  Activity,
} from 'lucide-react';
import { InputRequestCard, type QuestionAnswerPayload } from './InputRequestCard';
import { InsightCard } from './InsightCard';
import { DockerfileFixedCard } from './DockerfileFixedCard';
import { ToolResultCard } from './ToolResultCard';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';
import { FixProposalCard } from './FixProposalCard';
import { ComposeErrorCard } from './ComposeErrorCard';

interface TimelineItemProps {
  item: TItem;
  isLatest?: boolean;
  onFixWithAI?: () => void;
  isFixWithAILoading?: boolean;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
  onInsightAction?: (projectId: string, action: string) => Promise<void>;
}
function cleanMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, '[Code Block]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .trim();
}

export function TimelineItemCard({
  item,
  isLatest,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
}: TimelineItemProps) {
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isQuestion = item.type === 'question';
  const isInsight = item.type === 'insight';
  const isDockerfileFix = item.type === 'dockerfile_fixed';
  const isAgentThinking = item.type === 'agent_thinking';
  const isAgentToolCall = item.type === 'agent_tool_call';
  const isAgentToolResult = item.type === 'agent_tool_result';
  const isAgentMessage = item.type === 'agent_message';
  const isAgentEvent = isAgentThinking || isAgentToolCall || isAgentToolResult || isAgentMessage;

  if (isInsight) {
    return <InsightCard item={item} onAction={onInsightAction} />;
  }

  if (isDockerfileFix) {
    return <DockerfileFixedCard item={item} />;
  }

  if (isAgentToolResult) {
    if (
      item.toolName === 'error-analysis' ||
      item.toolName === 'error_analysis' ||
      item.toolName === 'debug_build_error'
    ) {
      return <ErrorAnalysisCard item={item} />;
    }
    return <ToolResultCard item={item} />;
  }

  if (isQuestion && item.questionId && item.questions) {
    const hasFixProposal = item.questions.some((q) => q.metadata?.fixType);
    const isComposeFix = item.questions.some((q) => q.metadata?.fixType === 'compose');

    if (isComposeFix) {
      return (
        <ComposeErrorCard
          questionId={item.questionId}
          questions={item.questions}
          answered={item.answered}
          onSubmit={onSubmitAnswer ?? (() => {})}
          onSkip={onSkipQuestion ?? (() => {})}
        />
      );
    }

    if (hasFixProposal) {
      return (
        <FixProposalCard
          questionId={item.questionId}
          questions={item.questions}
          answered={item.answered}
          onSubmit={onSubmitAnswer ?? (() => {})}
          onSkip={onSkipQuestion ?? (() => {})}
        />
      );
    }
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
        isLatest && isAgentEvent && 'bg-agent/5 border-agent/10 glow-agent',
        isSuccess && 'bg-success/5 border-success/10 glow-success',
        isError && 'bg-error/5 border-error/10 glow-error',
        !isLatest && !isSuccess && !isError && !isAgentEvent && 'hover:bg-bg-subtle/20',
        isAgentEvent && !isLatest && 'bg-agent/5 border-agent/10',
      )}
    >
      <div className="shrink-0 mt-0.5 relative z-10">
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
          <div className="mt-1 flex items-center justify-center w-4 h-4">
            <div
              className={cn('w-1.5 h-1.5 rounded-full bg-agent/50', isLatest && 'animate-pulse')}
            />
          </div>
        )}
        {isAgentToolCall && (
          <div className="mt-1 flex items-center justify-center w-4 h-4">
            <Wrench className="h-3 w-3 text-agent/50" />
          </div>
        )}
        {isAgentMessage && (
          <div className="mt-1 flex items-center justify-center w-4 h-4">
            <MessageCircle className="h-3 w-3 text-agent/70" />
          </div>
        )}
        {!isSuccess && !isError && !isAgentEvent && (
          <div className="p-1.5 rounded-md bg-bg-subtle/50 border border-white/5">
            <Activity className="h-3.5 w-3.5 text-secondary-ol" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-body leading-snug whitespace-pre-wrap',
              isSuccess && 'text-success font-medium',
              isError && 'text-error font-medium line-clamp-3',
              isAgentEvent && 'text-agent/90',
              isAgentThinking && 'text-sm text-secondary-ol',
              isAgentToolCall && 'text-xs text-agent/70',
              isAgentMessage && 'text-sm text-primary-ol',
            )}
            title={isError ? item.title : undefined}
          >
            {isAgentToolCall
              ? `▸ ${item.toolName || 'tool'} 실행`
              : isAgentMessage || isAgentThinking
                ? item.title
                : isAgentEvent
                  ? cleanMarkdown(item.title)
                  : item.title}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5 opacity-70">
            {formatTime(item.timestamp)}
          </span>
        </div>

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

        {isAgentToolCall && item.toolArguments && Object.keys(item.toolArguments).length > 0 && (
          <details className="mt-2 group/args">
            <summary className="text-[11px] font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
              Arguments ▾
            </summary>
            <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(item.toolArguments, null, 2)}
            </pre>
          </details>
        )}

        {isError && item.detail && (
          <details className="mt-2 group/log">
            <summary className="text-[11px] font-mono text-error/70 cursor-pointer hover:text-error transition-colors select-none">
              Build log ▾
            </summary>
            <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-error/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
              {item.detail.slice(-2000)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
