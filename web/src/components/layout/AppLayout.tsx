import { useState, useEffect } from 'react';
import { Header } from './Header';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useProjects } from '@/hooks/use-projects';
import { useChat } from '@/hooks/use-chat';
import { useSystemStats } from '@/hooks/use-system-stats';
import { useSetup } from '@/hooks/use-setup';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Loader2 } from 'lucide-react';

export function AppLayout() {
  const { status: setupStatus, loading: setupLoading, refetch: refetchSetup } = useSetup();
  const [setupComplete, setSetupComplete] = useState(false);

  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects();
  const { messages, isStreaming, sendMessage, error: chatError } = useChat();
  const { stats } = useSystemStats();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (setupStatus?.ready) {
      setSetupComplete(true);
    }
  }, [setupStatus]);

  if (setupLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!setupComplete) {
    return (
      <SetupScreen
        onComplete={() => {
          setSetupComplete(true);
          refetchSetup();
        }}
      />
    );
  }

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
