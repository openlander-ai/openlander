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
          <p className="text-sm font-body text-muted-ol">{'Fix proposal answered'}</p>
        </div>
      </div>
    );
  }

  const q = questions[0];
  if (!q) return null;

  const metadata = q.metadata || {};
  const before = typeof metadata.before === 'string' ? metadata.before : '';
  const after = typeof metadata.after === 'string' ? metadata.after : '';

  return (
    <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-agent/5 border border-agent/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="shrink-0 mt-0.5">
        <div className="p-1.5 rounded-md bg-agent/15">
          <Wrench className="h-3.5 w-3.5 text-agent" />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium font-body text-agent leading-snug">
            {t('timeline.fixProposal.title')}
          </p>
          <p className="text-sm font-body text-primary-ol leading-snug">{q.question}</p>
        </div>

        {(before || after) && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">
              {t('timeline.fixProposal.diff')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {before && (
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-error/80 px-1.5 py-0.5 bg-error/10 rounded">
                    Before
                  </span>
                  <pre className="text-[11px] font-mono text-error/90 bg-error/5 p-2.5 rounded border border-error/10 overflow-x-auto whitespace-pre-wrap break-all">
                    {before}
                  </pre>
                </div>
              )}
              {after && (
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-success/80 px-1.5 py-0.5 bg-success/10 rounded">
                    After
                  </span>
                  <pre className="text-[11px] font-mono text-success/90 bg-success/5 p-2.5 rounded border border-success/10 overflow-x-auto whitespace-pre-wrap break-all">
                    {after}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
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
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
