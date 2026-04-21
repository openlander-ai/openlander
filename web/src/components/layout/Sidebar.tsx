import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../../i18n/context.js';
import type { Project } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Plus,
  Settings,
  Box,
  Loader2,
  Database,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  Bot,
  Search,
  ShieldAlert,
  Rocket,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSetupStatus } from '@/lib/api';
import { useAgentPanel } from '@/contexts/agent-panel';
import { formatRelativeTime } from '@/lib/time';
import { subscribeLlmChanged } from '@/lib/llm-events';
import { getStatusDisplay } from '@/lib/status-config';

type SidebarProject = Project;

interface SidebarProps {
  projects: SidebarProject[];
  loading: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/* Project-status dot class sourced from centralized status-config. */
const statusDotClass = (status: string) => getStatusDisplay(status).dot;

const VISIBILITY_ORDER: Record<string, number> = {
  production: 0,
  shared: 1,
  'quick-share': 2,
  internal: 3,
};

const STATUS_ORDER: Record<string, number> = {
  error: 0,
  building: 1,
  running: 2,
  idle: 3,
  stopped: 4,
};

function normalizeRepoUrl(url: string) {
  let normalized = url.toLowerCase();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/\.git$/, '');
  return normalized;
}

function getRepoName(normalizedUrl: string) {
  const parts = normalizedUrl.split('/');
  if (parts.length >= 3) {
    return parts.slice(-2).join('/');
  }
  return normalizedUrl;
}

function sortProjects(a: Project, b: Project) {
  const visA = VISIBILITY_ORDER[a.visibility] ?? 99;
  const visB = VISIBILITY_ORDER[b.visibility] ?? 99;
  if (visA !== visB) return visA - visB;

  const statA = STATUS_ORDER[a.status] ?? 99;
  const statB = STATUS_ORDER[b.status] ?? 99;
  if (statA !== statB) return statA - statB;

  return a.name.localeCompare(b.name);
}

