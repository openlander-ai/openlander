import React from 'react';
import { Globe, Wifi, Shield, ExternalLink, ChevronDown, Copy, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useCopy } from '@/hooks/use-copy';
import { cn } from '@/lib/utils';

interface UrlItem {
  url: string;
  type: string;
  ip: string;
}

interface DomainUrlDisplayProps {
  urls?: UrlItem[];
  publicUrl?: string | null;
  className?: string;
}

export function DomainUrlDisplay({ urls = [], publicUrl, className }: DomainUrlDisplayProps) {
  const { copy, isCopied } = useCopy();
  const allUrls: Array<{ url: string; type: string; label: string; icon: React.ElementType }> = [];

  if (publicUrl) {
    allUrls.push({
      url: publicUrl,
      type: 'public',
      label: 'Public',
      icon: Globe,
    });
  }

  const lanUrls = urls.filter((u) => u.type === 'lan');
  for (const u of lanUrls) {
    allUrls.push({
      url: u.url,
      type: 'lan',
      label: 'LAN',
      icon: Wifi,
    });
  }

  const vpnUrls = urls.filter((u) => u.type === 'vpn');
  for (const u of vpnUrls) {
    allUrls.push({
      url: u.url,
      type: 'vpn',
      label: 'VPN',
      icon: Shield,
    });
  }

  if (allUrls.length === 0) {
    return null;
  }

  const primaryUrl = allUrls[0];
  if (!primaryUrl) return null;

  const additionalUrls = allUrls.slice(1);
  const PrimaryIcon = primaryUrl.icon;

  if (allUrls.length === 1) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <a
          href={primaryUrl.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-bg-panel hover:bg-bg-subtle text-secondary-ol hover:text-primary-ol transition-colors border border-border shadow-sm"
          title={`Open ${primaryUrl.label} URL`}
        >
          <PrimaryIcon className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
          <span className="font-mono tracking-tight text-[11px] truncate max-w-[200px]">
            {primaryUrl.url.replace(/^https?:\/\//, '')}
          </span>
          <ExternalLink className="h-3 w-3 opacity-40 ml-0.5 group-hover:opacity-100 transition-opacity" />
        </a>
        <button
          onClick={() => copy(primaryUrl.url, primaryUrl.url)}
          className="p-1.5 text-muted-foreground hover:text-primary hover:bg-subtle rounded-md transition-colors"
          title="Copy URL"
        >
          {isCopied(primaryUrl.url) ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-bg-panel hover:bg-bg-subtle text-secondary-ol hover:text-primary-ol transition-colors border border-border shadow-sm">
            <PrimaryIcon className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition-opacity" />
            <span className="font-mono tracking-tight text-[11px] truncate max-w-[200px] text-left">
              {primaryUrl.url.replace(/^https?:\/\//, '')}
            </span>
            <span className="ml-[1px] flex items-center justify-center h-[18px] px-1.5 rounded-[4px] bg-bg-app text-[10px] text-secondary-ol font-semibold border border-transparent group-hover:border-border transition-colors">
              +{additionalUrls.length}
            </span>
            <ChevronDown className="h-3 w-3 opacity-40 ml-0.5 group-hover:opacity-100 transition-opacity" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[320px] p-0 shadow-lg border-border rounded-xl bg-bg-panel overflow-hidden"
          sideOffset={6}
        >
          <div className="bg-bg-subtle px-3 py-2.5 border-b border-border">
            <h4 className="text-[13px] font-semibold text-primary-ol">Deployment URLs</h4>
            <p className="text-[11px] text-muted-ol mt-0.5">
              Explore your service across available networks.
            </p>
          </div>
          <div className="p-1.5 flex flex-col gap-0.5 max-h-[260px] overflow-y-auto">
            {allUrls.map((item, idx) => {
              const Icon = item.icon;
              const isItemCopied = isCopied(item.url);

              return (
                <div
                  key={`${item.url}-${idx}`}
                  className="group relative flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-bg-subtle transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="flex items-center justify-center h-7 w-7 rounded-md bg-bg-panel border border-[hsl(var(--border))] shadow-sm shrink-0">
                      <Icon className="h-3.5 w-3.5 text-secondary-ol" />
                    </div>
                    <div className="flex flex-col min-w-0 -mt-0.5">
                      <span className="text-[10px] font-semibold tracking-wide text-muted-ol uppercase mb-[1px]">
                        {item.label}
                      </span>
                      <span className="text-[11px] font-mono text-primary-ol truncate cursor-default">
                        {item.url.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        copy(item.url, item.url);
                      }}
                      className="flex items-center justify-center h-7 w-7 text-secondary-ol hover:text-primary-ol hover:bg-bg-panel rounded-md transition-colors border border-transparent hover:border-border shadow-none hover:shadow-sm"
                      title="Copy URL"
                    >
                      {isItemCopied ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center h-7 w-7 text-secondary-ol hover:text-primary-ol hover:bg-bg-panel rounded-md transition-colors border border-transparent hover:border-border shadow-none hover:shadow-sm"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
