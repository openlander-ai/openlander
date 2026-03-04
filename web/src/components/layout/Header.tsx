import { useEffect, useRef, useState } from 'react';
import { Plane, Menu, Cpu, MemoryStick, MessageSquare, Bell } from 'lucide-react';
import type { SystemStats } from '@/types';
import type { Notification } from '@/hooks/use-notifications';
import { Button } from '@/components/ui/button';
import { NotificationCenter } from './NotificationCenter';
import { cn } from '@/lib/utils';

interface HeaderProps {
  stats: SystemStats | null;
  notifications?: Notification[];
  unreadCount?: number;
  onDismissNotification?: (id: string) => Promise<void>;
  onNotificationAction?: (notification: Notification, action: string) => void;
  onMenuClick?: () => void;
  onChatToggle?: () => void;
  isChatOpen?: boolean;
}

export function Header({
  stats,
  notifications = [],
  unreadCount = 0,
  onDismissNotification,
  onNotificationAction,
  onMenuClick,
  onChatToggle,
  isChatOpen,
}: HeaderProps) {
  const [llmConnected, setLlmConnected] = useState<boolean>(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

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
    const interval = setInterval(checkHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  // Close notification dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  const formatMemory = (
    mem: number | { usedMB?: number; totalMB?: number; usagePercent?: number },
  ) => {
    if (typeof mem === 'number') {
      const gb = mem / (1024 * 1024 * 1024);
      return `${gb.toFixed(1)}G`;
    }
    if (mem?.usagePercent != null) return `${mem.usagePercent.toFixed(0)}%`;
    if (mem?.usedMB != null) return `${(mem.usedMB / 1024).toFixed(1)}G`;
    return '—';
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-12 border-b border-[hsl(var(--border))] bg-bg-app z-50 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={onMenuClick}>
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <div className="bg-agent/10 p-1 rounded-md">
            <Plane className="h-4 w-4 text-agent rotate-[-45deg]" />
          </div>
          <span className="hidden sm:inline-block font-display font-bold text-sm tracking-tight text-primary-ol">
            OpenLander
          </span>
          <span className="text-[10px] font-mono text-secondary-ol bg-bg-subtle px-1.5 py-0.5 rounded">
            v0.1
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {/* System Stats */}
        {stats && (
          <div className="hidden md:flex items-center gap-3 font-mono text-muted-ol">
            <div className="flex items-center gap-1" title="CPU Usage">
              <Cpu className="h-3 w-3" />
              <span className="text-[10px]">
                {typeof stats.cpu === 'number'
                  ? stats.cpu.toFixed(0)
                  : (stats.cpu?.usagePercent?.toFixed(0) ?? '—')}
                %
              </span>
            </div>
            <div className="flex items-center gap-1" title="Memory Usage">
              <MemoryStick className="h-3 w-3" />
              <span className="text-[10px]">{formatMemory(stats.memory)}</span>
            </div>
            <div className="w-px h-4 bg-[hsl(var(--border))]" />
          </div>
        )}

        {/* Notification Bell */}
        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 transition-all',
              showNotifications
                ? 'text-warning bg-warning/10'
                : unreadCount > 0
                  ? 'text-warning hover:bg-warning/10'
                  : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle',
            )}
            onClick={() => setShowNotifications((prev) => !prev)}
            title={`알림 ${unreadCount > 0 ? `(${unreadCount}건)` : ''}`}
          >
            <Bell className="h-3.5 w-3.5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-error text-[8px] font-mono font-bold text-white px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          {showNotifications && onDismissNotification && (
            <NotificationCenter
              notifications={notifications}
              onDismiss={onDismissNotification}
              onAction={onNotificationAction}
            />
          )}
        </div>

        {/* Ask Agent Button */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'gap-1.5 h-7 px-2.5 text-[11px] font-body transition-all',
            isChatOpen
              ? 'text-agent bg-agent/10'
              : 'text-secondary-ol hover:text-agent hover:bg-agent/10',
          )}
          onClick={onChatToggle}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Ask Agent</span>
        </Button>

        {/* LLM Status */}
        <div
          className="flex items-center gap-1.5"
          title={llmConnected ? 'LLM Connected' : 'LLM Not Configured'}
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              llmConnected
                ? 'bg-success shadow-[0_0_4px_var(--color-success)]'
                : 'bg-error shadow-[0_0_4px_var(--color-error)]',
            )}
          />
          <span className="hidden sm:inline text-[11px] font-body text-secondary-ol">
            {llmConnected ? 'AI Online' : 'AI Offline'}
          </span>
        </div>
      </div>
    </header>
  );
}
