/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * InfraMap — v5 design (Round 4 PR4 React Flow rewrite is gone).
 *
 * Lint note: this file reads `service.image` off the frontend
 * ServiceNode wire shape (lib/projectTopology), not the dropped DB
 * column. The no-dropped-columns rule is name-based and would misfire
 * here, so it's disabled file-wide.
 *
 * Custom CSS+SVG topology strip. The previous React Flow + dagre
 * implementation produced a layout that drifted from the design source
 * (.omc/analysis/openlander-design-v5/.../infra_map.jsx). This rewrite
 * matches that intent verbatim:
 *
 *   M1  Health-aware nodes — three runtime states (healthy/running/crashed).
 *   M2  Agent activity overlay — Bot badge on nodes touched within
 *       the last 1800s.
 *   M3  Real edges — driven by service.dependsOn (no synthesised topology).
 *   M4  Dense layout — when count > 8 (or forceDense from caller), grouped
 *       lanes (entry / app / data) so labels still breathe.
 *   M5  Empty / lonely degrades gracefully.
 *   M6  Click-to-navigate + hover popover.
 *
 * Edges are visual-only (no traffic animation). The single motion is the
 * pulse on crashed-state nodes.
 */
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Box } from 'lucide-react';
import {
  type ServiceNode,
  type ServiceHealth,
  type Lane,
  laneFor,
  recentAgentFor,
} from '@/lib/projectTopology';
import type { ActivityEvent } from '@/lib/agentActivity';
import './InfraMap.css';

interface InfraMapProps {
  projectId: string;
  services: ServiceNode[];
  agentActivity: ActivityEvent[];
  activeNodeId?: string;
  onSelectService?: (projectId: string, serviceId: string) => void;
  forceDense?: boolean;
  /** True when caller is showing mock/fallback services (backend unreachable). */
  isDemo?: boolean;
}

const HEALTH_PULSE: Record<ServiceHealth, boolean> = {
  healthy: false,
  running: false,
  crashed: true,
  degraded: false,
  restarting: false,
  starting: false,
  stopped: false,
  recovering: false,
  unknown: false,
};

const HEALTH_LABEL: Record<ServiceHealth, string> = {
  healthy: 'healthy',
  running: 'running',
  crashed: 'crashed',
  degraded: 'degraded',
  restarting: 'restarting',
  starting: 'starting',
  stopped: 'stopped',
  recovering: 'recovering',
  unknown: 'unknown',
};

export function InfraMap(props: InfraMapProps) {
  const { services } = props;

  if (services.length === 0) {
    return <InfraMapEmpty />;
  }
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
  if (props.forceDense || services.length > 8) {
    return <InfraMapDense {...props} />;
  }
  return <InfraMapStandard {...props} />;
}

// ─────────────────────────────────────────────────────────────────────
// Empty / Lonely

function InfraMapEmpty() {
  return (
    <div className="topology-strip empty" role="status" aria-label="Empty topology">
      <div className="empty-strip-inner">
        <span className="empty-strip-pip">
          <Box className="h-3.5 w-3.5" />
        </span>
        <span className="topology-muted">
          No services yet — your topology will appear here once you create one.
        </span>
      </div>
    </div>
  );
}

interface LonelyProps {
  service: ServiceNode;
  projectId: string;
  agentActivity: ActivityEvent[];
  active: boolean;
  onSelect?: (projectId: string, serviceId: string) => void;
  isDemo?: boolean;
}

