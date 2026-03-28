import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { ApprovalDialog } from '@/components/agent/ApprovalDialog';
import { useProjects } from '@/hooks/use-projects';
import { useSystemStats } from '@/hooks/use-system-stats';
import { useNotifications } from '@/hooks/use-notifications';
import { useApprovalCheck } from '@/hooks/use-approval-check';
import { ApprovalBanner } from './ApprovalBanner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AgentPanelContext, type AgentPanelInitialContext } from '@/contexts/agent-panel';
import { CommandPalette } from '@/components/command/CommandPalette';

export function AppLayout() {
  const { projects, loading } = useProjects();
  const { stats } = useSystemStats();
  const { notifications, unreadCount, dismiss: dismissNotification } = useNotifications();
  const { pendingApprovals, approve, reject } = useApprovalCheck();
  const navigate = useNavigate();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [agentPanelInitialContext, setAgentPanelInitialContext] =
    useState<AgentPanelInitialContext | null>(null);

  const closePanel = useCallback(() => setIsAgentPanelOpen(false), []);

  const openPanel = useCallback((initialContext?: AgentPanelInitialContext) => {
    if (initialContext) {
      setAgentPanelInitialContext(initialContext);
    }
    setIsAgentPanelOpen(true);
  }, []);

  useEffect(() => {
    const handleToggleAgent = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'j') {
        return;
      }

      event.preventDefault();
      setIsAgentPanelOpen((prev) => !prev);
    };

    window.addEventListener('keydown', handleToggleAgent);
    return () => window.removeEventListener('keydown', handleToggleAgent);
  }, []);

  const agentPanelContextValue = useMemo(
    () => ({
      isOpen: isAgentPanelOpen,
      openPanel,
      closePanel,
    }),
    [isAgentPanelOpen, openPanel, closePanel],
  );

  return (
    <AgentPanelContext.Provider value={agentPanelContextValue}>
      <div className="flex flex-col h-screen overflow-hidden bg-bg-app">
        <Header
          stats={stats}
          notifications={notifications}
          unreadCount={unreadCount}
          onDismissNotification={dismissNotification}
          onNotificationAction={(notification, action) => {
            const projectId = notification.details?.projectId as string | undefined;
            if (projectId && (action === 'view_logs' || action === 'view_stats')) {
              navigate(`/projects/${projectId}`);
            }
          }}
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <CommandPalette />

        <div className="flex flex-1 overflow-hidden pt-12">
          {/* Desktop Sidebar */}
          <aside className="hidden md:flex md:w-16 lg:w-[260px] border-r border-[hsl(var(--border))] bg-bg-panel h-full shrink-0 transition-[width] duration-200">
            <Sidebar projects={projects} loading={loading} />
          </aside>

          {/* Mobile Sidebar Sheet */}
          <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
            <SheetContent
              side="left"
              className="p-0 w-[280px] bg-bg-panel border-r border-[hsl(var(--border))]"
              aria-describedby={undefined}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Sidebar projects={projects} loading={loading} />
            </SheetContent>
          </Sheet>

          {/* Main Content */}
          <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-bg-app">
            <ApprovalBanner approvals={pendingApprovals} onApprove={approve} onReject={reject} />
            <div className="flex-1 overflow-auto">
              <Outlet />
            </div>
          </main>
        </div>

        <AgentPanel
          open={isAgentPanelOpen}
          onOpenChange={setIsAgentPanelOpen}
          initialContext={agentPanelInitialContext}
          onInitialContextConsumed={() => setAgentPanelInitialContext(null)}
        />
        <ApprovalDialog />
      </div>
    </AgentPanelContext.Provider>
  );
}