export function Sidebar({ projects, loading, collapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [groupState, setGroupState] = useState<Record<string, boolean>>({});
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
  const isProjectActive = (id: string) => location.pathname === `/projects/${id}`;

  const children = projects.filter((p) => p.parentProjectId);
  const topLevel = projects.filter((p) => !p.parentProjectId);

  const composeParents = topLevel.filter((p) => p.isCompose);
  const standalone = topLevel.filter((p) => !p.isCompose);

  const tempGroups = new Map<string, SidebarProject[]>();
  for (const p of standalone) {
    const url = p.repoUrl ? normalizeRepoUrl(p.repoUrl) : 'unknown';
    if (!tempGroups.has(url)) tempGroups.set(url, []);
    tempGroups.get(url)!.push(p);
  }

  const repoGroups = new Map<string, SidebarProject[]>();
  const singletons: SidebarProject[] = [];

  for (const [url, projs] of tempGroups.entries()) {
    if (projs.length >= 2) {
      repoGroups.set(url, projs.sort(sortProjects));
    } else {
      singletons.push(...projs);
    }
  }
  singletons.sort(sortProjects);
  composeParents.sort(sortProjects);

  const getComposeStatus = (children: SidebarProject[]) => {
    if (children.some((c) => c.status === 'error')) return 'error';
    if (children.some((c) => c.status === 'building')) return 'building';
    if (children.length > 0 && children.every((c) => c.status === 'running')) return 'running';
    return 'stopped';
  };

  const isGroupOpen = (key: string, projs: SidebarProject[]) => {
    if (groupState[key] !== undefined) return groupState[key];
    const hasActive = projs.some((p) => isProjectActive(p.id)) || isProjectActive(key);
    const hasErrorOrBuilding = projs.some((p) => p.status === 'error' || p.status === 'building');
    return hasActive || hasErrorOrBuilding;
  };

  const toggleGroup = (key: string, projs: SidebarProject[]) => {
    setGroupState((prev) => ({
      ...prev,
      [key]: !isGroupOpen(key, projs),
    }));
  };

  const renderProjectItem = (project: SidebarProject) => {
    let tooltip = project.name;
    if (project.status === 'error') {
      const timeStr = project.updatedAt ? formatRelativeTime(project.updatedAt) : '';
      tooltip = timeStr
        ? `${project.name} — Error since ${timeStr}. Click to view.`
        : `${project.name} — Error. Click to view.`;
    } else if (project.status === 'building') {
      tooltip = `${project.name} — Building...`;
    }

    return (
      <div key={project.id}>
        <button
          onClick={() => navigate(`/projects/${project.id}`)}
          title={tooltip}
          className={cn(
            'w-full flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 lg:text-left transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isProjectActive(project.id)
              ? 'bg-bg-subtle text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <div className={cn('h-2 w-2 rounded-full shrink-0', statusDotClass(project.status))} />
          <span
            className={cn('flex-1 text-xs font-body truncate hidden', !collapsed && 'lg:block')}
          >
            {project.name}
          </span>
        </button>
      </div>
    );
  };

  // Flat list for collapsed mode (lg:hidden)
  const allSortedProjects = [...projects].sort(sortProjects);

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

      <ScrollArea className="flex-1">
        <div className={cn('space-y-1', collapsed ? 'p-2' : 'p-2 lg:p-4')}>
          {loading && (
            <div className="flex items-center justify-center lg:justify-start gap-3 py-3 px-3 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
                Loading...
              </span>
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="flex items-center justify-center lg:justify-start gap-3 py-3 px-3 text-muted-foreground">
              <Box className="h-4 w-4 shrink-0" />
              <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
                No projects
              </span>
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="flex items-center justify-center lg:justify-start gap-3 py-3 px-3 text-muted-foreground">
              <Box className="h-4 w-4 shrink-0" />
              <span className={cn('text-sm font-body hidden', !collapsed && 'lg:inline')}>
                No projects
              </span>
            </div>
          )}

          {/* Flat list for collapsed mode (< lg or collapsed) */}
          <div className={cn('space-y-0.5', !collapsed && 'lg:hidden')}>
            {allSortedProjects.map((p) => renderProjectItem(p))}
          </div>

          {/* Grouped list for expanded mode (>= lg and not collapsed) */}
          <div className={cn('space-y-4 hidden', !collapsed && 'lg:block')}>
            {composeParents.map((parent) => {
              const parentChildren = children
                .filter((c) => c.parentProjectId === parent.id)
                .sort(sortProjects);
              const open = isGroupOpen(parent.id, parentChildren);
              const status = getComposeStatus(parentChildren);

              return (
                <div key={parent.id} className="space-y-0.5">
                  <button
                    onClick={() => {
                      navigate(`/projects/${parent.id}`);
                      toggleGroup(parent.id, parentChildren);
                    }}
                    title={parent.name}
                    className={cn(
                      'w-full flex min-w-0 items-center gap-2 px-3 py-2 lg:text-left transition-colors group',
                      'lg:justify-start justify-center',
                      isProjectActive(parent.id)
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <div className={cn('h-2 w-2 rounded-full shrink-0', statusDotClass(status))} />
                    <span className="flex-1 text-sm font-medium truncate">{parent.name}</span>
                    <span className="text-xs bg-bg-subtle px-1.5 py-0.5 rounded-full ml-auto group-hover:bg-foreground/10 transition-colors">
                      {parentChildren.length}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-0.5 pl-2 border-l border-border/50 ml-3 mt-1">
                      {parentChildren.map((p) => renderProjectItem(p))}
                    </div>
                  )}
                </div>
              );
            })}

            {Array.from(repoGroups.entries()).map(([url, projs]) => {
              const visibleProjs = projs;

              const open = isGroupOpen(url, projs);
              const repoName = getRepoName(url);

              return (
                <div key={url} className="space-y-0.5">
                  <button
                    onClick={() => toggleGroup(url, projs)}
                    title={repoName}
                    className={cn(
                      'w-full flex min-w-0 items-center gap-2 px-3 py-2 lg:text-left transition-colors group',
                      'lg:justify-start justify-center',
                      'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex-1 text-sm font-medium truncate">{repoName}</span>
                    <span className="text-xs bg-bg-subtle px-1.5 py-0.5 rounded-full ml-auto group-hover:bg-foreground/10 transition-colors">
                      {visibleProjs.length}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-0.5 pl-2 border-l border-border/50 ml-3 mt-1">
                      {visibleProjs.map((p) => renderProjectItem(p))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Singletons */}
            <div className="space-y-0.5">{singletons.map((p) => renderProjectItem(p))}</div>
          </div>
        </div>
      </ScrollArea>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Bottom: New Project + Services + Settings */}
      <div className={cn('shrink-0 space-y-1.5', collapsed ? 'p-2' : 'p-2 lg:p-4')}>
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
  );
}
