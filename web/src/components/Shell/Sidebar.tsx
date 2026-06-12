/**
 * Sidebar — v0.1 IA.
 *
 * v0.1 final design lock (post-tab fold):
 *
 *   Workspace (6):  Home · Your Agent · Projects · Activity · Monitoring · Web Server
 *   Settings (1):   Git Providers
 *   Account footer: admin → popover (Change password · Sign out)
 *
 * Deployments is no longer a top-level nav item — it was a saved
 * filter on top of /activity and reads better as one of the compact
 * tabs inside the Activity page. Old `/activity?type=deploy` URLs
 * still route to the same view; the sidebar entry is just gone.
 *
 * Removed in v0.1: Logs (lives only inside resource detail), SSH Keys (→ v0.2),
 * Notifications (→ v0.2). MCP Server item folded into Workspace as "Your Agent"
 * pointing at /mcp-server. Cloudflare Tunnel surface deferred to v0.2.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  Folder,
  Activity,
  BarChart3,
  Server,
  Bot,
  Code2,
  BrainCircuit,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BRAND } from '@/lib/brand';
import { APP_VERSION_LABEL } from '@/lib/version';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useLanguage } from '@/i18n/context';
import { AccountPopover } from '@/components/account/AccountPopover';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** Predicate: does the current pathname (+search) count as "active" for this item? */
  matches?: (pathname: string, search: string) => boolean;
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

// Activity is the canonical timeline and owns every `/activity*` URL —
// type filters (deploy / mcp / system / config) live as tabs inside the
// page, not as separate sidebar entries.
const isActivityView = startsWith('/activity');

const SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'home', label: 'Home', icon: Home, to: '/home' },
      {
        id: 'your-agent',
        label: 'Your Agent',
        icon: Bot,
        to: '/mcp-server',
        matches: startsWith('/mcp-server'),
        badgeDot: 'ok',
      },
      {
        id: 'projects',
        label: 'Projects',
        icon: Folder,
        to: '/projects',
        matches: startsWith('/projects'),
        // badge filled in per-render from useProjects() — see component body
      },
      {
        id: 'activity',
        label: 'Activity',
        icon: Activity,
        to: '/activity',
        matches: isActivityView,
      },
      {
        id: 'monitoring',
        label: 'Monitoring',
        icon: BarChart3,
        to: '/monitoring',
        matches: startsWith('/monitoring'),
      },
      {
        id: 'web-server',
        label: 'Web Server',
        icon: Server,
        to: '/settings/web-server',
        matches: startsWith('/settings/web-server'),
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      {
        id: 'git',
        label: 'Git Providers',
        icon: Code2,
        to: '/settings/git-providers',
        matches: startsWith('/settings/git-providers'),
      },
      {
        id: 'ai-providers',
        label: 'AI Providers',
        icon: BrainCircuit,
        to: '/settings/ai-providers',
        matches: startsWith('/settings/ai-providers'),
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
  const { projects, loading, error } = useProjectsContext();
  const { t } = useLanguage();
  const projectsBadge: string | null =
    loading || error || projects.length === 0 ? null : String(projects.length);
  const { status: mcpStatus } = useMcpStatus();
  const agentDot: 'ok' | 'warning' | null =
    mcpStatus == null ? null : mcpStatus.totalConnected > 0 ? 'ok' : 'warning';

  const isActive = (item: NavItem): boolean => {
    if (item.matches) return item.matches(location.pathname, location.search);
    return location.pathname === item.to.split('?')[0];
  };

  return (
    <aside
      className={cn(
        'flex h-full flex-col',
        'border-r border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)]',
        'text-[color:var(--ol-fg)]',
      )}
      style={{ width: collapsed ? 'var(--ol-sidebar-w-collapsed)' : 'var(--ol-sidebar-w)' }}
      aria-label={t('sidebar.primaryNavAria')}
    >
      {/* Brand chip — `OpenLander vX.Y.Z`. Replaces the bare brand wordmark and
          drops the legacy `self-hosted` footer per design rev3. The version
          pin uses a stable integer font-size (11px) and lowercase; half-pixel
          sizes (9.5px) plus the uppercase transform produced inconsistent
          rendering across browsers and made the pin read as a status badge
          instead of a version stamp. */}
      <div className="flex h-[var(--ol-topbar-h)] items-center gap-2.5 border-b border-[color:var(--ol-border-subtle)] px-4">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-md bg-[color:var(--ol-primary-soft)]"
        >
          <img src={BRAND.markUrl} alt="" className="h-7 w-7 object-contain" />
        </span>
        {!collapsed && (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[15px] font-semibold tracking-tight">{BRAND.name}</span>
            <span
              className="text-[11px] font-medium tracking-tight text-[color:var(--ol-fg-muted)]"
              aria-label={`${t('sidebar.versionAria')} ${APP_VERSION_LABEL}`}
            >
              {APP_VERSION_LABEL}
            </span>
          </span>
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
                const displayBadge = item.id === 'projects' ? projectsBadge : (item.badge ?? null);
                const displayDot = item.id === 'your-agent' ? agentDot : (item.badgeDot ?? null);
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
                      {!collapsed && displayDot && (
                        <span
                          aria-hidden
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            displayDot === 'ok'
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

      {/* Account card pinned at bottom — single-admin v0.1. The legacy direct
          Sign out button became a popover with Change password + Sign
          out. The legacy "self-hosted vX.Y.Z" version
          stamp was dropped (replaced by the brand chip up top). */}
      <div className="border-t border-[color:var(--ol-border-subtle)] p-3">
        <AccountPopover collapsed={collapsed} />
      </div>
    </aside>
  );
}

export default Sidebar;
