import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useLanguage();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`; // Max ~4 lines
  }, [message]);

  const handleSend = () => {
    if (!message.trim() || disabled) return;
    onSend(message.trim());
    setMessage('');

    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="relative flex items-end gap-2 p-3 bg-bg-panel border-t border-[hsl(var(--border))] shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder || t('assistant.placeholder')}
        className={cn(
          'flex-1 min-h-[40px] max-h-[120px] resize-none rounded-xl px-3.5 py-2.5',
          'bg-bg-app border border-[hsl(var(--border))] text-sm font-body text-primary-ol',
          'placeholder:text-muted-ol focus:outline-none focus:ring-2 focus:ring-agent/30 focus:border-agent/40',
          'transition-all disabled:opacity-50 disabled:cursor-not-allowed',
          'scrollbar-thin scrollbar-thumb-[hsl(var(--border))] scrollbar-track-transparent',
        )}
        rows={1}
      />
      <button
        onClick={handleSend}
        disabled={!message.trim() || disabled}
        className={cn(
          'shrink-0 flex items-center justify-center h-10 w-10 rounded-xl',
          'bg-agent text-bg-app transition-all',
          'hover:bg-agent/90 hover:scale-105 active:scale-95',
          'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100',
        )}
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
