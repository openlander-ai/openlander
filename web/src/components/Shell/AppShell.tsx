/**
 * AppShell — Round 4 PR4 takeover.
 *
 * Single shell for ALL authenticated routes. Replaces the legacy
 * `web/src/components/layout/AppLayout.tsx`. Carries V2 chrome (Sidebar
 * + TopBar) plus the always-mounted machinery the AppLayout owned:
 *
 *   - CommandPalette (⌘K)
 *   - Mobile sidebar Sheet (Radix)
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
import { Outlet, useLocation } from 'react-router';
import { CommandPalette } from '@/components/command/CommandPalette';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { AppDataProvider } from '@/contexts/app-data-context';
import { useIsBelowMd } from '@/hooks/use-viewport';
import { useLanguage } from '@/i18n/context';
import { PendingApprovalsStrip } from './PendingApprovalsStrip';
import { Sidebar } from './Sidebar';
import { TopBar, type Crumb } from './TopBar';
import { PlatformUpdateDialog } from './PlatformUpdateDialog';

const STORAGE_KEY = 'ol-shell-sidebar-collapsed';

const ROUTE_LABEL_KEYS: Record<string, string> = {
  home: 'routes.home',
  activity: 'routes.activity',
  // /mcp lost the React surface (backend's JSON-RPC endpoint owns that path);
  // the UI lives at /mcp-server now. Both keys land here so the breadcrumb
  // stays "MCP Server" even on the legacy URL during transition.
  mcp: 'routes.mcp',
  'mcp-server': 'routes.mcp',
  projects: 'routes.projects',
  services: 'routes.services',
  engagements: 'routes.engagements',
  monitoring: 'routes.monitoring',
  overview: 'routes.overview',
  settings: 'routes.settings',
};

function deriveCrumbs(pathname: string, t: (key: string) => string): Crumb[] {
  // Flat top-level crumbs for now. PR5 introduces parent crumbs once
  // nested routes (e.g. /projects/:id/services/:id) get formalized.
  const segs = pathname.replace(/^\//, '').split('/').filter(Boolean);
  const head = segs[0] ?? 'home';
  const labelKey = ROUTE_LABEL_KEYS[head];
  const label = labelKey ? t(labelKey) : head.charAt(0).toUpperCase() + head.slice(1);
  return [{ label }];
}

export function AppShell() {
  const location = useLocation();
  const isBelowMd = useIsBelowMd();
  const { t } = useLanguage();

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

  useEffect(() => {
    document.documentElement.classList.add('ol-shell-root');
    return () => {
      document.documentElement.classList.remove('ol-shell-root');
    };
  }, []);

  const crumbs = useMemo(() => deriveCrumbs(location.pathname, t), [location.pathname, t]);

  return (
    <AppDataProvider>
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
            className="w-[260px] border-r border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] p-0"
            aria-describedby={undefined}
          >
            <SheetTitle className="sr-only">{t('topBar.navigationTitle')}</SheetTitle>
            <Sidebar collapsed={false} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            crumbs={crumbs}
            onToggleSidebar={isBelowMd ? () => setIsMobileSidebarOpen(true) : onToggleSidebar}
          />
          <main className="min-h-0 flex-1 overflow-auto p-6">
            {/* Global pending-approvals surface. project + service
                archive/unarchive now enter the MCP approval hold, so the
                strip must be reachable from every route, not just Home. It
                self-fetches and returns null when empty; `empty:hidden`
                collapses the wrapper (and its margin) so non-approval pages
                show no gap. */}
            <div className="mb-6 empty:hidden">
              <PendingApprovalsStrip />
            </div>
            <Outlet />
          </main>
        </div>

        <CommandPalette />
        <PlatformUpdateDialog />
      </div>
    </AppDataProvider>
  );
}

export default AppShell;
