import type { ChatSession } from '@/lib/chat-types';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatRelativeTime } from '@/lib/time';

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export function ChatSidebar({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: ChatSidebarProps) {
  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this chat session?')) {
      onDeleteSession(id);
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="session-list">
      <div className="p-2 lg:p-3 shrink-0 border-b border-border/50">
        <button
          data-testid="new-chat-button"
          onClick={onNewChat}
          className={cn(
            'w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-all duration-150',
            'lg:justify-start justify-center',
            'border border-dashed border-foreground/20 text-foreground hover:bg-foreground hover:text-background hover:border-foreground/50',
            'text-xs font-body',
          )}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline">New Chat</span>
        </button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 lg:p-3 space-y-0.5">
          {sessions.length === 0 && (
            <div className="flex items-center justify-center lg:justify-start gap-2 py-3 px-2 text-muted-ol">
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline text-xs font-body">No chat sessions</span>
            </div>
          )}
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              data-testid="session-item"
              className={cn(
                'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-all duration-150 group cursor-pointer relative overflow-hidden',
                'lg:justify-start justify-center',
                'hover:bg-bg-subtle',
                activeSessionId === session.sessionId
                  ? 'bg-bg-subtle text-primary-ol before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-agent'
                  : 'text-secondary-ol',
              )}
              onClick={() => onSelectSession(session.sessionId)}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <div className="hidden lg:flex flex-col flex-1 min-w-0">
                <span className="text-xs font-body truncate">
                  {session.firstMessage || 'New conversation'}
                </span>
                <div className="flex items-center justify-between text-xs text-secondary-ol/80 mt-0.5">
                  <span>{session.messageCount} messages</span>
                  <span>{formatRelativeTime(session.lastActive)}</span>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(e, session.sessionId)}
                className="hidden lg:flex opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-panel rounded text-muted-ol hover:text-error transition-all shrink-0"
                title="Delete session"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
