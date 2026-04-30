/**
 * MCP Server — agent identity statement page.
 *
 * Two purposes:
 *   1. Tell the user where Claude (and other agents) reach OpenLander —
 *      endpoint URL, status, tools exposed.
 *   2. Show who is actively connected via /api/mcp/status snapshot.
 *
 * Recent agent calls reuses /api/activity (filtered to actor=mcp) so the
 * MCP page never owns its own event store. Tool-call statistics (call
 * counts, per-tool histogram) are deferred to 1.1; the page intentionally
 * does not invent numbers.
 */
import { Bot, Cable, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { useMcpStatus } from '@/hooks/use-mcp-status';

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MCPServer() {
  const navigate = useNavigate();
  const { status: mcpStatus, loading: mcpLoading, error: mcpError } = useMcpStatus();
  const { events: mcpEvents } = useActivityFeed({ limit: 20, actor: 'mcp' });

  // Derive the MCP endpoint from the current page origin as the best
  // available approximation until /api/mcp/status exists.
  const mcpEndpoint =
    typeof window !== 'undefined' ? `${window.location.hostname}/mcp` : 'your-server/mcp';

  // Status is driven by the MCP server itself, not by the HTTP proxy. A
  // successful /api/mcp/status fetch means the server is reachable;
  // totalConnected > 0 promotes the label from "Listening" to "Connected".
  let statusLabel: string;
  let statusColor: string;
  if (mcpError) {
    statusLabel = 'Unreachable';
    statusColor = 'var(--ol-error)';
  } else if (!mcpStatus) {
    statusLabel = mcpLoading ? 'Checking…' : 'Unknown';
    statusColor = 'var(--ol-fg-muted)';
  } else if (mcpStatus.totalConnected > 0) {
    statusLabel = 'Connected';
    statusColor = 'var(--ol-success)';
  } else {
    statusLabel = 'Listening';
    statusColor = 'var(--ol-fg-muted)';
  }
  const proxyOk = statusLabel === 'Connected';
  const toolNames = mcpStatus?.tools ?? [];
  const toolCount = toolNames.length;
  const actionCount = mcpStatus?.actions ?? 0;
  const stripPrefix = (s: string) => s.replace(/^openlander_/, '');
  const toolFooter = toolNames.length
    ? `${toolNames.slice(0, 4).map(stripPrefix).join(', ')}${toolNames.length > 4 ? ', …' : ''}`
    : '—';

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatusTile
            label="Status"
            value={
              <span
                className="inline-flex items-center gap-1.5 text-[13px] font-medium"
                style={{ color: statusColor }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    backgroundColor: statusColor,
                    boxShadow: proxyOk
                      ? '0 0 0 3px color-mix(in oklch, var(--ol-success) 30%, transparent)'
                      : 'none',
                  }}
                />
                {statusLabel}
              </span>
            }
            footer={
              mcpStatus
                ? `${String(mcpStatus.totalConnected)} session${mcpStatus.totalConnected === 1 ? '' : 's'}`
                : 'via /api/mcp/status'
            }
          />
          <StatusTile
            label="Endpoint"
            value={
              <span className="ol-mono break-all text-[12px] text-[color:var(--ol-fg)]">
                {mcpEndpoint}
              </span>
            }
            footer={
              <button
                type="button"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    void navigator.clipboard.writeText(mcpEndpoint).catch(() => {
                      /* best-effort */
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
              <span className="flex items-baseline gap-2">
                <span className="text-[20px] font-semibold tabular-nums text-[color:var(--ol-fg)]">
                  {toolCount || '—'}
                </span>
                {actionCount > 0 && (
                  <span className="text-[11px] text-[color:var(--ol-fg-muted)]">
                    · {String(actionCount)} actions
                  </span>
                )}
              </span>
            }
            footer={toolFooter}
          />
        </div>
      </OuterCard>

      {/* Connected agents — live MCP session snapshot */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Cable className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            Connected agents
          </span>
        }
        subtitle="Live MCP sessions snapshot."
      >
        {mcpError ? (
          <div className="py-6 text-center text-[13px] text-[color:var(--ol-error)]">
            Failed to load MCP status: {mcpError}
          </div>
        ) : mcpLoading && !mcpStatus ? (
          <div className="py-6 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            Checking sessions…
          </div>
        ) : !mcpStatus || mcpStatus.totalConnected === 0 ? (
          <div className="py-6 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            No active sessions. Connect an agent to see it here.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[color:var(--ol-border-subtle)]">
            {mcpStatus.sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-3">
                <div
                  aria-hidden
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color:var(--ol-panel-2)] text-[color:var(--ol-primary)]"
                >
                  <Bot className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {s.clientName ? (
                      <span className="truncate text-[12.5px] font-medium text-[color:var(--ol-fg)]">
                        {s.clientName}
                        {s.clientVersion && (
                          <span className="ml-1.5 text-[10.5px] font-normal text-[color:var(--ol-fg-muted)]">
                            v{s.clientVersion}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="ol-mono truncate text-[12.5px] font-medium text-[color:var(--ol-fg)]">
                        {s.id}
                      </span>
                    )}
                    <span className="shrink-0 rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
                      {s.transport}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11.5px] text-[color:var(--ol-fg-muted)]">
                    {s.clientName && (
                      <span className="ol-mono shrink-0 text-[10.5px] text-[color:var(--ol-fg-subtle)]">
                        {s.id}
                      </span>
                    )}
                    <span>connected {formatRelative(s.connectedAt)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11.5px] text-[color:var(--ol-fg-muted)]">
                  last call · {formatRelative(s.lastActivityAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </OuterCard>

      {/* Agent activity — sourced from /api/activity?actor=mcp */}
      <OuterCard
        title="Agent activity"
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
          events={mcpEvents}
          emptyState="No agent calls yet. MCP-triggered deploys and connections appear here."
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
