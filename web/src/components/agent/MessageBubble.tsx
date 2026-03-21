import type { ChatMessage } from '@/lib/chat-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div
      data-testid={isUser ? 'message-user' : 'message-assistant'}
      className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
      title={message.createdAt ? new Date(message.createdAt).toLocaleString() : undefined}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser ? 'bg-agent text-white' : 'bg-bg-subtle text-primary-ol',
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            {message.content && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            {message.toolCalls?.map((tc, i) => (
              <div key={i} className="text-xs text-muted-ol mt-1">
                🔧 {tc.toolName}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
