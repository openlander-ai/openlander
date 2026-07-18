/**
 * Project topology — service nodes, dependencies, agent-activity lookup.
 *
 * Scope discipline (PR2):
 *   v1.0 health is `healthy | crashed` only. The prototype's `degraded /
 *   restarting / starting / stopped` are v1.1+ states the backend can't
 *   classify yet. Don't sneak them in via mocks.
 *
 * Edges:
 *   `dependsOn[]` is the source of truth — no synthesis from service
 *   names. The backend will eventually parse compose.yml `depends_on`
 *   and env-var references to populate it.
 *
 * Agent overlay:
 *   `recentAgentFor()` looks up the most recent mcp-actor event for a
 *   given (project, service) within `lookbackSec`. Used by InfraMap to
 *   render the Bot badge on nodes the agent recently acted on.
 *
 * 1.0-rc.2 (data-model fullsplit) note: `ServiceNode.kind` here is the
 * UI-display category (`Application | Compose | Database | Cache | Storage`); the canonical schema
 * `kind` discriminator (`git | image | compose | postgres | …`) lives on
 * `GroupService` from `lib/api/services.ts`. The two are intentionally
 * decoupled — InfraMap only cares about the visual category, while the
 * canonical kind drives routing/handler dispatch.
 */
import type { ActivityEvent } from './agentActivity';
import type { GitCredentialSummary } from './api/git-credentials';

export type ServiceHealth = 'healthy' | 'crashed' | 'deploying';

export type ServiceKind = 'Application' | 'Compose' | 'Database' | 'Cache' | 'Storage';

export interface ServiceNode {
  id: string;
  name: string;
  kind: ServiceKind;
  /** External port if this service is reachable from outside; null for purely-internal services */
  port: number | null;
  image: string;
  health: ServiceHealth;
  /** Display value, e.g. "2.1%" or "—" when unavailable */
  cpu: string;
  /** Display value, e.g. "184 MB" or "—" when unavailable */
  mem: string;
  /** Public URL or null */
  url: string | null;
  /** Non-null when this Application/Compose workload is archived */
  archivedAt?: string | null;
  /** Service IDs within the same project this service depends on (e.g. ['postgres', 'redis']) */
  dependsOn: string[];
  /** Canonical deploy source. Source metadata belongs to services, not projects. */
  source?: 'git' | 'image' | string | null;
  repoUrl?: string | null;
  branch?: string | null;
  deployedBranch?: string | null;
  dockerfilePath?: string | null;
  dockerTarget?: string | null;
  buildContext?: string | null;
  buildMethod?: string | null;
  imageUrl?: string | null;
  imageCmd?: string[] | null;
  containerPort?: number | null;
  gitCredential?: GitCredentialSummary | null;
  runtimeRole?: 'application' | 'job' | 'resource';
  lifecycle?: 'long_running' | 'one_shot';
  healthStrategy?: 'http' | 'tcp' | 'docker_health' | 'exit_code' | 'none';
  isTrafficTarget?: boolean;
  aggregateStatus?: 'running' | 'degraded' | 'error';
  lastDeploy?: { status: 'success' | 'failed' | 'cancelled'; createdAt: string };
}

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Display initials for the project glyph */
  initials: string;
  /** Display tone (oklch) for the project glyph background */
  color: string;
  /** Display value of last deploy time, e.g. "8m ago" */
  lastDeploy: string;
  createdAt: string;
}

export interface ProjectTopology {
  project: ProjectSummary;
  services: ServiceNode[];
}

// ---- Mock data — replace with backend hook when /api/projects/:id/topology lands ----

const MOCK_PROJECT_LIST: ProjectSummary[] = [
  {
    id: 'hotdeal-tracker',
    slug: 'hotdeal-tracker',
    name: 'hotdeal-tracker',
    description: 'Korean hot-deal aggregator · web + api + worker + postgres',
    initials: 'HT',
    color: 'oklch(0.55 0.18 255)',
    lastDeploy: '8m ago',
    createdAt: 'Apr 21',
  },
  {
    id: 'blog-mdx',
    slug: 'blog-mdx',
    name: 'blog-mdx',
    description: 'Personal blog · Next.js + MDX',
    initials: 'BM',
    color: 'oklch(0.62 0.16 145)',
    lastDeploy: '2d ago',
    createdAt: 'Mar 04',
  },
  {
    id: 'links-shortener',
    slug: 'links-shortener',
    name: 'links-shortener',
    description: 'URL shortener · Hono + KV',
    initials: 'LS',
    color: 'oklch(0.62 0.16 30)',
    lastDeploy: '5h ago',
    createdAt: 'Feb 14',
  },
  {
    id: 'scratch-canvas',
    slug: 'scratch-canvas',
    name: 'scratch-canvas',
    description: 'Collaborative whiteboard prototype',
    initials: 'SC',
    color: 'oklch(0.6 0.16 320)',
    lastDeploy: '12m ago',
    createdAt: 'Jan 30',
  },
];

