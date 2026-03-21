import { useState } from 'react';
import type { Project } from '@/types';
import { ProjectCard } from './ProjectCard';
import { DeployDialog } from './DeployDialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface ProjectSidebarProps {
  projects: Project[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function ProjectSidebar({ projects, loading, error, onRefresh }: ProjectSidebarProps) {
  const [isDeployOpen, setIsDeployOpen] = useState(false);

  return (
    <div className="w-[280px] h-screen border-r bg-background flex flex-col">
      <div className="p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
        <Button variant="ghost" size="icon" onClick={() => setIsDeployOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {loading && (
            <div className="text-sm text-muted-foreground text-center">Loading projects...</div>
          )}
          {error && <div className="text-sm text-red-500 text-center">{error}</div>}
          {!loading && !error && projects.length === 0 && (
            <div className="text-sm text-muted-foreground text-center">No projects deployed.</div>
          )}
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onUpdate={onRefresh} />
          ))}
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-4 text-xs text-muted-foreground text-center">
        {projects.length} project{projects.length !== 1 ? 's' : ''} running
      </div>
      <DeployDialog
        open={isDeployOpen}
        onOpenChange={setIsDeployOpen}
        onDeploySuccess={onRefresh}
      />
    </div>
  );
}
