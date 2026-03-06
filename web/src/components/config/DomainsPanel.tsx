import { useState, useEffect, useCallback } from 'react';
import { getProject, exposeProject, unexposeProject, getAllIps, type NetworkIp } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Globe, ExternalLink, Loader2, Copy, Check, Wifi, Monitor } from 'lucide-react';

interface DomainsPanelProps {
  projectId: string;
}

export function DomainsPanel({ projectId }: DomainsPanelProps) {
  const [internalUrl, setInternalUrl] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [assignedPort, setAssignedPort] = useState<number | null>(null);
  const [networkIps, setNetworkIps] = useState<NetworkIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [exposing, setExposing] = useState(false);
  const [unexposing, setUnexposing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      const data = await getProject(projectId);
      setInternalUrl(data.url ?? null);
      setPublicUrl(data.publicUrl ?? null);
      setAssignedPort(data.port ?? null);
      const ips = await getAllIps();
      setNetworkIps(ips);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  const handleExpose = async () => {
    setExposing(true);
    try {
      const result = await exposeProject(projectId);
      setPublicUrl(result.publicUrl);
    } catch (err) {
      console.error('Expose failed:', err);
    } finally {
      setExposing(false);
    }
  };

  const handleUnexpose = async () => {
    setUnexposing(true);
    try {
      await unexposeProject(projectId);
      setPublicUrl(null);
    } catch (err) {
      console.error('Unexpose failed:', err);
    } finally {
      setUnexposing(false);
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-agent" />
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
            Internal URL
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
          <p className="text-sm font-body text-muted-ol">Not available — project is not running.</p>
        )}
        <p className="text-[11px] font-body text-muted-ol">
          Accessible from any device on the same network via sslip.io DNS.
        </p>
      </div>

      {/* Direct Port Access */}
      {assignedPort && networkIps.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              Direct Access
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
          <p className="text-[11px] font-body text-muted-ol">
            Direct port access — works with LAN, VPN (Tailscale), or any network route.
          </p>
        </div>
      )}

      {/* Public URL */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              Public URL
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
              Remove
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
              Expose to Internet
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
          <p className="text-sm font-body text-muted-ol">
            Not exposed. Click "Expose to Internet" to generate a public URL via Cloudflare Tunnel.
          </p>
        )}

        <p className="text-[11px] font-body text-muted-ol">
          {publicUrl
            ? 'Anyone with this URL can access your project. Temporary URLs may change on restart.'
            : 'Requires the project to be running.'}
        </p>
      </div>
    </div>
  );
}
