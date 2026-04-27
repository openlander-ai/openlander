/**
 * InfraMapNode — custom React Flow node for the topology map.
 *
 * The node body carries:
 *   - A circular "disk" with the service kind glyph
 *   - The service name underneath
 *   - A small "crashed" pill when health is bad
 *   - A Bot badge (top-right) when the agent acted on this node recently
 *
 * React Flow handles node positioning + edge anchoring; this component
 * just renders the visual content. Handles are placed left + right so
 * dagre's `rankdir=LR` layout can route smoothstep edges between them.
 *
 * Hover state is stored in node `data` and managed by the parent so a
 * single popover (not one-per-node) renders above whichever node is
 * hovered.
 */
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ServiceNode } from '@/lib/projectTopology';

export interface InfraMapNodeData {
  service: ServiceNode;
  active: boolean;
  hasRecentAgent: boolean;
  /** Compact mode for dense layout (>8 services) — slightly smaller disk */
  dense: boolean;
  [key: string]: unknown;
}

const KIND_GLYPH: Record<string, string> = {
  web: '▤',
  api: '❍',
  worker: '◆',
  database: '▦',
  cache: '○',
  queue: '≡',
  edge: '▷',
};

function glyphForService(s: ServiceNode): string {
  if (s.kind === 'Database') {
    if (s.id === 'redis' || s.id === 'kv' || /redis/i.test(s.image)) return KIND_GLYPH.cache;
    if (s.id === 'queue' || /rabbit|amqp/i.test(s.image)) return KIND_GLYPH.queue;
    return KIND_GLYPH.database;
  }
  if (s.id === 'worker' || /worker/i.test(s.id)) return KIND_GLYPH.worker;
  if (s.id === 'edge' || /caddy|nginx|gateway|edge/i.test(s.id)) return KIND_GLYPH.edge;
  if (s.id === 'api' || /api/i.test(s.id)) return KIND_GLYPH.api;
  return KIND_GLYPH.web;
}

function InfraMapNodeComponent({ data }: NodeProps) {
  const { service, active, hasRecentAgent, dense } = data as InfraMapNodeData;
  const isCrashed = service.health === 'crashed';
  const labelStatus = isCrashed ? 'crashed' : 'healthy';

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      {/* Hidden React Flow handles — left + right edges anchor here */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1 !w-1 !border-0 !bg-transparent"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1 !w-1 !border-0 !bg-transparent"
        isConnectable={false}
      />

      <span
        aria-label={`${service.name} · ${labelStatus}`}
        className={cn(
          'infra-map-node-disk relative grid place-items-center rounded-full transition-shadow',
          dense ? 'h-7 w-7 text-[12px]' : 'h-9 w-9 text-[14px]',
          isCrashed
            ? 'h-crashed bg-[color:var(--ol-error-soft)] text-[color:var(--ol-error)]'
            : 'bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]',
          active &&
            'ring-2 ring-[color:var(--ol-primary)] ring-offset-2 ring-offset-[color:var(--ol-panel)]',
        )}
      >
        <span aria-hidden className="leading-none">
          {glyphForService(service)}
        </span>
        {hasRecentAgent && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full border border-[color:var(--ol-panel)] bg-[color:var(--ol-actor-mcp)] text-[color:var(--ol-panel)]"
            title="Agent acted on this service recently"
          >
            <Bot className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
      <span
        className={cn(
          'truncate font-medium text-[color:var(--ol-fg)]',
          dense ? 'text-[11px]' : 'text-[12px]',
        )}
      >
        {service.name}
      </span>
      {!dense && isCrashed && (
        <span className="rounded-full bg-[color:var(--ol-error-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-error)]">
          crashed
        </span>
      )}
    </div>
  );
}

export const InfraMapNode = memo(InfraMapNodeComponent);
export default InfraMapNode;
