/**
 * ServiceDetailV2 — Round 4 PR3.
 *
 * Seven tabs (per GUIDE-01 §4.2):
 *   General · Environment · Domains · Deployments · Logs · Monitoring · Advanced
 *
 * Logs tab mounts <LogViewer variant="runtime" /> — runtime container
 * logs, no phase rail, no terminal cards. Deployments tab opens a
 * deploy in-place via the deploy variant of <LogViewer />.
 *
 * Tab switching uses ProjectTabs which gives us WAI-ARIA arrow-key
 * tablist for free.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  Box,
  Code2,
  Copy,
  Cpu,
  Database,
  Edit,
  ExternalLink,
  Globe,
  Plus,
  Rocket,
  Settings as SettingsIcon,
  ScrollText,
} from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { LogViewer } from '@/components/Shell/LogViewer';
import { Sparkline } from '@/components/Shell/Sparkline';
import { DeployRow } from '@/components/Shell/DeployRow';
import { type ServiceHealth, type ServiceNode } from '@/lib/projectTopology';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { LOG_SCRIPT_BASE } from '@/lib/logScripts';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { useServiceHealth } from '@/hooks/use-service-health';
import { useServiceMetrics } from '@/hooks/use-service-metrics';
import { useDeployments } from '@/hooks/use-deployments';
import { getService, type MetricsRange, type Service } from '@/lib/api/services';
import type { DeployLogSummary } from '@/types';
import { cn } from '@/lib/utils';

type ServiceTabId =
  | 'general'
  | 'environment'
  | 'domains'
  | 'deployments'
  | 'logs'
  | 'monitoring'
  | 'advanced';

/**
 * Top-level dispatcher. Same route slot serves two different ID spaces:
 *   /services/:id (deployable; :id is a projects.id) vs
 *   /managed-services/:id (managed services row; :id is a services.id).
 *
 * Each child component has its own hook order — keeping the dispatch
 * here lets us avoid violating rules-of-hooks while still reusing the
 * same `<RouteSuspense>` mount in App.tsx. Fixes the pre-existing
 * routing collision where a managed-service click landed on the
 * deployable detail and rendered "Service not found" because no
 * ?project= was attached. Tracked in ralplan-data-model-alignment §6.
 */
export function ServiceDetailV2() {
  // 1.0-rc.1: two URL shapes are supported simultaneously.
  //
  // Canonical (rc.1+):  /projects/:p/services/:s  → params { p, s }
  // Legacy   (rc.0):    /services/:id?project=:p  → params { id }
  // Managed  (rc.0+):   /managed-services/:id     → params { id }
  //
  // The `id` field covers both legacy shapes; `s` covers canonical.
  // rc.2 will deprecate the legacy deployable URL once all internal
  // callers emit `/projects/:p/services/:s`.
  const { id, s } = useParams<{ id?: string; p?: string; s?: string }>();
  const location = useLocation();

  // Managed-service path takes priority — check by prefix before
  // inspecting params so that a future managed-service canonical URL
  // (/projects/:p/services/:s with kind=database) can be gated separately.
  if (location.pathname.startsWith('/managed-services/') && id) {
    // `key={id}` forces remount on managed-service navigation. Without
    // it, React reuses the instance and ManagedServiceDetail's stale
    // state (previous service object) would render for one commit
    // before the id-change useEffect fires its setState — flagged by
    // Codex CCG on PR #77.
    return <ManagedServiceDetail key={id} id={id} />;
  }

  // Canonical path: /projects/:p/services/:s
  // `s` is the service id; the project id is available as a route param
  // (not query string). DeployableServiceDetail reads project via
  // useSearchParams('project') — pass `s` as a synthetic `id` by using
  // the key prop to force remount on navigation, matching legacy behaviour.
  if (s) {
    return <DeployableServiceDetail key={s} canonicalServiceId={s} />;
  }

  return <DeployableServiceDetail />;
}

