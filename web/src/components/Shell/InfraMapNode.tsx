/**
 * InfraMapNode — custom React Flow node for the topology map.
 *
 * Phase D redesign (plan §D): Drop the 26px disk + kind glyph (v2 style).
 * Use Linear inline-status style: 8px status pip + mono service name.
 * This is lighter, more readable, and matches v4's restraint principle.
 *
 * Node body:
 *   [8px status pip] [service name mono] [Bot badge when agent active]
 *
 * React Flow handles node positioning + edge anchoring.
 * Handles are placed left + right for dagre rankdir=LR edges.
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
  /** Compact mode for dense layout (>8 services) */
  dense: boolean;
  [key: string]: unknown;
}

function InfraMapNodeComponent({ data }: NodeProps) {
  const { service, active, hasRecentAgent, dense } = data as InfraMapNodeData;
  const isCrashed = service.health === 'crashed';

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 rounded-md border px-2 py-1 transition-shadow',
        dense ? 'text-[11px]' : 'text-[12px]',
        isCrashed
          ? 'border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_8%,var(--ol-panel))] text-[color:var(--ol-error)]'
          : active
            ? 'border-[color:var(--ol-primary)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg)]'
            : 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg)]',
      )}
      aria-label={`${service.name} · ${isCrashed ? 'crashed' : 'healthy'}`}
    >
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

      {/* 8px status pip */}
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          backgroundColor: isCrashed ? 'var(--ol-error)' : 'var(--ol-success)',
        }}
      />

      {/* Mono service name */}
      <span
        className={cn(
          'ol-mono truncate font-medium',
          isCrashed ? 'text-[color:var(--ol-error)]' : 'text-[color:var(--ol-fg)]',
        )}
      >
        {service.name}
      </span>

      {/* Agent badge (only when agent acted recently) */}
      {hasRecentAgent && (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-[color:var(--ol-panel)] bg-[color:var(--ol-actor-mcp)] text-[color:var(--ol-panel)]"
          title="Agent acted on this service recently"
        >
          <Bot className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  );
}

export const InfraMapNode = memo(InfraMapNodeComponent);
export default InfraMapNode;
