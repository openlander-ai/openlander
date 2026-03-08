import { useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import type { QuestionData } from '@/lib/event-types';
import { MessageCircleQuestion, Send, SkipForward, Check } from 'lucide-react';

interface InputRequestCardProps {
  questionId: string;
  questions: QuestionData[];
  answered?: boolean;
  onSubmit: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkip: (questionId: string) => void;
}

export interface QuestionAnswerPayload {
  questionIndex: number;
  selectedLabels: string[];
  customText?: string;
}

export function InputRequestCard({
  questionId,
  questions,
  answered,
  onSubmit,
  onSkip,
}: InputRequestCardProps) {
  const [selections, setSelections] = useState<Map<number, Set<string>>>(new Map());
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t } = useLanguage();

  const toggleOption = useCallback((qIndex: number, label: string, multiple: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(qIndex) ?? []);
      if (multiple) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      next.set(qIndex, current);
      return next;
    });
  }, []);

  const setCustomText = useCallback((qIndex: number, text: string) => {
    setCustomTexts((prev) => {
      const next = new Map(prev);
      next.set(qIndex, text);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    setIsSubmitting(true);
    const answers: QuestionAnswerPayload[] = questions.map((_q, i) => ({
      questionIndex: i,
      selectedLabels: Array.from(selections.get(i) ?? []),
      customText: customTexts.get(i) || undefined,
    }));
    onSubmit(questionId, answers);
  }, [questions, selections, customTexts, questionId, onSubmit]);

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
          <p className="text-sm font-body text-muted-ol">{'Question answered'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className="p-1 rounded-md bg-warning/15">
          <MessageCircleQuestion className="h-3.5 w-3.5 text-warning" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-3">
        {questions.map((q, qIndex) => (
          <div key={qIndex} className="space-y-2">
            {/* Question header */}
            {q.header && (
              <p className="text-[11px] font-mono text-muted-ol uppercase tracking-wider">
                {q.header}
              </p>
            )}

            {/* Question text */}
            <p className="text-sm font-body text-primary-ol leading-snug">{q.question}</p>

            {/* Options (radio/checkbox style) */}
            {q.options.length > 0 && (
              <div className="space-y-1">
                {q.options.map((opt) => {
                  const selected = selections.get(qIndex)?.has(opt.label) ?? false;
                  return (
                    <button
                      key={opt.label}
                      disabled={isSubmitting}
                      onClick={() => toggleOption(qIndex, opt.label, q.multiple ?? false)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-md text-sm font-body transition-all duration-150',
                        'border',
                        selected
                          ? 'bg-agent/10 border-agent/30 text-primary-ol'
                          : 'bg-bg-subtle/50 border-border hover:border-agent/20 text-secondary-ol',
                        isSubmitting && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {/* Indicator */}
                        <span
                          className={cn(
                            'shrink-0 w-3.5 h-3.5 border flex items-center justify-center transition-colors',
                            q.multiple ? 'rounded-[3px]' : 'rounded-full',
                            selected ? 'border-agent bg-agent' : 'border-muted-ol',
                          )}
                        >
                          {selected && (
                            <Check className="h-2.5 w-2.5 text-bg-app" strokeWidth={3} />
                          )}
                        </span>
                        <span>{opt.label}</span>
                      </span>
                      {opt.description && (
                        <span className="block ml-[22px] text-[11px] text-muted-ol mt-0.5">
                          {opt.description}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Custom text input (always available as fallback) */}
            <input
              type="text"
              placeholder={t('timeline.typeAnswer')}
              disabled={isSubmitting}
              value={customTexts.get(qIndex) ?? ''}
              onChange={(e) => setCustomText(qIndex, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              className={cn(
                'w-full px-3 py-2 rounded-md text-sm font-body',
                'bg-bg-app border border-border placeholder:text-muted-ol',
                'focus:outline-none focus:ring-1 focus:ring-agent/40 focus:border-agent/30',
                'transition-colors',
                isSubmitting && 'opacity-50 cursor-not-allowed',
              )}
            />
          </div>
        ))}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body font-medium',
              'bg-agent text-bg-app hover:bg-agent/90',
              'transition-colors',
              isSubmitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Send className="h-3 w-3" />
            {'Submit'}
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
            <SkipForward className="h-3 w-3" />
            {'Skip'}
          </button>
        </div>
      </div>
    </div>
  );
}
