/**
 * Sidebar — Shell V2.
 *
 * IA per Round 4 strategy notes (agent-first reframe):
 *
 *   Workspace (5):    Home · Activity · Projects · Deployments · Monitoring
 *   Infrastructure (2): Web Server · MCP Server
 *   Integrations (3):  Git Providers · SSH Keys · Notifications
 *
 * Profile/Users moved into the account card pinned at the bottom.
 *
 * Notable: this sidebar is intentionally separate from the existing
 * `web/src/components/layout/Sidebar.tsx`. The old one wires
 * Dashboard/Agent toggle, CommandPalette search, and live setup-status
 * checks. We don't replicate those in V2 yet — that wire-up moves over
 * in PR2/PR3 once new pages are validated. PR1 keeps both sidebars
 * coexisting; only V2 routes (`/home`, `/activity`, `/mcp`) render this
 * one.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Folder,
  Activity,
  Rocket,
  BarChart3,
  Server,
  Bot,
  Code2,
  Key,
  Bell,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BRAND } from '@/lib/brand';
import { useProjectsContext } from '@/hooks/use-projects-context';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Predicate: does the current pathname count as "active" for this item? */
  matches?: (pathname: string) => boolean;
  /** Tiny right-aligned dot indicator (e.g. MCP connection status) */
  badgeDot?: 'ok' | 'warning' | null;
  /** Numeric badge */
  badge?: string | null;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

const startsWith =
  (...prefixes: string[]) =>
  (pathname: string) =>
    prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));

const SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'home', label: 'Home', icon: Home, to: '/home' },
      {
        id: 'projects',
        label: 'Projects',
        icon: Folder,
        to: '/projects',
        matches: startsWith('/projects'),
        // badge filled in per-render from useProjects() — see component body
      },
      { id: 'activity', label: 'Activity', icon: Activity, to: '/activity' },
      {
        id: 'deployments',
        label: 'Deployments',
        icon: Rocket,
        to: '/deployments',
        matches: startsWith('/deployments'),
      },
      {
        id: 'monitoring',
        label: 'Monitoring',
        icon: BarChart3,
        to: '/monitoring',
        matches: startsWith('/monitoring'),
      },
      // /logs retired in Phase 3a (ralplan-monitoring-logs spike success):
      // /activity now has a Kind=Deploys filter + clickable rows that
      // deep-link into deployment detail. The dedicated /logs entry was
      // duplicate sidebar real estate.
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      {
        id: 'web-server',
        label: 'Web Server',
        icon: Server,
        to: '/settings/web-server',
        matches: startsWith('/settings/web-server'),
      },
      {
        id: 'mcp',
        label: 'MCP Server',
        // Frontend route is /mcp-server because the backend serves a JSON-RPC
        // MCP protocol endpoint at /mcp (no content-negotiation; backend wins
        // the route). Renaming the UI surface avoids the conflict.
        icon: Bot,
        to: '/mcp-server',
        badgeDot: 'ok',
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      {
        id: 'git',
        label: 'Git Providers',
        icon: Code2,
        to: '/settings/git-providers',
        matches: startsWith('/settings/git-providers'),
      },
      {
        id: 'ssh',
        label: 'SSH Keys',
        icon: Key,
        to: '/settings/ssh-keys',
        matches: startsWith('/settings/ssh-keys'),
      },
      {
        id: 'notifications',
        label: 'Notifications',
        icon: Bell,
        to: '/settings/notifications',
        matches: startsWith('/settings/notifications'),
      },
    ],
  },
];

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Real project count drives the Workspace/Projects badge. While the
  // initial fetch is in flight we render no badge (avoids a flicker
  // from "—" → "4"); on error we fall back silently — the sidebar should
  // never break because the projects endpoint is down.
  const { projects, loading, error } = useProjectsContext();
  const projectsBadge: string | null =
    loading || error || projects.length === 0 ? null : String(projects.length);

  const isActive = (item: NavItem): boolean => {
    if (item.matches) return item.matches(location.pathname);
    return location.pathname === item.to.split('?')[0];
  };

  return (
    <aside
      className={cn(
        'flex h-full flex-col',
        'border-r border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]',
        'text-[color:var(--ol-fg)]',
      )}
      style={{ width: collapsed ? 'var(--ol-sidebar-w-collapsed)' : 'var(--ol-sidebar-w)' }}
      aria-label="Primary navigation"
    >
      {/* Brand */}
      <div className="flex h-[var(--ol-topbar-h)] items-center gap-3 border-b border-[color:var(--ol-border-subtle)] px-4">
        <span
          aria-hidden
          className="grid h-6 w-6 place-items-center rounded-md bg-[color:var(--ol-primary-soft)] text-[12px] text-[color:var(--ol-primary)]"
        >
          {BRAND.glyph}
        </span>
        {!collapsed && (
          <span className="truncate text-[14px] font-semibold tracking-tight">{BRAND.name}</span>
        )}
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => (
          <div key={section.id} className="mb-4">
            {!collapsed && (
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
                {section.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                // Live badge for the Projects entry — pulled from the
                // useProjects() hook above. All other items use their
                // static `item.badge` (currently none, but reserved).
                const displayBadge = item.id === 'projects' ? projectsBadge : (item.badge ?? null);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => navigate(item.to)}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors',
                        active
                          ? 'bg-[color:var(--ol-panel-2)] font-medium text-[color:var(--ol-fg)]'
                          : 'text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active && 'text-[color:var(--ol-primary)]',
                        )}
                      />
                      {!collapsed && (
                        <span className="flex-1 truncate text-left">{item.label}</span>
                      )}
                      {!collapsed && item.badgeDot && (
                        <span
                          aria-hidden
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            item.badgeDot === 'ok'
                              ? 'bg-[color:var(--ol-success)]'
                              : 'bg-[color:var(--ol-warning)]',
                          )}
                        />
                      )}
                      {!collapsed && displayBadge && (
                        <span className="rounded-full bg-[color:var(--ol-panel-2)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--ol-fg-muted)]">
                          {displayBadge}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Account card pinned at bottom */}
      <div className="border-t border-[color:var(--ol-border-subtle)] p-3">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[color:var(--ol-panel-2)]"
          title="Account · Profile · Sign out"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--ol-primary-soft)] text-[11px] font-semibold text-[color:var(--ol-primary)]">
            JH
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">Jiho</span>
                <span className="block truncate text-[11px] text-[color:var(--ol-fg-muted)]">
                  jiho@openlander.dev
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[color:var(--ol-fg-subtle)]" />
            </>
          )}
        </button>
        {!collapsed && (
          <div className="mt-2 px-2 text-[10px] text-[color:var(--ol-fg-subtle)]">
            {BRAND.versionStamp}
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
