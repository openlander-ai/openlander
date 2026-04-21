import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { EnvVarInfo } from '@/lib/api';

interface RedeployEnvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redeployVars: EnvVarInfo[];
  redeployPasteText: string;
  onRedeployPasteTextChange: (value: string) => void;
  onSkip: () => void;
  onDeploy: () => void;
}

export function RedeployEnvDialog({
  open,
  onOpenChange,
  redeployVars,
  redeployPasteText,
  onRedeployPasteTextChange,
  onSkip,
  onDeploy,
}: RedeployEnvDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{'Environment Variables'}</DialogTitle>
          <DialogDescription>
            {`Found ${String(redeployVars.length)} new environment variable${redeployVars.length !== 1 ? 's' : ''}. Paste your .env file below.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <textarea
            className="w-full rounded-md px-3 py-2 text-xs font-mono bg-bg-app border border-border text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-agent/40"
            rows={10}
            placeholder={redeployVars.map((v) => v.key + '=').join('\n')}
            value={redeployPasteText}
            onChange={(e) => onRedeployPasteTextChange(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {'Cancel'}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={onSkip}
          >
            {'Skip'}
          </button>
          <Button
            className="bg-foreground text-background hover:bg-foreground/90"
            onClick={onDeploy}
          >
            {'Deploy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
