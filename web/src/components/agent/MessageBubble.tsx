import type { ChatMessage } from '@/lib/chat-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from './ToolCallCard';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={isUser ? 'message-user' : 'message-assistant'}
      className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
      title={message.createdAt ? new Date(message.createdAt).toLocaleString() : undefined}
    >
      {isUser ? (
        <p className="text-[10px] text-muted-ol mb-1 text-right">You</p>
      ) : (
        <div className="flex items-center gap-1.5 mb-1">
          <Bot className="h-3 w-3 text-ai" />
          <p className="text-[10px] text-ai">Agent</p>
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser ? 'bg-agent text-white' : 'bg-bg-panel border border-[#e4e4e7] text-primary-ol',
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {message.content && (
              <div
                className="prose prose-sm max-w-none
                prose-headings:text-primary-ol
                prose-p:text-secondary-ol
                prose-a:text-ai prose-a:no-underline hover:prose-a:underline
                prose-strong:text-primary-ol
                prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                prose-pre:bg-bg-terminal prose-pre:border prose-pre:border-border
                prose-td:text-secondary-ol prose-th:text-primary-ol
                prose-blockquote:border-ai/30 prose-blockquote:text-secondary-ol
              "
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            {message.toolCalls?.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
