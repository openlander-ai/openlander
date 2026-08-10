import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { OuterCard } from '@/components/Shell/OuterCard';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/i18n/context';
import {
  connectCloudflare,
  completeCloudflareOAuth,
  disconnectCloudflare,
  getCloudflareConnection,
  listCloudflareZones,
  startCloudflareOAuth,
  type CloudflareAccountOption,
  type CloudflareConnection,
  type CloudflareZoneOption,
} from '@/lib/api/cloudflare';
import { cn } from '@/lib/utils';

interface OAuthMessage {
  type?: unknown;
  status?: unknown;
  code?: unknown;
  state?: unknown;
  error?: unknown;
  error_description?: unknown;
}

function publishReturnTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get('intent') !== 'publish') return null;
  const returnTo = params.get('returnTo');
  return returnTo && /^\/projects\/[^/?#]+$/.test(returnTo) ? returnTo : null;
}

function waitForOAuthPopup(
  popup: Window,
  callbackOrigin: string,
  expectedState: string,
  timeoutMs: number,
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timeout);
    };
    const onMessage = (event: MessageEvent<OAuthMessage>) => {
      if (event.source !== popup || event.origin !== callbackOrigin) return;
      if (event.data?.type !== 'openlander:cloudflare-oauth') return;
      const state = typeof event.data.state === 'string' ? event.data.state : '';
      if (state !== expectedState) return;
      popup.postMessage(
        { type: 'openlander:cloudflare-oauth:ack', state: expectedState },
        callbackOrigin,
      );
      finish();
      if (typeof event.data.error === 'string' && event.data.error) {
        reject(new Error(String(event.data.error_description || event.data.error)));
        return;
      }
      if (event.data.status !== 'authorized') {
        reject(new Error('Cloudflare OAuth did not complete authorization'));
        return;
      }
      const code = typeof event.data.code === 'string' ? event.data.code : '';
      if (!code) {
        reject(new Error('Cloudflare OAuth returned no authorization code'));
        return;
      }
      resolve({ code, state });
    };
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Cloudflare OAuth timed out'));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
  });
}

