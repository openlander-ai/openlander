import type { ChatMessage, QuestionAnswer, QuestionRequest } from '@/lib/chat-types';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { EmptyState, StreamError } from './EmptyState';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ChatQuestion } from './ChatQuestion';

interface ChatLayoutProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  pendingQuestion?: QuestionRequest | null;
  onSendMessage: (message: string) => void;
  onAbort?: () => void;
  onReply?: (requestId: string, answers: QuestionAnswer[]) => void;
  onDismiss?: () => void;
}

export function ChatLayout({
  messages,
  isStreaming,
  error,
  pendingQuestion,
  onSendMessage,
  onAbort,
  onReply,
  onDismiss,
}: ChatLayoutProps) {
  const hasMessages = messages.some((message) => message.role !== 'system');

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-primary-ol">Agent Chat</h2>
      </div>

      {!hasMessages && !isStreaming ? (
        <EmptyState onSendMessage={onSendMessage} />
      ) : (
        <MessageList messages={messages}>
          {isStreaming ? <ThinkingIndicator /> : null}
          {pendingQuestion && onReply && onDismiss ? (
            <ChatQuestion request={pendingQuestion} onReply={onReply} onDismiss={onDismiss} />
          ) : null}
        </MessageList>
      )}

      {error ? <StreamError error={error} /> : null}

      <ChatInput onSend={onSendMessage} isStreaming={isStreaming} onAbort={onAbort} />
    </div>
  );
}
