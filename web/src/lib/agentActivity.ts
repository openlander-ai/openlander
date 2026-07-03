/**
 * Activity event stream — types + 1.0-honest mock data.
 *
 * Scope discipline:
 * The prototype's Round 3 seed had agent-reasoning paragraphs, auto-restart
 * detection, OOM classification, and pending-decisions. None of those have
 * backend support today. Per the trim direction, this 1.0 mock includes only
 * events the backend can actually emit:
 *
 *   - deploy_started / deploy_completed / deploy_failed / deploy_cancelled
 *   - config_changed (human edits env vars / image tag / etc.)
 *   - service_crashed (raw — no auto-classification)
 *   - service_recovered
 *   - mcp_connected / mcp_disconnected
 *
 * Reasoning text is at most a single inline line (the `detail` field).
 * No collapsible expansion. No multi-paragraph LLM justification.
 *
 * When the backend lands, replace the SEEDED export with a real fetch hook
 * (e.g. useActivityStream) — the type is the contract.
 */

export type Actor = 'mcp' | 'human' | 'webhook' | 'system';

export type ActivityKind =
  | 'deploy_started'
  | 'deploy_completed'
  | 'deploy_failed'
  | 'deploy_cancelled'
  | 'config_changed'
  | 'data_access_read'
  | 'service_crashed'
  | 'service_recovered'
  | 'mcp_connected'
  | 'mcp_disconnected';

export interface ActivityEvent {
  id: string;
  actor: Actor;
  kind: ActivityKind;
  /** Human-readable absolute time hint, e.g. "Just now", "12m ago", "1h ago" */
  at: string;
  /** Seconds since now — used for time-bucketing into Just now / Earlier today / Yesterday */
  relTs: number;
  /** Project ID, or null for system-level events (e.g. mcp_connected) */
  project: string | null;
  /** Service ID within the project, or null for project-level events */
  service: string | null;
  /** Optional display name for the project — emitted by the backend when known. */
  projectName?: string | null;
  /** Optional display name for the service — emitted by the backend when known. */
  serviceName?: string | null;
  /** One-sentence headline */
  title: string;
  /** One-line detail / context. NOT a paragraph. Contains build #, error class, etc. */
  detail?: string;
}

/** Kind filter groups. Drives the compact tab strip at the top of the
 *  Activity page. `system` covers crash/recovery (the canonical "things
 *  the platform noticed on its own"); `crashes` is kept as a legacy URL
 *  alias so existing bookmarks like `/activity?type=crash` still route. */
export type KindGroup = 'all' | 'deploys' | 'mcp' | 'system' | 'config' | 'data';
export type ActivityTypeParam = 'all' | 'deploy' | 'config' | 'data' | 'system' | 'mcp';

const KIND_GROUP_MAP: Record<Exclude<KindGroup, 'all'>, ActivityKind[]> = {
  deploys: ['deploy_started', 'deploy_completed', 'deploy_failed', 'deploy_cancelled'],
  system: ['service_crashed', 'service_recovered'],
  mcp: ['mcp_connected', 'mcp_disconnected'],
  config: ['config_changed'],
  data: ['data_access_read'],
};

export function isKindInGroup(kind: ActivityKind, group: KindGroup): boolean {
  if (group === 'all') return true;
  return KIND_GROUP_MAP[group].includes(kind);
}

export function kindGroupFromTypeParam(value: string | null | undefined): KindGroup {
  switch (value) {
    case 'deploy':
      return 'deploys';
    case 'config':
      return 'config';
    case 'data':
      return 'data';
    // Legacy URL alias — `?type=crash` was the v0.1 spelling before the
    // tab strip renamed the group to "System".
    case 'crash':
    case 'system':
      return 'system';
    case 'mcp':
      return 'mcp';
    case 'all':
    default:
      return 'all';
  }
}

export function typeParamFromKindGroup(kind: KindGroup): ActivityTypeParam {
  switch (kind) {
    case 'deploys':
      return 'deploy';
    case 'config':
      return 'config';
    case 'data':
      return 'data';
    case 'system':
      return 'system';
    case 'mcp':
      return 'mcp';
    case 'all':
    default:
      return 'all';
  }
}

/** Visual severity bucket for an event — drives the row's left status
 *  icon + accent color. Successes stay neutral; failures and crashes are
 *  the only categories that get a louder treatment. */
export type ActivitySeverity = 'success' | 'failure' | 'warning' | 'info' | 'neutral';

export function severityForKind(kind: ActivityKind): ActivitySeverity {
  switch (kind) {
    case 'deploy_completed':
    case 'service_recovered':
      return 'success';
    case 'deploy_failed':
    case 'service_crashed':
      return 'failure';
    case 'deploy_cancelled':
      return 'warning';
    case 'deploy_started':
    case 'data_access_read':
    case 'mcp_connected':
      return 'info';
    case 'mcp_disconnected':
    case 'config_changed':
    default:
      return 'neutral';
  }
}

export interface ActivityFilters {
  actor: Actor | 'all';
  project: string | 'all';
  /** Subset of ActivityKind grouped into user-facing buckets. Defaults to 'all'. */
  kind?: KindGroup;
}

/**
 * Mock event stream — illustrative content for development.
 * Replace with backend-wired hook in PR2/PR3.
 */
