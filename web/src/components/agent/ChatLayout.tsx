import type { ChatMessage } from '@/lib/chat-types';

interface ChatLayoutProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSendMessage: (message: string) => void;
}

export function ChatLayout({ messages, isStreaming, error, onSendMessage }: ChatLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-primary-ol">Agent Chat</h2>
      </div>

      <div data-testid="message-list" className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-ol text-sm">Start a conversation</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={msg.id ?? i} className="text-sm">
                <span className="font-medium">{msg.role}: </span>
                {msg.content}
              </div>
            ))}
          </div>
        )}
      </div>

      <div data-testid="chat-input-area" className="shrink-0 border-t border-border p-4">
        {error && <p className="text-xs text-error mb-2">{error}</p>}
        <div className="text-xs text-muted-ol">
          Chat input (Task 9) {isStreaming ? '...' : ''}
          <button className="hidden" onClick={() => onSendMessage('test')}>
            test
          </button>
        </div>
      </div>
    </div>
  );
}
