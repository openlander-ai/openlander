import { useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import type { QuestionData } from '@/lib/event-types';
import { Wrench, Check, X } from 'lucide-react';
import type { QuestionAnswerPayload } from './InputRequestCard';

interface FixProposalCardProps {
  questionId: string;
  questions: QuestionData[];
  answered?: boolean;
  onSubmit: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkip: (questionId: string) => void;
}

function computeLineDiff(before: string, after: string) {
  if (!before && !after) return [];

  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start++;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore--;
    endAfter--;
  }

  const diff: { type: 'unchanged' | 'removed' | 'added'; text: string }[] = [];

  for (let i = 0; i < start; i++) {
    diff.push({ type: 'unchanged', text: beforeLines[i] });
  }
  for (let i = start; i <= endBefore; i++) {
    diff.push({ type: 'removed', text: beforeLines[i] });
  }
  for (let i = start; i <= endAfter; i++) {
    diff.push({ type: 'added', text: afterLines[i] });
  }
  for (let i = endBefore + 1; i < beforeLines.length; i++) {
    diff.push({ type: 'unchanged', text: beforeLines[i] });
  }

  return diff;
}

export function FixProposalCard({
  questionId,
  questions,
  answered,
  onSubmit,
  onSkip,
}: FixProposalCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useLanguage();

  const handleApprove = useCallback(() => {
    setIsSubmitting(true);
    const answers: QuestionAnswerPayload[] = questions.map((q, i) => {
      const approveOption = q.options.find(
        (o) =>
          o.label.toLowerCase().includes('approve') ||
          o.label.toLowerCase().includes('yes') ||
          o.label.toLowerCase().includes('apply'),
      );
      return {
        questionIndex: i,
        selectedLabels: approveOption ? [approveOption.label] : [q.options[0]?.label || 'Approve'],
      };
    });
    onSubmit(questionId, answers);
  }, [questions, questionId, onSubmit]);

  const handleReject = useCallback(() => {
    setIsSubmitting(true);
    const answers: QuestionAnswerPayload[] = questions.map((q, i) => {
      const rejectOption = q.options.find(
        (o) =>
          o.label.toLowerCase().includes('reject') ||
          o.label.toLowerCase().includes('no') ||
          o.label.toLowerCase().includes('skip'),
      );
      return {
        questionIndex: i,
        selectedLabels: rejectOption ? [rejectOption.label] : [q.options[1]?.label || 'Reject'],
      };
    });
    onSubmit(questionId, answers);
  }, [questions, questionId, onSubmit]);

  const handleSkip = useCallback(() => {
    setIsSubmitting(true);
    onSkip(questionId);
  }, [questionId, onSkip]);

  if (answered) {
    return (
      <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-agent/5 border border-agent/10">
        <div className="shrink-0 mt-0.5">
          <div className="p-1 rounded-md bg-agent/15">
            <Check className="h-3.5 w-3.5 text-agent" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-body text-muted-ol">{t('timeline.fixProposal.answered')}</p>
        </div>
      </div>
    );
  }

  const q = questions[0];
  if (!q) return null;

  const metadata = q.metadata || {};
  const before = typeof metadata.before === 'string' ? metadata.before : '';
  const after = typeof metadata.after === 'string' ? metadata.after : '';
  const filePath = typeof metadata.filePath === 'string' ? metadata.filePath : '';
  const explanation = typeof metadata.explanation === 'string' ? metadata.explanation : '';
  const changes = Array.isArray(metadata.changes) ? metadata.changes : [];

  return (
    <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-agent/5 border border-agent/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="shrink-0 mt-0.5">
        <div className="p-1.5 rounded-md bg-agent/15">
          <Wrench className="h-3.5 w-3.5 text-agent" />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium font-body text-agent leading-snug">
              {t('timeline.fixProposal.title')}
            </p>
            {filePath && (
              <span className="text-[10px] font-mono text-agent/80 px-1.5 py-0.5 bg-agent/10 rounded border border-agent/20">
                {filePath}
              </span>
            )}
          </div>
          <p className="text-sm font-body text-primary-ol leading-snug">{q.question}</p>
          {explanation && (
            <p className="text-xs font-body text-secondary-ol leading-relaxed mt-1.5">
              {explanation}
            </p>
          )}
        </div>

        {changes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">
              {t('timeline.fixProposal.changes')}
            </p>
            <ul className="space-y-1">
              {changes.map((change: unknown, i: number) => (
                <li key={i} className="text-xs text-secondary-ol flex items-start gap-1.5">
                  <span className="text-agent mt-0.5">•</span>
                  <span>{String(change)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(before || after) && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">
              {t('timeline.fixProposal.diff')}
            </p>
            <div className="bg-[#0a0a0a] rounded-md border border-border overflow-hidden">
              <details className="group/diff" open={computeLineDiff(before, after).length < 20}>
                <summary className="text-[11px] font-mono text-muted-ol bg-bg-subtle px-3 py-2 cursor-pointer hover:text-primary-ol transition-colors select-none border-b border-border">
                  {t('timeline.fixProposal.diff')} (Click to toggle)
                </summary>
                <div className="p-2.5 overflow-x-auto max-h-96">
                  <pre className="text-[11px] font-mono leading-relaxed">
                    {computeLineDiff(before, after).map((line, i) => (
                      <div
                        key={i}
                        className={cn(
                          'px-2 py-0.5 rounded-sm whitespace-pre',
                          line.type === 'added' && 'bg-success/10 text-success',
                          line.type === 'removed' && 'bg-error/10 text-error',
                          line.type === 'unchanged' && 'text-muted-ol',
                        )}
                      >
                        <span className="inline-block w-4 select-none opacity-50">
                          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                        </span>
                        {line.text || ' '}
                      </div>
                    ))}
                  </pre>
                </div>
              </details>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 flex-wrap">
          <button
            onClick={handleApprove}
            disabled={isSubmitting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body font-medium',
              'bg-agent text-bg-app hover:bg-agent/90',
              'transition-colors',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {t('timeline.fixProposal.approve')}
          </button>
          <button
            onClick={handleReject}
            disabled={isSubmitting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
              'bg-bg-subtle/50 text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle border border-border',
              'transition-colors',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            <X className="h-3.5 w-3.5" />
            {t('timeline.fixProposal.reject')}
          </button>
          {q.options.some(
            (o) =>
              o.label.toLowerCase().includes('alternative') ||
              o.label.toLowerCase().includes('other options'),
          ) && (
            <button
              onClick={() => {
                setIsSubmitting(true);
                const altOption = q.options.find(
                  (o) =>
                    o.label.toLowerCase().includes('alternative') ||
                    o.label.toLowerCase().includes('other options'),
                );
                if (altOption) {
                  onSubmit(questionId, [{ questionIndex: 0, selectedLabels: [altOption.label] }]);
                }
              }}
              disabled={isSubmitting}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
                'text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle',
                'transition-colors',
                isSubmitting && 'opacity-50 cursor-not-allowed',
              )}
            >
              {t('timeline.fixProposal.showAlternatives')}
            </button>
          )}
          <button
            onClick={handleSkip}
            disabled={isSubmitting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
              'text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle',
              'transition-colors',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            {t('timeline.fixProposal.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
