import { useState } from 'react';
import { Header } from './Header';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useProjects } from '@/hooks/use-projects';
import { useChat } from '@/hooks/use-chat';
import { useSystemStats } from '@/hooks/use-system-stats';
import { Sheet, SheetContent } from '@/components/ui/sheet';

export function AppLayout() {
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects();
  const { messages, isStreaming, sendMessage, error: chatError } = useChat();
  const { stats } = useSystemStats();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <Header stats={stats} onMenuClick={() => setIsSidebarOpen(true)} />

      <div className="flex flex-1 overflow-hidden pt-12">
        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-[280px] border-r bg-background h-full">
          <ProjectSidebar
            projects={projects}
            loading={projectsLoading}
            error={projectsError}
            onRefresh={refetchProjects}
          />
        </aside>

        {/* Mobile Sidebar */}
        <Sheet open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
          <SheetContent side="left" className="p-0 w-[280px]">
            <ProjectSidebar
              projects={projects}
              loading={projectsLoading}
              error={projectsError}
              onRefresh={refetchProjects}
            />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 h-full">
          <ChatPanel
            messages={messages}
            isStreaming={isStreaming}
            sendMessage={sendMessage}
            error={chatError}
          />
        </main>
      </div>
    </div>
  );
}
