/**
 * AppShell — Round 4 PR4 takeover.
 *
 * Single shell for ALL authenticated routes. Replaces the legacy
 * `web/src/components/layout/AppLayout.tsx`. Carries V2 chrome (Sidebar
 * + TopBar) plus the always-mounted machinery the AppLayout owned:
 *
 *   - AgentPanelContext provider + AgentPanel
 *   - ApprovalDialog
 *   - CommandPalette (⌘K)
 *   - Mobile sidebar Sheet (Radix)
 *   - Alt+J keystroke for the AgentPanel
 *
 * Sidebar collapse persists in localStorage (`ol-shell-sidebar-collapsed`,
 * deliberately distinct from the old `openlander-sidebar-collapsed` so
 * existing users keep their old preference; the V2 key is fresh).
 *
 * Below the `md` breakpoint the desktop sidebar is force-collapsed
 * regardless of the user's stored preference and the mobile sheet
 * trigger is exposed via the TopBar's hamburger affordance.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { ApprovalDialog } from '@/components/agent/ApprovalDialog';
import { CommandPalette } from '@/components/command/CommandPalette';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AgentPanelContext, type AgentPanelInitialContext } from '@/contexts/agent-panel';
import { ProjectsProvider } from '@/contexts/projects-context';
import { useIsBelowMd } from '@/hooks/use-viewport';
import { Sidebar } from './Sidebar';
import { TopBar, type Crumb } from './TopBar';

const STORAGE_KEY = 'ol-shell-sidebar-collapsed';

const ROUTE_LABELS: Record<string, string> = {
  home: 'Home',
  activity: 'Activity',
  mcp: 'MCP Server',
  projects: 'Projects',
  services: 'Services',
  deployments: 'Deployments',
  monitoring: 'Monitoring',
  operations: 'Operations',
  overview: 'Overview',
  logs: 'Logs',
  settings: 'Settings',
  agent: 'Agent',
};

function deriveCrumbs(pathname: string): Crumb[] {
  // Flat top-level crumbs for now. PR5 introduces parent crumbs once
  // nested routes (e.g. /projects/:id/services/:id) get formalized.
  const segs = pathname.replace(/^\//, '').split('/').filter(Boolean);
  const head = segs[0] ?? 'home';
  const label = ROUTE_LABELS[head] ?? head.charAt(0).toUpperCase() + head.slice(1);
  return [{ label }];
}

export function AppShell() {
  const location = useLocation();
  const isBelowMd = useIsBelowMd();

  // Sidebar collapse — persisted choice, but `isBelowMd` overrides
  // (we always collapse to icon-only on narrow viewports).
  const [userCollapsed, setUserCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const collapsed = isBelowMd ? true : userCollapsed;

  const onToggleSidebar = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* storage write best-effort */
      }
      return next;
    });
  }, []);

  // Mobile sidebar Sheet — open/close + close-on-route-change so the
  // sheet doesn't linger after the user navigates.
  //
  // The setState-in-effect lint rule is disabled here intentionally:
  // closing the sheet IS a legitimate side effect of navigation, and we
  // can't synchronize this state from "outside React" because the sheet
  // is opened/closed by user clicks on TopBar's hamburger. The functional
  // updater short-circuits when already closed so cascading renders are
  // bounded.
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobileSidebarOpen((open) => (open ? false : open));
  }, [location.pathname]);

  // AgentPanel state + context. Pre-populating `initialContext` lets
  // callers (e.g. failure cards, log viewer) deep-link into a specific
  // project/deploy when opening the panel.
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false);
  const [agentPanelInitialContext, setAgentPanelInitialContext] =
    useState<AgentPanelInitialContext | null>(null);

  const closePanel = useCallback(() => setIsAgentPanelOpen(false), []);
  const openPanel = useCallback((initialContext?: AgentPanelInitialContext) => {
    if (initialContext) setAgentPanelInitialContext(initialContext);
    setIsAgentPanelOpen(true);
  }, []);

  // Alt+J toggles the agent panel. Same chord the legacy AppLayout used.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      setIsAgentPanelOpen((prev) => !prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('ol-shell-root');
    return () => {
      document.documentElement.classList.remove('ol-shell-root');
    };
  }, []);

  const agentPanelContextValue = useMemo(
    () => ({ isOpen: isAgentPanelOpen, openPanel, closePanel }),
    [isAgentPanelOpen, openPanel, closePanel],
  );

  const crumbs = useMemo(() => deriveCrumbs(location.pathname), [location.pathname]);

  return (
    <AgentPanelContext.Provider value={agentPanelContextValue}>
      <ProjectsProvider>
        <div
          className="ol-shell flex h-screen w-screen overflow-hidden"
          style={{ backgroundColor: 'var(--ol-bg-app)' }}
        >
          {/* Desktop sidebar */}
          <div className="hidden md:flex">
            <Sidebar collapsed={collapsed} />
          </div>

          {/* Mobile sidebar Sheet — opens on TopBar's hamburger */}
          <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
            <SheetContent
              side="left"
              className="w-[260px] border-r border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-0"
              aria-describedby={undefined}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Sidebar collapsed={false} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              crumbs={crumbs}
              onToggleSidebar={isBelowMd ? () => setIsMobileSidebarOpen(true) : onToggleSidebar}
              agentState="connected"
              lastAgentAction="Just now"
            />
            <main className="min-h-0 flex-1 overflow-auto p-6">
              <Outlet />
            </main>
          </div>

          {/* Always-mounted overlays (carried over from AppLayout). */}
          <CommandPalette />
          <AgentPanel
            open={isAgentPanelOpen}
            onOpenChange={setIsAgentPanelOpen}
            initialContext={agentPanelInitialContext}
            onInitialContextConsumed={() => setAgentPanelInitialContext(null)}
          />
          <ApprovalDialog />
        </div>
      </ProjectsProvider>
    </AgentPanelContext.Provider>
  );
}

export default AppShell;
