/**
 * ServiceDetailV2 — v0.1.
 *
 * Six tabs (observability-first per v0.1 spec):
 *   Overview · Logs · Deployments · Monitoring · Environment · Domains
 *
 * Resources and Advanced were folded away in PR #198 (Resources →
 * inline panel inside Overview; Advanced → ServiceDangerZone in
 * Overview). General was renamed to Overview in the same sweep.
 *
 * Logs tab mounts <LogViewer variant="runtime" /> — runtime container
 * logs, no phase rail, no terminal cards. Deployments tab opens a
 * deploy in-place via the deploy variant of <LogViewer />.
 *
 * Tab switching uses ProjectTabs which gives us WAI-ARIA arrow-key
 * tablist for free.
 *
 * Lint note: this file reads `service.image` / `service.port` /
 * `service.type` off the frontend ServiceNode wire shape (lib/projectTopology),
 * not the DB row. The no-dropped-columns rule's name-based check would
 * misfire here, so the rule is disabled file-wide; the canonical-column
 * contract is enforced server-side.
 */
/* eslint-disable openlander-internal/no-dropped-columns */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  Box,
  ClipboardPaste,
  Code2,
  Copy,
  Database,
  Edit,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Info,
  Loader2,
  Plus,
  Rocket,
  Save,
  Settings as SettingsIcon,
  ScrollText,
  Trash2,
} from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { LogViewer as ConsoleLogViewer } from '@/components/logs/LogViewer';
import { ServiceResourceLimitsPanel } from '@/components/service/ServiceResourceLimitsPanel';
import { Sparkline } from '@/components/Shell/Sparkline';
import { DeployRow } from '@/components/Shell/DeployRow';
import { type ServiceHealth, type ServiceNode } from '@/lib/projectTopology';
import { ApiError } from '@/lib/api/client';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { useServiceHealth } from '@/hooks/use-service-health';
import { useServiceMetrics } from '@/hooks/use-service-metrics';
import { useServiceDeployments } from '@/hooks/use-deployments';
import { useLanguage } from '@/i18n/context';
import {
  getGroupService,
  deleteGroupService,
  managedServices,
  type ConnectedProject,
  type GroupService,
  type MetricsRange,
  type Service,
} from '@/lib/api/services';
import {
  buildDomainUrl,
  createServiceDomain,
  deleteServiceDomain,
  deleteServiceEnvVar,
  DomainApiError,
  getServiceDomains,
  getServiceEnvVars,
  getWebServerSummary,
  redeployService,
  updateServiceEnvVars,
  type CreateDomainBody,
  type DomainMapping,
} from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DeployLogSummary } from '@/types';
import { cn } from '@/lib/utils';
import { isValidEnvKey } from '@/lib/env-key';
import { parseEnvContent } from '@/lib/parse-env';

type ServiceTabId = 'overview' | 'environment' | 'domains' | 'deployments' | 'logs' | 'monitoring';
type ManagedServiceTabId = 'overview' | 'logs' | 'connections' | 'settings';

const SERVICE_TAB_IDS = new Set<ServiceTabId>([
  'overview',
  'environment',
  'domains',
  'deployments',
  'logs',
  'monitoring',
]);

function isServiceTabId(value: string | null): value is ServiceTabId {
  return value != null && (SERVICE_TAB_IDS as Set<string>).has(value);
}

