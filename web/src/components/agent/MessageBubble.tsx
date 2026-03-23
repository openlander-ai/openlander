import {
  useState,
  useCallback,
  type ReactNode,
  type HTMLAttributes,
  type ReactElement,
  isValidElement,
  Children,
} from 'react';
import type { ChatMessage } from '@/lib/chat-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { Bot, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ToolCallCard } from './ToolCallCard';

function extractLanguage(children: ReactNode): string | null {
  const child = Children.toArray(children)[0];
  if (!isValidElement(child)) return null;
  const className = (child as ReactElement<HTMLAttributes<HTMLElement>>).props.className ?? '';
  const match = /language-(\w+)/.exec(className);
  return match ? match[1] : null;
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!isValidElement(node)) return '';
  const children = (node as ReactElement<{ children?: ReactNode }>).props.children;
  return Children.toArray(children).map(extractText).join('');
}

function CodeBlock({ children, ...rest }: HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

  const handleCopy = useCallback(() => {
    const text = extractText(children as ReactNode);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [children]);

  return (
    <div className="relative group rounded-lg overflow-hidden my-3 border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
        <span className="text-xs font-mono text-zinc-400">{language ?? 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre {...rest} className="!mt-0 !mb-0 !rounded-none !border-0">
        {children}
      </pre>
    </div>
  );
}

const markdownComponents = {
  pre: CodeBlock,
};

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
        <p className="text-xs text-muted-ol mb-1 text-right">You</p>
      ) : (
        <div className="flex items-center gap-1.5 mb-1">
          <Bot className="h-3 w-3 text-ai" />
          <p className="text-xs text-ai">Agent</p>
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] w-fit px-4 shadow-sm',
          isUser
            ? 'rounded-[18px_18px_4px_18px] py-2.5 bg-agent text-white'
            : 'rounded-[18px_18px_18px_4px] py-3 bg-bg-subtle border border-zinc-200 text-primary-ol',
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
                prose-pre:bg-bg-terminal prose-pre:text-zinc-100 prose-pre:border-0
                [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit
                prose-td:text-secondary-ol prose-th:text-primary-ol
                prose-blockquote:border-ai/30 prose-blockquote:text-secondary-ol
              "
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={markdownComponents}
                >
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
