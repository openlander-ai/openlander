import { cn } from '../../lib/utils.js';
import { describeCBState } from './utils';
import { useLanguage } from '../../i18n/context.js';

interface CircuitBreakerBadgeProps {
  state: string;
  failures?: number;
  className?: string;
}

export function CircuitBreakerBadge({ state, failures = 0, className }: CircuitBreakerBadgeProps) {
  const { language } = useLanguage();
  const { label } = describeCBState(state, failures, language);
  return (
    <span className={cn('flex items-center gap-1.5', className)} title={`${state} (${failures}/5)`}>
      {label}
    </span>
  );
}