/**
 * Top-level dispatcher. Same route slot serves two different ID spaces:
 *   /services/:id (deployable; :id is a projects.id) vs
 *   /projects/:p/infrastructure/:id (infrastructure row; :id is a services.id).
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
  // Canonical (rc.1+):  /projects/:p/services/:s        → params { p, s }
  // Infrastructure:     /projects/:p/infrastructure/:id → params { p, id }
  // Legacy   (rc.0):    /services/:id?project=:p        → params { id }
  // Legacy managed:     /managed-services/:id           → params { id }
  //
  // The `id` field covers both legacy shapes; `s` covers canonical.
  // rc.2 will deprecate the legacy deployable URL once all internal
  // callers emit `/projects/:p/services/:s`.
  const { id, p, s } = useParams<{ id?: string; p?: string; s?: string }>();
  const location = useLocation();

  if (location.pathname.includes('/infrastructure/') && id) {
    return <ManagedServiceDetail key={id} id={id} routeProjectId={p ?? null} />;
  }

  // Legacy managed-service path takes priority — check by prefix before
  // inspecting params so stale bookmarks can be replaced after load.
  if (location.pathname.startsWith('/managed-services/') && id) {
    // `key={id}` forces remount on managed-service navigation. Without
    // it, React reuses the instance and ManagedServiceDetail's stale
    // state (previous service object) would render for one commit
    // before the id-change useEffect fires its setState — flagged by
    // Codex CCG on PR #77.
    return <ManagedServiceDetail key={id} id={id} routeProjectId={null} />;
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
  // Lifted to the top of the component so the canonical "Deployable
  // service" header kicker can pull from i18n; nested tab panels keep
  // their own useLanguage() declarations.
  const { t } = useLanguage();
  // v0.1 IA: Settings/Advanced/Resources tabs removed. Legacy
  // ?tab={general|resources|advanced|settings} fall through to overview.
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ServiceTabId>(
    isServiceTabId(tabParam) ? tabParam : 'overview',
  );

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
  const [serviceDetail, setServiceDetail] = useState<GroupService | null>(null);
  const [serviceDetailError, setServiceDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !id) {
      setServiceDetail(null);
      setServiceDetailError(null);
      return;
    }
    let cancelled = false;
    void getGroupService(projectId, id)
      .then((detail) => {
        if (cancelled) return;
        setServiceDetail(detail);
        setServiceDetailError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setServiceDetail(null);
        setServiceDetailError(
          err instanceof Error ? err.message : 'Failed to load service details',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, id]);

  const resolvedService = useMemo<ServiceNode | undefined>(() => {
    if (!service) return undefined;
    if (!serviceDetail) return service;
    return {
      ...service,
      source: serviceDetail.source ?? service.source,
      repoUrl: serviceDetail.repoUrl ?? service.repoUrl,
      branch: serviceDetail.branch ?? service.branch,
      deployedBranch: serviceDetail.deployedBranch ?? service.deployedBranch,
      dockerfilePath: serviceDetail.dockerfilePath ?? service.dockerfilePath,
      dockerTarget: serviceDetail.dockerTarget ?? service.dockerTarget,
      buildContext: serviceDetail.buildContext ?? service.buildContext,
      buildMethod: serviceDetail.buildMethod ?? service.buildMethod,
      imageUrl: serviceDetail.imageUrl ?? service.imageUrl,
      imageCmd: serviceDetail.imageCmd ?? service.imageCmd,
      containerPort: serviceDetail.containerPort ?? service.containerPort,
      image: serviceDetail.image ?? service.image,
      port: serviceDetail.port ?? service.port,
    };
  }, [service, serviceDetail]);

  // Live health for the header pill. Falls through to topology.health
  // until the dedicated endpoint returns. CCG: separate from InfraMap to
  // avoid N requests for N nodes.
  // PR7-G: simplified `service ? (id ?? null) : null` — when `id` is
  // missing the route guard already redirects, and the hook itself
  // no-ops on null. The previous form was a paradox (it returned the
  // same value `service` was derived from).
  const liveHealth = useServiceHealth(id ?? null);
  const effectiveHealth: ServiceHealth | undefined = liveHealth.health ?? resolvedService?.health;

  // Deployments are service-scoped. The top-level Deployments page is folded
  // into Activity; this tab remains the canonical per-service deploy history.
  const {
    deployments,
    loading: deploymentsLoading,
    refetch: refetchDeployments,
  } = useServiceDeployments(projectId ?? '', id ?? '');
  // Local-only throttle for the Deploy button. The backend remains the
  // source of truth for same-service concurrency (409 / DEPLOY_LOCKED),
  // while the accepted path immediately navigates to the in-flight log
  // surface keyed by the service id.
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  const handleDeploy = async () => {
    if (!projectId || !id || deploying) return;
    setDeployError(null);
    setDeploying(true);
    try {
      const result = await redeployService(projectId, id, { async: true });
      refetchDeployments();
      const deploymentId = result.deploymentId ?? result.serviceId ?? id;
      navigate(`/projects/${projectId}/deployments/${deploymentId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEPLOY_LOCKED') {
        setDeployError(t('serviceDetail.deploy.locked'));
      } else {
        setDeployError(
          err instanceof Error ? err.message : t('serviceDetail.deploy.fallbackError'),
        );
      }
    } finally {
      setDeploying(false);
    }
  };

  // v0.1 spec mandates an observability-first order:
  //   Overview · Logs · Deployments · Monitoring · Environment · Domains.
  // OpenLander is an agent-first PaaS — agents do most env/domain
  // configuration via MCP, and humans visit the Service Detail page
  // mostly to diagnose, verify, or monitor. Tabs that surface runtime
  // signals (Logs/Deployments/Monitoring) come before the
  // configuration tabs (Environment/Domains) so the high-signal data
  // is one click away. CCG round-0 (Codex + Gemini) both endorsed the
  // spec order over the previous config-first arrangement.
  const tabs = useMemo<TabDef<ServiceTabId>[]>(
    () => [
      { id: 'overview', label: t('services.detail.tabs.overview'), icon: SettingsIcon },
      { id: 'logs', label: t('services.detail.tabs.logs'), icon: ScrollText },
      {
        id: 'deployments',
        label: t('services.detail.tabs.deployments'),
        icon: Rocket,
        count: deployments.length || undefined,
      },
      { id: 'monitoring', label: t('services.detail.tabs.monitoring'), icon: ActivityIcon },
      { id: 'environment', label: t('services.detail.tabs.environment'), icon: Code2 },
      { id: 'domains', label: t('services.detail.tabs.domains'), icon: Globe },
    ],
    [deployments.length, t],
  );

  if (!resolvedService || !project) {
    const safeId = id ?? '';
    const safeProjectId = projectId ?? '';
    const reason = !projectId
      ? t('services.detail.notFoundReason.noProjectParam', { id: safeId })
      : t('services.detail.notFoundReason.serviceNotInProject', {
          id: safeId,
          projectId: safeProjectId,
        });
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard title={t('services.detail.notFound')} subtitle={reason}>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            {t('services.detail.backToHome')}
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
            <span>{resolvedService.name}</span>
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
          <span className="text-[12px]">
            <span className="text-[color:var(--ol-fg-subtle)]">{t('vocab.deployableService')}</span>
            <span className="ol-mono">
              {' · '}
              {resolvedService.kind} · {resolvedService.image}
            </span>
          </span>
        }
        actions={
          <>
            {resolvedService.url && (
              <a
                href={resolvedService.url}
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
              onClick={handleDeploy}
              disabled={deploying}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-3 py-1 text-[12px] font-medium transition-opacity',
                deploying
                  ? 'cursor-not-allowed bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-subtle)]'
                  : 'bg-[color:var(--ol-primary)] text-[color:var(--ol-primary-fg)] hover:opacity-90',
              )}
              aria-disabled={deploying}
            >
              <Rocket className="h-3.5 w-3.5" />
              {deploying ? 'Deploying…' : 'Deploy'}
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

        {serviceDetailError && (
          <div className="mx-5 mt-4 rounded-md border border-[color:var(--ol-warning)] bg-[color:var(--ol-warning-soft)] px-3 py-2 text-[12px] text-[color:var(--ol-warning)]">
            Service metadata could not be loaded. Showing last known topology data.{' '}
            <span className="ol-mono">{serviceDetailError}</span>
          </div>
        )}

        {deployError && (
          <div
            role="alert"
            className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_5%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]"
          >
            <span>
              {t('serviceDetail.deploy.failed')} <span className="ol-mono">{deployError}</span>
            </span>
            <button
              type="button"
              onClick={() => setDeployError(null)}
              className="shrink-0 text-[color:var(--ol-error)] underline-offset-2 hover:underline"
            >
              {t('serviceDetail.deploy.dismiss')}
            </button>
          </div>
        )}

        <TabPanel
          active={activeTab === 'overview'}
          panelId="servicepanel-overview"
          labelledBy="service-overview"
          className="p-5"
        >
          <div className="flex flex-col gap-5">
            <GeneralTab service={resolvedService} />
            <ServiceResourceLimitsPanel
              projectId={project.id}
              serviceId={resolvedService.id}
              isCompose={resolvedService.buildMethod === 'compose'}
            />
            <ServiceDangerZone
              service={resolvedService}
              projectId={projectId}
              projectName={project?.name ?? undefined}
              onServiceDeleted={() => navigate(`/projects/${project.id}`)}
            />
          </div>
        </TabPanel>

        <TabPanel
          active={activeTab === 'environment'}
          panelId="servicepanel-environment"
          labelledBy="service-environment"
          className="p-5"
        >
          <EnvironmentTab service={resolvedService} projectId={project?.id ?? null} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'domains'}
          panelId="servicepanel-domains"
          labelledBy="service-domains"
          className="p-5"
        >
          <DomainsTab
            service={resolvedService}
            projectId={project?.id ?? null}
            projectName={project?.name ?? undefined}
          />
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
            onOpenDeploy={(d) => {
              // v0.1 spec design (`p7-log-success.png`) shows the deploy
              // detail as a full page inside the dashboard chrome
              // (sidebar + breadcrumb + StaticLogViewer + summary card),
              // not a black-backdrop modal overlay. Navigate to the
              // route page so the layout matches the design.
              if (projectId) {
                navigate(`/projects/${projectId}/deployments/${d.id}`);
              }
            }}
          />
        </TabPanel>

        <TabPanel
          active={activeTab === 'logs'}
          panelId="servicepanel-logs"
          labelledBy="service-logs"
          className="p-0"
        >
          <RuntimeLogsTab projectId={projectId} serviceId={resolvedService.id} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'monitoring'}
          panelId="servicepanel-monitoring"
          labelledBy="service-monitoring"
          className="p-5"
        >
          <MonitoringTab service={resolvedService} />
        </TabPanel>
      </OuterCard>
    </div>
  );
}

// ─── Tab content ────────────────────────────────────────────────────────────

function GeneralTab({ service }: { service: ServiceNode }) {
  const { t } = useLanguage();

  const handleCopyUrl = () => {
    if (!service.url) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(service.url).catch(() => {
        /* best-effort */
      });
    }
  };

  const sourceRows: [string, string][] = [];
  if (service.repoUrl) {
    const parsed = parseRepoUrl(service.repoUrl);
    if (parsed) {
      sourceRows.push(['Provider', parsed.provider]);
      sourceRows.push(['Repository', parsed.path]);
    } else {
      sourceRows.push(['Source', service.repoUrl]);
    }
    const branch = service.branch ?? service.deployedBranch;
    if (branch) {
      sourceRows.push(['Branch', branch]);
    }
    if (service.branch && service.deployedBranch && service.branch !== service.deployedBranch) {
      sourceRows.push(['Deployed branch', service.deployedBranch]);
    }
    sourceRows.push(['Build path', formatBuildPath(service.buildContext)]);
  } else if (service.image) {
    sourceRows.push(['Source', 'Container image']);
    sourceRows.push(['Image', service.image]);
  }

  const buildMethod = getBuildMethodLabel(service);
  const buildRows: [string, string][] = [
    ['Method', buildMethod],
    ['Dockerfile', service.dockerfilePath ?? (buildMethod === 'Dockerfile' ? 'Dockerfile' : '—')],
    ['Target stage', service.dockerTarget ?? '—'],
    ['Build context', service.buildContext ?? (buildMethod === 'Dockerfile' ? '.' : '—')],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SubCard title={t('services.detail.section.source')}>
          {sourceRows.length === 0 ? (
            <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
              {t('services.detail.source.empty')}
            </p>
          ) : (
            <KvList rows={sourceRows} valueClassName="ol-mono break-all text-[12px]" />
          )}
        </SubCard>
        <SubCard title={t('services.detail.section.build')}>
          <KvList rows={buildRows} valueClassName="ol-mono text-[12px]" />
        </SubCard>
      </div>
      <SubCard
        title={t('services.detail.section.runtime')}
        badge={<HealthBadge health={service.health} />}
      >
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label={t('services.detail.runtime.cpuLabel')}
            value={service.cpu}
            sub={t('services.detail.runtime.cpuSub')}
          />
          <Metric
            label={t('services.detail.runtime.memLabel')}
            value={service.mem}
            sub={t('services.detail.runtime.memSub')}
          />
        </div>
        {service.url && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-medium text-[color:var(--ol-fg-muted)]">
              {t('services.detail.runtime.publicUrlLabel')}
            </div>
            <div className="flex items-center gap-2 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2">
              <Globe className="h-3.5 w-3.5 shrink-0 text-[color:var(--ol-primary)]" />
              <a
                href={service.url}
                target="_blank"
                rel="noreferrer"
                className="ol-mono min-w-0 flex-1 truncate text-[12px] text-[color:var(--ol-primary)] hover:underline"
              >
                {service.url}
              </a>
              <button
                type="button"
                onClick={handleCopyUrl}
                aria-label={t('services.detail.runtime.copyUrl')}
                title={t('services.detail.runtime.copyUrl')}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel)] hover:text-[color:var(--ol-fg)]"
              >
                <Copy className="h-3 w-3" />
              </button>
              <a
                href={service.url}
                target="_blank"
                rel="noreferrer"
                aria-label={t('services.detail.runtime.openInNewTab')}
                title={t('services.detail.runtime.openInNewTab')}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel)] hover:text-[color:var(--ol-fg)]"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </SubCard>
    </div>
  );
}

