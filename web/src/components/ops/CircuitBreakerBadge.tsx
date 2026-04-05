import { cn } from '../../lib/utils.js';
import { describeCBState } from './utils';

interface CircuitBreakerBadgeProps {
  state: string;
  failures?: number;
  className?: string;
}

export function CircuitBreakerBadge({ state, failures = 0, className }: CircuitBreakerBadgeProps) {
  const { label } = describeCBState(state, failures); // using default 'ko' for short badge
  return (
    <span className={cn('flex items-center gap-1.5', className)} title={`${state} (${failures}/5)`}>
      {label}
    </span>
  );
}
