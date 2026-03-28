import { useCallback, useEffect, useState } from 'react';
import { useCopy } from '@/hooks/use-copy';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Network,
  Save,
  Server,
  Shield,
  HardDrive,
  Activity,
  RefreshCw,
} from 'lucide-react';
import {
  configureCloudflare,
  connectCloudflare,
  getCloudflareStatus,
  getServerStatus,
  type ServerStatus,
} from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function TraefikSettingsTab() {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverStatusLoading, setServerStatusLoading] = useState(true);
  const [cloudflareApiToken, setCloudflareApiToken] = useState('');
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [cloudflareAccountName, setCloudflareAccountName] = useState('');
  const [cloudflareTunnelId, setCloudflareTunnelId] = useState('');
  const [cloudflareTunnels, setCloudflareTunnels] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [cloudflareConnected, setCloudflareConnected] = useState(false);
  const [cloudflareConnecting, setCloudflareConnecting] = useState(false);
  const [cloudflareConfigured, setCloudflareConfigured] = useState(false);
  const [cloudflareSaving, setCloudflareSaving] = useState(false);
  const [cloudflareMessage, setCloudflareMessage] = useState('');
  const [cloudflareError, setCloudflareError] = useState('');

  const [isScanning, setIsScanning] = useState(false);

  const fetchCloudflareStatus = useCallback(async () => {
    try {
      const status = await getCloudflareStatus();
      setCloudflareConfigured(status.configured);
      setCloudflareConnected(false);
      setCloudflareAccountName('');
      setCloudflareTunnels([]);
      setCloudflareTunnelId('');
      if (status.accountId) {
        setCloudflareAccountId(status.accountId);
      }
    } catch {
      return;
    }
  }, []);

  const refreshServerStatus = useCallback(async () => {
    try {
      const status = await getServerStatus();
      setServerStatus(status);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleManualScan = async () => {
    setIsScanning(true);
    await refreshServerStatus();
    setIsScanning(false);
  };

  useEffect(() => {
    // Initial fetch
    getServerStatus()
      .then(setServerStatus)
      .catch(console.error)
      .finally(() => setServerStatusLoading(false));
  }, []);

  useEffect(() => {
    fetchCloudflareStatus();
  }, [fetchCloudflareStatus]);

  const handleCopyServiceUrl = () => {
    void copy('http://localhost:80');
  };

  const handleConfigureCloudflare = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloudflareSaving(true);
    setCloudflareMessage('');
    setCloudflareError('');

    try {
      await configureCloudflare({
        apiToken: cloudflareApiToken.trim(),
        accountId: cloudflareAccountId.trim(),
        tunnelId: cloudflareTunnelId.trim(),
      });
      await fetchCloudflareStatus();
      setCloudflareMessage(t('settings.proxy.cloudflare.saveSuccess'));
    } catch {
      setCloudflareError(t('settings.proxy.cloudflare.saveFailed'));
    } finally {
      setCloudflareSaving(false);
    }
  };

  const handleConnectCloudflare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloudflareApiToken.trim()) {
      return;
    }

    setCloudflareConnecting(true);
    setCloudflareMessage('');
    setCloudflareError('');

    try {
      const result = await connectCloudflare(cloudflareApiToken.trim());
      setCloudflareAccountId(result.accountId);
      setCloudflareAccountName(result.accountName);
      setCloudflareTunnels(result.tunnels);
      setCloudflareTunnelId('');
      setCloudflareConnected(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect Cloudflare';
      setCloudflareError(message);
      setCloudflareConnected(false);
      setCloudflareAccountName('');
      setCloudflareTunnels([]);
      setCloudflareTunnelId('');
    } finally {
      setCloudflareConnecting(false);
    }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-agent/10 text-agent">
            <Network className="h-4 w-4" />
          </div>
          <h2 className="font-display text-lg font-semibold text-primary-ol">{'Reverse Proxy'}</h2>
        </div>

        {serverStatusLoading ? (
          <div className="flex items-center gap-2 text-sm font-body text-muted-ol">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('settings.proxy.loading')}
          </div>
        ) : serverStatus ? (
          <div className="space-y-6">
            {serverStatus.proxy.type === 'none' && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                <p className="text-sm font-body text-primary-ol leading-relaxed">
                  {t('settings.proxy.warning')}
                </p>
              </div>
            )}

            {/* Elevated Status Panels instead of 4 generic unstyled cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Proxy Engine */}
              <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                    <Activity className="h-4 w-4" />
                  </div>
                  <h3 className="font-display font-semibold text-primary-ol">Proxy Engine</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-secondary-ol font-body">Type</span>
                    <Badge
                      variant="secondary"
                      className="font-mono bg-bg-subtle text-primary-ol border-border font-medium"
                    >
                      {serverStatus.proxy.type === 'none'
                        ? 'None'
                        : serverStatus.proxy.type.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-start text-sm gap-4">
                    <span className="text-secondary-ol font-body shrink-0 mt-0.5">Status</span>
                    <span
                      className={cn(
                        'font-mono font-medium text-right break-words leading-tight',
                        serverStatus.proxy.status.toLowerCase() === 'running'
                          ? 'text-success'
                          : 'text-warning',
                      )}
                    >
                      {serverStatus.proxy.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Environment Allocation */}
              <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/10 text-teal-500">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <h3 className="font-display font-semibold text-primary-ol">Network Allocation</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-secondary-ol font-body">Containers</span>
                    <span className="font-mono text-primary-ol font-medium">
                      {serverStatus.containers.managed} / {serverStatus.containers.total}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-secondary-ol font-body">{t('settings.proxy.ports')}</span>
                    <span className="font-mono text-primary-ol font-medium">
                      {serverStatus.portsInUse.toString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel shadow-sm overflow-hidden">
              <div className="flex items-center justify-between gap-4 p-5 border-b border-[hsl(var(--border))] bg-bg-subtle/30">
                <div className="space-y-1">
                  <h3 className="font-display text-base font-semibold text-primary-ol flex items-center gap-2">
                    <Shield className="w-4 h-4 text-agent" /> Cloudflare Tunnel
                  </h3>
                  <p className="text-sm font-body text-secondary-ol">
                    {t('settings.proxy.cloudflare.description')}
                  </p>
                </div>
                {cloudflareConnected ? (
                  <Badge
                    variant="outline"
                    className="text-agent border-agent/30 bg-agent/5 whitespace-nowrap"
                  >
                    Connected: {cloudflareAccountName}
                  </Badge>
                ) : cloudflareConfigured ? (
                  <Badge
                    variant="outline"
                    className="text-success border-success/30 bg-success/5 px-2.5 py-1 text-xs font-medium whitespace-nowrap"
                  >
                    Configured ✓
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-warning border-warning/30 bg-warning/5 whitespace-nowrap"
                  >
                    Not configured
                  </Badge>
                )}
              </div>
              <div className="p-5">
                {!cloudflareConnected ? (
                  <div className="space-y-5">
                    <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4">
                      <p className="text-sm font-body text-secondary-ol">
                        {t('settings.proxy.cloudflare.tokenHelpTitle')}
                      </p>
                      <p className="text-sm font-body text-muted-ol">
                        {t('settings.proxy.cloudflare.tokenHelpText')}
                      </p>
                      <a
                        href={`https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
                          JSON.stringify([
                            { key: 'zone', type: 'read' },
                            { key: 'zone_dns', type: 'edit' },
                            { key: 'tunnel', type: 'edit' },
                            { key: 'account_settings', type: 'read' },
                          ]),
                        )}&name=OpenLander&accountId=%2A&zoneId=all`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-agent/10 px-4 py-2.5 text-sm font-medium text-agent transition-all hover:bg-agent/20 border border-agent/20 w-fit"
                      >
                        {t('settings.proxy.cloudflare.tokenHelpLink')}{' '}
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <div className="pt-2 pb-1 space-y-2">
                        <p className="text-xs font-semibold text-primary-ol">
                          {t('settings.proxy.cloudflare.tokenPermissionsLabel')}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="rounded border border-border bg-bg-app px-2.5 py-1.5 text-[11px] font-mono text-secondary-ol shadow-sm truncate">
                            {t('settings.proxy.cloudflare.tokenPermZone')}
                          </div>
                          <div className="rounded border border-border bg-bg-app px-2.5 py-1.5 text-[11px] font-mono text-secondary-ol shadow-sm truncate">
                            {t('settings.proxy.cloudflare.tokenPermDns')}
                          </div>
                          <div className="rounded border border-border bg-bg-app px-2.5 py-1.5 text-[11px] font-mono text-secondary-ol shadow-sm truncate">
                            {t('settings.proxy.cloudflare.tokenPermTunnel')}
                          </div>
                          <div className="rounded border border-border bg-bg-app px-2.5 py-1.5 text-[11px] font-mono text-secondary-ol shadow-sm truncate">
                            {t('settings.proxy.cloudflare.tokenPermAccount')}
                          </div>
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleConnectCloudflare} className="space-y-3">
                      <div className="space-y-1.5">
                        <p className="text-xs font-body text-muted-ol">API Token</p>
                        <div className="flex gap-2">
                          <Input
                            type="password"
                            value={cloudflareApiToken}
                            onChange={(e) => setCloudflareApiToken(e.target.value)}
                            className="font-mono text-sm bg-bg-app border-border"
                            required
                          />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={cloudflareConnecting || !cloudflareApiToken.trim()}
                            className="gap-1.5 bg-agent text-white hover:bg-agent/90 font-body"
                          >
                            {cloudflareConnecting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Connect
                          </Button>
                        </div>
                      </div>

                      {cloudflareError && (
                        <p className="text-sm font-body text-error">{cloudflareError}</p>
                      )}
                    </form>
                  </div>
                ) : (
                  <form onSubmit={handleConfigureCloudflare} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <p className="text-xs font-body text-muted-ol">API Token</p>
                        <Input
                          type="text"
                          value={'••••••••••••'}
                          disabled
                          className="font-mono text-sm bg-bg-app border-border"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-body text-muted-ol">Account</p>
                        <div className="h-9 rounded-md border border-border bg-bg-app px-3 flex items-center text-sm font-mono text-primary-ol">
                          {cloudflareAccountName}
                        </div>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <p className="text-xs font-body text-muted-ol">Tunnel</p>
                        <select
                          value={cloudflareTunnelId}
                          onChange={(e) => setCloudflareTunnelId(e.target.value)}
                          className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-mono"
                          required
                        >
                          <option value="">Select tunnel</option>
                          {cloudflareTunnels.map((tunnel) => (
                            <option key={tunnel.id} value={tunnel.id}>
                              {tunnel.name || tunnel.id}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {cloudflareMessage && (
                      <p className="text-sm font-body text-success">{cloudflareMessage}</p>
                    )}
                    {cloudflareError && (
                      <p className="text-sm font-body text-error">{cloudflareError}</p>
                    )}

                    <Button
                      type="submit"
                      size="sm"
                      disabled={
                        cloudflareSaving ||
                        !cloudflareApiToken.trim() ||
                        !cloudflareAccountId.trim() ||
                        !cloudflareTunnelId.trim()
                      }
                      className="gap-1.5 bg-agent text-white hover:bg-agent/90 font-body"
                    >
                      {cloudflareSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                  </form>
                )}
              </div>

              {cloudflareConnected && (
                <div className="border-t border-[hsl(var(--border))] bg-agent/5 p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 shrink-0 rounded-lg bg-agent/10 p-2.5 text-agent shadow-sm">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div className="w-full">
                      <h4 className="text-sm font-semibold text-primary-ol mb-1.5 flex items-center gap-2">
                        <span className="bg-agent text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase">
                          Pro Tip
                        </span>
                        {t('settings.proxy.tunnelGuide.title')}
                      </h4>
                      <p className="text-sm font-body text-secondary-ol mb-5 leading-relaxed">
                        {t('settings.proxy.tunnelGuide.description')}
                      </p>

                      <div className="flex flex-col gap-2.5">
                        {/* Step 1 */}
                        <div className="flex items-center gap-3 rounded-lg border border-agent/10 bg-bg-panel/80 px-4 py-3 shadow-sm">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-bold text-agent tracking-tighter">
                            1
                          </span>
                          <p className="text-sm font-body text-primary-ol">
                            {t('settings.proxy.tunnelGuide.step1')}
                          </p>
                        </div>

                        {/* Step 2 */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border border-agent/10 bg-bg-panel/80 px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-bold text-agent tracking-tighter">
                              2
                            </span>
                            <p className="text-sm font-body text-primary-ol">
                              {t('settings.proxy.tunnelGuide.step2')}
                            </p>
                          </div>
                          <div className="sm:ml-auto shrink-0 w-full sm:w-auto pl-9 sm:pl-0">
                            <button
                              type="button"
                              onClick={handleCopyServiceUrl}
                              className="group flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 rounded-md bg-bg-app border border-[hsl(var(--border))] px-3 py-2 transition-all hover:border-agent/30 hover:shadow-[0_0_0_1px_rgba(var(--agent),0.1)] focus:outline-none"
                              title="Click to copy URL"
                            >
                              <code className="text-[13px] font-mono text-agent tracking-tight">
                                service: {t('settings.proxy.tunnelGuide.serviceUrl')}
                              </code>
                              {isCopied() ? (
                                <Check className="h-4 w-4 text-success" />
                              ) : (
                                <Copy className="h-4 w-4 text-muted-ol transition-colors group-hover:text-agent" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Step 3 */}
                        <div className="flex items-center gap-3 rounded-lg border border-agent/10 bg-bg-panel/80 px-4 py-3 shadow-sm">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-bold text-agent tracking-tighter">
                            3
                          </span>
                          <p className="text-sm font-body text-primary-ol">
                            {t('settings.proxy.tunnelGuide.step3')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-agent/10 text-agent">
            <Server className="h-4 w-4" />
          </div>
          <h2 className="font-display text-lg font-semibold text-primary-ol">{'Server Scan'}</h2>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleManualScan}
            disabled={isScanning || !serverStatus}
            className="ml-auto h-8 gap-1.5 font-body"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isScanning && 'animate-spin')} />
            {isScanning ? 'Scanning...' : 'Rescan'}
          </Button>
        </div>

        {!serverStatus ? (
          <div className="flex items-center gap-2 text-sm font-body text-muted-ol">
            <Loader2 className="w-4 h-4 animate-spin" /> {'Scanning server...'}
          </div>
        ) : (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[hsl(var(--border))] bg-bg-subtle/30">
              <div className="flex items-center gap-6 text-xs font-body">
                <div>
                  <span className="text-muted-ol">{'Total'}:</span>{' '}
                  <span className="font-medium text-primary-ol">
                    {serverStatus.containers.total}
                  </span>
                </div>
                <div>
                  <span className="text-muted-ol">{'Managed'}:</span>{' '}
                  <span className="font-medium text-success">
                    {serverStatus.containers.managed}
                  </span>
                </div>
                <div>
                  <span className="text-muted-ol">{'External'}:</span>{' '}
                  <span className="font-medium text-warning">
                    {serverStatus.containers.external}
                  </span>
                </div>
                <div>
                  <span className="text-muted-ol">{'Ports'}:</span>{' '}
                  <span className="font-medium text-primary-ol">{serverStatus.portsInUse}</span>
                </div>
              </div>
            </div>

            <div className="p-4">
              {serverStatus.externalContainers && serverStatus.externalContainers.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-body text-muted-ol mb-2">
                    {t('settings.serverScan.externalDescription')}
                  </p>
                  {serverStatus.externalContainers.map((container) => (
                    <div
                      key={container.name}
                      className="flex items-center justify-between py-2 px-3 rounded-md bg-bg-subtle/50 border border-[hsl(var(--border))]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-2 w-2 rounded-full bg-warning shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-mono text-primary-ol truncate">
                            {container.name}
                          </p>
                          <p className="text-xs font-body text-muted-ol truncate">
                            {container.image.includes('sha256:')
                              ? container.image.substring(0, 19) + '...'
                              : container.image}
                          </p>
                        </div>
                      </div>
                      {container.ports.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          {container.ports.map((port) => (
                            <span
                              key={port}
                              className="text-xs font-mono px-1.5 py-0.5 rounded bg-bg-subtle border border-[hsl(var(--border))] text-secondary-ol"
                            >
                              :{port}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm font-body text-success">{'All clear'}</p>
                  <p className="text-sm font-body text-muted-ol mt-1">
                    {t('settings.serverScan.noExternal')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
