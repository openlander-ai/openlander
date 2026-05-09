import { useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import type { QuestionData } from '@/lib/event-types';
import { FileCode2, Check } from 'lucide-react';
import type { QuestionAnswerPayload } from './InputRequestCard';

interface ComposePattern {
  id: string;
  name: string;
  description: string;
  codeSnippet?: string;
  recommended?: boolean;
  pros?: string;
  cons?: string;
}

interface ComposeErrorCardProps {
  questionId: string;
  questions: QuestionData[];
  answered?: boolean;
  onSubmit: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkip: (questionId: string) => void;
}

export function ComposeErrorCard({
  questionId,
  questions,
  answered,
  onSubmit,
}: ComposeErrorCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [envVars, setEnvVars] = useState('');
  const { t } = useLanguage();

  const handleSelectPattern = useCallback(
    (patternId: string, patternName: string) => {
      setSelectedPatternId(patternId);
      setIsSubmitting(true);
      const answers: QuestionAnswerPayload[] = questions.map((q, i) => {
        const optionMatch = q.options.find((o) => o.label === patternId || o.label === patternName);
        const labelToSubmit = optionMatch ? optionMatch.label : patternId;

        return {
          questionIndex: i,
          selectedLabels: [labelToSubmit],
          customText: envVars.trim() || undefined,
        };
      });
      onSubmit(questionId, answers);
    },
    [questions, questionId, envVars, onSubmit],
  );

  if (answered) {
    return (
      <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-agent/5 border border-agent/10">
        <div className="shrink-0 mt-0.5">
          <div className="p-1 rounded-md bg-agent/15">
            <Check className="h-3.5 w-3.5 text-agent" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-body text-muted-foreground">
            {t('timeline.composeError.answered')}
          </p>
        </div>
      </div>
    );
  }

  const q = questions[0];
  if (!q) return null;

  const metadata = q.metadata || {};
  const patterns = (metadata.patterns as ComposePattern[]) || [];
  const errorType = metadata.errorType as string;

  return (
    <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-agent/5 border border-agent/20 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="shrink-0 mt-0.5">
        <div className="p-1.5 rounded-md bg-agent/15">
          <FileCode2 className="h-3.5 w-3.5 text-agent" />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium font-body text-agent leading-snug">
              {t('timeline.composeError.title')}
            </p>
            {errorType && (
              <span className="text-xs font-mono text-agent/80 px-1.5 py-0.5 bg-agent/10 rounded border border-agent/20">
                {errorType}
              </span>
            )}
          </div>
          <p className="text-sm font-body text-foreground leading-snug">{q.question}</p>
        </div>

        {errorType === 'env_file_missing' && (
          <div className="space-y-1.5 pt-2">
            <p className="text-xs font-mono text-agent/80 uppercase tracking-wider">
              {t('timeline.composeError.envVarsOptional')}
            </p>
            <textarea
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              disabled={isSubmitting}
              placeholder="KEY=VALUE&#10;ANOTHER_KEY=VALUE"
              className={cn(
                'w-full h-24 px-3 py-2 rounded-md text-xs font-mono',
                'bg-bg-terminal border border-agent/20 placeholder:text-muted-foreground/50',
                'focus:outline-none focus:ring-1 focus:ring-agent/40 focus:border-agent/40',
                'transition-colors resize-none',
                isSubmitting && 'opacity-50 cursor-not-allowed',
              )}
            />
          </div>
        )}

        {patterns.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-mono text-agent/80 uppercase tracking-wider">
              {t('timeline.composeError.selectPattern')}
            </p>
            <div className="grid grid-cols-1 gap-2">
              {patterns.map((pattern) => (
                <button
                  key={pattern.id}
                  onClick={() => handleSelectPattern(pattern.id, pattern.name)}
                  disabled={isSubmitting}
                  className={cn(
                    'flex flex-col text-left p-3 rounded-md border transition-all duration-200',
                    selectedPatternId === pattern.id
                      ? 'bg-agent/10 border-agent/50 ring-1 ring-agent/50'
                      : 'bg-bg-panel border-border hover:border-agent/30 hover:bg-bg-subtle/50',
                    isSubmitting &&
                      selectedPatternId !== pattern.id &&
                      'opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{pattern.name}</span>
                        {pattern.recommended && (
                          <span className="text-xs font-mono text-success px-1.5 py-0.5 bg-success/10 rounded border border-success/20">
                            {t('timeline.composeError.recommended')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground/80">{pattern.description}</p>
                      {(pattern.pros || pattern.cons) && (
                        <div className="mt-1.5 space-y-1">
                          {pattern.pros && (
                            <p className="text-xs text-success/90 flex items-start gap-1.5">
                              <span className="font-bold mt-0.5">+</span>
                              <span>{pattern.pros}</span>
                            </p>
                          )}
                          {pattern.cons && (
                            <p className="text-xs text-error/90 flex items-start gap-1.5">
                              <span className="font-bold mt-0.5">-</span>
                              <span>{pattern.cons}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {pattern.codeSnippet && (
                    <div className="mt-2 w-full">
                      <pre className="text-xs font-mono text-agent/90 bg-bg-terminal p-2 rounded border border-agent/10 overflow-x-auto whitespace-pre-wrap break-all">
                        {pattern.codeSnippet}
                      </pre>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
