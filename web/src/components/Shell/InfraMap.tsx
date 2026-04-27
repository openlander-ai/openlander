/**
 * InfraMap — Round 4 PR4 React Flow rewrite.
 *
 * The crooked-edge problem in the previous SVG-bezier impl was caused
 * by computing paths from DOM rects after `flex-wrap` reflowed nodes
 * into multiple rows. We delegate layout + edge routing to React Flow
 * + dagre and stop fighting it.
 *
 * Layout decision tree:
 *   services.length === 0 → InfraMapEmpty (no graph)
 *   services.length === 1 → InfraMapLonely (single centered node)
 *   forceDense || services.length > 8 → grouped 3-lane (entry / app / data)
 *   else → standard horizontal flow (rankdir=LR)
 *
 * The viewport is locked: no pan, no zoom, no drag — this is a static
 * topology view, not an editor. `fitView` is enabled so dagre's
 * computed bounds get fitted into the container on every services
 * change.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Bot, Box } from 'lucide-react';
import { InfraMapNode, type InfraMapNodeData } from './InfraMapNode';
import { type ServiceNode, type Lane, laneFor, recentAgentFor } from '@/lib/projectTopology';
import type { ActivityEvent } from '@/lib/agentActivity';
import './InfraMap.css';

const NODE_WIDTH = 84;
const NODE_HEIGHT = 84;
const NODE_WIDTH_DENSE = 70;
const NODE_HEIGHT_DENSE = 64;

const NODE_TYPES = { topology: InfraMapNode };

interface InfraMapProps {
  projectId: string;
  services: ServiceNode[];
  agentActivity: ActivityEvent[];
  activeNodeId?: string;
  onSelectService?: (projectId: string, serviceId: string) => void;
  forceDense?: boolean;
  /**
   * When true, the topology fetch hasn't returned real data and the
   * caller is showing mock services. Surface a "Sample data" affordance
   * in the eyebrow so users know what they're looking at.
   */
  isDemo?: boolean;
}

export function InfraMap(props: InfraMapProps) {
  const services = props.services;

  if (services.length === 0) return <InfraMapEmpty />;
  if (services.length === 1) {
    return (
      <InfraMapLonely
        service={services[0]}
        projectId={props.projectId}
        agentActivity={props.agentActivity}
        active={props.activeNodeId === services[0].id}
        onSelect={props.onSelectService}
        isDemo={props.isDemo}
      />
    );
  }

  return (
    <ReactFlowProvider>
      <InfraMapGraph {...props} />
    </ReactFlowProvider>
  );
}

function DemoEyebrowChip() {
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded bg-[color-mix(in_oklch,var(--ol-warning)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--ol-warning)]"
      title="Backend topology endpoint unavailable — showing sample data"
    >
      Sample data
    </span>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function InfraMapEmpty() {
  return (
    <section
      className="infra-map rounded-[var(--ol-radius)] border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-3"
      role="status"
      aria-label="Empty topology"
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span className="grid h-5 w-5 place-items-center rounded bg-[color:var(--ol-panel)] text-[color:var(--ol-fg-subtle)]">
          <Box className="h-3 w-3" />
        </span>
        <span className="text-[color:var(--ol-fg-muted)]">
          No services yet — your topology will appear here once you create one.
        </span>
      </div>
    </section>
  );
}

// ─── Lonely (1 service, no edges) ──────────────────────────────────────────

interface LonelyProps {
  service: ServiceNode;
  projectId: string;
  agentActivity: ActivityEvent[];
  active: boolean;
  onSelect?: (projectId: string, serviceId: string) => void;
}

function InfraMapLonely({
  service,
  projectId,
  agentActivity,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  active: _active,
  onSelect,
  isDemo,
}: LonelyProps & { isDemo?: boolean }) {
  const recent = recentAgentFor(projectId, service.id, agentActivity);
  const isCrashed = service.health === 'crashed';
  const labelStatus = isCrashed ? 'crashed' : 'healthy';
  return (
    <section className="infra-map rounded-[var(--ol-radius)] border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
      <Eyebrow count={1} layout="lonely" services={[service]} isDemo={isDemo} />
      <div className="flex flex-wrap items-center gap-4 px-4 pb-4">
        <button
          type="button"
          onClick={() => onSelect?.(projectId, service.id)}
          aria-label={`${service.name} · ${labelStatus}`}
          className="group relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)] border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] hover:border-[color:var(--ol-border-strong)]"
        >
          {/* 8px status pip */}
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: isCrashed ? 'var(--ol-error)' : 'var(--ol-success)' }}
          />
          <span className="ol-mono font-medium text-[color:var(--ol-fg)]">{service.name}</span>
          {recent && (
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-[color:var(--ol-panel)] bg-[color:var(--ol-actor-mcp)] text-[color:var(--ol-panel)]"
              title="Agent acted recently"
            >
              <Bot className="h-2.5 w-2.5" />
            </span>
          )}
        </button>
        <span className="text-[12px] text-[color:var(--ol-fg-subtle)]">
          No dependencies declared. Add one in{' '}
          <code className="ol-mono rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5 text-[11px]">
            compose.yml
          </code>{' '}
          with{' '}
          <code className="ol-mono rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5 text-[11px]">
            depends_on
          </code>
          .
        </span>
      </div>
    </section>
  );
}

