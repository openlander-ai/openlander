import { useState } from 'react';
import type { Project } from '@/types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { stopProject, deleteProject, exposeProject, unexposeProject } from '@/lib/api';
import { Square, Trash2, Globe, Globe2, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProjectCardProps {
  project: Project;
  onUpdate: () => void;
}

export function ProjectCard({ project, onUpdate }: ProjectCardProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const handleStop = async () => {
    if (loadingAction) return;
    setLoadingAction('stop');
    try {
      await stopProject(project.id);
      onUpdate();
    } catch (error) {
      console.error('Failed to stop project:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async () => {
    if (loadingAction) return;
    if (!confirm('Are you sure you want to delete this project?')) return;
    setLoadingAction('delete');
    try {
      await deleteProject(project.id);
      onUpdate();
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleExposeToggle = async () => {
    if (loadingAction) return;
    setLoadingAction('expose');
    try {
      if (project.publicUrl) {
        await unexposeProject(project.id);
      } else {
        await exposeProject(project.id);
      }
      onUpdate();
    } catch (error) {
      console.error('Failed to toggle exposure:', error);
    } finally {
      setLoadingAction(null);
    }
  };

  const statusColors = {
    running: 'bg-green-500',
    stopped: 'bg-gray-500',
    building: 'bg-yellow-500',
    error: 'bg-red-500',
  };

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold truncate" title={project.name}>
            {project.name}
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              'capitalize',
              statusColors[project.status] || 'bg-gray-500',
              'text-white border-none',
            )}
          >
            {project.status}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate" title={project.repoUrl}>
          {project.repoUrl.replace('https://', '').replace('http://', '')}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-2">
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-xs text-blue-500 hover:underline truncate"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            {project.url}
          </a>
        )}
        {project.publicUrl && (
          <a
            href={project.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-xs text-green-600 hover:underline truncate"
          >
            <Globe className="w-3 h-3 mr-1" />
            {project.publicUrl}
          </a>
        )}
      </CardContent>
      <CardFooter className="p-2 bg-muted/50 flex justify-end space-x-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleStop}
          disabled={project.status === 'stopped' || !!loadingAction}
          title="Stop"
        >
          {loadingAction === 'stop' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleExposeToggle}
          disabled={project.status !== 'running' || !!loadingAction}
          title={project.publicUrl ? 'Unexpose' : 'Expose'}
        >
          {loadingAction === 'expose' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : project.publicUrl ? (
            <Globe2 className="h-4 w-4 text-green-600" />
          ) : (
            <Globe className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-100"
          onClick={handleDelete}
          disabled={!!loadingAction}
          title="Delete"
        >
          {loadingAction === 'delete' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
