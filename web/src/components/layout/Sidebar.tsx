import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Project } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSetupStatus } from '@/lib/api';
import { useChatSessions } from '@/hooks/use-chat-sessions';
import { ChatSidebar } from '@/components/agent/ChatSidebar';
import { formatRelativeTime } from '@/lib/time';

interface SidebarProps {
  projects: Project[];
  loading: boolean;
}

const statusColor: Record<string, string> = {
  running: 'bg-success',
  stopped: 'bg-[var(--text-muted)]',
  building: 'bg-warning animate-pulse',
  error: 'bg-error',
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

  const { sessions, activeSessionId, createSession, switchSession, deleteSession } =
    useChatSessions();

  useEffect(() => {
    getSetupStatus()
      .then((s) => setAgentDisabled(!s.llm.ok))
      .catch(() => setAgentDisabled(true));
  }, []);

  const isDashboardMode = !location.pathname.startsWith('/agent');
  const isAgentMode = location.pathname.startsWith('/agent');

  const isActive = (path: string) => location.pathname === path;
  const isProjectActive = (id: string) => location.pathname === `/projects/${id}`;

  const issueProjects: Project[] = [];
  const normalProjects: Project[] = [];

  for (const p of projects) {
    if (p.status === 'error' || p.status === 'building') {
      issueProjects.push(p);
    } else {
      normalProjects.push(p);
    }
  }

  issueProjects.sort(sortProjects);

  const tempGroups = new Map<string, Project[]>();
  for (const p of normalProjects) {
    const url = p.repoUrl ? normalizeRepoUrl(p.repoUrl) : 'unknown';
    if (!tempGroups.has(url)) tempGroups.set(url, []);
    tempGroups.get(url)!.push(p);
  }

  const groups = new Map<string, Project[]>();
  const singletons: Project[] = [];

  for (const [url, projs] of tempGroups.entries()) {
    if (projs.length >= 2) {
      groups.set(url, projs.sort(sortProjects));
    } else {
      singletons.push(...projs);
    }
  }
  singletons.sort(sortProjects);

  const isGroupOpen = (url: string, projs: Project[]) => {
    if (groupState[url] !== undefined) return groupState[url];
    const hasActive = projs.some((p) => isProjectActive(p.id));
    const hasErrorOrBuilding = projs.some((p) => p.status === 'error' || p.status === 'building');
    return hasActive || hasErrorOrBuilding;
  };

  const toggleGroup = (url: string, projs: Project[]) => {
    setGroupState((prev) => ({
      ...prev,
      [url]: !isGroupOpen(url, projs),
    }));
  };

  const renderProjectItem = (project: Project) => {
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
      <button
        key={project.id}
        onClick={() => navigate(`/projects/${project.id}`)}
        title={tooltip}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-all duration-150',
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
        <span className="hidden lg:inline text-xs font-body truncate">{project.name}</span>
      </button>
    );
  };

  // Flat list for collapsed mode (lg:hidden)
  const allSortedProjects = [...projects].sort(sortProjects);

  return (
    <div className="flex flex-col h-full">
      <Separator className="bg-[hsl(var(--border))]" />

      <div className="p-2 lg:p-3 shrink-0" data-testid="mode-toggle">
        <div className="flex gap-1 p-1 rounded-lg bg-bg-subtle">
          <button
            data-testid="mode-toggle-dashboard"
            onClick={() => navigate('/projects')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
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
            onClick={() => !agentDisabled && navigate('/agent')}
            disabled={agentDisabled}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
              isAgentMode
                ? 'bg-agent/10 text-agent shadow-sm font-semibold border border-agent/20'
                : 'text-muted-ol hover:text-secondary-ol',
              agentDisabled && 'opacity-50 cursor-not-allowed',
            )}
            title={agentDisabled ? 'Configure API key in Settings' : undefined}
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Agent</span>
          </button>
        </div>
      </div>

      {/* New Project */}
      <div className="p-2 lg:p-3 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'w-full gap-2 border-dashed border-foreground/20 text-foreground hover:bg-foreground hover:text-background hover:border-foreground/50 transition-all',
            'lg:justify-start justify-center',
          )}
          onClick={() => navigate('/projects/new')}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-xs font-body">New Project</span>
        </Button>
      </div>

      <Separator className="bg-[hsl(var(--border))]" />

      {isAgentMode ? (
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewChat={() => createSession()}
          onSelectSession={(id) => switchSession(id)}
          onDeleteSession={(id) => void deleteSession(id)}
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-2 lg:p-3 space-y-0.5">
            {loading && (
              <div className="flex items-center justify-center lg:justify-start gap-2 py-3 px-2 text-secondary-ol">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span className="hidden lg:inline text-xs font-body">Loading...</span>
              </div>
            )}

            {!loading && projects.length === 0 && (
              <div className="flex items-center justify-center lg:justify-start gap-2 py-3 px-2 text-muted-ol">
                <Box className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline text-xs font-body">No projects</span>
              </div>
            )}

            {/* Flat list for collapsed mode (< lg) */}
            <div className="lg:hidden space-y-0.5">{allSortedProjects.map(renderProjectItem)}</div>

            {/* Grouped list for expanded mode (>= lg) */}
            <div className="hidden lg:block space-y-4">
              {issueProjects.length > 0 && (
                <div className="space-y-0.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-ol px-3 py-1">
                    ⚠️ Issues ({issueProjects.length})
                  </div>
                  {issueProjects.map(renderProjectItem)}
                </div>
              )}

              {Array.from(groups.entries()).map(([url, projs]) => {
                const visibleProjs = projs;

                const open = isGroupOpen(url, projs);
                const repoName = getRepoName(url);

                return (
                  <div key={url} className="space-y-0.5">
                    <button
                      onClick={() => toggleGroup(url, projs)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-muted-ol hover:text-secondary-ol transition-colors group"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="text-xs font-medium truncate">{repoName}</span>
                      <span className="text-[10px] bg-bg-subtle px-1.5 py-0.5 rounded-full ml-auto group-hover:bg-foreground/10 transition-colors">
                        {visibleProjs.length}
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-0.5 pl-2 border-l border-border/50 ml-3 mt-1">
                        {visibleProjs.map(renderProjectItem)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Singletons */}
              <div className="space-y-0.5">{singletons.map(renderProjectItem)}</div>
            </div>
          </div>
        </ScrollArea>
      )}

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Bottom: Settings + Stats */}
      <div className="shrink-0 p-2 lg:p-3 space-y-2">
        {/* Services Link */}
        <button
          onClick={() => navigate('/services')}
          title="Services"
          className={cn(
            'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/services') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Database className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-xs font-body">Services</span>
        </button>

        {/* Settings Link */}
        <button
          onClick={() => navigate('/settings')}
          title="Settings"
          className={cn(
            'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150',
            'lg:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/settings') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="hidden lg:inline text-xs font-body">Settings</span>
        </button>
      </div>
    </div>
  );
}