// ─── Graph (>=2 services) ──────────────────────────────────────────────────

function InfraMapGraph({
  projectId,
  services,
  agentActivity,
  activeNodeId,
  onSelectService,
  forceDense,
  isDemo,
}: InfraMapProps) {
  const dense = forceDense || services.length > 8;
  const direction = dense ? 'TB' : 'LR';

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [hoverState, setHoverState] = useState<{
    serviceId: string;
    x: number;
    y: number;
    /** Bottom edge of the node, used by NodePopover to flip below when above is cramped */
    yBottom: number;
  } | null>(null);

  const { fitView } = useReactFlow();

  // PR7-C: split into two effects so dagre re-layout doesn't fire on every
  // agentActivity poll tick.
  //
  // LAYOUT effect runs only when the graph topology actually changes
  // (services / projectId / dense / direction / activeNodeId). It reads
  // `agentActivity` via a ref so the initial paint has correct Bot
  // badges, but agentActivity changes alone don't trigger this effect.
  //
  // DATA UPDATE effect (below) handles `agentActivity` changes by
  // patching only `data.hasRecentAgent` on existing nodes via
  // `setNodes((prev) => prev.map(...))`. No dagre. No re-positioning.
  // Ref synced via useEffect to satisfy react-hooks/refs ("don't update
  // refs during render"). The initial value is captured by useRef on
  // mount; the sync effect keeps it fresh after every render so the
  // layout effect — which only re-runs on topology changes — reads the
  // current agentActivity, not a stale snapshot.
  //
  // Effect timing (per PR7 review): React fires effects in declaration
  // order, so this sync effect ALWAYS runs before the layout effect
  // below within the same commit. There's no stale-window because:
  //   • If only `agentActivity` changes → only the data-update effect
  //     re-runs (layout effect's deps don't include it). Sync effect
  //     refreshes the ref but nothing else reads it this cycle.
  //   • If topology AND `agentActivity` change in the same render →
  //     sync effect refreshes ref FIRST, then layout effect reads it.
  //   • If only topology changes → sync effect doesn't re-run (deps
  //     unchanged), layout effect reads the ref's last-committed value
  //     which is by definition the current `agentActivity`.
  const agentActivityRef = useRef(agentActivity);
  useEffect(() => {
    agentActivityRef.current = agentActivity;
  }, [agentActivity]);

  // ─── LAYOUT effect (expensive — runs on topology change) ───
  useEffect(() => {
    const widthForLayout = dense ? NODE_WIDTH_DENSE : NODE_WIDTH;
    const heightForLayout = dense ? NODE_HEIGHT_DENSE : NODE_HEIGHT;
    const ordered = orderForFlow(services);

    const initialNodes: Node[] = ordered.map((svc) => {
      const data: InfraMapNodeData = {
        service: svc,
        active: svc.id === activeNodeId,
        hasRecentAgent: recentAgentFor(projectId, svc.id, agentActivityRef.current) != null,
        dense,
      };
      return {
        id: svc.id,
        type: 'topology',
        data,
        position: { x: 0, y: 0 },
        targetPosition: dense ? Position.Top : Position.Left,
        sourcePosition: dense ? Position.Bottom : Position.Right,
        draggable: false,
        selectable: false,
        connectable: false,
      };
    });

    const initialEdges: Edge[] = [];
    for (const svc of services) {
      for (const dep of svc.dependsOn) {
        const target = services.find((n) => n.id === dep);
        if (!target) continue;
        const isAlert = target.health === 'crashed';
        // Bezier edges separate visually when multiple sources target the
        // same node (e.g. api+worker both → postgres). Smoothstep was
        // routing them onto identical orthogonal paths and stacking on
        // top of each other; bezier gives each curve its own angle of
        // approach because the source y-position differs.
        initialEdges.push({
          id: `${svc.id}->${dep}`,
          source: svc.id,
          target: dep,
          type: 'bezier',
          className: isAlert ? 'alert' : undefined,
        });
      }
    }

    const laid = layoutWithDagre(
      initialNodes,
      initialEdges,
      direction,
      widthForLayout,
      heightForLayout,
    );
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [services, projectId, activeNodeId, dense, direction, setNodes, setEdges]);

  // ─── DATA UPDATE effect (cheap — runs on agentActivity ticks) ───
  // Patches only `data.hasRecentAgent` on existing nodes. No dagre.
  // This is what saves us from a full re-layout on every 3-10s poll.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const nextHasAgent = recentAgentFor(projectId, n.id, agentActivity) != null;
        const data = n.data as InfraMapNodeData;
        if (data.hasRecentAgent === nextHasAgent) return n;
        return { ...n, data: { ...data, hasRecentAgent: nextHasAgent } };
      }),
    );
  }, [agentActivity, projectId, setNodes]);

  // Re-fit viewport whenever the node list changes
  useEffect(() => {
    if (nodes.length === 0) return;
    const id = window.setTimeout(() => fitView({ padding: 0.25, duration: 220 }), 0);
    return () => window.clearTimeout(id);
  }, [nodes, fitView]);

  const onNodeMouseEnter: NodeMouseHandler = (event, node) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const root = (event.currentTarget as HTMLElement).closest('.infra-map') as HTMLElement | null;
    const rootRect = root?.getBoundingClientRect();
    setHoverState({
      serviceId: node.id,
      x: rootRect ? rect.left + rect.width / 2 - rootRect.left : rect.left + rect.width / 2,
      y: rootRect ? rect.top - rootRect.top : rect.top,
      yBottom: rootRect ? rect.bottom - rootRect.top : rect.bottom,
    });
  };

  const onNodeMouseLeave: NodeMouseHandler = () => setHoverState(null);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    onSelectService?.(projectId, node.id);
  };

  const heightPx = dense ? Math.max(180, services.length * 24) : 220;

  const hoveredService = useMemo(
    () => services.find((s) => s.id === hoverState?.serviceId),
    [services, hoverState],
  );
  const hoveredAgent = useMemo(
    () => (hoveredService ? recentAgentFor(projectId, hoveredService.id, agentActivity) : null),
    [hoveredService, projectId, agentActivity],
  );

  return (
    <section
      className="infra-map relative rounded-[var(--ol-radius)] border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]"
      data-shell-label="topology-strip"
    >
      <Eyebrow
        count={services.length}
        layout={dense ? 'dense' : 'standard'}
        services={services}
        isDemo={isDemo}
      />
      <div style={{ height: heightPx }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      {hoveredService && hoverState && (
        <NodePopover
          service={hoveredService}
          recentAgent={hoveredAgent}
          x={hoverState.x}
          y={hoverState.y}
          yBottom={hoverState.yBottom}
        />
      )}
    </section>
  );
}

