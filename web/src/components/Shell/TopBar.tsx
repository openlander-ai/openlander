/**
 * TopBar — Shell V2.
 *
 * Layout:
 *   [Sidebar toggle] · [Breadcrumb crumbs] ............... [Agent Command Center chip]
 *
 * The Agent chip is the agent-first identity statement at the top right
 * edge — connection state pip + last-action timestamp. Clicking it
 * navigates to /mcp. (PR2 will wire it to a popover or panel.)
 */
import { Bot, ChevronRight, PanelLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  /** If absent, this crumb is rendered as the current page (non-clickable) */
  to?: string;
}

export interface TopBarProps {
  crumbs?: Crumb[];
  onToggleSidebar?: () => void;
  agentState?: 'connected' | 'reconnecting' | 'disconnected';
  /** e.g. "Just now", "12m ago" */
  lastAgentAction?: string;
}

export function TopBar({
  crumbs = [],
  onToggleSidebar,
  agentState = 'connected',
  lastAgentAction = 'Just now',
}: TopBarProps) {
  const navigate = useNavigate();

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
        onClick={() => navigate('/mcp')}
        className={cn(
          'flex items-center gap-2 rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-1.5',
          'text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
        )}
        title="Agent Command Center · MCP"
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