export function ConnectedPublishCard() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [connection, setConnection] = useState<CloudflareConnection | null>(null);
  const [accounts, setAccounts] = useState<CloudflareAccountOption[]>([]);
  const [zones, setZones] = useState<CloudflareZoneOption[]>([]);
  const [accountId, setAccountId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const loadConnection = useCallback(async () => {
    try {
      setConnection(await getCloudflareConnection());
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[ConnectedPublishCard] Failed to load Cloudflare connection', error);
      }
      setConnection(null);
    }
  }, []);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const loadZones = async (selectedAccountId: string) => {
    setAccountId(selectedAccountId);
    setZoneId('');
    setZones([]);
    if (!selectedAccountId) return [];
    const nextZones = await listCloudflareZones(selectedAccountId);
    setZones(nextZones);
    if (nextZones.length === 1 && nextZones[0]) setZoneId(nextZones[0].id);
    return nextZones;
  };

  const selectAccount = async (selectedAccountId: string) => {
    setBusy(true);
    try {
      await loadZones(selectedAccountId);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[ConnectedPublishCard] Failed to load Cloudflare zones', error);
      }
      toast.error(t('webServer.publicAccess.zonesFailed'));
    } finally {
      setBusy(false);
    }
  };

  const finishConnection = async (selectedAccountId = accountId, selectedZoneId = zoneId) => {
    if (!selectedAccountId || !selectedZoneId) return;
    setBusy(true);
    try {
      const connected = await connectCloudflare(selectedAccountId, selectedZoneId);
      setConnection(connected);
      setAccounts([]);
      setZones([]);
      toast.success(t('webServer.publicAccess.connectedToast'));
      const returnTo = publishReturnTarget(location.search);
      if (returnTo) {
        navigate(returnTo, { replace: true, state: { resumePublicAccess: true } });
      }
    } catch {
      toast.error(t('webServer.publicAccess.connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const beginOAuth = async () => {
    setBusy(true);
    const popup = window.open(
      'about:blank',
      'openlander-cloudflare-oauth',
      'popup,width=560,height=720',
    );
    if (!popup) {
      toast.error(t('webServer.publicAccess.oauthFailed'));
      setBusy(false);
      return;
    }
    try {
      const start = await startCloudflareOAuth();
      const callbackPromise = waitForOAuthPopup(
        popup,
        start.callback_origin,
        start.state,
        start.expires_in_seconds * 1000,
      );
      popup.location.replace(start.auth_url);
      const authorized = await callbackPromise;
      const completion = await completeCloudflareOAuth(authorized.code, authorized.state);
      const refreshedConnection = await getCloudflareConnection();
      if (refreshedConnection.configured) {
        setConnection(refreshedConnection);
        setAccounts([]);
        setZones([]);
        toast.success(t('webServer.publicAccess.connectedToast'));
        const returnTo = publishReturnTarget(location.search);
        if (returnTo) {
          navigate(returnTo, { replace: true, state: { resumePublicAccess: true } });
        }
        return;
      }
      setAccounts(completion.accounts);
      const onlyAccount = completion.accounts.length === 1 ? completion.accounts[0] : undefined;
      if (onlyAccount) {
        const nextZones = await loadZones(onlyAccount.id);
        const onlyZone = nextZones.length === 1 ? nextZones[0] : undefined;
        if (onlyZone) {
          await finishConnection(onlyAccount.id, onlyZone.id);
          return;
        }
      }
    } catch {
      popup.close();
      toast.error(t('webServer.publicAccess.oauthFailed'));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      setConnection(await disconnectCloudflare());
      setAccounts([]);
      setZones([]);
      setAccountId('');
      setZoneId('');
      toast.success(t('webServer.publicAccess.disconnectedToast'));
    } catch {
      toast.error(t('webServer.publicAccess.disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };

  const repairConnection = async () => {
    if (!connection?.account || !connection.zone) return;
    setBusy(true);
    try {
      setConnection(await connectCloudflare(connection.account.id, connection.zone.id));
      toast.success(t('webServer.publicAccess.repairedToast'));
    } catch {
      await loadConnection();
      toast.error(t('webServer.publicAccess.repairFailed'));
    } finally {
      setBusy(false);
    }
  };

  const configured = connection?.configured === true;
  const connectionHealthy =
    configured && connection.status === 'connected' && connection.connector?.status === 'running';
  const connectionNeedsOAuth = connection?.error?.code === 'CLOUDFLARE_NOT_CONNECTED';

  return (
    <OuterCard
      className="scroll-mt-4"
      title={
        <span id="connected-publish" className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
          {t('webServer.publicAccess.title')}
        </span>
      }
      subtitle={t('webServer.publicAccess.subtitle')}
      actions={
        configured ? (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium',
                connectionHealthy
                  ? 'bg-[color:var(--ol-success-soft)] text-[color:var(--ol-success)]'
                  : 'bg-[color:var(--ol-warning-soft)] text-[color:var(--ol-warning)]',
              )}
            >
              {connectionHealthy ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CircleAlert className="h-3.5 w-3.5" />
              )}
              {connectionHealthy
                ? t('webServer.publicAccess.connected')
                : t('webServer.publicAccess.needsAttention')}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={t('webServer.publicAccess.moreActions')}
                  className="grid h-8 w-8 place-items-center rounded-md border border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem disabled={busy} onClick={() => void beginOAuth()}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  {t('webServer.publicAccess.reconnect')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={busy}
                  onClick={() => setDisconnectConfirmOpen(true)}
                  className="text-[color:var(--ol-error)] focus:text-[color:var(--ol-error)]"
                >
                  <Unplug className="mr-2 h-3.5 w-3.5" />
                  {t('webServer.publicAccess.disconnect')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <span className="rounded-full bg-[color:var(--ol-panel-2)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--ol-fg-muted)]">
            {t('webServer.publicAccess.optional')}
          </span>
        )
      }
    >
      {configured ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
            <span className="text-[color:var(--ol-fg-muted)]">
              {t('webServer.publicAccess.zone')}{' '}
              <strong className="font-medium text-[color:var(--ol-fg)]">
                {connection.zone?.name}
              </strong>
            </span>
            <span className="text-[color:var(--ol-fg-muted)]">
              {t('webServer.publicAccess.connector')}{' '}
              <strong className="font-medium text-[color:var(--ol-fg)]">
                {connection.connector?.status === 'running'
                  ? t('webServer.publicAccess.running')
                  : t('webServer.publicAccess.needsAttention')}
              </strong>
            </span>
          </div>
          {!connectionHealthy && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void (connectionNeedsOAuth ? beginOAuth() : repairConnection())}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12.5px] font-medium text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {connectionNeedsOAuth
                ? t('webServer.publicAccess.reconnect')
                : t('webServer.publicAccess.repair')}
            </button>
          )}
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
            {connection?.oauthAvailable === false
              ? t('webServer.publicAccess.unavailable')
              : t('webServer.publicAccess.disconnected')}
          </p>
          <button
            type="button"
            disabled={busy || connection?.oauthAvailable === false}
            onClick={() => void beginOAuth()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? t('webServer.publicAccess.connecting') : t('webServer.publicAccess.connect')}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1.5 text-[11.5px] text-[color:var(--ol-fg-muted)]">
            {t('webServer.publicAccess.account')}
            <select
              value={accountId}
              disabled={busy}
              onChange={(event) => void selectAccount(event.target.value)}
              className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 text-[12.5px] text-[color:var(--ol-fg)]"
            >
              <option value="">{t('webServer.publicAccess.selectAccount')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11.5px] text-[color:var(--ol-fg-muted)]">
            {t('webServer.publicAccess.zone')}
            <select
              value={zoneId}
              disabled={!accountId}
              onChange={(event) => setZoneId(event.target.value)}
              className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 text-[12.5px] text-[color:var(--ol-fg)] disabled:opacity-50"
            >
              <option value="">{t('webServer.publicAccess.selectZone')}</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !accountId || !zoneId}
            onClick={() => void finishConnection()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('webServer.publicAccess.finish')}
          </button>
        </div>
      )}
      <p className="mt-3 border-t border-[color:var(--ol-border-subtle)] pt-3 text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
        {t('webServer.publicAccess.securityNote')}
      </p>
      <ConfirmDialog
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
        title={t('webServer.publicAccess.disconnectTitle')}
        description={t('webServer.publicAccess.disconnectDescription')}
        confirmLabel={t('webServer.publicAccess.disconnectConfirm')}
        variant="destructive"
        onConfirm={() => void disconnect()}
      />
    </OuterCard>
  );
}