// ─── Eyebrow ────────────────────────────────────────────────────────────────

function Eyebrow({
  count,
  layout,
  services,
  isDemo,
}: {
  count: number;
  layout: 'standard' | 'dense' | 'lonely';
  services: ServiceNode[];
  isDemo?: boolean;
}) {
  const tally = useMemo(() => countByHealth(services), [services]);
  const trouble = tally.crashed;
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-2 text-[11px]">
      <span className="font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
        Topology
      </span>
      <span className="text-[color:var(--ol-fg-subtle)]">
        · {count} service{count === 1 ? '' : 's'}
        {layout === 'dense' && ' · grouped view'}
      </span>
      {isDemo && <DemoEyebrowChip />}
      <span className="ml-auto flex items-center gap-2">
        {trouble === 0 ? (
          <span className="flex items-center gap-1.5 text-[color:var(--ol-fg-muted)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: 'var(--ol-success)' }}
            />
            all healthy
          </span>
        ) : (
          <span
            className="flex items-center gap-1.5 font-medium"
            style={{ color: 'var(--ol-error)' }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: 'var(--ol-error)' }}
            />
            {trouble} crashed
          </span>
        )}
      </span>
    </div>
  );
}

// ─── Popover ────────────────────────────────────────────────────────────────

function NodePopover({
  service,
  recentAgent,
  x,
  y,
  yBottom,
}: {
  service: ServiceNode;
  recentAgent: ActivityEvent | null;
  x: number;
  y: number;
  /** Bottom edge of the hovered node, used to anchor the popover when flipped below */
  yBottom: number;
}) {
  const isCrashed = service.health === 'crashed';
  const status = isCrashed ? 'crashed' : 'healthy';
  // Estimated popover height: header row + 3 dl rows + optional agent row +
  // CTA line ≈ 140px. If the node is too close to the container top to fit
  // a 140px popover above + 12px gap, flip the popover below the node so
  // it doesn't get clipped by the React Flow viewport's overflow:hidden.
  // PR7-D fix.
  const POPOVER_EST_HEIGHT = 140;
  const flipBelow = y < POPOVER_EST_HEIGHT + 12;
  const style: CSSProperties = flipBelow
    ? { left: x, top: yBottom + 12, transform: 'translate(-50%, 0)' }
    : { left: x, top: y - 12, transform: 'translate(-50%, -100%)' };
  return (
    <div
      style={style}
      className="infra-map-popover rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-3 shadow-lg shadow-[color:var(--ol-border)]/30"
      role="tooltip"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: isCrashed ? 'var(--ol-error)' : 'var(--ol-success)',
          }}
        />
        <span className="text-[13px] font-semibold text-[color:var(--ol-fg)]">{service.name}</span>
        <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
          · {service.kind.toLowerCase()}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <dt className="text-[color:var(--ol-fg-subtle)]">status</dt>
        <dd
          className="font-medium"
          style={{ color: isCrashed ? 'var(--ol-error)' : 'var(--ol-success)' }}
        >
          {status}
        </dd>
        <dt className="text-[color:var(--ol-fg-subtle)]">image</dt>
        <dd className="ol-mono break-all text-[11px] text-[color:var(--ol-fg-muted)]">
          {service.image}
        </dd>
        {service.cpu !== '—' && (
          <>
            <dt className="text-[color:var(--ol-fg-subtle)]">cpu · mem</dt>
            <dd className="ol-mono tabular-nums text-[color:var(--ol-fg-muted)]">
              {service.cpu} · {service.mem}
            </dd>
          </>
        )}
      </dl>
      {recentAgent && (
        <div className="mt-2 flex items-center gap-1.5 rounded border-t border-[color:var(--ol-border-subtle)] pt-2 text-[11px]">
          <Bot className="h-3 w-3 text-[color:var(--ol-actor-mcp)]" />
          <span className="line-clamp-1 flex-1 text-[color:var(--ol-fg-muted)]">
            {recentAgent.title.replace(/`/g, '')}
          </span>
          <span className="text-[color:var(--ol-fg-subtle)]">{recentAgent.at}</span>
        </div>
      )}
      <div className="mt-2 text-[11px] text-[color:var(--ol-fg-subtle)]">
        Click to open service →
      </div>
    </div>
  );
}

// ─── Layout helpers ────────────────────────────────────────────────────────

function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB',
  width: number,
  height: number,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    // Bezier edges from multiple sources to the same target need
    // breathing room — both vertical (so the curves don't fan-in onto
    // the same y) and horizontal (so the bezier control points have
    // enough span to differentiate). The previous 60/22 was tight for
    // standard 5-service projects.
    nodesep: direction === 'LR' ? 36 : 28,
    ranksep: direction === 'LR' ? 110 : 56,
    marginx: 14,
    marginy: 14,
  });
  for (const n of nodes) g.setNode(n.id, { width, height });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const positioned = nodes.map((n) => {
    const p = g.node(n.id);
    return {
      ...n,
      position: {
        x: (p?.x ?? 0) - width / 2,
        y: (p?.y ?? 0) - height / 2,
      },
    };
  });
  return { nodes: positioned, edges };
}

function orderForFlow(services: ServiceNode[]): ServiceNode[] {
  // Sort by tier (entry → app → data) so dagre's row-1 reads left-to-right
  // with the user's mental flow (entry traffic → app code → data store).
  const incoming: Record<string, number> = {};
  for (const s of services) incoming[s.id] = 0;
  for (const s of services) {
    for (const d of s.dependsOn) incoming[d] = (incoming[d] ?? 0) + 1;
  }
  const tiers: Record<Lane, ServiceNode[]> = { entry: [], app: [], data: [] };
  for (const s of services) tiers[laneFor(s)].push(s);
  for (const k of ['entry', 'app', 'data'] as const) {
    tiers[k].sort((a, b) => (incoming[a.id] ?? 0) - (incoming[b.id] ?? 0));
  }
  return [...tiers.entry, ...tiers.app, ...tiers.data];
}

function countByHealth(services: ServiceNode[]): { healthy: number; crashed: number } {
  let healthy = 0;
  let crashed = 0;
  for (const s of services) {
    if (s.health === 'crashed') crashed++;
    else healthy++;
  }
  return { healthy, crashed };
}

export default InfraMap;
