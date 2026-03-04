import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useProjects } from '@/hooks/use-projects';
import { useSystemStats } from '@/hooks/use-system-stats';
import { useChat } from '@/hooks/use-chat';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { MessageSquare } from 'lucide-react';
import { CommandPalette } from '@/components/command/CommandPalette';

/** Context exposed to child routes via useOutletContext() */
export interface AppLayoutContext {
  openChatWithPrompt: (prompt: string) => void;
}

export function useAppLayout(): AppLayoutContext {
  return useOutletContext<AppLayoutContext>();
}

export function AppLayout() {
  const { projects, loading } = useProjects();
  const { stats } = useSystemStats();
  const chat = useChat();
  const location = useLocation();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Extract projectId from URL for chat context
  const projectMatch = location.pathname.match(/\/projects\/([^/]+)/);
  const currentProjectId = projectMatch?.[1] ?? null;

  // Cmd+. / Ctrl+. keyboard shortcut for chat toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setIsChatOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleChat = () => setIsChatOpen((prev) => !prev);

  /** Open chat with a pre-filled prompt (used by "Fix with AI" buttons) */
  const openChatWithPrompt = useCallback(
    (prompt: string) => {
      setIsChatOpen(true);
      // Inject project context if on a project page
      const contextPrefix = currentProjectId ? `[Context: project ${currentProjectId}] ` : '';
      chat.sendMessage(contextPrefix + prompt);
    },
    [currentProjectId, chat],
  );

  const outletContext: AppLayoutContext = { openChatWithPrompt };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-app">
      <Header
        stats={stats}
        onMenuClick={() => setIsMobileSidebarOpen(true)}
        onChatToggle={toggleChat}
        isChatOpen={isChatOpen}
      />

      <CommandPalette />

      <div className="flex flex-1 overflow-hidden pt-12">
        {/* Desktop Sidebar: 240px on xl+, 64px on md-xl, hidden below md */}
        <aside className="hidden md:flex md:w-16 xl:w-[240px] border-r border-[hsl(var(--border))] bg-bg-panel h-full shrink-0 transition-[width] duration-200">
          <Sidebar projects={projects} loading={loading} stats={stats} />
        </aside>

        {/* Mobile Sidebar Sheet */}
        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="p-0 w-[240px] bg-bg-panel border-r border-[hsl(var(--border))]"
          >
            <Sidebar projects={projects} loading={loading} stats={stats} />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-auto bg-bg-app">
          <Outlet context={outletContext} />
        </main>

        {/* Chat Slide-over */}
        <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
          <SheetContent
            side="right"
            className="p-0 w-[400px] sm:max-w-[400px] bg-bg-panel border-l border-[hsl(var(--border))]"
          >
            <div className="h-full pt-8">
              <ChatPanel
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                sendMessage={(msg) => {
                  // Inject project context automatically
                  const prefix = currentProjectId ? `[Context: project ${currentProjectId}] ` : '';
                  chat.sendMessage(prefix + msg);
                }}
                error={chat.error}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Chat FAB (floating action button) */}
        {!isChatOpen && (
          <button
            onClick={toggleChat}
            className="fixed bottom-6 right-6 z-40 p-3 rounded-full bg-agent text-black shadow-lg shadow-agent/25 hover:shadow-agent/40 transition-all duration-200 hover:scale-105 group md:bottom-6 md:right-6 bottom-4 right-4"
            title="Ask Agent (⌘ .)"
          >
            <MessageSquare className="h-5 w-5" />
            <span className="absolute -top-8 right-0 text-[10px] font-mono text-muted-ol opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-bg-panel px-1.5 py-0.5 rounded border border-[hsl(var(--border))]">
              ⌘ .
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
