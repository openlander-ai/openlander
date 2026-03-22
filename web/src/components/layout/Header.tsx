import { useEffect, useRef, useState } from 'react';
import { Menu, Cpu, MemoryStick, Bell, HardDrive } from 'lucide-react';
import type { SystemStats } from '@/types';
import type { Notification } from '@/hooks/use-notifications';
import { Button } from '@/components/ui/button';
import { NotificationCenter } from './NotificationCenter';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { useNavigate } from 'react-router-dom';
import { Logo } from '@/components/icons/Logo';

interface HeaderProps {
  stats: SystemStats | null;
  notifications?: Notification[];
  unreadCount?: number;
  onDismissNotification?: (id: string) => Promise<void>;
  onNotificationAction?: (notification: Notification, action: string) => void;
  onMenuClick?: () => void;
}

export function Header({
  stats,
  notifications = [],
  unreadCount = 0,
  onDismissNotification,
  onNotificationAction,
  onMenuClick,
}: HeaderProps) {
  const [llmConnected, setLlmConnected] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json();
          setLlmConnected(data.llmConfigured === true);
          if (data.version) setVersion(data.version);
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

  // Close notification dropdown on outside click or Escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowNotifications(false);
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
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
        <div
          className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={() => navigate('/projects')}
        >
          <div className="bg-agent/10 p-1 rounded-md shrink-0">
            <Logo className="h-4 w-4 text-agent" />
          </div>
          <span className="font-display font-bold text-sm text-primary-ol tracking-tight">
            OpenLander
          </span>
          {version && (
            <span className="px-1.5 py-0.5 rounded-md bg-bg-subtle text-[10px] font-mono text-muted-ol border border-[hsl(var(--border))]">
              v{version}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 ml-2"
          onClick={onMenuClick}
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {/* System Stats */}
        {stats && (
          <div className="hidden md:flex items-center gap-3 font-mono text-muted-ol">
            <div className="flex items-center gap-1" title={'CPU Usage'}>
              <Cpu className="h-3 w-3" />
              <span className="text-[10px]">
                {typeof stats.cpu === 'number'
                  ? stats.cpu.toFixed(0)
                  : (stats.cpu?.usagePercent?.toFixed(0) ?? '—')}
                %
              </span>
            </div>
            <div className="flex items-center gap-1" title={'Memory Usage'}>
              <MemoryStick className="h-3 w-3" />
              <span className="text-[10px]">{formatMemory(stats.memory)}</span>
            </div>
            {stats.disk && (
              <div
                className={cn(
                  'flex items-center gap-1',
                  stats.disk.usagePercent > 80 ? 'text-warning' : '',
                )}
                title={'Disk Usage'}
              >
                <HardDrive className="h-3 w-3" />
                <span className="text-[10px]">
                  {stats.disk.usedGB.toFixed(1)}G / {stats.disk.totalGB.toFixed(1)}G (
                  {stats.disk.usagePercent.toFixed(0)}%)
                </span>
              </div>
            )}
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
            title={`Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
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

        {/* LLM Status */}
        <div
          className="flex items-center gap-1.5"
          title={
            llmConnected === null
              ? 'Checking LLM...'
              : llmConnected
                ? 'LLM Connected'
                : t('header.llmNotConfigured')
          }
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full transition-colors duration-300',
              llmConnected === null
                ? 'bg-muted-foreground/40'
                : llmConnected
                  ? 'bg-ai animate-pulse shadow-[0_0_6px_rgba(244,63,94,0.4)]'
                  : 'bg-error',
            )}
          />
          <span className="hidden sm:inline text-[11px] font-body text-secondary-ol">
            {llmConnected === null ? '...' : llmConnected ? 'AI Online' : 'AI Offline'}
          </span>
        </div>
      </div>
    </header>
  );
}
