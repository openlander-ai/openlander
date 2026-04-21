import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../i18n/context.js';
import { Separator } from '@/components/ui/separator';
import {
  Plus,
  Settings,
  Database,
  LayoutDashboard,
  Bot,
  Search,
  ShieldAlert,
  Rocket,
  PanelLeftClose,
  PanelLeftOpen,
  FolderGit2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSetupStatus } from '@/lib/api';
import { useAgentPanel } from '@/contexts/agent-panel';
import { subscribeLlmChanged } from '@/lib/llm-events';

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [agentDisabled, setAgentDisabled] = useState(true);
  const { isOpen: isAgentPanelOpen, openPanel } = useAgentPanel();

  const refreshAgentAvailability = useCallback(() => {
    getSetupStatus()
      .then((s) => setAgentDisabled(!s.llm.ok))
      .catch(() => setAgentDisabled(true));
  }, []);

  useEffect(() => {
    refreshAgentAvailability();
    const unsubscribe = subscribeLlmChanged(() => refreshAgentAvailability());
    return () => unsubscribe();
  }, [refreshAgentAvailability]);

  const isDashboardMode = !isAgentPanelOpen;
  const isAgentMode = isAgentPanelOpen;

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      <Separator className="bg-[hsl(var(--border))]" />

      <div className={cn('shrink-0', collapsed ? 'p-2' : 'p-2 lg:p-4')} data-testid="mode-toggle">
        <div
          className={cn(
            'flex gap-1 p-1 rounded-lg bg-bg-subtle min-w-0 break-words',
            collapsed && 'flex-col',
          )}
        >
          <button
            data-testid="mode-toggle-dashboard"
            onClick={() => navigate('/projects')}
            className={cn(
              'flex-1 flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
              isDashboardMode
                ? 'bg-bg-panel text-foreground shadow-sm font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span className={cn('hidden', !collapsed && 'lg:inline')}>Dashboard</span>
          </button>
          <button
            data-testid="mode-toggle-agent"
            onClick={() => openPanel()}
            className={cn(
              'flex-1 flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
              isAgentMode
                ? 'bg-agent/10 text-agent shadow-sm font-semibold border border-agent/20'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={agentDisabled ? 'Configure API key in Settings' : 'Open Agent panel (Alt+J)'}
          >
            <Bot className="h-3.5 w-3.5" />
            <span className={cn('hidden', !collapsed && 'lg:inline')}>Agent</span>
          </button>
        </div>
        {onToggleCollapse && (
          <div className="hidden lg:flex justify-end mt-2">
            <button
              onClick={onToggleCollapse}
              title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-bg-subtle transition-colors"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Search — opens Cmd+K */}
      <div className={cn('pb-3 shrink-0', collapsed ? 'px-2' : 'px-2 lg:px-4')}>
        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            document.dispatchEvent(event);
          }}
          className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground bg-bg-subtle hover:bg-bg-subtle/80 hover:text-foreground transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className={cn('flex-1 text-left hidden', !collapsed && 'lg:inline')}>
            Search...
          </span>
          <kbd
            className={cn(
              'text-xs font-mono bg-bg-panel px-1.5 py-0.5 rounded border border-border hidden',
              !collapsed && 'lg:inline',
            )}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className={cn('space-y-1.5', collapsed ? 'p-2' : 'p-2 lg:p-4')}>
          {/* New Project */}
          <button
            onClick={() => navigate('/projects/new')}
            className={cn(
              'w-full gap-2 border-dashed border-foreground/20 text-foreground hover:bg-foreground hover:text-background hover:border-foreground/50 transition-all',
              'lg:justify-start justify-center',
              'flex items-center rounded-md px-3 py-2.5 text-sm font-body',
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className={cn('hidden', !collapsed && 'lg:inline')}>New Project</span>
          </button>

          {/* Overview Link */}
          <button
            data-testid="sidebar-nav-overview"
            onClick={() => navigate('/overview')}
            title={t('nav.overview')}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              location.pathname === '/overview'
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('nav.overview')}
            </span>
          </button>

          {/* Projects Link */}
          <button
            data-testid="sidebar-nav-projects"
            onClick={() => navigate('/projects')}
            title={t('nav.projects') || 'Projects'}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              location.pathname === '/projects' ||
                (location.pathname.startsWith('/projects/') &&
                  location.pathname !== '/projects/new')
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FolderGit2 className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('nav.projects') || 'Projects'}
            </span>
          </button>

          {/* Deployments Link */}
          <button
            data-testid="sidebar-nav-deployments"
            onClick={() => navigate('/deployments')}
            title={t('nav.deployments')}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              location.pathname === '/deployments' || location.pathname.startsWith('/deployments/')
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Rocket className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('nav.deployments')}
            </span>
          </button>

          {/* Services Link */}
          <button
            onClick={() => navigate('/services')}
            title={t('services.title')}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              isActive('/services')
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Database className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('services.title')}
            </span>
          </button>

          {/* Operations Center */}
          <button
            onClick={() => navigate('/operations')}
            title={t('settings.tabs.operations')}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              isActive('/operations')
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('settings.tabs.operations')}
            </span>
          </button>

          {/* Settings Link */}
          <button
            onClick={() => navigate('/settings')}
            title={t('settings.title')}
            className={cn(
              'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
              'lg:justify-start justify-center',
              'hover:bg-bg-subtle',
              isActive('/settings')
                ? 'bg-bg-subtle text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
              {t('settings.title')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
