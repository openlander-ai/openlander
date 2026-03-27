import React from 'react';
import { Globe, Wifi, Shield, ExternalLink } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
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
  // Build the ordered list of URLs based on priority
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
  const additionalUrls = allUrls.slice(1);

  const PrimaryIcon = primaryUrl.icon;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <a
        href={primaryUrl.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs font-body text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <PrimaryIcon className="h-3.5 w-3.5" />
        <span className="truncate max-w-[200px]">{primaryUrl.url.replace(/^https?:\/\//, '')}</span>
      </a>

      {additionalUrls.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center justify-center h-5 px-1.5 rounded-md bg-zinc-800/50 border border-zinc-700/50 text-[10px] font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
              +{additionalUrls.length}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-2 bg-zinc-900/95 border-zinc-800/80 backdrop-blur-md"
          >
            <div className="flex flex-col gap-1">
              {allUrls.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <a
                    key={`${item.url}-${idx}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-4 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300" />
                      <span className="text-xs font-body text-zinc-300 group-hover:text-zinc-100">
                        {item.url.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {item.label}
                      </span>
                      <ExternalLink className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400" />
                    </div>
                  </a>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
