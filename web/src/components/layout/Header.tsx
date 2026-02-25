import { useEffect, useState } from 'react';
import { Plane, Menu, Cpu, MemoryStick } from 'lucide-react';
import type { SystemStats } from '@/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HeaderProps {
  stats: SystemStats | null;
  onMenuClick?: () => void;
}

export function Header({ stats, onMenuClick }: HeaderProps) {
  const [llmConnected, setLlmConnected] = useState<boolean>(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json();
          setLlmConnected(data.llmConfigured === true);
        }
      } catch (e) {
        console.error('Health check failed', e);
        setLlmConnected(false);
      }
    };

    checkHealth();
    // Poll health every 60s
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  const formatMemory = (mem: number | { usedMB?: number; totalMB?: number; usagePercent?: number }) => {
    if (typeof mem === 'number') {
      const gb = mem / (1024 * 1024 * 1024);
      return `${gb.toFixed(1)} GB`;
    }
    if (mem?.usagePercent != null) return `${mem.usagePercent.toFixed(0)}%`;
    if (mem?.usedMB != null) return `${(mem.usedMB / 1024).toFixed(1)} GB`;
    return '—';
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-12 border-b bg-background z-50 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 font-semibold">
          <div className="bg-primary/10 p-1 rounded-md">
            <Plane className="h-5 w-5 text-primary rotate-[-45deg]" />
          </div>
          <span className="hidden sm:inline-block">OpenLander</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            v0.1
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {stats && (
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-1.5" title="CPU Usage">
              <Cpu className="h-3.5 w-3.5" />
              <span>{typeof stats.cpu === 'number' ? stats.cpu.toFixed(0) : stats.cpu?.usagePercent?.toFixed(0) ?? '—'}%</span>
            </div>
            <div className="flex items-center gap-1.5" title="Memory Usage">
              <MemoryStick className="h-3.5 w-3.5" />
              <span>{formatMemory(stats.memory)}</span>
            </div>
            <div className="w-px h-4 bg-border" />
          </div>
        )}

        <div
          className="flex items-center gap-2"
          title={llmConnected ? 'LLM Connected' : 'LLM Not Configured'}
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              llmConnected ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]' : 'bg-red-500',
            )}
          />
          <span className="hidden sm:inline">{llmConnected ? 'AI Online' : 'AI Offline'}</span>
        </div>
      </div>
    </header>
  );
}
