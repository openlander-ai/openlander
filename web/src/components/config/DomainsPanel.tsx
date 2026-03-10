import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  getProject,
  exposeProject,
  unexposeProject,
  getAllIps,
  type NetworkIp,
  getProjectDomains,
  addProjectDomain,
  removeProjectDomain,
  type DomainMapping,
  getCloudflareStatus,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Globe,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Wifi,
  Monitor,
  Trash2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DomainsPanelProps {
  projectId: string;
  /** When this value changes, the panel re-fetches project data. */
  projectStatus?: string;
}

export function DomainsPanel({ projectId, projectStatus }: DomainsPanelProps) {
  const { t } = useLanguage();
  const [internalUrl, setInternalUrl] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [assignedPort, setAssignedPort] = useState<number | null>(null);
  const [networkIps, setNetworkIps] = useState<NetworkIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [exposing, setExposing] = useState(false);
  const [unexposing, setUnexposing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainMapping[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null);
  const fetchProject = useCallback(async () => {
    try {
      const [data, ips, domainsList, cfStatus] = await Promise.all([
        getProject(projectId),
        getAllIps(),
        getProjectDomains(projectId),
        getCloudflareStatus().catch(() => ({ configured: false })),
      ]);
      setInternalUrl(data.url ?? null);
      setPublicUrl(data.publicUrl ?? null);
      setAssignedPort(data.port ?? null);
      setNetworkIps(ips);
      setDomains(domainsList);
      setCfConfigured(cfStatus.configured);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject, projectStatus]);

  const handleExpose = async () => {
    setExposing(true);
    try {
      const result = await exposeProject(projectId);
      setPublicUrl(result.publicUrl);
      toast.success('Project exposed');
    } catch (err) {
      console.error('Expose failed:', err);
      toast.error('Failed to expose project');
    } finally {
      setExposing(false);
    }
  };

  const handleUnexpose = async () => {
    setUnexposing(true);
    try {
      await unexposeProject(projectId);
      setPublicUrl(null);
      toast.success('Project unexposed');
    } catch (err) {
      console.error('Unexpose failed:', err);
      toast.error('Failed to unexpose project');
    } finally {
      setUnexposing(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    setAddingDomain(true);
    try {
      await addProjectDomain(projectId, newDomain.trim());
      const updated = await getProjectDomains(projectId);
      setDomains(updated);
      setNewDomain('');
      toast.success('Domain added');
    } catch (err) {
      console.error('Failed to add domain:', err);
      toast.error('Failed to add domain');
    } finally {
      setAddingDomain(false);
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    setRemovingDomain(domain);
    try {
      await removeProjectDomain(projectId, domain);
      setDomains((prev) => prev.filter((d) => d.domain !== domain));
      toast.success('Domain removed');
    } catch (err) {
      console.error('Failed to remove domain:', err);
      toast.error('Failed to remove domain');
    } finally {
      setRemovingDomain(null);
    }
  };
  const copyToClipboard = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-3.5" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Internal URL */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Wifi className="h-3.5 w-3.5 text-muted-ol" />
          <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
            {'Internal URL'}
          </span>
        </div>
        {internalUrl ? (
          <div className="flex items-center gap-2">
            <a
              href={internalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-agent hover:text-agent/80 transition-colors flex items-center gap-1"
            >
              {internalUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => copyToClipboard(internalUrl, 'internal')}
              className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
            >
              {copied === 'internal' ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.notAvailable')}</p>
        )}
        <p className="text-[11px] font-body text-muted-ol">{t('domains.accessibleFrom')}</p>
      </div>

      {/* Direct Port Access */}
      {assignedPort && networkIps.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Direct Access'}
            </span>
          </div>
          <div className="space-y-1.5">
            {networkIps.map((ip) => {
              const directUrl = `http://${ip.address}:${assignedPort}`;
              const label = ip.type === 'vpn' ? `${ip.interface} (VPN)` : ip.interface;
              return (
                <div key={ip.address} className="flex items-center gap-2">
                  <a
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-agent hover:text-agent/80 transition-colors flex items-center gap-1"
                  >
                    {directUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="text-[10px] font-body text-muted-ol px-1.5 py-0.5 rounded bg-bg-subtle border border-[hsl(var(--border))]">
                    {label}
                  </span>
                  <button
                    onClick={() => copyToClipboard(directUrl, ip.address)}
                    className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
                  >
                    {copied === ip.address ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] font-body text-muted-ol">{t('domains.directPortAccess')}</p>
        </div>
      )}

      {/* Custom Domains */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Custom Domains'}
            </span>
          </div>
        </div>

        {/* Domain list */}
        {domains.length > 0 ? (
          <div className="space-y-1.5">
            {domains.map((d) => (
              <div key={d.domain} className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href={`https://${d.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-agent hover:text-agent/80 transition-colors flex items-center gap-1 truncate"
                  >
                    {d.domain}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-ol hover:text-error shrink-0"
                  onClick={() => handleRemoveDomain(d.domain)}
                  disabled={removingDomain === d.domain}
                >
                  {removingDomain === d.domain ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.noCustomDomains')}</p>
        )}

        {/* Add domain form */}
        {cfConfigured === false ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-2.5 space-y-1">
            <p className="text-xs font-body text-warning">{t('domains.cloudflareNotConfigured')}</p>
            <a
              href="/settings"
              className="text-xs font-body font-medium text-warning underline-offset-2 hover:underline flex items-center gap-1"
            >
              <span>{t('domains.cloudflareGoToSettings')}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newDomain}
                onChange={(e) =>
                  setNewDomain(e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddDomain();
                }}
                placeholder="example.com"
                className="flex-1 h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 text-sm font-mono text-primary-ol placeholder:text-muted-ol"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-body gap-1.5"
                onClick={handleAddDomain}
                disabled={!newDomain.trim() || addingDomain}
              >
                {addingDomain ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {'Add Domain'}
              </Button>
            </div>
            <p className="text-[11px] font-body text-muted-ol">{t('domains.customDomainsHelp')}</p>
          </>
        )}
      </div>

      {/* Public URL */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Public URL'}
            </span>
          </div>

          {/* Toggle expose/unexpose */}
          {publicUrl ? (
            <button
              onClick={handleUnexpose}
              disabled={unexposing}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
                'border border-error/30 text-error hover:bg-error/10',
                'transition-colors',
                unexposing && 'opacity-50 cursor-not-allowed',
              )}
            >
              {unexposing && <Loader2 className="h-3 w-3 animate-spin" />}
              {'Remove'}
            </button>
          ) : (
            <button
              onClick={handleExpose}
              disabled={exposing || !internalUrl}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
                'bg-agent text-bg-app hover:bg-agent/90',
                'transition-colors',
                (exposing || !internalUrl) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {exposing && <Loader2 className="h-3 w-3 animate-spin" />}
              {t('domains.exposeToInternet')}
            </button>
          )}
        </div>

        {publicUrl ? (
          <div className="flex items-center gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-agent hover:text-agent/80 transition-colors flex items-center gap-1"
            >
              {publicUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => copyToClipboard(publicUrl, 'public')}
              className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
            >
              {copied === 'public' ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.notExposed')}</p>
        )}

        <p className="text-[11px] font-body text-muted-ol">
          {publicUrl ? t('domains.anyoneWithUrl') : t('domains.requiresRunning')}
        </p>
      </div>
    </div>
  );
}
