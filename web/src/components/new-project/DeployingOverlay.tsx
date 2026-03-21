import { Loader2 } from 'lucide-react';

interface DeployingOverlayProps {
  deployStatus: string | null;
}

export function DeployingOverlay({ deployStatus }: DeployingOverlayProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-agent" />
        <p className="text-sm font-body text-secondary-ol">
          {deployStatus ?? 'Starting deployment...'}
        </p>
      </div>
    </div>
  );
}
