import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GitBranch } from 'lucide-react';
import type { EnvironmentType } from '@/types';

interface AddEnvironmentDialogProps {
  open: boolean;
  type: EnvironmentType | null;
  projectBranch?: string;
  branchValue: string;
  onOpenChange: (open: boolean) => void;
  onBranchChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
}

export function AddEnvironmentDialog({
  open,
  type,
  projectBranch,
  branchValue,
  onOpenChange,
  onBranchChange,
  onCancel,
  onConfirm,
  isSubmitting,
}: AddEnvironmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{type ? `Create ${type} environment` : 'Create environment'}</DialogTitle>
          <DialogDescription>
            {'Choose which branch this environment should track.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          <label
            htmlFor="env-branch"
            className="text-xs font-medium leading-none flex items-center gap-1.5 text-secondary-ol"
          >
            <GitBranch className="h-3 w-3" />
            {'Branch'}
          </label>
          <Input
            id="env-branch"
            placeholder={projectBranch ?? 'main'}
            value={branchValue}
            onChange={(e) => onBranchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
            }}
            className="h-8 text-sm"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {'Cancel'}
          </Button>
          <Button
            size="sm"
            className="bg-foreground text-background hover:bg-foreground/90"
            disabled={isSubmitting}
            onClick={onConfirm}
          >
            {'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
