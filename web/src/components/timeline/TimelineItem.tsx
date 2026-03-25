import { useEffect, useMemo, useState } from 'react';
import type { TimelineItem as TItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import {
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Activity,
  Sparkles,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { InputRequestCard, type QuestionAnswerPayload } from './InputRequestCard';
import { ToolResultCard } from './ToolResultCard';
import { ComposeErrorCard } from './ComposeErrorCard';
import { RecoveryCard } from './RecoveryCard';
import { DiagnoseButton } from '@/components/agent/DiagnoseButton';

interface TimelineItemProps {
  item: TItem;
  isLatest?: boolean;
  isStreaming?: boolean;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
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
  isStreaming,
  onSubmitAnswer,
  onSkipQuestion,
}: TimelineItemProps) {
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const isQuestion = item.type === 'question';
  const isAgentThinking = item.type === 'agent_thinking';
  const isAgentToolCall = item.type === 'agent_tool_call';
  const isAgentToolResult = item.type === 'agent_tool_result';
  const isAgentMessage = item.type === 'agent_message';
  const isInsight = item.type === 'insight';
  const isRecoverySuccess = item.type === 'recovery_success';
  const isAgentEvent =
    isAgentThinking ||
    isAgentToolCall ||
    isAgentToolResult ||
    isAgentMessage ||
    isInsight ||
    isRecoverySuccess;
  const isRecoveryEvent = item.type.startsWith('recovery_');

  const isLatestStreaming = Boolean(isLatest && isStreaming);
  const isAgentInProgress = isAgentThinking || item.status === 'in_progress' || isLatestStreaming;
  const isAgentFailed = item.status === 'failed' || item.toolSuccess === false;
  const isAgentSucceeded =
    isRecoverySuccess ||
    item.status === 'success' ||
    (isAgentToolResult && item.toolSuccess === true);

  const isCollapsibleAgentEvent = isAgentEvent && !isAgentInProgress && !isAgentFailed;
  const shouldAutoCollapse = isCollapsibleAgentEvent && isAgentSucceeded;

  const [isCollapsed, setIsCollapsed] = useState<boolean>(shouldAutoCollapse);

  useEffect(() => {
    setIsCollapsed(shouldAutoCollapse);
  }, [item.id, shouldAutoCollapse]);

  const primaryText = useMemo(() => {
    if (isAgentToolCall) {
      return `▸ ${item.toolName || 'tool'} 실행`;
    }

    if (isAgentMessage) {
      return item.title;
    }

    if (isAgentThinking) {
      return item.content || item.title || '분석 중...';
    }

    if (isAgentEvent) {
      return cleanMarkdown(item.title);
    }

    return item.title;
  }, [isAgentToolCall, isAgentMessage, isAgentThinking, isAgentEvent, item]);

  const collapsedSummary = useMemo(() => {
    return `> ✦ ${primaryText.replace(/\s+/g, ' ').trim()}`;
  }, [primaryText]);

  if (isRecoveryEvent && !isRecoverySuccess) {
    return <RecoveryCard item={item} isLatest={isLatest} />;
  }

  if (isAgentToolResult) {
    return <ToolResultCard item={item} />;
  }

  if (isQuestion && item.questionId && item.questions) {
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
        isSuccess && 'bg-success/5 border-success/10 glow-success',
        isError && 'bg-error/5 border-error/10 glow-error',
        !isLatest && !isSuccess && !isError && !isAgentEvent && 'hover:bg-bg-subtle/20',
        isAgentEvent &&
          'border-0 border-l-2 border-agent bg-agent/[0.03] pl-3 py-2 my-2 rounded-l-none',
        isLatest && isAgentEvent && 'glow-agent',
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
        {isAgentEvent && (
          <div className="mt-1 flex items-center justify-center w-4 h-4">
            <Sparkles
              className={cn(
                'h-3.5 w-3.5 text-agent',
                isLatest && isAgentThinking && 'animate-breathe',
              )}
            />
          </div>
        )}
        {!isSuccess && !isError && !isAgentEvent && (
          <div className="p-1.5 rounded-md bg-bg-subtle/50 border border-border">
            <Activity className="h-3.5 w-3.5 text-secondary-ol" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        <div
          className={cn(
            'flex items-start justify-between gap-2',
            isCollapsibleAgentEvent && 'cursor-pointer',
          )}
          onClick={isCollapsibleAgentEvent ? () => setIsCollapsed((prev) => !prev) : undefined}
        >
          <p
            className={cn(
              'text-sm font-body leading-snug whitespace-pre-wrap',
              isSuccess && 'text-success font-medium',
              isError && 'text-error font-medium line-clamp-3',
              isAgentEvent && 'text-agent/90 font-sans text-[13px]',
              isCollapsed && isAgentEvent && 'line-clamp-1',
              isAgentThinking && 'text-secondary-ol',
              isAgentToolCall && 'text-agent/70',
              isAgentMessage && 'text-primary-ol',
            )}
            title={isError ? item.title : undefined}
          >
            {isCollapsed ? collapsedSummary : primaryText}
          </p>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {isCollapsibleAgentEvent && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsCollapsed((prev) => !prev);
                }}
                className="inline-flex items-center justify-center text-agent/70 hover:text-agent transition-colors cursor-pointer"
                aria-label={isCollapsed ? '이벤트 펼치기' : '이벤트 접기'}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <span className="text-xs font-mono text-muted-ol opacity-70">
              {formatTime(item.timestamp)}
            </span>
          </div>
        </div>

        {!isCollapsed && isSuccess && item.url && (
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

        {!isCollapsed &&
          isAgentToolCall &&
          item.toolArguments &&
          Object.keys(item.toolArguments).length > 0 && (
            <details className="mt-2 group/args">
              <summary className="text-xs font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
                Arguments ▾
              </summary>
              <pre className="mt-1.5 text-xs font-mono text-muted-ol bg-bg-terminal border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(item.toolArguments, null, 2)}
              </pre>
            </details>
          )}

        {!isCollapsed && isError && item.detail && (
          <details className="mt-2 group/log">
            <summary className="text-xs font-mono text-error/70 cursor-pointer hover:text-error transition-colors select-none">
              Build log ▾
            </summary>
            <pre className="mt-1.5 text-xs font-mono text-muted-ol bg-bg-terminal border border-error/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
              {item.detail.slice(-2000)}
            </pre>
          </details>
        )}

        {!isCollapsed && isError && (
          <DiagnoseButton
            className="mt-2"
            projectId={item.sourceProjectId}
            errorMessage={item.detail ?? item.title}
            logLines={item.detail ? item.detail.split('\n').slice(-40) : undefined}
          />
        )}
      </div>
    </div>
  );
}
