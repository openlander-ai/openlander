import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepProgressProps {
  step: number;
  toolName?: string;
}

export function StepProgress({ step, toolName }: StepProgressProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground',
        'animate-in fade-in slide-in-from-bottom-1 duration-300',
      )}
      data-testid="step-progress"
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>
        Step {step}
        {toolName ? ` · ${toolName}` : ''}
      </span>
    </div>
  );
}