function EnvironmentTab({
  service,
  projectId,
}: {
  service: ServiceNode;
  projectId: string | null;
}) {
  const { t } = useLanguage();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string; revealed: boolean }>>(
    [],
  );
  const [initialKeys, setInitialKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const vars = await getServiceEnvVars(projectId, service.id);
        if (!cancelled) {
          setEnvVars(
            Object.entries(vars)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => ({ key, value, revealed: false })),
          );
          setInitialKeys(new Set(Object.keys(vars)));
          setEnvError(null);
          setDirty(false);
        }
      } catch (err) {
        if (!cancelled) {
          setEnvError(err instanceof Error ? err.message : t('projectDetail.env.loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, service.id, t]);

  const addVar = () => {
    setEnvVars((prev) => [...prev, { key: '', value: '', revealed: true }]);
    setDirty(true);
    setMessage(null);
  };

  const updateVar = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
    setDirty(true);
    setMessage(null);
  };

  const removeVar = (index: number) => {
    setEnvVars((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    setDirty(true);
    setMessage(null);
  };

  const toggleReveal = (index: number) => {
    setEnvVars((prev) =>
      prev.map((row, rowIndex) => (rowIndex === index ? { ...row, revealed: !row.revealed } : row)),
    );
  };

  const importPaste = () => {
    const parsed = parseEnvContent(pasteText);
    if (parsed.length === 0) return;
    // Validate at import time so users learn about bad .env keys
    // before they hit Save (Codex CCG round 1 P2). Refuse the whole
    // paste — silently dropping rows would lose data the user typed
    // and pasted; refusing surfaces the bad key by name so they can
    // fix the .env content and retry.
    const invalidEntry = parsed.find((entry) => !isValidEnvKey(entry.key));
    if (invalidEntry) {
      setEnvError(t('projectDetail.env.invalidKey').replace('{key}', invalidEntry.key));
      return;
    }
    setEnvVars((prev) => {
      const merged = new Map(prev.map((row) => [row.key, row]));
      for (const item of parsed) {
        merged.set(item.key, { key: item.key, value: item.value, revealed: false });
      }
      return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
    });
    setPasteOpen(false);
    setPasteText('');
    setDirty(true);
    setEnvError(null);
    setMessage(null);
  };

  const saveEnv = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;
    // Use a Map so duplicate detection only fires on actual user keys.
    // A plain object's `key in envMap` check would flag `constructor`,
    // `toString`, `__proto__`, etc. as duplicates because they exist
    // on Object.prototype — those are all valid env names under the
    // backend ENV_KEY_PATTERN, so a false-positive dup error here
    // would diverge from server-side rules (Codex CCG round 1 P1).
    const envMap = new Map<string, string>();
    for (const row of envVars) {
      const key = row.key.trim();
      if (!key) continue;
      // Mirror the backend ENV_KEY_PATTERN check from
      // src/web/api/service-env-routes.ts so users get a localized,
      // row-specific error instead of the raw regex string the
      // backend echoes back. The check still happens server-side as
      // the source of truth — this is purely UX.
      if (!isValidEnvKey(key)) {
        setEnvError(t('projectDetail.env.invalidKey').replace('{key}', key));
        return;
      }
      if (envMap.has(key)) {
        setEnvError(t('projectDetail.env.duplicateKey').replace('{key}', key));
        return;
      }
      envMap.set(key, row.value);
    }

    setSaving(true);
    setMessage(null);
    setEnvError(null);
    try {
      const removedKeys = Array.from(initialKeys).filter((key) => !envMap.has(key));
      const envRecord = Object.fromEntries(envMap);
      const [updateResult, deleteResults] = await Promise.all([
        updateServiceEnvVars(projectId, service.id, envRecord),
        Promise.all(removedKeys.map((key) => deleteServiceEnvVar(projectId, service.id, key))),
      ]);
      const needsRedeploy =
        updateResult.needsRedeploy || deleteResults.some((result) => result.needsRedeploy);
      setInitialKeys(new Set(envMap.keys()));
      setEnvVars(
        Array.from(envMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => ({ key, value, revealed: false })),
      );
      setDirty(false);
      setMessage(
        needsRedeploy ? t('projectDetail.env.savedNeedsRedeploy') : t('projectDetail.env.saved'),
      );
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : t('projectDetail.env.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'ol-mono w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)] outline-none transition-colors placeholder:text-[color:var(--ol-fg-subtle)] focus:border-[color:var(--ol-primary)]';

  return (
    <form onSubmit={saveEnv}>
      <SubCard
        title={t('projectDetail.env.title')}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasteOpen((open) => !open)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
            >
              <ClipboardPaste className="h-3 w-3" />
              {t('projectDetail.env.paste')}
            </button>
            <button
              type="button"
              onClick={addVar}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
            >
              <Plus className="h-3 w-3" />
              {t('projectDetail.env.add')}
            </button>
          </div>
        }
      >
        <div className="mb-4 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12px] text-[color:var(--ol-fg-muted)]">
          {t('projectDetail.env.description')}
        </div>

        {pasteOpen && (
          <div className="mb-4 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-3">
            <label className="text-[12px] font-medium text-[color:var(--ol-fg-muted)]">
              {t('projectDetail.env.pasteTitle')}
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                rows={6}
                placeholder={'DATABASE_URL=postgresql://...\nAPI_KEY=sk-...'}
                className={cn(inputClass, 'mt-2 resize-none')}
              />
            </label>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteText('');
                }}
                className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
              >
                {t('projectDetail.env.cancel')}
              </button>
              <button
                type="button"
                onClick={importPaste}
                disabled={!pasteText.trim()}
                className="rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ol-primary-fg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('projectDetail.env.import')}
              </button>
            </div>
          </div>
        )}

        {envError && <p className="mb-3 text-[12.5px] text-[color:var(--ol-error)]">{envError}</p>}
        {loading ? (
          <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
            {t('projectDetail.env.loading')}
          </p>
        ) : envVars.length === 0 ? (
          <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
            {t('projectDetail.env.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_72px] gap-2 px-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
              <span>{t('projectDetail.env.key')}</span>
              <span>{t('projectDetail.env.value')}</span>
              <span />
            </div>
            {envVars.map((row, index) => (
              <div
                key={`${row.key || 'new'}-${String(index)}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_72px] gap-2"
              >
                <input
                  value={row.key}
                  onChange={(event) => updateVar(index, 'key', event.target.value)}
                  placeholder={t('services.detail.envVars.keyPlaceholder')}
                  className={inputClass}
                />
                <input
                  type={row.revealed ? 'text' : 'password'}
                  value={row.value}
                  onChange={(event) => updateVar(index, 'value', event.target.value)}
                  placeholder={t('services.detail.envVars.valuePlaceholder')}
                  className={inputClass}
                />
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => toggleReveal(index)}
                    title={
                      row.revealed
                        ? t('projectDetail.env.hideValue')
                        : t('projectDetail.env.showValue')
                    }
                    className="grid h-8 w-8 place-items-center rounded-md text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
                  >
                    {row.revealed ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVar(index)}
                    title={t('projectDetail.env.delete')}
                    className="grid h-8 w-8 place-items-center rounded-md text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-error-soft)] hover:text-[color:var(--ol-error)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!projectId || saving || !dirty}
            className="inline-flex items-center gap-2 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saving ? t('projectDetail.env.saving') : t('projectDetail.env.save')}
          </button>
          {message && <span className="text-[12px] text-[color:var(--ol-success)]">{message}</span>}
          {dirty && !message && (
            <span className="text-[12px] text-[color:var(--ol-fg-muted)]">
              {t('projectDetail.env.unsavedChanges')}
            </span>
          )}
        </div>
      </SubCard>
    </form>
  );
}

function DomainsTab({
  service,
  projectId,
}: {
  service: ServiceNode;
  projectId: string | null;
  projectName?: string;
}) {
  const { t } = useLanguage();
  const [domains, setDomains] = useState<DomainMapping[] | null>(null);
  const [proxyMode, setProxyMode] = useState<'managed' | 'external' | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DomainMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const resp = await getServiceDomains(projectId, service.id);
      setDomains(resp.domains);
      setLoadError(null);
    } catch (err) {
      // Do NOT silently set domains=[] — that masks the failure as an
      // empty state. Surface the error explicitly so the operator knows
      // the list might be stale and Add can be blocked when needed.
      const message = err instanceof Error ? err.message : 'Failed to load domains';
      setLoadError(message);
    }
  }, [projectId, service.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const summary = await getWebServerSummary();
        if (!cancelled) setProxyMode(summary.proxy.mode);
      } catch {
        // Default to managed when summary is unavailable: passive
        // detection failures must not silently disable Add Domain.
        if (!cancelled) setProxyMode('managed');
      }
    })();
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const externalMode = proxyMode === 'external';

  const handleAdd = async (body: CreateDomainBody): Promise<DomainApiError | null> => {
    if (!projectId) return null;
    setBusy(true);
    try {
      await createServiceDomain(projectId, service.id, body);
      await refresh();
      setShowAdd(false);
      setFeedback({ kind: 'ok', msg: t('projectDetail.domains.toast.added') });
      return null;
    } catch (err) {
      if (err instanceof DomainApiError) return err;
      setFeedback({ kind: 'err', msg: t('projectDetail.domains.toast.addFailed') });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!projectId || !deleteTarget) return;
    setBusy(true);
    try {
      await deleteServiceDomain(projectId, service.id, deleteTarget.id);
      await refresh();
      setFeedback({ kind: 'ok', msg: t('projectDetail.domains.toast.removed') });
    } catch {
      setFeedback({ kind: 'err', msg: t('projectDetail.domains.toast.deleteFailed') });
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  return (
    <SubCard title={t('services.detail.section.domains')}>
      <div className="flex flex-col gap-2">
        {service.url && (
          <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 shrink-0 text-[color:var(--ol-primary)]" />
              <span className="ol-mono min-w-0 flex-1 truncate text-[12px] text-[color:var(--ol-primary)]">
                {service.url}
              </span>
              <span className="shrink-0 rounded-full bg-[color:var(--ol-panel)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
                Auto
              </span>
            </div>
          </div>
        )}
        {loadError && (
          <div className="rounded-md border border-[color:var(--ol-danger)] bg-[color:var(--ol-danger-soft)] p-3">
            <div className="flex items-center gap-2">
              <span className="ol-mono min-w-0 flex-1 truncate text-[12px] text-[color:var(--ol-danger)]">
                {t('projectDetail.domains.loadError')}
              </span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="shrink-0 rounded-md border border-[color:var(--ol-danger)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ol-danger)] hover:bg-[color:var(--ol-danger-soft)]"
              >
                {t('projectDetail.domains.retry')}
              </button>
            </div>
          </div>
        )}
        {domains?.map((d) => (
          <DomainRow
            key={d.id}
            domain={d}
            onDelete={() => setDeleteTarget(d)}
            t={t}
            disabled={busy}
          />
        ))}
        {!service.url &&
          !loadError &&
          domains !== null &&
          domains.length === 0 &&
          !externalMode && (
            <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
              {t('projectDetail.domains.empty')}
            </p>
          )}
        {externalMode && (
          <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
            {t('projectDetail.domains.emptyExternal')}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => setShowAdd(true)}
          disabled={externalMode || busy || !projectId || loadError !== null}
          title={
            externalMode
              ? t('projectDetail.domains.emptyExternal')
              : loadError
                ? t('projectDetail.domains.loadError')
                : undefined
          }
          className="gap-1.5"
        >
          <Plus className="h-3 w-3" />
          {t('projectDetail.domains.add')}
        </Button>
        {feedback && (
          <span
            className={cn(
              'text-[12px]',
              feedback.kind === 'ok'
                ? 'text-[color:var(--ol-success)]'
                : 'text-[color:var(--ol-danger)]',
            )}
          >
            {feedback.msg}
          </span>
        )}
      </div>

      <p className="mt-2.5 text-[11.5px] text-[color:var(--ol-fg-muted)]">
        {t('projectDetail.domains.tlsHint')}
      </p>
      <p className="mt-1 text-[11.5px] text-[color:var(--ol-fg-muted)]">
        {t('projectDetail.domains.dnsHint')}
      </p>

      <AddDomainDialog
        open={showAdd}
        onOpenChange={(open) => setShowAdd(open)}
        onSubmit={handleAdd}
        defaultPort={service.containerPort ?? service.port ?? null}
        t={t}
        busy={busy}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={
          deleteTarget
            ? `${t('projectDetail.domains.delete.title')} — ${deleteTarget.domain}${
                deleteTarget.pathPrefix === '/' ? '' : ' ' + deleteTarget.pathPrefix
              }`
            : t('projectDetail.domains.delete.title')
        }
        description={t('projectDetail.domains.delete.description')}
        confirmLabel={t('projectDetail.domains.delete.confirm')}
        cancelLabel={t('projectDetail.domains.delete.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </SubCard>
  );
}

function DomainRow({
  domain,
  onDelete,
  t,
  disabled,
}: {
  domain: DomainMapping;
  onDelete: () => void;
  t: ReturnType<typeof useLanguage>['t'];
  disabled: boolean;
}) {
  const displayUrl = buildDomainUrl(domain);
  const statusKey = `projectDetail.domains.status.${domain.status}` as
    | 'projectDetail.domains.status.active'
    | 'projectDetail.domains.status.pending'
    | 'projectDetail.domains.status.error';
  const statusVariant =
    domain.status === 'active' ? 'green' : domain.status === 'error' ? 'red' : 'yellow';
  const iconColor =
    domain.status === 'active'
      ? 'var(--ol-success)'
      : domain.status === 'error'
        ? 'var(--ol-danger)'
        : 'var(--ol-warning)';
  return (
    <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 shrink-0" style={{ color: iconColor }} />
        <span className="ol-mono min-w-0 flex-1 truncate text-[12px] text-[color:var(--ol-fg)]">
          {displayUrl}
        </span>
        {domain.legacyWarning && (
          <Badge
            variant="yellow"
            title={t('projectDetail.domains.legacyTooltip')}
            className="shrink-0 uppercase tracking-wide"
          >
            {t('projectDetail.domains.legacyBadge')}
          </Badge>
        )}
        <Badge variant={statusVariant} className="shrink-0 uppercase tracking-wide">
          {t(statusKey)}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={disabled}
          aria-label={t('projectDetail.domains.removeAria')}
          className="shrink-0 h-7 w-7 text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-danger)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AddDomainDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultPort,
  t,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: CreateDomainBody) => Promise<DomainApiError | null>;
  defaultPort: number | null;
  t: ReturnType<typeof useLanguage>['t'];
  busy: boolean;
}) {
  const [domainValue, setDomainValue] = useState('');
  const [pathValue, setPathValue] = useState('/');
  const [stripPrefix, setStripPrefix] = useState(false);
  const [stripTouched, setStripTouched] = useState(false);
  const [upstreamPath, setUpstreamPath] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; msg: string } | null>(null);

  useEffect(() => {
    if (open) {
      setDomainValue('');
      setPathValue('/');
      setStripPrefix(false);
      setStripTouched(false);
      setUpstreamPath('');
      setTargetPort('');
      setAdvanced(false);
      setFieldError(null);
    }
  }, [open]);

  // Auto-enable strip_prefix when the user picks a non-root path, unless
  // they've already touched the strip toggle explicitly. Most non-root
  // routes want StripPrefix (so /api/users hits the backend as /users);
  // making the user dig through Advanced is the #1 v0.1 UX trap.
  function handlePathChange(value: string) {
    setPathValue(value);
    if (!stripTouched && value !== '/' && value !== '' && value.startsWith('/')) {
      setStripPrefix(true);
    }
    if (!stripTouched && (value === '/' || value === '')) {
      setStripPrefix(false);
    }
  }

  function handleStripChange(checked: boolean) {
    setStripPrefix(checked);
    setStripTouched(true);
  }

  function validate(): CreateDomainBody | null {
    const domain = domainValue.trim().toLowerCase();
    if (!domain) {
      setFieldError({ field: 'domain', msg: t('projectDetail.domains.error.missingDomain') });
      return null;
    }
    if (!/^[a-z0-9]([a-z0-9-.]*[a-z0-9])?$/.test(domain) || !domain.includes('.')) {
      setFieldError({ field: 'domain', msg: t('projectDetail.domains.error.invalidDomain') });
      return null;
    }
    const path = pathValue.trim() || '/';
    if (!path.startsWith('/')) {
      setFieldError({ field: 'path', msg: t('projectDetail.domains.error.invalidPath') });
      return null;
    }
    let upstream: string | null = null;
    if (upstreamPath.trim()) {
      if (!upstreamPath.trim().startsWith('/')) {
        setFieldError({ field: 'upstream', msg: t('projectDetail.domains.error.invalidPath') });
        return null;
      }
      upstream = upstreamPath.trim();
    }
    let port: number | null = null;
    if (targetPort.trim()) {
      const n = Number(targetPort);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        setFieldError({ field: 'port', msg: t('projectDetail.domains.error.invalidPort') });
        return null;
      }
      port = n;
    }
    setFieldError(null);
    return {
      domain,
      pathPrefix: path,
      // StripPrefix is meaningless on the root path — force false there
      // even if the toggle state still says true (e.g. user picked /api
      // then went back to /).
      stripPrefix: path === '/' ? false : stripPrefix,
      upstreamPathPrefix: upstream,
      targetPort: port,
    };
  }

  function mapServerError(err: DomainApiError) {
    if (err.code === 'DOMAIN_ROUTE_EXISTS') {
      setFieldError({ field: 'domain', msg: t('projectDetail.domains.error.duplicate') });
      return;
    }
    if (err.code === 'DOMAIN_ROUTING_DISABLED') {
      setFieldError({ msg: t('projectDetail.domains.toast.routingDisabled') });
      return;
    }
    if (err.code === 'INVALID_SERVICE_KIND') {
      setFieldError({ msg: t('projectDetail.domains.error.invalidServiceKind') });
      return;
    }
    if (err.code === 'SERVICE_SELECTION_REQUIRED') {
      setFieldError({ msg: t('projectDetail.domains.error.serviceSelectionRequired') });
      return;
    }
    if (err.code === 'MISSING_FIELD') {
      setFieldError({ field: 'domain', msg: t('projectDetail.domains.error.missingDomain') });
      return;
    }
    if (err.status === 404) {
      setFieldError({ msg: t('projectDetail.domains.error.notFound') });
      return;
    }
    // INVALID_FIELD or unknown — surface backend message
    setFieldError({ msg: err.message || t('projectDetail.domains.error.serverError') });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = validate();
    if (!body) return;
    const err = await onSubmit(body);
    if (err) mapServerError(err);
  }

  const portPlaceholder = defaultPort
    ? t('projectDetail.domains.dialog.targetPortPlaceholder').replace('{port}', String(defaultPort))
    : t('projectDetail.domains.dialog.targetPortPlaceholderNone');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('projectDetail.domains.dialog.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-domain-domain">{t('projectDetail.domains.dialog.domain')}</Label>
            <Input
              id="add-domain-domain"
              type="text"
              value={domainValue}
              onChange={(e) => setDomainValue(e.target.value)}
              placeholder={t('projectDetail.domains.dialog.domainPlaceholder')}
              className={cn(
                'ol-mono',
                fieldError?.field === 'domain' && 'border-[color:var(--ol-danger)]',
              )}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-domain-path">{t('projectDetail.domains.dialog.path')}</Label>
            <Input
              id="add-domain-path"
              type="text"
              value={pathValue}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="/"
              className={cn(
                'ol-mono',
                fieldError?.field === 'path' && 'border-[color:var(--ol-danger)]',
              )}
            />
          </div>

          {pathValue !== '/' && pathValue !== '' && (
            <label className="flex items-start gap-2 text-[12px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={stripPrefix}
                onChange={(e) => handleStripChange(e.target.checked)}
              />
              <span className="flex flex-col">
                <span>{t('projectDetail.domains.dialog.stripPrefix')}</span>
                <span className="text-[11px] text-[color:var(--ol-fg-muted)]">
                  {t('projectDetail.domains.dialog.stripPrefixHint')}
                </span>
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="self-start text-[11.5px] text-[color:var(--ol-fg-muted)] underline-offset-2 hover:underline"
          >
            {advanced ? '▾' : '▸'} {t('projectDetail.domains.dialog.advanced')}
          </button>

          {advanced && (
            <div className="flex flex-col gap-3 border-l border-[color:var(--ol-border-subtle)] pl-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-domain-upstream">
                  {t('projectDetail.domains.dialog.upstreamPathPrefix')}
                </Label>
                <Input
                  id="add-domain-upstream"
                  type="text"
                  value={upstreamPath}
                  onChange={(e) => setUpstreamPath(e.target.value)}
                  placeholder={t('projectDetail.domains.dialog.upstreamPathPlaceholder')}
                  className={cn(
                    'ol-mono',
                    fieldError?.field === 'upstream' && 'border-[color:var(--ol-danger)]',
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-domain-port">
                  {t('projectDetail.domains.dialog.targetPort')}
                </Label>
                <Input
                  id="add-domain-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                  placeholder={portPlaceholder}
                  className={cn(
                    'ol-mono',
                    fieldError?.field === 'port' && 'border-[color:var(--ol-danger)]',
                  )}
                />
              </div>
            </div>
          )}

          {fieldError && (
            <p className="text-[11.5px] text-[color:var(--ol-danger)]">{fieldError.msg}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('projectDetail.domains.dialog.cancel')}
            </Button>
            <Button type="submit" disabled={busy} className="gap-1.5">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {busy
                ? t('projectDetail.domains.dialog.submitting')
                : t('projectDetail.domains.dialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

function RuntimeLogsTab({ projectId, serviceId }: { projectId: string | null; serviceId: string }) {
  if (!projectId) {
    return (
      <div className="px-6 py-12 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
        Logs unavailable until the project context resolves.
      </div>
    );
  }
  return (
    <div className="h-[calc(100vh-260px)] min-h-[420px]">
      <ConsoleLogViewer projectId={projectId} serviceId={serviceId} />
    </div>
  );
}

function ServiceDangerZone({
  service,
  projectId,
  projectName,
  onServiceDeleted,
}: {
  service: ServiceNode;
  projectId: string | null;
  projectName?: string;
  onServiceDeleted: () => void;
}) {
  const { t } = useLanguage();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteVolumes, setDeleteVolumes] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const expectedDeleteSlug = projectName ? `${projectName}/${service.name}` : '';

  const submitDeleteService = async () => {
    if (!projectId || !expectedDeleteSlug || deleteConfirmation.trim() !== expectedDeleteSlug) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGroupService(projectId, service.id, {
        confirmation: deleteConfirmation.trim(),
        deleteVolumes,
      });
      onServiceDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('projectDetail.serviceDelete.error'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t border-[color:var(--ol-border-subtle)] pt-5">
      <h3 className="text-[13px] font-semibold text-[color:var(--ol-error)]">
        {t('projectDetail.serviceDelete.title')}
      </h3>
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        className={cn(
          'flex items-start gap-3 rounded-md border border-[color:var(--ol-border-subtle)]',
          'bg-[color:var(--ol-panel)] px-4 py-3 text-left transition-colors',
          'hover:border-[color:var(--ol-error)] hover:bg-[color-mix(in_oklch,var(--ol-error)_6%,transparent)]',
        )}
      >
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklch,var(--ol-error)_10%,transparent)] text-[color:var(--ol-error)]"
        >
          <Trash2 className="h-4 w-4" />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[color:var(--ol-error)]">
            {t('projectDetail.serviceDelete.title')}
          </span>
          <span className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
            {t('projectDetail.serviceDelete.body')}
          </span>
        </span>
      </button>
      {deleteOpen && (
        <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_5%,transparent)] p-4">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-[color:var(--ol-error)]">
                {t('projectDetail.serviceDelete.confirmTitle')}
              </h3>
              <p className="mt-1 text-[12px] text-[color:var(--ol-fg-muted)]">
                {t('projectDetail.serviceDelete.confirmDescription')}
              </p>
            </div>
            <label className="text-[12px] font-medium text-[color:var(--ol-fg-muted)]">
              {t('projectDetail.serviceDelete.confirmLabel')}
              <span className="ol-mono ml-1 text-[color:var(--ol-fg)]">{expectedDeleteSlug}</span>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="ol-mono mt-1 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)] outline-none transition-colors focus:border-[color:var(--ol-error)]"
                placeholder={expectedDeleteSlug}
              />
            </label>
            <label className="flex items-start gap-2 text-[12px] text-[color:var(--ol-fg-muted)]">
              <input
                type="checkbox"
                checked={deleteVolumes}
                onChange={(event) => setDeleteVolumes(event.target.checked)}
                className="mt-0.5"
              />
              <span>{t('projectDetail.serviceDelete.deleteVolumes')}</span>
            </label>
            {deleteError && (
              <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_8%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
                {deleteError}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmation('');
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
              >
                {t('projectDetail.env.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submitDeleteService()}
                disabled={
                  deleting ||
                  !expectedDeleteSlug ||
                  deleteConfirmation.trim() !== expectedDeleteSlug
                }
                className="rounded-md bg-[color:var(--ol-error)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting
                  ? t('projectDetail.serviceDelete.deleting')
                  : t('projectDetail.serviceDelete.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonitoringTab({ service }: { service: ServiceNode }) {
  const { t } = useLanguage();
  const [range, setRange] = useState<MetricsRange>('1h');
  const ranges: readonly MetricsRange[] = ['15m', '1h', '6h', '24h', '7d'] as const;
  const { metrics } = useServiceMetrics(service.id, range);

  // Headline values must come from the same metrics payload as the
  // sparklines. Topology cpu/mem strings can go stale independently,
  // which produced "chart present, headline —" in the Monitoring tab.
  const cpuData = useMemo(() => metrics?.cpu ?? [], [metrics]);
  const memData = useMemo(() => metrics?.memory ?? [], [metrics]);
  const reqData = useMemo(() => metrics?.requestsPerSec ?? [], [metrics]);
  const errData = useMemo(() => metrics?.errorRate ?? [], [metrics]);

  const cpuDisplay = formatMetricAverage(cpuData, (value) => `${value.toFixed(1)}%`);
  const memDisplay = formatMetricAverage(memData, (value) => `${Math.round(value)} MB`);

  // Request/error telemetry is not wired yet on the backend. The API
  // returns zero-filled arrays for contract stability, so avoid rendering
  // fake "0 rps" / "0.00%" as if those were measured values.
  const hasTrafficTelemetry =
    metrics !== null &&
    (metrics.totalRequests > 0 ||
      metrics.requestsPerSec.some((value) => value > 0) ||
      metrics.errorRate.some((value) => value > 0) ||
      metrics.p95LatencyMs > 0);
  const reqLatest =
    hasTrafficTelemetry && metrics
      ? Math.round(metrics.requestsPerSec[metrics.requestsPerSec.length - 1] ?? 0)
      : null;
  const errLatest =
    hasTrafficTelemetry && metrics ? (metrics.errorRate[metrics.errorRate.length - 1] ?? 0) : null;
  const p95Display = hasTrafficTelemetry && metrics ? `${Math.round(metrics.p95LatencyMs)}ms` : '—';

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
          title={t('services.detail.charts.cpu')}
          value={cpuDisplay}
          sub={t('services.detail.charts.avgOverRange', { range })}
          data={cpuData}
          color="var(--ol-primary)"
        />
        <MetricCard
          title={t('services.detail.charts.memory')}
          value={memDisplay}
          sub={t('services.detail.charts.avgOverRange', { range })}
          data={memData}
          color="var(--ol-success)"
        />
        <MetricCard
          title={t('services.detail.charts.requestsPerSec')}
          value={reqLatest != null ? `${reqLatest} rps` : '—'}
          sub={t('services.detail.charts.p95Line', { value: p95Display, range })}
          data={reqData}
          color="var(--ol-actor-webhook)"
        />
        <MetricCard
          title={t('services.detail.charts.errorRate')}
          value={errLatest != null ? `${errLatest.toFixed(2)}%` : '—'}
          sub={t('services.detail.charts.errorRateSub')}
          data={errData}
          color="var(--ol-error)"
        />
      </div>
    </div>
  );
}

// ─── Reusable subcomponents ────────────────────────────────────────────────

function averageFinite(values: readonly number[]): number | null {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function formatMetricAverage(
  values: readonly number[],
  formatter: (value: number) => string,
): string {
  const average = averageFinite(values);
  return average === null ? '—' : formatter(average);
}

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

/** Parse a Git remote URL into a friendly Provider + path pair so the
 *  Source card reads like a UI surface ("GitHub · myorg/myrepo")
 *  rather than a raw URL. Returns null when the URL doesn't look like
 *  a recognisable Git remote. */
function parseRepoUrl(url: string): { provider: string; path: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let provider = host;
    if (host === 'github.com' || host.endsWith('.github.com')) provider = 'GitHub';
    else if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) provider = 'GitLab';
    else if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) provider = 'Bitbucket';
    else if (host === 'codeberg.org') provider = 'Codeberg';
    const trimmed = u.pathname.replace(/^\//, '').replace(/\.git$/, '');
    if (!trimmed) return null;
    return { provider, path: trimmed };
  } catch {
    return null;
  }
}

function getBuildMethodLabel(service: ServiceNode): string {
  const method = service.buildMethod?.trim();
  const normalized = method?.toLowerCase();
  if (normalized === 'compose') return 'Compose';
  if (normalized === 'dockerfile') return 'Dockerfile';
  if (normalized === 'image') return 'Image';
  if (service.source === 'image') return 'Image';
  if (service.dockerfilePath || service.repoUrl || service.source === 'git') return 'Dockerfile';
  return method && method.length > 0 ? method : 'Auto';
}

function formatBuildPath(value: string | null | undefined): string {
  const path = value?.trim();
  if (!path || path === '.') return './';
  return path;
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

function HealthBadge({ health }: { health: 'healthy' | 'crashed' | 'deploying' }) {
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
  if (health === 'deploying') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-info-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-info)]">
        <span
          aria-hidden
          className="h-1 w-1 animate-pulse rounded-full"
          style={{ backgroundColor: 'var(--ol-info)' }}
        />
        deploying
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
  const { t } = useLanguage();
  return (
    <div
      role="radiogroup"
      aria-label={t('services.detail.timeRangeAria')}
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
 * ManagedServiceDetail — operational detail surface for infrastructure services
 * (postgres / mysql / redis / mongo etc).
 *
 * Mounted at `/projects/:p/infrastructure/:id` via the route-prefix gate
 * at the top of `ServiceDetailV2`. v0.1.4 keeps native creation out of
 * the web UI but exposes Overview / Logs / Connections / Settings so
 * existing MCP-created infrastructure can be inspected and operated.
 */
function ManagedServiceDetail({
  id,
  routeProjectId,
}: {
  id: string;
  routeProjectId: string | null;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [service, setService] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ManagedServiceTabId>('overview');
  const [connections, setConnections] = useState<ConnectedProject[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const loadService = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setService(await managedServices.get(id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load service');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setConnectionsError(null);
    try {
      setConnections(await managedServices.connectedProjects(id));
    } catch (e: unknown) {
      setConnections([]);
      setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections');
    } finally {
      setConnectionsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextService = await managedServices.get(id);
        if (!cancelled) setService(nextService);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load service');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setConnectionsLoading(true);
      setConnectionsError(null);
      try {
        const nextConnections = await managedServices.connectedProjects(id);
        if (!cancelled) setConnections(nextConnections);
      } catch (e: unknown) {
        if (!cancelled) {
          setConnections([]);
          setConnectionsError(e instanceof Error ? e.message : 'Failed to load connections');
        }
      } finally {
        if (!cancelled) setConnectionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const owningProjectId = service
    ? getInfrastructureProjectId(service, connections, routeProjectId)
    : routeProjectId;
  const backTarget = owningProjectId ? `/projects/${owningProjectId}` : '/projects';
  const backLabel = owningProjectId
    ? t('services.managedDetail.backToProject')
    : t('services.managedDetail.backToProjects');
  const canonicalPath =
    service != null && owningProjectId != null
      ? `/projects/${owningProjectId}/infrastructure/${service.id}`
      : null;

  useEffect(() => {
    if (
      !canonicalPath ||
      location.pathname === canonicalPath ||
      (!location.pathname.startsWith('/managed-services/') &&
        !location.pathname.includes('/infrastructure/'))
    ) {
      return;
    }
    navigate(canonicalPath, { replace: true });
  }, [canonicalPath, location.pathname, navigate]);

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
    const title = isNotFound
      ? t('services.managedDetail.notFound')
      : t('services.managedDetail.loadFailed');
    const subtitle = error ?? t('services.managedDetail.notFoundSubtitle', { id });
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard title={title} subtitle={subtitle}>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            {t('services.managedDetail.backToProjects')}
          </button>
        </OuterCard>
      </div>
    );
  }

  const tabs: TabDef<ManagedServiceTabId>[] = [
    { id: 'overview', label: t('services.managedDetail.tabs.overview'), icon: Info },
    { id: 'logs', label: t('services.managedDetail.tabs.logs'), icon: ScrollText },
    {
      id: 'connections',
      label: t('services.managedDetail.tabs.connections'),
      icon: Box,
      count: connections.length || undefined,
    },
    { id: 'settings', label: t('services.managedDetail.tabs.settings'), icon: SettingsIcon },
  ];

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
        subtitle={
          <span className="text-[12px]">
            <span className="text-[color:var(--ol-fg-subtle)]">
              {t('vocab.infrastructureService')}
            </span>
            <span className="ol-mono">
              {' · '}
              {service.kind ?? service.type} · {service.image}
            </span>
          </span>
        }
        actions={
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            className="text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
          >
            {backLabel}
          </button>
        }
        bodyClassName="p-0"
      >
        <ProjectTabs
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
          idPrefix="managed-service"
          ariaLabel={t('services.managedDetail.tabs.aria')}
        />

        <TabPanel
          active={activeTab === 'overview'}
          panelId="managed-servicepanel-overview"
          labelledBy="managed-service-overview"
          className="p-5"
        >
          <ManagedOverviewTab service={service} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'logs'}
          panelId="managed-servicepanel-logs"
          labelledBy="managed-service-logs"
          className="p-0"
        >
          <ManagedLogsTab serviceId={service.id} />
        </TabPanel>

        <TabPanel
          active={activeTab === 'connections'}
          panelId="managed-servicepanel-connections"
          labelledBy="managed-service-connections"
          className="p-5"
        >
          <ManagedConnectionsTab
            connections={connections}
            loading={connectionsLoading}
            error={connectionsError}
            onRefresh={() => void loadConnections()}
          />
        </TabPanel>

        <TabPanel
          active={activeTab === 'settings'}
          panelId="managed-servicepanel-settings"
          labelledBy="managed-service-settings"
          className="p-5"
        >
          <ManagedSettingsTab
            service={service}
            connections={connections}
            connectionsLoading={connectionsLoading}
            connectionsError={connectionsError}
            onServiceChanged={() => void loadService()}
            onConnectionsChanged={() => void loadConnections()}
            onDeleted={() => navigate(backTarget)}
          />
        </TabPanel>
      </OuterCard>
    </div>
  );
}

function getInfrastructureProjectId(
  service: Service,
  connections: ConnectedProject[],
  routeProjectId: string | null,
): string | null {
  if (service.project_id && service.project_id !== '__orphan_managed') return service.project_id;
  if (service.attached_project_id && service.attached_project_id !== '__orphan_managed') {
    return service.attached_project_id;
  }
  if (routeProjectId) return routeProjectId;
  return connections[0]?.id ?? null;
}

function ManagedOverviewTab({ service }: { service: Service }) {
  const { t } = useLanguage();
  const kind = service.kind ?? service.type ?? '—';
  const image = service.image || '—';
  const port = getManagedServicePortLabel(service);
  const status =
    service.status === 'running'
      ? t('services.status.running')
      : service.status === 'error'
        ? t('services.status.error')
        : t('services.status.stopped');
  const sourceRows: [string, string][] = [
    [t('services.managedDetail.field.type'), kind],
    [t('services.managedDetail.field.image'), image],
    [t('services.managedDetail.field.port'), port],
  ];
  const runtimeRows: [string, string][] = [
    [t('services.managedDetail.field.status'), status],
    [t('services.managedDetail.field.container'), service.container_name || '—'],
    [
      t('services.managedDetail.field.containerId'),
      service.container_id ? service.container_id.slice(0, 12) : '—',
    ],
    [t('services.managedDetail.field.created'), new Date(service.created_at).toLocaleString()],
    [t('services.managedDetail.field.updated'), new Date(service.updated_at).toLocaleString()],
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <SubCard title={t('services.detail.section.source')}>
        <KvList rows={sourceRows} valueClassName="ol-mono break-all text-[12px]" />
      </SubCard>
      <SubCard
        title={t('services.detail.section.runtime')}
        badge={<ManagedHealthBadge status={service.status} />}
      >
        <KvList rows={runtimeRows} valueClassName="ol-mono break-all text-[12px]" />
      </SubCard>
    </div>
  );
}

function getManagedServicePortLabel(service: Pick<Service, 'credentials' | 'port'>): string {
  const port = service.port ?? getManagedServiceCredentialsPort(service.credentials);
  return port == null ? '—' : String(port);
}

function getManagedServiceCredentialsPort(credentials: string | null): number | null {
  if (!credentials) return null;
  try {
    const parsed: unknown = JSON.parse(credentials);
    if (!parsed || typeof parsed !== 'object' || !('port' in parsed)) return null;
    const port = (parsed as { port?: unknown }).port;
    return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function ManagedLogsTab({ serviceId }: { serviceId: string }) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLogs(await managedServices.logs(serviceId, 300));
    } catch (e: unknown) {
      setLogs('');
      setError(e instanceof Error ? e.message : t('services.managedDetail.logs.error'));
    } finally {
      setLoading(false);
    }
  }, [serviceId, t]);

  useEffect(() => {
    void (async () => {
      await loadLogs();
    })();
  }, [loadLogs]);

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ol-border-subtle)] px-5 py-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--ol-fg)]">
            {t('services.managedDetail.logs.title')}
          </h3>
          <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('services.managedDetail.logs.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLogs()}
          disabled={loading}
          className="shrink-0 rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
        >
          {loading
            ? t('services.managedDetail.logs.loading')
            : t('services.managedDetail.logs.refresh')}
        </button>
      </div>
      {error ? (
        <div className="m-5 rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_6%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
          {error}
        </div>
      ) : (
        <pre className="ol-mono min-h-[360px] flex-1 overflow-auto whitespace-pre-wrap bg-[color:var(--ol-bg)] p-5 text-[12px] leading-relaxed text-[color:var(--ol-fg-muted)]">
          {logs.trim().length > 0
            ? logs
            : loading
              ? t('services.managedDetail.logs.loading')
              : t('services.managedDetail.logs.empty')}
        </pre>
      )}
    </div>
  );
}

function ManagedConnectionsTab({
  connections,
  loading,
  error,
  onRefresh,
}: {
  connections: ConnectedProject[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--ol-fg)]">
            {t('services.managedDetail.connections.title')}
          </h3>
          <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('services.managedDetail.connections.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
        >
          {loading
            ? t('services.managedDetail.connections.loading')
            : t('services.managedDetail.connections.refresh')}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_6%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
          {error}
        </div>
      )}

      {!loading && !error && connections.length === 0 && (
        <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-4 text-[12.5px] text-[color:var(--ol-fg-muted)]">
          {t('services.managedDetail.connections.empty')}
        </div>
      )}

      {connections.length > 0 && (
        <ul className="divide-y divide-[color:var(--ol-border-subtle)] rounded-md border border-[color:var(--ol-border-subtle)]">
          {connections.map((project) => (
            <li key={project.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-[color:var(--ol-fg)]">
                  {project.name}
                </span>
                <span className="ol-mono block truncate text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                  {project.id}
                </span>
              </span>
              <button
                type="button"
                onClick={() => navigate(`/projects/${project.id}`)}
                className="shrink-0 rounded-md border border-[color:var(--ol-border)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
              >
                {t('services.managedDetail.connections.openProject')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ManagedSettingsTab({
  service,
  connections,
  connectionsLoading,
  connectionsError,
  onServiceChanged,
  onConnectionsChanged,
  onDeleted,
}: {
  service: Service;
  connections: ConnectedProject[];
  connectionsLoading: boolean;
  connectionsError: string | null;
  onServiceChanged: () => void;
  onConnectionsChanged: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'delete' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const hasConnections = connections.length > 0;
  const deleteBlocked = hasConnections || connectionsLoading || connectionsError !== null;

  const runLifecycle = async (action: 'start' | 'stop') => {
    setBusyAction(action);
    setFeedback(null);
    try {
      if (action === 'start') {
        await managedServices.start(service.id);
      } else {
        await managedServices.stop(service.id);
      }
      onServiceChanged();
      setFeedback(t('services.managedDetail.settings.updated'));
    } catch (e: unknown) {
      setFeedback(
        e instanceof Error ? e.message : t('services.managedDetail.settings.actionError'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  const submitDelete = async () => {
    if (deleteConfirmation.trim() !== service.name || deleteBlocked) return;
    setBusyAction('delete');
    setFeedback(null);
    try {
      await managedServices.remove(service.id);
      onDeleted();
    } catch (e: unknown) {
      onConnectionsChanged();
      setFeedback(
        e instanceof Error ? e.message : t('services.managedDetail.settings.deleteError'),
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--ol-fg)]">
            {t('services.managedDetail.settings.lifecycle')}
          </h3>
          <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('services.managedDetail.settings.lifecycleDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runLifecycle('start')}
            disabled={busyAction !== null || service.status === 'running'}
            className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'start'
              ? t('services.managedDetail.settings.starting')
              : t('services.managedDetail.settings.start')}
          </button>
          <button
            type="button"
            onClick={() => void runLifecycle('stop')}
            disabled={busyAction !== null || service.status === 'stopped'}
            className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'stop'
              ? t('services.managedDetail.settings.stopping')
              : t('services.managedDetail.settings.stop')}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-[color:var(--ol-border-subtle)] pt-5">
        <div>
          <h3 className="text-[13px] font-semibold text-[color:var(--ol-error)]">
            {t('services.managedDetail.settings.danger')}
          </h3>
          <p className="text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('services.managedDetail.settings.dangerDescription')}
          </p>
        </div>

        {hasConnections && (
          <div className="rounded-md border border-[color:var(--ol-warning)] bg-[color:var(--ol-warning-soft)] px-3 py-2 text-[12px] text-[color:var(--ol-warning)]">
            {t('services.managedDetail.settings.deleteBlocked', {
              count: String(connections.length),
            })}
          </div>
        )}
        {connectionsError && (
          <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_6%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
            {t('services.managedDetail.settings.connectionCheckFailed')} {connectionsError}
          </div>
        )}

        <button
          type="button"
          onClick={() => setDeleteOpen((open) => !open)}
          disabled={deleteBlocked || busyAction !== null}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-[color:var(--ol-error)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ol-error)] transition-colors hover:bg-[color-mix(in_oklch,var(--ol-error)_6%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('services.managedDetail.settings.delete')}
        </button>

        {deleteOpen && (
          <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_5%,transparent)] p-4">
            <label className="text-[12px] font-medium text-[color:var(--ol-fg-muted)]">
              {t('services.managedDetail.settings.confirmLabel')}
              <span className="ol-mono ml-1 text-[color:var(--ol-fg)]">{service.name}</span>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="ol-mono mt-1 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)] outline-none transition-colors focus:border-[color:var(--ol-error)]"
                placeholder={service.name}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setDeleteConfirmation('');
                }}
                disabled={busyAction === 'delete'}
                className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
              >
                {t('projectDetail.env.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void submitDelete()}
                disabled={
                  busyAction === 'delete' ||
                  deleteBlocked ||
                  deleteConfirmation.trim() !== service.name
                }
                className="rounded-md bg-[color:var(--ol-error)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyAction === 'delete'
                  ? t('services.managedDetail.settings.deleting')
                  : t('services.managedDetail.settings.confirmDelete')}
              </button>
            </div>
          </div>
        )}
      </section>

      {feedback && (
        <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12px] text-[color:var(--ol-fg-muted)]">
          {feedback}
        </div>
      )}
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
