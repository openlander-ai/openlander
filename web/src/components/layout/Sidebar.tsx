import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSetupStatus } from '@/lib/api';
import { useAgentPanel } from '@/contexts/agent-panel';
import { formatRelativeTime } from '@/lib/time';
import { subscribeLlmChanged } from '@/lib/llm-events';

type SidebarProject = Project;

interface SidebarProps {
  projects: SidebarProject[];
  loading: boolean;
}

const statusColor: Record<string, string> = {
  running: 'bg-success animate-pulse',
  stopped: 'bg-[var(--text-muted)]',
  building: 'bg-warning animate-pulse-ring',
  error: 'bg-error',
  idle: 'bg-[var(--text-muted)]',
};

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

export function Sidebar({ projects, loading }: SidebarProps) {
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
            isProjectActive(project.id) ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <div
            className={cn(
              'h-2 w-2 rounded-full shrink-0',
              statusColor[project.status] ?? 'bg-[var(--text-muted)]',
            )}
          />
          <span className="hidden lg:block flex-1 text-xs font-body truncate">{project.name}</span>
        </button>
      </div>
    );
  };

  // Flat list for collapsed mode (lg:hidden)
  const allSortedProjects = [...projects].sort(sortProjects);

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      <Separator className="bg-[hsl(var(--border))]" />

      <div className="p-2 lg:p-4 shrink-0" data-testid="mode-toggle">
        <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle min-w-0 break-words">
          <button
            data-testid="mode-toggle-dashboard"
            onClick={() => navigate('/projects')}
            className={cn(
              'flex-1 flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
              isDashboardMode
                ? 'bg-bg-panel text-primary-ol shadow-sm font-semibold'
                : 'text-muted-ol hover:text-secondary-ol',
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Dashboard</span>
          </button>
          <button
            data-testid="mode-toggle-agent"
            onClick={() => openPanel()}
            className={cn(
              'flex-1 flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all',
              isAgentMode
                ? 'bg-agent/10 text-agent shadow-sm font-semibold border border-agent/20'
                : 'text-muted-ol hover:text-secondary-ol',
            )}
            title={agentDisabled ? 'Configure API key in Settings' : 'Open Agent panel (Alt+J)'}
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Agent</span>
          </button>
        </div>
      </div>

      {/* Search — opens Cmd+K */}
      <div className="px-2 lg:px-4 pb-3 shrink-0">
        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
            document.dispatchEvent(event);
          }}
          className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-ol bg-bg-subtle hover:bg-bg-subtle/80 transition-colors"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden lg:inline flex-1 text-left">Search...</span>
          <kbd className="hidden lg:inline text-xs font-mono bg-bg-panel px-1.5 py-0.5 rounded border border-border">
            ⌘K
          </kbd>
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 lg:p-4 space-y-1">
          {loading && (
            <div className="flex items-center justify-center lg:justify-start gap-3 py-3 px-3 text-secondary-ol">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span className="hidden lg:inline text-sm font-body">Loading...</span>
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="flex items-center justify-center lg:justify-start gap-3 py-3 px-3 text-muted-ol">
              <Box className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline text-sm font-body">No projects</span>
            </div>
          )}

          {/* Flat list for collapsed mode (< lg) */}
          <div className="lg:hidden space-y-0.5">
            {allSortedProjects.map((p) => renderProjectItem(p))}
          </div>

          {/* Grouped list for expanded mode (>= lg) */}
          <div className="hidden lg:block space-y-4">
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
                        ? 'text-primary-ol'
                        : 'text-muted-ol hover:text-secondary-ol',
                    )}
                  >
                    {open ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        statusColor[status] ?? 'bg-[var(--text-muted)]',
                      )}
                    />
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
                      'text-muted-ol hover:text-secondary-ol',
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
      <div className="shrink-0 p-2 lg:p-4 space-y-1.5">
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
          <span className="hidden lg:inline">New Project</span>
        </button>

        {/* Services Link */}
        <button
          onClick={() => navigate('/services')}
          title="Services"
          className={cn(
            'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/services') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Database className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-sm font-body">Services</span>
        </button>

        {/* Operations Center */}
        <button
          onClick={() => navigate('/operations')}
          title="Operations Center"
          className={cn(
            'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/operations') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-sm font-body">Operations</span>
        </button>

        {/* Settings Link */}
        <button
          onClick={() => navigate('/settings')}
          title="Settings"
          className={cn(
            'w-full flex items-center gap-3 rounded-md px-3 py-2.5 transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/settings') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-sm font-body">Settings</span>
        </button>
      </div>
    </div>
  );
}
