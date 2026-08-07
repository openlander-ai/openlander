/**
 * Web Server settings and routing observability.
 *
 * Combines protected-share setup with the existing route, port, and external
 * container read models.
 *
 * Layout (top → bottom):
 *
 *   1. Health summary stat strip — Proxy · Routes (+ issues) · Entrypoints
 *   2. Protected share settings and optional Cloudflare connection
 *   3. Configuration warning — only when runtime URL settings need attention
 *   4. Issue banner — only when any route reports an issue
 *   5. Routes table — always expanded; issue rows marked with red bar
 *   6. Port allocation — collapsible, closed by default
 *   7. External containers — collapsible, closed by default; disabled empty
 *
 * v0.1 cuts (per spec): the request-rate stat cell and the matching
 * per-route metric column. Both restore in v0.2 when Traefik metrics
 * scraping lands. The page renders only what the backend can honestly
 * answer.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Server } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { useLanguage } from '@/i18n/context';
import {
  getWebServerExternalContainers,
  getWebServerPorts,
  getWebServerRoutes,
  getWebServerSummary,
  type ExternalContainer,
  type PortAllocation,
  type ProxyStatusCode,
  type ProxyType,
  type WebServerConfigurationIssue,
  type WebRouteIssue,
  type WebRouteStatus,
  type WebRouteTlsStatus,
  type WebServerExternalContainersResponse,
  type WebServerPortsResponse,
  type WebServerRoutesResponse,
  type WebServerSummary,
} from '@/lib/api/web-server';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ConnectedPublishCard } from '@/components/settings/ConnectedPublishCard';
import { ProtectedShareSettingsCard } from '@/components/settings/ProtectedShareSettingsCard';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T>(fn: () => Promise<T>): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: true, error: null });
  const reload = useCallback(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    void fn()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            // The detail is not rendered; keep only an internal sentinel so
            // backend prose can never leak if this state is reused later.
            error: 'request_failed',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fn]);
  useEffect(() => reload(), [reload]);
  return { ...state, reload };
}

/**
 * Translate a route issue by its stable code. Unknown server prose remains
 * available in the response for diagnostics, but does not leak into the UI.
 */
function translateIssue(issue: WebRouteIssue, t: Translate): string {
  const key = `webServer.issues.codes.${issue.code}`;
  const localized = t(key);
  return localized === key ? t('webServer.issues.unknown') : localized;
}

function translateConfigurationIssue(issue: WebServerConfigurationIssue, t: Translate): string {
  const key = `webServer.configuration.codes.${issue.code}`;
  const localized = t(key);
  return localized === key ? t('webServer.configuration.unknown') : localized;
}

// Wrap lib's formatRelativeTime to preserve the '—' fallback that this
// page used for null / unparseable timestamps (the lib returns '' instead
// since most callers prefer hiding the slot).
function formatRelative(iso: string | null, t: Translate): string {
  if (!iso) return '—';
  const out = formatRelativeTime(iso, t);
  return out === '' ? '—' : out;
}

