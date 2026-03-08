import { useNavigate, useLocation } from 'react-router-dom';
import type { Project, SystemStats } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Plus, Settings, Cpu, MemoryStick, Box, Loader2, Database } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  projects: Project[];
  loading: boolean;
  stats: SystemStats | null;
}

const statusColor: Record<string, string> = {
  running: 'bg-success',
  stopped: 'bg-[var(--text-muted)]',
  building: 'bg-warning animate-pulse',
  error: 'bg-error',
};

export function Sidebar({ projects, loading, stats }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;
  const isProjectActive = (id: string) => location.pathname === `/projects/${id}`;

  return (
    <div className="flex flex-col h-full">
      <Separator className="bg-[hsl(var(--border))]" />

      {/* New Project */}
      <div className="p-2 xl:p-3 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'w-full gap-2 border-dashed border-foreground/20 text-foreground hover:bg-foreground hover:text-background hover:border-foreground/50 transition-all',
            'xl:justify-start justify-center',
          )}
          onClick={() => navigate('/projects/new')}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="hidden xl:inline text-xs font-body">New Project</span>
        </Button>
      </div>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Projects List */}
      <ScrollArea className="flex-1">
        <div className="p-2 xl:p-3 space-y-0.5">
          {loading && (
            <div className="flex items-center justify-center xl:justify-start gap-2 py-3 px-2 text-secondary-ol">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span className="hidden xl:inline text-xs font-body">Loading...</span>
            </div>
          )}

          {!loading && projects.length === 0 && (
            <div className="flex items-center justify-center xl:justify-start gap-2 py-3 px-2 text-muted-ol">
              <Box className="h-4 w-4 shrink-0" />
              <span className="hidden xl:inline text-xs font-body">No projects</span>
            </div>
          )}

          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              title={project.name}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-all duration-150',
                'xl:justify-start justify-center',
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
              <span className="hidden xl:inline text-xs font-body truncate">{project.name}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      <Separator className="bg-[hsl(var(--border))]" />

      {/* Bottom: Settings + Stats */}
      <div className="shrink-0 p-2 xl:p-3 space-y-2">
        {/* System Stats (xl only) */}
        {stats && (
          <div className="hidden xl:flex items-center gap-3 px-2.5 py-1.5 text-muted-ol">
            <div className="flex items-center gap-1" title="CPU">
              <Cpu className="h-3 w-3" />
              <span className="text-[10px] font-mono">
                {typeof stats.cpu === 'number'
                  ? `${stats.cpu.toFixed(0)}%`
                  : `${stats.cpu?.usagePercent?.toFixed(0) ?? '—'}%`}
              </span>
            </div>
            <div className="flex items-center gap-1" title="Memory">
              <MemoryStick className="h-3 w-3" />
              <span className="text-[10px] font-mono">
                {typeof stats.memory === 'number'
                  ? `${(stats.memory / (1024 * 1024 * 1024)).toFixed(1)}G`
                  : `${stats.memory?.usagePercent?.toFixed(0) ?? '—'}%`}
              </span>
            </div>
          </div>
        )}

        {/* Services Link */}
        <button
          onClick={() => navigate('/services')}
          title="Services"
          className={cn(
            'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150',
            'xl:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/services') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Database className="h-4 w-4 shrink-0" />
          <span className="hidden xl:inline text-xs font-body">Services</span>
        </button>

        {/* Settings Link */}
        <button
          onClick={() => navigate('/settings')}
          title="Settings"
          className={cn(
            'w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-all duration-150',
            'xl:justify-start justify-center',
            'hover:bg-bg-subtle',
            isActive('/settings') ? 'bg-bg-subtle text-primary-ol' : 'text-secondary-ol',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="hidden xl:inline text-xs font-body">Settings</span>
        </button>
      </div>
    </div>
  );
}
