import { ShieldAlert } from 'lucide-react';
import { cn } from '../../lib/utils.js';

interface CircuitBreakerBadgeProps {
  state: string;
  failures?: number;
  className?: string;
}

export function CircuitBreakerBadge({ state, failures = 0, className }: CircuitBreakerBadgeProps) {
  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <ShieldAlert className="h-3.5 w-3.5" />
      CB: {state.toUpperCase()} {state !== 'closed' && `${failures}/5`}
    </span>
  );
}
