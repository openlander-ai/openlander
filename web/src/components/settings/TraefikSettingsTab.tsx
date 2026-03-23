import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Network,
  Save,
  Server,
  Shield,
  HardDrive,
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
import { StatCard } from '@/components/settings/shared';

export function TraefikSettingsTab() {
  const { t } = useLanguage();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverStatusLoading, setServerStatusLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedServiceUrl, setCopiedServiceUrl] = useState(false);
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

  const cloudflareTokenPermissions = t('settings.proxy.cloudflare.tokenPermissions')
    .split(';')
    .map((perm) => perm.trim())
    .filter(Boolean);

  useEffect(() => {
    getServerStatus()
      .then(setServerStatus)
      .catch(console.error)
      .finally(() => setServerStatusLoading(false));
  }, []);

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

  useEffect(() => {
    fetchCloudflareStatus();
  }, [fetchCloudflareStatus]);

  const handleCopyServiceUrl = async () => {
    try {
      await navigator.clipboard.writeText('http://localhost:80');
      setCopiedServiceUrl(true);
      setTimeout(() => setCopiedServiceUrl(false), 2000);
    } catch {
      window.prompt('Copy this URL:', 'http://localhost:80');
    }
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
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">{'Reverse Proxy'}</h2>
        </div>

        {serverStatusLoading ? (
          <p className="text-sm font-body text-muted-ol">{t('settings.proxy.loading')}</p>
        ) : serverStatus ? (
          <div className="space-y-4">
            {serverStatus.proxy.type === 'none' && (
              <div className="rounded-lg border-l-4 border-warning bg-warning/10 p-3 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-sm font-body text-primary-ol">{t('settings.proxy.warning')}</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon={<Network className="h-4 w-4" />}
                label={'Type'}
                value={
                  serverStatus.proxy.type === 'none'
                    ? 'None'
                    : serverStatus.proxy.type.charAt(0).toUpperCase() +
                      serverStatus.proxy.type.slice(1)
                }
                color="text-agent"
              />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label={'Status'}
                value={serverStatus.proxy.status}
                color={
                  serverStatus.proxy.status.toLowerCase() === 'running'
                    ? 'text-success'
                    : 'text-warning'
                }
              />
              <StatCard
                icon={<HardDrive className="h-4 w-4" />}
                label={'Containers'}
                value={`${serverStatus.containers.managed}/${serverStatus.containers.total}`}
                color="text-secondary-ol"
              />
              <StatCard
                icon={<Network className="h-4 w-4" />}
                label={t('settings.proxy.ports')}
                value={serverStatus.portsInUse.toString()}
                color="text-secondary-ol"
              />
            </div>

            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1">
                  <h3 className="font-display text-base font-semibold text-primary-ol">
                    Cloudflare Tunnel
                  </h3>
                  <p className="text-xs font-body text-secondary-ol">
                    {t('settings.proxy.cloudflare.description')}
                  </p>
                </div>
                {cloudflareConnected ? (
                  <Badge variant="outline" className="text-agent border-agent/30">
                    Connected as: {cloudflareAccountName}
                  </Badge>
                ) : cloudflareConfigured ? (
                  <Badge
                    variant="outline"
                    className="text-success border-success/30 px-2.5 py-1 text-xs font-medium"
                  >
                    Configured ✓
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-warning border-warning/30">
                    Not configured
                  </Badge>
                )}
              </div>

              {!cloudflareConnected ? (
                <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-3">
                  <p className="text-xs font-body text-secondary-ol">
                    {t('settings.proxy.cloudflare.tokenHelpTitle')}
                  </p>
                  <p className="text-xs font-body text-muted-ol">
                    {t('settings.proxy.cloudflare.tokenHelpText')}
                  </p>
                  <a
                    href={`https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
                      JSON.stringify([
                        { key: 'dns_records', type: 'edit' },
                        { key: 'tunnel', type: 'edit' },
                        { key: 'zone', type: 'read' },
                      ]),
                    )}&name=OpenLander`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-body text-agent hover:underline"
                  >
                    {t('settings.proxy.cloudflare.tokenHelpLink')}{' '}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <div className="space-y-1">
                    <p className="text-xs font-body text-secondary-ol">
                      {t('settings.proxy.cloudflare.tokenPermissionsLabel')}
                    </p>
                    <ul className="list-disc pl-4 text-xs font-body text-muted-ol">
                      {cloudflareTokenPermissions.map((perm) => (
                        <li key={perm}>{perm}</li>
                      ))}
                    </ul>
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
                          className="gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
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
                      <p className="text-xs font-body text-error">{cloudflareError}</p>
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
                    <p className="text-xs font-body text-success">{cloudflareMessage}</p>
                  )}
                  {cloudflareError && (
                    <p className="text-xs font-body text-error">{cloudflareError}</p>
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
                    className="gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
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

            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 overflow-hidden">
              <button
                type="button"
                onClick={() => setGuideOpen(!guideOpen)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-bg-subtle/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-agent" />
                  <span className="font-display font-medium text-primary-ol">
                    {t('settings.proxy.tunnelGuide.title')}
                  </span>
                </div>
                {guideOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-ol" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-ol" />
                )}
              </button>

              {guideOpen && (
                <div className="p-4 pt-0 space-y-4 border-t border-border/50 mt-2">
                  <p className="text-sm font-body text-secondary-ol">
                    {t('settings.proxy.tunnelGuide.description')}
                  </p>

                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-medium text-agent">
                        1
                      </div>
                      <p className="text-sm font-body text-primary-ol pt-0.5">
                        {t('settings.proxy.tunnelGuide.step1')}
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-medium text-agent">
                        2
                      </div>
                      <div className="space-y-2 flex-1">
                        <p className="text-sm font-body text-primary-ol pt-0.5">
                          {t('settings.proxy.tunnelGuide.step2')}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 rounded bg-bg-app px-3 py-2 font-mono text-sm text-primary-ol border border-border">
                            service: {t('settings.proxy.tunnelGuide.serviceUrl')}
                          </code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopyServiceUrl}
                            className="shrink-0"
                          >
                            {copiedServiceUrl ? (
                              <Check className="h-4 w-4 text-success" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-agent/10 text-xs font-medium text-agent">
                        3
                      </div>
                      <p className="text-sm font-body text-primary-ol pt-0.5">
                        {'Restart cloudflared'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">{'Server Scan'}</h2>
        </div>

        {!serverStatus ? (
          <p className="text-sm font-body text-muted-ol">{'Scanning server...'}</p>
        ) : (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
            <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-bg-subtle/30">
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
                  <p className="text-xs font-body text-muted-ol mb-2">
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
                          <p className="text-[11px] font-body text-muted-ol truncate">
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
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-subtle border border-[hsl(var(--border))] text-secondary-ol"
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
                  <p className="text-[11px] font-body text-muted-ol mt-1">
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
