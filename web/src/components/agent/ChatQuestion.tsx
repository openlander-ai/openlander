import { useState } from 'react';
import type { QuestionRequest } from '@/lib/chat-types';
import { cn } from '@/lib/utils';
import { HelpCircle, SkipForward, Check } from 'lucide-react';

interface ChatQuestionProps {
  request: QuestionRequest;
  onReply: (
    requestId: string,
    answers: Array<{ questionIndex: number; selectedLabels: string[] }>,
  ) => void;
  onDismiss: () => void;
}

export function ChatQuestion({ request, onReply, onDismiss }: ChatQuestionProps) {
  const [answered, setAnswered] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  const handleOptionClick = (questionIndex: number, label: string) => {
    if (answered) return;
    setSelectedAnswer(label);
    setAnswered(true);
    onReply(request.id, [{ questionIndex, selectedLabels: [label] }]);
  };

  const handleSkip = () => {
    if (answered) return;
    setSelectedAnswer('Skipped');
    setAnswered(true);
    onDismiss();
  };

  return (
    <div
      data-testid="chat-question"
      className="border-2 border-agent/30 bg-agent/5 rounded-lg p-4 my-2 max-w-[80%]"
    >
      {request.questions.map((q, qi) => (
        <div key={qi} className="space-y-3">
          {q.header && <p className="text-xs font-medium text-muted-ol">{q.header}</p>}
          <div className="flex items-start gap-2">
            <HelpCircle className="h-4 w-4 text-agent shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-primary-ol">{q.question}</p>
          </div>
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  data-testid="question-option"
                  onClick={() => handleOptionClick(qi, opt.label)}
                  disabled={answered}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                    answered && selectedAnswer === opt.label
                      ? 'bg-agent text-white border-agent'
                      : answered
                        ? 'opacity-50 cursor-not-allowed border-border text-muted-ol'
                        : 'border-border text-primary-ol hover:bg-bg-subtle hover:border-agent/50',
                  )}
                >
                  {answered && selectedAnswer === opt.label && (
                    <Check className="h-3 w-3 inline mr-1" />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!answered && (
        <button
          data-testid="question-skip"
          onClick={handleSkip}
          className="mt-3 text-xs text-muted-ol hover:text-secondary-ol flex items-center gap-1"
        >
          <SkipForward className="h-3 w-3" /> Skip
        </button>
      )}
      {answered && selectedAnswer === 'Skipped' && (
        <p className="mt-2 text-xs text-muted-ol italic">Skipped</p>
      )}
    </div>
  );
}
