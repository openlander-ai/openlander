import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TerminalOption {
  id: string;
  label: string;
  description?: string;
}

export interface TerminalQuestionProps {
  id: string;
  question: string;
  options: TerminalOption[];
  answered?: boolean;
  selectedOptionId?: string;
  onSubmit: (questionId: string, optionId: string) => void;
  onSkip?: (questionId: string) => void;
}

export function TerminalQuestion({
  id,
  question,
  options,
  answered,
  selectedOptionId,
  onSubmit,
  onSkip,
}: TerminalQuestionProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (answered || isSubmitting) return;

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % options.length);
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + options.length) % options.length);
          break;
        case 'Enter':
          e.preventDefault();
          setIsSubmitting(true);
          onSubmit(id, options[focusedIndex].id);
          break;
        case 'Escape':
          if (onSkip) {
            e.preventDefault();
            setIsSubmitting(true);
            onSkip(id);
          }
          break;
      }
    },
    [answered, isSubmitting, options, focusedIndex, id, onSubmit, onSkip],
  );

  useEffect(() => {
    if (!answered && containerRef.current) {
      containerRef.current.focus();
    }
  }, [answered]);

  if (answered) {
    const selectedOption = options.find((o) => o.id === selectedOptionId) || options[0];
    return (
      <div className="flex items-start gap-2 py-1 font-mono text-sm">
        <span className="text-green-500 shrink-0">✓</span>
        <div className="flex flex-col">
          <span className="text-muted-ol">{question}</span>
          <span className="text-primary-ol">Selected: {selectedOption?.label}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-col gap-2 py-2 font-mono text-sm outline-none',
        isSubmitting && 'opacity-50 pointer-events-none',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-blue-400 font-bold shrink-0">?</span>
        <span className="text-primary-ol font-semibold">{question}</span>
      </div>

      <div className="flex flex-col gap-1 pl-5 mt-1">
        {options.map((option, index) => {
          const isFocused = index === focusedIndex;
          return (
            <div
              key={option.id}
              onClick={() => {
                if (isSubmitting) return;
                setFocusedIndex(index);
                setIsSubmitting(true);
                onSubmit(id, option.id);
              }}
              className={cn(
                'flex flex-col px-3 py-2 border rounded cursor-pointer transition-colors',
                isFocused
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-border/50 hover:border-border bg-transparent',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'shrink-0 w-3 h-3 rounded-full border flex items-center justify-center',
                    isFocused ? 'border-blue-400' : 'border-muted-ol',
                  )}
                >
                  {isFocused && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                </span>
                <span className={cn(isFocused ? 'text-blue-400' : 'text-secondary-ol')}>
                  {option.label}
                </span>
              </div>
              {option.description && (
                <span className="pl-5 text-xs text-muted-ol mt-1">{option.description}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="pl-5 mt-2 text-xs text-muted-ol flex gap-3">
        <span>
          <kbd className="bg-muted/20 px-1 rounded">↑↓</kbd> to navigate
        </span>
        <span>
          <kbd className="bg-muted/20 px-1 rounded">Enter</kbd> to select
        </span>
        {onSkip && (
          <span>
            <kbd className="bg-muted/20 px-1 rounded">Esc</kbd> to skip
          </span>
        )}
      </div>
    </div>
  );
}
