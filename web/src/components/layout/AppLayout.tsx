import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useProjects } from '@/hooks/use-projects';
import { useSystemStats } from '@/hooks/use-system-stats';
import { useNotifications } from '@/hooks/use-notifications';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { CommandPalette } from '@/components/command/CommandPalette';

export function AppLayout() {
  const { projects, loading } = useProjects();
  const { stats } = useSystemStats();
  const { notifications, unreadCount, dismiss: dismissNotification } = useNotifications();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg-app">
      <Header
        stats={stats}
        notifications={notifications}
        unreadCount={unreadCount}
        onDismissNotification={dismissNotification}
        onNotificationAction={(notification, action) => {
          // TODO: Route notification actions (view_logs, cleanup, etc.)
          // Will be handled by dedicated pages in future
          const projectId = notification.details?.projectId as string | undefined;
          if (projectId && (action === 'view_logs' || action === 'view_stats')) {
            window.location.href = `/projects/${projectId}`;
          }
        }}
        onMenuClick={() => setIsMobileSidebarOpen(true)}
      />

      <CommandPalette />

      <div className="flex flex-1 overflow-hidden pt-12">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex md:w-16 lg:w-[240px] border-r border-[hsl(var(--border))] bg-bg-panel h-full shrink-0 transition-[width] duration-200">
          <Sidebar projects={projects} loading={loading} stats={stats} />
        </aside>

        {/* Mobile Sidebar Sheet */}
        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
          <SheetContent
            side="left"
            className="p-0 w-[240px] bg-bg-panel border-r border-[hsl(var(--border))]"
            aria-describedby={undefined}
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar projects={projects} loading={loading} stats={stats} />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-auto bg-bg-app">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
