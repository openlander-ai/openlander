/**
 * TopBar — Shell V2.
 *
 * Layout:
 *   [Sidebar toggle] · [Breadcrumb crumbs] ............... [Agent Command Center chip]
 *
 * The Agent chip is the agent-first identity statement at the top right
 * edge — connection state pip + last-action timestamp. v5 wiring (CCG
 * follow-up): the chip now reads live MCP session state via useMcpStatus
 * (no more hardcoded "Just now") and clicking it navigates to /activity
 * so the user can see what the agent actually did, in time order.
 */
import { Bot, ChevronRight, PanelLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  /** If absent, this crumb is rendered as the current page (non-clickable) */
  to?: string;
}

export interface TopBarProps {
  crumbs?: Crumb[];
  onToggleSidebar?: () => void;
  /** Override live state from useMcpStatus (test fixtures only). */
  agentState?: 'connected' | 'reconnecting' | 'disconnected';
  /** Override live last-active label (test fixtures only). e.g. "Just now". */
  lastAgentAction?: string;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return `${String(Math.floor(h / 24))}d ago`;
}

export function TopBar({
  crumbs = [],
  onToggleSidebar,
  agentState: agentStateOverride,
  lastAgentAction: lastAgentActionOverride,
}: TopBarProps) {
  const navigate = useNavigate();
  const { status } = useMcpStatus();
  const sessions = status?.sessions ?? [];
  const live = status != null;
  const liveAgentState: 'connected' | 'disconnected' =
    sessions.length > 0 ? 'connected' : 'disconnected';
  const lastSession = sessions[0];
  const liveLastAction = lastSession ? timeAgo(lastSession.lastActivityAt) : 'idle';

  // Test/fixture overrides win when explicitly set; otherwise read live state.
  // The pre-fetch placeholder ("idle") shows briefly before the first
  // /api/mcp/status round-trip lands.
  const agentState = agentStateOverride ?? (live ? liveAgentState : 'disconnected');
  const lastAgentAction = lastAgentActionOverride ?? liveLastAction;

  return (
    <header
      className={cn(
        'flex h-[var(--ol-topbar-h)] shrink-0 items-center gap-3 px-4',
        'border-b border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)]',
      )}
    >
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className="grid h-8 w-8 place-items-center rounded-md text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-[color:var(--ol-fg-subtle)]" />
            )}
            {c.to ? (
              <button
                type="button"
                onClick={() => navigate(c.to!)}
                className="truncate text-[color:var(--ol-fg-muted)] transition-colors hover:text-[color:var(--ol-fg)]"
              >
                {c.label}
              </button>
            ) : (
              <span aria-current="page" className="truncate font-medium text-[color:var(--ol-fg)]">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <button
        type="button"
        onClick={() => navigate('/activity')}
        className={cn(
          'flex items-center gap-2 rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-1.5',
          'text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
        )}
        title="Agent activity — see what your agent did"
      >
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            agentState === 'connected' &&
              'bg-[color:var(--ol-success)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--ol-success)_30%,transparent)]',
            agentState === 'reconnecting' && 'bg-[color:var(--ol-warning)]',
            agentState === 'disconnected' && 'bg-[color:var(--ol-fg-subtle)]',
          )}
        />
        <Bot aria-hidden className="h-3.5 w-3.5 opacity-70" />
        <span className="whitespace-nowrap">
          Agent · <span className="font-semibold text-[color:var(--ol-fg)]">{lastAgentAction}</span>
        </span>
      </button>
    </header>
  );
}

export default TopBar;