function InfraMapLonely({
  service,
  projectId,
  agentActivity,
  active,
  onSelect,
  isDemo,
}: LonelyProps) {
  const recent = recentAgentFor(projectId, service.id, agentActivity);
  return (
    <div className="topology-strip lonely">
      <div className="topology-eyebrow">
        <span className="topology-eyebrow-label">Topology</span>
        <span className="topology-eyebrow-meta">· 1 service</span>
        {isDemo && <DemoChip />}
      </div>
      <div className="lonely-row">
        <TopologyNode
          service={service}
          projectId={projectId}
          active={active}
          recentAgent={recent}
          onSelect={onSelect}
        />
        <span className="lonely-hint topology-muted">
          No dependencies declared. Add one in <code className="topology-mono">compose.yml</code>{' '}
          with <code className="topology-mono">depends_on</code>.
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Standard (2–8 services, single horizontal row with SVG edges)

function InfraMapStandard(props: InfraMapProps) {
  const { services, projectId, agentActivity, activeNodeId, onSelect, isDemo } =
    asNormalizedProps(props);
  const ordered = useMemo(() => orderForFlow(services), [services]);
  const counts = useMemo(() => countByHealth(services), [services]);
  const flowRef = useRef<HTMLDivElement>(null);
  const [edgePaths, setEdgePaths] = useState<EdgePath[]>([]);

  useLayoutEffect(() => {
    if (!flowRef.current) return;

    const compute = () => {
      const root = flowRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const next: EdgePath[] = [];
      for (const s of services) {
        for (const dep of s.dependsOn) {
          const fromEl = root.querySelector<HTMLElement>(`[data-node-id="${s.id}"]`);
          const toEl = root.querySelector<HTMLElement>(`[data-node-id="${dep}"]`);
          if (!fromEl || !toEl) continue;
          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();
          const x1 = fromRect.right - rootRect.left;
          const y1 = fromRect.top + fromRect.height / 2 - rootRect.top;
          const x2 = toRect.left - rootRect.left;
          const y2 = toRect.top + toRect.height / 2 - rootRect.top;
          const dx = Math.max(20, (x2 - x1) * 0.45);
          const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
          const target = services.find((n) => n.id === dep);
          const sev: EdgeSeverity = target?.health === 'crashed' ? 'alert' : 'ok';
          next.push({ id: `${s.id}->${dep}`, d, sev });
        }
      }
      setEdgePaths(next);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(flowRef.current);
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [services]);

  return (
    <div className="topology-strip">
      <div className="topology-eyebrow">
        <span className="topology-eyebrow-label">Topology</span>
        <span className="topology-eyebrow-meta">· {services.length} services</span>
        {isDemo && <DemoChip />}
        <HealthSummary counts={counts} />
      </div>
      <div className="topology-flow" ref={flowRef}>
        <svg className="topology-edges" aria-hidden="true">
          {edgePaths.map((p) => (
            <path key={p.id} d={p.d} className={`topo-edge topo-edge-${p.sev}`} />
          ))}
        </svg>
        <div className="topology-flow-row">
          {ordered.map((s) => (
            <Fragment key={s.id}>
              <TopologyNode
                service={s}
                projectId={projectId}
                active={s.id === activeNodeId}
                recentAgent={recentAgentFor(projectId, s.id, agentActivity)}
                onSelect={onSelect}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dense (>8 services, 3-lane grouped layout)

function InfraMapDense(props: InfraMapProps) {
  const { services, projectId, agentActivity, activeNodeId, onSelect, isDemo } =
    asNormalizedProps(props);
  const lanes = useMemo(() => {
    const out: Record<Lane, ServiceNode[]> = { entry: [], app: [], data: [] };
    for (const s of services) {
      out[laneFor(s)].push(s);
    }
    return out;
  }, [services]);
  const counts = useMemo(() => countByHealth(services), [services]);

  return (
    <div className="topology-strip dense">
      <div className="topology-eyebrow">
        <span className="topology-eyebrow-label">Topology</span>
        <span className="topology-eyebrow-meta">· {services.length} services · grouped view</span>
        {isDemo && <DemoChip />}
        <HealthSummary counts={counts} />
      </div>
      <div className="topology-lanes">
        <DenseLane
          label="Entry"
          tone="entry"
          services={lanes.entry}
          projectId={projectId}
          agentActivity={agentActivity}
          activeNodeId={activeNodeId}
          onSelect={onSelect}
        />
        <DenseLane
          label="App"
          tone="app"
          services={lanes.app}
          projectId={projectId}
          agentActivity={agentActivity}
          activeNodeId={activeNodeId}
          onSelect={onSelect}
        />
        <DenseLane
          label="Data"
          tone="data"
          services={lanes.data}
          projectId={projectId}
          agentActivity={agentActivity}
          activeNodeId={activeNodeId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

interface DenseLaneProps {
  label: string;
  tone: Lane;
  services: ServiceNode[];
  projectId: string;
  agentActivity: ActivityEvent[];
  activeNodeId?: string;
  onSelect?: (projectId: string, serviceId: string) => void;
}

function DenseLane({
  label,
  tone,
  services,
  projectId,
  agentActivity,
  activeNodeId,
  onSelect,
}: DenseLaneProps) {
  if (services.length === 0) return null;
  return (
    <div className={`topology-lane lane-${tone}`}>
      <span className="lane-label">{label}</span>
      <div className="lane-row">
        {services.map((s) => (
          <TopologyNode
            key={s.id}
            service={s}
            projectId={projectId}
            active={s.id === activeNodeId}
            recentAgent={recentAgentFor(projectId, s.id, agentActivity)}
            onSelect={onSelect}
            dense
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TopologyNode

interface TopologyNodeProps {
  service: ServiceNode;
  projectId: string;
  active: boolean;
  recentAgent: ActivityEvent | null;
  onSelect?: (projectId: string, serviceId: string) => void;
  dense?: boolean;
}

function TopologyNode({
  service,
  projectId,
  active,
  recentAgent,
  onSelect,
  dense = false,
}: TopologyNodeProps) {
  const [hovered, setHovered] = useState(false);
  const pulse = HEALTH_PULSE[service.health];
  const label = HEALTH_LABEL[service.health];

  return (
    <div
      className={`topology-node h-${service.health}${active ? ' active' : ''}${dense ? ' dense' : ''}`}
      data-node-id={service.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <button
        type="button"
        className="topology-node-button"
        onClick={() => onSelect?.(projectId, service.id)}
        aria-label={`${service.name} · ${label}`}
      >
        <span className={`topology-node-disk h-${service.health}${pulse ? ' pulse' : ''}`}>
          {recentAgent && (
            <span
              className="topology-node-agent"
              title={`Agent: ${recentAgent.title}`}
              aria-label={`Recent agent activity: ${recentAgent.title}`}
            >
              <Bot className="h-2 w-2" />
            </span>
          )}
        </span>
        <span className="topology-node-label">{service.name}</span>
        {!dense && service.health !== 'healthy' && service.health !== 'running' && (
          <span className={`topology-node-status h-${service.health}`}>{label}</span>
        )}
      </button>
      {hovered && <NodePopover service={service} recentAgent={recentAgent} />}
    </div>
  );
}

function NodePopover({
  service,
  recentAgent,
}: {
  service: ServiceNode;
  recentAgent: ActivityEvent | null;
}) {
  const label = HEALTH_LABEL[service.health];
  return (
    <div className="topology-popover" role="tooltip">
      <div className="popover-head">
        <span className={`popover-pip h-${service.health}`} />
        <span className="popover-name">{service.name}</span>
        <span className="popover-kind topology-muted">· {service.kind.toLowerCase()}</span>
      </div>
      <div className="popover-row">
        <span className="topology-muted">status</span>
        <b>{label}</b>
      </div>
      {service.image && (
        <div className="popover-row">
          <span className="topology-muted">image</span>
          <span className="topology-mono popover-image">{service.image}</span>
        </div>
      )}
      {service.cpu !== '—' && (
        <div className="popover-row">
          <span className="topology-muted">cpu · mem</span>
          <span className="popover-tabular">
            {service.cpu} · {service.mem}
          </span>
        </div>
      )}
      {recentAgent && (
        <div className="popover-agent">
          <Bot className="h-3 w-3" />
          <span>{recentAgent.title.replace(/`/g, '')}</span>
          <span className="topology-muted popover-agent-time">{recentAgent.at}</span>
        </div>
      )}
      <div className="popover-cta topology-muted">Click to open service →</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// HealthSummary

function HealthSummary({ counts }: { counts: Record<ServiceHealth, number> }) {
  const order: ServiceHealth[] = ['crashed', 'restarting', 'degraded', 'running', 'healthy'];
  const items = order.map((k) => ({ k, n: counts[k] || 0 })).filter((x) => x.n > 0);
  if (items.length === 1 && items[0].k === 'healthy') {
    return (
      <span className="health-summary all-good">
        <span className="health-pip healthy" /> all healthy
      </span>
    );
  }
  return (
    <span className="health-summary">
      {items.map(({ k, n }) => (
        <span key={k} className={`health-summary-item h-${k}`}>
          <span className={`health-pip ${k}`} /> {n} {HEALTH_LABEL[k]}
        </span>
      ))}
    </span>
  );
}

function DemoChip() {
  return (
    <span
      className="topology-demo-chip"
      title="Backend topology endpoint unavailable — sample data"
    >
      Sample
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers

interface EdgePath {
  id: string;
  d: string;
  sev: EdgeSeverity;
}

type EdgeSeverity = 'ok' | 'alert';

interface NormalizedInfraProps {
  services: ServiceNode[];
  projectId: string;
  agentActivity: ActivityEvent[];
  activeNodeId?: string;
  onSelect?: (projectId: string, serviceId: string) => void;
  isDemo?: boolean;
}

function asNormalizedProps(props: InfraMapProps): NormalizedInfraProps {
  return {
    services: props.services,
    projectId: props.projectId,
    agentActivity: props.agentActivity,
    activeNodeId: props.activeNodeId,
    onSelect: props.onSelectService,
    isDemo: props.isDemo,
  };
}

function orderForFlow(services: ServiceNode[]): ServiceNode[] {
  // Topological-ish sort: lane bucket first (entry/app/data), then within
  // each lane place more depended-on services to the right so edges read
  // left-to-right.
  const incoming: Record<string, number> = {};
  for (const s of services) incoming[s.id] = 0;
  for (const s of services) {
    for (const d of s.dependsOn) {
      incoming[d] = (incoming[d] ?? 0) + 1;
    }
  }
  const byLane: Record<Lane, ServiceNode[]> = { entry: [], app: [], data: [] };
  for (const s of services) byLane[laneFor(s)].push(s);
  for (const k of Object.keys(byLane) as Lane[]) {
    byLane[k].sort((a, b) => (incoming[a.id] ?? 0) - (incoming[b.id] ?? 0));
  }
  return [...byLane.entry, ...byLane.app, ...byLane.data];
}

function countByHealth(services: ServiceNode[]): Record<ServiceHealth, number> {
  const out: Record<ServiceHealth, number> = {
    healthy: 0,
    running: 0,
    crashed: 0,
    degraded: 0,
    restarting: 0,
    starting: 0,
    stopped: 0,
    recovering: 0,
    unknown: 0,
  };
  for (const s of services) out[s.health] = (out[s.health] ?? 0) + 1;
  return out;
}