const MOCK_SERVICES_BY_PROJECT: Record<string, ServiceNode[]> = {
  'hotdeal-tracker': [
    {
      id: 'web',
      name: 'web',
      kind: 'Application',
      port: 3000,
      image: 'hotdeal-web:7af3c12',
      health: 'healthy',
      cpu: '2.1%',
      mem: '184 MB',
      url: 'https://web.hotdeal-tracker.157-90-12-44.sslip.io',
      dependsOn: ['api'],
    },
    {
      id: 'api',
      name: 'api',
      kind: 'Application',
      port: 8000,
      image: 'hotdeal-api:7af3c12',
      health: 'healthy',
      cpu: '1.4%',
      mem: '212 MB',
      url: 'https://api.hotdeal-tracker.157-90-12-44.sslip.io',
      dependsOn: ['postgres', 'redis'],
    },
    {
      id: 'worker',
      name: 'worker',
      kind: 'Application',
      port: null,
      image: 'hotdeal-worker:7af3c12',
      health: 'healthy',
      cpu: '0.6%',
      mem: '98 MB',
      url: null,
      dependsOn: ['postgres', 'redis'],
    },
    {
      id: 'postgres',
      name: 'postgres',
      kind: 'Database',
      port: 5432,
      image: 'pgvector/pgvector:pg16',
      health: 'healthy',
      cpu: '0.4%',
      mem: '168 MB',
      url: null,
      dependsOn: [],
    },
    {
      id: 'redis',
      name: 'redis',
      kind: 'Database',
      port: 6379,
      image: 'redis:7-alpine',
      health: 'healthy',
      cpu: '0.1%',
      mem: '24 MB',
      url: null,
      dependsOn: [],
    },
  ],
  'blog-mdx': [
    {
      id: 'web',
      name: 'web',
      kind: 'Application',
      port: 3000,
      image: 'blog-mdx:c41f0aa',
      health: 'healthy',
      cpu: '0.3%',
      mem: '62 MB',
      url: 'https://blog-mdx.157-90-12-44.sslip.io',
      dependsOn: [],
    },
  ],
  'links-shortener': [
    {
      id: 'web',
      name: 'web',
      kind: 'Application',
      port: 8787,
      image: 'links-shortener:b22fd9',
      health: 'healthy',
      cpu: '0.4%',
      mem: '44 MB',
      url: 'https://links.157-90-12-44.sslip.io',
      dependsOn: ['kv'],
    },
    {
      id: 'kv',
      name: 'kv',
      kind: 'Database',
      port: 7000,
      image: 'redis:7-alpine',
      health: 'healthy',
      cpu: '0.1%',
      mem: '18 MB',
      url: null,
      dependsOn: [],
    },
  ],
  'scratch-canvas': [
    {
      id: 'web',
      name: 'web',
      kind: 'Application',
      port: 5173,
      image: 'scratch-web:dirty',
      health: 'crashed',
      cpu: '—',
      mem: '—',
      url: 'https://scratch.157-90-12-44.sslip.io',
      dependsOn: ['api'],
    },
    {
      id: 'api',
      name: 'api',
      kind: 'Application',
      port: 9000,
      image: 'scratch-api:dirty',
      health: 'healthy',
      cpu: '0.6%',
      mem: '104 MB',
      url: null,
      dependsOn: ['postgres'],
    },
    {
      id: 'postgres',
      name: 'postgres',
      kind: 'Database',
      port: 5432,
      image: 'postgres:16-alpine',
      health: 'healthy',
      cpu: '0.2%',
      mem: '82 MB',
      url: null,
      dependsOn: [],
    },
  ],
};

// PR6 cleanup: MOCK_FLEET_SERVICES (12-service synthetic dense-layout
// demo) was removed — useProjectTopology now drives InfraMap, and the
// real /api/projects/:id/topology endpoint will furnish dense projects
// once they exist. Keeping mock fixtures lean (Gemini CCG review:
// "broken window — purge dense demo data to keep the bundle lean").

export function listProjects(): ProjectSummary[] {
  return MOCK_PROJECT_LIST;
}

export function getProject(id: string): ProjectSummary | null {
  return MOCK_PROJECT_LIST.find((p) => p.id === id) ?? null;
}

export function getServices(projectId: string): ServiceNode[] {
  return MOCK_SERVICES_BY_PROJECT[projectId] ?? [];
}

/**
 * Find the most-recent mcp-actor event for a (project, service) within
 * `lookbackSec`. Used by InfraMap M2 to render the Bot badge.
 *
 * The activity stream is passed in (not imported) so the InfraMap can
 * use either the global mock or — once the backend lands — a live
 * subscription.
 */
export function recentAgentFor(
  projectId: string | null | undefined,
  serviceId: string | null | undefined,
  events: ActivityEvent[],
  lookbackSec: number = 1800,
): ActivityEvent | null {
  if (!projectId || !serviceId) return null;
  for (const e of events) {
    if (e.actor !== 'mcp') continue;
    if (e.project !== projectId || e.service !== serviceId) continue;
    if (e.relTs > lookbackSec) continue;
    return e;
  }
  return null;
}

/**
 * Lane assignment for InfraMap dense layout (M4). Three lanes — entry
 * tier, application tier, data tier. Heuristic-based: edge/caddy/nginx
 * → entry; databases → data; everything else → app.
 */
export type Lane = 'entry' | 'app' | 'data';

export function laneFor(svc: ServiceNode): Lane {
  if (svc.id === 'edge' || /caddy|nginx|gateway|edge/i.test(svc.id)) return 'entry';
  if (svc.kind === 'Database' || svc.kind === 'Cache' || svc.kind === 'Storage') return 'data';
  return 'app';
}