export const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: 'a1',
    actor: 'mcp',
    kind: 'deploy_started',
    at: 'Just now',
    relTs: 0,
    project: 'hotdeal-tracker',
    service: 'web',
    title: 'Deploy started · `web` from main@7af3c12',
    detail: 'Triggered by MCP agent (Claude / Jiho’s laptop)',
  },
  {
    id: 'a2',
    actor: 'human',
    kind: 'config_changed',
    at: '12m ago',
    relTs: 720,
    project: 'hotdeal-tracker',
    service: 'api',
    title: 'Updated env var `RATE_LIMIT_RPM`',
    detail: '120 → 240 · restart pending',
  },
  {
    id: 'a3',
    actor: 'system',
    kind: 'service_crashed',
    at: '18m ago',
    relTs: 1080,
    project: 'scratch-canvas',
    service: 'web',
    title: '`scratch-canvas/web` crashed',
    detail: 'Container exit code 137',
  },
  {
    id: 'a4',
    actor: 'webhook',
    kind: 'deploy_failed',
    at: '22m ago',
    relTs: 1320,
    project: 'hotdeal-tracker',
    service: 'api',
    title: 'Deploy failed · `api` from main@9d0a44e',
    detail: 'Build #6 · BUILD_CONTEXT_MISMATCH · 1m 40s',
  },
  {
    id: 'a5',
    actor: 'human',
    kind: 'deploy_completed',
    at: '1h ago',
    relTs: 3600,
    project: 'hotdeal-tracker',
    service: 'postgres',
    title: 'Deployed `postgres` manually',
    detail: 'Image bumped to pgvector/pgvector:pg16',
  },
  {
    id: 'a6',
    actor: 'webhook',
    kind: 'deploy_failed',
    at: '3h ago',
    relTs: 10800,
    project: 'hotdeal-tracker',
    service: 'api',
    title: 'Deploy failed · `api` from feat/multistage@210ccf1',
    detail: 'Build #4 · IMAGE_WRONG_STAGE · 2m 51s',
  },
  {
    id: 'a7',
    actor: 'mcp',
    kind: 'deploy_completed',
    at: '5h ago',
    relTs: 18000,
    project: 'hotdeal-tracker',
    service: 'api',
    title: 'Deploy succeeded · `api` from main@f018a2c',
    detail: 'Build #3 · 2m 48s · triggered by MCP agent',
  },
  {
    id: 'a8',
    actor: 'system',
    kind: 'mcp_connected',
    at: '12h ago',
    relTs: 43200,
    project: null,
    service: null,
    title: 'MCP agent connected · Claude (Jiho’s laptop)',
    detail: 'Endpoint reachable; 14 tools exposed',
  },
];

/**
 * Mock cross-project rollup for the system status bar at the top of Home.
 * Real implementation will compute from project + service health endpoints.
 */
export interface SystemStatusSnapshot {
  totalProjects: number;
  totalServices: number;
  healthyServices: number;
  crashedServices: number;
  /** Display-friendly absolute time, e.g. "12s ago" */
  observedAt: string;
}

export const MOCK_SYSTEM_STATUS: SystemStatusSnapshot = {
  totalProjects: 4,
  totalServices: 10,
  healthyServices: 9,
  crashedServices: 1,
  observedAt: 'just now',
};

/**
 * Mock MCP server info for /mcp page.
 * Real implementation will fetch from backend `/api/mcp/status`.
 */
export interface McpAgentSession {
  id: string;
  name: string;
  connectedAt: string;
  lastCallAt: string;
  callsToday: number;
}

export interface McpServerInfo {
  status: 'connected' | 'reconnecting' | 'disconnected';
  endpoint: string;
  agentsConnected: number;
  agents: McpAgentSession[];
  toolsExposed: number;
  callsToday: number;
  lastCallAt: string;
}

export const MOCK_MCP_INFO: McpServerInfo = {
  status: 'connected',
  endpoint: 'openlander.157-90-12-44.sslip.io/mcp',
  agentsConnected: 2,
  agents: [
    {
      id: 'claude-1',
      name: 'Claude (Jiho’s laptop)',
      connectedAt: '12m ago',
      lastCallAt: 'Just now',
      callsToday: 47,
    },
    {
      id: 'claude-2',
      name: 'Claude Code (CI)',
      connectedAt: '1h ago',
      lastCallAt: '8m ago',
      callsToday: 12,
    },
  ],
  toolsExposed: 14,
  callsToday: 59,
  lastCallAt: '12s ago',
};

/**
 * Project list for the project filter pill in Activity page.
 * Pulls from the same source as the system status — replace with backend.
 */
export interface ProjectSummary {
  id: string;
  name: string;
}

export const MOCK_PROJECTS: ProjectSummary[] = [
  { id: 'hotdeal-tracker', name: 'hotdeal-tracker' },
  { id: 'blog-mdx', name: 'blog-mdx' },
  { id: 'links-shortener', name: 'links-shortener' },
  { id: 'scratch-canvas', name: 'scratch-canvas' },
];

/** Group events into Just now / Earlier today / Yesterday buckets. */
export function bucketByTime(events: ActivityEvent[]): Array<[string, ActivityEvent[]]> {
  const buckets: Record<string, ActivityEvent[]> = {
    'Just now': [],
    'Earlier today': [],
    Yesterday: [],
  };
  for (const e of events) {
    const k = e.relTs < 600 ? 'Just now' : e.relTs < 86400 ? 'Earlier today' : 'Yesterday';
    buckets[k].push(e);
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
}

/** Apply Actor + Project + Kind filters. */
export function filterEvents(events: ActivityEvent[], filters: ActivityFilters): ActivityEvent[] {
  const kindGroup = filters.kind ?? 'all';
  return events.filter((e) => {
    if (filters.actor !== 'all' && e.actor !== filters.actor) return false;
    if (filters.project !== 'all' && e.project !== filters.project) return false;
    if (kindGroup !== 'all' && !isKindInGroup(e.kind, kindGroup)) return false;
    return true;
  });
}