export function WebServerSettings() {
  const { t } = useLanguage();
  const summary = useFetch(getWebServerSummary);
  const routes = useFetch(getWebServerRoutes);
  const ports = useFetch(getWebServerPorts);
  const external = useFetch(getWebServerExternalContainers);

  const [showPorts, setShowPorts] = useState(false);
  const [showExternal, setShowExternal] = useState(false);

  const issueRows = (routes.data?.routes ?? []).filter(
    (route) => route.issues.length > 0 || route.status === 'error',
  );
  const configurationIssues = summary.data?.configuration?.issues ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* 1. Health summary stat strip */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('webServer.title')}
          </span>
        }
        subtitle={t('webServer.subtitle')}
      >
        <div className="grid grid-cols-1 divide-y divide-[color:var(--ol-border-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <StripCell
            label={t('webServer.strip.proxy')}
            valueSlot={<ProxyPip summary={summary} t={t} />}
            metaSlot={
              summary.data?.proxy.container ? (
                <span className="ol-mono break-all">{summary.data.proxy.container}</span>
              ) : null
            }
          />
          <StripCell
            label={t('webServer.strip.routes')}
            valueSlot={
              summary.loading ? (
                <span className="ol-mono text-[18px] font-semibold text-[color:var(--ol-fg-muted)]">
                  …
                </span>
              ) : summary.error || !summary.data ? (
                <span className="ol-mono text-[18px] font-semibold text-[color:var(--ol-fg-subtle)]">
                  —
                </span>
              ) : (
                <span className="ol-mono text-[18px] font-semibold text-[color:var(--ol-fg)]">
                  {summary.data.routes.total}
                </span>
              )
            }
            metaSlot={
              summary.loading ? null : summary.error || !summary.data ? (
                <span className="text-[color:var(--ol-fg-muted)]">
                  {t('webServer.strip.unknown')}
                </span>
              ) : summary.data.routes.issues === 0 ? (
                <Pip kind="ok">{t('webServer.strip.allHealthy')}</Pip>
              ) : (
                <span className="text-[color:var(--ol-warning)]">
                  {t('webServer.strip.issuesCount', { count: summary.data.routes.issues })}
                </span>
              )
            }
          />
          <StripCell
            label={t('webServer.strip.entrypoints')}
            valueSlot={
              summary.loading ? (
                <span className="ol-mono text-[14px] text-[color:var(--ol-fg-muted)]">…</span>
              ) : (
                <span className="ol-mono text-[14px] text-[color:var(--ol-fg)]">
                  {(summary.data?.entrypoints ?? [])
                    .map((ep) => `:${String(ep.port)}`)
                    .join(', ') || '—'}
                </span>
              )
            }
            metaSlot={
              // Hide the meta line entirely when the backend has no reload
              // event source. Rendering "Reloaded —" was awkward (CCG round 1).
              summary.data?.lastReloadAt ? (
                <span className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
                  {t('webServer.strip.lastReload', {
                    when: formatRelative(summary.data.lastReloadAt, t),
                  })}
                </span>
              ) : null
            }
          />
        </div>
        {summary.data?.dockerUnavailable && (
          <p className="mt-3 text-[11.5px] text-[color:var(--ol-warning)]">
            {t('webServer.dockerUnavailable')}
          </p>
        )}
      </OuterCard>

      {configurationIssues.length > 0 && (
        <div
          data-testid="web-server-config-issue-banner"
          className="flex items-start gap-3 rounded-lg border border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning-soft,rgba(255,176,0,0.08))] px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ol-warning)]" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[12.5px] font-semibold text-foreground">
              {t('webServer.configuration.title')}
            </p>
            <ul className="flex flex-col gap-0.5 text-[12px] text-foreground/80">
              {configurationIssues.map((issue) => (
                <li key={issue.code}>{translateConfigurationIssue(issue, t)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ProtectedShareSettingsCard />

      <ConnectedPublishCard />

      {/* 2. Issue banner — only when there are issues */}
      {issueRows.length > 0 && (
        <div
          data-testid="web-server-issue-banner"
          className="flex items-start gap-3 rounded-lg border border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning-soft,rgba(255,176,0,0.08))] px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ol-warning)]" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[12.5px] font-semibold text-foreground">
              {t('webServer.issues.title', { count: issueRows.length })}
            </p>
            <ul className="flex flex-col gap-0.5 text-[12px] text-foreground/80">
              {issueRows.flatMap((route) =>
                route.issues.map((issue, i) => (
                  <li key={`${route.id}-${String(i)}`}>
                    <code className="ol-mono">{route.host}</code> — {translateIssue(issue, t)}
                  </li>
                )),
              )}
              {issueRows
                .filter((route) => route.issues.length === 0)
                .map((route) => (
                  <li key={`${route.id}-status`}>
                    <code className="ol-mono">{route.host}</code> —{' '}
                    {t(`webServer.status.${route.status}`)}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* 3. Routes — always expanded */}
      <OuterCard
        title={t('webServer.routes.title')}
        subtitle={t('webServer.routes.subtitle')}
        bodyClassName="p-0"
      >
        <RoutesTable state={routes} t={t} />
      </OuterCard>

      {/* 4. Port allocation — collapsible */}
      <CollapsibleCard
        title={t('webServer.ports.title')}
        summary={t('webServer.ports.summary', {
          count: ports.data?.summary.total ?? 0,
        })}
        open={showPorts}
        onToggle={() => setShowPorts((v) => !v)}
        loading={ports.loading}
      >
        <PortsTable state={ports} t={t} />
      </CollapsibleCard>

      {/* 5. External containers — collapsible, disabled only after a
          successful fetch with zero containers. During loading or when
          the fetch errored, the card stays interactive so the user can
          open it and see the error/loading state. */}
      <CollapsibleCard
        title={t('webServer.external.title')}
        summary={
          external.loading
            ? t('webServer.external.loading')
            : external.error
              ? t('webServer.external.loadFailed')
              : (external.data?.count ?? 0) === 0
                ? t('webServer.external.empty')
                : t('webServer.external.summary', { count: external.data?.count ?? 0 })
        }
        open={showExternal}
        onToggle={() => setShowExternal((v) => !v)}
        disabled={!external.loading && !external.error && (external.data?.count ?? 0) === 0}
        loading={external.loading}
      >
        <ExternalContainersTable state={external} t={t} />
      </CollapsibleCard>

      {/* 7. Footer */}
      <p className="mt-1 text-[11.5px] text-[color:var(--ol-fg-muted)]">{t('webServer.footer')}</p>
    </div>
  );
}

interface StripCellProps {
  label: string;
  valueSlot: ReactNode;
  metaSlot?: ReactNode;
}

function StripCell({ label, valueSlot, metaSlot }: StripCellProps) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 first:pl-0 last:pr-0 sm:px-5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
        {label}
      </div>
      <div className="min-h-[24px]">{valueSlot}</div>
      {metaSlot && <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">{metaSlot}</div>}
    </div>
  );
}

// Brand-correct casing for proxy type labels. The backend ships
// lowercase enum values (`traefik`, `nginx`, `caddy`, `haproxy`),
// but the UI should respect the vendors' own marks (NGINX, HAProxy
// uppercase) rather than naive Title Case (Codex/Gemini CCG round-1).
const PROXY_BRAND_LABEL: Record<ProxyType, string> = {
  traefik: 'Traefik',
  nginx: 'NGINX',
  caddy: 'Caddy',
  haproxy: 'HAProxy',
  // `none` reaches `unsupported_proxy` only on malformed payloads (no
  // detection result); render a generic placeholder rather than the
  // raw enum.
  none: 'None',
};

export function formatProxyBrandLabel(type: ProxyType): string {
  return PROXY_BRAND_LABEL[type] ?? type;
}

/**
 * Build the trailing version label for the proxy Pip.
 *
 * The backend's `extractVersion()` (src/pipeline/traefik.ts:513-519)
 * returns the raw image tag verbatim — for `traefik:v3.3` it yields
 * `'v3.3'` (with `v` prefix); for `traefik:3.3` it yields `'3.3'`.
 * Without normalizing, the ` v${version}` template would render
 * `Traefik vv3.3` (Codex CCG round-1 P1). Strip a single leading
 * `v` (case-insensitive) so the label is consistent across image
 * tag conventions and matches how the backend's own `getProxyStatus()`
 * line in `traefik.ts:655` handles it.
 */
export function formatProxyVersionLabel(version: string | null): string {
  if (!version) return '';
  const stripped = version.replace(/^v/i, '');
  return ` v${stripped}`;
}

function ProxyPip({ summary, t }: { summary: FetchState<WebServerSummary>; t: Translate }) {
  if (summary.loading) {
    return <Pip kind="muted">{t('webServer.proxy.checking')}</Pip>;
  }
  if (summary.error || !summary.data) {
    return <Pip kind="muted">{t('webServer.proxy.unknown')}</Pip>;
  }
  const proxy = summary.data.proxy;

  // Older backends omit the structured code, but still provide enough
  // locale-neutral fields to derive the same display state. Never surface
  // their free-form English `proxy.status` in the selected UI locale.
  const legacyCode = (): ProxyStatusCode => {
    if (summary.data?.dockerUnavailable) return 'docker_unavailable';
    if (proxy.type === 'none') {
      return proxy.mode === 'managed' ? 'no_proxy_managed' : 'no_proxy_external';
    }
    if (proxy.type === 'traefik') {
      if (proxy.traefikDockerProvider === false) return 'traefik_provider_disabled';
      return proxy.mode === 'managed' ? 'traefik_managed' : 'traefik_external';
    }
    return 'unsupported_proxy';
  };
  const code = proxy.statusCode ?? legacyCode();
  const label = t(`webServer.proxy.statusCode.${code}`, {
    versionLabel: formatProxyVersionLabel(proxy.version),
    type: formatProxyBrandLabel(proxy.type),
  });
  const kind: PipKind =
    proxy.statusSeverity === 'error' || code === 'docker_unavailable'
      ? 'danger'
      : proxy.statusSeverity === 'ok' || code === 'traefik_managed' || code === 'traefik_external'
        ? 'ok'
        : 'warning';
  return <Pip kind={kind}>{label}</Pip>;
}

type PipKind = 'ok' | 'warning' | 'danger' | 'muted';

function Pip({ kind, children }: { kind: PipKind; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12.5px] font-medium',
        kind === 'ok' && 'text-[color:var(--ol-success)]',
        kind === 'warning' && 'text-[color:var(--ol-warning)]',
        kind === 'danger' && 'text-[color:var(--ol-error)]',
        kind === 'muted' && 'text-[color:var(--ol-fg-muted)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          kind === 'ok' &&
            'bg-[color:var(--ol-success)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--ol-success)_30%,transparent)]',
          kind === 'warning' && 'bg-[color:var(--ol-warning)]',
          kind === 'danger' && 'bg-[color:var(--ol-error)]',
          kind === 'muted' && 'bg-[color:var(--ol-fg-subtle)]',
        )}
      />
      {children}
    </span>
  );
}

function RoutesTable({ state, t }: { state: FetchState<WebServerRoutesResponse>; t: Translate }) {
  if (state.loading) {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.routes.loading')}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] text-[color:var(--ol-error)]">
        {t('webServer.routes.loadFailed')}
      </div>
    );
  }
  const list = state.data?.routes ?? [];
  if (list.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.routes.empty')}
      </div>
    );
  }
  return (
    // overflow-x-auto so the 5-column table stays usable on narrow
    // viewports (Codex CCG: mobile breakage on iPhone-width screens).
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-[color:var(--ol-border-subtle)] text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
          <tr>
            <th className="px-4 py-2 font-semibold">{t('webServer.routes.col.host')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.routes.col.service')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.routes.col.port')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.routes.col.tls')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.routes.col.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--ol-border-subtle)]">
          {list.map((route) => {
            const issue = route.issues.length > 0 || route.status === 'error';
            const displayPort = route.targetPort ?? route.containerPort ?? route.port;
            return (
              <tr
                key={route.id}
                data-testid={issue ? 'web-server-route-issue-row' : undefined}
                className={cn(issue && 'bg-[color:var(--ol-error-soft,rgba(239,68,68,0.04))]')}
              >
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    {issue && (
                      <span
                        aria-hidden
                        className="inline-block h-3 w-0.5 rounded-sm bg-[color:var(--ol-error)]"
                      />
                    )}
                    <code className="ol-mono">{route.host}</code>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[color:var(--ol-fg-muted)]">
                  <span className="ol-mono">
                    {route.projectName}/{route.serviceName}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[color:var(--ol-fg-muted)]">
                  <span className="ol-mono">
                    {displayPort != null ? `:${String(displayPort)}` : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <TlsPip status={route.tls.status} enabled={route.tls.enabled} t={t} />
                </td>
                <td className="px-4 py-2.5">
                  <RouteStatusPip status={route.status} t={t} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TlsPip({
  status,
  enabled,
  t,
}: {
  status: WebRouteTlsStatus;
  enabled: boolean;
  t: Translate;
}) {
  if (!enabled || status === 'absent') {
    return <span className="text-[12px] text-[color:var(--ol-fg-subtle)]">—</span>;
  }
  const kind: PipKind =
    status === 'ok'
      ? 'ok'
      : status === 'expiring'
        ? 'warning'
        : status === 'invalid'
          ? 'danger'
          : 'muted';
  return <Pip kind={kind}>{t(`webServer.tls.${status}`)}</Pip>;
}

function RouteStatusPip({ status, t }: { status: WebRouteStatus; t: Translate }) {
  const kind: PipKind =
    status === 'healthy'
      ? 'ok'
      : status === 'warning'
        ? 'warning'
        : status === 'error'
          ? 'danger'
          : 'muted';
  return <Pip kind={kind}>{t(`webServer.status.${status}`)}</Pip>;
}

function PortsTable({ state, t }: { state: FetchState<WebServerPortsResponse>; t: Translate }) {
  if (state.loading) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.ports.loading')}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-error)]">
        {t('webServer.ports.loadFailed')}
      </div>
    );
  }
  const list: PortAllocation[] = state.data?.allocations ?? [];
  if (list.length === 0) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.ports.empty')}
      </div>
    );
  }
  return (
    // Backend `PortAllocation` only carries the public/host port (no
    // private container port), so the table renders Service · Host port ·
    // Environment. Adding a faked "Container port" column would have
    // duplicated the host port — Codex CCG round 1 caught the regression.
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead className="border-b border-[color:var(--ol-border-subtle)] text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
          <tr>
            <th className="px-4 py-2 font-semibold">{t('webServer.ports.col.service')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.ports.col.hostPort')}</th>
            <th className="px-4 py-2 font-semibold">{t('webServer.ports.col.environment')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--ol-border-subtle)]">
          {list.map((alloc) => (
            <tr key={`${String(alloc.port)}-${alloc.containerId ?? ''}`}>
              <td className="px-4 py-2 text-[color:var(--ol-fg)]">
                {alloc.serviceName ? (
                  <span className="ol-mono">
                    {alloc.projectName ? `${alloc.projectName}/` : ''}
                    {alloc.serviceName}
                  </span>
                ) : (
                  <span className="text-[color:var(--ol-fg-subtle)]">
                    {alloc.containerName ?? t('webServer.ports.unmanaged')}
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-[color:var(--ol-fg)]">
                <span className="ol-mono">:{String(alloc.port)}</span>
              </td>
              <td className="px-4 py-2 text-[color:var(--ol-fg-muted)]">
                {t(`webServer.ports.env.${alloc.environment}`)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExternalContainersTable({
  state,
  t,
}: {
  state: FetchState<WebServerExternalContainersResponse>;
  t: Translate;
}) {
  if (state.loading) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.external.loading')}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-error)]">
        {t('webServer.external.loadFailed')}
      </div>
    );
  }
  const list: ExternalContainer[] = state.data?.containers ?? [];
  if (list.length === 0) {
    return (
      <div className="px-4 py-4 text-center text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('webServer.external.empty')}
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-[color:var(--ol-border-subtle)]">
      {list.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <code className="ol-mono truncate text-[12.5px] text-[color:var(--ol-fg)]">
              {c.name}
            </code>
            <span className="ol-mono truncate text-[11px] text-[color:var(--ol-fg-subtle)]">
              {c.image}
            </span>
          </div>
          <span className="ol-mono shrink-0 text-[12px] text-[color:var(--ol-fg-muted)]">
            {c.ports.length === 0 ? '—' : c.ports.map((p) => `:${String(p)}`).join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface CollapsibleCardProps {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: ReactNode;
}

function CollapsibleCard({
  title,
  summary,
  open,
  onToggle,
  disabled,
  loading,
  children,
}: CollapsibleCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-[color:var(--ol-panel)]',
        disabled
          ? 'border-[color:var(--ol-border-subtle)] opacity-60'
          : 'border-[color:var(--ol-border-subtle)]',
      )}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
          !disabled && 'hover:bg-[color:var(--ol-panel-2)]',
          disabled && 'cursor-default',
        )}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-[color:var(--ol-fg)]">{title}</span>
          <span className="text-[11.5px] text-[color:var(--ol-fg-muted)]">{summary}</span>
        </div>
        {loading ? (
          <span className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">…</span>
        ) : open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
        )}
      </button>
      {open && !disabled && (
        <div className="border-t border-[color:var(--ol-border-subtle)]">{children}</div>
      )}
    </div>
  );
}

export default WebServerSettings;
