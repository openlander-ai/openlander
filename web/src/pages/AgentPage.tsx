import { useState } from 'react';
import { ChatLayout } from '@/components/agent/ChatLayout';
import { useStreamChat } from '@/hooks/use-stream-chat';

export function AgentPage() {
  const [sessionId] = useState(() => `web-${Date.now()}`);
  const chat = useStreamChat(sessionId);

  return (
    <div data-testid="agent-page" className="flex flex-col h-full">
      <ChatLayout
        messages={chat.messages}
        isStreaming={chat.isStreaming}
        error={chat.error}
        onSendMessage={chat.sendMessage}
      />
    </div>
  );
}
