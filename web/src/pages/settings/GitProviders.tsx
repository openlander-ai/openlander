/**
 * Git Providers — v0.1 settings surface.
 *
 * Implements the v0.1 Git Providers surface
 * against the `GET /api/git-providers/github` aggregator. Layout
 * (top → bottom):
 *
 *   1. GitHub identity card
 *      - octocat mark + `@login` + status pip + auth-method badge
 *      - action row: Manage on GitHub + ⋯ menu (Re-authorize / Check connection / Disconnect)
 *      - stat block: Repos linked / Last sync / Connected on / OAuth scope chips
 *   2. Empty-state card (only when no token configured)
 *      - single CTA "Connect GitHub" opening the inline connection flow
 *   3. Other providers — compressed rows for GitLab / Bitbucket marked Later
 *
 * v0.1 honest gaps:
 *   - `connectedAt` / `lastSyncAt` come from lightweight backend config
 *     persistence (PR #236). Tiles render "—" only on the brief window
 *     between connect and the first successful validateToken sync, not
 *     as a permanent placeholder.
 *   - `Check connection` re-fetches the live status aggregator; no repository
 *     cache or sync operation is implied.
 *
 * Connect / Disconnect / Re-authorize use the existing `/api/setup/github*`
 * endpoints. Connect and re-authorize render inline on this canonical route;
 * re-authorize replaces the credential only after validation succeeds.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, ExternalLink, Github, MoreHorizontal, RefreshCw } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { GithubSettingsTab } from '@/components/settings/GithubSettingsTab';
import { useLanguage } from '@/i18n/context';
import { useSetup } from '@/hooks/use-setup';
import {
  getGitHubProviderStatus,
  type GitHubProviderStatus,
  type GitHubValidationReason,
} from '@/lib/api/git-providers';
import { disconnectGithub } from '@/lib/api/system';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { localizeApiError } from '@/lib/localized-api-error';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface FetchState {
  data: GitHubProviderStatus | null;
  loading: boolean;
  error: string | null;
}

function useGitHubStatus(t: Translate) {
  const [state, setState] = useState<FetchState>({ data: null, loading: true, error: null });
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Manual reload() (refresh / retry / post-disconnect) must be race-safe:
  // tag every request and ignore stale resolutions. Codex CCG round 1 P2
  // caught the case where the original `cancelled` flag only protected
  // the initial effect and not subsequent reloads.
  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await getGitHubProviderStatus();
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setState({ data, loading: false, error: null });
    } catch (err) {
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setState({
        data: null,
        loading: false,
        error: localizeApiError(err, t, 'gitProviders.github.loadFailed', 'common.apiError.codes'),
      });
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...state, reload };
}

type PipKind = 'connected' | 'invalid' | 'unknown' | 'disconnected';

function pipKindFor(data: GitHubProviderStatus | null): PipKind {
  if (!data || !data.connected) return 'disconnected';
  if (data.tokenValid === true) return 'connected';
  if (data.tokenValid === false) return 'invalid';
  return 'unknown';
}

function pipColorClass(kind: PipKind): string {
  switch (kind) {
    case 'connected':
      return 'bg-[color:var(--ol-success)]';
    case 'invalid':
      return 'bg-[color:var(--ol-error)]';
    case 'unknown':
      return 'bg-[color:var(--ol-warn)]';
    case 'disconnected':
      return 'bg-[color:var(--ol-fg-subtle)]';
  }
}

function authMethodLabel(method: GitHubProviderStatus['authMethod'], t: Translate): string {
  if (method === 'oauth') return t('gitProviders.github.authMethod.oauth');
  if (method === 'pat') return t('gitProviders.github.authMethod.pat');
  return t('gitProviders.github.authMethod.unknown');
}

function validationGuidance(
  reason: GitHubValidationReason | null,
  authMethod: GitHubProviderStatus['authMethod'],
  authorizeUrl: string | null,
): { messageKey: string; url: string } | null {
  const credentialSettingsUrl =
    authMethod === 'pat'
      ? 'https://github.com/settings/tokens'
      : 'https://github.com/settings/applications';
  switch (reason) {
    case 'token_invalid':
      return {
        messageKey: 'gitProviders.github.guidance.tokenInvalid',
        url: credentialSettingsUrl,
      };
    case 'sso_required':
      return {
        messageKey: 'gitProviders.github.guidance.ssoRequired',
        url: authorizeUrl ?? credentialSettingsUrl,
      };
    case 'rate_limited':
      return {
        messageKey: 'gitProviders.github.guidance.rateLimited',
        url: 'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api',
      };
    case 'permission_denied':
    case 'not_found_or_not_authorized':
      return {
        messageKey: 'gitProviders.github.guidance.repositoryAccess',
        url: credentialSettingsUrl,
      };
    case 'unreachable':
      return {
        messageKey: 'gitProviders.github.guidance.unreachable',
        url: 'https://www.githubstatus.com/',
      };
    case null:
      return null;
  }
}

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
      <span className="text-[11px] uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
        {label}
      </span>
      <span className="text-[13.5px] font-medium text-[color:var(--ol-fg)]">{value}</span>
      {hint != null && <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">{hint}</span>}
    </div>
  );
}

interface MoreActionsMenuProps {
  data: GitHubProviderStatus;
  onReauthorize: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  busy: boolean;
}

function MoreActionsMenu({
  data,
  onReauthorize,
  onRefresh,
  onDisconnect,
  busy,
}: MoreActionsMenuProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const close = () => setOpen(false);
  const tokenConfigured = data.connected;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('gitProviders.github.moreActionsLabel')}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--ol-border)]',
          'transition-colors hover:bg-[color:var(--ol-panel-2)]',
          open && 'bg-[color:var(--ol-panel-2)]',
        )}
      >
        <MoreHorizontal className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-30 mt-1 w-56',
            'rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] shadow-lg',
          )}
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              close();
              onReauthorize();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)] disabled:opacity-50"
          >
            <ExternalLink className="h-3.5 w-3.5 text-[color:var(--ol-fg-muted)]" />
            <span>{t('gitProviders.github.reauthorize')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              close();
              onRefresh();
            }}
            className="flex w-full items-center gap-2 border-t border-[color:var(--ol-border-subtle)] px-3 py-2 text-left text-[13px] text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)] disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[color:var(--ol-fg-muted)]" />
            <span>{t('gitProviders.github.refreshRepoList')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy || !tokenConfigured}
            onClick={() => {
              close();
              onDisconnect();
            }}
            className="flex w-full items-center gap-2 border-t border-[color:var(--ol-border-subtle)] px-3 py-2 text-left text-[13px] text-[color:var(--ol-error)] transition-colors hover:bg-[color:var(--ol-panel-2)] disabled:opacity-50"
          >
            <span>{t('gitProviders.github.disconnect')}</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface GitHubCardProps {
  data: GitHubProviderStatus;
  onReload: () => void;
  onReauthorize: () => void;
}

function GitHubCard({ data, onReload, onReauthorize }: GitHubCardProps) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const pip = pipKindFor(data);
  const guidance = validationGuidance(data.validationReason, data.authMethod, data.authorizeUrl);
  const handleManageOnGithub = () => {
    if (typeof window === 'undefined') return;
    const url =
      data.authMethod === 'pat'
        ? 'https://github.com/settings/tokens'
        : 'https://github.com/settings/applications';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleReauthorize = () => {
    setActionError(null);
    onReauthorize();
  };

  const handleRefresh = () => {
    setActionError(null);
    onReload();
  };

  const handleDisconnect = () => {
    setDisconnectConfirmOpen(true);
  };
  const confirmDisconnect = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await disconnectGithub();
      onReload();
    } catch (err) {
      setActionError(
        localizeApiError(err, t, 'gitProviders.github.disconnectFailed', 'common.apiError.codes'),
      );
    } finally {
      setBusy(false);
    }
  };

  // Backend may return reposLinked=null when the DB read fails. Render "—"
  // rather than fabricating a zero (Codex CCG round 1 P2).
  const reposLinkedDisplay = data.reposLinked === null ? '—' : String(data.reposLinked);
  // Last sync is the rolling validateToken heartbeat — relative time
  // ("3m ago") matches how the rest of the app surfaces freshness.
  // Connected on is a one-time milestone, so a full local datetime is
  // more honest than collapsing it to relative time.
  //
  // `formatRelativeTime` / `formatDateTime` return '' for unparseable
  // input (corrupt config), so the `|| '—'` fallback keeps the tile
  // from rendering blank in that edge case.
  const lastSyncRelative = data.lastSyncAt ? formatRelativeTime(data.lastSyncAt, t) : '';
  const lastSyncAbsolute = data.lastSyncAt ? formatDateTime(data.lastSyncAt) : '';
  const lastSyncDisplay: ReactNode = data.lastSyncAt ? (
    // Absolute datetime in the title tooltip so audit/debug doesn't
    // require waiting for the next refresh tick to read the precise
    // moment of the last sync.
    <span title={lastSyncAbsolute || undefined}>{lastSyncRelative || '—'}</span>
  ) : (
    '—'
  );
  const connectedOnDisplay = data.connectedAt ? formatDateTime(data.connectedAt) || '—' : '—';

  return (
    <>
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Github className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('gitProviders.github.cardTitle')}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleManageOnGithub}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-3 text-[12.5px] font-medium text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)]"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[color:var(--ol-fg-muted)]" />
              {t('gitProviders.github.manageOnGithub')}
            </button>
            <MoreActionsMenu
              data={data}
              onReauthorize={handleReauthorize}
              onRefresh={handleRefresh}
              onDisconnect={handleDisconnect}
              busy={busy}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-testid="github-pip"
              data-pip={pip}
              className={cn('inline-block h-2 w-2 shrink-0 rounded-full', pipColorClass(pip))}
            />
            <span className="ol-mono text-[13px] text-[color:var(--ol-fg)]">
              {data.login ? `@${data.login}` : '—'}
            </span>
            <span className="text-[12px] text-[color:var(--ol-fg-muted)]">
              {pip === 'connected' && t('gitProviders.github.pip.connected')}
              {pip === 'invalid' && t('gitProviders.github.pip.invalid')}
              {pip === 'unknown' && t('gitProviders.github.pip.unknown')}
              {pip === 'disconnected' && t('gitProviders.github.pip.disconnected')}
            </span>
            <span className="rounded-full border border-[color:var(--ol-border-subtle)] px-2 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)]">
              {authMethodLabel(data.authMethod, t)}
            </span>
          </div>

          {pip === 'invalid' && data.validationError && (
            <div
              data-testid="github-validation-error"
              className="rounded-md border border-[color:var(--ol-error)] bg-[color:color-mix(in_oklch,var(--ol-error)_8%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)]"
            >
              {t('gitProviders.github.validationError')}
              {guidance && (
                <a
                  href={guidance.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline underline-offset-2"
                >
                  {t(guidance.messageKey)}
                </a>
              )}
            </div>
          )}
          {pip === 'unknown' && data.validationError && (
            <div
              data-testid="github-validation-unreachable"
              className="rounded-md border border-[color:var(--ol-warn)] bg-[color:color-mix(in_oklch,var(--ol-warn)_8%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)]"
            >
              {t('gitProviders.github.validationUnreachable')}
              {guidance && (
                <a
                  href={guidance.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline underline-offset-2"
                >
                  {t(guidance.messageKey)}
                </a>
              )}
            </div>
          )}
          {actionError && (
            <div className="rounded-md border border-[color:var(--ol-error)] bg-[color:color-mix(in_oklch,var(--ol-error)_8%,transparent)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)]">
              {actionError}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={t('gitProviders.github.stats.reposLinked')}
              value={reposLinkedDisplay}
            />
            <StatTile
              label={t('gitProviders.github.stats.lastSync')}
              value={lastSyncDisplay}
              hint={!data.lastSyncAt ? t('gitProviders.github.pendingFirstSync') : undefined}
            />
            <StatTile
              label={t('gitProviders.github.stats.connectedOn')}
              value={connectedOnDisplay}
              hint={!data.connectedAt ? t('gitProviders.github.pendingFirstSync') : undefined}
            />
            <StatTile
              label={t('gitProviders.github.stats.scopes')}
              value={
                data.scopes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {data.scopes.map((scope) => (
                      <span
                        key={scope}
                        data-testid="github-scope-chip"
                        className="ol-mono rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2 py-0.5 text-[11px] text-[color:var(--ol-fg)]"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[12px] text-[color:var(--ol-fg-muted)]">
                    {data.authMethod === 'pat'
                      ? t('gitProviders.github.scopesUnavailableForPat')
                      : t('gitProviders.github.scopesEmpty')}
                  </span>
                )
              }
            />
          </div>
        </div>
      </OuterCard>
      <ConfirmDialog
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
        title={t('gitProviders.github.disconnectConfirm.title')}
        description={t('gitProviders.github.disconnectConfirm.description')}
        confirmLabel={t('gitProviders.github.disconnectConfirm.confirmLabel')}
        variant="destructive"
        onConfirm={() => void confirmDisconnect()}
      />
    </>
  );
}

function GitHubEmptyCard({ onConnect }: { onConnect: () => void }) {
  const { t } = useLanguage();
  return (
    <OuterCard
      title={
        <span className="flex items-center gap-2">
          <Github className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
          {t('gitProviders.github.cardTitle')}
        </span>
      }
    >
      <div
        data-testid="github-empty-state"
        className="flex flex-col items-start gap-3 rounded-md border border-dashed border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-5"
      >
        <h3 className="text-[14px] font-semibold text-[color:var(--ol-fg)]">
          {t('gitProviders.github.empty.title')}
        </h3>
        <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
          {t('gitProviders.github.empty.body')}
        </p>
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-4 text-[13px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity hover:opacity-90"
        >
          <Github className="h-3.5 w-3.5" />
          {t('gitProviders.github.empty.cta')}
        </button>
      </div>
    </OuterCard>
  );
}

function OtherProvidersCard() {
  const { t } = useLanguage();
  const rows: Array<{ key: string; label: string }> = [
    { key: 'gitlab', label: t('gitProviders.others.gitlab') },
    { key: 'bitbucket', label: t('gitProviders.others.bitbucket') },
  ];
  return (
    <OuterCard
      title={
        <span className="flex items-center gap-2 text-[color:var(--ol-fg-muted)]">
          {t('gitProviders.others.title')}
        </span>
      }
    >
      <ul
        data-testid="git-providers-other-list"
        className="divide-y divide-[color:var(--ol-border-subtle)]"
      >
        {rows.map((row) => (
          <li
            key={row.key}
            data-testid={`git-providers-other-${row.key}`}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="text-[13px] text-[color:var(--ol-fg-muted)]">{row.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
                {t('gitProviders.others.comingLater')}
              </span>
              <span className="rounded-full border border-[color:var(--ol-border-subtle)] px-2 py-0.5 text-[11px] text-[color:var(--ol-fg-muted)]">
                {t('gitProviders.others.laterBadge')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </OuterCard>
  );
}

function LoadingCard({ t }: { t: Translate }) {
  return (
    <OuterCard
      title={
        <span className="flex items-center gap-2">
          <Github className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
          {t('gitProviders.github.cardTitle')}
        </span>
      }
    >
      <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('gitProviders.github.loading')}
      </p>
    </OuterCard>
  );
}

interface ErrorCardProps {
  message: string;
  onRetry: () => void;
  t: Translate;
}

function ErrorCard({ message, onRetry, t }: ErrorCardProps) {
  return (
    <OuterCard
      title={
        <span className="flex items-center gap-2">
          <Github className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
          {t('gitProviders.github.cardTitle')}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-[color:var(--ol-error)]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-3 text-[12.5px] font-medium text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)]"
        >
          <ChevronUp className="h-3.5 w-3.5 rotate-90" />
          {t('gitProviders.github.retry')}
        </button>
      </div>
    </OuterCard>
  );
}

interface GitHubConnectionFlowProps {
  mode: 'connect' | 'reauthorize';
  onComplete: () => void | Promise<void>;
  onCancel: () => void;
}

function GitHubConnectionFlow({ mode, onComplete, onCancel }: GitHubConnectionFlowProps) {
  const { t } = useLanguage();
  const setup = useSetup();

  if (setup.loading && !setup.status) {
    return <LoadingCard t={t} />;
  }

  return (
    <GithubSettingsTab
      status={setup.status}
      refetch={setup.refetch}
      forceReauthorize={mode === 'reauthorize'}
      onComplete={onComplete}
      onCancel={onCancel}
    />
  );
}

export function GitProvidersSettings() {
  const { t } = useLanguage();
  const status = useGitHubStatus(t);
  const [connectionMode, setConnectionMode] = useState<'connect' | 'reauthorize' | null>(null);

  const finishConnection = async () => {
    await status.reload();
    setConnectionMode(null);
  };

  let mainCard: ReactNode;
  if (connectionMode) {
    mainCard = (
      <GitHubConnectionFlow
        mode={connectionMode}
        onComplete={finishConnection}
        onCancel={() => setConnectionMode(null)}
      />
    );
  } else if (status.loading && !status.data) {
    mainCard = <LoadingCard t={t} />;
  } else if (status.error) {
    mainCard = <ErrorCard message={status.error} onRetry={status.reload} t={t} />;
  } else if (status.data && status.data.connected) {
    mainCard = (
      <GitHubCard
        data={status.data}
        onReload={status.reload}
        onReauthorize={() => setConnectionMode('reauthorize')}
      />
    );
  } else {
    mainCard = <GitHubEmptyCard onConnect={() => setConnectionMode('connect')} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[18px] font-semibold text-[color:var(--ol-fg)]">
          {t('gitProviders.title')}
        </h1>
        <p className="text-[12.5px] text-[color:var(--ol-fg-muted)]">
          {t('gitProviders.subtitle')}
        </p>
      </header>
      {mainCard}
      <OtherProvidersCard />
    </div>
  );
}

export default GitProvidersSettings;
