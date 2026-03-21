import { useRef, useEffect, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  isStreaming: boolean;
  onAbort?: () => void;
}

export function ChatInput({ onSend, isStreaming, onAbort }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 6 * 24;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    adjustHeight();
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = value.trim().length > 0 && !isStreaming;

  return (
    <div className="flex items-end gap-2 p-4 border-t border-border bg-bg-panel">
      <textarea
        ref={textareaRef}
        data-testid="chat-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={isStreaming}
        placeholder={isStreaming ? 'Agent is thinking...' : 'Send a message...'}
        rows={1}
        className={cn(
          'flex-1 resize-none rounded-lg border border-border bg-bg-app px-3 py-2 text-sm text-primary-ol placeholder:text-muted-ol',
          'focus:outline-none focus:ring-1 focus:ring-agent',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      />
      {isStreaming ? (
        <button
          data-testid="chat-stop"
          onClick={onAbort}
          className="shrink-0 h-9 w-9 rounded-lg flex items-center justify-center bg-error/80 text-white hover:bg-error transition-colors"
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button
          data-testid="chat-send"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            'shrink-0 h-9 w-9 rounded-lg flex items-center justify-center transition-colors',
            canSend
              ? 'bg-agent text-white hover:bg-agent/90'
              : 'bg-bg-subtle text-muted-ol cursor-not-allowed',
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