function DeployableServiceDetail({ canonicalServiceId }: { canonicalServiceId?: string }) {
  // `canonicalServiceId` is set when mounted via the canonical route
  // `/projects/:p/services/:s` — the dispatcher passes params.s here.
  // Legacy route `/services/:id` keeps using useParams() directly.
  const params = useParams<{ id?: string; p?: string }>();
  const id = canonicalServiceId ?? params.id;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ServiceTabId>('general');
  const [openDeployId, setOpenDeployId] = useState<string | null>(null);

  // Derive project id: canonical route exposes it as the `:p` param;
  // legacy `/services/:id?project=:p` passes it as a query string.
  // `params.p` is only populated when mounted via `/projects/:p/services/:s`.
  const projectId = params.p ?? searchParams.get('project');
  // Real projects come from the AppShell-mounted ProjectsProvider; the
  // earlier mock-based `getProject()` returned null for any real (non-mock)
  // project ID, which made every service click resolve to "Service not
  // found". Codex/Gemini-trio CCG would have caught this if the page had
  // smoke coverage post-Phase-2.
  const { projects: allProjects } = useProjectsContext();
  const project = projectId ? (allProjects.find((p) => p.id === projectId) ?? null) : null;
  // Sibling services come from the topology hook (real when available,
  // mock fallback before the backend session lands). Per CCG review:
  // we DON'T also call useServiceHealth per-node — the topology poll
  // already carries health, and the live health hook below is scoped to
  // the header pill of THIS service only.
  const { services } = useProjectTopology(projectId);
  const service = services.find((s) => s.id === id);

  // Live health for the header pill. Falls through to topology.health
  // until the dedicated endpoint returns. CCG: separate from InfraMap to
  // avoid N requests for N nodes.
  // PR7-G: simplified `service ? (id ?? null) : null` — when `id` is
  // missing the route guard already redirects, and the hook itself
  // no-ops on null. The previous form was a paradox (it returned the
  // same value `service` was derived from).
  const liveHealth = useServiceHealth(id ?? null);
  const effectiveHealth: ServiceHealth | undefined = liveHealth.health ?? service?.health;

  // Real deployments: fetch all project deploys (no per-service filter API yet —
  // show all project deploys, which is an honest view of what touched this project).
  // DeployLogSummary only persists terminal states (success/failed/cancelled), so
  // we can't detect a deploy in flight from this shape. Deploy button stays enabled
  // until a running-deploy signal lands on the wire (follow-up).
  const { deployments, loading: deploymentsLoading } = useDeployments(projectId ?? '');
  const hasRunning = false;

  const tabs = useMemo<TabDef<ServiceTabId>[]>(
    () => [
      { id: 'general', label: 'General', icon: SettingsIcon },
      { id: 'environment', label: 'Environment', icon: Code2 },
      { id: 'domains', label: 'Domains', icon: Globe },
      {
        id: 'deployments',
        label: 'Deployments',
        icon: Rocket,
        count: deployments.length || undefined,
      },
      { id: 'logs', label: 'Logs', icon: ScrollText },
      { id: 'monitoring', label: 'Monitoring', icon: ActivityIcon },
      { id: 'advanced', label: 'Advanced', icon: Cpu },
    ],
    [deployments.length],
  );

  if (!service || !project) {
    const reason = !projectId
      ? `Open this service from a project page so we know which project owns it. Direct links to /services/${id} need a ?project= query parameter.`
      : `No service "${id}" in project "${projectId}".`;
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard title="Service not found" subtitle={reason}>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            ← Back to Home
          </button>
        </OuterCard>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]"
            >
              <Box className="h-3.5 w-3.5" />
            </span>
            <span>{service.name}</span>
            {effectiveHealth && <HealthBadge health={effectiveHealth} />}
            {liveHealth.error && (
              // Health endpoint is degraded — surface gracefully so the
              // user knows the displayed pill is the LAST KNOWN state
              // (from topology), not a fresh reading. PR7 follow-up.
              <span
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-[color:var(--ol-warning)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-[color:var(--ol-warning)]"
                title={`Live health stream offline — showing last topology snapshot. ${liveHealth.error}`}
              >
                stale
              </span>
            )}
          </span>
        }
        subtitle={
          <span className="ol-mono text-[12px]">
            {service.kind} · {service.image}
          </span>
        }
        actions={
          <>
            {service.url && (
              <a
                href={service.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
              >
                <ExternalLink className="h-3 w-3" />
                Open
              </a>
            )}
            <button
              type="button"
              disabled={hasRunning}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-3 py-1 text-[12px] font-medium transition-opacity',
                hasRunning
                  ? 'cursor-not-allowed bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-subtle)]'
                  : 'bg-[color:var(--ol-primary)] text-[color:var(--ol-primary-fg)] hover:opacity-90',
              )}
              aria-disabled={hasRunning}
            >
              <Rocket className="h-3.5 w-3.5" />
              {hasRunning ? 'Deploying…' : 'Deploy'}
            </button>
          </>
        }
        bodyClassName="p-0"
      >
        <ProjectTabs
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
          idPrefix="service"
          ariaLabel="Service sections"
        />

        <TabPanel
          active={activeTab === 'general'}
          panelId="servicepanel-general"
          labelledBy="service-general"
          className="p-5"
        >
          <GeneralTab service={service} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'environment'}
          panelId="servicepanel-environment"
          labelledBy="service-environment"
          className="p-5"
        >
          <EnvironmentTab />
        </TabPanel>

        <TabPanel
          active={activeTab === 'domains'}
          panelId="servicepanel-domains"
          labelledBy="service-domains"
          className="p-5"
        >
          <DomainsTab service={service} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'deployments'}
          panelId="servicepanel-deployments"
          labelledBy="service-deployments"
          className="p-0"
        >
          <DeploymentsTab
            deployments={deployments}
            loading={deploymentsLoading}
            onOpenDeploy={(d) => setOpenDeployId(d.id)}
          />
        </TabPanel>

        <TabPanel
          active={activeTab === 'logs'}
          panelId="servicepanel-logs"
          labelledBy="service-logs"
          className="p-0"
        >
          <RuntimeLogsTab />
        </TabPanel>

        <TabPanel
          active={activeTab === 'monitoring'}
          panelId="servicepanel-monitoring"
          labelledBy="service-monitoring"
          className="p-5"
        >
          <MonitoringTab service={service} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'advanced'}
          panelId="servicepanel-advanced"
          labelledBy="service-advanced"
          className="p-8"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-subtle)]">
              <Cpu className="h-4 w-4" />
            </span>
            <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
              Network, resources, and entrypoint overrides land here.
            </p>
          </div>
        </TabPanel>
      </OuterCard>

      {openDeployId != null && (
        <div className="fixed inset-0 z-40 flex items-stretch bg-black/60 p-6">
          <div className="relative ml-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-[var(--ol-radius)] border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
            {(() => {
              const dep = deployments.find((d) => d.id === openDeployId);
              return (
                <LogViewer
                  variant="deploy"
                  deploymentId={openDeployId}
                  outcome={dep?.status === 'failed' ? 'fail' : 'success'}
                  errorClass={dep?.failureSummary ?? undefined}
                  serviceName={service.name}
                  publicUrl={service.url}
                  internalPort={service.port}
                  onClose={() => setOpenDeployId(null)}
                  headerTitle={
                    <span className="font-medium text-[color:var(--log-header-text)]">
                      {project.name} / {service.name} · Deploy {openDeployId.slice(0, 8)}
                    </span>
                  }
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab content ────────────────────────────────────────────────────────────

function GeneralTab({ service }: { service: ServiceNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SubCard title="Source" actionLabel="Edit" onAction={() => {}}>
          <KvList
            rows={[
              ['Provider', 'GitHub'],
              ['Repository', 'jiho/hotdeal-tracker'],
              ['Branch', 'main'],
              ['Build path', './'],
            ]}
          />
        </SubCard>
        <SubCard title="Build" actionLabel="Edit" onAction={() => {}}>
          <KvList
            rows={[
              ['Method', 'Dockerfile'],
              ['Dockerfile', `Dockerfile.${service.id}`],
              [
                'Target stage',
                service.id === 'api' ? 'api' : service.id === 'worker' ? 'worker' : '—',
              ],
              ['Cache', 'BuildKit'],
            ]}
          />
        </SubCard>
      </div>
      <SubCard title="Runtime" badge={<HealthBadge health={service.health} />}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="CPU" value={service.cpu} sub="last 60s" />
          <Metric label="Memory" value={service.mem} sub="512 MB limit" />
        </div>
        {service.url && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-medium text-[color:var(--ol-fg-muted)]">
              Public URL
            </div>
            <div className="flex items-center gap-2 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2">
              <Globe className="h-3.5 w-3.5 text-[color:var(--ol-primary)]" />
              <a
                href={service.url}
                target="_blank"
                rel="noreferrer"
                className="ol-mono break-all text-[12px] text-[color:var(--ol-primary)] hover:underline"
              >
                {service.url}
              </a>
              <span className="ml-auto inline-flex items-center gap-1 text-[color:var(--ol-fg-muted)]">
                <Copy className="h-3 w-3" />
                <ExternalLink className="h-3 w-3" />
              </span>
            </div>
          </div>
        )}
      </SubCard>
    </div>
  );
}

function EnvironmentTab() {
  return (
    <SubCard
      title="Environment variables"
      action={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      }
    >
      <KvList
        rows={[
          ['DATABASE_URL', 'postgres://hotdeal:••••••@postgres:5432/hotdeal'],
          ['REDIS_URL', 'redis://redis:6379'],
          ['SCRAPE_INTERVAL', '300'],
          ['NODE_ENV', 'production'],
        ]}
        valueClassName="ol-mono break-all text-[12px]"
      />
    </SubCard>
  );
}

function DomainsTab({ service }: { service: ServiceNode }) {
  return (
    <SubCard
      title="Domains"
      action={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <Plus className="h-3 w-3" />
          Add domain
        </button>
      }
    >
      <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 text-[color:var(--ol-primary)]" />
          <span className="ol-mono break-all text-[12px] text-[color:var(--ol-primary)]">
            {service.url ?? '—'}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-success-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-success)]">
            SSL
          </span>
        </div>
      </div>
      <p className="mt-2.5 text-[12px] text-[color:var(--ol-fg-muted)]">
        Auto-issued via sslip.io. Add a custom domain to override.
      </p>
    </SubCard>
  );
}

function DeploymentsTab({
  deployments,
  loading,
  onOpenDeploy,
}: {
  deployments: DeployLogSummary[];
  loading: boolean;
  onOpenDeploy: (d: DeployLogSummary) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-[color:var(--ol-panel-2)]" />
        ))}
      </div>
    );
  }
  if (deployments.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
        No deploys yet for this project.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-[color:var(--ol-border-subtle)]">
      {deployments.map((d) => (
        <li key={d.id}>
          <DeployRow d={d} onView={() => onOpenDeploy(d)} />
        </li>
      ))}
    </ul>
  );
}

