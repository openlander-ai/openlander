import { useState, useEffect } from 'react';
import { Copy, Check, Monitor, Key, Terminal, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type Service, type NetworkIp, getAllIps } from '@/lib/api';
import { useCopy } from '@/hooks/use-copy';

interface ServiceConnectionTabProps {
  service: Service;
}

function parseRecordJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function ServiceConnectionTab({ service }: ServiceConnectionTabProps) {
  const { copy, isCopied } = useCopy();
  const [networkIps, setNetworkIps] = useState<NetworkIp[]>([]);

  useEffect(() => {
    let mounted = true;
    async function fetchIps() {
      try {
        const ips = await getAllIps();
        if (mounted) {
          setNetworkIps(ips);
        }
      } catch (error) {
        console.error('Failed to fetch network IPs:', error);
      }
    }
    void fetchIps();
    return () => {
      mounted = false;
    };
  }, []);

  const handleCopy = (text: string, fieldId: string) => {
    void copy(text, fieldId);
  };

  const creds = parseRecordJson(service.credentials);
  const parsedEnv = parseRecordJson(service.env_vars);

  const hasDetails = creds || (parsedEnv && Object.keys(parsedEnv).length > 0);

  if (!hasDetails) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Monitor className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-body text-foreground/80">
          No connection information available for this service.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {creds && (
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <h3 className="text-sm font-display font-medium text-foreground mb-4 flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            Credentials
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {Object.entries(creds).map(([key, value]) => {
              const displayKey =
                key === 'connectionString'
                  ? 'Connection String'
                  : key === 'host'
                    ? 'Host'
                    : key === 'port'
                      ? 'Port'
                      : key === 'user'
                        ? 'User'
                        : key === 'password'
                          ? 'Password'
                          : key === 'database'
                            ? 'Database'
                            : key;

              const fieldId = `${service.id}-${key}`;

              return (
                <div
                  key={key}
                  className={cn(
                    'flex flex-col gap-1.5',
                    key === 'connectionString' && 'md:col-span-2',
                  )}
                >
                  <span className="text-xs font-body text-foreground/80">{displayKey}</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-bg-panel px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] font-mono text-xs text-foreground truncate">
                      {String(value)}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 hover:bg-bg-subtle"
                      onClick={() => void handleCopy(String(value), fieldId)}
                    >
                      {isCopied(fieldId) ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {networkIps.length > 0 && typeof creds?.connectionString === 'string' && (
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <h3 className="text-sm font-display font-medium text-foreground mb-4 flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            External Access
          </h3>
          <div className="space-y-3">
            {networkIps.map((ip) => {
              const host = String(creds.host);
              const connStr = String(creds.connectionString);
              const containerPort = String(creds.port ?? '');
              const hostPort = String(service.port ?? '');
              let externalConnStr = connStr.replace(host, ip.address);
              if (containerPort && hostPort && containerPort !== hostPort) {
                externalConnStr = externalConnStr.replace(`:${containerPort}/`, `:${hostPort}/`);
              }
              const label = ip.type === 'vpn' ? `${ip.interface} (VPN)` : ip.interface;
              const fieldId = `${service.id}-ext-${ip.address}`;

              return (
                <div key={ip.address} className="flex flex-col gap-1.5">
                  <span className="text-xs font-body text-foreground/80">{label}</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-bg-panel px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] font-mono text-xs text-foreground truncate">
                      {externalConnStr}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 hover:bg-bg-subtle"
                      onClick={() => void handleCopy(externalConnStr, fieldId)}
                    >
                      {isCopied(fieldId) ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!creds && parsedEnv && Object.keys(parsedEnv).length > 0 && (
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <h3 className="text-sm font-display font-medium text-foreground mb-4 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Environment Variables
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {Object.entries(parsedEnv).map(([key, value]) => {
              const fieldId = `${service.id}-env-${key}`;
              return (
                <div key={key} className="flex items-center gap-2">
                  <code className="bg-bg-panel px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] font-mono text-xs text-foreground/80 w-1/3 truncate">
                    {key}
                  </code>
                  <code className="flex-1 bg-bg-panel px-2.5 py-1.5 rounded-md border border-[hsl(var(--border))] font-mono text-xs text-foreground truncate">
                    {String(value)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 hover:bg-bg-subtle"
                    onClick={() => void handleCopy(String(value), fieldId)}
                  >
                    {isCopied(fieldId) ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
