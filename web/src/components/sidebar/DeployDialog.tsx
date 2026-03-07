import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deployProject } from '@/lib/api';

interface DeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeploySuccess: () => void;
}

export function DeployDialog({ open, onOpenChange, onDeploySuccess }: DeployDialogProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setLoading(true);
    setError(null);

    try {
      await deployProject(repoUrl, branch || undefined, name || undefined);
      setRepoUrl('');
      setBranch('');
      setName('');
      onDeploySuccess();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deploy project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Deploy New Project</SheetTitle>
          <SheetDescription>
            Enter the repository URL to deploy. OpenLander will clone, build, and run it.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label
              htmlFor="repo-url"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Repository URL
            </label>
            <Input
              id="repo-url"
              placeholder="github.com/user/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="branch"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Branch (Optional)
            </label>
            <Input
              id="branch"
              placeholder="main"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="name"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Project Name (Optional)
            </label>
            <Input
              id="name"
              placeholder="auto-detected from repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {loading ? 'Deploying...' : 'Deploy'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