function RuntimeLogsTab() {
  return (
    <div className="h-[calc(100vh-260px)] min-h-[420px]">
      <LogViewer variant="runtime" outcome="success" scriptOverride={LOG_SCRIPT_BASE.slice(-25)} />
    </div>
  );
}

function MonitoringTab({ service }: { service: ServiceNode }) {
  const [range, setRange] = useState<MetricsRange>('1h');
  const ranges: readonly MetricsRange[] = ['15m', '1h', '6h', '24h', '7d'] as const;
  const { metrics } = useServiceMetrics(service.id, range);

  // CCG decision (Codex+Gemini agree): the BIG number for CPU/Memory
  // stays the topology display string (e.g. "2.1%") to avoid NaN/0
  // flicker if a single metrics scrape blips. The sparkline shows the
  // metrics array. p95LatencyMs feeds the requests-card sub line.
  // Requests-per-second and Error rate big numbers come from the latest
  // metrics datapoint when available, with a safe display fallback.
  // Synthetic seed fallbacks were removed in 1.0 (ralplan-monitoring-logs
  // Phase 2 — Principle 1: no synthetic empty-state numbers). When metrics
  // is null (no samples yet, or 204 from /api/services/:id/metrics) the
  // Sparkline renders an empty SVG and the headline value falls back to "—".
  const cpuData = useMemo(() => metrics?.cpu ?? [], [metrics]);
  const memData = useMemo(() => metrics?.memory ?? [], [metrics]);
  const reqData = useMemo(() => metrics?.requestsPerSec ?? [], [metrics]);
  const errData = useMemo(() => metrics?.errorRate ?? [], [metrics]);

  const reqLatest = metrics
    ? Math.round(metrics.requestsPerSec[metrics.requestsPerSec.length - 1] ?? 0)
    : null;
  const errLatest = metrics ? (metrics.errorRate[metrics.errorRate.length - 1] ?? 0) : null;
  const p95Display = metrics ? `${Math.round(metrics.p95LatencyMs)}ms` : '—';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <RangeToggle range={range} setRange={setRange} ranges={ranges} />
        <span className="ml-auto inline-flex items-center gap-2 text-[12px] text-[color:var(--ol-fg-muted)]">
          Container
          <select
            value="primary"
            className="ol-mono rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 py-1 text-[11.5px]"
            onChange={() => {}}
          >
            <option value="primary">{`ol-${service.name} (primary)`}</option>
            <option value="prev">{`ol-${service.name} (replaced)`}</option>
          </select>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricCard
          title="CPU"
          value={service.cpu || '—'}
          sub={`avg over ${range}`}
          data={cpuData}
          color="var(--ol-primary)"
        />
        <MetricCard
          title="Memory"
          value={service.mem || '—'}
          sub="512 MB limit"
          data={memData}
          color="var(--ol-success)"
        />
        <MetricCard
          title="Requests / s"
          value={reqLatest != null ? `${reqLatest} rps` : '—'}
          sub={`p95: ${p95Display} · ${range}`}
          data={reqData}
          color="var(--ol-actor-webhook)"
        />
        <MetricCard
          title="Error rate"
          value={errLatest != null ? `${errLatest.toFixed(2)}%` : '—'}
          sub="HTTP 5xx · last hour"
          data={errData}
          color="var(--ol-error)"
        />
      </div>
    </div>
  );
}

