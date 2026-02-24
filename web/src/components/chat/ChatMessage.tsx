import { cn } from '@/lib/utils';
import type { UIChatMessage } from '@/hooks/use-chat';
import { ToolCallCard } from './ToolCallCard';
import { Loader2 } from 'lucide-react';

interface ChatMessageProps {
  message: UIChatMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  // Basic markdown formatting
  const formatContent = (text: string) => {
    if (!text) return null;

    // Split by code blocks first
    const parts = text.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        // Code block
        const content = part.slice(3, -3).replace(/^([a-z]*\n)/, ''); // Remove first line (lang) if present
        return (
          <pre
            key={index}
            className="bg-black/10 dark:bg-black/30 p-2 rounded my-2 overflow-x-auto"
          >
            <code className="text-xs font-mono">{content}</code>
          </pre>
        );
      }

      // Inline formatting
      const lines = part.split('\n');
      return (
        <span key={index}>
          {lines.map((line, lineIndex) => {
            // Handle bold **text**
            const boldParts = line.split(/(\*\*.*?\*\*)/g);

            return (
              <span key={lineIndex} className="block min-h-[1.2em]">
                {boldParts.map((bPart, bIndex) => {
                  if (bPart.startsWith('**') && bPart.endsWith('**')) {
                    return <strong key={bIndex}>{bPart.slice(2, -2)}</strong>;
                  }
                  // Handle inline code `code`
                  const codeParts = bPart.split(/(`.*?`)/g);
                  return (
                    <span key={bIndex}>
                      {codeParts.map((cPart, cIndex) => {
                        if (cPart.startsWith('`') && cPart.endsWith('`')) {
                          return (
                            <code
                              key={cIndex}
                              className="bg-black/10 dark:bg-black/30 px-1 rounded font-mono text-sm"
                            >
                              {cPart.slice(1, -1)}
                            </code>
                          );
                        }
                        return cPart;
                      })}
                    </span>
                  );
                })}
              </span>
            );
          })}
        </span>
      );
    });
  };

  return (
    <div className={cn('flex w-full mb-4', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted/50 text-foreground rounded-bl-sm border border-border/50',
        )}
      >
        <div className="text-sm leading-relaxed break-words">
          {formatContent(message.content)}

          {message.isStreaming && !message.content && (
            <div className="flex items-center gap-2 text-muted-foreground italic text-xs py-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking...
            </div>
          )}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.toolCalls.map((toolCall, index) => (
              <ToolCallCard key={index} toolCall={toolCall} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
