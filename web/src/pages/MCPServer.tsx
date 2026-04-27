/**
 * MCP Server — agent identity statement page.
 *
 * Two purposes:
 *   1. Tell the user where Claude (and other agents) reach OpenLander —
 *      endpoint URL, status, tools exposed.
 *   2. Show *who* is actively connected. Live MCP sessions with
 *      per-agent stats; disconnect terminates the session.
 *
 * Per the trim: no auto-restart classification, no agent reasoning
 * paragraphs. The recent-calls list re-uses the same ActivityTimeline
 * primitive filtered to actor=mcp.
 */
import { Bot, Cable, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { MOCK_ACTIVITY, MOCK_MCP_INFO } from '@/lib/agentActivity';

export function MCPServer() {
  const navigate = useNavigate();
  const info = MOCK_MCP_INFO;
  const recentMcpEvents = MOCK_ACTIVITY.filter((e) => e.actor === 'mcp').slice(0, 6);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* Status tiles */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[color:var(--ol-primary)]" />
            MCP Server
          </span>
        }
        subtitle="Where Claude and other agents reach OpenLander."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile
            label="Status"
            value={
              <span
                className="inline-flex items-center gap-1.5 text-[13px] font-medium"
                style={{
                  color:
                    info.status === 'connected'
                      ? 'var(--ol-success)'
                      : info.status === 'reconnecting'
                        ? 'var(--ol-warning)'
                        : 'var(--ol-error)',
                }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      info.status === 'connected'
                        ? 'var(--ol-success)'
                        : info.status === 'reconnecting'
                          ? 'var(--ol-warning)'
                          : 'var(--ol-error)',
                    boxShadow:
                      info.status === 'connected'
                        ? '0 0 0 3px color-mix(in oklch, var(--ol-success) 30%, transparent)'
                        : 'none',
                  }}
                />
                {info.status === 'connected'
                  ? 'Connected'
                  : info.status === 'reconnecting'
                    ? 'Reconnecting…'
                    : 'Disconnected'}
              </span>
            }
            footer={`last call · ${info.lastCallAt}`}
          />
          <StatusTile
            label="Endpoint"
            value={
              <span className="ol-mono break-all text-[12px] text-[color:var(--ol-fg)]">
                {info.endpoint}
              </span>
            }
            footer={
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    void navigator.clipboard.writeText(info.endpoint).catch(() => {
                      /* clipboard write best-effort */
                    });
                  }
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
            }
          />
          <StatusTile
            label="Tools exposed"
            value={
              <span className="text-[20px] font-semibold tabular-nums">{info.toolsExposed}</span>
            }
            footer="deploy, logs, restart, scale, env, …"
          />
          <StatusTile
            label="Calls today"
            value={
              <span className="text-[20px] font-semibold tabular-nums">{info.callsToday}</span>
            }
            footer={`${info.agentsConnected} agent${info.agentsConnected === 1 ? '' : 's'} active`}
          />
        </div>
      </OuterCard>

      {/* Connected agents */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            Connected agents
          </span>
        }
        subtitle="Live MCP sessions. Disconnecting terminates the session immediately."
        bodyClassName="p-0"
      >
        <ul>
          {info.agents.map((a, i) => (
            <li
              key={a.id}
              className={
                i > 0
                  ? 'flex items-center gap-3 px-5 py-3 border-t border-[color:var(--ol-border-subtle)]'
                  : 'flex items-center gap-3 px-5 py-3'
              }
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-[color:var(--ol-fg)]">
                  {a.name}
                </div>
                <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
                  connected {a.connectedAt} · {a.callsToday} call
                  {a.callsToday === 1 ? '' : 's'} today
                </div>
              </div>
              <div className="hidden text-[11.5px] text-[color:var(--ol-fg-subtle)] sm:block">
                last call · {a.lastCallAt}
              </div>
              <button
                type="button"
                className="rounded-md border border-[color:var(--ol-border)] px-2.5 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
                title="Disconnect this agent session"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      </OuterCard>

      {/* Recent agent calls */}
      <OuterCard
        title="Recent agent calls"
        subtitle="MCP-triggered events only. Full history under Activity."
        actions={
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            Full timeline →
          </button>
        }
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={recentMcpEvents}
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>
    </div>
  );
}

interface StatusTileProps {
  label: string;
  value: React.ReactNode;
  footer?: React.ReactNode;
}

function StatusTile({ label, value, footer }: StatusTileProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
        {label}
      </div>
      <div className="min-h-[24px]">{value}</div>
      {footer != null && (
        <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">{footer}</div>
      )}
    </div>
  );
}

export default MCPServer;