// ─── Reusable subcomponents ────────────────────────────────────────────────

function SubCard({
  title,
  action,
  actionLabel,
  onAction,
  badge,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] p-4">
      <header className="mb-3 flex items-center gap-2">
        <h4 className="text-[12.5px] font-semibold text-[color:var(--ol-fg)]">{title}</h4>
        {badge}
        <span className="ml-auto">
          {action ??
            (actionLabel ? (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
              >
                <Edit className="h-3 w-3" />
                {actionLabel}
              </button>
            ) : null)}
        </span>
      </header>
      {children}
    </section>
  );
}

function KvList({ rows, valueClassName }: { rows: [string, string][]; valueClassName?: string }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[color:var(--ol-fg-muted)]">{k}</dt>
          <dd className={cn('text-[color:var(--ol-fg)]', valueClassName)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
      <div className="text-[11px] text-[color:var(--ol-fg-muted)]">{label}</div>
      <div className="mt-1 text-[16px] font-semibold tabular-nums text-[color:var(--ol-fg)]">
        {value}
      </div>
      {sub && <div className="text-[11px] text-[color:var(--ol-fg-subtle)]">{sub}</div>}
    </div>
  );
}

function HealthBadge({ health }: { health: 'healthy' | 'crashed' }) {
  if (health === 'crashed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-error-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-error)]">
        <span
          aria-hidden
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: 'var(--ol-error)' }}
        />
        crashed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-success-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-success)]">
      <span
        aria-hidden
        className="h-1 w-1 rounded-full"
        style={{ backgroundColor: 'var(--ol-success)' }}
      />
      healthy
    </span>
  );
}

