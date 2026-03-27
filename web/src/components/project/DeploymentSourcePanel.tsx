import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { updateProject, getProject, type ProjectWithOptionalEnvironments } from '@/lib/api';
import { Loader2, Save, GitBranch, Box } from 'lucide-react';

interface DeploymentSourcePanelProps {
  projectId: string;
}

export function DeploymentSourcePanel({ projectId }: DeploymentSourcePanelProps) {
  const [project, setProject] = useState<ProjectWithOptionalEnvironments | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState('');
  const [containerPort, setContainerPort] = useState('');
  const [imageCmd, setImageCmd] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchProject = useCallback(async () => {
    try {
      const data = await getProject(projectId);
      setProject(data);
      setImageUrl(data.imageUrl || '');
      setContainerPort(data.containerPort?.toString() || '');
      setImageCmd(data.imageCmd?.join(' ') || '');
    } catch (err) {
      console.error('Failed to fetch project:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const isImage = project.source === 'image';

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProject(projectId, {
        imageUrl: imageUrl.trim() || undefined,
        containerPort: containerPort ? parseInt(containerPort, 10) : undefined,
        imageCmd: imageCmd.trim() || undefined,
      });
      toast.success('Deployment source updated. Redeploy to apply changes.');
    } catch (err) {
      console.error('Failed to update deployment source:', err);
      toast.error('Failed to update deployment source');
    } finally {
      setSaving(false);
    }
  };

  if (!isImage) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-ol" />
            <span className="text-sm font-body font-medium text-primary-ol">Git Repository</span>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-body text-secondary-ol">Repository URL</label>
              <div className="text-sm font-mono text-primary-ol mt-1">{project.repoUrl}</div>
            </div>
            {project.branch && (
              <div>
                <label className="text-xs font-body text-secondary-ol">Branch</label>
                <div className="text-sm font-mono text-primary-ol mt-1">{project.branch}</div>
              </div>
            )}
          </div>
          <p className="text-xs font-body text-muted-ol">
            Git repository settings cannot be changed after project creation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-ol" />
          <span className="text-sm font-body font-medium text-primary-ol">Docker Image</span>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-body font-medium text-secondary-ol">Image URL</label>
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="e.g., nginx:latest, ghcr.io/user/repo:tag"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-body font-medium text-secondary-ol">
              Container Port
            </label>
            <Input
              type="number"
              value={containerPort}
              onChange={(e) => setContainerPort(e.target.value)}
              placeholder="e.g., 80, 3000, 8080"
              className="font-mono text-sm"
            />
            <p className="text-xs font-body text-muted-ol">
              The port your application listens on inside the container.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-body font-medium text-secondary-ol">
              Command (Optional)
            </label>
            <Input
              value={imageCmd}
              onChange={(e) => setImageCmd(e.target.value)}
              placeholder="e.g., npm start"
              className="font-mono text-sm"
            />
            <p className="text-xs font-body text-muted-ol">
              Override the default command. Space-separated arguments.
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving || !imageUrl.trim()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