function MetricCard({
  title,
  value,
  sub,
  data,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  data: number[];
  color: string;
}) {
  return (
    <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]">
          {title}
        </span>
        <span className="ol-mono text-[14px] font-semibold tabular-nums text-[color:var(--ol-fg)]">
          {value}
        </span>
      </div>
      <div className="mt-3 h-12">
        <Sparkline data={data} color={color} />
      </div>
      <div className="mt-2 text-[11px] text-[color:var(--ol-fg-muted)]">{sub}</div>
    </div>
  );
}

function RangeToggle<T extends string>({
  ranges,
  range,
  setRange,
}: {
  ranges: readonly T[];
  range: T;
  setRange: (r: T) => void;
}) {
  // Type-safe wrapper around metrics range pill. Generic over the range
  // string union so MetricsRange / future ranges share the same UI.
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-0.5"
    >
      {ranges.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setRange(r)}
            className={cn(
              'rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors',
              active
                ? 'bg-[color:var(--ol-primary)] text-[color:var(--ol-primary-fg)]'
                : 'text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
            )}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ManagedServiceDetail — minimal detail surface for managed services
 * (postgres / mysql / redis / mongo etc).
 *
 * Mounted at `/managed-services/:id` via the route-prefix gate at the
 * top of `ServiceDetailV2`. Intentionally simple for 1.0 — image / port /
 * container ID + a back link. The richer experience (Connection /
 * Logs / Settings tabs) is staged for 1.1 alongside the API compat
 * layer; the legacy `web/src/components/service/Service*Tab.tsx`
 * components are dead today and will be revived or deleted then.
 */
function ManagedServiceDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getService(id)
      .then((s) => {
        if (!cancelled) setService(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load service');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="h-32 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
      </div>
    );
  }

  if (error || !service) {
    // 404 vs transient backend failure are different stories — don't
    // mislabel a 500/network error as "not found" (Codex CCG on PR #77).
    // Fetch helpers surface "Not found"/"404" on actual 404; anything
    // else is a transport error worth surfacing honestly.
    const isNotFound = error == null || /not found|404/i.test(error);
    const title = isNotFound ? 'Managed service not found' : 'Failed to load managed service';
    const subtitle = error ?? `No service with id "${id}"`;
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard title={title} subtitle={subtitle}>
          <button
            type="button"
            onClick={() => navigate('/managed-services')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            ← Back to Managed Services
          </button>
        </OuterCard>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]"
            >
              <Database className="h-3.5 w-3.5" />
            </span>
            <span>{service.name}</span>
            <ManagedHealthBadge status={service.status} />
          </span>
        }
        subtitle={service.type}
        actions={
          <button
            type="button"
            onClick={() => navigate('/managed-services')}
            className="text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
          >
            ← Managed Services
          </button>
        }
      >
        <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
          <ManagedDetailField label="Image" value={service.image} mono />
          <ManagedDetailField label="Port" value={String(service.port)} mono />
          <ManagedDetailField label="Container" value={service.container_name} mono />
          <ManagedDetailField
            label="Container ID"
            value={service.container_id ? service.container_id.slice(0, 12) : '—'}
            mono
          />
          <ManagedDetailField
            label="Created"
            value={new Date(service.created_at).toLocaleString()}
          />
          <ManagedDetailField
            label="Updated"
            value={new Date(service.updated_at).toLocaleString()}
          />
        </dl>
      </OuterCard>
    </div>
  );
}

function ManagedDetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={cn('mt-0.5 truncate text-[color:var(--ol-fg)]', mono && 'ol-mono text-[12.5px]')}
      >
        {value}
      </dd>
    </div>
  );
}

function ManagedHealthBadge({ status }: { status: 'running' | 'stopped' | 'error' }) {
  const cfg =
    status === 'running'
      ? {
          bg: 'var(--ol-success-soft)',
          fg: 'var(--ol-success)',
          dot: 'var(--ol-success)',
          label: 'running',
        }
      : status === 'error'
        ? {
            bg: 'var(--ol-error-soft)',
            fg: 'var(--ol-error)',
            dot: 'var(--ol-error)',
            label: 'error',
          }
        : {
            bg: 'var(--ol-panel-2)',
            fg: 'var(--ol-fg-muted)',
            dot: 'var(--ol-fg-subtle)',
            label: 'stopped',
          };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklch, ${cfg.bg} 100%, transparent)`,
        color: `color-mix(in oklch, ${cfg.fg} 100%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="h-1 w-1 rounded-full"
        style={{ backgroundColor: `color-mix(in oklch, ${cfg.dot} 100%, transparent)` }}
      />
      {cfg.label}
    </span>
  );
}

export default ServiceDetailV2;
